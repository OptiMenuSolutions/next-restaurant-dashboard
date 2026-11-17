import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compile } from '../lib/recipes/compile.js';

export function posFixture({ restaurantId, mustardId, today }) {
  const ids = Object.fromEntries(
    ['beef', 'chicken', 'bun', 'onion', 'dish', 'prep'].map(key => [key, randomUUID()])
  );
  ids.mustard = mustardId;
  const catalog = [
    ['beef', 'Ground Beef', 'oz'],
    ['chicken', 'Chicken Breast', 'oz'],
    ['bun', 'Bun', 'each'],
    ['onion', 'Onion', 'oz'],
    ['mustard', 'Dijon Mustard', 'fl oz'],
  ].map(([key, name, unit]) => ({ id: ids[key], name, unit }));
  const part = (key, quantity, unit, component) => ({
    ingredient_id: ids[key], name: catalog.find(row => row.id === ids[key]).name,
    quantity, unit, component,
  });
  const nodes = [
    { id: ids.prep, kind: 'prep', name: 'Validation Sauce', published: {
      yield_quantity: 8, yield_unit: 'fl oz',
      lines: [part('mustard', 8, 'fl oz'), part('onion', 2, 'oz')],
    } },
    { id: ids.dish, kind: 'dish', name: 'Validation Burger', published: {
      lines: [part('beef', 6, 'oz', 'Patty'), part('bun', 1, 'each', 'Bun'),
        part('onion', 0.5, 'oz', 'Toppings'),
        { prep_id: ids.prep, quantity: 2, unit: 'fl oz', component: 'Sauce' }],
    } },
  ];
  const compiled = compile(nodes, ids.dish);
  const recipe = compiled.map(line => ({
    id: line.ingredient_id, native: true, name: line.name,
    quantity: line.quantity, unit: line.unit,
    components: [{ name: line.component, quantity: line.quantity }],
  }));
  const requests = [
    ['extra beef', [{ action: 'add', ingredient_id: ids.beef, quantity: 6, unit: 'oz', basis: 'configured' }], []],
    ['chicken instead', [{ action: 'replace', ingredient_id: ids.beef, target_id: ids.chicken, quantity: 6, unit: 'oz', basis: 'configured' }], []],
    ['chefs choice', [], ['Confirm the ingredients and portion for chef\'s choice.']],
  ].map(([text, operations, unresolved]) => ({
    id: randomUUID(), restaurant_id: restaurantId, menu_item_id: ids.dish,
    texts: [text], texts_key: text, kind: 'change', status: 'approved',
    origin: 'admin', label: text, operations, unresolved, untracked: [],
  }));
  const specs = [
    [2, []], [1, ['no onion', 'no onion']], [1, ['extra beef']],
    [1, ['chicken instead']], [1, ['no sauce']], [-1, [], 'refund'],
    [1, [], 'sale', 'open'], [1, ['chefs choice']],
  ];
  const ticket = (index, quantity, specialRequests, type = 'sale', ticketType = 'closed') => {
    const item = { posRef: `line-${index}`, itemRef: 'validation-burger', name: 'Validation Burger',
      type, quantity, specialRequests, ticketItemModifiers: [] };
    return {
      external_ticket_id: `validation-${index}`, ticket_type: ticketType,
      business_date: today, raw: { orderNumber: String(index), ticketItems: [item] },
      lines: [{ external_line_id: item.posRef, item_name: item.name, item_ref: item.itemRef,
        line_type: type, quantity, special_requests: specialRequests, modifiers: [], discounts: [] }],
    };
  };
  return { ids, catalog, nodes, compiled, recipe, requests, ticket,
    tickets: specs.map((args, index) => ticket(index + 1, ...args)),
    expected: { beef: 36, chicken: 6, bun: 6, onion: 4.5, mustard: 10 } };
}

