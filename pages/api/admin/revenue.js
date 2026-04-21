// pages/api/admin/revenue.js
// Pulls real MRR, subscription, and payment history from Stripe.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── Pull all active + past_due + trialing subscriptions ──────────────────
    const [activeSubs, allInvoices, charges] = await Promise.all([
      stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] }),
      stripe.invoices.list({ limit: 100, expand: ['data.customer'] }),
      stripe.charges.list({ limit: 100 }),
    ]);

    // ── Current MRR by status ─────────────────────────────────────────────────
    const subsByStatus = { active: [], trialing: [], past_due: [], canceled: [], other: [] };
    let mrr = 0;

    for (const sub of activeSubs.data) {
      const amount = (sub.items.data[0]?.price?.unit_amount || 0) / 100;
      const bucket = subsByStatus[sub.status] ? sub.status : 'other';
      subsByStatus[bucket].push({
        id: sub.id,
        customer_email: sub.customer?.email || sub.customer_email || 'Unknown',
        customer_name: sub.customer?.name || null,
        status: sub.status,
        amount,
        current_period_end: sub.current_period_end,
        created: sub.created,
        cancel_at_period_end: sub.cancel_at_period_end,
      });
      if (sub.status === 'active' || sub.status === 'trialing') {
        mrr += amount;
      }
    }

    // ── Real monthly MRR from Stripe invoice history (last 6 months) ─────────
    const now = new Date();
    const monthlyRevenue = {};

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyRevenue[key] = { label: d.toLocaleDateString('en-US', { month: 'short' }), value: 0, count: 0 };
    }

    for (const inv of allInvoices.data) {
      if (inv.status !== 'paid') continue;
      const d = new Date(inv.created * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyRevenue[key]) {
        monthlyRevenue[key].value += inv.amount_paid / 100;
        monthlyRevenue[key].count++;
      }
    }

    const mrrHistory = Object.values(monthlyRevenue);

    // ── Failed / open invoices ────────────────────────────────────────────────
    const failedInvoices = allInvoices.data
      .filter(inv => inv.status === 'open' && inv.attempt_count > 0)
      .map(inv => ({
        id: inv.id,
        customer_email: inv.customer?.email || 'Unknown',
        amount: inv.amount_due / 100,
        attempt_count: inv.attempt_count,
        next_payment_attempt: inv.next_payment_attempt,
        created: inv.created,
      }));

    // ── Recent successful charges ─────────────────────────────────────────────
    const recentCharges = charges.data
      .filter(c => c.status === 'succeeded')
      .slice(0, 15)
      .map(c => ({
        id: c.id,
        amount: c.amount / 100,
        customer_email: c.billing_details?.email || c.receipt_email || 'Unknown',
        description: c.description || 'Subscription',
        created: c.created,
      }));

    // ── Summary stats ─────────────────────────────────────────────────────────
    const activeCount  = subsByStatus.active.length;
    const trialingCount = subsByStatus.trialing.length;
    const pastDueCount  = subsByStatus.past_due.length;
    const canceledCount = subsByStatus.canceled.length;

    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthKey = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;
    const thisMonthRevenue = monthlyRevenue[thisMonthKey]?.value || 0;
    const lastMonthRevenue = monthlyRevenue[lastMonthKey]?.value || 0;
    const momChange = lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : null;

    return res.status(200).json({
      mrr: Math.round(mrr * 100) / 100,
      arr: Math.round(mrr * 12 * 100) / 100,
      activeCount,
      trialingCount,
      pastDueCount,
      canceledCount,
      thisMonthRevenue: Math.round(thisMonthRevenue * 100) / 100,
      lastMonthRevenue: Math.round(lastMonthRevenue * 100) / 100,
      momChange,
      mrrHistory,
      failedInvoices,
      recentCharges,
      subscriptions: [
        ...subsByStatus.active,
        ...subsByStatus.trialing,
        ...subsByStatus.past_due,
      ].sort((a, b) => b.created - a.created),
    });

  } catch (err) {
    console.error('[revenue API] Error:', err);
    return res.status(500).json({ error: 'Failed to load revenue data' });
  }
});