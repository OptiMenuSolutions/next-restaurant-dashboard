// pages/api/invoices/confirm-invoice.js
// Auto-save invoice data after parse — no longer requires user confirmation.
// Writes to: invoices, invoice_items, ingredients.
// Stores original_quantity / original_price so the admin review screen can
// show what Claude parsed vs what was manually corrected.

import { createClient } from '@supabase/supabase-js';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';
import { recomputeMenuCosts } from '../../../lib/recomputeMenuCosts';
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

function resolveUnitCost(item) {
  if (item.invoice_price !== undefined) {
    let unitCost, unit;

    if (item.catch_weight && item.actual_weight) {
      // Catch-weight lines are priced per pound of the weight actually
      // shipped (the printed Weight column), whatever the Size column says
      // about portions ("22 x 7 oz" steaks billed at $14.50/lb). The old
      // code took the unit from size_unit and labeled a per-lb price as
      // per-oz, 16x too high. actual_weight is the line's total weight, so
      // total / weight is the true per-lb price.
      const lineTotal = Number(item.line_total);
      unitCost = lineTotal > 0 ? Math.round((lineTotal / item.actual_weight) * 1e6) / 1e6 : item.invoice_price;
      unit     = 'lb';
    } else if (item.pack && item.size && item.size_unit) {
      // Suppliers print either a per-case or a per-lb/per-unit price on
      // case-packed lines, and invoice_price can't tell us which. The line
      // total can: total ÷ (cases × pack × size) is the true per-unit cost
      // either way. (Butter: $94.68 ÷ 36 lb = $2.63/lb — the old math
      // divided a per-lb price by 36 again and got $0.073/lb.)
      const totalUnits = item.pack * item.size;
      const shipped    = item.quantity_shipped ?? item.quantity_ordered ?? 1;
      const lineTotal  = Number(item.line_total);
      if (lineTotal > 0 && totalUnits > 0 && shipped > 0) {
        unitCost = lineTotal / (shipped * totalUnits);
      } else {
        unitCost = totalUnits > 0 ? item.invoice_price / totalUnits : null;
      }
      unit = item.size_unit;
    } else if (item.size_unit === 'each' || item.standard_unit === 'each') {
      unitCost = item.invoice_price || null;
      unit     = 'each';
    } else {
      unitCost = null;
      unit     = item.size_unit || 'each';
    }

    return { unit_cost: unitCost, unit };
  }

  // Legacy shape fallback
  const cost = item.standard_unit === 'lb'   ? item.cost_per_lb
             : item.standard_unit === 'each' ? item.cost_per_each
             : item.standard_unit === 'oz'   ? item.cost_per_lb
             : item.standard_unit === 'gal'  ? item.cost_per_each
             : item.standard_unit === 'case' ? item.cost_per_each
             : (item.cost_per_lb ?? item.cost_per_each ?? null);
  return { unit_cost: cost ?? null, unit: item.standard_unit || item.quantity_unit || 'each' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { restaurant_id, invoice, line_items, file_urls, file_url, ocr_text, append_to_invoice_id } = body;

  // Support both old single file_url and new file_urls array
  const allFileUrls = file_urls?.length
    ? file_urls
    : file_url ? [file_url] : [];

  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!invoice)       return res.status(400).json({ error: 'invoice data is required' });

  // Verify the calling user owns this restaurant
  const { error: authError, status: authStatus } = await import('../../../lib/withRestaurantAuth')
    .then(m => m.verifyRestaurantAccess(req, restaurant_id));
  if (authError) return res.status(authStatus).json({ error: authError });

  const activeItems = (line_items || []).filter(i => !i.dismissed);
  console.log('[confirm-invoice] raw items', JSON.stringify(activeItems.map(i => ({
    name: i.item_name, shipped: i.quantity_shipped, ordered: i.quantity_ordered,
    pack: i.pack, size: i.size, size_unit: i.size_unit,
    catch_weight: i.catch_weight, actual_weight: i.actual_weight,
    invoice_price: i.invoice_price, line_total: i.line_total,
  }))));
  const invoiceDate = invoice.invoice_date || new Date().toISOString().split('T')[0];
  const appendMode  = !!append_to_invoice_id;

  const results = {
    invoice_id:           null,
    items_saved:          0,
    ingredients_created:  0,
    ingredients_updated:  0,
    errors:               [],
  };

  try {
    // ── Step 1: Create or reuse invoice record ────────────────────────────────
    let invoiceRecord;
    if (appendMode) {
      invoiceRecord      = { id: append_to_invoice_id };
      results.invoice_id = append_to_invoice_id;
      console.log(`[confirm-invoice] Append mode — adding to invoice ${append_to_invoice_id}`);

      // Bug fix: this branch never saved the new page's file reference at
      // all — only the non-append branch below did. A merged multi-page
      // invoice would silently lose every page's photo after the first,
      // and "View original" would only ever show page 1. Continue the
      // page numbering from whatever's already attached to this invoice,
      // rather than always starting at 1 (which would collide with an
      // existing page 1).
      if (allFileUrls.length > 0) {
        const { data: existingFiles } = await supabase
          .from('invoice_files')
          .select('page_number')
          .eq('invoice_id', append_to_invoice_id)
          .order('page_number', { ascending: false })
          .limit(1);
        const nextPageStart = (existingFiles?.[0]?.page_number || 0) + 1;

        const filesToInsert = allFileUrls.map((url, idx) => ({
          invoice_id:  append_to_invoice_id,
          file_url:    url,
          page_number: nextPageStart + idx,
        }));
        const { error: filesError } = await supabase
          .from('invoice_files')
          .insert(filesToInsert);
        if (filesError) {
          results.errors.push('Failed to save file URLs: ' + filesError.message);
        }
      }
    } else {
      const { data, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          restaurant_id,
          supplier:   invoice.supplier       || null,
          number:     invoice.invoice_number || null,
          date:       invoice.invoice_date   || null,
          amount:     invoice.total_amount   || null,
          non_food_total: invoice.non_food_total ?? null,
          tax_amount:     invoice.tax_amount     ?? null,
          fees_amount:    invoice.fees_amount    ?? null,
          file_url:   allFileUrls[0]         || null, // keep for backwards compat
          ocr_text:   ocr_text               || null,
          reviewed:   false,
          is_sample:  false,
        })
        .select('id')
        .single();

      if (invoiceError) {
        return res.status(500).json({ error: 'Failed to create invoice: ' + invoiceError.message });
      }
      invoiceRecord      = data;
      results.invoice_id = data.id;

      // Insert all file URLs into invoice_files
      if (allFileUrls.length > 0) {
        const filesToInsert = allFileUrls.map((url, idx) => ({
          invoice_id:  data.id,
          file_url:    url,
          page_number: idx + 1,
        }));
        const { error: filesError } = await supabase
          .from('invoice_files')
          .insert(filesToInsert);
        if (filesError) {
          results.errors.push('Failed to save file URLs: ' + filesError.message);
        }
      }
    }

    // ── Step 2: Batch-create new ingredients ──────────────────────────────────
    // Auto-save: create all new ingredients without requiring confirm_new flag.
    const candidateNewItems = activeItems.filter(
      i => !i.selected_ingredient_id && i.match_status === 'new'
    );

    const newIngredientIdMap = {};
    const ingNameOf = (item) => item.confirmed_name || item.item_name_normalized || item.item_name;
    const nameKey = (n) => (n || '').toLowerCase().trim();

    // An ingredient with this exact name (any case) may already exist: link
    // to it instead of creating a lookalike. Step 3 then prices it, with the
    // same older-invoice guard as any matched line.
    let newIngredientItems = candidateNewItems;
    if (candidateNewItems.length > 0) {
      const { data: existingIngs } = await supabase
        .from('ingredients')
        .select('id, name')
        .eq('restaurant_id', restaurant_id)
        .limit(5000);
      const existingByName = new Map((existingIngs || []).map(g => [nameKey(g.name), g]));
      newIngredientItems = [];
      for (const item of candidateNewItems) {
        const hit = existingByName.get(nameKey(ingNameOf(item)));
        if (hit) {
          item.selected_ingredient_id = hit.id;
          item.selected_ingredient_name = hit.name;
        } else {
          newIngredientItems.push(item);
        }
      }
    }

    // Two lines on one invoice naming the same new ingredient create it once.
    const firstByName = new Map();
    for (const item of newIngredientItems) {
      const k = nameKey(ingNameOf(item));
      if (!firstByName.has(k)) firstByName.set(k, item);
    }
    const uniqueNewItems = [...firstByName.values()];

    if (uniqueNewItems.length > 0) {
      const toInsert = uniqueNewItems.map(item => {
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
          const match = createdIngredients.find(c => nameKey(c.name) === nameKey(ingNameOf(item)));
          if (match) newIngredientIdMap[item._id] = match.id;
        }
        results.ingredients_created += createdIngredients.length;
      }
    }

    // ── Step 3: Batch-update existing ingredient prices ───────────────────────
    const ingredientUpdates = {};
    for (const item of activeItems) {
      const ingId = item.selected_ingredient_id || newIngredientIdMap[item._id] || null;
      if (ingId) {
        const { unit_cost, unit } = resolveUnitCost(item);
        if (unit_cost) {
          const ingName  = item.selected_ingredient_name || item.item_name_normalized || item.item_name;
          const stdPrice = convertInvoiceCostToStandardUnit(unit_cost, unit, ingName);
          const stdUnit  = getStandardUnitForIngredient(unit, ingName);

          ingredientUpdates[ingId] = {
            last_price:      stdPrice,
            unit:            stdUnit,
            standard_unit:   stdUnit,
            last_ordered_at: invoiceDate,
            is_estimated:    false,
          };
        }
      }
    }

    // Never replace a newer price with this invoice's: an older invoice
    // uploaded late adds its lines and history, but does not roll prices back.
    const updateIds = Object.keys(ingredientUpdates);
    if (updateIds.length) {
      const { data: current } = await supabase
        .from('ingredients')
        .select('id, last_ordered_at')
        .in('id', updateIds)
        .eq('restaurant_id', restaurant_id);
      for (const g of current || []) {
        if (g.last_ordered_at && String(g.last_ordered_at).slice(0, 10) > String(invoiceDate).slice(0, 10)) {
          delete ingredientUpdates[g.id];
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
          if (error) results.errors.push(`Failed to update ingredient ${ingId}: ${error.message}`);
          else       results.ingredients_updated++;
        })
    );
    await Promise.all(updatePromises);

    // ── Step 4: Batch-insert all invoice_items ────────────────────────────────
    // Store original_quantity / original_price so the admin review screen can
    // highlight values that were changed vs what Claude originally parsed.
    const invoiceItemsToInsert = activeItems.map(item => {
      const ingredientId =
        item.selected_ingredient_id ||
        newIngredientIdMap[item._id] ||
        null;

      const { unit_cost, unit } = resolveUnitCost(item);

      let totalQty;
      if (item.catch_weight && item.actual_weight) {
        totalQty = item.actual_weight; // already the line's total shipped weight, in lb
      } else if (item.pack && item.size) {
        const shippedCases = item.quantity_shipped ?? item.quantity_ordered ?? 1;
        totalQty = shippedCases * item.pack * item.size;
      } else {
        totalQty = item.quantity_shipped ?? item.quantity_ordered ?? null;
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
        reviewed:                   false,
        original_quantity:          totalQty,
        original_price:             unit_cost,
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

    // ── Step 5: Recompute dish costs (shared with link-item) ─────────────────
    // History rows are dated to this invoice, not the upload time.
    try {
      await recomputeMenuCosts(
        supabase,
        restaurant_id,
        [...Object.keys(ingredientUpdates), ...Object.values(newIngredientIdMap)],
        { effectiveDate: invoiceDate }
      );
    } catch (err) {
      results.errors.push('Could not recompute dish costs: ' + err.message);
    }

    // A new delivery changes on-hand inventory now, not tonight.
    try {
      await rebuildCurrentInventory(supabase, restaurant_id);
    } catch (err) {
      console.error('[confirm-invoice] current_inventory rebuild failed:', err.message);
    }

    return res.status(200).json({
      success:              true,
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