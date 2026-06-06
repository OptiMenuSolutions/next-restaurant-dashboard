// pages/api/menu/commit-reviewed-menu.js
// Receives reviewed dishes + ingredient library from ParseReviewModal and writes to Supabase.
// Same logic as saveToSupabase in parse-menu.js — separated so parse-menu stays clean.

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

  const ingredientIdMap = {};

  for (const ing of ingredient_library) {
    const normalizedName = ing.name.trim().toLowerCase();

    const { data: existing } = await supabase
      .from('ingredients')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .ilike('name', ing.name.trim())
      .maybeSingle();

    if (existing) {
      ingredientIdMap[normalizedName] = existing.id;
      results.ingredients_reused++;
    } else {
      const { data: created, error } = await supabase
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

      if (error) {
        results.errors.push(`Ingredient "${ing.name}": ${error.message}`);
        continue;
      }

      ingredientIdMap[normalizedName] = created.id;
      results.ingredients_created++;
    }
  }

  // ── Category upserts ──────────────────────────────────────────────────────

  const categoryIdMap = {};
  const uniqueCategories = [...new Set(dishes.map(d => d.category).filter(Boolean))];

  for (const catName of uniqueCategories) {
    const { data: existingCat } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .ilike('name', catName)
      .maybeSingle();

    if (existingCat) {
      categoryIdMap[catName] = existingCat.id;
    } else {
      const { data: newCat, error } = await supabase
        .from('menu_categories')
        .insert({ restaurant_id, name: catName })
        .select('id')
        .single();

      if (!error) categoryIdMap[catName] = newCat.id;
    }
  }

  // ── Write dishes ──────────────────────────────────────────────────────────

  for (const dish of dishes) {
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
      continue;
    }

    results.menu_items_created++;

    for (const comp of dish.components || []) {
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
        continue;
      }

      results.components_created++;

      for (const ing of comp.ingredients || []) {
        const normalizedName = ing.name.trim().toLowerCase();
        const ingredientId = ingredientIdMap[normalizedName];

        if (!ingredientId) {
          results.errors.push(`No ingredient ID for "${ing.name}" on "${comp.name}"`);
          continue;
        }

        const { error: ciError } = await supabase
          .from('component_ingredients')
          .insert({
            component_id: component.id,
            ingredient_id: ingredientId,
            quantity: ing.quantity ?? 0,
            unit: ing.unit || 'each',
          });

        if (ciError) {
          results.errors.push(`component_ingredient "${ing.name}": ${ciError.message}`);
        }
      }
    }
  }

  return res.status(200).json({
    success: true,
    save_results: results,
    count: results.menu_items_created,
  });
}