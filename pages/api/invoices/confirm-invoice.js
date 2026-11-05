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
import {
  getProgressiveInvoiceMatchingPolicy,
  findStrictDirectMatch,
} from '../../../lib/progressiveInvoiceMatching';

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

  let matchingPolicy;

  try {
    matchingPolicy = await getProgressiveInvoiceMatchingPolicy(
      supabase,
      restaurant_id
    );
  } catch (error) {
    console.error('[confirm-invoice] Matching policy:', error);

    return res.status(503).json({
      error: 'Invoice matching controls are unavailable. Please retry.',
    });
  }

  const matchingEnabled = matchingPolicy.matching_enabled;

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

  // Verify ownership independently of the invoice parser.
  // Client-submitted ingredient IDs cannot expand matching eligibility.

  const requestedIngredientIds = matchingEnabled
    ? [...new Set(
        activeItems
          .map(item => item.selected_ingredient_id)
          .filter(Boolean)
      )]
    : [];

  const ownedIngredients = new Map();

  if (requestedIngredientIds.length) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name, unit')
      .eq('restaurant_id', restaurant_id)
      .in('id', requestedIngredientIds);

    if (error) {
      return res.status(503).json({
        error: 'Could not verify ingredient ownership.',
      });
    }

    for (const ingredient of data || []) {
      ownedIngredients.set(ingredient.id, ingredient);
    }

    if (ownedIngredients.size !== requestedIngredientIds.length) {
      return res.status(400).json({
        error: 'An invoice ingredient does not belong to this restaurant.',
      });
    }
  }

  let strictEligibleIngredients = [];

  if (matchingPolicy.mode === 'strict') {
    const eligibleIds = [
      ...matchingPolicy.eligibleIngredientIds,
    ];

    if (eligibleIds.length) {
      const { data, error } = await supabase
        .from('ingredients')
        .select('id, name, unit')
        .eq('restaurant_id', restaurant_id)
        .in('id', eligibleIds);

      if (error) {
        return res.status(503).json({
          error: 'Could not verify confirmed recipe ingredients.',
        });
      }

      strictEligibleIngredients = data || [];

      if (
        strictEligibleIngredients.length !== eligibleIds.length
      ) {
        return res.status(503).json({
          error: 'Confirmed recipe ingredient references are incomplete.',
        });
      }
    }
  }

  const permittedIngredientId = item => {
    if (!matchingEnabled) return null;

    const requestedId = item.selected_ingredient_id;

    if (
      !requestedId ||
      !ownedIngredients.has(requestedId)
    ) {
      return null;
    }

    if (matchingPolicy.mode !== 'strict') {
      return requestedId;
    }

    // Recompute the direct match on the server.
    // Never accept a submitted ID merely because it belongs
    // to a restaurant or appeared in the browser's candidates.
    const result = findStrictDirectMatch(
      item.item_name_normalized ||
        item.item_name_raw ||
        item.item_name,
      strictEligibleIngredients
    );

    if (
      result.status !== 'auto' ||
      result.matches[0]?.id !== requestedId
    ) {
      return null;
    }

    return requestedId;
  };

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
      const { data: existingInvoice, error: existingInvoiceError } =
        await supabase
          .from('invoices')
          .select('id, restaurant_id')
          .eq('id', append_to_invoice_id)
          .eq('restaurant_id', restaurant_id)
          .maybeSingle();

      if (existingInvoiceError) {
        throw new Error(
          'Could not verify the invoice being appended.'
        );
      }

      if (!existingInvoice) {
        return res.status(404).json({
          error: 'Invoice not found for this restaurant.',
        });
      }

      invoiceRecord = { id: existingInvoice.id };
      results.invoice_id = existingInvoice.id;

      console.log(
        `[confirm-invoice] Append mode — adding to invoice ${existingInvoice.id}`
      );
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

    // ── Step 2: Ingredient creation is recipe-owned ───────────────────────────
    // Invoice lines can only reference previously validated ingredients.

    // ── Step 3: Batch-update existing ingredient prices ───────────────────────
    const ingredientUpdates = {};
    for (const item of activeItems) {
      const ingId = permittedIngredientId(item);
      if (ingId) {
        const { unit_cost, unit } = resolvedCost(item);
        if (unit_cost) {
          const { data: ingredientRecord, error: ingredientError } = await supabase
            .from('ingredients')
            .select('name')
            .eq('id', ingId)
            .eq('restaurant_id', restaurant_id)
            .single();

          if (ingredientError || !ingredientRecord) {
            throw new Error(
              `Could not load ingredient ${ingId} for price conversion.`
            );
          }

          const ingName = ingredientRecord.name;
          const stdPrice = convertInvoiceCostToStandardUnit(
            unit_cost,
            unit,
            ingName
          );
          const stdUnit = getStandardUnitForIngredient(unit, ingName);

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

    // Ingredient prices are updated only after invoice lines are saved.

    // ── Step 4: Batch-insert all invoice_items ────────────────────────────────
    // Store original_quantity / original_price so the admin review screen can
    // highlight values that were changed vs what Claude originally parsed.
    const invoiceItemsToInsert = activeItems.map(item => {
      const ingredientId = permittedIngredientId(item);

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
        match_candidates:
          matchingEnabled &&
          !ingredientId &&
          Array.isArray(item.match_candidates) &&
          item.match_candidates.length
            ? item.match_candidates
                .slice(0, 3)
                .filter(candidate =>
                  candidate &&
                  candidate.id &&
                  candidate.name
                )
                .map(candidate => ({
                  id: candidate.id,
                  name: candidate.name,
                }))
            : null,
      };
    });

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(invoiceItemsToInsert);

    if (itemsError) {
      results.errors.push(
        'Failed to batch-insert invoice items: ' + itemsError.message
      );

      return res.status(500).json({
        success: false,
        invoice_id: results.invoice_id,
        items_saved: 0,
        ingredients_created: 0,
        ingredients_updated: 0,
        errors: results.errors,
      });
    }

    results.items_saved = invoiceItemsToInsert.length;

    // Only update ingredient prices after the invoice lines are saved.
    if (matchingEnabled && results.items_saved > 0) {
      const updatePromises = Object.entries(ingredientUpdates).map(
        ([ingId, updates]) =>
          supabase
            .from('ingredients')
            .update(updates)
            .eq('id', ingId)
            .eq('restaurant_id', restaurant_id)
            .then(({ error }) => {
              if (error) {
                results.errors.push(
                  `Failed to update ingredient ${ingId}: ${error.message}`
                );
              } else {
                results.ingredients_updated++;
              }
            })
      );

      await Promise.all(updatePromises);
    }

    // Do not recalculate costs or inventory when ingredient pricing failed.
    // The invoice lines remain saved for later review or recovery.
    if (results.errors.length > 0) {
      return res.status(500).json({
        success: false,
        invoice_id: results.invoice_id,
        items_saved: results.items_saved,
        ingredients_created: 0,
        ingredients_updated: results.ingredients_updated,
        errors: results.errors,
      });
    }

    // ── Step 5: Recompute only when matching is enabled ───────────────────────
    // Locked restaurants retain invoice data without modifying ingredient
    // prices, recipe costs, or ingredient-linked inventory.

    if (
      matchingEnabled &&
      results.items_saved > 0 &&
      Object.keys(ingredientUpdates).length > 0
    ) {
      try {
        await recompute(
          supabase,
          restaurant_id,
          Object.keys(ingredientUpdates),
          { effectiveDate: invoiceDate }
        );
      } catch (err) {
        results.errors.push(
          'Could not recompute dish costs: ' + err.message
        );
      }
    }

    // An invoice with permitted ingredient links may change inventory.
    // Never rebuild inventory for a locked restaurant.

    if (
      matchingEnabled &&
      results.items_saved > 0 &&
      invoiceItemsToInsert.some(item => item.ingredient_id)
    ) {
      try {
        await rebuild(supabase, restaurant_id);
      } catch (err) {
        console.error(
          '[confirm-invoice] current_inventory rebuild failed:',
          err.message
        );
      }
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