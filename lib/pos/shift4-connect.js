// lib/pos/shift4-connect.js
//
// Shared helpers for the Shift4 OAuth connect routes (pages/api/pos/shift4/*).
// Same auth pattern as pages/api/pos/oauth-start.js: the browser sends the
// Supabase session token as a Bearer header, and we resolve the restaurant
// from the user's profiles row, so a user can only touch their own connection.

import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function getRestaurantIdForRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('restaurant_id')
    .eq('id', user.id)
    .single();

  return profile?.restaurant_id || null;
}

export async function getShift4Connection(restaurantId) {
  const { data } = await supabaseAdmin
    .from('pos_connections')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('provider', 'shift4')
    .maybeSingle();
  return data;
}