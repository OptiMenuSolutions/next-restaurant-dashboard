import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createResolveConflictHandler,
} from '../pages/api/admin/invoice-review/resolve-conflict.js';

const RESTAURANT_ID = 'c351e658-0b69-4175-9bec-04a9d8eeb8da';
const ITEM_ID = '0a6219e8-76ff-4c80-81f2-d71748886cda';
const INGREDIENT_ID = '9fb236c6-f282-480d-977e-b8ea00958b26';

const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalSaveFlag = process.env.INVOICE_CONFLICT_SAVE_ENABLED;

process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-signing-key';
process.env.INVOICE_CONFLICT_SAVE_ENABLED = 'true';

function createMockDb({
  supplier = 'Harborline Foodservice',
  ingredientId = null,
} = {}) {
  const calls = [];

  const db = {
    calls,

    from(table) {
      const filters = [];

      const query = {
        select() {
          return query;
        },

        eq(column, value) {
          filters.push({ column, value });
          return query;
        },

        in(column, values) {
          filters.push({ column, values });
          return query;
        },

        async maybeSingle() {
          if (table === 'restaurants') {
            return {
              data: {
                id: RESTAURANT_ID,
                name: 'OptiMenu Test Kitchen - Photo',
              },
              error: null,
            };
          }

          if (table === 'invoice_ingredient_mappings') {
            return {
              data: null,
              error: null,
            };
          }

          throw new Error(`Unexpected maybeSingle: ${table}`);
        },

        then(resolve, reject) {
          let data;

          if (table === 'ingredients') {
            data = [{
              id: INGREDIENT_ID,
              name: 'All-purpose flour',
            }];
          } else if (table === 'invoice_items') {
            data = [{
              id: ITEM_ID,
              invoice_id: 'invoice-test-1',
              item_name: 'Cheddar Cheese Block',
              ingredient_name_normalized: 'cheddar cheese block',
              ingredient_id: ingredientId,
              invoices: {
                id: 'invoice-test-1',
                restaurant_id: RESTAURANT_ID,
                supplier,
                number: 'TEST-001',
                date: '2026-11-05',
                is_sample: false,
              },
            }];
          } else {
            throw new Error(`Unexpected table query: ${table}`);
          }

          return Promise.resolve({
            data,
            error: null,
          }).then(resolve, reject);
        },
      };

      return query;
    },

    async rpc(name, args) {
      calls.push({ name, args });

      return {
        data: {
          calculationsPending: false,
        },
        error: null,
      };
    },
  };

  return db;
}

