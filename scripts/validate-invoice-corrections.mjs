import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const STAGING_URL = 'https://hadinygxviofopdejwvj.supabase.co';
const CEDAR_ID = '30f6f319-6d2c-498d-bd49-f24be4bffe8d';
const TIMEZONE = 'America/New_York';

assert.ok(process.argv.includes('--run'), 'Pass --run explicitly.');
assert.equal(
  process.env.OPTIMENU_TEST_SUPABASE_URL || STAGING_URL,
  STAGING_URL,
  'Only the optimenu-development branch is allowed.'
);

const key = process.env.OPTIMENU_TEST_SUPABASE_SECRET_KEY;
assert.ok(key, 'Development secret key is missing.');

// Set these before importing application modules that create DB clients.
process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;
process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = 'false';

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url
  );

  if (
    url.origin !== STAGING_URL ||
    !/^\/(rest\/v1|auth\/v1\/admin)(\/|$)/.test(url.pathname)
  ) {
    throw new Error('Blocked a request outside the staging test APIs.');
  }

  return originalFetch(input, options);
};

const db = createClient(STAGING_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const invoiceIds = [];
const ingredientId = randomUUID();
const dishId = randomUUID();
const componentId = randomUUID();
const fixtureName = `Phase 6 staging ${randomUUID()}`;
let ownerId;
let restaurantId;
let passed = 0;

function pass(message) {
  passed++;
  console.log(`PASS ${passed}: ${message}`);
}

async function cleanup(expectedName = fixtureName) {
  if (!ownerId) return;

  assert.match(expectedName, /^Phase 6 staging [0-9a-f-]{36}$/);

  const restaurants = checked(await db.from('restaurants')
    .select('id,name,user_id')
    .eq('user_id', ownerId));
  const profile = checked(await db.from('profiles')
    .select('id,restaurant_id').eq('id', ownerId).maybeSingle());
  const account = await db.auth.admin.getUserById(ownerId);

  if (account.error) {
    assert.equal(account.error.status, 404, account.error.message);
    assert.equal(restaurants.length, 0);
    assert.equal(profile, null);
    return;
  }

  assert.equal(account.data.user.id, ownerId);
  assert.match(account.data.user.email,
    /^phase6-[0-9a-f-]{36}@example\.invalid$/);
  assert.ok(restaurants.length <= 1, 'Fixture owner has unexpected restaurants.');

  for (const restaurant of restaurants) {
    const rid = restaurant.id;
    assert.equal(restaurant.name, expectedName);
    assert.equal(restaurant.user_id, ownerId);
    assert.notEqual(rid, CEDAR_ID);
    if (restaurantId) assert.equal(rid, restaurantId);
    assert.equal(profile?.restaurant_id, rid);

    checked(await db.from('invoice_match_rejections').delete()
      .eq('restaurant_id', rid).eq('reason', expectedName)
      .eq('rejected_by', ownerId));
    checked(await db.from('invoice_match_decision_audit').delete()
      .eq('restaurant_id', rid).eq('reason', expectedName)
      .eq('admin_id', ownerId));

    // Use the existing account-purge transaction; audit DELETE stays restricted.
    checked(await db.rpc('purge_restaurant', { target: rid }));

    assert.equal(checked(await db.from('restaurants').select('id')
      .eq('id', rid).maybeSingle()), null);
  }

  if (restaurants.length === 0) {
    assert.equal(profile, null);
    checked(await db.auth.admin.deleteUser(ownerId));
  }

  assert.equal(checked(await db.from('profiles').select('id')
    .eq('id', ownerId).maybeSingle()), null);
  const removed = await db.auth.admin.getUserById(ownerId);
  assert.equal(removed.error?.status, 404,
    'Disposable authentication account was not removed.');
}

const recoveryIndex = process.argv.indexOf('--cleanup-existing');
if (recoveryIndex !== -1) {
  const recoveryArgs = process.argv.slice(recoveryIndex + 1);
  assert.equal(recoveryArgs.length, 3,
    'Pass the restaurant ID, owner ID, and exact fixture name.');
  [restaurantId, ownerId] = recoveryArgs;
  for (const id of [restaurantId, ownerId]) {
    assert.match(id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  }

  try {
    await cleanup(recoveryArgs[2]);
    console.log('PASS: Previous staging fixture and account removed.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  process.exit(0);
}

let failure;

try {
  const cedarBefore = checked(await db.from('restaurants')
    .select('id,name,operational_timezone').eq('id', CEDAR_ID).single());
  assert.equal(cedarBefore.name, 'Cedar Test Bistro');

  const { processInvoiceCalculations } =
    await import('../lib/admin/processInvoiceCalculations.js');
  const { restaurantLocalDate } = await import('../lib/restaurantTime.js');
  assert.equal(typeof processInvoiceCalculations, 'function');

  const startedAt = Date.now();
  const today = restaurantLocalDate(TIMEZONE);
  const shift = days => new Date(
    Date.parse(`${today}T00:00:00Z`) + days * 86400000
  ).toISOString().slice(0, 10);
  const older = shift(-2);
  const printedDate = shift(-1);
  const future = shift(2);

  const user = checked(await db.auth.admin.createUser({
    email: `phase6-${randomUUID()}@example.invalid`,
    email_confirm: true,
  }));
  ownerId = user.user.id;

  checked(await db.from('profiles').insert({
    id: ownerId,
    email: user.user.email,
    full_name: 'Disposable staging fixture',
    restaurant_name: fixtureName,
    role: 'client',
  }));

  const restaurant = checked(await db.from('restaurants')
    .select('id').eq('user_id', ownerId).eq('name', fixtureName).single());
  restaurantId = restaurant.id;
  console.log('Disposable fixture:', { restaurantId, ownerId });

  checked(await db.from('restaurants').update({
    operational_timezone: TIMEZONE,
    notif_weekly_summary: false,
    notif_price_alerts: false,
    notif_low_margin: false,
  }).eq('id', restaurantId).eq('user_id', ownerId));

  checked(await db.from('restaurant_invoice_matching_controls').update({
    status: 'legacy_enabled',
    activation_reason: fixtureName,
  }).eq('restaurant_id', restaurantId));

  checked(await db.from('ingredients').insert({
    id: ingredientId,
    restaurant_id: restaurantId,
    name: 'Dijon Mustard',
    unit: 'fl oz',
    standard_unit: 'fl oz',
    ingredient_category: 'volume',
    last_price: 0.20,
    price_status: 'invoice',
    is_estimated: false,
  }));

  checked(await db.from('menu_items').insert({
    id: dishId,
    restaurant_id: restaurantId,
    name: 'Staging Mustard Dish',
    price: 10,
    category: 'Testing',
  }));
  checked(await db.from('menu_item_components').insert({
    id: componentId, menu_item_id: dishId, name: 'Sauce',
  }));
  checked(await db.from('component_ingredients').insert({
    component_id: componentId,
    ingredient_id: ingredientId,
    quantity: 2,
    unit: 'fl oz',
  }));

  async function saveInvoice(date, deliveryDate, unitPrice) {
    const id = randomUUID();
    const lineId = randomUUID();
    invoiceIds.push(id);

    // Trusted synthetic verification for this isolated fixture only.
    const result = checked(await db.rpc('save_invoice_confirmation_transactional', {
      p_restaurant_id: restaurantId,
      p_request_id: randomUUID(),
      p_request_fingerprint: createHash('sha256').update(id).digest('hex'),
      p_append_to_invoice_id: null,
      p_invoice: {
        id, supplier: fixtureName, number: id,
        date, delivery_date: deliveryDate, amount: unitPrice,
      },
      p_files: [],
      p_lines: [{
        id: lineId, invoice_id: id, ingredient_id: ingredientId,
        item_name: 'Dijon Mustard', quantity: 1, unit: 'qt',
        unit_cost: unitPrice, amount: unitPrice,
        price_verification_status: 'verified',
        price_verification_source: 'synthetic_staging_fixture',
        price_verified_at: new Date().toISOString(),
        price_verification_evidence: { fixture: fixtureName },
      }],
      p_evidence: [],
      p_queue_calculations: true,
    }));

    assert.equal(result.success, true);
    assert.equal(result.invoice_id, id);
    return { id, lineId, deliveryDate };
  }

  const job = async () => checked(await db.from('invoice_calculation_jobs')
    .select('*').eq('restaurant_id', restaurantId).single());
  const audits = async () => checked(await db.from('invoice_delivery_date_audit')
    .select('*').eq('restaurant_id', restaurantId).order('created_at').order('id'));

  async function processJobs(dependencies = {}) {
    assert.equal(restaurantLocalDate(TIMEZONE), today,
      'Midnight crossed during the test; rerun with fresh fixture dates.');
    return processInvoiceCalculations(db, restaurantId, {
      reportError: async () => {},
      ...dependencies,
    });
  }

  async function expectState(price, cost, deliveries) {
    const [ingredient, dish, inventory, state] = await Promise.all([
      db.from('ingredients').select('*')
        .eq('restaurant_id', restaurantId).eq('id', ingredientId).single(),
      db.from('menu_items').select('*')
        .eq('restaurant_id', restaurantId).eq('id', dishId).single(),
      db.from('current_inventory').select('*')
        .eq('restaurant_id', restaurantId).order('invoice_id'),
      job(),
    ]);
    const ing = checked(ingredient);
    const menu = checked(dish);
    const rows = checked(inventory);
    assert.equal(Number(ing.last_price), price);
    assert.equal(ing.price_status, 'invoice');
    assert.equal(ing.is_estimated, false);
    assert.equal(ing.last_ordered_at, price === 0.25 ? today : older);
    assert.equal(Number(menu.cost), cost);
    assert.equal(menu.cost_status, 'ready');
    assert.deepEqual(rows.map(row => row.invoice_id).sort(),
      deliveries.map(row => row.id).sort());

    for (const row of rows) {
      assert.equal(row.ingredient_id, ingredientId);
      assert.equal(row.unit, 'fl oz');
      assert.equal(Number(row.invoiced_qty), 32);
      assert.equal(Number(row.remaining_qty), 32);
      assert.equal(row.delivery_date,
        deliveries.find(delivery => delivery.id === row.invoice_id).deliveryDate);
      assert.ok(row.delivery_date <= today);
    }

    assert.equal(String(state.completed_generation), String(state.generation));
    assert.equal(state.last_error, null);
    assert.equal(state.lease_token, null);
    assert.equal(state.lease_until, null);
  }

  async function correct(invoice, expected, next) {
    return db.rpc('correct_invoice_delivery_date', {
      p_restaurant_id: restaurantId,
      p_invoice_id: invoice.id,
      p_actor_id: ownerId,
      p_expected_delivery_date: expected,
      p_delivery_date: next,
      p_queue_calculations: true,
    });
  }

  const baseline = await saveInvoice(older, older, 6.40);
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline]);
  pass('Delivered invoice sets $0.20/fl oz, $0.40 dish cost, and 32 fl oz stock.');

  const incoming = await saveInvoice(printedDate, future, 8);
  const lineBefore = checked(await db.from('invoice_items').select('*')
    .eq('invoice_id', incoming.id).eq('id', incoming.lineId).single());
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline]);
  pass('Future delivery changes neither current pricing nor inventory.');

  const moved = checked(await correct(incoming, future, today));
  assert.equal(moved.changed, true);
  assert.equal(moved.calculations_queued, true);
  assert.equal(moved.invoice.date, printedDate);
  incoming.deliveryDate = today;
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.25, 0.50, [baseline, incoming]);
  pass('Moving delivery to today updates price, dish cost, and both stock lots.');

  const savedAudit = await audits();
  assert.equal(savedAudit.length, 1);
  assert.equal(savedAudit[0].original_invoice_date, printedDate);
  assert.equal(savedAudit[0].old_delivery_date, future);
  assert.equal(savedAudit[0].new_delivery_date, today);
  assert.equal(savedAudit[0].actor_id, ownerId);
  assert.deepEqual(checked(await db.from('invoice_items').select('*')
    .eq('invoice_id', incoming.id).eq('id', incoming.lineId).single()), lineBefore);
  pass('Audit preserves the printed invoice date; line and verification stay unchanged.');

  const settled = await job();
  const historyBefore = checked(await db.from('menu_item_cost_history').select('*')
    .eq('restaurant_id', restaurantId).eq('menu_item_id', dishId).order('id'));
  const replay = checked(await correct(incoming, future, today));
  assert.equal(replay.changed, false);
  assert.equal(replay.calculations_queued, false);
  assert.equal((await processJobs()).skipped, true);
  assert.deepEqual(await job(), settled);
  assert.deepEqual(await audits(), savedAudit);
  assert.deepEqual(checked(await db.from('menu_item_cost_history').select('*')
    .eq('restaurant_id', restaurantId).eq('menu_item_id', dishId).order('id')), historyBefore);
  await expectState(0.25, 0.50, [baseline, incoming]);
  pass('Same-date retry and repeated worker create no duplicate work or history.');

  const stale = await correct(incoming, future, printedDate);
  assert.equal(stale.error?.code, 'PT409', JSON.stringify(stale));
  assert.equal(stale.status, 409);
  const foreign = await db.rpc('correct_invoice_delivery_date', {
    p_restaurant_id: CEDAR_ID, p_invoice_id: incoming.id,
    p_actor_id: ownerId, p_expected_delivery_date: today,
    p_delivery_date: future, p_queue_calculations: true,
  });
  assert.equal(foreign.error?.code, '42501');
  assert.deepEqual(await job(), settled);
  assert.deepEqual(await audits(), savedAudit);
  pass('Stale edits and cross-restaurant corrections fail without saved changes.');

  checked(await correct(incoming, today, future));
  incoming.deliveryDate = future;
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline]);
  pass('Postponing delivery restores the older eligible price and removes future stock.');

  const late = await saveInvoice(shift(-3), shift(-3), 3.20);
  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.20, 0.40, [baseline, late]);
  pass('Uploading an older invoice adds its stock without rolling back the newer price.');

  checked(await correct(incoming, future, today));
  incoming.deliveryDate = today;
  const failed = await processJobs({
    reprice: async () => { throw new Error('Synthetic staging pricing failure'); },
  });
  assert.ok(failed.errors.some(error => error.includes('Synthetic staging pricing failure')));
  const pending = await job();
  assert.ok(BigInt(pending.completed_generation) < BigInt(pending.generation));
  assert.ok(pending.last_error.includes('Synthetic staging pricing failure'));
  assert.equal(pending.lease_token, null);
  assert.equal(pending.lease_until, null);
  const stockDuringFailure = checked(await db.from('current_inventory')
    .select('invoice_id').eq('restaurant_id', restaurantId));
  assert.deepEqual(stockDuringFailure.map(row => row.invoice_id).sort(), invoiceIds.slice().sort());
  pass('A controlled pricing failure remains pending while inventory still rebuilds.');

  assert.deepEqual((await processJobs()).errors, []);
  await expectState(0.25, 0.50, [baseline, incoming, late]);
  pass('A real retry completes pricing and dish costs and clears the saved error.');

  const history = checked(await db.from('menu_item_cost_history').select('created_at')
    .eq('restaurant_id', restaurantId).eq('menu_item_id', dishId));
  assert.ok(history.length > 0);
  assert.ok(history.every(row => Date.parse(row.created_at) >= startedAt - 1000));
  const finalInvoice = checked(await db.from('invoices').select('date,delivery_date')
    .eq('restaurant_id', restaurantId).eq('id', incoming.id).single());
  assert.equal(finalInvoice.date, printedDate);
  assert.equal(finalInvoice.delivery_date, today);
  assert.deepEqual(checked(await db.from('restaurants')
    .select('id,name,operational_timezone').eq('id', CEDAR_ID).single()), cedarBefore);
  assert.equal(checked(await db.from('notification_email_outbox').select('id')
    .eq('restaurant_id', restaurantId)).length, 0);
  pass('Cost history uses calculation time; Cedar stays unchanged; no email is queued.');

  if (process.argv.includes('--evidence-integrity')) {
    const { validateInvoiceEvidenceIntegrity } =
      await import('./validate-invoice-evidence-integrity.mjs');
    await validateInvoiceEvidenceIntegrity({
      db, restaurantId, ownerId, fixtureName, cedarId: CEDAR_ID,
      today, printedDate, future, baseline, incoming, late,
      processJobs, expectState, job, pass,
    });
  }

  if (process.argv.includes('--correction-queue')) {
    const { validateInvoiceCorrectionQueue } =
      await import('./validate-invoice-correction-queue.mjs');
    await validateInvoiceCorrectionQueue({
      db, restaurantId, ownerId, fixtureName, cedarId: CEDAR_ID,
      ingredientId, invoiceIds, baseline, incoming, late, expectState, pass,
    });
  }

  if (process.argv.includes('--historical-concurrency')) {
    const { validateHistoricalMatchConcurrency } =
      await import('./validate-historical-match-concurrency.mjs');
    await validateHistoricalMatchConcurrency({
      db, restaurantId, ownerId, fixtureName, cedarId: CEDAR_ID,
      ingredientId, invoiceIds, printedDate, future, baseline, incoming, late,
      expectState, job, pass,
    });
  }

  if (process.argv.includes('--match-concurrency')) {
    const { validateInvoiceMatchConcurrency } =
      await import('./validate-invoice-match-concurrency.mjs');
    await validateInvoiceMatchConcurrency({
      db, restaurantId, ownerId, fixtureName, cedarId: CEDAR_ID,
      ingredientId, invoiceIds, baseline, incoming, late,
      expectState, job, pass,
    });
  }

  if (process.argv.includes('--concurrency')) {
    const { validateInvoiceConcurrency } =
      await import('./validate-invoice-concurrency.mjs');
    await validateInvoiceConcurrency({
      db, restaurantId, ownerId, fixtureName, cedarId: CEDAR_ID,
      ingredientId, invoiceIds, today, printedDate, future,
      baseline, incoming, late, correct, processJobs,
      expectState, job, audits, pass,
    });
  }

  if (process.argv.includes('--deletions')) {
    const { validateInvoiceDeletions } =
      await import('./validate-invoice-deletions.mjs');
    await validateInvoiceDeletions({
      db, restaurantId, ownerId, fixtureName, cedarId: CEDAR_ID,
      ingredientId, dishId, invoiceIds, today, printedDate, future,
      baseline, incoming, late, saveInvoice, processJobs,
      expectState, job, audits, pass,
    });
  }
} catch (error) {
  failure = error;
} finally {
  try {
    await cleanup();
    if (ownerId) pass('Disposable restaurant, profile, user, and test records removed.');
  } catch (error) {
    console.error('Cleanup failed. Fixture IDs:', { restaurantId, ownerId });
    failure = new AggregateError(
      [failure, error].filter(Boolean), 'Staging validation or cleanup failed.'
    );
  }
  globalThis.fetch = originalFetch;
}

if (failure) throw failure;
console.log(`${passed} / ${passed} staging checks passed.`);