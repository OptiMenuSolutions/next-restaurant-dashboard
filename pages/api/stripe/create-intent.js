// pages/api/stripe/create-intent.js
// Single entry point for both checkout.js scenarios:
//   - No stripe_subscription_id yet on the restaurant -> first-time signup:
//     create a Stripe Customer + Subscription (default_incomplete), return
//     the invoice's PaymentIntent client_secret.
//   - Already has one -> card-update: create a SetupIntent on the existing
//     customer, return its client_secret.
// The client (pages/client/checkout.js) doesn't decide which — this route
// does, based on the real restaurant row, so it can't be tricked by a
// client sending the "wrong" mode.
//
// Auth: same Bearer-token-verified-against-own-profile pattern as
// /api/ai-recommendations.js — never trust a client-supplied restaurantId
// without checking it against the caller's own profile.

import { createClient } from '@supabase/supabase-js';
import stripe, { FOUNDING_MEMBER_PRICE_ID } from '../../../lib/stripeServer';

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

    const { data: restaurant, error: restError } = await supabase
      .from('restaurants')
      .select('id, name, stripe_customer_id, stripe_subscription_id')
      .eq('id', profile.restaurant_id)
      .single();

    if (restError || !restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    // Ensure a Stripe customer exists either way.
    let customerId = restaurant.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: restaurant.name || undefined,
        metadata: { restaurant_id: restaurant.id },
      });
      customerId = customer.id;
      await supabase.from('restaurants').update({ stripe_customer_id: customerId }).eq('id', restaurant.id);
    }

    if (restaurant.stripe_subscription_id) {
      // ── Card-update path ──────────────────────────────────────────────
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
      });
      return res.status(200).json({
        clientSecret: setupIntent.client_secret,
        mode: 'update',
      });
    }

    // ── First-time subscription path ──────────────────────────────────
    if (!FOUNDING_MEMBER_PRICE_ID || FOUNDING_MEMBER_PRICE_ID === 'price_REPLACE_ME') {
      return res.status(500).json({ error: 'FOUNDING_MEMBER_PRICE_ID is not configured (lib/stripeServer.js)' });
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: FOUNDING_MEMBER_PRICE_ID }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { restaurant_id: restaurant.id },
    });

    return res.status(200).json({
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      mode: 'subscribe',
      subscriptionId: subscription.id,
    });
  } catch (err) {
    console.error('[stripe/create-intent] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
