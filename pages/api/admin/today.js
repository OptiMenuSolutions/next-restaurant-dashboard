// pages/api/admin/today.js
// Everything the Today page shows: the greeting, four numbers and the rail.
//
// Dish lift: for the last 7 nights, how many of the dishes Tonight's Dish
// picked actually sold, against what the same dish usually sells on the same
// weekday (average of the 4 weeks before). Nights or dishes with no POS
// history are skipped, not counted as zero.

import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID, etDate, etHour, addDays } from '../../../lib/admin/requireAdmin';
import { syncTickets, sortTickets, forClient } from '../../../lib/admin/tickets';
import { healthFor } from '../../../lib/admin/health';
import { fetchAll } from '../../../lib/admin/fetchAll';
import { JOBS, etTimeOf } from '../../../lib/admin/jobRun';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameDish = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a)));

function listNames(names) {
  if (!names.length) return 'None yet';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    // Rail first, so the numbers below can count its tickets.
    let ticketError = null;
    try {
      await syncTickets(db);
    } catch (e) {
      ticketError = e.message;
      console.error('[admin/today] ticket sync failed:', e.message);
    }

    const today = etDate();
    const hourET = etHour();
    const from36 = addDays(today, -36);
    const monthStart = today.slice(0, 8) + '01';

    const [rest, recs, conns, unrev, usage, open, jobRuns, anyRun] = await Promise.all([
      db.from('restaurants').select('id, name, subscription_status, deactivated_at'),
      db.from('ai_recommendations').select('restaurant_id, generated_date, recommendations').gte('generated_date', addDays(today, -8)),
      db.from('pos_connections').select('restaurant_id, status, last_synced_at'),
      db.from('invoices').select('restaurant_id, created_at').eq('reviewed', false).eq('is_sample', false).order('created_at', { ascending: true }).limit(1000),
      db.from('ai_usage').select('feature, cost').gte('created_at', monthStart),
      db.from('admin_tickets').select('*').eq('status', 'open'),
      db.from('admin_job_runs').select('job, status, summary, started_at').gte('started_at', addDays(today, -1)).order('started_at', { ascending: false }),
      db.from('admin_job_runs').select('id').limit(1),
    ]);

    // ── Live restaurants ─────────────────────────────────────────────────
    const real = (rest.data || []).filter((r) => r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at);
    const recRows = recs.data || [];
    const withRecs = new Set(recRows.map((r) => r.restaurant_id));
    const live = real.filter((r) => ['active', 'trialing'].includes(r.subscription_status) || withRecs.has(r.id));

    // ── Needs attention ──────────────────────────────────────────────────
    const connBy = new Map((conns.data || []).map((c) => [c.restaurant_id, c]));
    const dishToday = new Set(recRows.filter((r) => r.generated_date === today).map((r) => r.restaurant_id));
    const oldestUnrev = new Map();
    for (const i of unrev.data || []) if (!oldestUnrev.has(i.restaurant_id)) oldestUnrev.set(i.restaurant_id, i.created_at);
    const flagged = live
      .map((r) => ({ r, h: healthFor(r, { conn: connBy.get(r.id), hasDishToday: dishToday.has(r.id), oldestUnreviewed: oldestUnrev.get(r.id), hourET }) }))
      .filter((x) => x.h.level !== 'green')
      .sort((a, b) => (a.h.level === 'red' ? 0 : 1) - (b.h.level === 'red' ? 0 : 1));

    // ── Dish lift, last 7 nights ─────────────────────────────────────────
    let totActual = 0;
    let totTypical = 0;
    if (live.length) {
      const sales = await fetchAll(() => db
        .from('pos_sales')
        .select('id, restaurant_id, item_name, quantity_sold, sale_date')
        .in('restaurant_id', live.map((r) => r.id))
        .gte('sale_date', from36)
        .order('id'));

      // restaurant -> date -> [{ name, qty }]
      const byRD = new Map();
      for (const s of sales || []) {
        if (!byRD.has(s.restaurant_id)) byRD.set(s.restaurant_id, new Map());
        const days = byRD.get(s.restaurant_id);
        if (!days.has(s.sale_date)) days.set(s.sale_date, []);
        days.get(s.sale_date).push({ name: norm(s.item_name), qty: parseFloat(s.quantity_sold || 0) });
      }
      const sold = (days, date, dish) => (days.get(date) || []).filter((x) => sameDish(x.name, dish)).reduce((a, x) => a + x.qty, 0);

      for (const r of live) {
        const days = byRD.get(r.id);
        if (!days) continue;
        for (let back = 1; back <= 7; back++) {
          const date = addDays(today, -back);
          if (!days.has(date)) continue; // no POS data that night
          const row = recRows.find((x) => x.restaurant_id === r.id && x.generated_date === date);
          for (const pick of (row?.recommendations || []).slice(0, 3)) {
            const dish = norm(pick.title);
            if (!dish) continue;
            const past = [1, 2, 3, 4].map((w) => addDays(date, -7 * w)).filter((d) => days.has(d));
            if (!past.length) continue;
            totActual += sold(days, date, dish);
            totTypical += past.reduce((a, d) => a + sold(days, d, dish), 0) / past.length;
          }
        }
      }
    }
    const lift = totTypical > 0 ? (totActual - totTypical) / totTypical : null;

    // ── AI spend this month ──────────────────────────────────────────────
    const u = usage.data || [];
    const spend = u.reduce((a, x) => a + parseFloat(x.cost || 0), 0);
    const count = (f) => u.filter((x) => x.feature === f).length;

    // ── Last night's jobs ────────────────────────────────────────────────
    const tracking = !!(anyRun.data || []).length;
    const jobs = JOBS.map((j) => {
      const run = (jobRuns.data || []).find((x) => x.job === j.key && etDate(new Date(x.started_at)) === today);
      const due = Date.parse(`${today}T${String(j.utc[1]).padStart(2, '0')}:${String(j.utc[0]).padStart(2, '0')}:00Z`) + 30 * 60000;
      const status = run ? run.status : !tracking ? 'none' : due < Date.now() ? 'missed' : 'waiting';
      return { key: j.key, name: j.name, time: etTimeOf(j.utc, today), status, summary: run?.summary || null };
    });

    // ── Rail ─────────────────────────────────────────────────────────────
    const tickets = sortTickets(open.data || []).map(forClient);
    const first = String(admin.profile.full_name || '').trim().split(/\s+/)[0] || 'there';
    const greet = hourET < 12 ? 'Good morning' : hourET < 17 ? 'Good afternoon' : 'Good evening';

    return res.status(200).json({
      greeting: `${greet}, ${first}`,
      dateLabel: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase().replace(',', ' ·'),
      kpis: [
        { label: 'LIVE RESTAURANTS', value: String(live.length), sub: listNames(live.map((r) => r.name)) },
        {
          label: 'DISH LIFT · 7 NIGHTS',
          value: lift == null ? '—' : `${lift >= 0 ? '+' : '−'}${Math.round(Math.abs(lift) * 100)}%`,
          sub: lift == null ? 'Needs POS sales and a week of picks' : `Picks sold ${Math.round(totActual)} vs ${Math.round(totTypical)} typical`,
          tone: lift == null ? null : lift >= 0 ? 'green' : 'red',
        },
        {
          label: 'NEEDS ATTENTION',
          value: String(flagged.length),
          sub: flagged.length ? `${flagged[0].r.name} · ${flagged[0].h.reasons[0]}` : 'All clear',
          tone: flagged.some((x) => x.h.level === 'red') ? 'red' : flagged.length ? 'amber' : null,
        },
        {
          label: `AI SPEND · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short' }).format(new Date()).toUpperCase()}`,
          value: `$${spend.toFixed(2)}`,
          sub: `${count('invoice_parse')} invoices · ${count('menu_import')} menus · ${count('dish_recs')} Dish runs`,
        },
      ],
      tickets,
      jobs,
      ticketError,
    });
  } catch (err) {
    console.error('[admin/today] error:', err);
    return res.status(500).json({ error: 'Could not load Today' });
  }
}