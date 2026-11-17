import test from 'node:test';
import assert from 'node:assert/strict';
import { saveWasteConfirmationResponse } from '../lib/saveWasteConfirmationResponse.js';
import { createRebuildAfterConfirmationHandler } from '../pages/api/inventory/rebuild-after-confirmation.js';

const rid = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const foreign = '33333333-3333-4333-8333-333333333333';
const row = status => ({ id, restaurant_id: rid, status });
const response = data => ({ data, error: null });

function database(...results) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: [], update: null };
    calls.push(call);
    return {
      update(value) { call.update = value; return this; },
      select(value) { call.select = value; return this; },
      eq(key, value) { call.filters.push(['eq', key, value]); return this; },
      in(key, value) { call.filters.push(['in', key, value]); return this; },
      async maybeSingle() {
        assert.ok(results.length, 'Unexpected database read.');
        return results.shift();
      },
    };
  } };
}

async function invoke(options = {}, body = { confirmation_id: id }, method = 'POST') {
  const result = { headers: {} };
  let rebuilds = 0;
  const handler = createRebuildAfterConfirmationHandler({
    db: database(response(row('confirmed_wasted'))),
    verifyOwner: async () => ({ restaurant: { id: rid } }),
    rebuild: async (_, restaurantId) => {
      assert.equal(restaurantId, rid);
      rebuilds++;
    },
    ...options,
  });
  await handler({ method, body, headers: {} }, {
    setHeader(key, value) { result.headers[key] = value; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; },
  });
  return { ...result, rebuilds };
}

for (const status of ['confirmed_wasted', 'confirmed_used', 'kept', 'not_sure']) {
  test(`save ${status} updates only status and scopes unresolved rows to the tenant`, async () => {
    const db = database(response(row(status)));
    assert.equal((await saveWasteConfirmationResponse(db, rid, id, status)).already_saved, false);
    assert.deepEqual(db.calls, [{ table: 'waste_confirmations', update: { status },
      select: 'id,restaurant_id,status', filters: [['eq', 'id', id],
        ['eq', 'restaurant_id', rid], ['in', 'status', ['pending', 'expired_unconfirmed']]] }]);
  });
  test(`identical ${status} retry verifies the existing answer without another update`, async () => {
    const db = database(response(null), response(row(status)));
    assert.equal((await saveWasteConfirmationResponse(db, rid, id, status)).already_saved, true);
    assert.equal(db.calls[1].update, null);
    assert.deepEqual(db.calls[1].filters, [['eq', 'id', id], ['eq', 'restaurant_id', rid]]);
  });
  test(`rebuild accepts a saved ${status} response`, async () => {
    const db = database(response(row(status)));
    const result = await invoke({ db });
    assert.equal(result.status, 200);
    assert.equal(result.rebuilds, 1);
    assert.deepEqual(db.calls[0].filters, [['eq', 'id', id], ['eq', 'restaurant_id', rid]]);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
  });
}

test('invalid IDs and nonfinal statuses never reach the database', async () => {
  for (const args of [[null, id, 'kept'], [rid, 'bad', 'kept'], [rid, id, 'pending'],
    [rid, id, 'dismissed'], [rid, id, 'confirmed_no_waste']]) {
    const db = database();
    await assert.rejects(saveWasteConfirmationResponse(db, ...args), /valid confirmation/);
    assert.equal(db.calls.length, 0);
  }
});

test('zero affected rows and no visible saved response cannot look successful', async () => {
  await assert.rejects(saveWasteConfirmationResponse(database(response(null), response(null)),
    rid, id, 'kept'), /not found or access denied/);
});

test('a different resolved answer cannot be overwritten or accepted as an identical retry', async () => {
  await assert.rejects(saveWasteConfirmationResponse(database(response(null), response(row('kept'))),
    rid, id, 'confirmed_used'), /different response/);
});

test('a returned foreign ID or tenant is rejected', async () => {
  for (const saved of [{ ...row('kept'), id: foreign }, { ...row('kept'), restaurant_id: foreign }]) {
    await assert.rejects(saveWasteConfirmationResponse(database(response(saved)), rid, id, 'kept'),
      /not found or access denied/);
  }
});

for (const phase of ['update', 'retry read']) {
  test(`${phase} errors are surfaced`, async () => {
    const error = new Error('Read or write unavailable');
    const results = phase === 'update' ? [{ data: null, error }]
      : [response(null), { data: null, error }];
    await assert.rejects(saveWasteConfirmationResponse(database(...results), rid, id, 'kept'),
      /unavailable/);
  });
}

test('unsupported methods do not authenticate or read data', async () => {
  const db = database();
  const result = await invoke({ db, verifyOwner: () => { throw new Error('Unexpected auth'); } }, {}, 'GET');
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, 'POST');
  assert.equal(db.calls.length, 0);
});

for (const status of [401, 403]) {
  test(`authentication failure ${status} cannot read data or rebuild`, async () => {
    const db = database();
    const result = await invoke({ db, verifyOwner: async () => ({ error: 'Access denied', status }) });
    assert.equal(result.status, status);
    assert.equal(result.rebuilds, 0);
    assert.equal(db.calls.length, 0);
  });
}

test('malformed JSON and invalid or extra body fields return 400 before reading data', async () => {
  for (const body of ['{', null, [], {}, { confirmation_id: 'bad' },
    { confirmation_id: id, restaurant_id: foreign }]) {
    const db = database();
    const result = await invoke({ db }, body);
    assert.equal(result.status, 400);
    assert.equal(db.calls.length, 0);
    assert.equal(result.rebuilds, 0);
  }
});

test('missing or foreign confirmations return 404 without rebuilding', async () => {
  const result = await invoke({ db: database(response(null)) });
  assert.equal(result.status, 404);
  assert.equal(result.rebuilds, 0);
});

test('pending, expired, and unsupported statuses cannot start a rebuild', async () => {
  for (const status of ['pending', 'expired_unconfirmed', 'dismissed', 'confirmed_no_waste']) {
    const result = await invoke({ db: database(response(row(status))) });
    assert.equal(result.status, 409);
    assert.equal(result.rebuilds, 0);
  }
});

test('database failure returns 500 without rebuilding', async () => {
  const result = await invoke({ db: database({ data: null, error: new Error('Synthetic read failure') }) });
  assert.equal(result.status, 500);
  assert.equal(result.rebuilds, 0);
});

test('failed inventory refresh stays a failure and the same saved response can be retried', async () => {
  const failed = await invoke({ rebuild: async () => { throw new Error('Synthetic rebuild failure'); } });
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /response was saved/);
  assert.equal((await invoke()).status, 200);
});