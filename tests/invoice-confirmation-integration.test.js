
import test from 'node:test';
import assert from 'node:assert/strict';

import { createConfirmInvoiceHandler } from '../pages/api/invoices/confirm-invoice.js';
import { resolveInvoiceResearchCost } from '../lib/invoiceResearchCosting.js';

const RESTAURANT_ID = 'restaurant-test-1';

function createDb({
  status = 'legacy_enabled',
  ownedIngredients = {},
  matchingControlError = null,
} = {}) {
  const writes = [];

  const db = {
    from(table) {
      const state = {
        operation: null,
        rows: null,
        filters: [],
      };

      const query = {
        insert(rows) {
          state.operation = 'insert';
          state.rows = rows;
          writes.push({ table, operation: 'insert', rows });
          return query;
        },

        update(rows) {
          state.operation = 'update';
          state.rows = rows;
          writes.push({ table, operation: 'update', rows });
          return query;
        },

        select() {
          return query;
        },

        eq(column, value) {
          state.filters.push({ column, value });
          return query;
        },

        in(column, values) {
          state.filters.push({ column, values });
          return query;
        },

        limit() {
          return query;
        },

        order() {
          return query;
        },

        maybeSingle() {
          if (table === 'restaurant_invoice_matching_controls') {
            if (matchingControlError) {
              return Promise.resolve({
                data: null,
                error: matchingControlError,
              });
            }

            return Promise.resolve({
              data: {
                restaurant_id: RESTAURANT_ID,
                status,
              },
              error: null,
            });
          }

          return Promise.resolve({
            data: null,
            error: null,
          });
        },

        single() {
          if (
            table === 'invoices' &&
            state.operation === 'insert'
          ) {
            return Promise.resolve({
              data: { id: 'invoice-test-1' },
              error: null,
            });
          }

          if (table === 'ingredients') {
            const id = state.filters.find(
              f => f.column === 'id'
            )?.value;

            const name = ownedIngredients[id];

            return Promise.resolve({
              data: name ? { name } : null,
              error: name
                ? null
                : { message: 'Ingredient not found' },
            });
          }

          return Promise.resolve({
            data: null,
            error: null,
          });
        },

        then(resolve, reject) {
          let data = [];

          if (
            table === 'ingredients' &&
            state.operation === null
          ) {
            const requested = state.filters.find(
              f => f.column === 'id' && f.values
            )?.values;

            if (requested) {
              data = requested
                .filter(id =>
                  Object.hasOwn(ownedIngredients, id)
                )
                .map(id => ({ id }));
            } else {
              data = Object.keys(ownedIngredients).map(
                id => ({
                  id,
                  last_ordered_at: null,
                })
              );
            }
          }

          return Promise.resolve({
            data,
            error: null,
          }).then(resolve, reject);
        },
      };

      return query;
    },
  };

  return { db, writes };
}

function createRequest({ number, item }) {
  return {
    method: 'POST',
    headers: {},
    body: {
      restaurant_id: RESTAURANT_ID,
      invoice: {
        supplier: 'Example Distributor',
        invoice_number: number,
        invoice_date: '2026-10-27',
        total_amount: item.line_total,
      },
      line_items: [item],
    },
  };
}

function createResponse() {
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

    end() {
      return this;
    },
  };
}

function createHandler(
  db,
  resolveCost,
  { recompute, rebuild } = {}
) {
  return createConfirmInvoiceHandler({
    db,
    verifyAccess: async () => ({ error: null }),
    resolveCost,
    recompute:
      recompute ||
      (async () => ({ updated: 0, blocked: [] })),
    rebuild:
      rebuild ||
      (async () => {}),
  });
}

function unverifiedCost(item, supplier, options) {
  return resolveInvoiceResearchCost(item, supplier, {
    ...options,
    enabled: false,
  });
}

// TEST 1
// Unverified numbered-can packaging must not overwrite
// an existing ingredient's verified price.

