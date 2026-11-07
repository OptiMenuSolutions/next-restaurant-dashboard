import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOrdinaryInvoicePackage,
  resolveOrdinaryInvoicePackage,
} from '../lib/invoiceOrdinaryPackage.js';

import {
  calculateVerifiedInvoiceCost,
} from '../lib/verifiedInvoiceCosting.js';

function invoiceItem(overrides = {}) {
  return {
    item_name: 'Butter',
    pack_size_raw: '6/5 LB',
    pack: 6,
    size: 5,
    size_unit: 'lb',
    quantity_shipped: 1,
    line_total: 90,
    invoice_price: 90,
    catch_weight: false,
    ...overrides,
  };
}

test('parses documented six-by-five-pound cases', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('6/5 LB'),
    {
      pack: 6,
      size: 5,
      size_unit: 'lb',
    }
  );
});

test('parses documented gallon packages', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('4/1 GAL'),
    {
      pack: 4,
      size: 1,
      size_unit: 'gal',
    }
  );
});

test('parses documented ounce packages', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('12/12 OZ'),
    {
      pack: 12,
      size: 12,
      size_unit: 'oz',
    }
  );
});

test('accepts matching invoice package descriptions', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem()
  );

  assert.equal(result.quantity, 30);
  assert.equal(result.unit, 'lb');
  assert.equal(result.unit_cost, 3);
  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('rejects incorrect extracted package sizes', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      size: 50,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('rejects incorrect extracted package counts', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack: 60,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('rejects incorrect extracted physical units', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      size_unit: 'oz',
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('missing original package text requires verification', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: null,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('unsupported package descriptions require verification', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: 'MIXED CASE',
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('invoice totals remain available after a discrepancy', () => {
  const item = invoiceItem({
    pack: 60,
  });

  const packageResult = resolveOrdinaryInvoicePackage(item);
  const cost = calculateVerifiedInvoiceCost(item);

  assert.equal(packageResult.status, 'package_discrepancy');
  assert.equal(cost.unit_cost, null);
  assert.equal(item.line_total, 90);
});

test('verified numbered-can behavior remains unchanged', () => {
  const result = calculateVerifiedInvoiceCost({
    pack_size_raw: '3/#10 CAN',
    quantity_shipped: 1,
    line_total: 50.78,
    invoice_price: 50.78,
    catch_weight: false,
  });

  assert.equal(result.quantity, 3);
  assert.equal(result.unit, 'can');
  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('unsupported package text cannot create a unit cost', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: '6/5 LB + BONUS PACK',
    })
  );

  assert.equal(result.unit_cost, null);
});

test('ordinary package parser does not reinterpret numbered cans', () => {
  assert.equal(
    parseOrdinaryInvoicePackage('3/#10 CAN'),
    null
  );
});

test('parses standalone count packages', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('12 CT'),
    {
      pack: 1,
      size: 12,
      size_unit: 'each',
    }
  );
});

test('parses standalone weight packages', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('5 LB'),
    {
      pack: 1,
      size: 5,
      size_unit: 'lb',
    }
  );
});

