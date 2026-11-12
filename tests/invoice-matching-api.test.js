
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
  }, res, {
    user: { id: 'admin-test-1' },
  });

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
  }, res, {
    user: { id: 'admin-test-1' },
  });

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
      restaurant_id: DELETE_RESTAURANT_ID,
      invoice_ids: [DELETE_INVOICE_ID],
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
      restaurant_id: DELETE_RESTAURANT_ID,
      invoice_ids: [DELETE_INVOICE_ID],
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
      order() {
        return builder;
      },
      range() {
        return Promise.resolve(nextResponse());
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

const DELETE_RESTAURANT_ID =
  '11111111-1111-4111-8111-111111111111';

const DELETE_INVOICE_ID =
  '22222222-2222-4222-8222-222222222222';

function transactionalDeletionMock({
  rpcError = null,
  queued = true,
  workerError = false,
} = {}) {
  const operations = [];

  const db = {
    operations,

    from(table) {
      return {
        select() {
          return this;
        },

        eq() {
          return this;
        },

        in() {
          return this;
        },

        order() {
          return this;
        },

        async range() {
          operations.push({
            type: 'read',
            table,
          });

          if (table === 'invoices') {
            return {
              data: [{
                id: DELETE_INVOICE_ID,
                file_url: null,
              }],
              error: null,
            };
          }

          if (table === 'invoice_files') {
            return {
              data: [],
              error: null,
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        },

        async single() {
          if (table !== 'invoice_calculation_jobs') {
            throw new Error(`Unexpected single(): ${table}`);
          }

          return {
            data: {
              generation: 2,
              completed_generation: 2,
              last_error: null,
            },
            error: null,
          };
        },
      };
    },

    async rpc(name, args) {
      operations.push({
        type: 'rpc',
        name,
        args,
      });

      assert.equal(
        name,
        'delete_invoices_transactional'
      );

      if (rpcError) {
        return {
          data: null,
          error: {
            message: rpcError,
          },
        };
      }

      return {
        data: {
          success: true,
          deleted: 1,
          lines_deleted: 1,
          ingredient_ids: [],
          calculations_queued: queued,
        },
        error: null,
      };
    },

    storage: {
      from() {
        return {
          async remove() {
            operations.push({
              type: 'storage_cleanup',
            });

            return {
              error: null,
            };
          },
        };
      },
    },
  };

  const effects = [];

  const deps = {
    db,

    effects,

    verifyAccess: async () => ({
      error: null,
      status: 200,
    }),

    getMatchingControl: async () => ({
      status: 'legacy_enabled',
      matching_enabled: true,
      is_locked: false,
    }),

    processCalculations: async () => {
      effects.push('calculations');

      if (workerError) {
        throw new Error(
          'Simulated calculation worker failure'
        );
      }

      return {
        skipped: false,
        errors: [],
      };
    },
  };

  return {
    db,
    deps,
    operations,
    effects,
  };
}

function deletionRequest() {
  return {
    method: 'POST',
    body: {
      restaurant_id: DELETE_RESTAURANT_ID,
      invoice_ids: [DELETE_INVOICE_ID],
    },
  };
}

test(
  'locked invoice deletion uses transaction without calculations',
  async () => {
    const setup = transactionalDeletionMock({
      queued: false,
    });

    setup.deps.getMatchingControl = async () => ({
      status: 'locked',
      matching_enabled: false,
      is_locked: true,
    });

    const res = response();

    await createDeleteInvoiceHandler(
      setup.deps
    )(deletionRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.deleted, 1);

    assert.equal(
      res.body.calculations_queued,
      false
    );

    assert.deepEqual(
      setup.effects,
      []
    );

    const rpc = setup.operations.find(
      operation => operation.type === 'rpc'
    );

    assert.ok(rpc);

    assert.equal(
      rpc.args.p_queue_calculations,
      false
    );

    assert.equal(
      setup.operations.some(
        operation => operation.type === 'delete'
      ),
      false
    );
  }
);

test(
  'enabled invoice deletion uses transactional RPC and processes calculations',
  async () => {
    const setup = transactionalDeletionMock();

    const res = response();

    await createDeleteInvoiceHandler(
      setup.deps
    )(deletionRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    assert.equal(
      res.body.calculations_queued,
      true
    );

    assert.equal(
      res.body.calculations_pending,
      false
    );

    assert.deepEqual(
      setup.effects,
      ['calculations']
    );

    const rpc = setup.operations.find(
      operation => operation.type === 'rpc'
    );

    assert.ok(rpc);

    assert.deepEqual(
      rpc.args,
      {
        p_restaurant_id: DELETE_RESTAURANT_ID,
        p_invoice_ids: [DELETE_INVOICE_ID],
        p_queue_calculations: true,
      }
    );
  }
);

test(
  'failed deletion transaction never schedules calculations',
  async () => {
    const setup = transactionalDeletionMock({
      rpcError: 'Simulated transaction rollback',
    });

    const res = response();

    await createDeleteInvoiceHandler(
      setup.deps
    )(deletionRequest(), res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);

    assert.deepEqual(
      setup.effects,
      []
    );

    assert.equal(
      setup.operations.some(
        operation =>
          operation.type === 'storage_cleanup'
      ),
      false
    );
  }
);

test(
  'failed calculation worker preserves deletion and pending recovery',
  async () => {
    const setup = transactionalDeletionMock({
      workerError: true,
    });

    const res = response();

    await createDeleteInvoiceHandler(
      setup.deps
    )(deletionRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    assert.equal(
      res.body.calculations_queued,
      true
    );

    assert.equal(
      res.body.calculations_pending,
      true
    );

    assert.equal(
      setup.effects.length,
      1
    );

    assert.match(
      res.body.calculation_errors[0],
      /Simulated calculation worker failure/
    );
  }
);

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

test('authenticated repricing runs after first-time invoice linking', async () => {
  const previousFlag = process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;

  const previousRestaurant =
    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;

  process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
    restaurantId;

  process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = 'true';

  try {
    const db = mockDatabase([
      {
        table: 'invoice_items',
        data: {
          id: 'line-1',
          unit: 'oz',
          unit_cost: 0.5,
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
          name: 'Blueberries',
          unit: 'oz',
          last_ordered_at: null,
        },
      },
      {
        table: 'invoice_items',
        action: 'update',
        data: [{ id: 'line-1' }],
      },
    ]);

    const deps = enabledDependencies(db);
    const authenticatedCalls = [];

    const handler = createLinkInvoiceItemHandler({
      ...deps,
      repriceAuthenticated: async (...args) => {
        authenticatedCalls.push(args);
      },
    });

    const res = response();

    await handler({
      method: 'POST',
      body: {
        restaurant_id: restaurantId,
        invoice_item_id: 'line-1',
        ingredient_id: 'ingredient-1',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.moved, 1);

    assert.equal(authenticatedCalls.length, 1);

    assert.equal(authenticatedCalls[0][0], db);
    assert.equal(authenticatedCalls[0][1], restaurantId);
    assert.equal(authenticatedCalls[0][2], 'ingredient-1');

    assert.deepEqual(
      deps.effects.map(effect => effect.type),
      ['recompute', 'rebuild']
    );

    assert.equal(
      db.operations.filter(op =>
        op.table === 'invoice_items' &&
        op.action === 'update'
      ).length,
      1
    );
  } finally {
    if (previousFlag === undefined) {
      delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = previousFlag;
    }
    if (previousRestaurant === undefined) {
      delete process.env
        .INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
        previousRestaurant;
    }
  }
});

test('authenticated repricing recalculates both ingredients after relinking', async () => {
  const previousFlag = process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;

  const previousRestaurant =
    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;

  process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
    restaurantId;

  process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = 'true';

  try {
    const db = mockDatabase([
      {
        table: 'invoice_items',
        data: {
          id: 'line-1',
          unit: 'oz',
          unit_cost: 0.5,
          ingredient_id: 'ingredient-old',
          invoices: {
            restaurant_id: restaurantId,
            date: '2026-10-01',
          },
        },
      },
      {
        table: 'ingredients',
        data: {
          id: 'ingredient-new',
          name: 'Blueberries',
          unit: 'oz',
          last_ordered_at: null,
        },
      },
      {
        table: 'invoice_items',
        action: 'update',
        data: [{ id: 'line-1' }],
      },
    ]);

    const deps = enabledDependencies(db);
    const authenticatedCalls = [];

    const handler = createLinkInvoiceItemHandler({
      ...deps,
      repriceAuthenticated: async (_db, rid, ingredientId) => {
        authenticatedCalls.push({
          restaurantId: rid,
          ingredientId,
        });
      },
    });

    const res = response();

    await handler({
      method: 'POST',
      body: {
        restaurant_id: restaurantId,
        invoice_item_id: 'line-1',
        ingredient_id: 'ingredient-new',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.moved, 1);

    assert.deepEqual(authenticatedCalls, [
      {
        restaurantId,
        ingredientId: 'ingredient-new',
      },
      {
        restaurantId,
        ingredientId: 'ingredient-old',
      },
    ]);

    const updates = db.operations.filter(
      op => op.action === 'update'
    );

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].values, {
      ingredient_id: 'ingredient-new',
    });

    assert.deepEqual(
      deps.effects.map(effect => effect.type),
      ['recompute', 'rebuild']
    );
  } finally {
    if (previousFlag === undefined) {
      delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = previousFlag;
    }
    if (previousRestaurant === undefined) {
      delete process.env
        .INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
        previousRestaurant;
    }
  }
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

test('admin review saves corrections through the transactional RPC', async () => {
  const calls = [];

  const db = {
    from(table) {
      assert.equal(table, 'invoices');

      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          calls.push({
            type: 'filter',
            column,
            value,
          });
          return query;
        },
        async maybeSingle() {
          return {
            data: { id: 'invoice-1' },
            error: null,
          };
        },
      };

      return query;
    },

    async rpc(name, args) {
      calls.push({
        type: 'rpc',
        name,
        args,
      });

      assert.equal(
        name,
        'save_admin_invoice_review'
      );

      return {
        data: {
          changed: 0,
          relinked: 1,
          restaurantId,
          calculationsPending: true,
        },
        error: null,
      };
    },
  };

  const handler = createSaveInvoiceItemsHandler({
    db,
    getMatchingControl: async () => ({
      matching_enabled: true,
    }),
    processCalculations: async () => ({
      skipped: false,
      errors: [],
    }),
  });

  const res = response();

  await handler({
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
  }, res, {
    user: { id: 'admin-test-1' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.relinked, 1);
  assert.equal(res.body.calculationsPending, true);

  const save = calls.find(
    call => call.type === 'rpc'
  );

  assert.ok(save);

  assert.equal(
    save.name,
    'save_admin_invoice_review'
  );

  assert.equal(
    save.args.p_invoice_id,
    'invoice-1'
  );

  assert.equal(
    save.args.p_admin_id,
    'admin-test-1'
  );

  assert.equal(
    save.args.p_reviewed,
    false
  );

  assert.equal(
    save.args.p_lines.length,
    1
  );

  assert.equal(
    save.args.p_lines[0].ingredient_id,
    'ingredient-new'
  );
});

function createTransactionalReviewDb({
  invoiceExists = true,
  saveError = null,
  onRpc = () => {},
} = {}) {
  const calls = [];

  const db = {
    from(table) {
      calls.push({ type: 'from', table });

      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          calls.push({
            type: 'filter',
            column,
            value,
          });
          return query;
        },
        async maybeSingle() {
          return {
            data: invoiceExists
              ? { id: 'invoice-1' }
              : null,
            error: null,
          };
        },
      };

      return query;
    },

    async rpc(name, args) {
      calls.push({
        type: 'rpc',
        name,
        args,
      });

      onRpc(name, args);

      return {
        data: saveError
          ? null
          : {
              changed: 1,
              relinked: 0,
              restaurantId,
              calculationsPending: true,
            },
        error: saveError
          ? { message: saveError }
          : null,
      };
    },
  };

  return { db, calls };
}

function transactionalReviewRequest() {
  return {
    method: 'POST',
    body: {
      restaurant_id: restaurantId,
      invoice_id: 'invoice-1',
      items: [{
        id: 'line-1',
        quantity: 2,
        unit: 'lb',
        unit_cost: 4,
        amount: 8,
        ingredient_id: 'ingredient-1',
      }],
    },
  };
}

const adminSession = {
  user: { id: 'admin-test-1' },
};

test(
  'failed database transaction does not schedule recalculation',
  async () => {
    const { db, calls } = createTransactionalReviewDb({
      saveError: 'Simulated transaction failure',
    });

    let recalculationCalls = 0;

    const handler = createSaveInvoiceItemsHandler({
      db,
      getMatchingControl: async () => ({
        matching_enabled: true,
      }),
      processCalculations: async () => {
        recalculationCalls++;
      },
    });

    const res = response();

    await handler(
      transactionalReviewRequest(),
      res,
      adminSession
    );

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(recalculationCalls, 0);

    assert.equal(
      calls.filter(call => call.type === 'rpc').length,
      1
    );

    assert.equal(
      calls.some(call =>
        call.type === 'from' &&
        call.table === 'invoice_items'
      ),
      false
    );
  }
);

test(
  'successful transaction remains successful if scheduling fails',
  async () => {
    const { db, calls } = createTransactionalReviewDb();

    const handler = createSaveInvoiceItemsHandler({
      db,
      getMatchingControl: async () => ({
        matching_enabled: true,
      }),
      processCalculations: async () => {
        throw new Error(
          'Simulated calculation worker failure'
        );
      },
    });

    const res = response();

    await handler(
      transactionalReviewRequest(),
      res,
      adminSession
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.calculationsPending, true);

    assert.equal(
      calls.filter(call =>
        call.type === 'rpc' &&
        call.name === 'save_admin_invoice_review'
      ).length,
      1
    );
  }
);

test(
  'foreign restaurant invoice cannot reach correction RPC',
  async () => {
    const { db, calls } = createTransactionalReviewDb({
      invoiceExists: false,
    });

    let recalculationCalls = 0;

    const handler = createSaveInvoiceItemsHandler({
      db,
      getMatchingControl: async () => ({
        matching_enabled: true,
      }),
      processCalculations: async () => {
        recalculationCalls++;
      },
    });

    const res = response();

    await handler(
      transactionalReviewRequest(),
      res,
      adminSession
    );

    assert.equal(res.statusCode, 404);
    assert.equal(recalculationCalls, 0);

    assert.equal(
      calls.some(call => call.type === 'rpc'),
      false
    );

    assert.ok(
      calls.some(call =>
        call.type === 'filter' &&
        call.column === 'restaurant_id' &&
        call.value === restaurantId
      )
    );
  }
);

test(
  'legacy first-time linking respects delivery timing and manual approvals',
  async () => {
    const previousFlag =
      process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;

    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = 'false';

    try {
      const scenarios = [
        {
          name: 'delivery date wins over older invoice date',
          invoiceDate: '2026-10-01',
          deliveryDate: '2026-11-11',
          currentDate: '2026-11-10',
          expectedWrites: 1,
          expectedPurchaseDate: '2026-11-11',
        },
        {
          name: 'future delivery cannot update current price',
          invoiceDate: '2026-11-11',
          deliveryDate: '2999-12-31',
          currentDate: '2026-11-10',
          expectedWrites: 0,
        },
        {
          name: 'unknown dates cannot invent a purchase date',
          invoiceDate: null,
          deliveryDate: null,
          currentDate: null,
          expectedWrites: 0,
        },
        {
          name: 'missing delivery date uses invoice date',
          invoiceDate: '2026-11-10',
          deliveryDate: null,
          currentDate: '2026-11-09',
          expectedWrites: 1,
          expectedPurchaseDate: '2026-11-10',
        },
        {
          name: 'older delivery cannot replace newer purchase',
          invoiceDate: '2026-11-11',
          deliveryDate: '2026-11-09',
          currentDate: '2026-11-10',
          expectedWrites: 0,
        },
        {
          name: 'manual approval cannot be overwritten',
          invoiceDate: '2026-11-10',
          deliveryDate: '2026-11-11',
          currentDate: null,
          manual: true,
          expectedWrites: 0,
        },
      ];

      for (const scenario of scenarios) {
        const responses = [
          {
            table: 'invoice_items',
            data: {
              id: 'delivery-link-line',
              unit: 'each',
              unit_cost: 5,
              ingredient_id: null,
              price_verification_status: 'verified',
              price_verification_source: 'trusted_supplier',
              price_verified_at: '2026-11-01T12:00:00Z',
              price_verification_evidence: {
                supplier: 'Synthetic Development Supplier',
                verification: 'supplier_document',
              },
              invoices: {
                restaurant_id: restaurantId,
                date: scenario.invoiceDate,
                delivery_date: scenario.deliveryDate,
              },
            },
          },
          {
            table: 'ingredients',
            data: {
              id: 'delivery-link-ingredient',
              name: 'Synthetic Test Ingredient',
              unit: 'each',
              last_ordered_at: scenario.currentDate,
              price_status: scenario.manual ? 'manual' : 'invoice',
              price_approved_at: scenario.manual
                ? '2026-11-01T12:00:00Z'
                : null,
            },
          },
          {
            table: 'invoice_items',
            action: 'update',
            data: [{ id: 'delivery-link-line' }],
          },
        ];

        if (scenario.expectedWrites === 1) {
          responses.push({
            table: 'ingredients',
            action: 'update',
            data: null,
          });
        }

        const db = mockDatabase(responses);
        const deps = enabledDependencies(db);
        const res = response();

        await createLinkInvoiceItemHandler(deps)({
          method: 'POST',
          body: {
            restaurant_id: restaurantId,
            invoice_item_id: 'delivery-link-line',
            ingredient_id: 'delivery-link-ingredient',
          },
        }, res);

        assert.equal(res.statusCode, 200, scenario.name);
        assert.equal(res.body.moved, 1, scenario.name);

        const priceUpdates = db.operations.filter(op =>
          op.table === 'ingredients' &&
          op.action === 'update'
        );

        assert.equal(
          priceUpdates.length,
          scenario.expectedWrites,
          scenario.name
        );

        if (scenario.expectedWrites === 1) {
          assert.equal(
            priceUpdates[0].values.last_ordered_at,
            scenario.expectedPurchaseDate,
            scenario.name
          );

          assert.equal(
            priceUpdates[0].values.last_price,
            5,
            scenario.name
          );

          assert.equal(
            priceUpdates[0].values.unit,
            'each',
            scenario.name
          );
        }

        const lineUpdates = db.operations.filter(op =>
          op.table === 'invoice_items' &&
          op.action === 'update'
        );

        assert.equal(lineUpdates.length, 1, scenario.name);
        assert.deepEqual(
          lineUpdates[0].values,
          { ingredient_id: 'delivery-link-ingredient' },
          scenario.name
        );
      }
    } finally {
      if (previousFlag === undefined) {
        delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
      } else {
        process.env.INVOICE_SUPPORTED_REPRICING_ENABLED =
          previousFlag;
      }
    }
  }
);