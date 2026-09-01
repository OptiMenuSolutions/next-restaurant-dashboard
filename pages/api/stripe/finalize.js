// pages/api/stripe/finalize.js
// Called after the client confirms the PaymentIntent (subscribe) or
// SetupIntent (update) with Stripe.js. Never trust the client's "it
// succeeded" claim alone — re-fetch the intent from Stripe server-side and
// only write to Supabase if Stripe itself confirms success.

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
      .from('profiles')
      .select('restaurant_id')
      .eq('id', user.id)
      .single();
    if (!profile?.restaurant_id) return res.status(400).json({ error: 'No restaurant on this account yet' });

    const { mode, subscriptionId, setupIntentId } = req.body;

    if (mode === 'subscribe') {
      if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' });
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
      // Only trust Stripe's own status, not whatever the client thinks happened.
      if (subscription.status !== 'active' && subscription.status !== 'trialing') {
        return res.status(400).json({ error: `Subscription not active yet (status: ${subscription.status})` });
      }
      const { error } = await supabase
        .from('restaurants')
        .update({
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
        })
        .eq('id', profile.restaurant_id);
      if (error) throw error;

      return res.status(200).json({ ok: true, status: subscription.status });
    }

    if (mode === 'update') {
      if (!setupIntentId) return res.status(400).json({ error: 'setupIntentId is required' });
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      if (setupIntent.status !== 'succeeded') {
        return res.status(400).json({ error: `Card setup not complete (status: ${setupIntent.status})` });
      }

      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('stripe_customer_id, stripe_subscription_id')
        .eq('id', profile.restaurant_id)
        .single();
      if (!restaurant?.stripe_customer_id) return res.status(400).json({ error: 'No Stripe customer on this account' });

      // Make the new card the default for both the customer and the
      // subscription — the subscription-level default is what Stripe
      // actually charges on renewal; setting only the customer-level one
      // wouldn't override an existing subscription's own default.
      await stripe.customers.update(restaurant.stripe_customer_id, {
        invoice_settings: { default_payment_method: setupIntent.payment_method },
      });
      if (restaurant.stripe_subscription_id) {
        await stripe.subscriptions.update(restaurant.stripe_subscription_id, {
          default_payment_method: setupIntent.payment_method,
        });
      }

      const pm = await stripe.paymentMethods.retrieve(setupIntent.payment_method);
      return res.status(200).json({ ok: true, last4: pm.card?.last4 || null });
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (err) {
    console.error('[stripe/finalize] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
