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
    title: 'Push French Fries at Lunch',
    description:
      'French Fries are your highest-volume item and carry a strong margin — the best combination on your menu. Bundling them as a default side upgrade at lunch could lift average ticket size by $0.50–$0.80 per order.',
  },
  {
    title: 'Watch Mac & Cheese Margin',
    description:
      'Mac & Cheese sits at your lowest margin among sides. Ingredient costs have risen 20% over the past 3 months. Consider a $0.20 price increase to bring it back in line with your target.',
  },
  {
    title: 'Classic Caesar Salad Is Underperforming',
    description:
      'Classic Caesar Salad sells roughly 40% fewer units than the Cobb despite a similar price point and margin. A limited-time feature on the menu board or a server recommendation push on slower weekdays could close the gap.',
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
    dish: 'French Fries',
    type: 'margin',
    urgency: 'high',
    reason:
      'Highest margin item on the menu and highest attach rate. Every table that orders a sandwich should be offered fries — current attach rate leaves revenue on the table.',
    talking_point:
      'Cut fresh in-house and seasoned with our own signature blend.',
    margin: 79.9,
    confidence: 96,
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
