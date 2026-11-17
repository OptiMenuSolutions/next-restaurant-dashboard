import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { computeWasteRisk } from '../lib/computeWasteRisk.js';
import { applyInventoryCounts } from '../lib/applyInventoryCounts.js';

export function inventoryFixture(today = '2026-11-16') {
  const shift = days => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000)
    .toISOString().slice(0, 10);
  const ingredient = { id: randomUUID(), name: 'Chicken Breast', unit: 'oz' };
  const invoices = [-4, -1, 2].map((days, index) => ({ id: randomUUID(),
    date: index === 0 ? today : shift(-5), delivery_date: shift(days) }));
  const items = invoices.map((invoice, index) => ({ id: randomUUID(), invoice_id: invoice.id,
    ingredient_id: ingredient.id, item_name: ingredient.name, quantity: index === 0 ? 2 : 1,
    unit: 'lb', unit_cost: [4, 8, 12][index], amount: [8, 8, 12][index],
    invoices: invoice, ingredients: ingredient }));
  const menu = { id: randomUUID(), name: 'Inventory Validation Chicken', menu_item_components: [{
    component_ingredients: [{ quantity: 6, unit: 'oz', ingredients: ingredient }],
  }] };
  const sales = [{ id: randomUUID(), sale_date: shift(-2), item_name: menu.name,
    quantity_sold: 4, refunds: 0 }];
  const count = (quantity, timing = 'after_closing', date = today) => ({ id: randomUUID(),
    ingredient_id: ingredient.id, quantity, unit: 'oz', ingredients: ingredient,
    effective_date: date, count_timing: timing, submitted_at: `${date}T23:00:00Z` });
  const waste = (quantity = 3) => ({ id: randomUUID(), invoice_item_id: items[0].id,
    status: 'confirmed_wasted', presumed_qty: quantity, adjustment_qty: quantity,
    confirmed_at: `${today}T17:00:00Z` });
  return { today, shift, ingredient, invoices, items, menu, sales, count, waste };
}

export function replayInventory(f, { through = f.today, sales = f.sales, counts = [],
  confirmations = [] } = {}) {
  const eligibleSales = sales.filter(row => row.sale_date <= through);
  const inputs = { invoiceItems: f.items, invoices: f.invoices, posSales: eligibleSales,
    menuItems: [f.menu], freezeSettings: {}, keptItemIds: new Set(), learnedShelfLives: {},
    confirmationEvents: confirmations, timeZone: 'America/New_York' };
  const base = computeWasteRisk(f.items, f.invoices, eligibleSales, [f.menu],
    new Date(`${through}T12:00:00`));
  return applyInventoryCounts(base, inputs, counts, through);
}

