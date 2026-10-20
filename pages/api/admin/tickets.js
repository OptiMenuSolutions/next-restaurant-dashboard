// pages/api/admin/tickets.js
// GET  -> { open, snoozed, doneToday }   (syncs the rail first)
// POST { action: 'done' | 'snooze' | 'reopen', id, days? }
// POST { action: 'note', title, meta? }   adds a ticket by hand

import { adminDb as db, requireAdmin, etDate, etMorning } from '../../../lib/admin/requireAdmin';
import { syncTickets, sortTickets, forClient } from '../../../lib/admin/tickets';
import { writeAuditLog } from '../../../lib/admin/withAdminAuth';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    try {
      await syncTickets(db);
    } catch (e) {
      console.error('[admin/tickets] sync failed:', e.message);
    }
    // Start of today in Eastern time, for "Done today".
    const startET = etMorning(0);
    startET.setUTCHours(startET.getUTCHours() - 6);

    const [{ data: active, error }, { data: done }] = await Promise.all([
      db.from('admin_tickets').select('*').in('status', ['open', 'snoozed']),
      db.from('admin_tickets').select('*').eq('status', 'done').gte('done_at', startET.toISOString()).order('done_at', { ascending: false }),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    const list = active || [];
    return res.status(200).json({
      open: sortTickets(list.filter((t) => t.status === 'open')).map(forClient),
      snoozed: list.filter((t) => t.status === 'snoozed').sort((a, b) => new Date(a.snoozed_until) - new Date(b.snoozed_until)).map(forClient),
      doneToday: (done || []).map(forClient),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, id } = req.body || {};
  const now = new Date().toISOString();

  if (action === 'note') {
    const title = String(req.body.title || '').trim().slice(0, 120);
    const meta = String(req.body.meta || '').trim().slice(0, 300);
    if (!title) return res.status(400).json({ error: 'A note needs a title' });
    const { data, error } = await db.from('admin_tickets')
      .insert({ kind: 'NOTE', title, meta: meta || null, status: 'open', source_at: now })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Added a note: ${title}`, metadata: { ticket_id: data.id } });
    return res.status(200).json({ ticket: forClient(data) });
  }

  if (!id) return res.status(400).json({ error: 'id is required' });
  const { data: t } = await db.from('admin_tickets').select('id, title').eq('id', id).single();
  if (!t) return res.status(404).json({ error: 'Ticket not found' });

  let patch;
  let said;
  if (action === 'done') {
    patch = { status: 'done', done_reason: 'you', done_at: now, snoozed_until: null };
    said = `Marked done: ${t.title}`;
  } else if (action === 'snooze') {
    const days = Math.min(Math.max(parseInt(req.body.days, 10) || 1, 1), 30);
    patch = { status: 'snoozed', snoozed_until: etMorning(days).toISOString() };
    said = `Snoozed ${days} day${days === 1 ? '' : 's'}: ${t.title}`;
  } else if (action === 'reopen') {
    patch = { status: 'open', snoozed_until: null, done_at: null, done_reason: null };
    said = `Reopened: ${t.title}`;
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  const { error } = await db.from('admin_tickets').update({ ...patch, updated_at: now }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: said, metadata: { ticket_id: id, on: etDate() } });
  return res.status(200).json({ ok: true });
}