test('HTK-1001 brioche buns calculate correctly', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      item_name: 'Brioche Buns',
      pack_size_raw: '12 CT',
      pack: 12,
      size: 1,
      size_unit: 'ct',
      quantity_shipped: 3,
      line_total: 54,
      invoice_price: 18,
    })
  );

  assert.equal(result.quantity, 36);
  assert.equal(result.unit, 'each');
  assert.equal(result.unit_cost, 1.5);
  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('HTK-1001 cheddar calculates correctly', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      item_name: 'Cheddar Cheese Block',
      pack_size_raw: '5 LB',
      pack: 1,
      size: 5,
      size_unit: 'lb',
      quantity_shipped: 2,
      line_total: 42,
      invoice_price: 21,
    })
  );

  assert.equal(result.quantity, 10);
  assert.equal(result.unit, 'lb');
  assert.equal(result.unit_cost, 4.2);
  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('HTK-1001 romaine hearts calculate correctly', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      item_name: 'Romaine Hearts',
      pack_size_raw: '6 CT',
      pack: 1,
      size: 6,
      size_unit: 'ct',
      quantity_shipped: 1,
      line_total: 15,
      invoice_price: 15,
    })
  );

  assert.equal(result.quantity, 6);
  assert.equal(result.unit, 'each');
  assert.equal(result.unit_cost, 2.5);
  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('rejects conflicting standalone quantities', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: '12 CT',
      pack: 24,
      size: 1,
      size_unit: 'ct',
      quantity_shipped: 3,
      line_total: 54,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('rejects conflicting standalone units', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: '5 LB',
      pack: 1,
      size: 5,
      size_unit: 'oz',
      quantity_shipped: 2,
      line_total: 42,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('rejects unsupported standalone descriptions', () => {
  assert.equal(
    parseOrdinaryInvoicePackage('PACK SIZE UNKNOWN'),
    null
  );

  assert.equal(
    parseOrdinaryInvoicePackage('12 CT + BONUS'),
    null
  );

  assert.equal(
    parseOrdinaryInvoicePackage('3/#10 CAN'),
    null
  );
});

test('numbered cans still require verification', () => {
  const result = calculateVerifiedInvoiceCost({
    pack_size_raw: '3/#10 CAN',
    quantity_shipped: 1,
    line_total: 54,
    invoice_price: 54,
    catch_weight: false,
  });

  assert.equal(result.quantity, 3);
  assert.equal(result.unit, 'can');
  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('parses COUNT as an individual item quantity', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('12 COUNT'),
    {
      pack: 1,
      size: 12,
      size_unit: 'each',
    }
  );
});

test('parses COUNTS as an individual item quantity', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('12 COUNTS'),
    {
      pack: 1,
      size: 12,
      size_unit: 'each',
    }
  );
});

test('HTK-1002 brioche buns calculate correctly', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      item_name: 'Brioche Buns',
      pack_size_raw: '12 COUNT',
      pack: 12,
      size: 1,
      size_unit: 'ct',
      quantity_shipped: 1,
      line_total: 19,
      invoice_price: 19,
    })
  );

  assert.equal(result.quantity, 12);
  assert.equal(result.unit, 'each');

  assert.ok(
    Math.abs(result.unit_cost - 19 / 12) < 1e-10
  );

  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('COUNT discrepancies cannot create unit costs', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: '12 COUNT',
      pack: 24,
      size: 1,
      size_unit: 'ct',
      quantity_shipped: 1,
      line_total: 19,
    })
  );

  assert.equal(result.unit_cost, null);

  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('ambiguous COUNT packages remain unverified', () => {
  assert.equal(
    parseOrdinaryInvoicePackage('12 COUNT + BONUS'),
    null
  );
});

test('documented quart packages preserve volume and unit cost', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('4/1 QT'),
    {
      pack: 4,
      size: 1,
      size_unit: 'qt',
    }
  );

  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      item_name: 'Mayonnaise',
      pack_size_raw: '4/1 QT',
      pack: 4,
      size: 1,
      size_unit: 'qt',
      quantity_shipped: 1,
      line_total: 19,
      invoice_price: 19,
    })
  );

  assert.equal(result.quantity, 4);
  assert.equal(result.unit, 'qt');
  assert.equal(result.unit_cost, 4.75);
  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('recognizes common quart and pint package formats', () => {
  const cases = [
    ['4/1 QT', 4, 1, 'qt'],
    ['4 X 1 QUART', 4, 1, 'qt'],
    ['2/2 QTS', 2, 2, 'qt'],
    ['6/1 PT', 6, 1, 'pt'],
    ['6 X 1 PINT', 6, 1, 'pt'],
    ['12 PINTS', 1, 12, 'pt'],
    ['4 QUARTS', 1, 4, 'qt'],
    ['4/1 GALLONS', 4, 1, 'gal'],
  ];

  for (const [raw, pack, size, size_unit] of cases) {
    assert.deepEqual(
      parseOrdinaryInvoicePackage(raw),
      { pack, size, size_unit },
      `Failed to parse ${raw}`
    );
  }
});

test('quart and pint packages reject conflicting extracted units', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: '4/1 QT',
      pack: 4,
      size: 1,
      size_unit: 'gal',
      quantity_shipped: 1,
      line_total: 19,
      invoice_price: 19,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(result.pricingStatus, 'package_discrepancy');
});

