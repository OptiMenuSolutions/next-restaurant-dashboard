// pages/api/admin/price-review.js
// Admin-only. Lists a restaurant's ingredients that still have only an AI
// estimate (no invoice price, not approved), ranked by how many dishes
// approving each one would fully price, and approves them.
//
// GET  ?restaurant_id=...   -> { restaurants, summary, items }
// POST { restaurant_id, approvals: [{ id, price }] } -> { approved }
//
// Approving sets price_approved_at (and last_price, if a corrected price is
// sent). The app-wide rule "show a price only if it came from an invoice or
// was approved" then takes over everywhere. A later invoice still replaces it.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !user) return null;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  return profile?.role === 'admin' ? user : null;
}

const isPriced = (g) => g.is_estimated === false || !!g.price_approved_at;

export default async function handler(req, res) {
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admins only' });

  if (req.method === 'GET') {
    const { data: restaurants } = await supabase.from('restaurants').select('id, name').order('name');
    const restaurantId = req.query.restaurant_id;
    if (!restaurantId) return res.status(200).json({ restaurants: restaurants || [], items: [], summary: null });

    const [{ data: ingredients, error: ingErr }, { data: dishes, error: dishErr }, { data: globals }] = await Promise.all([
      supabase.from('ingredients')
        .select('id, name, unit, last_price, is_estimated, price_approved_at')
        .eq('restaurant_id', restaurantId)
        .limit(3000),
      supabase.from('menu_items')
        .select('id, menu_item_components(component_ingredients(ingredient_id))')
        .eq('restaurant_id', restaurantId)
        .is('archived_at', null)
        .limit(1000),
      supabase.from('global_ingredients').select('name, aliases, reference_price, reference_unit'),
    ]);
    if (ingErr || dishErr) return res.status(500).json({ error: (ingErr || dishErr).message });

    const byId = new Map((ingredients || []).map((g) => [g.id, g]));

    // For each dish: which of its ingredients still have no usable price.
    let pricedDishes = 0;
    const uses = {};
    const unlocks = {};
    for (const d of dishes || []) {
      const ids = new Set();
      for (const c of d.menu_item_components || []) {
        for (const ci of c.component_ingredients || []) if (ci.ingredient_id) ids.add(ci.ingredient_id);
      }
      if (!ids.size) continue;
      const missing = [...ids].filter((id) => byId.get(id) && !isPriced(byId.get(id)));
      for (const id of ids) uses[id] = (uses[id] || 0) + 1;
      if (missing.length === 0) pricedDishes++;
      if (missing.length === 1) unlocks[missing[0]] = (unlocks[missing[0]] || 0) + 1;
    }

    // Global reference prices, matched by name or alias.
    const refs = new Map();
    for (const g of globals || []) {
      if (g.reference_price == null) continue;
      const ref = { price: Number(g.reference_price), unit: g.reference_unit || null };
      refs.set(String(g.name).toLowerCase().trim(), ref);
      for (const a of g.aliases || []) {
        const k = String(a).toLowerCase().trim();
        if (k && !refs.has(k)) refs.set(k, ref);
      }
    }

    const items = (ingredients || [])
      .filter((g) => !isPriced(g))
      .map((g) => {
        const ref = refs.get(String(g.name).toLowerCase().trim()) || null;
        return {
          id: g.id,
          name: g.name,
          unit: g.unit,
          estimate: g.last_price != null ? Number(g.last_price) : null,
          reference: ref,
          uses: uses[g.id] || 0,
          unlocks: unlocks[g.id] || 0,
        };
      })
      .filter((g) => g.uses > 0) // not used by any dish: nothing to gain from approving it
      .sort((a, b) => b.unlocks - a.unlocks || b.uses - a.uses || a.name.localeCompare(b.name));

    return res.status(200).json({
      restaurants: restaurants || [],
      items,
      summary: { dishes: (dishes || []).length, pricedDishes, waiting: items.length },
    });
  }

  if (req.method === 'POST') {
    const { restaurant_id: restaurantId, approvals } = req.body || {};
    if (!restaurantId || !Array.isArray(approvals) || !approvals.length) {
      return res.status(400).json({ error: 'restaurant_id and approvals are required' });
    }
    const now = new Date().toISOString();
    let approved = 0;
    const errors = [];
    for (const a of approvals) {
      const price = Number(a.price);
      if (!a.id || !(price > 0)) { errors.push(`${a.id}: price must be above 0`); continue; }
      const { error } = await supabase
        .from('ingredients')
        .update({ last_price: price, price_approved_at: now })
        .eq('id', a.id)
        .eq('restaurant_id', restaurantId)
        .is('price_approved_at', null);
      if (error) errors.push(`${a.id}: ${error.message}`);
      else approved++;
    }
    return res.status(200).json({ approved, errors });
  }

  return res.status(405).end();
}