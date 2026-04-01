// pages/api/stripe/create-checkout-session.js
import Stripe from 'stripe';
import supabase from '../../../lib/supabaseClient';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { restaurantId, userId, email } = req.body;
  if (!restaurantId || !userId || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if customer already exists in Stripe
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('stripe_customer_id')
      .eq('id', restaurantId)
      .single();

    let customerId = restaurant?.stripe_customer_id;

    // Create Stripe customer if one doesn't exist yet
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { restaurant_id: restaurantId, user_id: userId },
      });
      customerId = customer.id;

      await supabase
        .from('restaurants')
        .update({ stripe_customer_id: customerId })
        .eq('id', restaurantId);
    }

    // Create Checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/client/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/client/onboarding?canceled=true`,
      metadata: { restaurant_id: restaurantId, user_id: userId },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}