// pages/api/stripe/billing-history.js
// Returns the signed-in user's real past invoices from Stripe for
// pages/client/billing.js. Stripe already generates a hosted PDF for every
// invoice automatically — no custom receipt generator needed, just link to
// what Stripe already made.

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
      .select('stripe_customer_id')
      .eq('id', profile.restaurant_id)
      .single();

    if (!restaurant?.stripe_customer_id) {
      return res.status(200).json({ history: [] }); // no customer yet — not an error, just nothing to show
    }

    const invoices = await stripe.invoices.list({
      customer: restaurant.stripe_customer_id,
      limit: 24,
      status: 'paid',
    });

    const history = invoices.data.map((inv) => ({
      id: inv.id,
      date: new Date(inv.created * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      desc: inv.lines.data[0]?.description || 'Founding member plan',
      amount: `$${(inv.amount_paid / 100).toFixed(2)}`,
      hostedInvoiceUrl: inv.hosted_invoice_url,
      invoicePdf: inv.invoice_pdf,
    }));

    return res.status(200).json({ history });
  } catch (err) {
    console.error('[stripe/billing-history] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