export async function validateInventoryReconciliation({ db, restaurantId, ownerId, today, pass }) {
  const checked = result => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  assert.equal(db.supabaseUrl, 'https://hadinygxviofopdejwvj.supabase.co');
  const owner = checked(await db.from('restaurants').select('user_id,name')
    .eq('id', restaurantId).single());
  assert.equal(owner.user_id, ownerId);
  assert.match(owner.name, /^Phase 6 staging [0-9a-f-]{36}$/);
  checked(await db.from('restaurants').update({ freezes_poultry: false })
    .eq('id', restaurantId).eq('user_id', ownerId));
  const { rebuildCurrentInventory, calculateInventory, loadCurrentInventory } =
    await import('../lib/currentInventory.js');
  const { restaurantLocalDate } = await import('../lib/restaurantTime.js');
  const f = inventoryFixture(today);
  const iid = f.ingredient.id;
  const rebuild = async submission => {
    assert.equal(restaurantLocalDate('America/New_York'), today, 'Midnight crossed; rerun.');
    return rebuildCurrentInventory(db, restaurantId, submission);
  };
  const stock = async () => checked(await db.from('current_inventory')
    .select('stock_source,count_line_id,invoice_item_id,ingredient_id,delivery_date,shelf_life,unit,invoiced_qty,remaining_qty,unit_cost')
    .eq('restaurant_id', restaurantId).eq('ingredient_id', iid).order('invoice_item_id'));
  const session = async id => checked(await db.from('inventory_count_sessions').select('*')
    .eq('restaurant_id', restaurantId).eq('id', id).single());
  const quantities = async (old, recent, counted = 0) => {
    const rows = await stock();
    const quantity = id => rows.filter(row => row.invoice_item_id === id)
      .reduce((sum, row) => sum + Number(row.remaining_qty), 0);
    assert.equal(quantity(f.items[0].id), old);
    assert.equal(quantity(f.items[1].id), recent);
    assert.equal(quantity(f.items[2].id), 0);
    assert.equal(rows.filter(row => row.stock_source === 'count')
      .reduce((sum, row) => sum + Number(row.remaining_qty), 0), counted);
    return rows;
  };
  checked(await db.from('ingredients').insert({ ...f.ingredient, restaurant_id: restaurantId,
    standard_unit: 'oz', ingredient_category: 'weight', last_price: 0.5, is_estimated: false }));
  checked(await db.from('menu_items').insert({ id: f.menu.id, restaurant_id: restaurantId,
    name: f.menu.name, price: 15, category: 'Testing' }));
  const componentId = randomUUID();
  checked(await db.from('menu_item_components').insert({ id: componentId,
    menu_item_id: f.menu.id, name: 'Chicken' }));
  checked(await db.from('component_ingredients').insert({ component_id: componentId,
    ingredient_id: iid, quantity: 6, unit: 'oz' }));
  checked(await db.from('invoices').insert(f.invoices.map((row, index) => ({ ...row,
    restaurant_id: restaurantId, supplier: owner.name, number: `INVENTORY-${index}`, amount: f.items[index].amount }))));
  checked(await db.from('invoice_items').insert(f.items.map(({ invoices, ingredients, ...row }) => row)));
  checked(await db.from('pos_sales').insert(f.sales.map(row => ({ ...row,
    restaurant_id: restaurantId, pos_system: 'validation' }))));
  const sourceBefore = checked(await db.from('invoice_items').select('*')
    .in('invoice_id', f.invoices.map(row => row.id)).order('id'));

  await rebuild();
  const originalStock = await quantities(8, 16);
  assert.equal(originalStock.find(row => row.invoice_item_id === f.items[0].id).unit_cost, 0.25);
  assert.equal(originalStock.find(row => row.invoice_item_id === f.items[1].id).unit_cost, 0.5);
  pass('Delivered pounds convert to ounces; FIFO leaves 8 old and 16 recent ounces, with future stock excluded.');
  const visible = (await loadCurrentInventory(db, restaurantId)).filter(row => row.ingredientId === iid);
  assert.equal(visible.find(row => row.invoiceItemId === f.items[0].id).daysLeft, -1);
  assert.equal(visible.find(row => row.invoiceItemId === f.items[1].id).daysLeft, 2);
  assert.equal(visible.reduce((sum, row) => sum + row.totalValue, 0), 10);
  pass('Freshness starts at delivery; estimated expiry retains physical stock and the priced balance is $10.');
  for (const [day, expected] of [[-5, 0], [-3, 32], [-2, 8], [-1, 24]]) {
    const history = await calculateInventory(db, restaurantId, f.shift(day));
    assert.equal(history.rows.filter(row => row.ingredient_id === iid)
      .reduce((sum, row) => sum + Number(row.remaining_qty), 0), expected);
  }
  pass('Historical cutoffs reproduce stock before delivery, after delivery, after sales, and after the second delivery.');
  await rebuild();
  assert.deepEqual(await stock(), originalStock);
  pass('Repeated inventory rebuilds produce the same quantities and lot values.');

  // Trusted synthetic confirmed event: this validates replay, not owner-response authentication.
  checked(await db.from('waste_confirmations').insert({ restaurant_id: restaurantId,
    invoice_item_id: f.items[0].id, ingredient_name: f.ingredient.name, last_seen_date: today,
    delivery_date: f.shift(-4), presumed_qty: 3, presumed_value: 0.75, adjustment_qty: 3,
    status: 'confirmed_wasted', confirmed_by: ownerId, confirmed_at: new Date().toISOString() }));
  await rebuild();
  const wasted = await quantities(5, 16);
  await rebuild();
  assert.deepEqual(await stock(), wasted);
  pass('A confirmed three-ounce adjustment affects its own lot once and survives replay without double deduction.');

  async function draft(quantity) {
    const id = randomUUID();
    checked(await db.from('inventory_count_sessions').insert({ id, restaurant_id: restaurantId,
      status: 'draft', source: 'manual', created_by: ownerId }));
    const args = { p_restaurant_id: restaurantId, p_session_id: id, p_ingredient_id: iid,
      p_quantity: quantity, p_unit: 'oz', p_expected_recorded_at: null, p_user_id: ownerId };
    const line = checked(await db.rpc('save_inventory_count_line', args));
    return { id, line, args };
  }
  async function review(draft, timing) {
    return checked(await db.rpc('review_inventory_count', { p_restaurant_id: restaurantId,
      p_session_id: draft.id, p_user_id: ownerId, p_effective_date: today, p_count_timing: timing }));
  }
  const submission = (draft, reviewed) => ({ session_id: draft.id,
    expected_revision: reviewed.revision, effective_date: today, count_timing: reviewed.count_timing,
    user_id: ownerId, submitted_at: new Date().toISOString() });
  const opening = await draft(20);
  const draftBefore = await session(opening.id);
  assert.deepEqual(checked(await db.rpc('save_inventory_count_line', opening.args)), opening.line);
  assert.deepEqual(await session(opening.id), draftBefore);
  const stale = await db.rpc('save_inventory_count_line', { ...opening.args, p_quantity: 19 });
  assert.equal(stale.error?.message, 'COUNT_CONFLICT');
  const foreign = await db.rpc('save_inventory_count_line', { ...opening.args, p_user_id: randomUUID() });
  assert.equal(foreign.error?.message, 'COUNT_ACCESS_DENIED');
  assert.deepEqual(await session(opening.id), draftBefore);
  pass('Identical count saves are idempotent; stale edits and unrelated actors cannot change the draft.');
  const future = await db.rpc('review_inventory_count', { p_restaurant_id: restaurantId,
    p_session_id: opening.id, p_user_id: ownerId, p_effective_date: f.shift(1), p_count_timing: 'before_opening' });
  assert.equal(future.error?.message, 'COUNT_INVALID_BOUNDARY');
  const openingReview = await review(opening, 'before_opening');
  assert.equal(openingReview.counted, 1);
  assert.equal(openingReview.lines[0].quantity, 20);
  await rebuild(submission(opening, openingReview));
  assert.equal((await session(opening.id)).status, 'submitted');
  await quantities(4, 16);
  pass('The real review and atomic submission apply a 20-ounce opening count without repeating earlier waste adjustments.');

  checked(await db.from('pos_sales').insert({ restaurant_id: restaurantId, sale_date: today,
    item_name: f.menu.name, quantity_sold: 1, refunds: 0, pos_system: 'validation' }));
  await rebuild();
  await quantities(0, 14);
  pass('A six-ounce serving after the opening count drains the oldest stock and leaves 14 recent ounces.');
  const closing = await draft(25);
  const closingReview = await review(closing, 'after_closing');
  const closingSubmission = submission(closing, closingReview);
  await rebuild(closingSubmission);
  const closingStock = await quantities(0, 14, 11);
  const extra = closingStock.find(row => row.stock_source === 'count');
  for (const column of ['delivery_date', 'shelf_life', 'invoiced_qty', 'unit_cost']) assert.equal(extra[column], null);
  const extraView = (await loadCurrentInventory(db, restaurantId)).find(row => row.countLineId === closing.line.id);
  assert.equal(extraView.remainingQty, 11);
  assert.equal(extraView.ageKnown, false);
  assert.equal(extraView.daysLeft, null);
  assert.equal(extraView.totalValue, null);
  pass('A 25-ounce closing count retains 14 priced ounces and records 11 extra ounces with unknown age and value.');
  const replay = checked(await db.rpc('commit_inventory_build', { p_restaurant_id: restaurantId,
    p_token: randomUUID(), p_rows: [], p_submission: closingSubmission }));
  assert.equal(replay.already_submitted, true);
  await rebuild();
  assert.deepEqual(await stock(), closingStock);
  pass('Repeated submission and rebuild create no duplicate counted stock or deductions.');

  const broken = await draft(99);
  const brokenReview = await review(broken, 'after_closing');
  const beforeFailure = await session(broken.id);
  const token = checked(await db.rpc('begin_inventory_build', { p_restaurant_id: restaurantId }));
  const rejected = await db.rpc('commit_inventory_build', { p_restaurant_id: restaurantId, p_token: token,
    p_submission: submission(broken, brokenReview), p_rows: [{ restaurant_id: restaurantId,
      stock_source: 'count', count_line_id: randomUUID(), ingredient_id: iid, ingredient_name: f.ingredient.name,
      unit: 'oz', remaining_qty: 1, unit_cost: null, computed_at: new Date().toISOString() }] });
  assert.ok(rejected.error?.message.includes('Invalid inventory replacement row'));
  assert.deepEqual(await session(broken.id), beforeFailure);
  assert.deepEqual(await stock(), closingStock);
  pass('A replacement-row failure rolls back count submission and preserves the previously committed stock.');
  const zero = await draft(0);
  await rebuild(submission(zero, await review(zero, 'after_closing')));
  await quantities(0, 0, 0);
  await rebuild();
  assert.deepEqual(await stock(), []);
  const editSubmitted = await db.rpc('save_inventory_count_line', { ...zero.args,
    p_quantity: 1, p_expected_recorded_at: zero.line.recorded_at });
  assert.equal(editSubmitted.error?.message, 'COUNT_NOT_EDITABLE');
  pass('Zero is a valid physical count; rebuilding cannot resurrect stock or edit a submitted count.');
  const past = await calculateInventory(db, restaurantId, f.shift(-1));
  assert.equal(past.rows.filter(row => row.ingredient_id === iid)
    .reduce((sum, row) => sum + Number(row.remaining_qty), 0), 24);
  assert.deepEqual(checked(await db.from('invoice_items').select('*')
    .in('invoice_id', f.invoices.map(row => row.id)).order('id')), sourceBefore);
  assert.equal(checked(await db.from('notification_email_outbox').select('id')
    .eq('restaurant_id', restaurantId)).length, 0);
  pass('Current counts do not rewrite historical stock or source invoice lines, and no email is queued.');
}