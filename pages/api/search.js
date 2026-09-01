// pages/api/search.js
// Backs the search modal on every client page (dashboard included). One
// query fans out across invoices (supplier/number), ingredients (name), and
// menu items (name) — this is what "plugging into onSearch" actually means:
// every screen already renders a search button wired to an onSearch prop
// the pages themselves never set. This is the thing that prop should call.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await supabase
      .from('profiles').select('restaurant_id').eq('id', user.id).single();
    if (!profile?.restaurant_id) return res.status(400).json({ error: 'No restaurant on this account yet' });
    const restaurantId = profile.restaurant_id;

    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(200).json({ invoices: [], ingredients: [], menuItems: [] });

    const like = `%${q}%`;

    const [{ data: invoices }, { data: ingredients }, { data: menuItems }] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, supplier, number, date, amount')
        .eq('restaurant_id', restaurantId)
        .or(`supplier.ilike.${like},number.ilike.${like}`)
        .order('date', { ascending: false })
        .limit(8),
      supabase
        .from('ingredients')
        .select('id, name, unit, last_price')
        .eq('restaurant_id', restaurantId)
        .ilike('name', like)
        .order('name')
        .limit(8),
      supabase
        .from('menu_items')
        .select('id, name, category, price')
        .eq('restaurant_id', restaurantId)
        .ilike('name', like)
        .order('name')
        .limit(8),
    ]);

    return res.status(200).json({
      invoices: invoices || [],
      ingredients: ingredients || [],
      menuItems: menuItems || [],
    });
  } catch (err) {
    console.error('[search] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
