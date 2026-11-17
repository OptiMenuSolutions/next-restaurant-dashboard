import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryFixture, replayInventory } from '../scripts/validate-inventory-reconciliation.mjs';
import { computeWasteRisk } from '../lib/computeWasteRisk.js';

const quantity = rows => rows.reduce((sum, row) => sum + row.remainingQty, 0);
const lot = (rows, f, index) => rows.find(row => row.invoiceItemId === f.items[index].id);
const todaySale = f => ({ id: 'today-sale', sale_date: f.today, item_name: f.menu.name,
  quantity_sold: 1, refunds: 0 });

test('two pounds convert to 32 ounces at $0.25 per ounce', () => {
  const f = inventoryFixture();
  const row = lot(replayInventory(f, { sales: [] }), f, 0);
  assert.equal(row.invoicedQty, 32);
  assert.equal(row.remainingQty, 32);
  assert.equal(row.unitCost, 0.25);
});

test('delivery date includes old stock even when the printed invoice date is later', () => {
  const f = inventoryFixture();
  assert.equal(quantity(replayInventory(f, { through: f.shift(-3) })), 32);
});

test('stock before the first delivery is zero', () => {
  const f = inventoryFixture();
  assert.deepEqual(replayInventory(f, { through: f.shift(-5) }), []);
});

test('four six-ounce servings leave eight ounces in the first lot', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f, { through: f.shift(-2) });
  assert.equal(quantity(rows), 8);
  assert.equal(lot(rows, f, 0).remainingQty, 8);
});

test('later deliveries do not retroactively absorb earlier consumption', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f);
  assert.equal(lot(rows, f, 0).remainingQty, 8);
  assert.equal(lot(rows, f, 1).remainingQty, 16);
});

test('future deliveries remain excluded despite older printed invoice dates', () => {
  const f = inventoryFixture();
  assert.equal(lot(replayInventory(f), f, 2), undefined);
  assert.equal(quantity(replayInventory(f)), 24);
});

test('unknown invoice and delivery dates cannot create stock', () => {
  const f = inventoryFixture();
  f.invoices[0].date = null;
  f.invoices[0].delivery_date = null;
  assert.equal(lot(replayInventory(f), f, 0), undefined);
});

test('estimated expiration retains stock and does not redirect FIFO consumption', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f);
  assert.equal(lot(rows, f, 0).daysLeft, -1);
  assert.equal(lot(rows, f, 0).remainingQty, 8);
  assert.equal(lot(rows, f, 1).remainingQty, 16);
});

test('freshness and modeled value use each lot delivery date and purchase price', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f);
  assert.equal(lot(rows, f, 0).daysSinceDelivery, 4);
  assert.equal(lot(rows, f, 1).daysLeft, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.totalValue, 0), 10);
});

test('future sales do not consume current stock', () => {
  const f = inventoryFixture();
  const sales = [...f.sales, { ...todaySale(f), sale_date: f.shift(1), quantity_sold: 100 }];
  assert.equal(quantity(replayInventory(f, { sales })), 24);
});

test('sales before delivery do not consume a later lot', () => {
  const f = inventoryFixture();
  const sales = [{ ...todaySale(f), sale_date: f.shift(-5), quantity_sold: 100 }];
  assert.equal(quantity(replayInventory(f, { sales })), 48);
});

test('a confirmed adjustment removes three ounces from its specified lot', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f, { confirmations: [f.waste()] });
  assert.equal(lot(rows, f, 0).remainingQty, 5);
  assert.equal(lot(rows, f, 1).remainingQty, 16);
});

test('an oversized adjustment cannot consume another lot or make stock negative', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f, { confirmations: [f.waste(999)] });
  assert.equal(lot(rows, f, 0).remainingQty, 0);
  assert.equal(lot(rows, f, 1).remainingQty, 16);
});

test('historical inventory ignores later confirmed adjustments', () => {
  const f = inventoryFixture();
  assert.equal(quantity(replayInventory(f, { through: f.shift(-1), confirmations: [f.waste()] })), 24);
});

test('an opening count of 20 followed by a six-ounce sale leaves 14 ounces', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f, { sales: [...f.sales, todaySale(f)],
    counts: [f.count(20, 'before_opening')] });
  assert.equal(quantity(rows), 14);
  assert.equal(lot(rows, f, 0).remainingQty, 0);
  assert.equal(lot(rows, f, 1).remainingQty, 14);
});

test('a closing count of 20 supersedes that day modeled consumption', () => {
  const f = inventoryFixture();
  assert.equal(quantity(replayInventory(f, { sales: [...f.sales, todaySale(f)],
    counts: [f.count(20, 'after_closing')] })), 20);
});

test('a physical count reconciles missing stock without double-deducting a later response', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f, { counts: [f.count(20, 'before_opening')], confirmations: [f.waste()] });
  assert.equal(quantity(rows), 20);
  assert.equal(lot(rows, f, 0).remainingQty, 4);
});

test('counted surplus has no invented delivery, expiry, purchase cost, or value', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f, { counts: [f.count(25)] });
  const extra = rows.find(row => row.stockSource === 'count');
  assert.equal(extra.remainingQty, 1);
  for (const key of ['deliveryDate', 'shelfLife', 'unitCost', 'totalValue', 'daysLeft']) {
    assert.equal(extra[key], null);
  }
});

test('opening and closing counts retain priced stock and add only the unexplained surplus', () => {
  const f = inventoryFixture();
  const rows = replayInventory(f, { sales: [...f.sales, todaySale(f)],
    counts: [f.count(20, 'before_opening'), f.count(25, 'after_closing')] });
  assert.equal(lot(rows, f, 1).remainingQty, 14);
  assert.equal(rows.find(row => row.stockSource === 'count').remainingQty, 11);
  assert.equal(quantity(rows), 25);
});

test('zero is a valid physical count and does not delete the source deliveries', () => {
  const f = inventoryFixture();
  const before = structuredClone(f.items);
  assert.equal(quantity(replayInventory(f, { counts: [f.count(0)] })), 0);
  assert.deepEqual(f.items, before);
});

test('future counts do not alter the current modeled balance', () => {
  const f = inventoryFixture();
  assert.equal(quantity(replayInventory(f, { counts: [f.count(0, 'after_closing', f.shift(1))] })), 24);
});

test('replaying identical counts and adjustments gives identical lot balances', () => {
  const f = inventoryFixture();
  const options = { counts: [f.count(20, 'before_opening')], confirmations: [f.waste()],
    sales: [...f.sales, todaySale(f)] };
  assert.deepEqual(replayInventory(f, options), replayInventory(f, options));
});

test('unsupported delivered count-to-weight conversion requires review', () => {
  const f = inventoryFixture();
  f.items[0].unit = 'can';
  assert.throws(() => replayInventory(f), /Cannot convert invoice delivery/);
});

test('a future unsupported purchase does not affect present stock', () => {
  const f = inventoryFixture();
  f.items[2].unit = 'can';
  assert.equal(quantity(replayInventory(f)), 24);
});

test('configured frozen storage changes estimated shelf life without changing quantity', () => {
  const f = inventoryFixture();
  const rows = computeWasteRisk(f.items, f.invoices, f.sales, [f.menu],
    new Date(`${f.today}T12:00:00`), { poultry: true });
  assert.equal(lot(rows, f, 0).remainingQty, 8);
  assert.equal(lot(rows, f, 0).daysLeft, 266);
});