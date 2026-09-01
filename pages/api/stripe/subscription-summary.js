// pages/api/stripe/subscription-summary.js
// Returns the signed-in user's real subscription details (amount, card
// last4, next bill date) for pages/client/checkout-success.js, which
// previously only ever showed CheckoutSuccessScreen's hardcoded demo props.

import { createClient } from '@supabase/supabase-js';
import stripe from '../../../lib/stripeServer';

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

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('name, stripe_customer_id, stripe_subscription_id')
      .eq('id', profile.restaurant_id)
      .single();

    if (!restaurant?.stripe_subscription_id) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const subscription = await stripe.subscriptions.retrieve(restaurant.stripe_subscription_id, {
      expand: ['default_payment_method', 'items.data.price.product'],
    });

    const price = subscription.items.data[0]?.price;
    const planName = price?.nickname || price?.product?.name || 'Founding member';
    const amount = price?.unit_amount != null ? `$${(price.unit_amount / 100).toFixed(2)}` : null;
    const card = subscription.default_payment_method?.card || null;
    const last4 = card?.last4 || null;
    const expMonth = card?.exp_month || null;
    const expYear = card?.exp_year || null;
    const nextBillDate = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;

    return res.status(200).json({
      restaurantName: restaurant.name || '',
      planName,
      amount,
      last4,
      expMonth,
      expYear,
      nextBillDate,
    });
  } catch (err) {
    console.error('[stripe/subscription-summary] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
