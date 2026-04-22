// pages/api/admin/stripe-management.js
// Handles Stripe subscription actions: list, cancel, refund.

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
  const { action } = req.query;

  // ── GET: list all subscriptions with customer info ──────────────────────────
  if (req.method === 'GET' && action === 'list') {
    try {
      const [subs, { data: restaurants }, { data: profiles }] = await Promise.all([
        stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer', 'data.latest_invoice'] }),
        supabase.from('restaurants').select('id, name'),
        supabase.from('profiles').select('id, full_name, email: id'),
      ]);

      // Also get recent charges for refund candidates
      const charges = await stripe.charges.list({ limit: 50 });
      const chargeMap = {};
      for (const c of charges.data) {
        if (!chargeMap[c.customer]) chargeMap[c.customer] = [];
        chargeMap[c.customer].push({
          id: c.id,
          amount: c.amount / 100,
          currency: c.currency,
          created: new Date(c.created * 1000).toISOString(),
          refunded: c.refunded,
          description: c.description,
        });
      }

      const enriched = subs.data.map((sub) => {
        const customer = sub.customer;
        const email = typeof customer === 'object' ? customer.email : null;
        const name = typeof customer === 'object' ? customer.name : null;
        const customerId = typeof customer === 'object' ? customer.id : customer;

        return {
          id: sub.id,
          customerId,
          customerEmail: email,
          customerName: name,
          status: sub.status,
          plan: sub.items.data[0]?.price?.nickname || 'Founding Member',
          amount: (sub.items.data[0]?.price?.unit_amount || 0) / 100,
          currency: sub.items.data[0]?.price?.currency || 'usd',
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
          currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          createdAt: new Date(sub.created * 1000).toISOString(),
          recentCharges: chargeMap[customerId] || [],
          latestInvoiceStatus: sub.latest_invoice?.status || null,
          latestInvoiceAmount: sub.latest_invoice?.amount_paid
            ? sub.latest_invoice.amount_paid / 100
            : null,
        };
      });

      // MRR = sum of active subscription amounts
      const mrr = enriched
        .filter((s) => s.status === 'active')
        .reduce((sum, s) => sum + s.amount, 0);

      return res.status(200).json({ subscriptions: enriched, mrr });
    } catch (err) {
      console.error('[stripe-management list] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: cancel subscription ───────────────────────────────────────────────
  if (req.method === 'POST' && action === 'cancel') {
    const { subscriptionId, immediately = false } = req.body;
    if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId required' });

    try {
      let result;
      if (immediately) {
        result = await stripe.subscriptions.cancel(subscriptionId);
      } else {
        result = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      }
      return res.status(200).json({ success: true, subscription: result });
    } catch (err) {
      console.error('[stripe-management cancel] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: refund a charge ───────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'refund') {
    const { chargeId, amount, reason = 'requested_by_customer' } = req.body;
    if (!chargeId) return res.status(400).json({ error: 'chargeId required' });

    try {
      const refundParams = { charge: chargeId, reason };
      if (amount) refundParams.amount = Math.round(amount * 100); // partial refund in cents

      const refund = await stripe.refunds.create(refundParams);
      return res.status(200).json({ success: true, refund });
    } catch (err) {
      console.error('[stripe-management refund] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: reactivate a cancelled subscription ───────────────────────────────
  if (req.method === 'POST' && action === 'reactivate') {
    const { subscriptionId } = req.body;
    if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId required' });

    try {
      const result = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });
      return res.status(200).json({ success: true, subscription: result });
    } catch (err) {
      console.error('[stripe-management reactivate] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method or action not allowed' });
});