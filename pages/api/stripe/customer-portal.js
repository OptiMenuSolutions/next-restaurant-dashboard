// pages/api/stripe/customer-portal.js
import Stripe from 'stripe';
import supabase from '../../../lib/supabaseClient';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'Missing restaurantId' });

  try {
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('stripe_customer_id')
      .eq('id', restaurantId)
      .single();

    if (!restaurant?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found for this restaurant' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: restaurant.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/client/profile`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Customer portal error:', err);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
}