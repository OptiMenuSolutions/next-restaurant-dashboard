// lib/admin/tickets.js
// The to-do rail. Most tickets are made automatically from the live data
// (open errors, new messages, invoices to check, cost estimates, failing POS
// syncs, failed payments). syncTickets() rebuilds that list, saves it into
// admin_tickets, and closes any ticket whose work is already done. Notes you
// add by hand have no source and only close when you mark them done.
//
// A ticket you marked done comes back if its source changes (a new message
// arrives, more invoices come in). Snoozed tickets come back at 6 AM Eastern
// on the day they were snoozed until.

import { TOUR_RESTAURANT_ID } from './requireAdmin';

// Rail order: what breaks things first, then what people are waiting on.
export const KIND_ORDER = ['JOB', 'BILLING', 'DEADLINE', 'SUPPORT', 'REVIEW', 'COSTS', 'SALES', 'BOOKS', 'NOTE'];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clip = (s, n = 140) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const pretty = (feature) =>
  String(feature || 'Job').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// Builds the tickets the data calls for right now. Returns the tickets plus
// the kinds whose query failed, so those are never closed by mistake.
export async function buildSourceTickets(db) {
  const [rest, errs, fb, inv, est, conns, dishes] = await Promise.all([
    db.from('restaurants').select('id, name, subscription_status, deactivated_at'),
    db.from('error_queue').select('id, feature, error_message, restaurant_id, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(50),
    db.from('support_threads').select('id, subject, restaurant_id, last_message_at').eq('status', 'new').order('last_message_at', { ascending: true }).limit(200),
    db.from('invoices').select('id, restaurant_id, supplier, created_at').eq('reviewed', false).eq('is_sample', false).order('created_at', { ascending: true }).limit(1000),
    db.from('ingredients').select('id, restaurant_id, created_at').eq('is_estimated', true).is('price_approved_at', null).is('price_skipped_at', null).limit(10000),
    db.from('pos_connections').select('id, restaurant_id, status, last_error, updated_at'),
    db.from('menu_items').select('id, restaurant_id, created_at').is('admin_reviewed_at', null).is('archived_at', null).limit(1000),
  ]);

  const failed = new Set();
  if (rest.error) return { tickets: [], failed: new Set(KIND_ORDER) };
  const names = new Map();
  const real = new Set();
  for (const r of rest.data || []) {
    names.set(r.id, r.name);
    if (r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at) real.add(r.id);
  }
  const keep = (rid) => !rid || real.has(rid);
  const tickets = [];

  // JOB: each open error.
  if (errs.error) failed.add('JOB');
  for (const e of (errs.data || []).filter((x) => keep(x.restaurant_id))) {
    const who = e.restaurant_id ? names.get(e.restaurant_id) : null;
    tickets.push({
      source_key: `error:${e.id}`, kind: 'JOB',
      title: `${pretty(e.feature)} failed${who ? ` for ${who}` : ''}`,
      meta: clip(e.error_message),
      href: '/admin/health', action: 'See the error',
      restaurant_id: e.restaurant_id || null, source_at: e.created_at, fingerprint: String(e.id),
    });
  }

  // JOB: POS connections in error.
  if (conns.error) failed.add('POS');
  for (const c of (conns.data || []).filter((x) => x.status === 'error' && keep(x.restaurant_id))) {
    tickets.push({
      source_key: `pos:${c.id}`, kind: 'JOB',
      title: `POS sync failing for ${names.get(c.restaurant_id) || 'a restaurant'}`,
      meta: clip(c.last_error || 'The last sync returned an error.'),
      href: '/admin/pos', action: 'Open POS connections',
      restaurant_id: c.restaurant_id, source_at: c.updated_at, fingerprint: clip(c.last_error, 60),
    });
  }

  // SUPPORT: all new messages, as one ticket.
  if (fb.error) failed.add('SUPPORT');
  const msgs = (fb.data || []).filter((m) => keep(m.restaurant_id));
  if (msgs.length) {
    const newest = msgs[msgs.length - 1];
    const who = newest.restaurant_id ? names.get(newest.restaurant_id) : null;
    tickets.push({
      source_key: 'support:new', kind: 'SUPPORT',
      title: plural(msgs.length, 'new message', 'new messages'),
      meta: clip(`${who ? who + ': ' : ''}${newest.subject || ''}`, 110),
      href: '/admin/support', action: 'Reply',
      restaurant_id: null, source_at: msgs[0].last_message_at, fingerprint: `${newest.id}:${newest.last_message_at}`,
    });
  }

  // REVIEW: unreviewed invoices, one ticket per restaurant.
  if (inv.error) failed.add('REVIEW');
  const byRest = new Map();
  for (const i of (inv.data || []).filter((x) => real.has(x.restaurant_id))) {
    if (!byRest.has(i.restaurant_id)) byRest.set(i.restaurant_id, []);
    byRest.get(i.restaurant_id).push(i);
  }
  for (const [rid, list] of byRest) {
    const suppliers = [...new Set(list.map((i) => i.supplier).filter(Boolean))].slice(0, 3).join(', ');
    tickets.push({
      source_key: `review:${rid}`, kind: 'REVIEW',
      title: plural(list.length, 'scanned invoice to check', 'scanned invoices to check'),
      meta: clip(`${names.get(rid)}${suppliers ? ' · ' + suppliers : ''} · not yet reviewed.`),
      href: `/admin/review?restaurant=${rid}`, action: 'Review',
      restaurant_id: rid, source_at: list[0].created_at, fingerprint: String(list[list.length - 1].id),
    });
  }

  // REVIEW: parsed dishes you have not checked, one ticket per restaurant.
  if (dishes.error) failed.add('MENUS');
  const dishBy = new Map();
  for (const d of (dishes.data || []).filter((x) => real.has(x.restaurant_id))) {
    const cur = dishBy.get(d.restaurant_id) || { n: 0, oldest: d.created_at };
    cur.n += 1;
    if (d.created_at < cur.oldest) cur.oldest = d.created_at;
    dishBy.set(d.restaurant_id, cur);
  }
  for (const [rid, { n, oldest }] of dishBy) {
    tickets.push({
      source_key: `menus:${rid}`, kind: 'REVIEW',
      title: plural(n, 'parsed dish to check', 'parsed dishes to check'),
      meta: `${names.get(rid)} · check portions before costs go live.`,
      href: '/admin/review?tab=menus', action: 'Check recipes',
      restaurant_id: rid, source_at: oldest, fingerprint: String(n), growOnly: true,
    });
  }

  // COSTS: AI cost estimates waiting for approval, one per restaurant.
  if (est.error) failed.add('COSTS');
  const estBy = new Map();
  for (const g of (est.data || []).filter((x) => real.has(x.restaurant_id))) {
    const cur = estBy.get(g.restaurant_id) || { n: 0, oldest: g.created_at };
    cur.n += 1;
    if (g.created_at && (!cur.oldest || g.created_at < cur.oldest)) cur.oldest = g.created_at;
    estBy.set(g.restaurant_id, cur);
  }
  for (const [rid, { n, oldest }] of estBy) {
    tickets.push({
      source_key: `costs:${rid}`, kind: 'COSTS',
      title: plural(n, 'cost estimate to approve', 'cost estimates to approve'),
      meta: `${names.get(rid)} · AI guesses that stay hidden from the owner until you approve them.`,
      href: '/admin/costs', action: 'Approve costs',
      restaurant_id: rid, source_at: oldest, fingerprint: String(n), growOnly: true,
    });
  }

  // BILLING: failed payments.
  for (const r of rest.data || []) {
    if (!real.has(r.id)) continue;
    if (r.subscription_status !== 'past_due' && r.subscription_status !== 'unpaid') continue;
    tickets.push({
      source_key: `billing:${r.id}`, kind: 'BILLING',
      title: `Payment failed for ${r.name}`,
      meta: 'Stripe retries on its own. Send the owner an update-card link.',
      href: `/admin/billing/${r.id}`, action: 'Open billing',
      restaurant_id: r.id, source_at: null, fingerprint: r.subscription_status,
    });
  }

  return { tickets, failed };
}

// The kind a source key belongs to, for the failed-query guard.
function guardKind(key) {
  if (key.startsWith('error:')) return 'JOB';
  if (key.startsWith('pos:')) return 'POS';
  if (key.startsWith('support:')) return 'SUPPORT';
  if (key.startsWith('review:')) return 'REVIEW';
  if (key.startsWith('menus:')) return 'MENUS';
  if (key.startsWith('costs:')) return 'COSTS';
  if (key.startsWith('billing:')) return 'BILLING';
  return 'OTHER';
}

export async function syncTickets(db) {
  const { tickets, failed } = await buildSourceTickets(db);
  const now = new Date().toISOString();
  const keys = tickets.map((t) => t.source_key);

  const [{ data: existing, error: exErr }, { data: live, error: liveErr }] = await Promise.all([
    keys.length
      ? db.from('admin_tickets').select('id, source_key, status, done_reason, done_at, snoozed_until, fingerprint, source_at').in('source_key', keys)
      : Promise.resolve({ data: [] }),
    db.from('admin_tickets').select('id, source_key').not('source_key', 'is', null).neq('status', 'done'),
  ]);
  if (exErr || liveErr) throw new Error((exErr || liveErr).message);

  const byKey = new Map((existing || []).map((t) => [t.source_key, t]));
  const rows = tickets.map((t) => {
    const old = byKey.get(t.source_key);
    const { growOnly, ...row } = t;
    row.updated_at = now;
    row.source_at = t.source_at || old?.source_at || now;
    // Every row carries the same columns: a bulk upsert fills any missing
    // column with null, not with the table default.
    const fresh = { status: 'open', done_at: null, done_reason: null, snoozed_until: null };
    if (!old) return { ...row, ...fresh };

    let reopen = false;
    if (old.status === 'done') {
      if (old.done_reason === 'resolved') reopen = true;           // it came back
      else if (growOnly) reopen = Number(t.fingerprint) > Number(old.fingerprint || 0);
      else reopen = t.fingerprint !== old.fingerprint;              // something new arrived
    }
    if (reopen) return { ...row, ...fresh };
    return { ...row, status: old.status, done_at: old.done_at, done_reason: old.done_reason, snoozed_until: old.snoozed_until };
  });

  if (rows.length) {
    const { error } = await db.from('admin_tickets').upsert(rows, { onConflict: 'source_key' });
    if (error) throw new Error(error.message);
  }

  // Close open tickets whose source is gone, unless that source failed to load.
  const current = new Set(keys);
  const gone = (live || [])
    .filter((t) => !current.has(t.source_key) && !failed.has(guardKind(t.source_key)))
    .map((t) => t.id);
  if (gone.length) {
    await db.from('admin_tickets')
      .update({ status: 'done', done_reason: 'resolved', done_at: now, snoozed_until: null, updated_at: now })
      .in('id', gone);
  }

  // Wake snoozed tickets that are due.
  await db.from('admin_tickets')
    .update({ status: 'open', snoozed_until: null, updated_at: now })
    .eq('status', 'snoozed')
    .lte('snoozed_until', now);
}

// Short age label for a ticket: 12M, 14 H, 3 D.
export function ageLabel(ts) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));
  if (mins < 60) return `${mins}M`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} H`;
  return `${Math.floor(hrs / 24)} D`;
}

export function sortTickets(list) {
  const rank = (k) => {
    const i = KIND_ORDER.indexOf(k);
    return i === -1 ? KIND_ORDER.length : i;
  };
  return [...list].sort((a, b) => rank(a.kind) - rank(b.kind) || new Date(a.source_at) - new Date(b.source_at));
}

export function forClient(t) {
  return {
    id: t.id, kind: t.kind, title: t.title, meta: t.meta, href: t.href, action: t.action,
    age: ageLabel(t.source_at), status: t.status, snoozed_until: t.snoozed_until,
    done_reason: t.done_reason, manual: !t.source_key,
  };
}