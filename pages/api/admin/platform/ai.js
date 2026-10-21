// pages/api/admin/platform/ai.js
// AI & parsing: what the readers and Tonight's Dish cost (from ai_usage),
// who it is spent on next to what they pay, and how often invoice lines
// need fixing (each saved line keeps what the reader first read, in
// original_quantity and original_price).
//
// GET ?month=YYYY-MM   (default this month, Eastern)
// POST { action: 'limit', value }   daily spend alert line, in dollars

import { adminDb as db, requireAdmin, etDate, addDays, TOUR_RESTAURANT_ID } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { getSettings } from '../../../../lib/admin/settings';
import stripe from '../../../../lib/stripeServer';

const FEATURES = {
  invoice_parse: 'Invoice reading',
  invoice_sanity: 'Invoice double-check',
  invoice_match: 'Invoice line matching',
  menu_import: 'Menu reading',
  dish_recs: 'Tonight’s Dish',
  profit_score: 'Profit score',
};
const DEFAULT_LIMIT = 5;

async function planPrices() {
  const out = new Map();
  try {
    let starting_after;
    for (let i = 0; i < 5; i++) {
      const page = await stripe.subscriptions.list({ status: 'all', limit: 100, starting_after });
      for (const s of page.data) {
        const p = s.items?.data?.[0]?.price;
        if (!p?.unit_amount) continue;
        const perMonth = p.recurring?.interval === 'year' ? p.unit_amount / 1200 : p.unit_amount / 100;
        out.set(s.id, { perMonth, live: ['active', 'trialing', 'past_due'].includes(s.status) });
      }
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1].id;
    }
  } catch (err) {
    console.error('[admin/platform/ai] Stripe', err.message);
  }
  return out;
}

async function load(month) {
  const today = etDate();
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = addDays(next, -1);
  const prevFirst = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const since90 = addDays(today, -90);

  const [rows, prevRows, { data: rest }, invoices, lines, settings, prices] = await Promise.all([
    fetchAll(() => db.from('ai_usage').select('id, feature, model, cost, input_tokens, output_tokens, restaurant_id, created_at').gte('created_at', addDays(first, -1)).lt('created_at', addDays(next, 1)).order('id')),
    fetchAll(() => db.from('ai_usage').select('id, cost, created_at').gte('created_at', addDays(prevFirst, -1)).lt('created_at', addDays(first, 1)).order('id')),
    db.from('restaurants').select('id, name, stripe_subscription_id'),
    fetchAll(() => db.from('invoices').select('id, restaurant_id, created_at').eq('is_sample', false).gte('created_at', addDays(first, -1)).lt('created_at', addDays(next, 1)).order('id')),
    fetchAll(() => db.from('invoice_items').select('id, quantity, unit_cost, original_quantity, original_price, ingredient_id, invoices!inner(reviewed, is_sample, date)').eq('invoices.reviewed', true).eq('invoices.is_sample', false).gte('invoices.date', since90).order('id')),
    getSettings(db),
    planPrices(),
  ]);

  const inMonth = (ts) => { const d = etDate(new Date(ts)); return d >= first && d <= last; };
  const use = rows.filter((r) => inMonth(r.created_at));
  const cost = (r) => Number(r.cost) || 0;

  // Per day.
  const days = [];
  for (let d = first; d <= last && d <= today; d = addDays(d, 1)) days.push(d);
  const byDay = new Map(days.map((d) => [d, { date: d, spend: 0, calls: 0, by: {} }]));
  for (const r of use) {
    const k = byDay.get(etDate(new Date(r.created_at)));
    if (!k) continue;
    k.spend += cost(r);
    k.calls += 1;
    k.by[r.feature] = (k.by[r.feature] || 0) + 1;
  }

  // Per job.
  const jobs = new Map();
  for (const r of use) {
    const j = jobs.get(r.feature) || { key: r.feature, name: FEATURES[r.feature] || r.feature, models: new Set(), runs: 0, total: 0, tokens: 0 };
    j.runs += 1;
    j.total += cost(r);
    j.tokens += (r.input_tokens || 0) + (r.output_tokens || 0);
    if (r.model) j.models.add(r.model);
    jobs.set(r.feature, j);
  }

  // Per restaurant.
  const names = new Map((rest || []).map((r) => [r.id, r]));
  const per = new Map();
  const row = (rid) => {
    if (!per.has(rid)) per.set(rid, { id: rid, name: names.get(rid)?.name || 'Unknown', invoices: 0, menuCalls: 0, dishRuns: 0, calls: 0, spend: 0 });
    return per.get(rid);
  };
  for (const r of use) {
    if (!r.restaurant_id || r.restaurant_id === TOUR_RESTAURANT_ID) continue;
    const p = row(r.restaurant_id);
    p.calls += 1;
    p.spend += cost(r);
    if (r.feature === 'menu_import') p.menuCalls += 1;
    if (r.feature === 'dish_recs') p.dishRuns += 1;
  }
  for (const inv of invoices) {
    if (!inMonth(inv.created_at) || inv.restaurant_id === TOUR_RESTAURANT_ID) continue;
    row(inv.restaurant_id).invoices += 1;
  }
  const restaurants = [...per.values()].map((p) => {
    const sub = names.get(p.id)?.stripe_subscription_id ? prices.get(names.get(p.id).stripe_subscription_id) : null;
    const pays = sub?.live ? sub.perMonth : null;
    return { ...p, pays, pct: pays ? p.spend / pays : null };
  }).sort((a, b) => b.spend - a.spend);

  // How often reviewed invoice lines needed fixing (last 90 days).
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
  const tracked = lines.filter((l) => l.original_quantity != null || l.original_price != null);
  const qty = tracked.filter((l) => l.original_quantity != null && !near(l.quantity, l.original_quantity)).length;
  const price = tracked.filter((l) => l.original_price != null && !near(l.unit_cost, l.original_price)).length;
  const unlinked = tracked.filter((l) => !l.ingredient_id).length;
  const clean = tracked.filter((l) => (l.original_quantity == null || near(l.quantity, l.original_quantity)) && (l.original_price == null || near(l.unit_cost, l.original_price))).length;

  const spend = use.reduce((a, r) => a + cost(r), 0);
  const prevSpend = prevRows.filter((r) => { const d = etDate(new Date(r.created_at)); return d >= prevFirst && d < first; }).reduce((a, r) => a + cost(r), 0);
  const limit = Number(settings.ai_daily_alert ?? DEFAULT_LIMIT);

  return {
    month, today, isThisMonth: today >= first && today <= last, limit,
    spend, prevSpend, todaySpend: byDay.get(today)?.spend || 0, calls: use.length,
    daysOver: [...byDay.values()].filter((d) => d.spend > limit).length,
    days: [...byDay.values()],
    jobs: [...jobs.values()].map((j) => ({ ...j, models: [...j.models], each: j.runs ? j.total / j.runs : 0 })).sort((a, b) => b.total - a.total),
    restaurants,
    accuracy: { lines: tracked.length, clean, qty, price, unlinked },
  };
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : etDate().slice(0, 7);
      return res.status(200).json(await load(month));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'limit') {
      const value = Number(b.value);
      if (!(value > 0)) return res.status(400).json({ error: 'Enter a dollar amount above 0' });
      const { error } = await db.from('admin_settings').upsert({ key: 'ai_daily_alert', value, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Set the AI daily spend line to $${value.toFixed(2)}` });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/platform/ai]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}