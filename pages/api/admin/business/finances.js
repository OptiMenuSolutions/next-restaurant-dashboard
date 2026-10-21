// pages/api/admin/business/finances.js
// Expenses & deadlines for OptiMenu Solutions LLC.
//
// GET ?year=YYYY  -> that year's expenses, every deadline, and the numbers
//                    up top (this month, run rate, year to date, next deadline)
// POST { action: 'expense-save', id?, spent_on, vendor, category, repeats, amount, note, receipt_path }
// POST { action: 'expense-delete', id }
// POST { action: 'receipt-upload', name }  -> { path, token } for a signed upload
// POST { action: 'receipt-view', id }      -> { url } good for 10 minutes
// POST { action: 'deadline-save', id?, title, note, due_on, repeats }
// POST { action: 'deadline-done', id }     a repeating one adds the next date
// POST { action: 'deadline-reopen', id }
// POST { action: 'deadline-delete', id }
//
// Receipts live in the private admin-receipts storage bucket.

import { adminDb as db, requireAdmin, etDate, addDays } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';

const BUCKET = 'admin-receipts';
const REPEATS = ['one_time', 'monthly', 'yearly', 'usage'];
const DL_REPEATS = ['none', 'monthly', 'yearly'];

function nextDate(date, repeats) {
  const [y, m, d] = date.split('-').map(Number);
  const t = repeats === 'yearly' ? new Date(Date.UTC(y + 1, m - 1, d)) : new Date(Date.UTC(y, m, d));
  return t.toISOString().slice(0, 10);
}

// Recurring cost per month: latest monthly amount per vendor, latest yearly
// amount per vendor divided by 12, and last month's usage bills.
function runRate(all, today) {
  const latest = new Map();
  for (const e of [...all].sort((a, b) => a.spent_on.localeCompare(b.spent_on))) {
    if (e.repeats === 'monthly' || e.repeats === 'yearly') latest.set(`${e.repeats}|${e.vendor.toLowerCase()}`, e);
  }
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const items = [...latest.values()].map((e) => ({ vendor: e.vendor, category: e.category, perMonth: e.repeats === 'yearly' ? Number(e.amount) / 12 : Number(e.amount), repeats: e.repeats }));
  const usage = new Map();
  for (const e of all) if (e.repeats === 'usage' && e.spent_on.slice(0, 7) === lastMonth) usage.set(e.vendor.toLowerCase(), { vendor: e.vendor, category: e.category, perMonth: (usage.get(e.vendor.toLowerCase())?.perMonth || 0) + Number(e.amount), repeats: 'usage' });
  return [...items, ...usage.values()];
}

