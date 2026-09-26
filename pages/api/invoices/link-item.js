// pages/api/invoices/link-item.js
// Links one invoice line to an ingredient (existing, or created here), and
// prices that ingredient from the line — same unit conversion
// confirm-invoice uses. Never overwrites a newer price with an older
// invoice's price.

import { createClient } from '@supabase/supabase-js';
import { convertInvoiceCostToStandardUnit, getStandardUnitForIngredient } from '../../../lib/standardizedUnits';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { restaurant_id, invoice_item_id, ingredient_id, new_ingredient_name } = req.body || {};
  if (!restaurant_id || !invoice_item_id) return res.status(400).json({ error: 'restaurant_id and invoice_item_id are required' });
  if (!ingredient_id && !new_ingredient_name?.trim()) return res.status(400).json({ error: 'Choose an ingredient or name a new one' });

  const { error: authError, status: authStatus } = await import('../../../lib/withRestaurantAuth')
    .then(m => m.verifyRestaurantAccess(req, restaurant_id));
  if (authError) return res.status(authStatus).json({ error: authError });

  // The line must belong to one of this restaurant's invoices.
  const { data: line, error: lineErr } = await supabase
    .from('invoice_items')
    .select('id, unit, unit_cost, invoices!inner(restaurant_id, date)')
    .eq('id', invoice_item_id)
    .single();
  if (lineErr || !line || line.invoices.restaurant_id !== restaurant_id) {
    return res.status(404).json({ error: 'Invoice line not found' });
  }

  const invoiceDate = line.invoices.date || new Date().toISOString().split('T')[0];

  let ingredient;
  if (ingredient_id) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name, unit, last_ordered_at')
      .eq('id', ingredient_id)
      .eq('restaurant_id', restaurant_id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Ingredient not found' });
    ingredient = data;
  } else {
    const name = new_ingredient_name.trim();
    const stdUnit = getStandardUnitForIngredient(line.unit || 'each', name);
    const { data, error } = await supabase
      .from('ingredients')
      .insert({
        restaurant_id,
        name,
        unit: stdUnit,
        standard_unit: stdUnit,
        original_unit: line.unit || 'each',
        ingredient_category: 'weight',
        is_sample: false,
        is_estimated: false,
      })
      .select('id, name, unit, last_ordered_at')
      .single();
    if (error) return res.status(500).json({ error: 'Could not create ingredient: ' + error.message });
    ingredient = data;
  }

  const { error: linkErr } = await supabase
    .from('invoice_items')
    .update({ ingredient_id: ingredient.id })
    .eq('id', invoice_item_id);
  if (linkErr) return res.status(500).json({ error: 'Could not link line: ' + linkErr.message });

  // Price the ingredient from this line, unless it already has a newer price.
  const unitCost = Number(line.unit_cost);
  const isNewest = !ingredient.last_ordered_at || String(invoiceDate) >= String(ingredient.last_ordered_at);
  if (unitCost > 0 && isNewest) {
    const stdUnit = getStandardUnitForIngredient(line.unit || 'each', ingredient.name);
    const stdPrice = convertInvoiceCostToStandardUnit(unitCost, line.unit || 'each', ingredient.name);
    const { error: priceErr } = await supabase
      .from('ingredients')
      .update({
        last_price: stdPrice,
        unit: stdUnit,
        standard_unit: stdUnit,
        last_ordered_at: invoiceDate,
        is_estimated: false,
      })
      .eq('id', ingredient.id)
      .eq('restaurant_id', restaurant_id);
    if (priceErr) return res.status(500).json({ error: 'Linked, but could not update the price: ' + priceErr.message });
  }

  return res.status(200).json({
    success: true,
    ingredient: { id: ingredient.id, name: ingredient.name, unit: ingredient.unit },
  });
}