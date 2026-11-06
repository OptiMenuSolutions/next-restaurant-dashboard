// pages/api/invoices/delete-invoice.js
// Deletes one or more invoices (a wrong upload, or the extra copies of a
// duplicate) and undoes what confirm-invoice.js did when they were saved:
//   1. each affected ingredient's last_price / last_ordered_at goes back to its
//      most recent remaining invoice line (or is cleared if none is left),
//   2. dish costs are recomputed for those ingredients,
//   3. current_inventory is rebuilt.
// Children are deleted explicitly before the invoice row, so this works
// whether or not the foreign keys cascade.

import { createClient } from '@supabase/supabase-js';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';
import { recomputeMenuCosts } from '../../../lib/recomputeMenuCosts';
import {
  selectInvoiceRepricingSource,
} from '../../../lib/invoiceRepricing';
import { getRestaurantInvoiceMatchingControl } from '../../../lib/invoiceMatchingControls';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORAGE_BUCKET = 'invoices';

export function createDeleteInvoiceHandler({
  db = supabase,
  verifyAccess,
  getMatchingControl = getRestaurantInvoiceMatchingControl,
  recompute = recomputeMenuCosts,
  rebuild = rebuildCurrentInventory,
} = {}) {
  return async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { restaurant_id, invoice_ids } = body || {};
  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!Array.isArray(invoice_ids) || !invoice_ids.length) return res.status(400).json({ error: 'invoice_ids is required' });

  // Same owner check as confirm-invoice.
  const { error: authError, status: authStatus } = await (
    verifyAccess
      ? verifyAccess(req, restaurant_id)
      : import('../../../lib/withRestaurantAuth')
          .then(m => m.verifyRestaurantAccess(req, restaurant_id))
  );
  if (authError) return res.status(authStatus).json({ error: authError });

  // Invoice deletion is permitted for locked restaurants, but
  // ingredient repricing and inventory recalculation are not.
  // Fail closed if the matching-control record is unavailable.
  let matchingControl;

  try {
    matchingControl = await getMatchingControl(
      db,
      restaurant_id
    );
  } catch (error) {
    console.error('[delete-invoice] Matching control:', error);

    return res.status(503).json({
      error: 'Invoice matching controls are unavailable. Please retry.',
    });
  }

  const matchingEnabled = matchingControl.matching_enabled;

  try {
    // Only invoices that belong to this restaurant.
    const { data: invoices, error: invErr } = await db
      .from('invoices')
      .select('id, file_url')
      .eq('restaurant_id', restaurant_id)
      .in('id', invoice_ids);
    if (invErr) throw invErr;
    const ids = (invoices || []).map(i => i.id);
    if (!ids.length) return res.status(404).json({ error: 'Invoice not found' });

    // Ingredients these invoices priced, so they can be re-priced afterwards.
    const { data: lines, error: linesErr } = await db
      .from('invoice_items')
      .select('id, ingredient_id')
      .in('invoice_id', ids);
    if (linesErr) throw linesErr;
    const ingredientIds = [...new Set((lines || []).map(l => l.ingredient_id).filter(Boolean))];

    // Stored files, removed from Storage after the rows are gone (best effort).
    const { data: fileRows } = await db
      .from('invoice_files')
      .select('file_url')
      .in('invoice_id', ids);
    const paths = [...new Set([
      ...(fileRows || []).map(f => f.file_url),
      ...(invoices || []).map(i => i.file_url),
    ].filter(p => p && !/^https?:\/\//.test(p)))];

    // Delete children first, then the invoices.
    const { error: delItemsErr } = await db.from('invoice_items').delete().in('invoice_id', ids);
    if (delItemsErr) {
      // Most likely another table (e.g. waste_confirmations) still points at
      // one of these lines.
      return res.status(409).json({ error: 'Could not remove this invoice’s lines: ' + delItemsErr.message });
    }
    await db.from('invoice_files').delete().in('invoice_id', ids);
    const { error: delInvErr } = await db
      .from('invoices')
      .delete()
      .in('id', ids)
      .eq('restaurant_id', restaurant_id);
    if (delInvErr) throw delInvErr;

    if (paths.length) {
      const { error: storageErr } = await db.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageErr) console.error('[delete-invoice] storage cleanup failed:', storageErr.message);
    }

    // ── Reprice affected ingredients using shared safety rules ──
    let repriced = 0;
    let cleared = 0;

    if (matchingEnabled && ingredientIds.length) {
      const [
        { data: ingredients, error: ingredientError },
        { data: remaining, error: remainingError },
      ] = await Promise.all([
        db
          .from('ingredients')
          .select('id, name, last_ordered_at, price_status')
          .in('id', ingredientIds)
          .eq('restaurant_id', restaurant_id),

        db
          .from('invoice_items')
          .select(
            'ingredient_id, unit, unit_cost, ' +
            'invoices!invoice_items_invoice_id_fkey!inner' +
            '(date, created_at, restaurant_id)'
          )
          .in('ingredient_id', ingredientIds)
          .eq('invoices.restaurant_id', restaurant_id)
          .limit(5000),
      ]);

      if (ingredientError) throw ingredientError;
      if (remainingError) throw remainingError;

      const linesByIngredient = new Map();

      for (const line of remaining || []) {
        if (!linesByIngredient.has(line.ingredient_id)) {
          linesByIngredient.set(line.ingredient_id, []);
        }

        linesByIngredient.get(line.ingredient_id).push(line);
      }

      for (const ingredient of ingredients || []) {
        const lines =
          linesByIngredient.get(ingredient.id) || [];

        const decision = selectInvoiceRepricingSource(lines);

        let updates = null;

        if (decision.status === 'priced') {
          updates = decision.updates;
          repriced++;
        } else if (
          decision.status === 'no_linked_invoices' &&
          ingredient.price_status === 'invoice'
        ) {
          // The ingredient no longer has an invoice-based
          // price source. Clear only invoice-derived pricing.
          updates = {
            last_price: null,
            last_ordered_at: null,
            is_estimated: true,
            price_status: 'needs_review',
            price_approved_at: null,
          };

          cleared++;
        }

        // Unverified remaining lines must not overwrite an
        // existing price or establish a new one.
        if (!updates) continue;

        const { error: updateError } = await db
          .from('ingredients')
          .update(updates)
          .eq('id', ingredient.id)
          .eq('restaurant_id', restaurant_id);

        if (updateError) throw updateError;
      }

      try {
        await recompute(
          db,
          restaurant_id,
          ingredientIds,
          {
            effectiveDate:
              new Date().toISOString().split('T')[0],
          }
        );
      } catch (error) {
        console.error(
          '[delete-invoice] recomputeMenuCosts failed:',
          error.message
        );
      }
    }

    if (matchingEnabled) {
      try {
        await rebuild(db, restaurant_id);
      } catch (err) {
        console.error(
          '[delete-invoice] current_inventory rebuild failed:',
          err.message
        );
      }
    }

    return res.status(200).json({
      success: true,
      deleted: ids.length,
      lines_deleted: (lines || []).length,
      ingredients_repriced: repriced,
      ingredients_cleared: cleared,
    });
  } catch (err) {
    console.error('[delete-invoice] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete invoice' });
  }
  };
}

export default createDeleteInvoiceHandler();