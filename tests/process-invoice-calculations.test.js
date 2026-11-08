import test from 'node:test';
import assert from 'node:assert/strict';

import {
  processInvoiceCalculations,
} from '../lib/admin/processInvoiceCalculations.js';

const RESTAURANT_ID = 'synthetic-restaurant';

function createFixture({
  locked = false,
  failPricing = false,
  failInventory = false,
  pending = true,
} = {}) {
  const calls = {
    claims: 0,
    finishes: [],
    reprices: [],
    recomputes: 0,
    inventoryRuns: 0,
    errorsReported: [],
  };

  let generation = pending ? 1 : 0;
  let completedGeneration = 0;
  let activeLease = null;
  let shouldFailPricing = failPricing;
  let shouldFailInventory = failInventory;

  const db = {
    async rpc(name, args) {
      if (name === 'claim_invoice_calculations') {
        calls.claims++;

        if (
          generation <= completedGeneration ||
          activeLease !== null
        ) {
          return { data: [], error: null };
        }

        activeLease = `lease-${calls.claims}`;

        return {
          data: [{
            restaurant_id: RESTAURANT_ID,
            generation,
            lease_token: activeLease,
            effective_date: '2026-11-07',
          }],
          error: null,
        };
      }

      if (name === 'finish_invoice_calculations') {
        calls.finishes.push(args);

        assert.equal(
          args.p_restaurant_id,
          RESTAURANT_ID
        );

        assert.equal(
          args.p_lease,
          activeLease
        );

        if (args.p_error === null) {
          completedGeneration = args.p_generation;
        }

        activeLease = null;

        return { data: null, error: null };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    },

    from(table) {
      assert.equal(table, 'ingredients');

      return {
        select() {
          return this;
        },

        eq() {
          return this;
        },

        order() {
          return this;
        },
      };
    },
  };

  const dependencies = {
    async getPolicy() {
      return { matching_enabled: !locked };
    },

    async fetchAll() {
      return [
        { id: 'ingredient-1' },
        { id: 'ingredient-2' },
      ];
    },

    async reprice(_db, restaurantId, ingredientId) {
      assert.equal(restaurantId, RESTAURANT_ID);

      calls.reprices.push(ingredientId);

      if (shouldFailPricing) {
        throw new Error('Synthetic pricing failure');
      }
    },

    async recomputeCosts() {
      calls.recomputes++;

      return {
        updated: 1,
        blocked: [],
        notificationErrors: [],
      };
    },

    async runUsage() {
      calls.inventoryRuns++;

      if (shouldFailInventory) {
        return {
          error: 'Synthetic inventory failure',
        };
      }

      return {
        applied: true,
        error: null,
      };
    },

    async rebuildInventory() {
      throw new Error(
        'Unexpected inventory rebuild'
      );
    },

    async reportError(_key, _title, message) {
      calls.errorsReported.push(message);
    },
  };

  return {
    db,
    dependencies,
    calls,

    recover() {
      shouldFailPricing = false;
      shouldFailInventory = false;
    },

    state() {
      return {
        generation,
        completedGeneration,
        activeLease,
      };
    },
  };
}

test('successful worker completes the calculation generation', async () => {
  const fixture = createFixture();

  const result = await processInvoiceCalculations(
    fixture.db,
    RESTAURANT_ID,
    fixture.dependencies
  );

  assert.equal(result.skipped, false);
  assert.deepEqual(result.errors, []);

  assert.deepEqual(
    fixture.calls.reprices,
    ['ingredient-1', 'ingredient-2']
  );

  assert.equal(fixture.calls.recomputes, 1);
  assert.equal(fixture.calls.inventoryRuns, 1);

  assert.equal(
    fixture.calls.finishes[0].p_error,
    null
  );

  assert.equal(
    fixture.state().completedGeneration,
    1
  );

  console.log(
    'PASS: Successful calculation completed'
  );
});

test('pricing failure preserves an unfinished generation', async () => {
  const fixture = createFixture({
    failPricing: true,
  });

  const result = await processInvoiceCalculations(
    fixture.db,
    RESTAURANT_ID,
    fixture.dependencies
  );

  assert.equal(result.skipped, false);

  assert.ok(
    result.errors.some((error) =>
      error.includes('Synthetic pricing failure')
    )
  );

  assert.equal(
    fixture.state().completedGeneration,
    0
  );

  assert.equal(
    fixture.calls.finishes.length,
    1
  );

  assert.equal(
    fixture.calls.errorsReported.length,
    1
  );

  // Inventory still runs after a pricing failure.
  assert.equal(fixture.calls.inventoryRuns, 1);

  console.log(
    'PASS: Pricing failure preserved unfinished work'
  );
});

test('failed calculation can recover on a subsequent attempt', async () => {
  const fixture = createFixture({
    failPricing: true,
  });

  const first = await processInvoiceCalculations(
    fixture.db,
    RESTAURANT_ID,
    fixture.dependencies
  );

  assert.ok(first.errors.length > 0);
  assert.equal(
    fixture.state().completedGeneration,
    0
  );

  fixture.recover();

  const second = await processInvoiceCalculations(
    fixture.db,
    RESTAURANT_ID,
    fixture.dependencies
  );

  assert.deepEqual(second.errors, []);

  assert.equal(
    fixture.state().completedGeneration,
    1
  );

  assert.equal(
    fixture.calls.finishes.length,
    2
  );

  assert.equal(
    fixture.calls.finishes[1].p_error,
    null
  );

  console.log(
    'PASS: Failed calculation recovered successfully'
  );
});

test('locked restaurants never claim calculation jobs', async () => {
  const fixture = createFixture({
    locked: true,
  });

  const result = await processInvoiceCalculations(
    fixture.db,
    RESTAURANT_ID,
    fixture.dependencies
  );

  assert.equal(result.skipped, true);
  assert.equal(result.locked, true);

  assert.equal(fixture.calls.claims, 0);
  assert.equal(fixture.calls.reprices.length, 0);
  assert.equal(fixture.calls.inventoryRuns, 0);

  console.log(
    'PASS: Locked restaurant processing blocked'
  );
});

test('inventory failure prevents successful job completion', async () => {
  const fixture = createFixture({
    failInventory: true,
  });

  const result = await processInvoiceCalculations(
    fixture.db,
    RESTAURANT_ID,
    fixture.dependencies
  );

  assert.ok(
    result.errors.some((error) =>
      error.includes('Synthetic inventory failure')
    )
  );

  assert.equal(
    fixture.state().completedGeneration,
    0
  );

  assert.equal(
    fixture.calls.errorsReported.length,
    1
  );

  console.log(
    'PASS: Inventory failure preserved unfinished work'
  );
});

test('worker skips when no calculation job is pending', async () => {
  const fixture = createFixture({
    pending: false,
  });

  const result = await processInvoiceCalculations(
    fixture.db,
    RESTAURANT_ID,
    fixture.dependencies
  );

  assert.equal(result.skipped, true);
  assert.deepEqual(result.errors, []);

  assert.equal(fixture.calls.reprices.length, 0);
  assert.equal(fixture.calls.finishes.length, 0);

  console.log(
    'PASS: No pending job correctly skipped'
  );
});