// pages/api/admin/platform/pos.js
// POS connections.
//
// GET                                -> every connection with its status,
//                                       token, tickets per day (last 7 days),
//                                       menu match, and recent sync job runs
// GET ?restaurant=ID&day=YYYY-MM-DD  -> that day's tickets with their lines
// POST { action: 'retry', id }        puts a connection in error back to
//                                       connected, so tonight's sync tries it
//                                       again (the sync skips errored ones)

import { adminDb as db, requireAdmin, etDate, addDays, TOUR_RESTAURANT_ID } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { JOB_BY_KEY } from '../../../../lib/admin/jobRun';

const DAYS = 7;

async function load() {
  const today = etDate();
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i - DAYS + 1));
  const [{ data: conns, error }, { data: rest }, tickets, sales, menu, { data: runs }] = await Promise.all([
    db.from('pos_connections').select('*').order('id'),
    db.from('restaurants').select('id, name'),
    fetchAll(() => db.from('pos_tickets').select('id, restaurant_id, pos_system, business_date').gte('business_date', days[0]).order('id')),
    fetchAll(() => db.from('pos_sales').select('id, restaurant_id, pos_system, sale_date').gte('sale_date', days[0]).is('upload_session_id', null).order('id')),
    fetchAll(() => db.from('pos_menu_items').select('id, restaurant_id, is_active, removed_at, menu_item_id').order('id')),
    db.from('admin_job_runs').select('id, job, trigger, started_at, ms, status, summary, details').in('job', ['reconcile-shift4', 'sync-pos-menu', 'sync-all-pos']).order('started_at', { ascending: false }).limit(15),
  ]);
  if (error) throw new Error(error.message);
  const names = new Map((rest || []).map((r) => [r.id, r.name]));

  const tally = (rows, dateKey) => {
    const m = new Map();
    for (const r of rows) {
      const k = `${r.restaurant_id}|${r.pos_system}|${r[dateKey]}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const tix = tally(tickets, 'business_date');
  const sal = tally(sales, 'sale_date');

  const now = Date.now();
  const connections = (conns || []).filter((c) => c.restaurant_id !== TOUR_RESTAURANT_ID).map((c) => {
    const items = menu.filter((m) => m.restaurant_id === c.restaurant_id && m.is_active && !m.removed_at);
    const hasTickets = tickets.some((t) => t.restaurant_id === c.restaurant_id && t.pos_system === c.provider);
    let token;
    if (c.provider === 'shift4') token = { label: 'Signed calls, no token', level: 'ok' };
    else if (!c.expires_at) token = { label: 'No expiry stored', level: 'muted' };
    else {
      const daysLeft = Math.floor((Date.parse(c.expires_at) - now) / 86400000);
      token = daysLeft < 0
        ? { label: 'Expired, refreshes on next sync', level: c.refresh_token ? 'warn' : 'bad' }
        : { label: `Refreshes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, level: 'ok' };
    }
    return {
      id: c.id, restaurant_id: c.restaurant_id, restaurant: names.get(c.restaurant_id) || 'Unknown',
      provider: c.provider, location: c.shift4_location_id || c.location_id || c.merchant_id || null,
      timezone: c.shift4_timezone || null,
      status: c.status, last_error: c.last_error || null, last_synced_at: c.last_synced_at || null,
      token,
      unit: hasTickets ? 'tickets' : 'sales lines',
      byDay: days.map((d) => ({ date: d, n: (hasTickets ? tix : sal).get(`${c.restaurant_id}|${c.provider}|${d}`) || 0 })),
      menu: c.provider === 'shift4' ? { items: items.length, matched: items.filter((m) => m.menu_item_id).length } : null,
    };
  });

  return {
    days, connections,
    runs: (runs || []).map((r) => ({ ...r, name: JOB_BY_KEY.get(r.job)?.name || r.job, details: r.details || [] })),
  };
}

async function day(restaurantId, date) {
  const { data: tickets, error } = await db.from('pos_tickets')
    .select('id, external_ticket_id, order_number, ticket_type, order_type, opened_at, closed_at, table_name, guest_count, void_reason, total_items, total_discounts, total_tax, total_tips, total_grand')
    .eq('restaurant_id', restaurantId).eq('business_date', date).order('closed_at', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  const ids = (tickets || []).map((t) => t.id);
  const lines = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from('pos_ticket_lines')
      .select('id, ticket_id, item_name, category, line_type, quantity, unit_price, item_amount, discount_amount, void_reason, modifier_amount')
      .in('ticket_id', ids.slice(i, i + 100)).order('id');
    lines.push(...(data || []));
  }
  const byTicket = new Map();
  for (const l of lines) {
    if (!byTicket.has(l.ticket_id)) byTicket.set(l.ticket_id, []);
    byTicket.get(l.ticket_id).push(l);
  }
  return {
    tickets: (tickets || []).map((t) => {
      const mine = byTicket.get(t.id) || [];
      const flags = [];
      if (t.void_reason) flags.push('VOID');
      if (!t.closed_at) flags.push('OPEN');
      if (Number(t.total_discounts) > 0) flags.push('DISCOUNT');
      if (Number(t.total_grand) < 0 || mine.some((l) => Number(l.quantity) < 0)) flags.push('REFUND');
      if (mine.some((l) => l.void_reason)) flags.push('VOIDED LINE');
      return { ...t, lines: mine, flags };
    }),
  };
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      if (req.query.day && req.query.restaurant) return res.status(200).json(await day(String(req.query.restaurant), String(req.query.day)));
      return res.status(200).json(await load());
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'retry') {
      const { data: c } = await db.from('pos_connections').select('id, restaurant_id, status').eq('id', b.id).single();
      if (!c) return res.status(404).json({ error: 'Not found' });
      if (c.status !== 'error') return res.status(400).json({ error: 'Only a connection in error can be retried' });
      const { error } = await db.from('pos_connections').update({ status: 'connected', last_error: null, updated_at: new Date().toISOString() }).eq('id', c.id);
      if (error) throw new Error(error.message);
      const { data: r } = await db.from('restaurants').select('id, name').eq('id', c.restaurant_id).single();
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: 'Set POS connection back to connected', target_restaurant_id: r?.id || null, target_restaurant_name: r?.name || null });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/platform/pos]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}