// pages/api/invoices/confirm-invoice.js
// Receives confirmed invoice data from the client after the user has resolved
// all ambiguous ingredient matches. Writes to: invoices, invoice_items, ingredients.
// Also updates ingredients.last_price (stored as cost-per-STANDARD-unit, e.g. per oz)
// and ingredients.last_ordered_at.
// OPTIMIZED: Uses batched inserts/updates instead of sequential per-item DB calls.

import { createClient } from '@supabase/supabase-js';
import {
  convertInvoiceCostToStandardUnit,
  getStandardUnitForIngredient,
  calculateStandardizedCost,
} from '../../../lib/standardizedUnits';

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
    // For new ingredients, convert the invoice unit cost to cost-per-standard-unit
    // before storing. e.g. $3.50/lb → $0.21875/oz
    const newIngredientItems = activeItems.filter(
      i => !i.selected_ingredient_id && i.match_status === 'new' && i.confirm_new
    );

    const newIngredientIdMap = {};

    if (newIngredientItems.length > 0) {
      const toInsert = newIngredientItems.map(item => {
        const ingName  = item.confirmed_name || item.item_name;
        const stdUnit  = getStandardUnitForIngredient(item.unit, ingName);
        const stdPrice = item.unit_cost
          ? convertInvoiceCostToStandardUnit(item.unit_cost, item.unit, ingName)
          : null;

        return {
          restaurant_id,
          name:                ingName,
          unit:                stdUnit,           // store standard unit (oz, fl oz, each)
          standard_unit:       stdUnit,
          original_unit:       item.unit || 'each', // preserve original invoice unit
          last_price:          stdPrice,          // cost per standard unit
          last_ordered_at:     invoiceDate,
          ingredient_category: 'weight',
          is_sample:           false,
          is_estimated:        false,
        };
      });

      const { data: createdIngredients, error: createError } = await supabase
        .from('ingredients')
        .insert(toInsert)
        .select('id, name');

      if (createError) {
        results.errors.push('Failed to batch-create ingredients: ' + createError.message);
      } else {
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
    // Convert invoice unit cost to per-standard-unit before storing.
    // Also update the unit field to match (keeps unit and last_price in sync).
    const ingredientUpdates = {};
    for (const item of activeItems) {
      const ingId = item.selected_ingredient_id || newIngredientIdMap[item._id] || null;
      if (ingId && item.unit_cost) {
        const ingName  = item.selected_ingredient_name || item.item_name;
        const stdPrice = convertInvoiceCostToStandardUnit(item.unit_cost, item.unit, ingName);
        const stdUnit  = getStandardUnitForIngredient(item.unit, ingName);

        ingredientUpdates[ingId] = {
          last_price:      stdPrice,   // cost per standard unit (oz, fl oz, each)
          unit:            stdUnit,    // keep unit in sync with what last_price is per
          last_ordered_at: invoiceDate,
          is_estimated:    false,
        };
      }
    }

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
    // Store the ORIGINAL invoice unit and unit_cost here (not standardized).
    // This preserves the source-of-truth for the invoice as it actually appeared.
    const invoiceItemsToInsert = activeItems.map(item => {
      const ingredientId =
        item.selected_ingredient_id ||
        newIngredientIdMap[item._id] ||
        null;

      const lineTotal = item.line_total || (
        (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0)
      );

      return {
        invoice_id:                 invoiceRecord.id,
        item_name:                  item.item_name,
        quantity:                   item.quantity   || null,
        unit:                       item.unit       || null,  // original invoice unit
        unit_cost:                  item.unit_cost  || null,  // original invoice unit cost
        amount:                     lineTotal       || null,
        ingredient_name_normalized: normalizeName(item.item_name),
        category:                   item.category   || null,
        ingredient_id:              ingredientId,
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
    // Now that last_price is stored as cost-per-standard-unit, we use
    // calculateStandardizedCost() to properly handle unit conversion between
    // the recipe unit (e.g. oz) and whatever the ingredient's standard unit is.
    const updatedIngredientIds = Object.keys(ingredientUpdates);

    if (updatedIngredientIds.length > 0) {
      const { data: affectedComponents } = await supabase
        .from('component_ingredients')
        .select(`
          ingredient_id,
          quantity,
          unit,
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

      const affectedMenuItemIds = [
        ...new Set(
          (affectedComponents || [])
            .map(ci => ci.menu_item_components?.menu_items?.id)
            .filter(Boolean)
        )
      ];

      if (affectedMenuItemIds.length > 0) {
        // Load all components for affected menu items
        const { data: allComps } = await supabase
          .from('menu_item_components')
          .select(`
            menu_item_id,
            cost,
            component_ingredients (
              quantity,
              unit,
              ingredients:ingredient_id (
                id,
                name,
                last_price,
                unit
              )
            )
          `)
          .in('menu_item_id', affectedMenuItemIds);

        // Build old cost and name maps
        const oldCostMap = {};
        const nameMap = {};
        for (const ci of (affectedComponents || [])) {
          const menuItem = ci.menu_item_components?.menu_items;
          if (menuItem) {
            oldCostMap[menuItem.id] = parseFloat(menuItem.cost || 0);
            nameMap[menuItem.id]    = menuItem.name;
          }
        }

        // Recompute cost per menu item using proper unit conversion.
        // last_price is now per standard unit (oz or fl oz).
        // calculateStandardizedCost converts the recipe qty+unit to that
        // same standard unit before multiplying.
        const newCostMap = {};
        for (const comp of (allComps || [])) {
          const mid = comp.menu_item_id;
          if (!newCostMap[mid]) newCostMap[mid] = 0;

          for (const ci of (comp.component_ingredients || [])) {
            const unitCost   = parseFloat(ci.ingredients?.last_price || 0);
            const qty        = parseFloat(ci.quantity || 0);
            const recipeUnit = ci.unit || ci.ingredients?.unit || 'oz';
            const ingName    = ci.ingredients?.name || '';

            if (unitCost > 0 && qty > 0) {
              // calculateStandardizedCost handles the unit conversion:
              // converts qty from recipeUnit to standard unit, then × unitCost
              newCostMap[mid] += calculateStandardizedCost(qty, recipeUnit, unitCost, ingName);
            }
          }
        }

        // Batch-update menu items whose cost actually changed + log history
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