// lib/seedSampleData.js
//
// Fetches sample tour data from Supabase using the fixed sample restaurant.
// AI recommendations are hardcoded here so they show instantly on both the
// Dashboard and Analytics pages without an API call during the tour.

import supabase from './supabaseClient';

const SAMPLE_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

// ── Hardcoded AI recommendations ─────────────────────────────────────────
// These show on Dashboard (aiRecommendations) and Analytics (dishRecs).
// They are written to reflect the Chick-fil-A sample data specifically.

export const SAMPLE_AI_RECOMMENDATIONS = [
  {
    title: 'Push Waffle Fries at Lunch',
    description:
      'Waffle Fries are your highest-volume item and carry a 79.9% margin — the best combination on your menu. Bundling them as a default side upgrade at the lunch counter could lift average ticket size by $0.50–$0.80 per order.',
  },
  {
    title: 'Watch Mac & Cheese Margin',
    description:
      'Mac & Cheese (Medium) sits at 62.2% margin — your lowest among sides. Ingredient costs have risen 20% over the past 3 months. Consider a $0.20 price increase to bring it in line with your 65% target.',
  },
  {
    title: 'Market Salad Is Underperforming',
    description:
      'Market Salad sells roughly 40% fewer units than Cobb Salad despite a similar price point and margin. A limited-time feature on the menu board or a server recommendation push on slower weekdays could close the gap.',
  },
];

// Dish recommendation cards for the Analytics page
export const SAMPLE_DISH_RECS = [
  {
    dish: 'Chick-fil-A Sandwich',
    type: 'margin',
    urgency: 'high',
    reason:
      'Your #1 seller by volume at 74.7% margin. Saturday and Friday volumes are 25% above the weekly average — ensure prep levels are elevated going into the weekend.',
    talking_point:
      'Our classic — hand-breaded fresh every morning and served on a toasted brioche bun.',
    margin: 74.7,
    confidence: 94,
  },
  {
    dish: 'Waffle Fries (Medium)',
    type: 'margin',
    urgency: 'high',
    reason:
      'Highest margin item on the menu at 79.9% and highest attach rate. Every table that orders a sandwich should be offered fries — current attach rate leaves revenue on the table.',
    talking_point:
      'Our fries are made from whole potatoes, cut fresh and seasoned with a signature blend.',
    margin: 79.9,
    confidence: 96,
  },
  {
    dish: 'Spicy Deluxe Sandwich',
    type: 'trending',
    urgency: 'medium',
    reason:
      'Up 12% week-over-week. The Spicy Deluxe is trending and carries a 72.7% margin. Highlight it on the menu board and train staff to recommend it as an upgrade from the classic.',
    talking_point:
      'For guests who love a kick — it has everything the classic has, plus pepper jack and a spicy filet.',
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
      invoices:           invoices           || [],
      ingredients:        ingredients        || [],
      menuItems:          menuItems          || [],
      posSales:           posSales           || [],
      // Pre-built AI data — no API call needed during tour
      aiRecommendations:  SAMPLE_AI_RECOMMENDATIONS,
      dishRecs:           SAMPLE_DISH_RECS,
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