// lib/requireActiveSubscription.js
// Server-side subscription check, run before any route that spends money on
// AI calls. The browser-side account check (useGuardedAccount) only decides
// which screen to show and can be skipped with DevTools, so routes that call
// Claude or Mistral confirm the restaurant is paid up here as well.
// subscription_status and deactivated_at can only be changed by the service
// role (see the restaurants_protect_columns trigger), so they can be trusted.

// past_due stays allowed so a failed card does not cut a kitchen off
// mid-service while Stripe retries. Remove it to block immediately.
const ALLOWED = new Set(['active', 'trialing', 'past_due']);

/**
 * @param supabase  a service-role client (the one the route already has)
 * @param restaurantId
 * @returns {{ error: string|null, status: number }}
 */
export async function requireActiveSubscription(supabase, restaurantId) {
  const { data, error } = await supabase
    .from('restaurants')
    .select('subscription_status, deactivated_at')
    .eq('id', restaurantId)
    .single();
  if (error || !data) return { error: 'Restaurant not found.', status: 404 };
  if (data.deactivated_at) return { error: 'This account has been closed.', status: 403 };
  if (!ALLOWED.has(data.subscription_status)) {
    return { error: 'Your subscription is not active. Update your billing to keep using OptiMenu.', status: 402 };
  }
  return { error: null, status: 200 };
}