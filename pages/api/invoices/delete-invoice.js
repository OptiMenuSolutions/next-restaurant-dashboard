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
import { convertInvoiceCostToStandardUnit, getStandardUnitForIngredient } from '../../../lib/standardizedUnits';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORAGE_BUCKET = 'invoices';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { restaurant_id, invoice_ids } = body || {};
  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!Array.isArray(invoice_ids) || !invoice_ids.length) return res.status(400).json({ error: 'invoice_ids is required' });

  // Same owner check as confirm-invoice.
  const { error: authError, status: authStatus } = await import('../../../lib/withRestaurantAuth')
    .then(m => m.verifyRestaurantAccess(req, restaurant_id));
  if (authError) return res.status(authStatus).json({ error: authError });

  try {
    // Only invoices that belong to this restaurant.
    const { data: invoices, error: invErr } = await supabase
      .from('invoices')
      .select('id, file_url')
      .eq('restaurant_id', restaurant_id)
      .in('id', invoice_ids);
    if (invErr) throw invErr;
    const ids = (invoices || []).map(i => i.id);
    if (!ids.length) return res.status(404).json({ error: 'Invoice not found' });

    // Ingredients these invoices priced, so they can be re-priced afterwards.
    const { data: lines, error: linesErr } = await supabase
      .from('invoice_items')
      .select('id, ingredient_id')
      .in('invoice_id', ids);
    if (linesErr) throw linesErr;
    const ingredientIds = [...new Set((lines || []).map(l => l.ingredient_id).filter(Boolean))];

    // Stored files, removed from Storage after the rows are gone (best effort).
    const { data: fileRows } = await supabase
      .from('invoice_files')
      .select('file_url')
      .in('invoice_id', ids);
    const paths = [...new Set([
      ...(fileRows || []).map(f => f.file_url),
      ...(invoices || []).map(i => i.file_url),
    ].filter(p => p && !/^https?:\/\//.test(p)))];

    // Delete children first, then the invoices.
    const { error: delItemsErr } = await supabase.from('invoice_items').delete().in('invoice_id', ids);
    if (delItemsErr) {
      // Most likely another table (e.g. waste_confirmations) still points at
      // one of these lines.
      return res.status(409).json({ error: 'Could not remove this invoice’s lines: ' + delItemsErr.message });
    }
    await supabase.from('invoice_files').delete().in('invoice_id', ids);
    const { error: delInvErr } = await supabase
      .from('invoices')
      .delete()
      .in('id', ids)
      .eq('restaurant_id', restaurant_id);
    if (delInvErr) throw delInvErr;

    if (paths.length) {
      const { error: storageErr } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageErr) console.error('[delete-invoice] storage cleanup failed:', storageErr.message);
    }

    // ── Re-price each affected ingredient from its newest remaining line ──
    let repriced = 0, cleared = 0;
    if (ingredientIds.length) {
      const [{ data: ings }, { data: remaining }] = await Promise.all([
        supabase.from('ingredients').select('id, name').in('id', ingredientIds).eq('restaurant_id', restaurant_id),
        supabase
          .from('invoice_items')
          .select('ingredient_id, unit, unit_cost, invoices!invoice_items_invoice_id_fkey!inner(date, restaurant_id)')
          .in('ingredient_id', ingredientIds)
          .eq('invoices.restaurant_id', restaurant_id)
          .limit(5000),
      ]);
      const newest = new Map();
      for (const r of remaining || []) {
        if (!(Number(r.unit_cost) > 0)) continue;
        const d = String(r.invoices?.date || '');
        const cur = newest.get(r.ingredient_id);
        if (!cur || d > cur.date) newest.set(r.ingredient_id, { date: d, unit: r.unit, unitCost: Number(r.unit_cost) });
      }
      await Promise.all((ings || []).map(g => {
        const n = newest.get(g.id);
        const update = n
          ? {
              last_price: convertInvoiceCostToStandardUnit(n.unitCost, n.unit, g.name),
              unit: getStandardUnitForIngredient(n.unit, g.name),
              standard_unit: getStandardUnitForIngredient(n.unit, g.name),
              last_ordered_at: n.date.slice(0, 10) || null,
              is_estimated: false,
            }
          // No invoice left to price it from: clear the price rather than
          // keep one that came from the deleted invoice.
          : { last_price: null, last_ordered_at: null };
        if (n) repriced++; else cleared++;
        return supabase.from('ingredients').update(update).eq('id', g.id).eq('restaurant_id', restaurant_id);
      }));

      try {
        await recomputeMenuCosts(supabase, restaurant_id, ingredientIds, { effectiveDate: new Date().toISOString().split('T')[0] });
      } catch (err) {
        console.error('[delete-invoice] recomputeMenuCosts failed:', err.message);
      }
    }

    try {
      await rebuildCurrentInventory(supabase, restaurant_id);
    } catch (err) {
      console.error('[delete-invoice] current_inventory rebuild failed:', err.message);
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
}