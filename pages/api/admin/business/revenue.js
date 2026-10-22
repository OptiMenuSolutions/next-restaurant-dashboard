// pages/api/admin/business/revenue.js
// Revenue & billing: monthly recurring revenue, what came in each month,
// founding seats, cancellations, and every restaurant's plan, state, card
// and estimated profit this month.
//
// Profit per restaurant this month = what they pay - their AI spend - their
// share of hosting - Stripe's fee (2.9% + 30¢) - one-off costs logged for
// them this month (tag kits, postage). Same rules as the client billing page.

import stripe from '../../../../lib/stripeServer';
import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID, etDate, addDays } from '../../../../lib/admin/requireAdmin';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { getSettings } from '../../../../lib/admin/settings';

const dollars = (c) => (c || 0) / 100;
const fromUnix = (s) => (s ? new Date(s * 1000).toISOString() : null);
const etMonth = (iso) => etDate(new Date(iso)).slice(0, 7);
const LIVE_SUB = ['active', 'trialing', 'past_due', 'unpaid'];

function cardText(pm) {
  const c = pm && typeof pm === 'object' ? pm.card : null;
  if (!c) return null;
  const brand = c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : 'Card';
  return `${brand} ···· ${c.last4}`;
}

async function listAll(fn, params, pages = 10) {
  const out = [];
  let starting_after;
  for (let i = 0; i < pages; i++) {
    const page = await fn({ ...params, limit: 100, starting_after });
    out.push(...page.data);
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const today = etDate();
    const month = today.slice(0, 7);
    const months = Array.from({ length: 12 }, (_, i) => {
      const [y, m] = month.split('-').map(Number);
      return new Date(Date.UTC(y, m - 12 + i, 1)).toISOString().slice(0, 7);
    });
    const since = Math.floor(Date.parse(`${months[0]}-01T00:00:00Z`) / 1000) - 86400;

    const [settings, { data: rest }, { data: recs }, usage, { data: oneoffs }, { data: cancels }, { data: profiles }] = await Promise.all([
      getSettings(db),
      db.from('restaurants').select('id, name, stripe_customer_id, stripe_subscription_id, subscription_status, deactivated_at, created_at'),
      db.from('ai_recommendations').select('restaurant_id').gte('generated_date', addDays(today, -7)),
      fetchAll(() => db.from('ai_usage').select('id, restaurant_id, cost, created_at').gte('created_at', addDays(`${month}-01`, -1)).order('id')),
      db.from('admin_client_costs').select('restaurant_id, amount, spent_on').gte('spent_on', `${month}-01`),
      db.from('admin_cancellations').select('reason, created_at').gte('created_at', addDays(today, -90)),
      db.from('profiles').select('restaurant_id, full_name, email, role'),
    ]);

    let subs = [], invoices = [], stripeError = null;
    try {
      [subs, invoices] = await Promise.all([
        listAll((p) => stripe.subscriptions.list(p), { status: 'all', expand: ['data.default_payment_method', 'data.discounts'] }),
        listAll((p) => stripe.invoices.list(p), { created: { gte: since } }),
      ]);
    } catch (err) {
      stripeError = err.message;
    }

    const subById = new Map(subs.map((s) => [s.id, s]));
    const subByCustomer = new Map();
    for (const s of [...subs].sort((a, b) => a.created - b.created)) subByCustomer.set(typeof s.customer === 'string' ? s.customer : s.customer?.id, s);
    // Monthly amount of a subscription: every item × quantity, turned into a
    // month whatever the billing interval, minus lasting coupon discounts.
    const itemMonthly = (price, qty) => {
      const r = price?.recurring;
      if (!r || price.unit_amount == null) return 0;
      const perMonthOf = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[r.interval] || 1;
      return (price.unit_amount * (qty || 1) * perMonthOf) / (r.interval_count || 1) / 100;
    };
    const perMonth = (s) => {
      if (!s) return 0;
      let amt = (s.items?.data || []).reduce((a, it) => a + itemMonthly(it.price, it.quantity), 0);
      const ds = [...(s.discounts || []).filter((d) => d && typeof d === 'object'), ...(s.discount ? [s.discount] : [])];
      const seen = new Set();
      for (const d of ds) {
        const c = d.coupon;
        if (!c || seen.has(d.id) || c.duration === 'once') continue;
        seen.add(d.id);
        if (c.percent_off) amt *= 1 - c.percent_off / 100;
        else if (c.amount_off) amt -= c.amount_off / 100;
      }
      return Math.max(0, amt);
    };

    const withRecs = new Set((recs || []).map((r) => r.restaurant_id));
    const restaurants = (rest || []).filter((r) => r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at);
    const isLive = (r) => ['active', 'trialing'].includes(r.subscription_status) || withRecs.has(r.id);
    const liveN = restaurants.filter(isLive).length || 1;
    const hostShare = Number(settings.hosting_monthly || 0) / liveN;

    const aiBy = new Map();
    for (const u of usage) if (etMonth(u.created_at) === month && u.restaurant_id) aiBy.set(u.restaurant_id, (aiBy.get(u.restaurant_id) || 0) + Number(u.cost || 0));
    const costBy = new Map();
    for (const c of oneoffs || []) costBy.set(c.restaurant_id, (costBy.get(c.restaurant_id) || 0) + Number(c.amount || 0));

    const rows = restaurants.map((r) => {
      const s = (r.stripe_subscription_id && subById.get(r.stripe_subscription_id)) || (r.stripe_customer_id && subByCustomer.get(r.stripe_customer_id)) || null;
      const price = s?.items?.data?.[0]?.price;
      const mo = perMonth(s);
      let state = 'NO PLAN';
      if (s) {
        if (s.status === 'active') state = s.cancel_at_period_end ? 'CANCELING' : 'ACTIVE';
        else if (s.status === 'trialing') state = 'TRIAL';
        else if (s.status === 'past_due' || s.status === 'unpaid') state = 'PAYMENT FAILED';
        else if (s.status === 'canceled') state = 'CANCELED';
        else if (s.status.startsWith('incomplete')) state = 'NO CARD YET';
      }
      const paying = s && ['active', 'past_due', 'unpaid'].includes(s.status);
      const pays = paying ? mo : 0;
      const ai = aiBy.get(r.id) || 0;
      const host = isLive(r) ? hostShare : 0;
      const fee = pays > 0 ? pays * 0.029 + 0.3 : 0;
      const other = costBy.get(r.id) || 0;
      const profit = pays - ai - host - fee - other;
      return {
        id: r.id, name: r.name, state,
        plan: s ? `${price?.nickname || 'Plan'} · $${mo.toFixed(2)}/mo` : 'No plan',
        next: s && LIVE_SUB.includes(s.status) && !s.cancel_at_period_end ? fromUnix(s.status === 'trialing' ? s.trial_end : s.current_period_end) : null,
        ends: s?.cancel_at_period_end ? fromUnix(s.current_period_end) : null,
        card: s ? cardText(s.default_payment_method) : null,
        mrr: s && ['active', 'past_due', 'unpaid'].includes(s.status) ? mo : 0,
        trial: s?.status === 'trialing',
        pays, ai, host, fee, other, profit,
      };
    }).sort((a, b) => b.pays - a.pays || a.name.localeCompare(b.name));

    // MRR the way Stripe counts it: every active or past-due subscription,
    // monthly, after discounts, whether or not it is linked to a restaurant.
    const counted = subs.filter((s) => ['active', 'past_due'].includes(s.status));
    const stripeMrr = counted.reduce((a, s) => a + perMonth(s), 0);
    const linkedSubs = new Set();
    for (const r of restaurants) {
      const s = (r.stripe_subscription_id && subById.get(r.stripe_subscription_id)) || (r.stripe_customer_id && subByCustomer.get(r.stripe_customer_id));
      if (s) linkedSubs.add(s.id);
    }
    const unlinked = counted.filter((s) => !linkedSubs.has(s.id));

    // Owners by restaurant and restaurants by owner email, to name failed payments.
    const ownerOf = new Map();
    const restByEmail = new Map();
    for (const p of profiles || []) {
      if (p.role === 'admin' || !p.restaurant_id) continue;
      if (!ownerOf.has(p.restaurant_id)) ownerOf.set(p.restaurant_id, p);
      const r = (rest || []).find((x) => x.id === p.restaurant_id);
      if (p.email && r) restByEmail.set(p.email.toLowerCase(), r);
    }

    // Collected per month (paid invoices), and payments that failed.
    const collected = new Map(months.map((m) => [m, 0]));
    const failed = [];
    for (const inv of invoices) {
      if (inv.status === 'paid' && inv.amount_paid > 0) {
        const k = etMonth(fromUnix(inv.status_transitions?.paid_at || inv.created));
        if (collected.has(k)) collected.set(k, collected.get(k) + dollars(inv.amount_paid));
      }
      if (inv.status === 'open' && inv.attempt_count > 0) {
        const cust = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        const email = String(inv.customer_email || '').toLowerCase();
        const r = (rest || []).find((x) => x.stripe_customer_id === cust) || restByEmail.get(email) || null;
        const owner = r ? ownerOf.get(r.id) : null;
        failed.push({
          id: inv.id, restaurant_id: r?.id || null, name: r?.name || null,
          owner: owner?.full_name || inv.customer_name || null, email: inv.customer_email || owner?.email || null,
          amount: dollars(inv.amount_remaining), attempts: inv.attempt_count, retry: fromUnix(inv.next_payment_attempt),
        });
      }
    }

    const reasons = {};
    for (const c of cancels || []) reasons[c.reason] = (reasons[c.reason] || 0) + 1;
    const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
    const prevMonth = months[10];

    return res.status(200).json({
      month, stripeError,
      mrr: stripeMrr,
      mrrLinked: rows.reduce((a, r) => a + r.mrr, 0),
      paying: counted.length,
      payingLinked: rows.filter((r) => r.mrr > 0).length,
      unlinked: { n: unlinked.length, amount: unlinked.reduce((a, s) => a + perMonth(s), 0) },
      trials: subs.filter((s) => s.status === 'trialing').length,
      collectedThis: collected.get(month) || 0,
      collectedPrev: collected.get(prevMonth) || 0,
      profit: rows.reduce((a, r) => a + r.profit, 0),
      cancels: (cancels || []).length,
      topReason: topReason ? `${topReason[0]} (${topReason[1]})` : null,
      seatsUsed: subs.filter((s) => LIVE_SUB.includes(s.status)).length,
      seats: settings.founding_seats ?? null,
      foundingPrice: settings.founding_price ?? null,
      regularPrice: settings.regular_price ?? null,
      tagsPerPlan: settings.tags_per_plan ?? 3,
      hosting: Number(settings.hosting_monthly || 0), liveN,
      chart: months.map((m) => ({ month: m, amount: collected.get(m) || 0 })),
      failed,
      rows,
    });
  } catch (err) {
    console.error('[admin/business/revenue]', err);
    return res.status(500).json({ error: err.message || 'Could not load revenue' });
  }
}