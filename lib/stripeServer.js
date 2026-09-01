// lib/stripeServer.js
// Server-side Stripe SDK instance. Requires the `stripe` package
// (npm install stripe). Never import this from client-side code — it needs
// the secret key.
//
// >>> PUT YOUR KEY HERE <<<
// STRIPE_SECRET_KEY in your server env vars (Vercel project settings, or
// .env.local for local dev — NOT prefixed with NEXT_PUBLIC_, this one must
// never reach the browser) — the "sk_test_..." (or "sk_live_...") key.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

export default stripe;

// The Founding Member plan's Stripe Price ID — create this once in the
// Stripe dashboard (Product catalog → add a $59/mo recurring price) and
// paste its id here. Looks like "price_1AbCdEfGhIjKlMnO".
//
// >>> PUT YOUR PRICE ID HERE <<<
export const FOUNDING_MEMBER_PRICE_ID = 'prod_UFjnUmgb4SoFun';
