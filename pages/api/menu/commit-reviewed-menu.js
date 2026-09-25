// pages/api/menu/commit-reviewed-menu.js
// Receives reviewed dishes + ingredient library from ParseReviewModal (or
// the onboarding "let OptiMenu handle it" hand-off) and writes to Supabase.
//
// SPEED — this had zero AI calls in it but was still slow, because every
// lookup and every insert ran one at a time, fully awaited, with nothing
// running concurrently. A real menu (dozens of dishes, several components
// each, several ingredients each) meant 1000+ sequential round-trips to
// Supabase back to back. None of these operations actually depend on each
// other except within a single dish's own tree (dish -> its components ->
// their ingredients), so everything that's independent now runs in
// parallel: ingredient/category lookups across the whole batch, dishes
// across the whole menu, components within a dish, and ingredient rows
// within a component are batch-inserted in one query each instead of one
// row at a time.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { restaurant_id, dishes, ingredient_library, mode, updates } = req.body;
  // "update" = Launch a new menu from Profile: keep matched dishes, add new
  // ones, archive the rest. Anything else = first-time upload (unchanged).
  const isUpdate = mode === 'update';

  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!Array.isArray(dishes) || (dishes.length === 0 && !isUpdate)) return res.status(400).json({ error: 'dishes array is required' });
  if (!Array.isArray(ingredient_library)) return res.status(400).json({ error: 'ingredient_library is required' });

  // Verify the calling user owns this restaurant
  const { error: authError, status: authStatus } = await import('../../../lib/withRestaurantAuth')
    .then(m => m.verifyRestaurantAccess(req, restaurant_id));
  if (authError) return res.status(authStatus).json({ error: authError });

  const results = {
    menu_items_created: 0,
    ingredients_created: 0,
    ingredients_reused: 0,
    components_created: 0,
    menu_items_updated: 0,
    menu_items_archived: 0,
    errors: [],
  };

  // ── Build ingredient ID map ───────────────────────────────────────────────
  // Every lookup is independent of every other — run them all at once
  // instead of one at a time.

  const ingredientIdMap = {};

  // Every ingredient a dish actually uses must get an ID. The parser's
  // ingredient_library doesn't always contain them all — Pass 2 can name
  // an ingredient its section's library didn't list, canonicalization can
  // drop one, and ingredients typed in review or "Purchased as Finished
  // Good" components never appear in it. Those lines used to be silently
  // skipped (Baby Back Ribs saved with no ribs, pizzas with no dough).
  const libraryByKey = new Map();
  const usedKeys = new Set();
  for (const dish of dishes) {
    for (const comp of dish.components || []) {
      for (const ing of comp.ingredients || []) {
        const k = ing?.name?.trim().toLowerCase();
        if (k) usedKeys.add(k);
      }
    }
  }
  for (const ing of ingredient_library) {
    const key = ing?.name?.trim().toLowerCase();
    if (key && (!isUpdate || usedKeys.has(key))) libraryByKey.set(key, ing);
  }
  for (const dish of dishes) {
    for (const comp of dish.components || []) {
      for (const ing of comp.ingredients || []) {
        const key = ing?.name?.trim().toLowerCase();
        if (key && !libraryByKey.has(key)) {
          libraryByKey.set(key, {
            name: ing.name.trim(),
            unit: ing.unit || 'oz',
            estimated_unit_cost: ing.estimated_unit_cost ?? null,
          });
        }
      }
    }
  }
  const fullLibrary = [...libraryByKey.values()];

  const ingredientLookups = await Promise.all(fullLibrary.map(async (ing) => {
    const { data: existing } = await supabase
      .from('ingredients')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .ilike('name', ing.name.trim())
      .maybeSingle();
    return { ing, existing };
  }));

  const newIngredients = [];
  for (const { ing, existing } of ingredientLookups) {
    const normalizedName = ing.name.trim().toLowerCase();
    if (existing) {
      ingredientIdMap[normalizedName] = existing.id;
      results.ingredients_reused++;
    } else {
      newIngredients.push(ing);
    }
  }

  if (newIngredients.length > 0) {
    const rowsToInsert = newIngredients.map(ing => ({
      restaurant_id,
      name: ing.name.trim(),
      unit: ing.unit,
      standard_unit: ing.unit,
      original_unit: ing.unit,
      // 0 means "no price given" (e.g. Pizza Dough added by Pass 2 with no
      // library cost) — save as unpriced, not as a real $0 cost.
      last_price: Number(ing.estimated_unit_cost) > 0 ? Number(ing.estimated_unit_cost) : null,
      ingredient_category: 'weight',
      is_sample: false,
      is_estimated: true,
    }));

    const { data: created, error } = await supabase
      .from('ingredients')
      .insert(rowsToInsert)
      .select('id, name');

    if (error) {
      // Batch insert is all-or-nothing — one malformed row would otherwise
      // silently drop every new ingredient in the batch. Fall back to
      // inserting one at a time so a single bad row only costs that row,
      // matching the old per-row resilience, just slower in this one
      // (rare) failure case instead of always.
      results.errors.push(`Batch ingredient create failed (${error.message}) — falling back to one at a time`);
      for (const ing of newIngredients) {
        const { data: row, error: rowError } = await supabase
          .from('ingredients')
          .insert({
            restaurant_id,
            name: ing.name.trim(),
            unit: ing.unit,
            standard_unit: ing.unit,
            original_unit: ing.unit,
            // 0 means "no price given" (e.g. Pizza Dough added by Pass 2 with no
            // library cost) — save as unpriced, not as a real $0 cost.
            last_price: Number(ing.estimated_unit_cost) > 0 ? Number(ing.estimated_unit_cost) : null,
            ingredient_category: 'weight',
            is_sample: false,
            is_estimated: true,
          })
          .select('id')
          .single();
        if (rowError) {
          results.errors.push(`Ingredient "${ing.name}": ${rowError.message}`);
          continue;
        }
        ingredientIdMap[ing.name.trim().toLowerCase()] = row.id;
        results.ingredients_created++;
      }
    } else {
      for (const row of created) {
        ingredientIdMap[row.name.trim().toLowerCase()] = row.id;
        results.ingredients_created++;
      }
    }
  }

  // ── Category upserts ──────────────────────────────────────────────────────
  // Same pattern — categories are typically few, but the lookups are still
  // independent of each other.

  const categoryIdMap = {};
  const uniqueCategories = [...new Set(
    [...dishes, ...(isUpdate && Array.isArray(updates) ? updates : [])].map(d => d.category).filter(Boolean)
  )];

  const categoryLookups = await Promise.all(uniqueCategories.map(async (catName) => {
    const { data: existingCat } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .ilike('name', catName)
      .maybeSingle();
    return { catName, existingCat };
  }));

  const newCategories = [];
  for (const { catName, existingCat } of categoryLookups) {
    if (existingCat) categoryIdMap[catName] = existingCat.id;
    else newCategories.push(catName);
  }

  if (newCategories.length > 0) {
    const { data: createdCats, error } = await supabase
      .from('menu_categories')
      .insert(newCategories.map(name => ({ restaurant_id, name })))
      .select('id, name');

    if (error) {
      // Same fallback reasoning as ingredients above.
      for (const catName of newCategories) {
        const { data: newCat, error: catError } = await supabase
          .from('menu_categories')
          .insert({ restaurant_id, name: catName })
          .select('id')
          .single();
        if (!catError) categoryIdMap[catName] = newCat.id;
      }
    } else {
      for (const row of createdCats) categoryIdMap[row.name] = row.id;
    }
  }

  // ── Write dishes ──────────────────────────────────────────────────────────
  // Every dish is independent of every other dish, so they all run at
  // once. Within one dish: components are independent of each other too
  // (parallelized), and within one component, its ingredient rows are
  // batch-inserted in a single query since nothing needs to match them
  // back individually afterward.

  const createdIds = [];
  await Promise.all(dishes.map(async (dish) => {
    const totalCost = (dish.components || []).reduce((sum, comp) => {
      return sum + (comp.ingredients || []).reduce((s, i) => {
        return s + (i.quantity ?? 0) * (i.estimated_unit_cost ?? 0);
      }, 0);
    }, 0);

    const { data: menuItem, error: menuError } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id,
        name: dish.name,
        price: dish.price ?? null,
        cost: Math.round(totalCost * 100) / 100,
        category: dish.category || 'uncategorized',
        category_id: categoryIdMap[dish.category] ?? null,
        description: dish.description ?? null,
        is_sample: false,
      })
      .select('id')
      .single();

    if (menuError) {
      results.errors.push(`Menu item "${dish.name}": ${menuError.message}`);
      return;
    }

    results.menu_items_created++;
    createdIds.push(menuItem.id);

    await Promise.all((dish.components || []).map(async (comp) => {
      const compCost = (comp.ingredients || []).reduce((s, i) => {
        return s + (i.quantity ?? 0) * (i.estimated_unit_cost ?? 0);
      }, 0);

      const { data: component, error: compError } = await supabase
        .from('menu_item_components')
        .insert({
          menu_item_id: menuItem.id,
          name: comp.name,
          cost: Math.round(compCost * 10000) / 10000,
        })
        .select('id')
        .single();

      if (compError) {
        results.errors.push(`Component "${comp.name}" on "${dish.name}": ${compError.message}`);
        return;
      }

      results.components_created++;

      const ciRows = [];
      for (const ing of comp.ingredients || []) {
        const normalizedName = ing.name.trim().toLowerCase();
        const ingredientId = ingredientIdMap[normalizedName];

        if (!ingredientId) {
          results.errors.push(`No ingredient ID for "${ing.name}" on "${comp.name}"`);
          continue;
        }

        ciRows.push({
          component_id: component.id,
          ingredient_id: ingredientId,
          quantity: ing.quantity ?? 0,
          unit: ing.unit || 'each',
        });
      }

      if (ciRows.length > 0) {
        const { error: ciError } = await supabase
          .from('component_ingredients')
          .insert(ciRows);
        if (ciError) {
          results.errors.push(`component_ingredients for "${comp.name}" on "${dish.name}": ${ciError.message}`);
        }
      }
    }));
  }));

  // ── Launch a new menu: update kept dishes, archive dropped ones ─────────
  if (isUpdate) {
    const keepIds = new Set(createdIds);
    await Promise.all((Array.isArray(updates) ? updates : []).map(async (u) => {
      if (!u?.id) return;
      // Mark as kept before updating: a failed price update must never
      // cause a dish the restaurant kept to be archived below.
      keepIds.add(u.id);
      const patch = { archived_at: null };

      // A user-confirmed possible match keeps the saved database ID and
      // every related recipe/history record, but adopts the newly parsed
      // menu name.
      if (
        typeof u.name === "string" &&
        u.name.trim()
      ) {
        patch.name = u.name.trim();
      }

      if (u.price != null) patch.price = u.price;
      if (u.category) { patch.category = u.category; patch.category_id = categoryIdMap[u.category] ?? null; }
      if (u.description != null) patch.description = u.description;
      const { error: upErr } = await supabase
        .from('menu_items')
        .update(patch)
        .eq('id', u.id)
        .eq('restaurant_id', restaurant_id);
      if (upErr) { results.errors.push(`Update "${u.name || u.id}": ${upErr.message}`); return; }
      results.menu_items_updated++;
    }));

    // Archive every active dish that was neither kept nor just created.
    const { data: active, error: activeErr } = await supabase
      .from('menu_items')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .is('archived_at', null);
    if (activeErr) {
      results.errors.push(`Archive lookup: ${activeErr.message}`);
    } else {
      const toArchive = (active || []).map(r => r.id).filter(id => !keepIds.has(id));
      if (toArchive.length) {
        const { error: archErr } = await supabase
          .from('menu_items')
          .update({ archived_at: new Date().toISOString() })
          .in('id', toArchive)
          .eq('restaurant_id', restaurant_id);
        if (archErr) results.errors.push(`Archive: ${archErr.message}`);
        else results.menu_items_archived = toArchive.length;
      }
    }
  }

  if (results.errors.length) {
    console.warn(`[commit-reviewed-menu] ${results.errors.length} error(s):`, results.errors);
  }

  return res.status(200).json({
    success: true,
    save_results: results,
    count: results.menu_items_created,
  });
}