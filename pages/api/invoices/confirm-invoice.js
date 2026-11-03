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
import { isInternalCall } from '../../../lib/scannerAuth';
import { parseNumberedCanPack } from '../../../lib/invoicePackageSize';
import {
  resolveInvoiceResearchCost,
} from '../../../lib/invoiceResearchCosting';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function createConfirmInvoiceHandler({
  db = supabase,
  resolveCost = resolveInvoiceResearchCost,
  recompute = recomputeMenuCosts,
  rebuild = rebuildCurrentInventory,
  verifyAccess = async (req, restaurantId) =>
    import('../../../lib/withRestaurantAuth')
      .then(m => m.verifyRestaurantAccess(req, restaurantId)),
} = {}) {
  return async function handler(req, res) {
    const supabase = db;
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

  // Verify the calling user owns this restaurant. Scanner photos come from
  // /api/scanner/process, which has already checked the scanner.
  if (!isInternalCall(req)) {
    const { error: authError, status: authStatus } =
      await verifyAccess(req, restaurant_id);
    if (authError) return res.status(authStatus).json({ error: authError });
  }

  // Normalize recognized numbered-can packages before any ingredient
  // pricing, inventory quantity, or invoice line calculations.
  // This applies to every restaurant and supplier.
  const activeItems = (line_items || [])
    .filter(i => !i.dismissed)
    .map(item => {
      const parsedPack = parseNumberedCanPack(item.pack_size_raw);

      if (!parsedPack) return item;

      // Catch-weight products follow their own weight-based accounting.
      if (item.catch_weight) return item;

      // A numbered-can designation describes the container, not
      // its fluid volume. Preserve the original raw package text.
      return {
        ...item,
        pack: parsedPack.pack,
        size: parsedPack.size,
        size_unit: parsedPack.size_unit,
      };
    });
    
  // Explicit server-side feature flag.
  // Disabled by default: no research calls or automatic approvals.
  const researchEnabled =
    process.env.INVOICE_VERIFIED_RESEARCH_ENABLED === 'true';

  // Resolve costs once per invoice line so ingredient pricing
  // and invoice history use exactly the same calculation.
  // These results are never taken from client approval fields.
  const resolvedCosts = await Promise.all(
    activeItems.map(item =>
      resolveCost(
        item,
        invoice.supplier,
        { enabled: researchEnabled }
      )
    )
  );

  const costByItem = new Map(
    activeItems.map((item, index) => [
      item,
      resolvedCosts[index],
    ])
  );

  const resolvedCost = (item) =>
    costByItem.get(item);

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
        const { unit_cost, unit } = resolvedCost(item);
        const ingName  = item.confirmed_name || item.item_name_normalized || item.item_name;
        const unresolved =
          resolvedCost(item).pricingStatus ===
          'needs_package_verification';

        const stdUnit = unresolved
          ? 'can'
          : getStandardUnitForIngredient(unit, ingName);

        const stdPrice =
          !unresolved &&
          Number.isFinite(Number(unit_cost)) &&
          Number(unit_cost) > 0
            ? convertInvoiceCostToStandardUnit(
                unit_cost,
                unit,
                ingName
              )
            : null;

        return {
          restaurant_id,
          name:                ingName,
          unit:                stdUnit,
          standard_unit:       stdUnit,
          original_unit:       unit || 'each',
          last_price:          stdPrice,
          last_ordered_at:     invoiceDate,
          ingredient_category: unresolved
            ? 'count'
            : 'weight',
          is_sample:           false,
          is_estimated:        unresolved,
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
        const { unit_cost, unit } = resolvedCost(item);
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

      const {
        quantity: totalQty,
        unit,
        unit_cost,
      } = resolvedCost(item);

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
        // The matcher's best guesses for a line it was unsure about, shown as
        // one-tap choices when linking. Only kept on lines left unlinked.
        match_candidates: !ingredientId && Array.isArray(item.match_candidates) && item.match_candidates.length
          ? item.match_candidates.slice(0, 3).map((c) => ({ id: c.id, name: c.name }))
          : null,
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
      await recompute(
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
      await rebuild(supabase, restaurant_id);
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
}

export default createConfirmInvoiceHandler();