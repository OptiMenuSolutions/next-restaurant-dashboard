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

  const { restaurant_id, dishes, ingredient_library } = req.body;

  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!Array.isArray(dishes) || dishes.length === 0) return res.status(400).json({ error: 'dishes array is required' });
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
    errors: [],
  };

  // ── Build ingredient ID map ───────────────────────────────────────────────
  // Every lookup is independent of every other — run them all at once
  // instead of one at a time.

  const ingredientIdMap = {};

  const ingredientLookups = await Promise.all(ingredient_library.map(async (ing) => {
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
      last_price: ing.estimated_unit_cost ?? null,
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
            last_price: ing.estimated_unit_cost ?? null,
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
  const uniqueCategories = [...new Set(dishes.map(d => d.category).filter(Boolean))];

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

  return res.status(200).json({
    success: true,
    save_results: results,
    count: results.menu_items_created,
  });
}