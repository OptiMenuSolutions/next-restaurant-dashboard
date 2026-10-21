// pages/api/admin/billing/[id]/index.js
// Everything money-related for one client: plan, card, payments from
// Stripe, and what they cost you month by month (AI, a share of hosting,
// Stripe's real fees, one-off costs like tag kits and postage, refunds).
//
// One-off costs count in the month they were spent.

import stripe from '../../../../../lib/stripeServer';
import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID, etDate, addDays } from '../../../../../lib/admin/requireAdmin';
import { fetchAll } from '../../../../../lib/admin/fetchAll';
import { getSettings } from '../../../../../lib/admin/settings';

const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
const monthLabel = (key) => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(key + '-15T12:00:00Z'));
const fromUnix = (s) => (s ? new Date(s * 1000).toISOString() : null);
const dollars = (cents) => (cents || 0) / 100;
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));

function cardText(pm) {
  const c = pm && typeof pm === 'object' ? pm.card : null;
  if (!c) return null;
  const brand = c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : 'Card';
  return `${brand} ···· ${c.last4} · exp ${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}`;
}

async function liveCount() {
  const since = addDays(etDate(), -7);
  const [{ data: rest }, { data: recs }] = await Promise.all([
    db.from('restaurants').select('id, subscription_status, deactivated_at'),
    db.from('ai_recommendations').select('restaurant_id').gte('generated_date', since),
  ]);
  const withRecs = new Set((recs || []).map((r) => r.restaurant_id));
  return (rest || []).filter((r) => r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at &&
    (['active', 'trialing'].includes(r.subscription_status) || withRecs.has(r.id))).length;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.query;

  try {
    const { data: r } = await db.from('restaurants').select('*').eq('id', id).single();
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });

    const [settings, live, owners, tagCount, usage, costs] = await Promise.all([
      getSettings(db),
      liveCount(),
      db.from('profiles').select('full_name, email, role').eq('restaurant_id', id),
      db.from('nfc_tags').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
      fetchAll(() => db.from('ai_usage').select('id, cost, feature, created_at').eq('restaurant_id', id).order('id')),
      db.from('admin_client_costs').select('id, spent_on, what, source, amount').eq('restaurant_id', id).order('spent_on', { ascending: false }),
    ]);
    const owner = (owners.data || []).find((p) => p.role !== 'admin') || null;

    // ── Stripe ─────────────────────────────────────────────────────────────
    let customer = null, sub = null, invoices = [], charges = [], credits = [], stripeError = null;
    let subMissing = false;
    if (r.stripe_customer_id) {
      try {
        [customer, sub, invoices, charges, credits] = await Promise.all([
          stripe.customers.retrieve(r.stripe_customer_id, { expand: ['invoice_settings.default_payment_method'] }),
          r.stripe_subscription_id
            ? stripe.subscriptions.retrieve(r.stripe_subscription_id, { expand: ['default_payment_method'] })
              .catch((e) => { if (e.code === 'resource_missing') { subMissing = true; return null; } throw e; })
            : null,
          stripe.invoices.list({ customer: r.stripe_customer_id, limit: 100, expand: ['data.charge'] }).then((x) => x.data),
          stripe.charges.list({ customer: r.stripe_customer_id, limit: 100, expand: ['data.balance_transaction', 'data.refunds'] }).then((x) => x.data),
          stripe.customers.listBalanceTransactions(r.stripe_customer_id, { limit: 100 }).then((x) => x.data),
        ]);
      } catch (e) {
        stripeError = e.message;
        console.error('[admin/billing] Stripe:', e.message);
      }
    }

    const price = sub?.items?.data?.[0]?.price || null;
    const perMonth = price ? dollars(price.unit_amount) : 0;

    // ── Failed payment ─────────────────────────────────────────────────────
    const failedInv = invoices.find((i) => i.status === 'open' && i.attempt_count > 0) || null;
    const failed = failedInv ? {
      date: fromUnix(failedInv.status_transitions?.finalized_at || failedInv.created),
      why: (failedInv.charge && typeof failedInv.charge === 'object' && failedInv.charge.failure_message) || 'The card was declined.',
      nextRetry: fromUnix(failedInv.next_payment_attempt),
      amount: dollars(failedInv.amount_remaining),
    } : null;
    const owed = invoices.filter((i) => i.status === 'open').reduce((a, i) => a + dollars(i.amount_remaining), 0);

    // ── Months, from when they joined (up to 12) ────────────────────────────
    const start = monthKey(r.created_at);
    const months = [];
    for (let k = monthKey(new Date()); k >= start && months.length < 12;) {
      months.unshift(k);
      const [y, m] = k.split('-').map(Number);
      k = new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 7);
    }
    const blank = () => ({ paid: 0, ai: 0, host: 0, fee: 0, oneoff: 0, refunds: 0 });
    const by = Object.fromEntries(months.map((k) => [k, blank()]));
    const hostShare = Number(settings.hosting_monthly || 0) / Math.max(live, 1);

    for (const c of charges) {
      if (c.status !== 'succeeded') continue;
      const k = monthKey(c.created * 1000);
      if (by[k]) {
        by[k].paid += dollars(c.amount);
        by[k].fee += dollars(c.balance_transaction?.fee);
      }
      for (const rf of c.refunds?.data || []) {
        const rk = monthKey(rf.created * 1000);
        if (by[rk] && rf.status !== 'failed') by[rk].refunds += dollars(rf.amount);
      }
    }
    for (const u of usage) {
      const k = monthKey(u.created_at);
      if (by[k]) by[k].ai += parseFloat(u.cost || 0);
    }
    for (const c of costs.data || []) {
      const k = String(c.spent_on).slice(0, 7);
      if (by[k]) by[k].oneoff += parseFloat(c.amount || 0);
    }
    // Hosting is split evenly across the restaurants live today.
    for (const k of months) by[k].host = hostShare;

    const rows = months.map((k) => {
      const m = by[k];
      const cost = m.ai + m.host + m.fee + m.oneoff + m.refunds;
      return { key: k, label: monthLabel(k), ...m, cost, profit: m.paid - cost };
    });
    const total = rows.reduce((a, m) => {
      for (const f of ['paid', 'ai', 'host', 'fee', 'oneoff', 'refunds', 'cost', 'profit']) a[f] += m[f];
      return a;
    }, { paid: 0, ai: 0, host: 0, fee: 0, oneoff: 0, refunds: 0, cost: 0, profit: 0 });

    // ── Payments list ──────────────────────────────────────────────────────
    const payments = [];
    for (const i of invoices) {
      if (i.status === 'draft') continue;
      const st = i.status === 'paid' ? (i.amount_paid ? 'PAID' : 'NOTHING DUE')
        : i.status === 'open' ? (i.attempt_count > 0 ? 'FAILED' : 'DUE')
        : i.status === 'void' ? 'VOIDED' : i.status === 'uncollectible' ? 'WRITTEN OFF' : i.status.toUpperCase();
      payments.push({
        ts: fromUnix(i.created),
        what: i.lines?.data?.[0]?.description || i.description || 'Subscription',
        status: st,
        amount: dollars(i.status === 'paid' ? i.amount_paid : i.amount_due),
        receipt: i.hosted_invoice_url || null,
      });
    }
    for (const c of charges) for (const rf of c.refunds?.data || []) {
      payments.push({ ts: fromUnix(rf.created), what: `Refund${rf.reason ? ' · ' + rf.reason.replace(/_/g, ' ') : ''}`, status: 'REFUNDED', amount: -dollars(rf.amount), receipt: null });
    }
    for (const b of credits) {
      if (b.amount < 0) payments.push({ ts: fromUnix(b.created), what: b.description || 'Credit added', status: 'CREDIT', amount: dollars(b.amount), receipt: null });
    }
    payments.sort((a, b) => new Date(b.ts) - new Date(a.ts));

    // Charges that can still be refunded.
    const refundable = charges
      .filter((c) => c.status === 'succeeded' && c.amount_refunded < c.amount)
      .map((c) => ({ id: c.id, date: fromUnix(c.created), amount: dollars(c.amount - c.amount_refunded) }));

    const pm = sub?.default_payment_method || customer?.invoice_settings?.default_payment_method || null;
    const anchorDay = sub?.billing_cycle_anchor ? new Date(sub.billing_cycle_anchor * 1000).getUTCDate() : null;

    return res.status(200).json({
      restaurant: { id: r.id, name: r.name, created_at: r.created_at, subscription_status: r.subscription_status || null, closed: !!r.deactivated_at },
      owner: owner ? { name: owner.full_name || owner.email, email: owner.email } : null,
      stripe: {
        customerId: r.stripe_customer_id || null,
        subscriptionId: subMissing ? null : (r.stripe_subscription_id || null),
        subMissing,
        error: stripeError,
        status: sub?.status || null,
        cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
      },
      perMonth,
      failed,
      owed,
      facts: [
        ['Plan', price ? `${price.nickname || 'Plan'} · $${perMonth.toFixed(2)}/mo` : (r.subscription_status ? r.subscription_status.replace(/_/g, ' ') : 'No plan')],
        ['Status', sub ? sub.status.replace(/_/g, ' ') + (sub.cancel_at_period_end ? ' · cancels at period end' : '') : 'No subscription'],
        ['Billing day', anchorDay ? `The ${ordinal(anchorDay)} of each month` : '—'],
        ['Next charge', failed?.nextRetry ? `Retry ${new Date(failed.nextRetry).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : sub?.current_period_end && !sub.cancel_at_period_end ? new Date(sub.current_period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Card', cardText(pm) || 'None on file'],
        ['Billing email', customer?.email || owner?.email || '—'],
        ['Stripe customer', r.stripe_customer_id || 'Not created yet'],
        ['Tags', `${tagCount.count || 0}`],
      ],
      months: rows,
      total,
      hostShare,
      liveCount: live,
      payments,
      refundable,
      oneoffs: (costs.data || []).map((c) => ({ id: c.id, date: c.spent_on, what: c.what, source: c.source, amount: parseFloat(c.amount) })),
      kitCost: Number(settings.kit_cost || 0),
    });
  } catch (err) {
    console.error('[admin/billing]', err);
    return res.status(500).json({ error: err.message || 'Could not load billing' });
  }
}