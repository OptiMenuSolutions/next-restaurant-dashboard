
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


function mockDatabase(responses) {
  const operations = [];

  function query(table) {
    const operation = {
      table,
      action: 'select',
      filters: [],
      values: null,
    };

    operations.push(operation);

    const builder = {
      select() {
        return builder;
      },
      update(values) {
        operation.action = 'update';
        operation.values = values;
        return builder;
      },
      delete() {
        operation.action = 'delete';
        return builder;
      },
      eq(column, value) {
        operation.filters.push(['eq', column, value]);
        return builder;
      },
      is(column, value) {
        operation.filters.push(['is', column, value]);
        return builder;
      },
      in(column, values) {
        operation.filters.push(['in', column, values]);
        return builder;
      },
      limit() {
        return builder;
      },
      single() {
        return Promise.resolve(nextResponse());
      },
      maybeSingle() {
        return Promise.resolve(nextResponse());
      },
      then(resolve, reject) {
        return Promise.resolve(nextResponse()).then(resolve, reject);
      },
    };

    function nextResponse() {
      if (!responses.length) {
        throw new Error(
          `No mock response for ${operation.action} ${table}`
        );
      }

      const expected = responses.shift();

      assert.equal(operation.table, expected.table);
      assert.equal(operation.action, expected.action || 'select');

      return {
        data: expected.data ?? null,
        error: expected.error ?? null,
      };
    }

    return builder;
  }

  return {
    operations,
    from: query,
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            operations.push({
              table: `storage:${bucket}`,
              action: 'remove',
              values: paths,
            });
            return { error: null };
          },
        };
      },
    },
  };
}

function enabledDependencies(db) {
  const effects = [];

  return {
    db,
    effects,
    verifyAccess: async () => ({ error: null, status: 200 }),
    getMatchingControl: async () => ({
      status: 'legacy_enabled',
      matching_enabled: true,
      is_locked: false,
    }),
    reprice: async (...args) => {
      effects.push({ type: 'reprice', args });
    },
    recompute: async (...args) => {
      effects.push({ type: 'recompute', args });
    },
    rebuild: async (...args) => {
      effects.push({ type: 'rebuild', args });
    },
  };
}

