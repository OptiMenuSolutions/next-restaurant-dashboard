// pages/api/admin/restaurant/[id]/index.js
// One restaurant, for its admin page. ?part= picks what to load:
//   overview  (default) facts, health checks, last 5 nights, notes, people
//   activity  everything that happened, newest first
//   menu      every dish with plate cost, margin, sales and picks
//   invoices  every invoice with its review state

import { adminDb as db, requireAdmin, etDate, addDays } from '../../../../../lib/admin/requireAdmin';
import { loadRestaurantFacts } from '../../../../../lib/admin/restaurantFacts';
import { fetchAll } from '../../../../../lib/admin/fetchAll';
import { calculateStandardizedCost } from '../../../../../lib/standardizedUnits';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameDish = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a)));
const when = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
const day = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00Z'));
const ago = (ts) => {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
};

async function salesByDay(id, fromDate) {
  const rows = await fetchAll(() => db.from('pos_sales').select('id, item_name, quantity_sold, sale_date').eq('restaurant_id', id).gte('sale_date', fromDate).order('id'));
  const days = new Map();
  for (const s of rows) {
    if (!days.has(s.sale_date)) days.set(s.sale_date, []);
    days.get(s.sale_date).push({ name: norm(s.item_name), qty: parseFloat(s.quantity_sold || 0) });
  }
  return days;
}
const soldOn = (days, date, dish) => (days.get(date) || []).filter((x) => sameDish(x.name, dish)).reduce((a, x) => a + x.qty, 0);

// The health box: what is wrong (with a way to fix it) and what is fine.
function healthChecks(f) {
  const fix = {
    'Payment failed': [`/admin/billing/${f.id}`, 'Open billing'],
    'POS sync failing': ['/admin/errors', 'See the error'],
    'POS disconnected': ['/admin/errors', 'See the error'],
    'No Tonight’s Dish today': ['#run-dish', 'Run it now'],
    'Invoices waiting over 3 days': [`/admin/review?restaurant=${f.id}`, 'Review'],
  };
  const bad = f.health.reasons.map((t) => {
    const key = Object.keys(fix).find((k) => t.startsWith(k)) || (t.startsWith('POS last synced') ? 'POS sync failing' : null);
    return { t, ok: false, href: key ? fix[key][0] : null, act: key ? fix[key][1] : null };
  });
  const good = [];
  if (f.conn?.status === 'connected' && f.conn.last_synced_at && !f.health.reasons.some((r) => r.startsWith('POS'))) good.push(`POS synced ${ago(f.conn.last_synced_at)}`);
  if (f.hasDishToday) good.push('Tonight’s Dish ran today');
  if (f.views[6] > 0) good.push(`Staff page opened ${f.views[6]} time${f.views[6] === 1 ? '' : 's'} yesterday`);
  if (f.lastInvoice && Date.now() - new Date(f.lastInvoice).getTime() < 3 * 86400000) good.push(`Invoice uploaded ${ago(f.lastInvoice)}`);
  if (!f.unreviewedCount && f.invoiceCount) good.push('Every invoice reviewed');
  return [...bad, ...good.map((t) => ({ t, ok: true }))];
}

