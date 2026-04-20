// pages/api/admin/restaurants.js
// Returns all restaurants with enriched stats for the admin restaurants page.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [
      { data: restaurants },
      { data: invoices },
      { data: menuItems },
      { data: ingredients },
      { data: profiles },
    ] = await Promise.all([
      supabase.from('restaurants').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, restaurant_id, created_at, parse_status, amount'),
      supabase.from('menu_items').select('id, restaurant_id'),
      supabase.from('ingredients').select('id, restaurant_id'),
      supabase.from('profiles').select('id, email, full_name, avatar_url'),
    ]);

    // Pull Stripe subscriptions for status + MRR
    let stripeMap = {};
    try {
      const subs = await stripe.subscriptions.list({ status: 'all', limit: 100 });
      for (const sub of subs.data) {
        const email = sub.customer_email || sub.metadata?.email;
        if (email) {
          stripeMap[email] = {
            status: sub.status,
            mrr: (sub.items.data[0]?.price?.unit_amount || 0) / 100,
            current_period_end: sub.current_period_end,
          };
        }
      }
    } catch (stripeErr) {
      console.error('[restaurants API] Stripe error:', stripeErr.message);
    }

    // Build invoice/menu/ingredient counts per restaurant
    const invoiceCountMap = {};
    const invoiceTotalMap = {};
    const failedInvoiceMap = {};
    for (const inv of invoices || []) {
      invoiceCountMap[inv.restaurant_id] = (invoiceCountMap[inv.restaurant_id] || 0) + 1;
      invoiceTotalMap[inv.restaurant_id] = (invoiceTotalMap[inv.restaurant_id] || 0) + parseFloat(inv.amount || 0);
      if (inv.parse_status === 'failed') {
        failedInvoiceMap[inv.restaurant_id] = (failedInvoiceMap[inv.restaurant_id] || 0) + 1;
      }
    }

    const menuCountMap = {};
    for (const m of menuItems || []) {
      menuCountMap[m.restaurant_id] = (menuCountMap[m.restaurant_id] || 0) + 1;
    }

    const ingredientCountMap = {};
    for (const i of ingredients || []) {
      ingredientCountMap[i.restaurant_id] = (ingredientCountMap[i.restaurant_id] || 0) + 1;
    }

    const profileMap = {};
    for (const p of profiles || []) {
      profileMap[p.id] = p;
    }

    const enriched = (restaurants || []).map(r => {
      const profile = profileMap[r.user_id] || {};
      const stripe = stripeMap[profile.email] || null;
      const invoiceCount = invoiceCountMap[r.id] || 0;
      const menuCount = menuCountMap[r.id] || 0;
      const ingredientCount = ingredientCountMap[r.id] || 0;
      const failedInvoices = failedInvoiceMap[r.id] || 0;

      // Health score (0–100)
      let health = 100;
      if (invoiceCount === 0) health -= 30;
      if (menuCount === 0) health -= 30;
      if (failedInvoices >= 3) health -= 20;
      if (!stripe || stripe.status !== 'active') health -= 20;
      health = Math.max(0, health);

      return {
        id: r.id,
        name: r.name || 'Unnamed Restaurant',
        owner_name: profile.full_name || null,
        owner_email: profile.email || null,
        subscription_status: stripe?.status || r.subscription_status || 'unknown',
        mrr: stripe?.mrr || 0,
        created_at: r.created_at,
        invoice_count: invoiceCount,
        menu_item_count: menuCount,
        ingredient_count: ingredientCount,
        failed_invoices: failedInvoices,
        health,
      };
    });

    return res.status(200).json({ restaurants: enriched });

  } catch (err) {
    console.error('[restaurants API] Error:', err);
    return res.status(500).json({ error: 'Failed to load restaurants' });
  }
});