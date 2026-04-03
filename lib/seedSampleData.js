// lib/seedSampleData.js
// Seeds Chick-fil-A sample data for the onboarding tour.
// All rows are tagged with is_sample: true for easy cleanup.

import supabase from './supabaseClient';

// ─── Sample Data ──────────────────────────────────────────────────────────────

const SAMPLE_INGREDIENTS = [
  { name: 'Chicken Breast (Boneless)', unit: 'lb', last_price: 3.49 },
  { name: 'Peanut Oil', unit: 'gallon', last_price: 18.99 },
  { name: 'Buttermilk', unit: 'gallon', last_price: 4.29 },
  { name: 'Pickle Slices', unit: 'lb', last_price: 2.15 },
  { name: 'Brioche Bun', unit: 'each', last_price: 0.48 },
  { name: 'Potato (Russet)', unit: 'lb', last_price: 0.65 },
  { name: 'Lettuce (Shredded)', unit: 'lb', last_price: 1.89 },
  { name: 'Tomato', unit: 'lb', last_price: 1.45 },
  { name: 'American Cheese Slice', unit: 'each', last_price: 0.22 },
  { name: 'Egg (Large)', unit: 'each', last_price: 0.28 },
  { name: 'Milk (Whole)', unit: 'gallon', last_price: 4.79 },
  { name: 'Vanilla Ice Cream Mix', unit: 'gallon', last_price: 8.50 },
  { name: 'Chocolate Syrup', unit: 'lb', last_price: 3.20 },
  { name: 'Strawberry Puree', unit: 'lb', last_price: 4.10 },
  { name: 'Flour (All-Purpose)', unit: 'lb', last_price: 0.55 },
  { name: 'Seasoning Blend', unit: 'lb', last_price: 6.80 },
  { name: 'Coleslaw Mix', unit: 'lb', last_price: 1.30 },
  { name: 'Coleslaw Dressing', unit: 'lb', last_price: 2.40 },
  { name: 'Honey Butter', unit: 'lb', last_price: 3.75 },
  { name: 'Lemon (Fresh)', unit: 'each', last_price: 0.35 },
  { name: 'Sugar', unit: 'lb', last_price: 0.58 },
  { name: 'Coffee Blend', unit: 'lb', last_price: 9.20 },
  { name: 'Whipped Cream', unit: 'lb', last_price: 3.60 },
  { name: 'Grilled Chicken Breast', unit: 'lb', last_price: 3.85 },
];

const SAMPLE_MENU_ITEMS = [
  { name: 'Chick-fil-A Sandwich', price: 5.45, cost: 1.42, category: 'Sandwiches' },
  { name: 'Spicy Deluxe Sandwich', price: 6.25, cost: 1.68, category: 'Sandwiches' },
  { name: 'Grilled Chicken Sandwich', price: 6.05, cost: 1.55, category: 'Sandwiches' },
  { name: 'Chick-fil-A Nuggets (8pc)', price: 5.35, cost: 1.38, category: 'Entrees' },
  { name: 'Grilled Nuggets (8pc)', price: 5.75, cost: 1.52, category: 'Entrees' },
  { name: 'Chick-n-Strips (3pc)', price: 5.99, cost: 1.61, category: 'Entrees' },
  { name: 'Waffle Potato Fries (Lg)', price: 3.35, cost: 0.58, category: 'Sides' },
  { name: 'Mac & Cheese', price: 3.85, cost: 0.72, category: 'Sides' },
  { name: 'Chicken Noodle Soup', price: 4.25, cost: 0.91, category: 'Sides' },
  { name: 'Cole Slaw', price: 2.15, cost: 0.38, category: 'Sides' },
  { name: 'Waffle Potato Chips', price: 2.09, cost: 0.31, category: 'Sides' },
  { name: 'Chocolate Chunk Cookie', price: 1.79, cost: 0.28, category: 'Desserts' },
  { name: 'Vanilla Milkshake', price: 4.45, cost: 0.94, category: 'Desserts' },
  { name: 'Chocolate Milkshake', price: 4.45, cost: 0.98, category: 'Desserts' },
  { name: 'Strawberry Milkshake', price: 4.45, cost: 1.02, category: 'Desserts' },
  { name: 'Icedream Cone', price: 1.65, cost: 0.29, category: 'Desserts' },
  { name: 'Lemonade (Large)', price: 3.09, cost: 0.42, category: 'Drinks' },
  { name: 'Frosted Lemonade', price: 4.25, cost: 0.88, category: 'Drinks' },
  { name: 'Sweet Tea (Large)', price: 2.89, cost: 0.18, category: 'Drinks' },
  { name: 'Cold Brew Coffee', price: 3.69, cost: 0.55, category: 'Drinks' },
  { name: 'Frosted Coffee', price: 4.45, cost: 0.91, category: 'Drinks' },
  { name: 'Egg White Grill', price: 5.55, cost: 1.21, category: 'Breakfast' },
  { name: 'Chick-n-Minis (4pc)', price: 5.25, cost: 1.08, category: 'Breakfast' },
  { name: 'Hash Browns', price: 1.39, cost: 0.24, category: 'Breakfast' },
  { name: 'Chicken Biscuit', price: 3.89, cost: 0.79, category: 'Breakfast' },
  { name: 'Spicy Chicken Biscuit', price: 4.09, cost: 0.83, category: 'Breakfast' },
  { name: 'Cobb Salad', price: 9.35, cost: 2.18, category: 'Salads' },
  { name: 'Market Salad', price: 9.55, cost: 2.31, category: 'Salads' },
  { name: 'Grilled Cool Wrap', price: 8.59, cost: 1.94, category: 'Entrees' },
  { name: 'Spicy SW Salad', price: 9.55, cost: 2.28, category: 'Salads' },
];

