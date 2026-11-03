
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createConfirmInvoiceHandler,
} from '../pages/api/invoices/confirm-invoice.js';

import {
  resolveInvoiceResearchCost,
} from '../lib/invoiceResearchCosting.js';

test('unverified numbered can cannot overwrite existing price', async () => {
  const writes = [];
  let researchCalls = 0;

  const db = {
    from(table) {
      const state = { table, operation: null };

      const query = {
        insert(rows) {
          state.operation = 'insert';
          writes.push({ table, operation: 'insert', rows });
          return query;
        },
        update(rows) {
          state.operation = 'update';
          writes.push({ table, operation: 'update', rows });
          return query;
        },
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        limit() { return query; },
        order() { return query; },
        single() {
          if (table === 'invoices') {
            return Promise.resolve({
              data: { id: 'invoice-test-1' },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve, reject) {
          const response = { data: [], error: null };
          return Promise.resolve(response).then(resolve, reject);
        },
      };

      return query;
    },
  };

  const handler = createConfirmInvoiceHandler({
    db,
    verifyAccess: async () => ({ error: null }),
    resolveCost: async (item, supplier, options) => {
      researchCalls++;
      return resolveInvoiceResearchCost(item, supplier, {
        ...options,
        enabled: false,
      });
    },
    recompute: async () => ({ updated: 0, blocked: [] }),
    rebuild: async () => {},
  });

  const req = {
    method: 'POST',
    headers: {},
    body: {
      restaurant_id: 'restaurant-test-1',
      invoice: {
        supplier: 'Example Distributor',
        invoice_number: 'TEST-001',
        invoice_date: '2026-10-27',
        total_amount: 50.78,
      },
      line_items: [{
        _id: 'line-test-1',
        item_name: 'Strawberry Glaze',
        selected_ingredient_id: 'ingredient-test-1',
        selected_ingredient_name: 'Strawberry Glaze',
        match_status: 'matched',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      }],
    },
  };

  const res = {
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

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(researchCalls, 1);

  const ingredientUpdates = writes.filter(
    write =>
      write.table === 'ingredients' &&
      write.operation === 'update'
  );

  assert.equal(
    ingredientUpdates.length,
    0,
    'Unverified packaging must not overwrite ingredient prices'
  );

  const invoiceWrite = writes.find(
    write => write.table === 'invoice_items'
  );

  assert.ok(invoiceWrite);

  const savedItem = invoiceWrite.rows[0];

  assert.equal(savedItem.quantity, 3);
  assert.equal(savedItem.unit, 'can');
  assert.equal(savedItem.unit_cost, null);
  assert.equal(savedItem.amount, 50.78);
  assert.equal(
    savedItem.ingredient_id,
    'ingredient-test-1'
  );
});


test('new unverified numbered-can ingredient has no fabricated price', async () => {
  const writes = [];

  const db = {
    from(table) {
      const state = { operation: null, rows: null };

      const query = {
        insert(rows) {
          state.operation = 'insert';
          state.rows = rows;
          writes.push({ table, operation: 'insert', rows });
          return query;
        },
        update(rows) {
          writes.push({ table, operation: 'update', rows });
          return query;
        },
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        limit() { return query; },
        order() { return query; },
        single() {
          return Promise.resolve({
            data: { id: 'invoice-test-2' },
            error: null,
          });
        },
        then(resolve, reject) {
          const data =
            table === 'ingredients' &&
            state.operation === 'insert'
              ? state.rows.map((row, index) => ({
                  id: `ingredient-new-${index + 1}`,
                  name: row.name,
                }))
              : [];

          return Promise.resolve({
            data,
            error: null,
          }).then(resolve, reject);
        },
      };

      return query;
    },
  };

  const handler = createConfirmInvoiceHandler({
    db,
    verifyAccess: async () => ({ error: null }),
    resolveCost: async (item, supplier) =>
      resolveInvoiceResearchCost(item, supplier, {
        enabled: false,
      }),
    recompute: async () => ({ updated: 0, blocked: [] }),
    rebuild: async () => {},
  });

  const req = {
    method: 'POST',
    headers: {},
    body: {
      restaurant_id: 'restaurant-test-1',
      invoice: {
        supplier: 'Example Distributor',
        invoice_number: 'TEST-002',
        invoice_date: '2026-10-27',
        total_amount: 50.78,
      },
      line_items: [{
        _id: 'new-line-1',
        item_name: 'Strawberry Glaze',
        match_status: 'new',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      }],
    },
  };

  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() { return this; },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.ingredients_created, 1);

  const ingredientWrite = writes.find(
    w => w.table === 'ingredients' &&
      w.operation === 'insert'
  );

  assert.ok(ingredientWrite);

  const ingredient = ingredientWrite.rows[0];

  assert.equal(ingredient.name, 'Strawberry Glaze');
  assert.equal(ingredient.last_price, null);
  assert.equal(ingredient.unit, 'can');
  assert.equal(ingredient.standard_unit, 'can');
  assert.equal(ingredient.ingredient_category, 'count');
  assert.equal(ingredient.is_estimated, true);

  const invoiceWrite = writes.find(
    w => w.table === 'invoice_items'
  );

  assert.ok(invoiceWrite);

  const line = invoiceWrite.rows[0];

  assert.equal(line.quantity, 3);
  assert.equal(line.unit, 'can');
  assert.equal(line.unit_cost, null);
  assert.equal(line.amount, 50.78);
  assert.equal(line.ingredient_id, 'ingredient-new-1');

  const priceUpdates = writes.filter(
    w => w.table === 'ingredients' &&
      w.operation === 'update'
  );

  assert.equal(priceUpdates.length, 0);
});


test('verified numbered-can pricing agrees across ingredient and invoice history', async () => {
  const writes = [];

  const db = {
    from(table) {
      const state = { operation: null };

      const query = {
        insert(rows) {
          state.operation = 'insert';
          writes.push({ table, operation: 'insert', rows });
          return query;
        },
        update(rows) {
          state.operation = 'update';
          writes.push({ table, operation: 'update', rows });
          return query;
        },
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        limit() { return query; },
        order() { return query; },
        single() {
          return Promise.resolve({
            data: { id: 'invoice-test-3' },
            error: null,
          });
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: [],
            error: null,
          }).then(resolve, reject);
        },
      };

      return query;
    },
  };

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

  const handler = createConfirmInvoiceHandler({
    db,
    verifyAccess: async () => ({ error: null }),
    resolveCost: async (item, supplier) =>
      resolveInvoiceResearchCost(item, supplier, {
        enabled: true,
        researchProduct: async () => verifiedResult,
      }),
    recompute: async () => ({ updated: 0, blocked: [] }),
    rebuild: async () => {},
  });

  const req = {
    method: 'POST',
    headers: {},
    body: {
      restaurant_id: 'restaurant-test-1',
      invoice: {
        supplier: 'Example Distributor',
        invoice_number: 'TEST-003',
        invoice_date: '2026-10-27',
        total_amount: 50.78,
      },
      line_items: [{
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
      }],
    },
  };

  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() { return this; },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  const ingredientUpdate = writes.find(
    w => w.table === 'ingredients' &&
      w.operation === 'update'
  );

  assert.ok(ingredientUpdate);

  const invoiceWrite = writes.find(
    w => w.table === 'invoice_items'
  );

  assert.ok(invoiceWrite);

  const line = invoiceWrite.rows[0];

  assert.equal(line.quantity, 312);
  assert.equal(line.unit, 'oz');
  assert.ok(
    Math.abs(line.unit_cost - 50.78 / 312) < 1e-10
  );

  // The ingredient's standard price and the invoice's
  // per-unit price must agree for an ounce-based product.
  assert.equal(ingredientUpdate.rows.unit, 'oz');
  assert.ok(
    Math.abs(
      ingredientUpdate.rows.last_price - line.unit_cost
    ) < 1e-10
  );
});


test('ordinary invoice products retain correct ingredient and invoice pricing', async () => {
  const writes = [];

  const db = {
    from(table) {
      const state = { operation: null };

      const query = {
        insert(rows) {
          state.operation = 'insert';
          writes.push({ table, operation: 'insert', rows });
          return query;
        },
        update(rows) {
          state.operation = 'update';
          writes.push({ table, operation: 'update', rows });
          return query;
        },
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        limit() { return query; },
        order() { return query; },
        single() {
          return Promise.resolve({
            data: { id: 'invoice-test-4' },
            error: null,
          });
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: [],
            error: null,
          }).then(resolve, reject);
        },
      };

      return query;
    },
  };

  let researchCalls = 0;

  const handler = createConfirmInvoiceHandler({
    db,
    verifyAccess: async () => ({ error: null }),
    resolveCost: async (item, supplier) =>
      resolveInvoiceResearchCost(item, supplier, {
        enabled: true,
        researchProduct: async () => {
          researchCalls++;
          throw new Error(
            'Ordinary products must not trigger research'
          );
        },
      }),
    recompute: async () => ({ updated: 0, blocked: [] }),
    rebuild: async () => {},
  });

  const req = {
    method: 'POST',
    headers: {},
    body: {
      restaurant_id: 'restaurant-test-1',
      invoice: {
        supplier: 'Example Distributor',
        invoice_number: 'TEST-004',
        invoice_date: '2026-10-27',
        total_amount: 40,
      },
      line_items: [{
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
      }],
    },
  };

  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() { return this; },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(researchCalls, 0);

  const ingredientUpdate = writes.find(
    w => w.table === 'ingredients' &&
      w.operation === 'update'
  );

  assert.ok(ingredientUpdate);
  assert.equal(ingredientUpdate.rows.last_price, 0.25);
  assert.equal(ingredientUpdate.rows.unit, 'oz');
  assert.equal(ingredientUpdate.rows.standard_unit, 'oz');

  const invoiceWrite = writes.find(
    w => w.table === 'invoice_items'
  );

  assert.ok(invoiceWrite);

  const line = invoiceWrite.rows[0];

  assert.equal(line.quantity, 10);
  assert.equal(line.unit, 'lb');
  assert.equal(line.unit_cost, 4);
  assert.equal(line.amount, 40);
});