async function load(year) {
  const today = etDate();
  const [{ data: exp, error }, { data: dls }, { data: recent }] = await Promise.all([
    db.from('admin_expenses').select('*').gte('spent_on', `${year}-01-01`).lte('spent_on', `${year}-12-31`).order('spent_on', { ascending: false }),
    db.from('admin_deadlines').select('*').order('due_on', { ascending: true, nullsFirst: false }),
    db.from('admin_expenses').select('vendor, category, repeats, amount, spent_on').gte('spent_on', addDays(today, -400)),
  ]);
  if (error) throw new Error(error.message);
  const month = today.slice(0, 7);
  const thisMonth = (exp || []).filter((e) => e.spent_on.slice(0, 7) === month);
  const rate = runRate(recent || [], today);
  const open = (dls || []).filter((d) => d.status !== 'done');
  const next = open.find((d) => d.due_on) || open[0] || null;
  return {
    today, year,
    expenses: (exp || []).map((e) => ({ ...e, amount: Number(e.amount), has_receipt: !!e.receipt_path })),
    deadlines: dls || [],
    month,
    spentMonth: thisMonth.reduce((a, e) => a + Number(e.amount), 0),
    countMonth: thisMonth.length,
    missingMonth: thisMonth.filter((e) => !e.receipt_path).length,
    ytd: (exp || []).filter((e) => year === today.slice(0, 4) ? e.spent_on <= today : true).reduce((a, e) => a + Number(e.amount), 0),
    runRate: rate,
    next,
  };
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const log = (action) => writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action });

  try {
    if (req.method === 'GET') {
      const year = /^\d{4}$/.test(String(req.query.year || '')) ? String(req.query.year) : etDate().slice(0, 4);
      return res.status(200).json(await load(year));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'expense-save') {
      const amount = Number(String(b.amount ?? '').replace(/[$,]/g, ''));
      const row = {
        spent_on: String(b.spent_on || '').slice(0, 10),
        vendor: String(b.vendor || '').trim(),
        category: String(b.category || 'Other').trim() || 'Other',
        repeats: REPEATS.includes(b.repeats) ? b.repeats : 'one_time',
        amount,
        note: String(b.note || '').trim() || null,
        receipt_path: b.receipt_path || null,
      };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.spent_on) || !row.vendor || !(amount >= 0)) return res.status(400).json({ error: 'Date, vendor and amount are needed' });
      const q = b.id ? db.from('admin_expenses').update(row).eq('id', b.id) : db.from('admin_expenses').insert(row);
      const { error } = await q;
      if (error) throw new Error(error.message);
      await log(`${b.id ? 'Edited' : 'Added'} expense ${row.vendor} $${amount.toFixed(2)}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'expense-delete') {
      const { data: e } = await db.from('admin_expenses').select('id, vendor, amount, receipt_path').eq('id', b.id).single();
      if (!e) return res.status(404).json({ error: 'Not found' });
      if (e.receipt_path) await db.storage.from(BUCKET).remove([e.receipt_path]);
      await db.from('admin_expenses').delete().eq('id', e.id);
      await log(`Deleted expense ${e.vendor} $${Number(e.amount).toFixed(2)}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'receipt-upload') {
      const safe = String(b.name || 'receipt').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
      const path = `${etDate().slice(0, 7)}/${Date.now()}-${safe}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw new Error(error.message);
      return res.status(200).json({ path: data.path, token: data.token });
    }

    if (b.action === 'receipt-view') {
      const { data: e } = await db.from('admin_expenses').select('receipt_path').eq('id', b.id).single();
      if (!e?.receipt_path) return res.status(404).json({ error: 'No receipt' });
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(e.receipt_path, 600);
      if (error) throw new Error(error.message);
      return res.status(200).json({ url: data.signedUrl });
    }

    if (b.action === 'deadline-save') {
      const row = {
        title: String(b.title || '').trim(),
        note: String(b.note || '').trim() || null,
        due_on: /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_on || '')) ? b.due_on : null,
        repeats: DL_REPEATS.includes(b.repeats) ? b.repeats : 'none',
      };
      if (!row.title) return res.status(400).json({ error: 'Give the deadline a name' });
      if (row.repeats !== 'none' && !row.due_on) return res.status(400).json({ error: 'A repeating deadline needs a date' });
      const q = b.id ? db.from('admin_deadlines').update(row).eq('id', b.id) : db.from('admin_deadlines').insert({ ...row, status: 'open' });
      const { error } = await q;
      if (error) throw new Error(error.message);
      await log(`${b.id ? 'Edited' : 'Added'} deadline ${row.title}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'deadline-done' || b.action === 'deadline-reopen') {
      const { data: d } = await db.from('admin_deadlines').select('*').eq('id', b.id).single();
      if (!d) return res.status(404).json({ error: 'Not found' });
      const done = b.action === 'deadline-done';
      await db.from('admin_deadlines').update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null }).eq('id', d.id);
      let message = done ? `Marked ${d.title} done.` : `Reopened ${d.title}.`;
      if (done && d.repeats !== 'none' && d.due_on) {
        const due = nextDate(d.due_on, d.repeats);
        await db.from('admin_deadlines').insert({ title: d.title, note: d.note, due_on: due, repeats: d.repeats, status: 'open' });
        message += ` The next one is set for ${due}.`;
      }
      await log(`${done ? 'Completed' : 'Reopened'} deadline ${d.title}`);
      return res.status(200).json({ ok: true, message });
    }

    if (b.action === 'deadline-delete') {
      const { data: d } = await db.from('admin_deadlines').select('id, title').eq('id', b.id).single();
      if (!d) return res.status(404).json({ error: 'Not found' });
      await db.from('admin_deadlines').delete().eq('id', d.id);
      await log(`Deleted deadline ${d.title}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/business/finances]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}