async function overview(id) {
  const [f] = await loadRestaurantFacts(db, [id]);
  if (!f) return null;
  const today = etDate();
  const [tok, recs, notes, days] = await Promise.all([
    db.from('restaurants').select('nfc_token').eq('id', id).single(),
    db.from('ai_recommendations').select('generated_date, recommendations').eq('restaurant_id', id).order('generated_date', { ascending: false }).limit(5),
    db.from('admin_restaurant_notes').select('id, body, admin_name, created_at').eq('restaurant_id', id).order('created_at', { ascending: false }).limit(30),
    salesByDay(id, addDays(today, -40)),
  ]);

  const dishes = (recs.data || []).map((r) => {
    const pick = r.recommendations?.[0] || {};
    const dish = norm(pick.title);
    let lift = 'No POS data that night';
    if (dish && days.has(r.generated_date) && r.generated_date < today) {
      const past = [1, 2, 3, 4].map((w) => addDays(r.generated_date, -7 * w)).filter((d) => days.has(d));
      const sold = soldOn(days, r.generated_date, dish);
      if (past.length) {
        const typical = past.reduce((a, d) => a + soldOn(days, d, dish), 0) / past.length;
        lift = `Sold ${Math.round(sold)} vs ${typical.toFixed(1)} typical`;
      } else lift = `Sold ${Math.round(sold)} · no history yet`;
    } else if (r.generated_date === today) lift = 'Tonight';
    return { date: day(r.generated_date), dish: pick.title || '—', why: pick.reason_selected || '', lift, others: (r.recommendations || []).slice(1, 3).map((x) => x.title) };
  });

  return {
    restaurant: f,
    // Admin-only link that opens the staff page without logging a tap.
    staffPreview: tok.data?.nfc_token ? `/staff/${tok.data.nfc_token}` : null,
    checks: healthChecks(f),
    checkedAt: when(new Date()),
    dishes,
    notes: (notes.data || []).map((n) => ({ id: n.id, body: n.body, by: n.admin_name, when: when(n.created_at) })),
  };
}

async function activity(id) {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const [inv, scans, recs, taps, audit, notes, usage] = await Promise.all([
    db.from('invoices').select('supplier, number, created_at, reviewed, parse_status').eq('restaurant_id', id).eq('is_sample', false).gte('created_at', since).order('created_at', { ascending: false }).limit(200),
    db.from('scanner_scans').select('status, pages, error, created_at').eq('restaurant_id', id).gte('created_at', since).order('created_at', { ascending: false }).limit(200),
    db.from('ai_recommendations').select('generated_date, recommendations').eq('restaurant_id', id).gte('generated_date', since.slice(0, 10)).limit(60),
    fetchAll(() => db.from('nfc_tag_taps').select('id, tapped_at').eq('restaurant_id', id).gte('tapped_at', since).order('id')),
    db.from('admin_audit_log').select('admin_name, action, reason, created_at').eq('target_restaurant_id', id).gte('created_at', since).order('created_at', { ascending: false }).limit(200),
    db.from('admin_restaurant_notes').select('body, admin_name, created_at').eq('restaurant_id', id).gte('created_at', since).limit(100),
    db.from('ai_usage').select('feature, cost, created_at').eq('restaurant_id', id).eq('feature', 'menu_import').gte('created_at', since).limit(100),
  ]);

  const out = [];
  for (const i of inv.data || []) out.push({ ts: i.created_at, kind: 'INVOICE', text: `${i.supplier || 'Invoice'}${i.number ? ' #' + i.number : ''} uploaded${i.parse_status === 'failed' ? ' · could not be read' : ''}${i.reviewed === false ? ' · not reviewed' : ''}` });
  for (const s of scans.data || []) out.push({ ts: s.created_at, kind: 'SCAN', text: `Scanner sent ${s.pages || 1} page${s.pages === 1 ? '' : 's'} · ${s.status}${s.error ? ' · ' + s.error : ''}` });
  for (const r of recs.data || []) out.push({ ts: r.generated_date + 'T11:00:00Z', kind: 'DISH', text: `Tonight’s Dish: ${(r.recommendations || []).map((x) => x.title).slice(0, 3).join(', ')}` });
  const tapDays = new Map();
  for (const t of taps) {
    const d = etDate(new Date(t.tapped_at));
    tapDays.set(d, (tapDays.get(d) || 0) + 1);
  }
  for (const [d, n] of tapDays) out.push({ ts: d + 'T23:59:00-05:00', kind: 'STAFF', text: `Staff page opened ${n} time${n === 1 ? '' : 's'}` });
  for (const a of audit.data || []) out.push({ ts: a.created_at, kind: 'ADMIN', text: `${a.admin_name}: ${a.action}${a.reason ? ' · ' + a.reason : ''}` });
  for (const n of notes.data || []) out.push({ ts: n.created_at, kind: 'NOTE', text: `${n.admin_name}: ${n.body}` });
  for (const u of usage.data || []) out.push({ ts: u.created_at, kind: 'MENU', text: 'Menu read by AI' });

  out.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return { activity: out.slice(0, 150).map((a) => ({ ...a, when: when(a.ts) })) };
}

