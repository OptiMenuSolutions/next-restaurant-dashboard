import test from 'node:test';
import assert from 'node:assert/strict';

import { createCountContextHandler } from '../pages/api/inventory/count-context.js';

const RID = 'count-context-restaurant';

function fixture({
  timezone = 'America/New_York',
  accessError = null,
  readError = null,
} = {}) {
  const reads = [];
  const handler = createCountContextHandler({
    verifyOwner: async () =>
      accessError || { restaurant: { id: RID }, user: { id: 'owner' } },
    db: {
      from(table) {
        reads.push(table);
        assert.equal(table, 'restaurants');
        const query = {
          select(columns) {
            assert.equal(columns, 'id, operational_timezone');
            return query;
          },
          eq(column, value) {
            assert.equal(column, 'id');
            assert.equal(value, RID);
            return query;
          },
          async maybeSingle() {
            return {
              data: readError ? null : {
                id: RID,
                operational_timezone: timezone,
              },
              error: readError,
            };
          },
        };
        return query;
      },
    },
  });

  async function run(method = 'GET', query = {}) {
    const res = {
      statusCode: 200, headers: {}, body: null,
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await handler({ method, query }, res);
    return res;
  }

  return { run, reads };
}

test('count context returns the restaurant local date', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-11-12T06:00:00Z'),
  });

  for (const [timezone, today] of [
    ['America/New_York', '2026-11-12'],
    ['America/Los_Angeles', '2026-11-11'],
  ]) {
    const f = fixture({ timezone });
    const res = await f.run();

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { timezone, today });
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  }
});

test('count context authenticates before reading restaurant settings', async () => {
  const f = fixture({
    accessError: { status: 401, error: 'Please sign in again.' },
  });
  const res = await f.run();

  assert.equal(res.statusCode, 401);
  assert.deepEqual(f.reads, []);
});

test('count context never guesses a missing or invalid timezone', async () => {
  for (const timezone of [null, 'Mars/Restaurant']) {
    const f = fixture({ timezone });
    const res = await f.run();

    assert.equal(res.statusCode, 422);
    assert.equal(Object.hasOwn(res.body, 'today'), false);
  }
});

test('count context does not conceal a settings read failure', async () => {
  const f = fixture({
    readError: { message: 'Synthetic settings read failure' },
  });
  const res = await f.run();

  assert.equal(res.statusCode, 503);
  assert.equal(Object.hasOwn(res.body, 'today'), false);
});

test('a query parameter cannot select another restaurant or timezone', async () => {
  const f = fixture();
  const res = await f.run('GET', {
    restaurant_id: 'foreign-restaurant',
    timezone: 'Pacific/Honolulu',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timezone, 'America/New_York');
  assert.deepEqual(f.reads, ['restaurants']);
});

test('count context only accepts GET', async () => {
  const f = fixture();
  const res = await f.run('POST');

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.deepEqual(f.reads, []);
});