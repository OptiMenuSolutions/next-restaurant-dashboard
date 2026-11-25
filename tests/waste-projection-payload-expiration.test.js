import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../pages/api/cron/expire-waste-projection-payloads.js', import.meta.url),
  'utf8'
)
  .replace(/^import .*;\r?$/gm, '')
  .replace(/^export const config/m, 'const config')
  .replace(/^export default /m, 'globalThis.handler = ');

async function run(results, authorization = 'Bearer test-secret') {
  let calls = 0;
  const context = {
    process: { env: { CRON_SECRET: 'test-secret' } },
    console: { error() {} },
    withJobRun: (_name, handler) => handler,
    createClient: () => ({
      async rpc(name) {
        assert.equal(name, 'waste_projection_expire_payloads');
        assert.ok(calls < results.length);
        const next = results[calls++];
        return typeof next === 'number'
          ? { data: next, error: null }
          : { data: null, error: next };
      },
    }),
  };
  vm.runInNewContext(source, context);
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
  };
  await context.handler({ method: 'GET', headers: { authorization } }, res);
  return { calls, status: res.statusCode, body: res.body };
}

test('the expiration cron requires authorization before deleting payloads', async () => {
  assert.deepEqual(await run([], 'Bearer wrong'), {
    calls: 0,
    status: 401,
    body: { error: 'Unauthorized' },
  });
});

test('the expiration cron stops at a short batch or four full batches', async () => {
  assert.deepEqual(await run([100, 3]), {
    calls: 2,
    status: 200,
    body: { deleted: 103, batch_limit_reached: false },
  });
  assert.deepEqual(await run([100, 100, 100, 100]), {
    calls: 4,
    status: 200,
    body: { deleted: 400, batch_limit_reached: true },
  });
});

test('the expiration cron reports a failed batch and the number already deleted', async () => {
  assert.deepEqual(await run([100, { message: 'database unavailable' }]), {
    calls: 2,
    status: 503,
    body: { error: 'WASTE_PAYLOAD_EXPIRATION_FAILED', deleted: 100 },
  });
});