const SAMPLE_INVOICES = [
  {
    number: 'INV-2024-0312',
    supplier: 'Tyson Foods — Poultry Division',
    amount: 4820.50,
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: 'Weekly chicken breast and nugget delivery',
  },
  {
    number: 'INV-2024-0298',
    supplier: 'Golden State Foods',
    amount: 2340.00,
    date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: 'Peanut oil, sauces, condiments',
  },
  {
    number: 'INV-2024-0277',
    supplier: 'Martin-Brower Distribution',
    amount: 1875.25,
    date: new Date(Date.now() - 19 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: 'Buns, packaging, napkins',
  },
  {
    number: 'INV-2024-0261',
    supplier: 'Dairy Farmers of America',
    amount: 1240.80,
    date: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: 'Milk, ice cream mix, whipped cream',
  },
  {
    number: 'INV-2024-0245',
    supplier: 'Simplot Food Group',
    amount: 980.00,
    date: new Date(Date.now() - 33 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: 'Waffle potato fries and hash browns',
  },
];

// ─── Seed function ────────────────────────────────────────────────────────────

export async function seedSampleData(restaurantId) {
  if (!restaurantId) return { success: false, error: 'No restaurant ID' };

  try {
    // Check if sample data already exists — don't double-seed
    const { data: existing, error: checkErr } = await supabase
      .from('menu_items')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('is_sample', true)
      .limit(1);

    if (checkErr) {
      console.error('[tour] seedSampleData check error:', checkErr);
      throw checkErr;
    }

    if (existing && existing.length > 0) {
      console.log('[tour] Sample data already seeded — skipping');
      return { success: true, alreadySeeded: true };
    }

    console.log('[tour] Seeding sample data for', restaurantId);

    // Insert ingredients
    const { error: ingErr } = await supabase.from('ingredients').insert(
      SAMPLE_INGREDIENTS.map(i => ({
        ...i,
        restaurant_id: restaurantId,
        is_sample: true,
        last_ordered_at: new Date().toISOString(),
      }))
    );
    if (ingErr) { console.error('[tour] ingredients insert error:', ingErr); throw ingErr; }

    // Insert menu items
    const { error: menuErr } = await supabase.from('menu_items').insert(
      SAMPLE_MENU_ITEMS.map(m => ({
        ...m,
        restaurant_id: restaurantId,
        is_sample: true,
      }))
    );
    if (menuErr) { console.error('[tour] menu_items insert error:', menuErr); throw menuErr; }

    // Insert invoices
    const { error: invErr } = await supabase.from('invoices').insert(
      SAMPLE_INVOICES.map(i => ({
        ...i,
        restaurant_id: restaurantId,
        is_sample: true,
      }))
    );
    if (invErr) { console.error('[tour] invoices insert error:', invErr); throw invErr; }

    console.log('[tour] Sample data seeded successfully');
    return { success: true };
  } catch (err) {
    console.error('[tour] seedSampleData error:', err);
    return { success: false, error: err.message };
  }
}

// ─── Clear function ───────────────────────────────────────────────────────────

export async function clearSampleData(restaurantId) {
  if (!restaurantId) return { success: false };

  try {
    console.log('[tour] Clearing sample data for', restaurantId);
    await Promise.all([
      supabase.from('menu_items').delete().eq('restaurant_id', restaurantId).eq('is_sample', true),
      supabase.from('ingredients').delete().eq('restaurant_id', restaurantId).eq('is_sample', true),
      supabase.from('invoices').delete().eq('restaurant_id', restaurantId).eq('is_sample', true),
    ]);
    console.log('[tour] Sample data cleared');
    return { success: true };
  } catch (err) {
    console.error('[tour] clearSampleData error:', err);
    return { success: false, error: err.message };
  }
}