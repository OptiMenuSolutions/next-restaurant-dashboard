// pages/api/admin/invoice-review/save-items.js
// POST: batch-save edits to invoice_items for one invoice.
// Accepts array of { id, quantity, unit, unit_cost, amount, ingredient_id }
// Also re-runs ingredient last_price update for any changed ingredient links.

import { createClient } from '@supabase/supabase-js';
import {
  convertInvoiceCostToStandardUnit,
  getStandardUnitForIngredient,
} from '../../../../lib/standardizedUnits';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  return profile?.role === 'admin' ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const adminUser = await verifyAdmin(req);
  if (!adminUser) return res.status(403).json({ error: 'Unauthorized' });

  const { invoice_id, restaurant_id, items } = req.body;
  if (!invoice_id || !restaurant_id || !Array.isArray(items)) {
    return res.status(400).json({ error: 'invoice_id, restaurant_id, and items[] required' });
  }

  try {
    const errors = [];

    // ── Save each line item ───────────────────────────────────────────────────
    await Promise.all(items.map(async item => {
      const { id, quantity, unit, unit_cost, amount, ingredient_id } = item;

      const { error } = await supabase
        .from('invoice_items')
        .update({ quantity, unit, unit_cost, amount, ingredient_id })
        .eq('id', id)
        .eq('invoice_id', invoice_id);

      if (error) errors.push(`Item ${id}: ${error.message}`);
    }));

    // ── Re-run ingredient last_price for any linked ingredients ───────────────
    // Only update ingredients that have a unit_cost and ingredient_id set.
    const linkedItems = items.filter(i => i.ingredient_id && i.unit_cost);

    if (linkedItems.length) {
      // Fetch ingredient names for unit conversion
      const ingIds = [...new Set(linkedItems.map(i => i.ingredient_id))];
      const { data: ingredients } = await supabase
        .from('ingredients')
        .select('id, name, unit')
        .in('id', ingIds);

      const ingMap = Object.fromEntries((ingredients || []).map(i => [i.id, i]));

      // Get invoice date for last_ordered_at
      const { data: invoiceRow } = await supabase
        .from('invoices')
        .select('date')
        .eq('id', invoice_id)
        .single();

      const invoiceDate = invoiceRow?.date || new Date().toISOString().split('T')[0];

      await Promise.all(linkedItems.map(async item => {
        const ing = ingMap[item.ingredient_id];
        if (!ing) return;

        const stdPrice = convertInvoiceCostToStandardUnit(item.unit_cost, item.unit, ing.name);
        const stdUnit  = getStandardUnitForIngredient(item.unit, ing.name);

        const { error } = await supabase
          .from('ingredients')
          .update({
            last_price:      stdPrice,
            unit:            stdUnit,
            last_ordered_at: invoiceDate,
          })
          .eq('id', item.ingredient_id)
          .eq('restaurant_id', restaurant_id);

        if (error) errors.push(`Ingredient ${item.ingredient_id}: ${error.message}`);
      }));
    }

    return res.status(200).json({ success: true, errors });

  } catch (err) {
    console.error('[invoice-review save-items]', err);
    return res.status(500).json({ error: err.message });
  }
}