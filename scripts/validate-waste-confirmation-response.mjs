import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { saveWasteConfirmationResponse } from '../lib/saveWasteConfirmationResponse.js';
import { createRebuildAfterConfirmationHandler } from '../pages/api/inventory/rebuild-after-confirmation.js';

const STAGING_URL = 'https://hadinygxviofopdejwvj.supabase.co';
const checked = result => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

export async function validateWasteConfirmationResponse({ db, restaurantId, ownerId,
  ingredientId, today, pass }) {
  assert.equal(db.supabaseUrl, STAGING_URL);
  const restaurant = checked(await db.from('restaurants').select('name,user_id')
    .eq('id', restaurantId).single());
  assert.equal(restaurant.user_id, ownerId);
  assert.match(restaurant.name, /^Phase 6 staging [0-9a-f-]{36}$/);
  const { rebuildCurrentInventory } = await import('../lib/currentInventory.js');
  const { restaurantLocalDate } = await import('../lib/restaurantTime.js');
  const primary = checked(await db.auth.admin.getUserById(ownerId)).user;
  assert.match(primary.email, /^phase6-[0-9a-f-]{36}@example\.invalid$/);
  const clients = [];
  let otherId;
  let otherRestaurantId;
  let failure;
  const otherName = `Phase 6 staging ${randomUUID()}`;

  async function signIn(user, password) {
    const client = createClient(STAGING_URL, process.env.OPTIMENU_TEST_SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    const signed = checked(await client.auth.signInWithPassword({ email: user.email, password }));
    assert.equal(signed.user.id, user.id);
    assert.ok(signed.session?.access_token, 'Disposable sign-in did not return a session.');
    return { client, token: signed.session.access_token };
  }
  async function invoke(token, confirmationId, rebuild) {
    assert.equal(restaurantLocalDate('America/New_York'), today, 'Midnight crossed; rerun.');
    const result = {};
    await createRebuildAfterConfirmationHandler({ db, ...(rebuild ? { rebuild } : {}) })({
      method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {},
      body: { confirmation_id: confirmationId },
    }, {
      setHeader() {},
      status(value) { result.status = value; return this; },
      json(value) { result.body = value; return this; },
    });
    return result;
  }
  const stock = async () => checked(await db.from('current_inventory')
    .select('invoice_item_id,remaining_qty,unit_cost').eq('restaurant_id', restaurantId)
    .order('invoice_item_id'));
  const confirmation = async id => checked(await db.from('waste_confirmations')
    .select('*').eq('restaurant_id', restaurantId).eq('id', id).single());

  try {
    const password = randomBytes(32).toString('base64url');
    checked(await db.auth.admin.updateUserById(ownerId, { password }));
    const owner = await signIn(primary, password);
    const otherPassword = randomBytes(32).toString('base64url');
    const other = checked(await db.auth.admin.createUser({
      email: `phase6-${randomUUID()}@example.invalid`, email_confirm: true, password: otherPassword,
    })).user;
    otherId = other.id;
    checked(await db.from('profiles').insert({ id: otherId, email: other.email,
      full_name: 'Disposable waste fixture', restaurant_name: otherName, role: 'client' }));
    otherRestaurantId = checked(await db.from('restaurants').select('id')
      .eq('user_id', otherId).eq('name', otherName).single()).id;
    console.log('Disposable second fixture:', { restaurantId: otherRestaurantId, ownerId: otherId });
    checked(await db.from('restaurants').update({ operational_timezone: 'America/New_York',
      notif_weekly_summary: false, notif_price_alerts: false, notif_low_margin: false })
      .eq('id', otherRestaurantId).eq('user_id', otherId));
    const foreign = await signIn(other, otherPassword);
    pass('Two disposable owners sign in through real development authentication; no credentials are printed.');

    const invoiceId = randomUUID();
    const statuses = ['confirmed_wasted', 'confirmed_used', 'kept', 'not_sure'];
    const events = statuses.map((status, index) => ({ id: randomUUID(), lineId: randomUUID(),
      status, quantity: [8, 6, 4, 2][index] }));
    checked(await db.from('invoices').insert({ id: invoiceId, restaurant_id: restaurantId,
      supplier: restaurant.name, number: 'WASTE-RESPONSES', date: today, delivery_date: today, amount: 32 }));
    checked(await db.from('invoice_items').insert(events.map(event => ({ id: event.lineId,
      invoice_id: invoiceId, ingredient_id: ingredientId, item_name: 'Dijon Mustard',
      quantity: 1, unit: 'qt', unit_cost: 8, amount: 8 }))));
    checked(await db.from('waste_confirmations').insert(events.map(event => ({ id: event.id,
      restaurant_id: restaurantId, invoice_item_id: event.lineId, ingredient_name: 'Dijon Mustard',
      delivery_date: today, last_seen_date: today, presumed_qty: event.quantity,
      presumed_value: event.quantity * 0.25,
      status: event.status === 'confirmed_used' ? 'expired_unconfirmed' : 'pending' }))));
    await rebuildCurrentInventory(db, restaurantId);
    const original = await stock();
    for (const event of events) assert.equal(original.find(row => row.invoice_item_id === event.lineId)?.remaining_qty, 32);
    const source = checked(await db.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('id'));
    const first = events[0];
    const untouched = await confirmation(first.id);

    assert.equal((await invoke(null, first.id)).status, 401);
    assert.equal((await invoke(owner.token, first.id)).status, 409);
    assert.deepEqual(await stock(), original);
    assert.deepEqual(await confirmation(first.id), untouched);
    pass('Anonymous and unanswered-confirmation requests cannot rebuild or change saved responses.');

    for (const patch of [{ presumed_qty: 99 }, { confirmed_by: otherId }, { adjustment_qty: 99 }]) {
      const rejected = await owner.client.from('waste_confirmations').update(patch)
        .eq('id', first.id).eq('restaurant_id', restaurantId);
      assert.ok(rejected.error, 'Authenticated owners must not update protected columns.');
    }
    assert.deepEqual(await confirmation(first.id), untouched);
    pass('The authenticated owner cannot spoof quantities, adjustment metadata, or response identity.');

    assert.deepEqual(checked(await foreign.client.from('waste_confirmations').select('id')
      .eq('id', first.id)), []);
    await assert.rejects(saveWasteConfirmationResponse(foreign.client, restaurantId, first.id, 'kept'),
      /not found or access denied/);
    assert.equal((await invoke(foreign.token, first.id)).status, 404);
    assert.deepEqual(await confirmation(first.id), untouched);
    assert.deepEqual(await stock(), original);
    pass('Another signed-in restaurant cannot read, answer, or rebuild this restaurant’s confirmation.');

    for (const event of events) {
      const saved = await saveWasteConfirmationResponse(owner.client, restaurantId, event.id, event.status);
      assert.equal(saved.already_saved, false);
      const record = await confirmation(event.id);
      assert.equal(record.status, event.status);
      assert.equal(record.confirmed_by, ownerId);
      assert.ok(Number.isFinite(Date.parse(record.confirmed_at)));
      assert.equal(record.presumed_qty, event.quantity);
      assert.equal(record.presumed_value, event.quantity * 0.25);
      assert.equal(record.confirmed_waste_qty, null);
      const reduces = ['confirmed_wasted', 'confirmed_used'].includes(event.status);
      assert.equal(record.adjustment_qty, reduces ? event.quantity : null);
      assert.equal(record.kept_days, event.status === 'kept' ? 1 : 0);
      if (reduces) assert.equal(record.days_lasted, 0);
      assert.equal((await saveWasteConfirmationResponse(owner.client, restaurantId, event.id, event.status))
        .already_saved, true);
      assert.deepEqual(await confirmation(event.id), record);
      await assert.rejects(saveWasteConfirmationResponse(owner.client, restaurantId, event.id,
        event.status === 'kept' ? 'confirmed_used' : 'kept'), /different response/);
      assert.deepEqual(await confirmation(event.id), record);
      pass(`${event.status}: the real owner response records its actor once; identical and conflicting retries preserve it.`);

      if (event === first) {
        const failed = await invoke(owner.token, event.id, async () => {
          throw new Error('Synthetic owner-response inventory failure');
        });
        assert.equal(failed.status, 500);
        assert.deepEqual(await stock(), original);
        assert.deepEqual(await confirmation(event.id), record);
        pass('A controlled rebuild failure preserves the committed answer and previously committed stock.');
      }
      assert.equal((await invoke(owner.token, event.id)).status, 200);
      const rebuilt = await stock();
      assert.equal(rebuilt.find(row => row.invoice_item_id === event.lineId)?.remaining_qty,
        reduces ? 32 - event.quantity : 32);
      assert.equal((await invoke(owner.token, event.id)).status, 200);
      assert.deepEqual(await stock(), rebuilt);
      assert.deepEqual(await confirmation(event.id), record);
    }
    pass('Real authenticated rebuilds apply used and wasted adjustments once; kept and uncertain stock remains.');
    const finalStock = await stock();
    assert.deepEqual(finalStock.filter(row => !events.some(event => event.lineId === row.invoice_item_id)),
      original.filter(row => !events.some(event => event.lineId === row.invoice_item_id)));
    assert.deepEqual(checked(await db.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('id')), source);
    assert.equal(checked(await db.from('notification_email_outbox').select('id')
      .eq('restaurant_id', restaurantId)).length, 0);
    pass('Original stock and printed invoice lines stay unchanged; modeled responses do not become measured waste or queue email.');
  } catch (error) {
    failure = error;
  } finally {
    try {
      let signOutFailure;
      for (const client of clients) {
        try { checked(await client.auth.signOut({ scope: 'local' })); }
        catch (error) { signOutFailure ||= error; }
      }
      if (otherId) {
        const restaurants = checked(await db.from('restaurants').select('id,name,user_id').eq('user_id', otherId));
        const profile = checked(await db.from('profiles').select('restaurant_id').eq('id', otherId).maybeSingle());
        const account = checked(await db.auth.admin.getUserById(otherId)).user;
        assert.match(account.email, /^phase6-[0-9a-f-]{36}@example\.invalid$/);
        assert.ok(restaurants.length <= 1);
        for (const row of restaurants) {
          assert.equal(row.name, otherName);
          assert.equal(row.user_id, otherId);
          assert.notEqual(row.id, restaurantId);
          assert.equal(row.id, profile?.restaurant_id);
          if (otherRestaurantId) assert.equal(row.id, otherRestaurantId);
          checked(await db.rpc('purge_restaurant', { target: row.id }));
        }
        if (!restaurants.length) {
          assert.equal(profile, null);
          checked(await db.auth.admin.deleteUser(otherId));
        }
        assert.equal((await db.auth.admin.getUserById(otherId)).error?.status, 404);
        assert.equal(checked(await db.from('profiles').select('id').eq('id', otherId).maybeSingle()), null);
        assert.deepEqual(checked(await db.from('restaurants').select('id').eq('user_id', otherId)), []);
        pass('Disposable second restaurant, profile, sign-ins, and authentication account removed.');
      }
      if (signOutFailure) throw signOutFailure;
    } catch (error) {
      console.error('Second fixture cleanup failed:', { restaurantId: otherRestaurantId, ownerId: otherId, fixtureName: otherName });
      failure = new AggregateError([failure, error].filter(Boolean), 'Waste validation or cleanup failed.');
    }
  }
  if (failure) throw failure;
}