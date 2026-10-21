// pages/api/admin/sales/pipeline.js
// Sales pipeline: prospects, their stage, next step and follow-up date, and
// every touch (call, email, visit, demo, text).
//
// GET
// POST { action: 'save', id?, ...fields }            add or edit a prospect
// POST { action: 'move', id, stage }                 any stage except Lost
// POST { action: 'lost', id, reason, note }
// POST { action: 'touch', id, kind, text, happened_on, next_step, due_on }
// POST { action: 'delete', id }

import { adminDb as db, requireAdmin, etDate } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';

const STAGES = ['Lead', 'Contacted', 'Demo done', 'Setting up', 'Live', 'Lost'];
const KINDS = ['Call', 'Email', 'Visit', 'Demo', 'Text'];
const FIELDS = ['name', 'town', 'state', 'type', 'pos', 'source', 'contact', 'phone', 'email', 'seats', 'covers', 'pain', 'referred', 'notes', 'next_step', 'due_on', 'restaurant_id'];

const clean = (b) => {
  const row = {};
  for (const k of FIELDS) {
    if (!(k in b)) continue;
    const v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    row[k] = v === '' ? null : v;
  }
  if ('due_on' in row && row.due_on && !/^\d{4}-\d{2}-\d{2}$/.test(row.due_on)) row.due_on = null;
  if (row.state) row.state = String(row.state).toUpperCase().slice(0, 2);
  return row;
};

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const log = (action) => writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action });

  try {
    if (req.method === 'GET') {
      const [{ data: prospects, error }, { data: touches }, { data: rest }] = await Promise.all([
        db.from('sales_prospects').select('*').order('created_at', { ascending: true }),
        db.from('sales_touches').select('id, prospect_id, kind, text, happened_on, created_at').order('happened_on', { ascending: false }).order('created_at', { ascending: false }),
        db.from('restaurants').select('id, name').is('deactivated_at', null).order('name'),
      ]);
      if (error) throw new Error(error.message);
      const byP = new Map();
      for (const t of touches || []) {
        if (!byP.has(t.prospect_id)) byP.set(t.prospect_id, []);
        byP.get(t.prospect_id).push(t);
      }
      return res.status(200).json({
        today: etDate(),
        prospects: (prospects || []).map((p) => ({ ...p, touches: byP.get(p.id) || [] })),
        restaurants: rest || [],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};
    const now = new Date().toISOString();

    if (b.action === 'save') {
      const row = clean(b);
      if (!b.id && !row.name) return res.status(400).json({ error: 'Give the restaurant a name' });
      if (b.id) {
        const { error } = await db.from('sales_prospects').update({ ...row, updated_at: now }).eq('id', b.id);
        if (error) throw new Error(error.message);
        return res.status(200).json({ ok: true, id: b.id });
      }
      const { data, error } = await db.from('sales_prospects').insert({ ...row, stage: 'Lead', stage_changed_at: now }).select('id').single();
      if (error) throw new Error(error.message);
      await log(`Added prospect ${row.name}`);
      return res.status(200).json({ ok: true, id: data.id });
    }

    const { data: p } = b.id ? await db.from('sales_prospects').select('id, name, stage').eq('id', b.id).single() : { data: null };
    if (!p) return res.status(404).json({ error: 'Prospect not found' });

    if (b.action === 'move') {
      if (!STAGES.includes(b.stage) || b.stage === 'Lost') return res.status(400).json({ error: 'Pick a stage' });
      const { error } = await db.from('sales_prospects').update({ stage: b.stage, stage_changed_at: now, lost_reason: null, lost_note: null, lost_at: null, updated_at: now }).eq('id', p.id);
      if (error) throw new Error(error.message);
      await db.from('sales_touches').insert({ prospect_id: p.id, kind: 'Stage', text: `Moved from ${p.stage} to ${b.stage}`, happened_on: etDate() });
      await log(`Moved ${p.name} to ${b.stage}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'lost') {
      const reason = String(b.reason || '').trim() || 'Other';
      const { error } = await db.from('sales_prospects').update({ stage: 'Lost', stage_changed_at: now, lost_reason: reason, lost_note: String(b.note || '').trim() || null, lost_at: now, due_on: null, updated_at: now }).eq('id', p.id);
      if (error) throw new Error(error.message);
      await db.from('sales_touches').insert({ prospect_id: p.id, kind: 'Stage', text: `Lost from ${p.stage}: ${reason}${b.note ? ` (${b.note})` : ''}`, happened_on: etDate() });
      await log(`Marked ${p.name} lost: ${reason}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'touch') {
      const kind = KINDS.includes(b.kind) ? b.kind : 'Call';
      const text = String(b.text || '').trim();
      if (!text) return res.status(400).json({ error: 'Say what happened' });
      const happened = /^\d{4}-\d{2}-\d{2}$/.test(String(b.happened_on || '')) ? b.happened_on : etDate();
      const { error } = await db.from('sales_touches').insert({ prospect_id: p.id, kind, text, happened_on: happened });
      if (error) throw new Error(error.message);
      const patch = { updated_at: now, last_touch_on: happened };
      if ('next_step' in b) patch.next_step = String(b.next_step || '').trim() || null;
      if ('due_on' in b) patch.due_on = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_on || '')) ? b.due_on : null;
      if (p.stage === 'Lead' && kind !== 'Text') patch.stage = 'Contacted';
      if (p.stage !== 'Demo done' && kind === 'Demo' && ['Lead', 'Contacted'].includes(p.stage)) patch.stage = 'Demo done';
      if (patch.stage) patch.stage_changed_at = now;
      await db.from('sales_prospects').update(patch).eq('id', p.id);
      await log(`Logged a ${kind.toLowerCase()} with ${p.name}`);
      return res.status(200).json({ ok: true, moved: patch.stage || null });
    }

    if (b.action === 'delete') {
      await db.from('sales_prospects').delete().eq('id', p.id);
      await log(`Deleted prospect ${p.name}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/sales/pipeline]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}