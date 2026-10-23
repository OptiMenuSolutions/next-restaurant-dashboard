// pages/api/admin/sales/calendar.js
// Calendar: your day notes and scheduled events, deadlines, sales touches
// and follow-ups, and what the platform did each day (invoices uploaded,
// Tonight's Dish runs, support messages, new accounts, job problems).
//
// GET ?month=YYYY-MM
// POST { action: 'note', id?, day, note }                         add or edit one note
// POST { action: 'note-delete', id }
// POST { action: 'event', id?, day, time, end_time, title, details }
// POST { action: 'event-delete', id }
// POST { action: 'time', id?, day, hours, categories, description } log or edit hours worked
// POST { action: 'time-delete', id }

import { adminDb as db, requireAdmin, etDate, addDays, TOUR_RESTAURANT_ID } from '../../../../lib/admin/requireAdmin';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { JOB_BY_KEY } from '../../../../lib/admin/jobRun';

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const today = etDate();
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today.slice(0, 7);
      const first = `${month}-01`;
      const [y, m] = month.split('-').map(Number);
      const last = addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
      const from = addDays(first, -1);
      const to = addDays(last, 2);

      const [notes, events, timeRows, deadlines, touches, follow, runs, invoices, recs, msgs, accounts] = await Promise.all([
        db.from('admin_day_notes').select('id, day, note, created_at').gte('day', first).lte('day', last).order('created_at'),
        db.from('admin_events').select('id, day, time, end_time, title, details').gte('day', first).lte('day', last).order('time', { ascending: true, nullsFirst: true }),
        db.from('admin_time_entries').select('id, day, hours, categories, description').gte('day', first).lte('day', last).order('created_at'),
        db.from('admin_deadlines').select('id, title, due_on, status').gte('due_on', first).lte('due_on', last),
        db.from('sales_touches').select('id, kind, text, happened_on, sales_prospects(id, name)').gte('happened_on', first).lte('happened_on', last).neq('kind', 'Stage'),
        db.from('sales_prospects').select('id, name, next_step, due_on, stage').gte('due_on', first).lte('due_on', last).not('stage', 'in', '("Lost","Live")'),
        db.from('admin_job_runs').select('job, status, summary, started_at').gte('started_at', from).lt('started_at', to).neq('status', 'ok'),
        fetchAll(() => db.from('invoices').select('id, restaurant_id, created_at').eq('is_sample', false).gte('created_at', from).lt('created_at', to).order('id')),
        fetchAll(() => db.from('ai_recommendations').select('id, restaurant_id, generated_date').gte('generated_date', first).lte('generated_date', last).order('id')),
        fetchAll(() => db.from('support_messages').select('id, created_at').eq('direction', 'in').gte('created_at', from).lt('created_at', to).order('id')),
        db.from('restaurants').select('id, name, created_at').gte('created_at', from).lt('created_at', to),
      ]);

      const days = {};
      const day = (d) => (days[d] = days[d] || { notes: [], events: [], time: [], hours: 0, deadlines: [], sales: [], activity: [] });
      const inMonth = (d) => d >= first && d <= last;
      for (const n of notes.data || []) day(n.day).notes.push({ id: n.id, note: n.note });
      for (const e of events.data || []) day(e.day).events.push(e);
      for (const t of timeRows.data || []) {
        const x = day(t.day);
        x.time.push({ ...t, hours: Number(t.hours) });
        x.hours = Math.round((x.hours + Number(t.hours)) * 100) / 100;
      }
      for (const d of deadlines.data || []) day(d.due_on).deadlines.push({ id: d.id, title: d.title, done: d.status === 'done' });
      for (const t of touches.data || []) day(t.happened_on).sales.push({ id: t.id, text: `${t.kind} · ${t.sales_prospects?.name || 'Prospect'}`, detail: t.text, prospect: t.sales_prospects?.id || null });
      for (const p of follow.data || []) day(p.due_on).sales.push({ id: `due-${p.id}`, text: `Follow up · ${p.name}`, detail: p.next_step || '', prospect: p.id, due: true });

      const count = (rows, key) => {
        const c = new Map();
        for (const r of rows) {
          if (r.restaurant_id === TOUR_RESTAURANT_ID) continue;
          const d = key(r);
          if (inMonth(d)) c.set(d, (c.get(d) || 0) + 1);
        }
        return c;
      };
      for (const r of runs.data || []) {
        const d = etDate(new Date(r.started_at));
        if (inMonth(d)) day(d).activity.push({ text: `${JOB_BY_KEY.get(r.job)?.name || r.job} ${r.status === 'failed' ? 'failed' : 'had problems'}: ${r.summary}`, tone: 'bad' });
      }
      for (const [d, n] of count(invoices, (r) => etDate(new Date(r.created_at)))) day(d).activity.push({ text: `${n} invoice${n === 1 ? '' : 's'} uploaded` });
      for (const [d, n] of count(recs, (r) => r.generated_date)) day(d).activity.push({ text: `Tonight’s Dish ran for ${n} restaurant${n === 1 ? '' : 's'}` });
      for (const [d, n] of count(msgs, (r) => etDate(new Date(r.created_at)))) day(d).activity.push({ text: `${n} support message${n === 1 ? '' : 's'} came in` });
      for (const r of accounts.data || []) {
        const d = etDate(new Date(r.created_at));
        if (inMonth(d) && r.id !== TOUR_RESTAURANT_ID) day(d).activity.push({ text: `New account: ${r.name}` });
      }

      return res.status(200).json({ today, month, first, last, days });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'note') {
      const note = String(b.note || '').trim();
      if (!isDay(b.day) || !note) return res.status(400).json({ error: 'A day and a note are needed' });
      const now = new Date().toISOString();
      const q = b.id
        ? db.from('admin_day_notes').update({ note, updated_at: now }).eq('id', b.id)
        : db.from('admin_day_notes').insert({ day: b.day, note, updated_at: now });
      const { error } = await q;
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'note-delete') {
      const { error } = await db.from('admin_day_notes').delete().eq('id', b.id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'event') {
      const title = String(b.title || '').trim();
      const hm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v).padStart(5, '0') : null);
      const time = hm(b.time);
      const endTime = time ? hm(b.end_time) : null;
      if (!isDay(b.day) || !title) return res.status(400).json({ error: 'A day and a title are needed' });
      if (endTime && endTime <= time) return res.status(400).json({ error: 'The end time is before the start' });
      const row = { day: b.day, time, end_time: endTime, title, details: String(b.details || '').trim() || null };
      const q = b.id ? db.from('admin_events').update(row).eq('id', b.id) : db.from('admin_events').insert(row);
      const { error } = await q;
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'event-delete') {
      const { error } = await db.from('admin_events').delete().eq('id', b.id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'time') {
      const hours = Math.round(Number(b.hours) * 100) / 100;
      if (!isDay(b.day) || !(hours > 0 && hours <= 24)) return res.status(400).json({ error: 'Hours must be more than 0 and at most 24' });
      const row = {
        day: b.day,
        hours,
        categories: Array.isArray(b.categories)
          ? [...new Set(b.categories.map((c) => String(c).trim()).filter(Boolean))].slice(0, 10)
          : [],
        description: String(b.description || '').trim() || null,
        updated_at: new Date().toISOString(),
      };
      const q = b.id ? db.from('admin_time_entries').update(row).eq('id', b.id) : db.from('admin_time_entries').insert(row);
      const { error } = await q;
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'time-delete') {
      const { error } = await db.from('admin_time_entries').delete().eq('id', b.id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/sales/calendar]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}