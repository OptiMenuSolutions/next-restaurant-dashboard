// lib/stripeClient.js
// Client-side Stripe.js loader. Requires the `@stripe/stripe-js` package
// (npm install @stripe/stripe-js @stripe/react-stripe-js).
//
// >>> PUT YOUR KEY HERE <<<
// NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in your .env.local / Vercel env vars —
// the "pk_test_..." (or "pk_live_...") key from your Stripe dashboard.
// This one is safe to expose client-side; it's designed to be public.

import { loadStripe } from '@stripe/stripe-js';

let stripePromise;

export function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}
