
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupInvoiceMatchConflicts,
} from '../lib/invoiceMatchConflicts.js';

const restaurantId = 'restaurant-1';

function purchase({
  supplier = 'Garden State Produce Co.',
  description = 'Broccoli Crowns',
  ingredientId = 'florets',
  ingredientName = 'Broccoli Florets',
  invoiceNumber = 'GSP 100',
  date = '2026-10-01',
} = {}) {
  return {
    restaurant_id: restaurantId,
    supplier,
    item_name: description,
    ingredient_id: ingredientId,
    matched_ingredient: ingredientName,
    invoice_id: `invoice-${invoiceNumber}`,
    invoice_item_id: `item-${invoiceNumber}`,
    invoice_number: invoiceNumber,
    invoice_date: date,
  };
}

test('groups conflicting historical purchases together', () => {
  const conflicts = groupInvoiceMatchConflicts([
    purchase({ invoiceNumber: 'GSP 100' }),
    purchase({ invoiceNumber: 'GSP 101' }),
    purchase({
      invoiceNumber: 'GSP 102',
      ingredientId: 'broccoli',
      ingredientName: 'Broccoli',
    }),
  ]);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].purchase_count, 3);
  assert.equal(conflicts[0].distinct_ingredient_count, 2);
  assert.equal(conflicts[0].ingredients[0].purchase_count, 2);
  assert.equal(conflicts[0].purchases.length, 3);
});

test('consistent historical links do not create conflicts', () => {
  const conflicts = groupInvoiceMatchConflicts([
    purchase({ invoiceNumber: 'GSP 100' }),
    purchase({ invoiceNumber: 'GSP 101' }),
  ]);

  assert.equal(conflicts.length, 0);
});

test('keeps purchases from different suppliers separate', () => {
  const conflicts = groupInvoiceMatchConflicts([
    purchase({ supplier: 'Supplier A' }),
    purchase({
      supplier: 'Supplier B',
      ingredientId: 'broccoli',
      ingredientName: 'Broccoli',
    }),
  ]);

  assert.equal(conflicts.length, 0);
});

test('normalizes description formatting', () => {
  const conflicts = groupInvoiceMatchConflicts([
    purchase({ description: 'Broccoli Crowns' }),
    purchase({
      description: 'BROCCOLI-CROWNS',
      ingredientId: 'broccoli',
      ingredientName: 'Broccoli',
    }),
  ]);

  assert.equal(conflicts.length, 1);
});

test('includes unlinked purchases in conflict history', () => {
  const conflicts = groupInvoiceMatchConflicts([
    purchase({ invoiceNumber: 'GSP 100' }),
    purchase({
      invoiceNumber: 'GSP 101',
      ingredientId: 'broccoli',
      ingredientName: 'Broccoli',
    }),
    purchase({
      invoiceNumber: 'GSP 102',
      ingredientId: null,
      ingredientName: null,
    }),
  ]);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].purchase_count, 3);
  assert.equal(conflicts[0].linked_purchase_count, 2);
});

test('keeps different restaurants separate', () => {
  const first = purchase({ invoiceNumber: 'GSP 100' });
  const second = {
    ...purchase({
      invoiceNumber: 'GSP 101',
      ingredientId: 'broccoli',
      ingredientName: 'Broccoli',
    }),
    restaurant_id: 'restaurant-2',
  };

  assert.equal(
    groupInvoiceMatchConflicts([first, second]).length,
    0
  );
});
