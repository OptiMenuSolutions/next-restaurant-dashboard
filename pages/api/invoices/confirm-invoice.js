// pages/api/invoices/confirm-invoice.js
// Receives confirmed invoice data from the client after the user has resolved
// all ambiguous ingredient matches. Writes to: invoices, invoice_items, ingredients.
// Also updates ingredients.last_price and ingredients.last_ordered_at.
// OPTIMIZED: Uses batched inserts/updates instead of sequential per-item DB calls.

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
  if (!invoice)       return res.status(400).json({ error: 'invoice data is required' });

  const activeItems = (line_items || []).filter(i => !i.dismissed);
  const invoiceDate = invoice.invoice_date || new Date().toISOString().split('T')[0];

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
        supplier:   invoice.supplier       || null,
        number:     invoice.invoice_number || null,
        date:       invoice.invoice_date   || null,
        amount:     invoice.total_amount   || null,
        file_url:   file_url               || null,
        is_sample:  false,
      })
      .select('id')
      .single();

    if (invoiceError) {
      return res.status(500).json({ error: 'Failed to create invoice: ' + invoiceError.message });
    }
    results.invoice_id = invoiceRecord.id;

    // ── Step 2: Batch-create new ingredients ──────────────────────────────────
    // Collect all items that need a new ingredient created
    const newIngredientItems = activeItems.filter(
      i => !i.selected_ingredient_id && i.match_status === 'new' && i.confirm_new
    );

    // Map from item._id → new ingredient id (populated after insert)
    const newIngredientIdMap = {};

    if (newIngredientItems.length > 0) {
      const toInsert = newIngredientItems.map(item => ({
        restaurant_id,
        name:              item.confirmed_name || item.item_name,
        unit:              item.unit           || 'each',
        standard_unit:     item.unit           || 'each',
        original_unit:     item.unit           || 'each',
        last_price:        item.unit_cost      || null,
        last_ordered_at:   invoiceDate,
        ingredient_category: 'weight',
        is_sample:         false,
        is_estimated:      false,
      }));

      const { data: createdIngredients, error: createError } = await supabase
        .from('ingredients')
        .insert(toInsert)
        .select('id, name');

      if (createError) {
        results.errors.push('Failed to batch-create ingredients: ' + createError.message);
      } else {
        // Match created rows back to items by name (names are unique per restaurant)
        for (const item of newIngredientItems) {
          const targetName = (item.confirmed_name || item.item_name || '').toLowerCase().trim();
          const match = createdIngredients.find(
            c => c.name.toLowerCase().trim() === targetName
          );
          if (match) {
            newIngredientIdMap[item._id] = match.id;
            results.ingredients_created++;
          }
        }
      }
    }

    // ── Step 3: Batch-update existing ingredient prices ───────────────────────
    // Build a map of ingredientId → { unit_cost, invoiceDate } for all matched items
    const ingredientUpdates = {};
    for (const item of activeItems) {
      const ingId = item.selected_ingredient_id || newIngredientIdMap[item._id] || null;
      if (ingId && item.unit_cost) {
        ingredientUpdates[ingId] = {
          last_price:      item.unit_cost,
          last_ordered_at: invoiceDate,
          is_estimated:    false,
        };
      }
    }

    // Fire all ingredient updates in parallel
    const updatePromises = Object.entries(ingredientUpdates).map(([ingId, updates]) =>
      supabase
        .from('ingredients')
        .update(updates)
        .eq('id', ingId)
        .eq('restaurant_id', restaurant_id)
        .then(({ error }) => {
          if (error) {
            results.errors.push(`Failed to update ingredient ${ingId}: ${error.message}`);
          } else {
            results.ingredients_updated++;
          }
        })
    );
    await Promise.all(updatePromises);

    // ── Step 4: Batch-insert all invoice_items ────────────────────────────────
    const invoiceItemsToInsert = activeItems.map(item => {
      const ingredientId =
        item.selected_ingredient_id ||
        newIngredientIdMap[item._id] ||
        null;

      const lineTotal = item.line_total || (
        (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0)
      );

      return {
        invoice_id:                invoiceRecord.id,
        item_name:                 item.item_name,
        quantity:                  item.quantity   || null,
        unit:                      item.unit       || null,
        unit_cost:                 item.unit_cost  || null,
        amount:                    lineTotal       || null,
        ingredient_name_normalized: normalizeName(item.item_name),
        category:                  item.category   || null,
        ingredient_id:             ingredientId,
      };
    });

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(invoiceItemsToInsert);

    if (itemsError) {
      results.errors.push('Failed to batch-insert invoice items: ' + itemsError.message);
    } else {
      results.items_saved = invoiceItemsToInsert.length;
    }

    // ── Step 5: Recompute menu item costs for affected ingredients ────────────
    const updatedIngredientIds = Object.keys(ingredientUpdates);

    if (updatedIngredientIds.length > 0) {
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

      // Collect unique affected menu item IDs
      const affectedMenuItemIds = [
        ...new Set(
          (affectedComponents || [])
            .map(ci => ci.menu_item_components?.menu_items?.id)
            .filter(Boolean)
        )
      ];

      if (affectedMenuItemIds.length > 0) {
        // Load all components for affected menu items in one query
        const { data: allComps } = await supabase
          .from('menu_item_components')
          .select(`
            menu_item_id,
            cost,
            component_ingredients (
              quantity,
              ingredients:ingredient_id (
                id,
                last_price
              )
            )
          `)
          .in('menu_item_id', affectedMenuItemIds);

        // Build old cost map from affectedComponents
        const oldCostMap = {};
        const nameMap = {};
        for (const ci of (affectedComponents || [])) {
          const menuItem = ci.menu_item_components?.menu_items;
          if (menuItem) {
            oldCostMap[menuItem.id] = parseFloat(menuItem.cost || 0);
            nameMap[menuItem.id]    = menuItem.name;
          }
        }

        // Recompute new cost per menu item
        const newCostMap = {};
        for (const comp of (allComps || [])) {
          const mid = comp.menu_item_id;
          if (!newCostMap[mid]) newCostMap[mid] = 0;
          for (const ci of (comp.component_ingredients || [])) {
            const price = parseFloat(ci.ingredients?.last_price || 0);
            const qty   = parseFloat(ci.quantity || 0);
            newCostMap[mid] += price * qty;
          }
        }

        // Batch-update menu items whose cost actually changed + log history in parallel
        const costUpdatePromises = Object.entries(newCostMap)
          .filter(([mid, newCost]) => {
            const rounded = Math.round(newCost * 100) / 100;
            return rounded > 0 && Math.abs(rounded - (oldCostMap[mid] || 0)) > 0.001;
          })
          .flatMap(([mid, newCost]) => {
            const rounded = Math.round(newCost * 100) / 100;
            return [
              supabase
                .from('menu_items')
                .update({ cost: rounded })
                .eq('id', mid)
                .eq('restaurant_id', restaurant_id),
              supabase
                .from('menu_item_cost_history')
                .insert({
                  menu_item_id:   mid,
                  menu_item_name: nameMap[mid],
                  old_cost:       oldCostMap[mid] || 0,
                  new_cost:       rounded,
                  change_reason:  'invoice_update',
                  restaurant_id,
                }),
            ];
          });

        await Promise.all(costUpdatePromises);
      }
    }

    return res.status(200).json({
      success: true,
      invoice_id:           results.invoice_id,
      items_saved:          results.items_saved,
      ingredients_created:  results.ingredients_created,
      ingredients_updated:  results.ingredients_updated,
      errors:               results.errors,
    });

  } catch (err) {
    console.error('[confirm-invoice] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save invoice' });
  }
}