function response() {
  return {
    statusCode: 200,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request(action, overrides = {}) {
  return {
    method: 'POST',
    body: {
      action,
      restaurant_id: RESTAURANT_ID,
      supplier: 'Harborline Foodservice',
      product_description: 'Cheddar Cheese Block',
      changes: [{
        invoice_item_id: ITEM_ID,
        expected_ingredient_id: null,
        ingredient_id: INGREDIENT_ID,
      }],
      approve_future: false,
      future_ingredient_id: null,
      expected_mapping_updated_at: null,
      ...overrides,
    },
  };
}

function handlerFor(db, {
  administrator = 'admin-test-1',
} = {}) {
  return createResolveConflictHandler({
    db,

    requireAdmin: async () => ({
      user: { id: administrator },
      name: 'Test Administrator',
    }),

    getMatchingPolicy: async () => ({
      matching_enabled: true,
    }),

    saveAuditLog: async () => {},

    scheduleWork: () => {},

    processCalculations: async () => {},
  });
}

test('1. Preview returns proposed changes without saving', async () => {
  const db = createMockDb();
  const handler = handlerFor(db);
  const res = response();

  await handler(request('preview'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.preview, true);
  assert.equal(res.body.saved, false);

  assert.equal(res.body.summary.selected, 1);
  assert.equal(res.body.summary.changed, 1);
  assert.equal(res.body.summary.newly_linked, 1);

  assert.equal(typeof res.body.confirmation_token, 'string');

  assert.equal(
    db.calls.length,
    0,
    'Preview must not invoke a database mutation RPC'
  );
});

test('2. Save without confirmation token is rejected', async () => {
  const db = createMockDb();
  const handler = handlerFor(db);
  const res = response();

  await handler(request('save'), res);

  assert.equal(res.statusCode, 409);
  assert.equal(db.calls.length, 0);
});

test('3. Invoice lines from another supplier are rejected', async () => {
  const db = createMockDb({
    supplier: 'Another Foodservice Supplier',
  });

  const handler = handlerFor(db);
  const res = response();

  await handler(request('preview'), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /different supplier/i);

  assert.equal(db.calls.length, 0);
});

test('4. Stale invoice relationships are rejected', async () => {
  const db = createMockDb({
    ingredientId: INGREDIENT_ID,
  });

  const handler = handlerFor(db);
  const res = response();

  await handler(request('preview'), res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /changed since review/i);

  assert.equal(db.calls.length, 0);
});

// =========================================================
// TEST 23D: CONFIRMED SAVE AND RECALCULATION
// =========================================================

function createSaveTestEnvironment({
  calculationsPending = false,
  saveError = null,
} = {}) {
  const db = createMockDb();
  const auditCalls = [];
  const scheduledWork = [];
  const calculationCalls = [];

  db.rpc = async (name, args) => {
    db.calls.push({ name, args });

    return {
      data: saveError
        ? null
        : {
            calculationsPending,
            corrected: 1,
          },
      error: saveError,
    };
  };

  const handler = createResolveConflictHandler({
    db,

    requireAdmin: async () => ({
      user: { id: 'admin-test-1' },
      name: 'Test Administrator',
    }),

    getMatchingPolicy: async () => ({
      matching_enabled: true,
    }),

    saveAuditLog: async entry => {
      auditCalls.push(entry);
    },

    scheduleWork: promise => {
      scheduledWork.push(promise);
    },

    processCalculations: async (
      database,
      restaurantId
    ) => {
      calculationCalls.push({
        database,
        restaurantId,
      });
    },
  });

  return {
    db,
    handler,
    auditCalls,
    scheduledWork,
    calculationCalls,
  };
}

async function getPreviewToken(handler) {
  const res = response();

  await handler(request('preview'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.preview, true);
  assert.equal(typeof res.body.confirmation_token, 'string');

  return res.body.confirmation_token;
}

test(
  '5. Confirmed save invokes the correct database resolution',
  async () => {
    const env = createSaveTestEnvironment();

    const token = await getPreviewToken(env.handler);

    const res = response();

    await env.handler(
      request('save', {
        confirmation_token: token,
      }),
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.saved, true);

    assert.equal(env.db.calls.length, 1);

    const call = env.db.calls[0];

    assert.equal(
      call.name,
      'resolve_invoice_ingredient_conflict'
    );

    assert.equal(
      call.args.p_restaurant_id,
      RESTAURANT_ID
    );

    assert.equal(
      call.args.p_supplier,
      'Harborline Foodservice'
    );

    assert.equal(
      call.args.p_product_description,
      'Cheddar Cheese Block'
    );

    assert.equal(
      call.args.p_admin_id,
      'admin-test-1'
    );

    assert.equal(
      call.args.p_approve_future,
      false
    );

    assert.equal(
      call.args.p_future_ingredient_id,
      null
    );

    assert.equal(
      call.args.p_expected_mapping_updated_at,
      null
    );

    assert.deepEqual(
      call.args.p_changes,
      request('save').body.changes
    );
  }
);

test(
  '6. Changed mapping version invalidates confirmation',
  async () => {
    const env = createSaveTestEnvironment();

    const token = await getPreviewToken(env.handler);

    const res = response();

    await env.handler(
      request('save', {
        confirmation_token: token,
        expected_mapping_updated_at:
          '2026-11-05T12:00:00Z',
      }),
      res
    );

    assert.equal(res.statusCode, 409);
    assert.equal(env.db.calls.length, 0);
    assert.equal(env.auditCalls.length, 0);
  }
);

test(
  '7. Database stale-mapping conflict returns HTTP 409',
  async () => {
    const env = createSaveTestEnvironment({
      saveError: {
        message: 'Mapping changed since preview. Reload before saving.',
      },
    });

    const token = await getPreviewToken(env.handler);

    const res = response();

    await env.handler(
      request('save', {
        confirmation_token: token,
      }),
      res
    );

    assert.equal(res.statusCode, 409);

    assert.match(
      res.body.error,
      /changed since preview/i
    );

    assert.equal(env.db.calls.length, 1);
    assert.equal(env.auditCalls.length, 0);
    assert.equal(env.scheduledWork.length, 0);
  }
);

test(
  '8. Recalculation runs only when database requests it',
  async () => {
    const noRecalculation =
      createSaveTestEnvironment({
        calculationsPending: false,
      });

    const tokenA =
      await getPreviewToken(noRecalculation.handler);

    const resA = response();

    await noRecalculation.handler(
      request('save', {
        confirmation_token: tokenA,
      }),
      resA
    );

    assert.equal(resA.statusCode, 200);

    assert.equal(
      noRecalculation.scheduledWork.length,
      0
    );

    assert.equal(
      noRecalculation.calculationCalls.length,
      0
    );

    const withRecalculation =
      createSaveTestEnvironment({
        calculationsPending: true,
      });

    const tokenB =
      await getPreviewToken(withRecalculation.handler);

    const resB = response();

    await withRecalculation.handler(
      request('save', {
        confirmation_token: tokenB,
      }),
      resB
    );

    assert.equal(resB.statusCode, 200);

    assert.equal(
      withRecalculation.scheduledWork.length,
      1
    );

    await Promise.all(
      withRecalculation.scheduledWork
    );

    assert.equal(
      withRecalculation.calculationCalls.length,
      1
    );

    assert.equal(
      withRecalculation.calculationCalls[0].restaurantId,
      RESTAURANT_ID
    );

    assert.equal(
      withRecalculation.calculationCalls[0].database,
      withRecalculation.db
    );
  }
);

test(
  '9. Successful save creates administrator audit entry',
  async () => {
    const env = createSaveTestEnvironment();

    const token = await getPreviewToken(env.handler);

    const res = response();

    await env.handler(
      request('save', {
        confirmation_token: token,
      }),
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(env.auditCalls.length, 1);

    const audit = env.auditCalls[0];

    assert.equal(
      audit.admin_id,
      'admin-test-1'
    );

    assert.equal(
      audit.target_restaurant_id,
      RESTAURANT_ID
    );

    assert.equal(
      audit.action,
      'Resolved invoice ingredient conflict'
    );

    assert.equal(
      audit.metadata.product_description,
      'Cheddar Cheese Block'
    );

    assert.deepEqual(
      audit.metadata.changes,
      request('save').body.changes
    );

    assert.equal(
      audit.metadata.result.corrected,
      1
    );
  }
);

test.after(() => {
  if (originalKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }

  if (originalSaveFlag === undefined) {
    delete process.env.INVOICE_CONFLICT_SAVE_ENABLED;
  } else {
    process.env.INVOICE_CONFLICT_SAVE_ENABLED = originalSaveFlag;
  }
});