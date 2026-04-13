// pages/api/invoices/confirm-invoice.js
// Receives confirmed invoice data from the client after the user has resolved
// all ambiguous ingredient matches. Writes to: invoices, invoice_items, ingredients.
// Also updates ingredients.last_price and ingredients.last_ordered_at.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { restaurant_id, invoice, line_items, file_url } = body;

  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!invoice) return res.status(400).json({ error: 'invoice data is required' });

  const results = {
    invoice_id: null,
    items_saved: 0,
    ingredients_created: 0,
    ingredients_updated: 0,
    errors: [],
  };

  try {
    // ── Step 1: Create invoice record ─────────────────────────────────────────
    const { data: invoiceRecord, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        restaurant_id,
        supplier: invoice.supplier || null,
        number: invoice.invoice_number || null,
        date: invoice.invoice_date || null,
        amount: invoice.total_amount || null,
        file_url: file_url || null,
        is_sample: false,
      })
      .select('id')
      .single();

    if (invoiceError) {
      return res.status(500).json({ error: 'Failed to create invoice: ' + invoiceError.message });
    }

    results.invoice_id = invoiceRecord.id;

    // ── Step 2: Process each confirmed line item ───────────────────────────────
    for (const item of (line_items || [])) {
      // Skip items the user dismissed
      if (item.dismissed) continue;

      let ingredientId = item.selected_ingredient_id || null;

      // ── Create new ingredient if user confirmed a new one ──────────────────
      if (!ingredientId && item.match_status === 'new' && item.confirm_new) {
        const { data: newIng, error: newIngError } = await supabase
          .from('ingredients')
          .insert({
            restaurant_id,
            name: item.confirmed_name || item.item_name,
            unit: item.unit || 'each',
            standard_unit: item.unit || 'each',
            original_unit: item.unit || 'each',
            last_price: item.unit_cost || null,
            last_ordered_at: invoice.invoice_date || new Date().toISOString().split('T')[0],
            ingredient_category: 'weight',
            is_sample: false,
            is_estimated: false,
          })
          .select('id')
          .single();

        if (newIngError) {
          results.errors.push(`Failed to create ingredient "${item.item_name}": ${newIngError.message}`);
        } else {
          ingredientId = newIng.id;
          results.ingredients_created++;
        }
      }

      // ── Update existing ingredient price + last ordered ────────────────────
      if (ingredientId && item.unit_cost) {
        const { error: updateError } = await supabase
          .from('ingredients')
          .update({
            last_price: item.unit_cost,
            last_ordered_at: invoice.invoice_date || new Date().toISOString().split('T')[0],
            is_estimated: false
          })
          .eq('id', ingredientId)
          .eq('restaurant_id', restaurant_id);

        if (updateError) {
          results.errors.push(`Failed to update ingredient ${ingredientId}: ${updateError.message}`);
        } else {
          results.ingredients_updated++;
        }
      }

      // ── Insert invoice_item record ─────────────────────────────────────────
      const lineTotal = item.line_total || (
        (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0)
      );

      const { error: itemError } = await supabase
        .from('invoice_items')
        .insert({
          invoice_id: invoiceRecord.id,
          item_name: item.item_name,
          quantity: item.quantity || null,
          unit: item.unit || null,
          unit_cost: item.unit_cost || null,
          amount: lineTotal || null,
          ingredient_name_normalized: normalizeName(item.item_name),
          category: item.category || null,
          ingredient_id: ingredientId || null,
        });

      if (itemError) {
        results.errors.push(`Failed to save line item "${item.item_name}": ${itemError.message}`);
      } else {
        results.items_saved++;
      }
    }

    // ── Step 3: Recompute menu item costs for affected ingredients ────────────
    // For each updated ingredient, find menu items that use it and recompute cost
    const updatedIngredientIds = (line_items || [])
      .filter(i => i.selected_ingredient_id && !i.dismissed)
      .map(i => i.selected_ingredient_id);

    if (updatedIngredientIds.length > 0) {
      // Find all component_ingredients that reference these ingredients
      const { data: affectedComponents } = await supabase
        .from('component_ingredients')
        .select(`
          ingredient_id,
          quantity,
          menu_item_components (
            id,
            menu_item_id,
            menu_items (
              id,
              name,
              price,
              cost
            )
          )
        `)
        .in('ingredient_id', updatedIngredientIds);

      // Group by menu_item_id and recompute costs
      const menuItemMap = {};
      for (const ci of (affectedComponents || [])) {
        const comp = ci.menu_item_components;
        const menuItem = comp?.menu_items;
        if (!menuItem) continue;

        if (!menuItemMap[menuItem.id]) {
          menuItemMap[menuItem.id] = { name: menuItem.name, oldCost: menuItem.cost };
        }
      }

      // For each affected menu item, recompute total cost from components
      for (const [menuItemId, info] of Object.entries(menuItemMap)) {
        const { data: allComps } = await supabase
          .from('menu_item_components')
          .select(`
            cost,
            component_ingredients (
              quantity,
              ingredients:ingredient_id (
                last_price
              )
            )
          `)
          .eq('menu_item_id', menuItemId);

        let newCost = 0;
        for (const comp of (allComps || [])) {
          for (const ci of (comp.component_ingredients || [])) {
            const price = parseFloat(ci.ingredients?.last_price || 0);
            const qty = parseFloat(ci.quantity || 0);
            newCost += price * qty;
          }
        }

        newCost = Math.round(newCost * 100) / 100;

        if (newCost > 0 && Math.abs(newCost - parseFloat(info.oldCost || 0)) > 0.001) {
          // Update menu item cost
          await supabase
            .from('menu_items')
            .update({ cost: newCost })
            .eq('id', menuItemId)
            .eq('restaurant_id', restaurant_id);

          // Log cost history
          await supabase
            .from('menu_item_cost_history')
            .insert({
              menu_item_id: menuItemId,
              menu_item_name: info.name,
              old_cost: parseFloat(info.oldCost || 0),
              new_cost: newCost,
              change_reason: 'invoice_update',
              restaurant_id,
            });
        }
      }
    }

    return res.status(200).json({
      success: true,
      invoice_id: results.invoice_id,
      items_saved: results.items_saved,
      ingredients_created: results.ingredients_created,
      ingredients_updated: results.ingredients_updated,
      errors: results.errors,
    });

  } catch (err) {
    console.error('[confirm-invoice] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save invoice' });
  }
}