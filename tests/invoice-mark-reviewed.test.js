import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://unit.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';
const handlerModule = import('../pages/api/admin/invoice-review/mark-reviewed.js');

const invoiceId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const session = { user: { id: adminId }, profile: { role: 'admin' } };
const success = { success: true, invoice_id: invoiceId, restaurant_id: restaurantId,
  reviewed: true, reviewed_by: adminId, reviewed_at: '2026-11-16T12:00:00Z',
  reviewed_lines: 2, changed: true };

async function run({ method = 'POST', body = { invoice_id: invoiceId },
  auth = session, invoice = { id: invoiceId, restaurant_id: restaurantId },
  lookupError = null, rpcError = null, result = success, throws = false } = {}) {
  const calls = [];
  const db = {
    from(table) {
      calls.push(['read', table]);
      assert.equal(table, 'invoices');
      return {
        select(columns) { assert.equal(columns, 'id,restaurant_id'); return this; },
        eq(column, value) { assert.equal(column, 'id'); assert.equal(value, invoiceId); return this; },
        async maybeSingle() { return { data: invoice, error: lookupError }; },
      };
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (throws) throw new Error('Internal database detail');
      return { data: result, error: rpcError };
    },
  };
  const res = { statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
  const { createMarkInvoiceReviewedHandler } = await handlerModule;
  await createMarkInvoiceReviewedHandler({ db })({ method, body }, res, auth);
  return { res, calls };
}

test('marks through one RPC using the session reviewer and database restaurant', async () => {
  const { res, calls } = await run();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, success);
  assert.deepEqual(calls, [['read', 'invoices'], ['rpc', 'mark_invoice_reviewed_transactional', {
    p_restaurant_id: restaurantId, p_invoice_id: invoiceId, p_admin_id: adminId,
  }]]);
});

test('unsupported methods do not access the database', async () => {
  const { res, calls } = await run({ method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.deepEqual(calls, []);
});

test('requires an administrator session', async () => {
  for (const auth of [null, { user: { id: adminId }, profile: { role: 'client' } }]) {
    const { res, calls } = await run({ auth });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(calls, []);
  }
});

test('rejects malformed bodies and submitted reviewer or tenant overrides', async () => {
  for (const body of [null, [], {}, '{', { invoice_id: 'bad' },
    { invoice_id: invoiceId, reviewed_by: adminId },
    { invoice_id: invoiceId, restaurant_id: restaurantId }]) {
    const { res, calls } = await run({ body });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(calls, []);
  }
});

test('accepts a valid JSON body', async () => {
  assert.equal((await run({ body: JSON.stringify({ invoice_id: invoiceId }) })).res.statusCode, 200);
});

test('a missing invoice never reaches the RPC', async () => {
  const { res, calls } = await run({ invoice: null });
  assert.equal(res.statusCode, 404);
  assert.equal(calls.length, 1);
});

test('lookup failure does not become a missing invoice or expose database details', async () => {
  const { res, calls } = await run({ lookupError: { message: 'Internal database detail' } });
  assert.equal(res.statusCode, 500);
  assert.equal(calls.length, 1);
  assert.deepEqual(res.body, { error: 'Could not mark the invoice as reviewed.' });
});

test('maps database authorization and missing-invoice failures', async () => {
  for (const [code, status] of [['42501', 403], ['P0002', 404], ['P0001', 500]]) {
    const { res } = await run({ rpcError: { code, message: 'Internal database detail' } });
    assert.equal(res.statusCode, status);
    assert.equal(JSON.stringify(res.body).includes('Internal database detail'), false);
  }
});

test('rejects invalid or mismatched RPC responses', async () => {
  for (const result of [null, { ...success, invoice_id: adminId },
    { ...success, restaurant_id: adminId }, { ...success, reviewed: false },
    { ...success, reviewed_by: null }, { ...success, reviewed_at: 'bad' },
    { ...success, reviewed_lines: -1 }, { ...success, changed: undefined }]) {
    assert.equal((await run({ result })).res.statusCode, 500);
  }
});

test('accepts an idempotent result preserving an earlier reviewer', async () => {
  const result = { ...success, reviewed_by: restaurantId, reviewed_lines: 0, changed: false };
  assert.deepEqual((await run({ result })).res.body, result);
});

test('a thrown RPC failure returns an unsuccessful response', async () => {
  assert.equal((await run({ throws: true })).res.statusCode, 500);
});