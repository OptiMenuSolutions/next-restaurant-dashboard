
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDeleteInvoiceHandler,
} from '../pages/api/invoices/delete-invoice.js';

import {
  createLinkInvoiceItemHandler,
} from '../pages/api/invoices/link-item.js';

import {
  createSaveInvoiceItemsHandler,
} from '../pages/api/admin/invoice-review/save-items.js';

const restaurantId = 'restaurant-test-1';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

function forbiddenDatabase() {
  const calls = [];

  return {
    calls,
    from(table) {
      calls.push(table);
      throw new Error(
        `Unexpected database access: ${table}`
      );
    },
    storage: {
      from(bucket) {
        calls.push(`storage:${bucket}`);
        throw new Error(
          `Unexpected storage access: ${bucket}`
        );
      },
    },
  };
}

function dependencies({
  status = 'locked',
  lookupError = false,
} = {}) {
  const db = forbiddenDatabase();
  const effects = [];

  return {
    db,
    effects,

    verifyAccess: async () => ({
      error: null,
      status: 200,
    }),

    getMatchingControl: async () => {
      if (lookupError) {
        throw new Error('Control lookup failed');
      }

      return {
        status,
        matching_enabled: status !== 'locked',
        is_locked: status === 'locked',
      };
    },

    reprice: async () => {
      effects.push('reprice');
    },

    recompute: async () => {
      effects.push('recompute');
    },

    rebuild: async () => {
      effects.push('rebuild');
    },
  };
}

test('locked restaurant cannot manually link an invoice item', async () => {
  const deps = dependencies();

  const handler = createLinkInvoiceItemHandler(deps);
  const res = response();

  await handler({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_item_id: 'line-1',
      ingredient_id: 'ingredient-1',
    },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(deps.db.calls.length, 0);
  assert.deepEqual(deps.effects, []);
});

test('manual linking fails closed when controls are unavailable', async () => {
  const deps = dependencies({ lookupError: true });

  const handler = createLinkInvoiceItemHandler(deps);
  const res = response();

  await handler({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_item_id: 'line-1',
      ingredient_id: 'ingredient-1',
    },
  }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(deps.db.calls.length, 0);
  assert.deepEqual(deps.effects, []);
});

test('locked restaurant cannot save admin invoice edits', async () => {
  const deps = dependencies();

  const handler = createSaveInvoiceItemsHandler(deps);
  const res = response();

  await handler({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_id: 'invoice-1',
      items: [{
        id: 'line-1',
        quantity: 2,
        unit: 'lb',
        unit_cost: 10,
        amount: 20,
        ingredient_id: 'ingredient-1',
      }],
    },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(deps.db.calls.length, 0);
  assert.deepEqual(deps.effects, []);
});

test('admin invoice editing fails closed when controls are unavailable', async () => {
  const deps = dependencies({ lookupError: true });

  const handler = createSaveInvoiceItemsHandler(deps);
  const res = response();

  await handler({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_id: 'invoice-1',
      items: [{
        id: 'line-1',
        ingredient_id: 'ingredient-1',
      }],
    },
  }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(deps.db.calls.length, 0);
  assert.deepEqual(deps.effects, []);
});

test('invoice deletion fails closed when controls are unavailable', async () => {
  const deps = dependencies({ lookupError: true });

  const handler = createDeleteInvoiceHandler(deps);
  const res = response();

  await handler({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_ids: ['invoice-1'],
    },
  }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(deps.db.calls.length, 0);
  assert.deepEqual(deps.effects, []);
});

test('unauthorized deletion never reaches matching controls', async () => {
  const deps = dependencies();

  let controlCalled = false;

  const handler = createDeleteInvoiceHandler({
    ...deps,
    verifyAccess: async () => ({
      error: 'Unauthorized',
      status: 401,
    }),
    getMatchingControl: async () => {
      controlCalled = true;
      throw new Error('Must not execute');
    },
  });

  const res = response();

  await handler({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_ids: ['invoice-1'],
    },
  }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(controlCalled, false);
  assert.equal(deps.db.calls.length, 0);
});
