// pages/api/stripe/webhook.js
// Keeps restaurants.subscription_status in sync with Stripe over time —
// finalize.js only handles the moment of checkout; this handles everything
// that happens afterward (renewal succeeds, a card fails, the subscription
// gets cancelled, etc.), none of which the app would otherwise hear about.
//
// SETUP REQUIRED (do this yourself, alongside the API keys):
//   1. Stripe dashboard -> Developers -> Webhooks -> Add endpoint
//      URL: https://<your-domain>/api/stripe/webhook
//      Events to send: customer.subscription.updated,
//                       customer.subscription.deleted,
//                       invoice.payment_failed
//   2. Copy the signing secret ("whsec_...") into STRIPE_WEBHOOK_SECRET
//      in your env vars (server-side only, same as STRIPE_SECRET_KEY).

import { createClient } from '@supabase/supabase-js';
import stripe from '../../../lib/stripeServer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body to verify the signature
};

// Small inline raw-body reader instead of pulling in the `micro` package
// just for this one helper.
function readRawBody(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const { error } = await supabase
          .from('restaurants')
          .update({ subscription_status: subscription.status })
          .eq('stripe_subscription_id', subscription.id);
        if (error) console.error('[stripe/webhook] Failed to update subscription_status:', error.message);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const { error } = await supabase
            .from('restaurants')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_subscription_id', invoice.subscription);
          if (error) console.error('[stripe/webhook] Failed to mark past_due:', error.message);
        }
        break;
      }
      default:
        // Not one of the events we asked for — ignore.
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
