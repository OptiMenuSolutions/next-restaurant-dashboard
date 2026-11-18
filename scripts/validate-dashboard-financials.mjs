import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dashboardDishFinancials, dashboardMarginStats, loadDashboardMenuItems } from '../lib/dashboardFinancials.js';

export async function validateDashboardFinancials({ db, restaurantId, ownerId, ingredientId, dishId, pass }) {
  const checked = result => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
    `${actual} != ${expected}`);
  assert.equal(db.supabaseUrl, 'https://hadinygxviofopdejwvj.supabase.co');
  const restaurant = checked(await db.from('restaurants').select('name,user_id')
    .eq('id', restaurantId).single());
  assert.equal(restaurant.user_id, ownerId);
  assert.match(restaurant.name, /^Phase 6 staging [0-9a-f-]{36}$/);
  const invoices = checked(await db.from('invoices').select('*').eq('restaurant_id', restaurantId).order('id'));
  const stock = checked(await db.from('current_inventory').select('*').eq('restaurant_id', restaurantId).order('id'));
  const original = (await loadDashboardMenuItems(db, restaurantId)).find(item => item.id === dishId);
  assert.ok(original);
  assert.deepEqual(dashboardDishFinancials(original), { price: 10, cost: 0.5,
    contribution: 9.5, foodCostPct: 5, marginPct: 95, estimated: false });
  pass('The delivered invoice price reconciles to the dashboard’s $0.50 plate, $9.50 contribution, 5% food cost, and 95% margin.');

  const beef = randomUUID(), estimate = randomUUID(), missing = randomUUID(), unapproved = randomUUID();
  checked(await db.from('ingredients').insert([
    { id: beef, restaurant_id: restaurantId, name: 'Dashboard Validation Beef', unit: 'oz',
      last_price: 0.5, is_estimated: false, price_status: 'invoice' },
    { id: estimate, restaurant_id: restaurantId, name: 'Dashboard Validation Garnish', unit: 'each',
      last_price: 0.1, is_estimated: true, price_status: 'approved',
      price_approved_at: new Date().toISOString() },
    { id: missing, restaurant_id: restaurantId, name: 'Dashboard Missing Price', unit: 'oz',
      last_price: null, is_estimated: false, price_status: 'needs_review' },
    { id: unapproved, restaurant_id: restaurantId, name: 'Dashboard Unapproved Price', unit: 'each',
      last_price: 5, is_estimated: true, price_status: 'pending' },
  ]));
  const line = (id, quantity, unit) => ({ ingredient_id: id, quantity, unit });
  const verified = [line(beef, 0.125, 'lb'), line(ingredientId, 2, 'fl oz')];
  const scenarios = [
    { name: 'Verified', cost: 1.5, lines: verified },
    { name: 'Approved Estimate', cost: 1.7, lines: [...verified, line(estimate, 2, 'each')] },
    { name: 'Missing Price', cost: null, lines: [line(missing, 1, 'oz')] },
    { name: 'Unapproved Price', cost: null, lines: [line(unapproved, 1, 'each')] },
    { name: 'Unsupported Conversion', cost: null, lines: [line(beef, 1, 'each')] },
    { name: 'Flat Recipe', cost: 1, flat: true, lines: [line(beef, 2)] },
    { name: 'No Recipe', cost: null, lines: [] },
    { name: 'No Menu Price', price: 0, cost: 1, lines: [line(beef, 2, 'oz')] },
    { name: 'Negative Margin', cost: 12, lines: [line(beef, 24, 'oz')] },
    { name: 'Archived', archived: true, cost: 1, lines: [line(beef, 2, 'oz')] },
  ].map(row => ({ ...row, id: randomUUID() }));
  for (const scenario of scenarios) {
    checked(await db.from('menu_items').insert({ id: scenario.id, restaurant_id: restaurantId,
      name: `Dashboard ${scenario.name}`, price: scenario.price ?? 10,
      archived_at: scenario.archived ? new Date().toISOString() : null }));
    if (!scenario.lines.length) continue;
    if (scenario.flat) {
      checked(await db.from('menu_item_ingredients').insert(scenario.lines.map(({ unit, ...row }) =>
        ({ ...row, menu_item_id: scenario.id }))));
    } else {
      const componentId = randomUUID();
      checked(await db.from('menu_item_components').insert({ id: componentId,
        menu_item_id: scenario.id, name: 'Validation Recipe' }));
      checked(await db.from('component_ingredients').insert(scenario.lines.map(row =>
        ({ ...row, component_id: componentId }))));
    }
  }
  const items = await loadDashboardMenuItems(db, restaurantId);
  assert.equal(items.length, 10);
  assert.ok(!items.some(item => item.id === scenarios.find(row => row.archived).id));
  for (const scenario of scenarios.filter(row => !row.archived)) {
    const item = items.find(row => row.id === scenario.id);
    const financials = dashboardDishFinancials(item);
    const canonical = checked(await db.rpc('calculate_dish_cost', { p_dish_id: scenario.id }));
    assert.equal(financials.cost, scenario.cost, scenario.name);
    assert.equal(canonical.ready, scenario.cost != null, scenario.name);
    if (scenario.cost != null) assert.equal(Number(canonical.cost), scenario.cost, scenario.name);
  }
  pass('Component and legacy recipes match canonical database costs; missing, unapproved, and unsupported costs stay unavailable.');
  const approved = dashboardDishFinancials(items.find(row => row.id === scenarios[1].id));
  assert.equal(approved.estimated, true);
  assert.equal(approved.cost, 1.7);
  close(approved.foodCostPct, 17);
  close(approved.marginPct, 83);
  close(approved.contribution, 8.3);
  pass('An approved ingredient estimate remains visibly estimated while its $1.70 plate and 83% margin reconcile.');
  const noPrice = dashboardDishFinancials(items.find(row => row.id === scenarios[7].id));
  assert.equal(noPrice.marginPct, null);
  assert.equal(noPrice.contribution, null);
  const loss = dashboardDishFinancials(items.find(row => row.id === scenarios[8].id));
  assert.equal(loss.contribution, -2);
  assert.equal(loss.marginPct, -20);
  pass('A zero menu price produces no invented percentages; a loss-making dish retains its negative margin.');
  const stats = dashboardMarginStats(items, { restaurantId });
  close(stats.avgMargin, 66.6);
  assert.equal(stats.pricedCount, 5);
  assert.equal(stats.totalCount, 10);
  assert.equal(stats.unpricedCount, 5);
  assert.equal(stats.estimatedCount, 1);
  assert.equal(stats.lowMargin, 1);
  close(stats.pctAbove50, 0.8);
  close(stats.pctBelow25, 0.2);
  pass('The dashboard average is 66.6% across five priced dishes, with five unavailable dishes and one approved estimate disclosed.');
  checked(await db.from('ingredients').update({ last_price: 0.75 })
    .eq('id', beef).eq('restaurant_id', restaurantId));
  const updated = (await loadDashboardMenuItems(db, restaurantId)).find(row => row.id === scenarios[0].id);
  assert.equal(dashboardDishFinancials({ ...updated, cost: 999 }).cost, 2);
  assert.equal(Number(checked(await db.rpc('calculate_dish_cost', { p_dish_id: updated.id })).cost), 2);
  pass('A changed fixture ingredient price updates the live plate to $2.00 without trusting a stale stored menu cost.');
  checked(await db.from('ingredients').update({ price_status: 'needs_review' })
    .eq('id', beef).eq('restaurant_id', restaurantId));
  const blocked = await loadDashboardMenuItems(db, restaurantId);
  assert.equal(dashboardDishFinancials(blocked.find(row => row.id === scenarios[0].id)).cost, null);
  assert.equal(dashboardDishFinancials(blocked.find(row => row.id === scenarios[1].id)).cost, null);
  const remaining = dashboardMarginStats(blocked, { restaurantId });
  assert.equal(remaining.pricedCount, 1);
  assert.equal(remaining.unpricedCount, 9);
  assert.equal(remaining.avgMargin, 95);
  assert.deepEqual(await loadDashboardMenuItems(db, randomUUID()), []);
  pass('Needs-review prices hide stale financial claims, and restaurant scoping cannot return another tenant’s menu.');
  assert.deepEqual(checked(await db.from('invoices').select('*').eq('restaurant_id', restaurantId).order('id')), invoices);
  assert.deepEqual(checked(await db.from('current_inventory').select('*').eq('restaurant_id', restaurantId).order('id')), stock);
  assert.equal(checked(await db.from('notification_email_outbox').select('id').eq('restaurant_id', restaurantId)).length, 0);
  pass('Financial display validation changes no invoice sources or physical inventory and queues no email.');
}