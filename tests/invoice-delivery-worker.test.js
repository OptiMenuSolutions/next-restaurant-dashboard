import test from 'node:test';
import assert from 'node:assert/strict';
import { processDeliveryCalculation } from '../lib/admin/processDeliveryCalculation.js';
import { deliveryRetry } from '../lib/admin/invoiceDeliveryQueue.js';
import callback from '../pages/api/queues/invoice-delivery-calculations.js';

const ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE = {
  version: 1,
  restaurant_id: ID,
  generation: '2',
};

function fixture({
  inactive = false,
  missing = false,
  locked = false,
  timezone = 'America/New_York',
  completed = 0,
  outcome = { errors: [] },
  finish = true,
  generation = 2,
  jobMissing = false,
  reportFails = false,
} = {}) {
  const calls = {
    queries: [],
    processed: [],
    reported: [],
  };

  const state = {
    generation,
    completed_generation: completed,
  };

  const db = {
    from(table) {
      const q = {
        select() { return q; },

        eq(key, value) {
          calls.queries.push({ table, key, value });
          assert.equal(value, ID);
          return q;
        },

        async maybeSingle() {
          return {
            error: null,
            data: table === 'restaurants'
              ? missing
                ? null
                : {
                    id: ID,
                    operational_timezone: timezone,
                    deactivated_at: inactive ? '2026-11-13' : null,
                  }
              : jobMissing
                ? null
                : { ...state },
          };
        },
      };

      return q;
    },
  };

  const options = {
    getPolicy: async () => ({
      matching_enabled: !locked,
    }),

    process: async (database, id) => {
      calls.processed.push(id);

      if (outcome instanceof Error) throw outcome;
      if (finish) state.completed_generation = 2;

      return outcome;
    },

    report: async (id, error) => {
      calls.reported.push({
        id,
        error: error.message,
      });

      if (reportFails) {
        throw new Error('Synthetic reporting failure');
      }
    },
  };

  return {
    calls,
    state,
    run: message =>
      processDeliveryCalculation(db, message || MESSAGE, options),
  };
}

test('a worker completes only its restaurant and confirms saved completion', async () => {
  const f = fixture();

  await f.run();

  assert.deepEqual(f.calls.processed, [ID]);
  assert.equal(f.state.completed_generation, 2);
  assert.equal(f.calls.reported.length, 0);
  assert.ok(f.calls.queries.every(q => q.value === ID));
});

test('duplicate delivery performs no calculation after target completion', async () => {
  const f = fixture();

  await f.run();
  const retry = await f.run();

  assert.equal(retry.reason, 'already_completed');
  assert.equal(f.calls.processed.length, 1);
});

test('an old message does not process a newer unrelated pending generation', async () => {
  const f = fixture({
    generation: 3,
    completed: 2,
  });

  assert.equal((await f.run()).reason, 'already_completed');
  assert.equal(f.state.completed_generation, 2);
  assert.equal(f.calls.processed.length, 0);
});

test('inactive, deleted and matching-locked restaurants do no work', async () => {
  for (const options of [
    { inactive: true },
    { missing: true },
    { locked: true },
  ]) {
    const f = fixture(options);

    assert.equal((await f.run()).skipped, true);
    assert.equal(f.calls.processed.length, 0);
  }
});

test('unknown timezone remains an error without inventing a default', async () => {
  const f = fixture({ timezone: null });

  await assert.rejects(f.run());

  assert.equal(f.calls.processed.length, 0);
  assert.equal(f.calls.reported.length, 1);
});

test('active leases and other incomplete calculations cause retry rather than acknowledgement', async () => {
  const f = fixture({
    outcome: { skipped: true, errors: [] },
    finish: false,
  });

  await assert.rejects(f.run(), /remain pending/);

  assert.equal(f.state.completed_generation, 0);
  assert.equal(f.calls.reported.length, 1);
});

test('calculation errors and exceptions are reported and remain retryable', async () => {
  for (const outcome of [
    { errors: ['Synthetic conversion failure'] },
    new Error('Synthetic worker failure'),
  ]) {
    const f = fixture({
      outcome,
      finish: false,
    });

    await assert.rejects(f.run(), /Synthetic/);

    assert.equal(f.state.completed_generation, 0);
    assert.equal(f.calls.reported[0].id, ID);
  }
});

test('reporting failure does not swallow the original calculation failure', async () => {
  const f = fixture({
    outcome: new Error('Original calculation failure'),
    reportFails: true,
  });

  await assert.rejects(
    f.run(),
    /Original calculation failure/
  );
});

test('removed jobs are acknowledged without recreating them', async () => {
  const f = fixture({ jobMissing: true });

  assert.equal((await f.run()).reason, 'job_removed');
  assert.equal(f.calls.processed.length, 0);
});

test('a message cannot request a generation that the database never queued', async () => {
  const f = fixture({ generation: 1 });

  await assert.rejects(f.run(), /ahead of the saved job/);
  assert.equal(f.calls.processed.length, 0);
});

test('malformed messages are rejected before database access', async () => {
  for (const message of [
    { ...MESSAGE, version: 2 },
    { ...MESSAGE, restaurant_id: 'foreign' },
    { ...MESSAGE, generation: '0' },
    { ...MESSAGE, generation: '2.5' },
    { ...MESSAGE, generation: null },
  ]) {
    const f = fixture();

    await assert.rejects(f.run(message));

    assert.equal(f.calls.queries.length, 0);
    assert.equal(f.calls.processed.length, 0);
  }
});

test('retry delay exceeds the database lease and stops after five deliveries', () => {
  for (const deliveryCount of [1, 2, 3, 4]) {
    assert.deepEqual(
      deliveryRetry(new Error('Synthetic'), { deliveryCount }),
      { afterSeconds: 600 }
    );
  }

  assert.deepEqual(
    deliveryRetry(new Error('Synthetic'), { deliveryCount: 5 }),
    { acknowledge: true }
  );
});

test('the installed queue SDK rejects malformed callbacks before application work', async () => {
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; },
    end() {},
  };

  await callback({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {},
  }, res);

  assert.equal(res.code, 400);
});