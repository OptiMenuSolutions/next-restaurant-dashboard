// lib/pos/saveMenu.js
//
// Saves one POS Menu v2 pull (Shift4) into pos_menu_categories, pos_menu_items,
// pos_modifier_sets and pos_modifiers. Safe to re-run: every row upserts on
// (restaurant_id, pos_system, external_id).
//
// Also:
//   - items that were in an earlier pull but not this one get removed_at
//     (deleted in the POS); an item that comes back has removed_at cleared
//   - unlinked active items are linked to an OptiMenu dish when exactly one
//     active menu_items row has the same name (case and spacing ignored)
//
// Returns { categories, items, modifierSets, modifiers, added, removed, linked }.

const cents = (v) => (v == null ? null : Math.round(Number(v)) / 100);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// A category name and its singular: "Salads" -> salads, salad; "Sandwiches" -> sandwich.
function categoryWords(category) {
  const c = norm(category);
  if (!c) return [];
  const forms = new Set([c]);
  if (/(ches|shes|xes|sses)$/.test(c)) forms.add(c.slice(0, -2));
  else if (c.endsWith('s') && !c.endsWith('ss')) forms.add(c.slice(0, -1));
  return [...forms];
}

// The POS name, then the POS name without a trailing section word, since printed
// menus often drop it ("Classic Pizza" under Pizza is printed as "Classic").
function nameCandidates(name, category) {
  const n = norm(name);
  const out = [{ key: n, stripped: false }];
  for (const w of categoryWords(category)) {
    if (n.endsWith(` ${w}`) && n.length > w.length + 1) {
      out.push({ key: n.slice(0, -(w.length + 1)).trim(), stripped: true });
    }
  }
  return out;
}

async function upsertChunks(supabase, table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + 500), { onConflict: 'restaurant_id,pos_system,external_id' });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

