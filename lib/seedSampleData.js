// lib/seedSampleData.js
//
// Fetches sample tour data from Supabase using the fixed sample restaurant.
// AI recommendations are hardcoded here so they show instantly on both the
// Dashboard and Analytics pages without an API call during the tour.

import supabase from './supabaseClient';

const SAMPLE_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

// ── Hardcoded AI recommendations ─────────────────────────────────────────
// These show on Dashboard (aiRecommendations) and Analytics (dishRecs).
// They use real dish names from the sample menu (so a ticket flips to its
// recipe) and follow Tonight's Dish rules: entrees only, never a side,
// dessert or salad, and each pick uses an ingredient the tour shows as
// expiring.

export const SAMPLE_AI_RECOMMENDATIONS = [
  {
    title: 'Classic Cheeseburger',
    type: 'waste',
    urgency: 'high',
    description:
      'Ground beef needs to be used today, and the Classic Cheeseburger is your top seller, so pushing it tonight clears the most beef with the least effort.',
    talking_point:
      'Our Classic Cheeseburger is the one people come back for: fresh-ground beef griddled to order on a toasted bun. You really can\u2019t go wrong with it tonight.',
  },
  {
    title: 'Grilled Chicken Sandwich',
    type: 'waste',
    urgency: 'medium',
    description:
      'Chicken breast is the largest amount of stock expiring today. The Grilled Chicken Sandwich uses it and gives guests a lighter option next to the burger.',
    talking_point:
      'If you want something a little lighter, the Grilled Chicken Sandwich is great tonight: juicy grilled chicken breast with all the fixings.',
  },
  {
    title: 'Buffalo Wings (6pc)',
    type: 'waste',
    urgency: 'low',
    description:
      'Chicken wings are expiring today. Wings are an easy add-on for the table, so mentioning them to every party moves stock without replacing an entree.',
    talking_point:
      'Want to start with some Buffalo Wings for the table? Crispy, saucy, and perfect for sharing while you look at the menu.',
  },
];

// Dish recommendation cards for the Analytics page
export const SAMPLE_DISH_RECS = [
  {
    dish: 'Classic Cheeseburger',
    type: 'margin',
    urgency: 'high',
    reason:
      'Your #1 seller by volume at a strong margin. Saturday and Friday volumes are 25% above the weekly average — ensure prep levels are elevated going into the weekend.',
    talking_point:
      'A house classic — fresh-ground beef, griddled to order, on a toasted bun.',
    margin: 74.7,
    confidence: 94,
  },
  {
    dish: 'Fried Chicken Tenders',
    type: 'waste',
    urgency: 'high',
    reason:
      'Chicken tenderloins need to be used today, and the tenders are a steady seller at every daypart. A push tonight clears them before they go to waste.',
    talking_point:
      'Our Fried Chicken Tenders are hand-breaded and fried to order: crispy outside, juicy inside.',
    margin: 71.5,
    confidence: 90,
  },
  {
    dish: 'BBQ Bacon Burger',
    type: 'trending',
    urgency: 'medium',
    reason:
      'Up 12% week-over-week and carries a strong margin. Highlight it on the menu board and train staff to recommend it as an upgrade from the classic.',
    talking_point:
      'For guests who want more — smoky bacon, cheddar, and house BBQ sauce on the classic.',
    margin: 72.7,
    confidence: 88,
  },
];

// ─────────────────────────────────────────────────────────────────────────

let cache = null;

export async function fetchSampleData() {
  if (cache) return cache;

  try {
    const [
      { data: invoices, error: e1 },
      { data: ingredients, error: e2 },
      { data: menuItems, error: e3 },
      { data: posSales, error: e4 },
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
      invoices: invoices || [],
      ingredients: ingredients || [],
      menuItems: menuItems || [],
      posSales: posSales || [],
      // Pre-built AI data — no API call needed during tour
      aiRecommendations: SAMPLE_AI_RECOMMENDATIONS,
      dishRecs: SAMPLE_DISH_RECS,
    };

    return cache;
  } catch (err) {
    console.error('seedSampleData unexpected error:', err);
    return null;
  }
}

export function clearSampleDataCache() {
  cache = null;
}