test('locked invoice deletion skips pricing and inventory', async () => {
  const db = mockDatabase([
    {
      table: 'invoices',
      data: [{ id: 'invoice-1', file_url: null }],
    },
    {
      table: 'invoice_items',
      data: [{ id: 'line-1', ingredient_id: 'ingredient-1' }],
    },
    {
      table: 'invoice_files',
      data: [],
    },
    {
      table: 'invoice_items',
      action: 'delete',
    },
    {
      table: 'invoice_files',
      action: 'delete',
    },
    {
      table: 'invoices',
      action: 'delete',
    },
  ]);

  const deps = enabledDependencies(db);
  deps.getMatchingControl = async () => ({
    status: 'locked',
    matching_enabled: false,
    is_locked: true,
  });

  const res = response();

  await createDeleteInvoiceHandler(deps)({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_ids: ['invoice-1'],
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, 1);
  assert.equal(res.body.ingredients_repriced, 0);
  assert.deepEqual(deps.effects, []);
  assert.equal(
    db.operations.some(op => op.table === 'ingredients'),
    false
  );
});

test('manual linking updates exactly one invoice line', async () => {
  const db = mockDatabase([
    {
      table: 'invoice_items',
      data: {
        id: 'line-1',
        unit: 'each',
        unit_cost: 5,
        ingredient_id: null,
        invoices: {
          restaurant_id: restaurantId,
          date: '2026-10-01',
        },
      },
    },
    {
      table: 'ingredients',
      data: {
        id: 'ingredient-1',
        name: 'Tomato',
        unit: 'each',
        last_ordered_at: '2026-10-20',
      },
    },
    {
      table: 'invoice_items',
      action: 'update',
      data: [{ id: 'line-1' }],
    },
  ]);

  const deps = enabledDependencies(db);
  const res = response();

  await createLinkInvoiceItemHandler(deps)({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_item_id: 'line-1',
      ingredient_id: 'ingredient-1',
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.moved, 1);

  const updates = db.operations.filter(
    op => op.action === 'update'
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0].table, 'invoice_items');
  assert.deepEqual(updates[0].values, {
    ingredient_id: 'ingredient-1',
  });
  assert.deepEqual(
    updates[0].filters,
    [
      ['eq', 'id', 'line-1'],
      ['is', 'ingredient_id', null],
    ]
  );

  assert.deepEqual(
    deps.effects.map(effect => effect.type),
    ['recompute', 'rebuild']
  );
});

test('manual linking rejects a foreign ingredient', async () => {
  const db = mockDatabase([
    {
      table: 'invoice_items',
      data: {
        id: 'line-1',
        ingredient_id: null,
        invoices: {
          restaurant_id: restaurantId,
          date: '2026-10-01',
        },
      },
    },
    {
      table: 'ingredients',
      data: null,
    },
  ]);

  const deps = enabledDependencies(db);
  const res = response();

  await createLinkInvoiceItemHandler(deps)({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_item_id: 'line-1',
      ingredient_id: 'foreign-ingredient',
    },
  }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(
    db.operations.some(op => op.action === 'update'),
    false
  );
  assert.deepEqual(deps.effects, []);
});

test('older invoice link does not overwrite newer ingredient price', async () => {
  const db = mockDatabase([
    {
      table: 'invoice_items',
      data: {
        id: 'line-old',
        unit: 'each',
        unit_cost: 2,
        ingredient_id: null,
        invoices: {
          restaurant_id: restaurantId,
          date: '2026-09-01',
        },
      },
    },
    {
      table: 'ingredients',
      data: {
        id: 'ingredient-1',
        name: 'Tomato',
        unit: 'each',
        last_ordered_at: '2026-10-01',
      },
    },
    {
      table: 'invoice_items',
      action: 'update',
      data: [{ id: 'line-old' }],
    },
  ]);

  const deps = enabledDependencies(db);
  const res = response();

  await createLinkInvoiceItemHandler(deps)({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_item_id: 'line-old',
      ingredient_id: 'ingredient-1',
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(
    db.operations.some(op =>
      op.table === 'ingredients' && op.action === 'update'
    ),
    false
  );
});

test('admin review reprices both ingredients after relinking', async () => {
  const db = mockDatabase([
    {
      table: 'invoices',
      data: {
        id: 'invoice-1',
        date: '2026-10-01',
      },
    },
    {
      table: 'invoice_items',
      data: [{
        id: 'line-1',
        quantity: 1,
        unit: 'each',
        unit_cost: 5,
        amount: 5,
        ingredient_id: 'ingredient-old',
      }],
    },
    {
      table: 'ingredients',
      data: [{ id: 'ingredient-new' }],
    },
    {
      table: 'invoice_items',
      action: 'update',
      data: [{ id: 'line-1' }],
    },
  ]);

  const deps = enabledDependencies(db);
  const res = response();

  await createSaveInvoiceItemsHandler(deps)({
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_id: 'invoice-1',
      items: [{
        id: 'line-1',
        quantity: 1,
        unit: 'each',
        unit_cost: 5,
        amount: 5,
        ingredient_id: 'ingredient-new',
      }],
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, 1);
  assert.equal(res.body.ingredients_repriced, 2);

  const repricedIds = deps.effects
    .filter(effect => effect.type === 'reprice')
    .map(effect => effect.args[2]);

  assert.deepEqual(
    new Set(repricedIds),
    new Set(['ingredient-old', 'ingredient-new'])
  );

  assert.deepEqual(
    deps.effects.map(effect => effect.type),
    ['reprice', 'reprice', 'recompute', 'rebuild']
  );
});