export async function saveMenu(supabase, { restaurantId, posSystem, menu }) {
  const now = new Date().toISOString();
  const base = { restaurant_id: restaurantId, pos_system: posSystem };

  const categories = menu?.categories || [];
  const items = menu?.items || [];
  const sets = menu?.modifierSets || [];
  const modifiers = menu?.modifiers || [];

  // Items do not name their category; categories list their items. An item in
  // more than one category takes the first active one.
  const categoryOf = new Map();
  for (const c of [...categories].sort((a, b) => Number(!!b.isActive) - Number(!!a.isActive))) {
    for (const ref of c.items || []) {
      if (!categoryOf.has(ref)) categoryOf.set(ref, { ref: c.posRef, name: c.name || null });
    }
  }

  await upsertChunks(supabase, 'pos_menu_categories', categories.map((c) => ({
    ...base,
    external_id: String(c.posRef),
    name: c.name || null,
    is_active: !!c.isActive,
    item_refs: (c.items || []).map(String),
    synced_at: now,
  })));

  await upsertChunks(supabase, 'pos_modifier_sets', sets.map((s) => ({
    ...base,
    external_id: String(s.posRef),
    name: s.name || null,
    is_active: !!s.isActive,
    min_select: s.minModifiersPerSet ?? null,
    max_select: s.maxModifiersPerSet ?? null,
    modifier_refs: (s.modifiers || []).map(String),
    synced_at: now,
  })));

  await upsertChunks(supabase, 'pos_modifiers', modifiers.map((m) => ({
    ...base,
    external_id: String(m.posRef),
    name: m.name || null,
    is_active: !!m.isActive,
    // A modifier can cost different amounts in different sets.
    prices: (m.prices || []).map((p) => ({
      set_ref: p.modifierSetRef || null,
      price: p.price?.type === 'amount' ? cents(p.price.amount) : null,
      percent: p.price?.type === 'percent' ? p.price.percent : null,
    })),
    modifier_set_refs: (m.modifierSets || []).map(String),
    synced_at: now,
  })));

  // Which items we already had, to report new ones and mark deleted ones.
  const { data: existing, error: existingError } = await supabase
    .from('pos_menu_items')
    .select('id, external_id, removed_at')
    .eq('restaurant_id', restaurantId)
    .eq('pos_system', posSystem);
  if (existingError) throw new Error(`pos_menu_items read failed: ${existingError.message}`);
  const known = new Map((existing || []).map((r) => [r.external_id, r]));

  const pulledIds = new Set(items.map((it) => String(it.posRef)));
  const added = items.filter((it) => !known.has(String(it.posRef))).length;

  await upsertChunks(supabase, 'pos_menu_items', items.map((it) => {
    const cat = categoryOf.get(it.posRef);
    return {
      ...base,
      external_id: String(it.posRef),
      name: (it.name || '').trim() || null,
      price: cents(it.price),
      is_active: !!it.isActive,
      category_ref: cat?.ref || null,
      category_name: cat?.name || null,
      modifier_set_refs: (it.modifierSets || []).map(String),
      last_seen_at: now,
      removed_at: null,
    };
  }));

  // Gone from the POS since the last pull.
  const goneIds = (existing || [])
    .filter((r) => !pulledIds.has(r.external_id) && !r.removed_at)
    .map((r) => r.id);
  for (let i = 0; i < goneIds.length; i += 200) {
    const { error } = await supabase
      .from('pos_menu_items')
      .update({ removed_at: now })
      .in('id', goneIds.slice(i, i + 200));
    if (error) throw new Error(`pos_menu_items removed update failed: ${error.message}`);
  }

  // Link unlinked active POS items to OptiMenu dishes by exact name.
  const [
    { data: unlinked, error: unlinkedError },
    { data: dishes, error: dishesError },
    { data: alreadyLinked, error: linkedError },
  ] = await Promise.all([
    supabase
      .from('pos_menu_items')
      .select('id, name, category_name')
      .eq('restaurant_id', restaurantId)
      .eq('pos_system', posSystem)
      .eq('is_active', true)
      .is('removed_at', null)
      .is('menu_item_id', null),
    supabase
      .from('menu_items')
      .select('id, name')
      .eq('restaurant_id', restaurantId)
      .is('archived_at', null)
      .limit(1000),
    supabase
      .from('pos_menu_items')
      .select('menu_item_id')
      .eq('restaurant_id', restaurantId)
      .eq('pos_system', posSystem)
      .is('removed_at', null)
      .not('menu_item_id', 'is', null),
  ]);
  if (unlinkedError) throw new Error(`pos_menu_items unlinked read failed: ${unlinkedError.message}`);
  if (dishesError) throw new Error(`menu_items read failed: ${dishesError.message}`);
  if (linkedError) throw new Error(`pos_menu_items linked read failed: ${linkedError.message}`);
  const linkedDishIds = new Set((alreadyLinked || []).map((r) => r.menu_item_id));

  const dishesByName = new Map();
  for (const d of dishes || []) {
    const key = norm(d.name);
    if (!key) continue;
    dishesByName.set(key, dishesByName.has(key) ? null : d.id); // null = ambiguous, skip
  }

  let linked = 0;
  for (const row of unlinked || []) {
    let dishId = null;
    for (const { key, stripped } of nameCandidates(row.name, row.category_name)) {
      const id = dishesByName.get(key);
      if (!id) continue;
      // A stripped name must not take a dish another POS item already owns
      // (Penne Vodka Pizza stripped to Penne Vodka vs the Penne Vodka pasta).
      if (stripped && linkedDishIds.has(id)) continue;
      dishId = id;
      break;
    }
    if (!dishId) continue;
    linkedDishIds.add(dishId);
    const { error } = await supabase.from('pos_menu_items').update({ menu_item_id: dishId }).eq('id', row.id);
    if (error) throw new Error(`pos_menu_items link failed: ${error.message}`);
    linked += 1;
  }

  return {
    categories: categories.length,
    items: items.length,
    modifierSets: sets.length,
    modifiers: modifiers.length,
    added,
    removed: goneIds.length,
    linked,
  };
}