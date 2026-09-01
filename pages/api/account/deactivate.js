// pages/api/account/deactivate.js
// Marks the account deactivated (does NOT delete anything). Data is retained
// for 60 days — pages/api/cron/purge-deactivated-accounts.js does the actual
// deletion once that window passes. Also cancels the Stripe subscription
// immediately so they're not billed during the retention window.

import { createClient } from '@supabase/supabase-js';
import stripe from '../../../lib/stripeServer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await supabase
      .from('profiles').select('restaurant_id').eq('id', user.id).single();
    if (!profile?.restaurant_id) return res.status(400).json({ error: 'No restaurant on this account' });

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('stripe_subscription_id, deactivated_at')
      .eq('id', profile.restaurant_id)
      .single();

    if (restaurant?.deactivated_at) {
      return res.status(200).json({ ok: true, alreadyDeactivated: true });
    }

    // Cancel billing immediately — retention is for their data, not a paid
    // grace period. If this fails, still proceed with deactivation; don't
    // let a Stripe hiccup block the user from deactivating their account.
    if (restaurant?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(restaurant.stripe_subscription_id);
      } catch (stripeErr) {
        console.error('[account/deactivate] Stripe cancel failed (continuing anyway):', stripeErr.message);
      }
    }

    const { error } = await supabase
      .from('restaurants')
      .update({ deactivated_at: new Date().toISOString(), subscription_status: 'canceled' })
      .eq('id', profile.restaurant_id);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[account/deactivate] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
