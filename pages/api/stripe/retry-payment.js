// pages/api/stripe/retry-payment.js
// Called from the payment-failed page's "Retry payment now" button. Finds
// the restaurant's latest open (unpaid) invoice and attempts to charge it
// again against whatever payment method is currently on file — same
// mechanism Stripe's own automatic retries use, just triggered on demand.
//
// Note: this does NOT wait on the webhook to reflect success — it updates
// subscription_status directly for a snappy UX, since making someone sit
// on a spinner for a webhook round-trip after they just fixed their card
// would be a bad experience. The webhook remains the source of truth for
// every other status change (this is just an optimistic update).

import { createClient } from '@supabase/supabase-js';
import stripe from '../../../lib/stripeServer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: 'Not authenticated.' });

  const { data: profile } = await supabase
    .from('profiles').select('restaurant_id').eq('id', user.id).single();
  if (!profile?.restaurant_id) return res.status(400).json({ error: 'No restaurant on this account.' });

  const { data: restaurant } = await supabase
    .from('restaurants').select('stripe_subscription_id').eq('id', profile.restaurant_id).single();
  if (!restaurant?.stripe_subscription_id) return res.status(400).json({ error: 'No subscription on this account.' });

  try {
    const invoices = await stripe.invoices.list({
      subscription: restaurant.stripe_subscription_id,
      status: 'open',
      limit: 1,
    });
    const openInvoice = invoices.data[0];
    if (!openInvoice) {
      return res.status(400).json({ error: 'No outstanding invoice found — try refreshing the page.' });
    }

    const paid = await stripe.invoices.pay(openInvoice.id);
    if (paid.status !== 'paid') {
      return res.status(402).json({ error: 'That payment still failed. Please update your card instead.' });
    }

    await supabase.from('restaurants')
      .update({ subscription_status: 'active' })
      .eq('id', profile.restaurant_id);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[stripe/retry-payment] Failed:', err.message);
    return res.status(402).json({ error: 'That payment still failed. Please update your card instead.' });
  }
}