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

// FIX #1: Resolve the correct unit cost and invoice unit from the new parse-invoice
// output shape (cost_per_lb / cost_per_each / standard_unit) or the legacy shape (unit_cost / unit).
function resolveUnitCost(item) {
  // New shape: pack + size + size_unit + invoice_price — server does the math
  if (item.invoice_price !== undefined) {
    let unitCost, unit;

    if (item.catch_weight && item.actual_weight) {
      if (item.pack) {
        // Multiple catch-weight units: total cost spread across pack × actual_weight
        const totalActualUnits = item.pack * item.actual_weight;
        unitCost = totalActualUnits > 0 ? item.invoice_price / totalActualUnits : null;
      } else {
        // Single catch-weight item: invoice_price IS the per-unit cost already
        unitCost = item.invoice_price;
      }
      unit = item.size_unit || 'lb';

    } else if (item.pack && item.size && item.size_unit) {
      // Standard case pricing: cost per smallest unit
      const totalUnits = item.pack * item.size;
      unitCost = totalUnits > 0 ? item.invoice_price / totalUnits : null;
      unit     = item.size_unit;

    } else if (item.size_unit === 'each' || item.standard_unit === 'each') {
      // Count item — price per each
      unitCost = item.invoice_price || null;
      unit     = 'each';

    } else {
      unitCost = null;
      unit     = item.size_unit || 'each';
    }

    return { unit_cost: unitCost, unit };
  }

  // Legacy shape fallback (cost_per_lb / cost_per_each)
  const cost = item.standard_unit === 'lb'    ? item.cost_per_lb
             : item.standard_unit === 'each'  ? item.cost_per_each
             : item.standard_unit === 'oz'    ? item.cost_per_lb
             : item.standard_unit === 'gal'   ? item.cost_per_each
             : item.standard_unit === 'case'  ? item.cost_per_each
             : (item.cost_per_lb ?? item.cost_per_each ?? null);
  return { unit_cost: cost ?? null, unit: item.standard_unit || item.quantity_unit || 'each' };
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
    // FIX #5: warn when confirm_new is missing on a new ingredient item
    const newIngredientItems = activeItems.filter(i => {
      if (!i.selected_ingredient_id && i.match_status === 'new') {
        if (!i.confirm_new) {
          console.warn(`[confirm-invoice] Skipping new ingredient "${i.item_name_normalized || i.item_name}" — confirm_new flag not set`);
          return false;
        }
        return true;
      }
      return false;
    });

    const newIngredientIdMap = {};

    if (newIngredientItems.length > 0) {
      const toInsert = newIngredientItems.map(item => {
        // FIX #1: use resolveUnitCost for new ingredients too
        const { unit_cost, unit } = resolveUnitCost(item);
        const ingName  = item.confirmed_name || item.item_name_normalized || item.item_name;
        const stdUnit  = getStandardUnitForIngredient(unit, ingName);
        const stdPrice = unit_cost
          ? convertInvoiceCostToStandardUnit(unit_cost, unit, ingName)
          : null;

        return {
          restaurant_id,
          name:                ingName,
          unit:                stdUnit,
          standard_unit:       stdUnit,
          original_unit:       unit || 'each',
          last_price:          stdPrice,
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
          const targetName = (item.confirmed_name || item.item_name_normalized || item.item_name || '').toLowerCase().trim();
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
    const ingredientUpdates = {};
    for (const item of activeItems) {
      const ingId = item.selected_ingredient_id || newIngredientIdMap[item._id] || null;
      if (ingId) {
        // FIX #1: use resolveUnitCost instead of item.unit_cost / item.unit directly
        const { unit_cost, unit } = resolveUnitCost(item);
        if (unit_cost) {
          const ingName  = item.selected_ingredient_name || item.item_name_normalized || item.item_name;
          const stdPrice = convertInvoiceCostToStandardUnit(unit_cost, unit, ingName);
          const stdUnit  = getStandardUnitForIngredient(unit, ingName);

          ingredientUpdates[ingId] = {
            last_price:      stdPrice,
            unit:            stdUnit,
            last_ordered_at: invoiceDate,
            is_estimated:    false,
          };
        }
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
    const invoiceItemsToInsert = activeItems.map(item => {
      const ingredientId =
        item.selected_ingredient_id ||
        newIngredientIdMap[item._id] ||
        null;

      const { unit_cost, unit } = resolveUnitCost(item);
      console.log(`[confirm-invoice] resolveUnitCost for "${item.item_name_normalized}":`, JSON.stringify({ pack: item.pack, size: item.size, size_unit: item.size_unit, invoice_price: item.invoice_price, catch_weight: item.catch_weight, actual_weight: item.actual_weight, unit_cost, unit }));

      // Total delivered quantity in base units
      let totalQty;
      if (item.catch_weight && item.actual_weight && item.pack) {
        totalQty = item.pack * item.actual_weight;
      } else if (item.pack && item.size) {
        const orderedCases = item.quantity_ordered ?? 1;
        totalQty = orderedCases * item.pack * item.size;
      } else {
        totalQty = item.quantity_ordered ?? null;
      }

      return {
        invoice_id:                 invoiceRecord.id,
        item_name:                  item.item_name_normalized || item.item_name,
        quantity:                   totalQty,
        unit:                       unit,
        unit_cost:                  unit_cost,
        amount:                     item.line_total ?? null,
        ingredient_name_normalized: normalizeName(item.item_name_normalized || item.item_name),
        category:                   item.category || null,
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
    // FIX #2: include newly created ingredient IDs so brand-new ingredients
    // also trigger menu item cost recomputation.
    const updatedIngredientIds = [
      ...Object.keys(ingredientUpdates),
      ...Object.values(newIngredientIdMap),
    ];

    if (updatedIngredientIds.length > 0) {
      const { data: affectedComponents } = await supabase
        .from('component_ingredients')
        .select('ingredient_id, menu_item_components(menu_item_id)')
        .in('ingredient_id', updatedIngredientIds);

      const affectedMenuItemIds = [
        ...new Set(
          (affectedComponents || [])
            .map(ci => ci.menu_item_components?.menu_item_id)
            .filter(Boolean)
        )
      ];

      if (affectedMenuItemIds.length > 0) {
        // FIX #3: query menu_items directly for old costs instead of inferring
        // from affectedComponents (which may only have one row per menu item).
        const { data: menuItemRecords } = await supabase
          .from('menu_items')
          .select('id, name, cost')
          .in('id', affectedMenuItemIds);

        const oldCostMap = {};
        const nameMap    = {};
        for (const mi of (menuItemRecords || [])) {
          oldCostMap[mi.id] = parseFloat(mi.cost || 0);
          nameMap[mi.id]    = mi.name;
        }

        // Load all components for affected menu items
        const { data: allComps } = await supabase
          .from('menu_item_components')
          .select(`
            menu_item_id,
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

        const newCostMap = {};
        for (const comp of (allComps || [])) {
          const mid = comp.menu_item_id;
          if (!newCostMap[mid]) newCostMap[mid] = 0;

          for (const ci of (comp.component_ingredients || [])) {
            const unitCost   = parseFloat(ci.ingredients?.last_price || 0);
            const qty        = parseFloat(ci.quantity || 0);
            const recipeUnit = ci.unit || ci.ingredients?.unit || 'oz';
            const ingUnit    = ci.ingredients?.unit || 'oz';

            if (unitCost > 0 && qty > 0) {
              newCostMap[mid] += calculateStandardizedCost(qty, recipeUnit, unitCost, ingUnit);
            }
          }
        }

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