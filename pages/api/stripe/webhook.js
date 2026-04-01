// pages/api/stripe/webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Use service role client for webhook — bypasses RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Disable Next.js body parsing — Stripe needs the raw body to verify signature
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const { type, data } = event;

  try {
    switch (type) {

      // Payment successful — subscription is now active
      case 'checkout.session.completed': {
        const session = data.object;
        const { restaurant_id } = session.metadata;
        if (restaurant_id) {
          await supabaseAdmin
            .from('restaurants')
            .update({
              stripe_subscription_id: session.subscription,
              subscription_status: 'active',
            })
            .eq('id', restaurant_id);
        }
        break;
      }

      // Subscription updated (plan change, renewal, etc.)
      case 'customer.subscription.updated': {
        const sub = data.object;
        const restaurant = await getRestaurantByCustomer(sub.customer);
        if (restaurant) {
          await supabaseAdmin
            .from('restaurants')
            .update({
              stripe_subscription_id: sub.id,
              subscription_status: sub.status, // active, past_due, etc.
            })
            .eq('id', restaurant.id);
        }
        break;
      }

      // Subscription cancelled
      case 'customer.subscription.deleted': {
        const sub = data.object;
        const restaurant = await getRestaurantByCustomer(sub.customer);
        if (restaurant) {
          await supabaseAdmin
            .from('restaurants')
            .update({ subscription_status: 'canceled' })
            .eq('id', restaurant.id);
        }
        break;
      }

      // Payment failed
      case 'invoice.payment_failed': {
        const invoice = data.object;
        const restaurant = await getRestaurantByCustomer(invoice.customer);
        if (restaurant) {
          await supabaseAdmin
            .from('restaurants')
            .update({ subscription_status: 'past_due' })
            .eq('id', restaurant.id);
        }
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}

async function getRestaurantByCustomer(customerId) {
  const { data } = await supabaseAdmin
    .from('restaurants')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();
  return data;
}