// lib/seedSampleData.js
// Fetches static sample data from tour_sample_data table.
// No inserts, no deletes, no RLS issues — data lives permanently in one place.

import supabase from './supabaseClient';

export async function fetchSampleData() {
  const { data, error } = await supabase
    .from('tour_sample_data')
    .select('data_type, payload');

  if (error) {
    console.error('[tour] fetchSampleData error:', error);
    return null;
  }

  return {
    ingredients: data.filter(r => r.data_type === 'ingredient').map(r => r.payload),
    menuItems:   data.filter(r => r.data_type === 'menu_item').map(r => r.payload),
    invoices:    data.filter(r => r.data_type === 'invoice').map(r => r.payload),
    posSales:    data.filter(r => r.data_type === 'pos_sale').map(r => r.payload),
  };
}

// No-ops so any existing callers don't break
export async function clearSampleData() { return { success: true }; }
export async function seedSampleData()  { return { success: true }; }