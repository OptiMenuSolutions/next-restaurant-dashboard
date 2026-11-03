import test from 'node:test';
import assert from 'node:assert/strict';

import { computeWasteRisk } from '../lib/computeWasteRisk.js';
import { applyInventoryCounts } from '../lib/applyInventoryCounts.js';

const INGREDIENT_ID = 'ingredient-chicken';

function delivery(id, date, quantity) {
  return {
    id,
    invoice_id: `invoice-${id}`,
    ingredient_id: INGREDIENT_ID,
    item_name: 'Chicken Breast',
    quantity,
    unit: 'oz',
    unit_cost: 0.25,
    invoices: {
      id: `invoice-${id}`,
      date,
    },
    ingredients: {
      id: INGREDIENT_ID,
      name: 'Chicken Breast',
      unit: 'oz',
    },
  };
}

function sale(id, date, quantity) {
  return {
    id,
    sale_date: date,
    item_name: 'Chicken Sandwich',
    quantity_sold: quantity,
    refunds: 0,
  };
}

function physicalCount(id, date, quantity, timing = 'after_closing') {
  return {
    id,
    ingredient_id: INGREDIENT_ID,
    effective_date: date,
    count_timing: timing,
    quantity,
    unit: 'oz',
    submitted_at: `${date}T23:00:00Z`,
    ingredients: {
      id: INGREDIENT_ID,
      name: 'Chicken Breast',
      unit: 'oz',
    },
  };
}

function confirmation(id, invoiceItemId, date, quantity) {
  return {
    id,
    invoice_item_id: invoiceItemId,
    status: 'confirmed_wasted',
    confirmed_at: `${date}T16:00:00Z`,
    presumed_qty: quantity,
    confirmed_waste_qty: null,
    adjustment_qty: quantity,
  };
}

function calculate({
  deliveries = [],
  sales = [],
  counts = [],
  confirmations = [],
  throughDate = '2026-11-05',
} = {}) {
  const invoices = deliveries.map((item) => ({
    id: item.invoice_id,
    date: item.invoices.date,
  }));

  const menuItems = [{
    id: 'dish-1',
    name: 'Chicken Sandwich',
    menu_item_components: [{
      component_ingredients: [{
        quantity: 1,
        unit: 'oz',
        ingredients: {
          id: INGREDIENT_ID,
          name: 'Chicken Breast',
          unit: 'oz',
        },
      }],
    }],
  }];

  const eligibleDeliveries = deliveries.filter(
    (item) => item.invoices.date <= throughDate
  );

  const eligibleSales = sales.filter(
    (item) => item.sale_date <= throughDate
  );

  const inputs = {
    invoiceItems: eligibleDeliveries,
    invoices,
    posSales: eligibleSales,
    menuItems,
    freezeSettings: {},
    keptItemIds: new Set(),
    learnedShelfLives: {},
    confirmationEvents: confirmations,
  };

  const base = computeWasteRisk(
    eligibleDeliveries,
    invoices,
    eligibleSales,
    menuItems,
    new Date(`${throughDate}T12:00:00`),
    {},
    new Set(),
    {}
  );

  return applyInventoryCounts(
    base,
    inputs,
    counts,
    throughDate
  );
}

function remaining(rows, invoiceItemId) {
  return rows
    .filter((row) => row.invoiceItemId === invoiceItemId)
    .reduce((sum, row) => sum + row.remainingQty, 0);
}

function totalRemaining(rows) {
  return rows.reduce(
    (sum, row) => sum + row.remainingQty,
    0
  );
}

test('POS usage drains delivered stock', () => {
  const rows = calculate({
    deliveries: [delivery('a', '2026-11-01', 100)],
    sales: [sale('sale-1', '2026-11-02', 60)],
  });

  assert.equal(remaining(rows, 'a'), 40);
});

test('confirmed disposal clears the estimated remainder', () => {
  const rows = calculate({
    deliveries: [delivery('a', '2026-11-01', 100)],
    sales: [sale('sale-1', '2026-11-02', 60)],
    confirmations: [
      confirmation('confirmation-a', 'a', '2026-11-03', 40),
    ],
  });

  assert.equal(remaining(rows, 'a'), 0);
});

test('confirmed adjustment cannot make inventory negative', () => {
  const rows = calculate({
    deliveries: [delivery('a', '2026-11-01', 100)],
    sales: [sale('sale-1', '2026-11-02', 90)],
    confirmations: [
      confirmation('confirmation-a', 'a', '2026-11-03', 40),
    ],
  });

  assert.equal(remaining(rows, 'a'), 0);
});

test('confirmation never deducts from another delivery', () => {
  const rows = calculate({
    deliveries: [
      delivery('a', '2026-11-01', 100),
      delivery('b', '2026-11-02', 50),
    ],
    sales: [sale('sale-1', '2026-11-03', 60)],
    confirmations: [
      confirmation('confirmation-a', 'a', '2026-11-04', 40),
    ],
  });

  assert.equal(remaining(rows, 'a'), 0);
  assert.equal(remaining(rows, 'b'), 50);
});

test('physical count before confirmation prevents double deduction', () => {
  const rows = calculate({
    deliveries: [delivery('a', '2026-11-01', 100)],
    sales: [sale('sale-1', '2026-11-02', 60)],
    counts: [physicalCount('count-1', '2026-11-03', 15)],
    confirmations: [
      confirmation('confirmation-a', 'a', '2026-11-04', 40),
    ],
  });

  assert.equal(totalRemaining(rows), 15);
});

test('physical count after confirmation reconciles inventory', () => {
  const rows = calculate({
    deliveries: [delivery('a', '2026-11-01', 100)],
    sales: [sale('sale-1', '2026-11-02', 60)],
    confirmations: [
      confirmation('confirmation-a', 'a', '2026-11-03', 40),
    ],
    counts: [physicalCount('count-1', '2026-11-04', 15)],
  });

  assert.equal(totalRemaining(rows), 15);
});

test('historical inventory excludes future confirmations', () => {
  const rows = calculate({
    deliveries: [delivery('a', '2026-11-01', 100)],
    sales: [sale('sale-1', '2026-11-02', 60)],
    confirmations: [
      confirmation('confirmation-a', 'a', '2026-11-04', 40),
    ],
    throughDate: '2026-11-03',
  });

  assert.equal(remaining(rows, 'a'), 40);
});

test('replaying identical history produces identical inventory', () => {
  const scenario = {
    deliveries: [
      delivery('a', '2026-11-01', 100),
      delivery('b', '2026-11-03', 50),
    ],
    sales: [sale('sale-1', '2026-11-02', 60)],
    confirmations: [
      confirmation('confirmation-a', 'a', '2026-11-04', 40),
    ],
  };

  const first = calculate(scenario);
  const second = calculate(scenario);

  assert.deepEqual(first, second);
});

test('estimated expiration alone does not remove inventory', () => {
  const rows = calculate({
    deliveries: [delivery('a', '2026-10-01', 100)],
    throughDate: '2026-11-05',
  });

  assert.equal(remaining(rows, 'a'), 100);
});