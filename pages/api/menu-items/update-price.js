// pages/api/menu-items/update-price.js
// Updates a single menu item's price. Built specifically to replace the
// "Reprice to target" button's old behavior — it used to navigate to
// /client/menu-items/[id]?price=... which was never actually built out,
// and shouldn't have navigated anywhere in the first place. This lets the
// price update happen in place, in the same card, no navigation at all.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { restaurant_id, menu_item_id, price } = req.body || {};

  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id is required' });
  if (!menu_item_id) return res.status(400).json({ error: 'menu_item_id is required' });
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return res.status(400).json({ error: 'price must be a positive number' });
  }

  const { error: authError, status: authStatus } = await import('../../../lib/withRestaurantAuth')
    .then(m => m.verifyRestaurantAccess(req, restaurant_id));
  if (authError) return res.status(authStatus).json({ error: authError });

  const { data, error } = await supabase
    .from('menu_items')
    .update({ price: numericPrice })
    .eq('id', menu_item_id)
    .eq('restaurant_id', restaurant_id) // scoped by restaurant_id too, not just id — a menu_item_id alone isn't enough to trust across accounts
    .select('id, price')
    .single();

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to update price.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Menu item not found for this restaurant.' });
  }

  return res.status(200).json({ success: true, id: data.id, price: data.price });
}