test(
  'unverified numbered can cannot overwrite existing price',
  async () => {
    const { db, writes } = createDb({
      ownedIngredients: {
        'ingredient-test-1': 'Strawberry Glaze',
      },
    });

    let researchCalls = 0;

    const handler = createHandler(
      db,
      async (...args) => {
        researchCalls++;
        return unverifiedCost(...args);
      }
    );

    const req = createRequest({
      number: 'TEST-001',
      item: {
        _id: 'line-test-1',
        item_name: 'Strawberry Glaze',
        selected_ingredient_id: 'ingredient-test-1',
        selected_ingredient_name: 'Strawberry Glaze',
        match_status: 'matched',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(researchCalls, 1);

    assert.equal(
      writes.filter(
        w =>
          w.table === 'ingredients' &&
          w.operation === 'update'
      ).length,
      0
    );

    assert.equal(
      writes.filter(
        w =>
          w.table === 'ingredients' &&
          w.operation === 'insert'
      ).length,
      0
    );

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 3);
    assert.equal(line.unit, 'can');
    assert.equal(line.unit_cost, null);
    assert.equal(line.amount, 50.78);
    assert.equal(line.ingredient_id, 'ingredient-test-1');
  }
);

// TEST 2
// An unmatched invoice product must remain unlinked.
// Invoice confirmation must never create an ingredient.

test(
  'new unverified numbered-can item remains unlinked and creates no ingredient',
  async () => {
    const { db, writes } = createDb();

    const handler = createHandler(
      db,
      unverifiedCost
    );

    const req = createRequest({
      number: 'TEST-002',
      item: {
        _id: 'new-line-1',
        item_name: 'Strawberry Glaze',
        match_status: 'new',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.ingredients_created, 0);
    assert.equal(res.body.ingredients_updated, 0);

    assert.equal(
      writes.filter(
        w => w.table === 'ingredients'
      ).length,
      0
    );

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 3);
    assert.equal(line.unit, 'can');
    assert.equal(line.unit_cost, null);
    assert.equal(line.amount, 50.78);
    assert.equal(line.ingredient_id, null);
  }
);

// TEST 3
// Verified numbered-can conversion must produce
// consistent invoice and ingredient pricing.

test(
  'verified numbered-can pricing agrees across ingredient and invoice history',
  async () => {
    const { db, writes } = createDb({
      ownedIngredients: {
        'ingredient-test-1': 'Strawberry Glaze',
      },
    });

    const verifiedResult = {
      status: 'verified',
      verificationStatus: 'verified',
      conversionApproved: true,
      sourceConsensus: {
        conversionApproved: true,
      },
      conversion: {
        fromUnit: 'can',
        toUnit: 'oz',
        factor: 104,
        scope: 'per_container',
        basis: 'authenticated_supplier_record',
      },
    };

    const handler = createHandler(
      db,
      (item, supplier) =>
        resolveInvoiceResearchCost(item, supplier, {
          enabled: true,
          researchProduct: async () => verifiedResult,
        })
    );

    const req = createRequest({
      number: 'TEST-003',
      item: {
        _id: 'verified-line-1',
        item_name: 'Strawberry Glaze',
        supplier_sku: 'SUP456',
        brand: 'Example Foods',
        selected_ingredient_id: 'ingredient-test-1',
        selected_ingredient_name: 'Strawberry Glaze',
        match_status: 'matched',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const ingredientUpdate = writes.find(
      w =>
        w.table === 'ingredients' &&
        w.operation === 'update'
    );

    assert.ok(ingredientUpdate);

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 312);
    assert.equal(line.unit, 'oz');

    assert.ok(
      Math.abs(line.unit_cost - 50.78 / 312) < 1e-10
    );

    assert.equal(ingredientUpdate.rows.unit, 'oz');

    assert.ok(
      Math.abs(
        ingredientUpdate.rows.last_price -
        line.unit_cost
      ) < 1e-10
    );

    assert.equal(
      writes.filter(
        w =>
          w.table === 'ingredients' &&
          w.operation === 'insert'
      ).length,
      0
    );
  }
);

// TEST 4
// Ordinary invoice products must retain their
// established unit and pricing calculations.

test(
  'ordinary invoice products retain correct ingredient and invoice pricing',
  async () => {
    const { db, writes } = createDb({
      ownedIngredients: {
        'ingredient-beef-1': 'Ground Beef',
      },
    });

    let researchCalls = 0;

    const handler = createHandler(
      db,
      (item, supplier) =>
        resolveInvoiceResearchCost(item, supplier, {
          enabled: true,
          researchProduct: async () => {
            researchCalls++;
            throw new Error(
              'Ordinary products must not trigger research'
            );
          },
        })
    );

    const req = createRequest({
      number: 'TEST-004',
      item: {
        _id: 'ordinary-line-1',
        item_name: 'Ground Beef',
        selected_ingredient_id: 'ingredient-beef-1',
        selected_ingredient_name: 'Ground Beef',
        match_status: 'matched',
        pack: 2,
        size: 5,
        size_unit: 'lb',
        quantity_shipped: 1,
        invoice_price: 40,
        line_total: 40,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(researchCalls, 0);

    const ingredientUpdate = writes.find(
      w =>
        w.table === 'ingredients' &&
        w.operation === 'update'
    );

    assert.ok(ingredientUpdate);
    assert.equal(ingredientUpdate.rows.last_price, 0.25);
    assert.equal(ingredientUpdate.rows.unit, 'oz');
    assert.equal(ingredientUpdate.rows.standard_unit, 'oz');

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 10);
    assert.equal(line.unit, 'lb');
    assert.equal(line.unit_cost, 4);
    assert.equal(line.amount, 40);
  }
);

// TEST 5
// Locked restaurants may save invoice data but
// cannot create links or modify ingredient pricing.

test(
  'locked restaurant saves invoice lines without ingredient links or pricing updates',
  async () => {
    const { db, writes } = createDb({
      status: 'locked',
      ownedIngredients: {
        'ingredient-beef-1': 'Ground Beef',
      },
    });

    let recomputeCalls = 0;
    let rebuildCalls = 0;

    const handler = createHandler(
      db,
      unverifiedCost,
      {
        recompute: async () => {
          recomputeCalls++;
        },
        rebuild: async () => {
          rebuildCalls++;
        },
      }
    );

    const req = createRequest({
      number: 'TEST-005',
      item: {
        _id: 'locked-line-1',
        item_name: 'Ground Beef',
        selected_ingredient_id: 'ingredient-beef-1',
        selected_ingredient_name: 'Ground Beef',
        match_status: 'matched',
        pack: 2,
        size: 5,
        size_unit: 'lb',
        quantity_shipped: 1,
        invoice_price: 40,
        line_total: 40,
        match_candidates: [
          {
            id: 'ingredient-beef-1',
            name: 'Ground Beef',
          },
        ],
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.ingredient_id, null);
    assert.equal(line.match_candidates, null);

    assert.equal(
      writes.filter(
        w => w.table === 'ingredients'
      ).length,
      0
    );

    assert.equal(recomputeCalls, 0);
    assert.equal(rebuildCalls, 0);
  }
);

// TEST 6
// An ingredient owned by another restaurant must
// be rejected before the invoice is created.

test(
  'ingredient from another restaurant is rejected before invoice creation',
  async () => {
    const { db, writes } = createDb();

    const handler = createHandler(
      db,
      unverifiedCost
    );

    const req = createRequest({
      number: 'TEST-006',
      item: {
        _id: 'foreign-line-1',
        item_name: 'Ground Beef',
        selected_ingredient_id: 'ingredient-other-restaurant',
        match_status: 'matched',
        pack: 2,
        size: 5,
        size_unit: 'lb',
        quantity_shipped: 1,
        invoice_price: 40,
        line_total: 40,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 400);

    assert.match(
      res.body.error,
      /does not belong to this restaurant/i
    );

    assert.equal(writes.length, 0);
  }
);
