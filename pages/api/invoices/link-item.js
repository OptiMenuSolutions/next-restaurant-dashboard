// pages/api/invoices/link-item.js
// Links one invoice line to an ingredient (existing, or created here), and
// prices that ingredient from the line — same unit conversion
// confirm-invoice uses. Never overwrites a newer price with an older
// invoice's price.

import { createClient } from '@supabase/supabase-js';
import { convertInvoiceCostToStandardUnit, getStandardUnitForIngredient } from '../../../lib/standardizedUnits';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';
import { recomputeMenuCosts } from '../../../lib/recomputeMenuCosts';

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
    .select('id, unit, unit_cost, ingredient_id, ingredient_name_normalized, invoices!inner(restaurant_id, date)')
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
    // Reuse an ingredient that already has this exact name (any case).
    const { data: sameName } = await supabase
      .from('ingredients')
      .select('id, name, unit, last_ordered_at')
      .eq('restaurant_id', restaurant_id)
      .limit(5000);
    const existing = (sameName || []).find((g) => g.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) {
    ingredient = existing;
  } else {
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
  }

  const oldIngredientId = line.ingredient_id || null;
  if (oldIngredientId === ingredient.id) {
    return res.status(200).json({
      success: true,
      moved: 0,
      ingredient: { id: ingredient.id, name: ingredient.name, unit: ingredient.unit },
    });
  }

  // A relink also moves this restaurant's other lines with the same product
  // name that point at the old ingredient. parse-invoice only remembers a
  // name when all its links agree, so moving one line alone would stop the
  // name from auto-linking at all. Old ingredient ids belong to this
  // restaurant, so filtering on them keeps the update scoped.
  let moveQuery = supabase.from('invoice_items').update({ ingredient_id: ingredient.id });
  if (oldIngredientId && line.ingredient_name_normalized) {
    moveQuery = moveQuery
      .eq('ingredient_id', oldIngredientId)
      .eq('ingredient_name_normalized', line.ingredient_name_normalized);
  } else {
    moveQuery = moveQuery.eq('id', invoice_item_id);
  }
  const { data: movedRows, error: linkErr } = await moveQuery.select('id');
  if (linkErr) return res.status(500).json({ error: 'Could not link line: ' + linkErr.message });

  if (oldIngredientId) {
    // Both ingredients take their price from their newest linked invoice line.
    try {
      await repriceFromInvoices(restaurant_id, ingredient.id);
      await repriceFromInvoices(restaurant_id, oldIngredientId);
    } catch (err) {
      return res.status(500).json({ error: 'Relinked, but could not update prices: ' + err.message });
    }
  }

  // Price the ingredient from this line, unless it already has a newer price.
  const unitCost = Number(line.unit_cost);
  const isNewest = !ingredient.last_ordered_at || String(invoiceDate) >= String(ingredient.last_ordered_at);
  if (!oldIngredientId && unitCost > 0 && isNewest) {
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

  // Dish costs follow the new price (and, on a relink, the old ingredient's).
  try {
    await recomputeMenuCosts(supabase, restaurant_id, [ingredient.id, oldIngredientId], {
      effectiveDate: invoiceDate,
      reason: 'invoice_link',
    });
  } catch (err) {
    console.error('[link-item] dish cost recompute failed:', err.message);
  }

  // Linking changes which ingredient this delivery counts toward.
  try {
    await rebuildCurrentInventory(supabase, restaurant_id);
  } catch (err) {
    console.error('[link-item] current_inventory rebuild failed:', err.message);
  }

  return res.status(200).json({
    success: true,
    moved: movedRows?.length || 0,
    ingredient: { id: ingredient.id, name: ingredient.name, unit: ingredient.unit },
  });
}

// Prices an ingredient from its newest linked invoice line (by invoice date,
// then upload time), with the same conversion as a first link. If no priced
// line is left and the current price came from an invoice, the price is
// cleared so the ingredient goes back to awaiting pricing.
async function repriceFromInvoices(restaurant_id, ingredientId) {
  const { data: ing, error: ingErr } = await supabase
    .from('ingredients')
    .select('id, name, last_ordered_at')
    .eq('id', ingredientId)
    .eq('restaurant_id', restaurant_id)
    .single();
  if (ingErr || !ing) return;

  const { data: lines, error } = await supabase
    .from('invoice_items')
    .select('unit, unit_cost, invoices!inner(restaurant_id, date, created_at)')
    .eq('ingredient_id', ingredientId)
    .eq('invoices.restaurant_id', restaurant_id);
  if (error) throw new Error(error.message);

  const latest = (lines || [])
    .filter(l => Number(l.unit_cost) > 0)
    .sort((a, b) =>
      String(b.invoices.date || '').localeCompare(String(a.invoices.date || '')) ||
      String(b.invoices.created_at || '').localeCompare(String(a.invoices.created_at || ''))
    )[0];

  let updates;
  if (latest) {
    const unit = latest.unit || 'each';
    const stdUnit = getStandardUnitForIngredient(unit, ing.name);
    updates = {
      last_price: convertInvoiceCostToStandardUnit(Number(latest.unit_cost), unit, ing.name),
      unit: stdUnit,
      standard_unit: stdUnit,
      last_ordered_at: latest.invoices.date,
      is_estimated: false,
    };
  } else if (ing.last_ordered_at) {
    updates = { last_price: null, last_ordered_at: null, is_estimated: true, price_approved_at: null };
  } else {
    return; // price never came from an invoice; leave it alone
  }

  const { error: upErr } = await supabase
    .from('ingredients')
    .update(updates)
    .eq('id', ingredientId)
    .eq('restaurant_id', restaurant_id);
  if (upErr) throw new Error(upErr.message);
}