test('unsupported volume packages cannot fabricate unit costs', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: '4/1 QT + BONUS',
      pack: 4,
      size: 1,
      size_unit: 'qt',
      quantity_shipped: 1,
      line_total: 19,
      invoice_price: 19,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('documented container descriptions preserve package quantities', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('4/1 GAL JUG'),
    {
      pack: 4,
      size: 1,
      size_unit: 'gal',
    }
  );

  assert.deepEqual(
    parseOrdinaryInvoicePackage('1/10 LB BAG'),
    {
      pack: 1,
      size: 10,
      size_unit: 'lb',
    }
  );
});

test('recognizes documented container descriptions', () => {
  const cases = [
    ['4/1 GAL JUG', 4, 1, 'gal'],
    ['1/10 LB BAG', 1, 10, 'lb'],
    ['6/12 OZ BOTTLE', 6, 12, 'oz'],
    ['1/8 OZ TUB', 1, 8, 'oz'],
    ['4/1 QT JUG', 4, 1, 'qt'],
  ];

  for (const [raw, pack, size, size_unit] of cases) {
    assert.deepEqual(
      parseOrdinaryInvoicePackage(raw),
      { pack, size, size_unit },
      `Failed to parse ${raw}`
    );
  }
});

test('container descriptions cannot hide unsupported package claims', () => {
  const unsupported = [
    '4/1 GAL JUG + BONUS',
    '4/1 GAL JUG 2 PACK',
    '1/10 LB BAG APPROX',
    '6/12 OZ BOTTLE OR CAN',
    '3/#10 CAN',
  ];

  for (const raw of unsupported) {
    assert.equal(
      parseOrdinaryInvoicePackage(raw),
      null,
      `Unexpectedly accepted ${raw}`
    );
  }
});

test('container descriptions cannot override conflicting quantities', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      item_name: 'Mayonnaise',
      pack_size_raw: '4/1 GAL JUG',
      pack: 4,
      size: 2,
      size_unit: 'gal',
      quantity_shipped: 1,
      line_total: 56,
      invoice_price: 56,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(result.pricingStatus, 'package_discrepancy');
});

test('recognizes separate distributor PACK and SIZE columns', () => {
  const cases = [
    ['2 5 LB', 2, 5, 'lb'],
    ['1 10 LB', 1, 10, 'lb'],
    ['4 5 LB', 4, 5, 'lb'],
    ['12 1 QT', 12, 1, 'qt'],
    ['6 1 CT', 6, 1, 'each'],
  ];

  for (const [raw, pack, size, size_unit] of cases) {
    assert.deepEqual(
      parseOrdinaryInvoicePackage(raw),
      { pack, size, size_unit },
      `Failed to parse ${raw}`
    );
  }
});

test('distributor-style packages produce correct invoice costs', () => {
  const cases = [
    ['2 5 LB', 2, 92, 20, 'lb', 4.60],
    ['1 10 LB', 2, 32, 20, 'lb', 1.60],
    ['4 5 LB', 1, 38, 20, 'lb', 1.90],
    ['12 1 QT', 1, 57, 12, 'qt', 4.75],
    ['6 1 CT', 1, 22, 6, 'each', 22 / 6],
  ];

  for (const [
    pack_size_raw,
    quantity_shipped,
    line_total,
    expectedQuantity,
    expectedUnit,
    expectedCost,
  ] of cases) {
    const parsed = parseOrdinaryInvoicePackage(pack_size_raw);

    const result = calculateVerifiedInvoiceCost(
      invoiceItem({
        pack_size_raw,
        pack: parsed.pack,
        size: parsed.size,
        size_unit: parsed.size_unit,
        quantity_shipped,
        line_total,
        invoice_price: line_total / quantity_shipped,
      })
    );

    assert.equal(result.quantity, expectedQuantity);
    assert.equal(result.unit, expectedUnit);
    assert.ok(Math.abs(result.unit_cost - expectedCost) < 1e-9);
    assert.equal(
      result.pricingStatus,
      'invoice_document_consistent'
    );
  }
});