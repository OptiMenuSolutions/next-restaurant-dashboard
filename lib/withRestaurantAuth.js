// lib/withRestaurantAuth.js
// Verifies the calling user is authenticated and owns the requested restaurant.
// Usage: const { user, profile, error } = await verifyRestaurantAccess(req, restaurantId);

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function verifyRestaurantAccess(req, restaurantId) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401 };
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { error: 'Unauthorized', status: 401 };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('restaurant_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.restaurant_id !== restaurantId) {
    return { error: 'Forbidden', status: 403 };
  }

  return { user, profile };
}