async function menu(id) {
  const today = etDate();
  const [rest, items, recs, days] = await Promise.all([
    db.from('restaurants').select('target_food_cost').eq('id', id).single(),
    fetchAll(() => db.from('menu_items').select(`
      id, name, price, category,
      menu_item_components ( component_ingredients ( quantity, unit, ingredients:ingredient_id ( name, unit, last_price, is_estimated, price_approved_at ) ) )
    `).eq('restaurant_id', id).is('archived_at', null).order('id')),
    db.from('ai_recommendations').select('recommendations').eq('restaurant_id', id).gte('generated_date', addDays(today, -30)),
    salesByDay(id, addDays(today, -7)),
  ]);

  const target = Number(rest.data?.target_food_cost) || 32;
  const picks = new Map();
  for (const r of recs.data || []) for (const p of (r.recommendations || []).slice(0, 3)) {
    const k = norm(p.title);
    picks.set(k, (picks.get(k) || 0) + 1);
  }
  const lastWeek = [...days.keys()].filter((d) => d < today);

  const rows = items.map((m) => {
    const price = parseFloat(m.price || 0);
    const lines = (m.menu_item_components || []).flatMap((c) => c.component_ingredients || []);
    const waiting = lines.filter((l) => l.ingredients && l.ingredients.is_estimated !== false && !l.ingredients.price_approved_at).length;
    let cost = null;
    if (lines.length && !waiting) {
      cost = lines.reduce((a, l) => {
        const g = l.ingredients || {};
        const u = l.unit || g.unit || 'each';
        return a + calculateStandardizedCost(parseFloat(l.quantity || 0), u, parseFloat(g.last_price || 0), g.unit || u, g.name || '');
      }, 0);
    }
    const pct = cost != null && price > 0 ? (cost / price) * 100 : null;
    const dish = norm(m.name);
    return {
      id: m.id,
      name: m.name,
      cat: m.category || 'Uncategorized',
      price,
      cost,
      pct,
      margin: cost != null ? price - cost : null,
      recipe: !lines.length ? 'NO RECIPE' : waiting ? `${waiting} TO APPROVE` : 'PRICED',
      sold: lastWeek.length ? lastWeek.reduce((a, d) => a + soldOn(days, d, dish), 0) : null,
      picked: picks.get(dish) || 0,
    };
  }).sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));

  return { menu: rows, target };
}

async function invoices(id) {
  const { data, error } = await db.from('invoices')
    .select('id, supplier, number, date, total_amount, amount, reviewed, parse_status, created_at, invoice_items(count)')
    .eq('restaurant_id', id).eq('is_sample', false)
    .order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return {
    invoices: (data || []).map((i) => ({
      id: i.id,
      date: i.date || i.created_at?.slice(0, 10),
      vendor: i.supplier || 'Unknown supplier',
      number: i.number || '',
      lines: i.invoice_items?.[0]?.count ?? null,
      total: parseFloat(i.total_amount ?? i.amount ?? 0) || null,
      parse: i.parse_status || '',
      reviewed: i.reviewed !== false,
      uploaded: when(i.created_at),
    })),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id, part = 'overview' } = req.query;
  try {
    let out;
    if (part === 'activity') out = await activity(id);
    else if (part === 'menu') out = await menu(id);
    else if (part === 'invoices') out = await invoices(id);
    else out = await overview(id);
    if (!out) return res.status(404).json({ error: 'Restaurant not found' });
    return res.status(200).json(out);
  } catch (err) {
    console.error('[admin/restaurant]', err);
    return res.status(500).json({ error: err.message || 'Could not load this restaurant' });
  }
}