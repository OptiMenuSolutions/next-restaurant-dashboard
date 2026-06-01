// pages/api/admin/invoice-review/index.js
// GET: returns all unreviewed invoices with line items + ingredient candidates.
// Grouped by restaurant. Scoped ingredient library per restaurant.

import { createClient } from '@supabase/supabase-js';

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
  if (req.method !== 'GET') return res.status(405).end();

  const adminUser = await verifyAdmin(req);
  if (!adminUser) return res.status(403).json({ error: 'Unauthorized' });

  try {
    // ── 1. Fetch all unreviewed invoices ──────────────────────────────────────
    const { data: invoices, error: invErr } = await supabase
      .from('invoices')
      .select('id, restaurant_id, supplier, number, date, amount, file_url, created_at')
      .eq('reviewed', false)
      .eq('is_sample', false)
      .order('date', { ascending: false });

    if (invErr) throw invErr;
    if (!invoices?.length) return res.status(200).json({ groups: [] });

    const invoiceIds     = invoices.map(i => i.id);
    const restaurantIds  = [...new Set(invoices.map(i => i.restaurant_id))];

    // ── 2. Fetch all line items for those invoices ────────────────────────────
    const { data: lineItems, error: liErr } = await supabase
      .from('invoice_items')
      .select('id, invoice_id, item_name, quantity, unit, unit_cost, amount, ingredient_id, reviewed, original_quantity, original_price')
      .in('invoice_id', invoiceIds)
      .order('item_name');

    if (liErr) throw liErr;

    // ── 3. Fetch restaurant names ─────────────────────────────────────────────
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('id, name')
      .in('id', restaurantIds);

    const restaurantMap = Object.fromEntries((restaurants || []).map(r => [r.id, r.name]));

    // ── 4. Fetch ingredient libraries scoped per restaurant ───────────────────
    const { data: allIngredients } = await supabase
      .from('ingredients')
      .select('id, restaurant_id, name, unit, last_price')
      .in('restaurant_id', restaurantIds)
      .order('name');

    // Map: restaurantId → ingredient[]
    const ingredientsByRestaurant = {};
    for (const ing of (allIngredients || [])) {
      if (!ingredientsByRestaurant[ing.restaurant_id]) {
        ingredientsByRestaurant[ing.restaurant_id] = [];
      }
      ingredientsByRestaurant[ing.restaurant_id].push(ing);
    }

    // ── 5. Fetch currently linked ingredient names for display ────────────────
    const linkedIngredientIds = [
      ...new Set((lineItems || []).map(li => li.ingredient_id).filter(Boolean))
    ];

    const ingredientNameMap = {};
    if (linkedIngredientIds.length) {
      const { data: linkedIngs } = await supabase
        .from('ingredients')
        .select('id, name, unit')
        .in('id', linkedIngredientIds);
      for (const ing of (linkedIngs || [])) ingredientNameMap[ing.id] = ing;
    }

    // ── 6. Group line items by invoice ────────────────────────────────────────
    const itemsByInvoice = {};
    for (const item of (lineItems || [])) {
      if (!itemsByInvoice[item.invoice_id]) itemsByInvoice[item.invoice_id] = [];
      itemsByInvoice[item.invoice_id].push({
        ...item,
        linked_ingredient_name: item.ingredient_id
          ? ingredientNameMap[item.ingredient_id]?.name || null
          : null,
        linked_ingredient_unit: item.ingredient_id
          ? ingredientNameMap[item.ingredient_id]?.unit || null
          : null,
      });
    }

    // ── 7. Group invoices by restaurant ───────────────────────────────────────
    const groupMap = {};
    for (const inv of invoices) {
      const rid = inv.restaurant_id;
      if (!groupMap[rid]) {
        groupMap[rid] = {
          restaurant_id:   rid,
          restaurant_name: restaurantMap[rid] || 'Unknown Restaurant',
          ingredients:     ingredientsByRestaurant[rid] || [],
          invoices:        [],
        };
      }
      groupMap[rid].invoices.push({
        ...inv,
        line_items: itemsByInvoice[inv.id] || [],
      });
    }

    return res.status(200).json({ groups: Object.values(groupMap) });

  } catch (err) {
    console.error('[invoice-review GET]', err);
    return res.status(500).json({ error: err.message });
  }
}