export async function validatePosConsumption({ db, restaurantId, ingredientId, ownerId, today, pass,
  ingestTickets = async tickets => tickets }) {
  const checked = result => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin,
    'https://hadinygxviofopdejwvj.supabase.co');
  const owner = checked(await db.from('restaurants').select('user_id,name')
    .eq('id', restaurantId).single());
  assert.equal(owner.user_id, ownerId);
  assert.match(owner.name, /^Phase 6 staging [0-9a-f-]{36}$/);
  const { saveTickets } = await import('../lib/pos/saveTickets.js');
  const { runUsage } = await import('../lib/pos/runUsage.js');
  const { inventoryPosInputs } = await import('../lib/pos/usageInventory.js');
  const { restaurantLocalDate } = await import('../lib/restaurantTime.js');
  const f = posFixture({ restaurantId, mustardId: ingredientId, today });
  const { ids } = f;
  const save = async tickets => saveTickets(db, {
    restaurantId, posSystem: 'shift4', tickets: await ingestTickets(tickets),
  });
  const stock = async () => checked(await db.from('current_inventory')
    .select('invoice_item_id,ingredient_id,unit,invoiced_qty,remaining_qty')
    .eq('restaurant_id', restaurantId).order('invoice_item_id'));
  const saved = async () => checked(await db.from('pos_usage_results').select('*')
    .eq('restaurant_id', restaurantId).single());
  const job = async () => checked(await db.from('pos_usage_jobs')
    .select('generation,claimed_generation,failures,last_error,last_finished_at,applied_publication_id')
    .eq('restaurant_id', restaurantId).single());
  const run = async () => {
    assert.equal(restaurantLocalDate('America/New_York'), today, 'Midnight crossed; rerun.');
    return runUsage(db, restaurantId);
  };
  const beforeStock = await stock();
  const mustardStock = beforeStock.filter(row => row.ingredient_id === ingredientId)
    .reduce((sum, row) => sum + Number(row.remaining_qty), 0);
  const originalLines = checked(await db.from('invoice_items').select('*')
    .eq('ingredient_id', ingredientId).order('id'));
  checked(await db.from('ingredients').insert(f.catalog.filter(row => row.id !== ingredientId)
    .map(row => ({ ...row, restaurant_id: restaurantId, standard_unit: row.unit,
      last_price: 1, is_estimated: false }))));
  checked(await db.from('menu_items').insert({ id: ids.dish, restaurant_id: restaurantId,
    name: 'Validation Burger', price: 15, category: 'Testing' }));
  const components = [...new Set(f.compiled.map(row => row.component))]
    .map(name => ({ id: randomUUID(), menu_item_id: ids.dish, name }));
  checked(await db.from('menu_item_components').insert(components));
  const portions = f.compiled.map(row => ({ id: randomUUID(),
    component_id: components.find(component => component.name === row.component).id,
    ingredient_id: row.ingredient_id, quantity: row.quantity, unit: row.unit }));
  checked(await db.from('component_ingredients').insert(portions));
  checked(await db.from('recipe_workspaces').upsert({ restaurant_id: restaurantId,
    state: { nodes: f.nodes, imports: [], method: 'manual' } }));
  const invoiceId = randomUUID();
  checked(await db.from('invoices').insert({ id: invoiceId, restaurant_id: restaurantId,
    supplier: owner.name, number: 'PHASE7-STOCK', date: today, delivery_date: today, amount: 400 }));
  checked(await db.from('invoice_items').insert(f.catalog.filter(row => row.id !== ingredientId)
    .map(row => ({ invoice_id: invoiceId, ingredient_id: row.id, item_name: row.name,
      quantity: 100, unit: row.unit, unit_cost: 1, amount: 100 }))));
  checked(await db.from('pos_usage_settings').upsert({ restaurant_id: restaurantId,
    start_date: today, enabled: true, dish_map: { 'validation-burger': ids.dish } }));
  checked(await db.from('pos_usage_requests').insert(f.requests));
  const aggregate = { id: randomUUID(), restaurant_id: restaurantId, sale_date: today,
    item_name: 'Validation Burger', quantity_sold: 6, refunds: 1, voids: 0,
    pos_system: 'shift4', upload_session_id: null };
  checked(await db.from('pos_sales').insert(aggregate));
  assert.deepEqual(await save(f.tickets),
    { tickets: 8, lines: 8 });
  pass('Eight synthetic tickets and a compiled batch recipe are isolated from live POS connections.');

  async function reconcile(expected, ready) {
    const publication = await saved();
    assert.equal(publication.usable, true);
    assert.equal(publication.ready, false);
    assert.equal(publication.report.filter(row => row.status === 'ready').length, ready);
    const blocked = publication.report.filter(row => row.status === 'blocked');
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].reason, /chef's choice/);
    const totals = Object.fromEntries(Object.keys(expected).map(key => [key, 0]));
    for (const recipe of publication.recipes) {
      for (const part of recipe.menu_item_components[0].component_ingredients) {
        const key = Object.keys(ids).find(key => ids[key] === part.ingredients.id);
        assert.ok(Object.hasOwn(totals, key), 'Unknown or foreign ingredient in usage.');
        totals[key] += Number(part.quantity);
      }
    }
    assert.deepEqual(totals, expected);
    assert.equal(new Set(publication.sales.map(row => row.id)).size, ready);
    assert.equal(publication.sales.length, publication.recipes.length);
    const actual = await stock();
    for (const [key, used] of Object.entries(expected)) {
      const left = actual.filter(row => row.ingredient_id === ids[key])
        .reduce((sum, row) => sum + Number(row.remaining_qty), 0);
      assert.ok(Math.abs(left - ((key === 'mustard' ? mustardStock : 100) - used)) < 1e-8,
        `Unexpected ${key} stock: ${left}`);
    }
    return publication;
  }
  const first = await run();
  assert.equal(first.error, null);
  assert.equal(first.applied, true);
  assert.equal(first.unresolved, 1);
  const publication = await reconcile(f.expected, 6);
  pass('The real worker publishes six ready servings and blocks the unresolved serving.');
  pass('Usage and rebuilt stock reconcile: 36 oz beef, 6 oz chicken, 6 buns, 4.5 oz onion, 10 fl oz mustard.');
  assert.equal(publication.report.filter(row => row.status === 'excluded').length, 2);
  pass('Refunds and open checks create no new ingredient consumption.');

  const settledStock = await stock();
  const settledJob = await job();
  assert.equal((await run()).skipped, true);
  assert.deepEqual(await saved(), publication);
  assert.deepEqual(await stock(), settledStock);
  assert.deepEqual(await job(), settledJob);
  pass('Repeating a completed worker changes no publication, stock, or job.');

  await save(f.tickets);
  assert.equal((await run()).error, null);
  const replay = await reconcile(f.expected, 6);
  assert.deepEqual(replay.sales.map(row => row.id).sort(), publication.sales.map(row => row.id).sort());
  assert.deepEqual(await stock(), settledStock);
  pass('Resyncing the same tickets replaces source lines without double deductions.');

  const beefPortion = portions.find(row => row.ingredient_id === ids.beef);
  checked(await db.from('component_ingredients').update({ quantity: 8 })
    .eq('id', beefPortion.id).eq('component_id', beefPortion.component_id));
  assert.equal((await run()).error, null);
  await reconcile(f.expected, 6);
  pass('A current recipe edit preserves the captured recipe of previously prepared sales.');

  const ninth = f.ticket(9, 1, []);
  await save([ninth]);
  checked(await db.from('pos_sales').update({ quantity_sold: 7 })
    .eq('id', aggregate.id).eq('restaurant_id', restaurantId));
  assert.equal((await run()).error, null);
  const next = { beef: 44, chicken: 6, bun: 7, onion: 5.5, mustard: 12 };
  await reconcile(next, 7);
  pass('A new ticket uses the edited eight-ounce recipe while older tickets keep six ounces.');

  const corrected = f.ticket(1, 1, []);
  await save([corrected]);
  checked(await db.from('pos_sales').update({ quantity_sold: 6 })
    .eq('id', aggregate.id).eq('restaurant_id', restaurantId));
  assert.equal((await run()).error, null);
  const correctedExpected = { beef: 38, chicken: 6, bun: 6, onion: 4.5, mustard: 10 };
  const good = await reconcile(correctedExpected, 6);
  pass('Correcting a previously synced quantity replaces its deduction exactly once.');

  const goodStock = await stock();
  checked(await db.from('pos_sales').update({ quantity_sold: 7 })
    .eq('id', aggregate.id).eq('restaurant_id', restaurantId));
  const failure = await run();
  assert.match(failure.error, /Tickets and aggregated sales disagree/);
  assert.equal(failure.applied, false);
  assert.deepEqual(await saved(), good);
  assert.deepEqual(await stock(), goodStock);
  assert.ok((await job()).last_error.includes('Tickets and aggregated sales disagree'));
  await assert.rejects(inventoryPosInputs(db, restaurantId, today, [], []), /Inventory preserved/);
  pass('A coverage failure preserves the last publication and stock and records a retryable job error.');

  checked(await db.from('pos_sales').update({ quantity_sold: 6 })
    .eq('id', aggregate.id).eq('restaurant_id', restaurantId));
  assert.equal((await run()).error, null);
  await reconcile(correctedExpected, 6);
  assert.equal((await job()).last_error, null);
  pass('Correcting the source lets the real worker recover without duplicate consumption.');

  const current = await saved();
  const stale = await db.rpc('publish_pos_usage', { p_restaurant_id: restaurantId,
    p_lease: randomUUID(), p_result: current });
  assert.ok(stale.error);
  assert.deepEqual(await saved(), current);
  assert.deepEqual(await stock(), goodStock);
  pass('A stale worker lease cannot overwrite the saved publication or stock.');

  assert.deepEqual(checked(await db.from('invoice_items').select('*')
    .eq('ingredient_id', ingredientId).order('id')), originalLines);
  assert.equal(checked(await db.from('notification_email_outbox').select('id')
    .eq('restaurant_id', restaurantId)).length, 0);
  assert.equal(checked(await db.from('ai_usage').select('id')
    .eq('restaurant_id', restaurantId)).length, 0);
  assert.equal(checked(await db.from('pos_connections').select('id')
    .eq('restaurant_id', restaurantId)).length, 0);
  pass('Source invoice lines stay unchanged; no AI request, email, or live POS connection is used.');
}