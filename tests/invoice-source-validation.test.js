import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateInvoiceAgainstSource,
} from '../lib/invoiceSourceValidation.js';

function sourceTable(rows) {
  return `
    <table>
      <thead>
        <tr>
          <th>ITEM#</th>
          <th>ORD</th>
          <th>SHIP</th>
          <th>PACK</th>
          <th>SIZE</th>
          <th>BRAND</th>
          <th>DESCRIPTION</th>
          <th>UNIT $</th>
          <th>EXTENDED</th>
        </tr>
      </thead>
      ${rows.map(row => `
        <tr>
          <td>${row.id}</td>
          <td>${row.shipped}</td>
          <td>${row.shipped}</td>
          <td>${row.pack}</td>
          <td>${row.size}</td>
          <td>TEST BRAND</td>
          <td>${row.description}</td>
          <td>${row.price}</td>
          <td>${row.extended}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

function item(overrides = {}) {
  return {
    item_name_raw: 'PRODUCT A',
    item_name_normalized: 'Product A',
    quantity_shipped: 4,
    pack: 1,
    size: 1,
    size_unit: 'each',
    pack_size_raw: null,
    invoice_price: 30,
    line_total: 30,
    catch_weight: false,
    ...overrides,
  };
}

test('recovers documented quart packaging', () => {
  const ocr = sourceTable([{
    id: '1001',
    shipped: 1,
    pack: 4,
    size: '1 QT',
    description: 'PRODUCT A',
    price: '30.00',
    extended: '30.00',
  }]);

  const [result] = validateInvoiceAgainstSource(
    [item()],
    ocr
  );

  assert.equal(result.quantity_shipped, 1);
  assert.equal(result.pack, 4);
  assert.equal(result.size, 1);
  assert.equal(result.size_unit, 'qt');
  assert.equal(result.pack_size_raw, '4 1 QT');
  assert.equal(result.invoice_price, 30);
  assert.equal(result.line_total, 30);
});

test('works with unrelated weight-based products', () => {
  const ocr = sourceTable([{
    id: '2001',
    shipped: 2,
    pack: 2,
    size: '5 LB',
    description: 'PRODUCT A',
    price: '46.00',
    extended: '92.00',
  }]);

  const [result] = validateInvoiceAgainstSource(
    [item()],
    ocr
  );

  assert.equal(result.quantity_shipped, 2);
  assert.equal(result.pack, 2);
  assert.equal(result.size, 5);
  assert.equal(result.size_unit, 'lb');
  assert.equal(result.line_total, 92);
});

test('rejects source rows with inconsistent arithmetic', () => {
  const ocr = sourceTable([{
    id: '3001',
    shipped: 2,
    pack: 4,
    size: '1 QT',
    description: 'PRODUCT A',
    price: '30.00',
    extended: '999.00',
  }]);

  const original = item();

  const [result] = validateInvoiceAgainstSource(
    [original],
    ocr
  );

  assert.deepEqual(result, original);
});

test('does not choose between duplicate product rows', () => {
  const ocr = sourceTable([
    {
      id: '4001',
      shipped: 1,
      pack: 4,
      size: '1 QT',
      description: 'PRODUCT A',
      price: '30.00',
      extended: '30.00',
    },
    {
      id: '4002',
      shipped: 1,
      pack: 6,
      size: '1 QT',
      description: 'PRODUCT A',
      price: '40.00',
      extended: '40.00',
    },
  ]);

  const original = item();

  const [result] = validateInvoiceAgainstSource(
    [original],
    ocr
  );

  assert.deepEqual(result, original);
});

test('preserves catch-weight products', () => {
  const original = item({
    catch_weight: true,
    actual_weight: 18.5,
  });

  const [result] = validateInvoiceAgainstSource(
    [original],
    sourceTable([{
      id: '5001',
      shipped: 1,
      pack: 2,
      size: '5 LB',
      description: 'PRODUCT A',
      price: '30.00',
      extended: '30.00',
    }])
  );

  assert.deepEqual(result, original);
});

test('unsupported source layouts remain unchanged', () => {
  const original = item();

  const [result] = validateInvoiceAgainstSource(
    [original],
    'Unstructured invoice text without table headers'
  );

  assert.deepEqual(result, original);
});

test('different products cannot inherit source values', () => {
  const original = item({
    item_name_raw: 'PRODUCT B',
  });

  const [result] = validateInvoiceAgainstSource(
    [original],
    sourceTable([{
      id: '6001',
      shipped: 1,
      pack: 4,
      size: '1 QT',
      description: 'PRODUCT A',
      price: '30.00',
      extended: '30.00',
    }])
  );

  assert.deepEqual(result, original);
});