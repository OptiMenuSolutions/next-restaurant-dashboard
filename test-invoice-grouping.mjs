import { readFileSync } from 'node:fs';

const source = readFileSync(
  './lib/invoiceMatchConflicts.js',
  'utf8'
);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { groupInvoiceMatchConflicts } = await import(moduleUrl);

const purchases = [
  {
    restaurant_id: 'restaurant-a',
    supplier: 'Supplier One',
    item_name: 'Broccoli Crowns',
    invoice_item_id: 'purchase-1',
    ingredient_id: 'ingredient-a',
    matched_ingredient: 'Broccoli',
  },
  {
    restaurant_id: 'restaurant-a',
    supplier: 'Supplier Two',
    item_name: 'BROCCOLI CROWNS',
    invoice_item_id: 'purchase-2',
    ingredient_id: 'ingredient-b',
    matched_ingredient: 'Broccoli Florets',
  },
  {
    restaurant_id: 'restaurant-a',
    supplier: 'Supplier Three',
    item_name: 'Frozen Broccoli Florets',
    invoice_item_id: 'purchase-3',
    ingredient_id: 'ingredient-c',
  },
  {
    restaurant_id: 'restaurant-b',
    supplier: 'Supplier One',
    item_name: 'Broccoli Crowns',
    invoice_item_id: 'purchase-4',
    ingredient_id: 'ingredient-d',
  },
];

const conflicts = groupInvoiceMatchConflicts(purchases);
const group = conflicts[0];

if (
  conflicts.length !== 1 ||
  group.purchase_count !== 2 ||
  group.suppliers.length !== 2 ||
  !group.suppliers.includes('Supplier One') ||
  !group.suppliers.includes('Supplier Two')
) {
  console.error(JSON.stringify(conflicts, null, 2));
  throw new Error('Vendor-independent grouping test failed');
}

console.log('PASS: Same description across vendors is grouped.');
console.log('PASS: Different descriptions remain separate.');
console.log('PASS: Different restaurants remain separate.');
