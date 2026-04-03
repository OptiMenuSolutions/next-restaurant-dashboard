// lib/seedSampleData.js
//
// Fetches sample tour data from Supabase using the fixed sample restaurant.
// The sample restaurant ID is a permanent fixture in the DB — not linked to
// any real user — so every user on the tour sees the same Chick-fil-A data.
//
// All pages that run the tour call fetchSampleData() and pass the result into
// their own state, so no page needs to know about this ID directly.

import supabase from './supabaseClient';

const SAMPLE_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

let cache = null; // module-level cache — only hits Supabase once per session

export async function fetchSampleData() {
  if (cache) return cache;

  try {
    const [
      { data: invoices,    error: e1 },
      { data: ingredients, error: e2 },
      { data: menuItems,   error: e3 },
      { data: posSales,    error: e4 },
    ] = await Promise.all([

      supabase
        .from('invoices')
        .select(`
          *,
          invoice_items (
            id, item_name, quantity, unit, unit_cost, amount,
            ingredient_name_normalized, category
          )
        `)
        .eq('restaurant_id', SAMPLE_RESTAURANT_ID)
        .order('date', { ascending: false }),

      supabase
        .from('ingredients')
        .select('*')
        .eq('restaurant_id', SAMPLE_RESTAURANT_ID)
        .order('name'),

      supabase
        .from('menu_items')
        .select(`
          *,
          menu_item_ingredients (
            quantity,
            ingredients ( id, name, unit, last_price )
          ),
          menu_item_components (
            id, name, cost,
            component_ingredients (
              id, quantity, unit,
              ingredients:ingredient_id ( id, name, last_price, unit, last_ordered_at )
            )
          )
        `)
        .eq('restaurant_id', SAMPLE_RESTAURANT_ID)
        .order('name'),

      supabase
        .from('pos_sales')
        .select('*')
        .eq('restaurant_id', SAMPLE_RESTAURANT_ID)
        .order('sale_date', { ascending: false }),

    ]);

    if (e1 || e2 || e3 || e4) {
      console.error('seedSampleData fetch errors:', { e1, e2, e3, e4 });
      return null;
    }

    cache = {
      invoices:    invoices    || [],
      ingredients: ingredients || [],
      menuItems:   menuItems   || [],
      posSales:    posSales    || [],
    };

    return cache;
  } catch (err) {
    console.error('seedSampleData unexpected error:', err);
    return null;
  }
}

// Call this if you ever need to force a fresh fetch (e.g. after the SQL is re-run)
export function clearSampleDataCache() {
  cache = null;
}