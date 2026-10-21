// pages/api/admin/business/settings.js
// Settings: your business numbers (admin_settings), feature switches
// (feature_flags), saved replies for the Support inbox, who has admin
// access, and the audit log.
//
// GET
// POST { action: 'save-settings', values: { key: value } }   empty clears to the default
// POST { action: 'flag-toggle', id, enabled }
// POST { action: 'flag-save', id?, key, label, description }
// POST { action: 'flag-delete', id }
// POST { action: 'reply-save', id?, label, body }
// POST { action: 'reply-delete', id }

import { adminDb as db, requireAdmin } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { getSettings, SETTING_DEFAULTS } from '../../../../lib/admin/settings';

const TEXT_KEYS = new Set(['ship_from']);

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const log = (action) => writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action });

  try {
    if (req.method === 'GET') {
      const [settings, { data: stored }, flags, replies, admins, audit] = await Promise.all([
        getSettings(db),
        db.from('admin_settings').select('key, updated_at'),
        db.from('feature_flags').select('*').order('label'),
        db.from('admin_saved_replies').select('id, label, body, used_count, sort').order('sort').order('created_at'),
        db.from('profiles').select('id, full_name, email').eq('role', 'admin'),
        db.from('admin_audit_log').select('id, created_at, admin_name, action, target_restaurant_name, reason').order('created_at', { ascending: false }).limit(400),
      ]);
      return res.status(200).json({
        settings,
        setKeys: (stored || []).map((s) => s.key),
        flags: flags.data || [], flagsError: flags.error?.message || null,
        replies: replies.data || [],
        admins: admins.data || [],
        audit: audit.data || [],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'save-settings') {
      const changed = [];
      for (const [key, raw] of Object.entries(b.values || {})) {
        if (!(key in SETTING_DEFAULTS) && key !== 'ai_daily_alert') continue;
        const blank = raw === '' || raw == null;
        if (blank) {
          await db.from('admin_settings').delete().eq('key', key);
          changed.push(`${key} cleared`);
          continue;
        }
        let value = raw;
        if (!TEXT_KEYS.has(key)) {
          value = Number(String(raw).replace(/[$,]/g, ''));
          if (!(value >= 0)) return res.status(400).json({ error: `${key.replace(/_/g, ' ')} must be a number` });
        } else value = String(raw).trim();
        const { error } = await db.from('admin_settings').upsert({ key, value, updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
        changed.push(`${key} = ${value}`);
      }
      if (changed.length) await log(`Changed settings: ${changed.join(', ')}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'flag-toggle') {
      const { data: f, error } = await db.from('feature_flags').update({ enabled: !!b.enabled, updated_at: new Date().toISOString() }).eq('id', b.id).select('label').single();
      if (error) throw new Error(error.message);
      await log(`Turned ${b.enabled ? 'on' : 'off'} ${f.label}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'flag-save') {
      const row = { key: String(b.key || '').trim(), label: String(b.label || '').trim(), description: String(b.description || '').trim() || null, updated_at: new Date().toISOString() };
      if (!row.key || !row.label) return res.status(400).json({ error: 'Key and name are needed' });
      const q = b.id ? db.from('feature_flags').update(row).eq('id', b.id) : db.from('feature_flags').insert({ ...row, enabled: false });
      const { error } = await q;
      if (error) throw new Error(error.message);
      await log(`${b.id ? 'Edited' : 'Added'} feature switch ${row.label}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'flag-delete') {
      const { data: f } = await db.from('feature_flags').select('id, label').eq('id', b.id).single();
      if (!f) return res.status(404).json({ error: 'Not found' });
      await db.from('feature_flags').delete().eq('id', f.id);
      await log(`Deleted feature switch ${f.label}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'reply-save') {
      const row = { label: String(b.label || '').trim(), body: String(b.body || '').trim() };
      if (!row.label || !row.body) return res.status(400).json({ error: 'A button label and reply text are needed' });
      let q;
      if (b.id) q = db.from('admin_saved_replies').update(row).eq('id', b.id);
      else {
        const { data: last } = await db.from('admin_saved_replies').select('sort').order('sort', { ascending: false }).limit(1);
        q = db.from('admin_saved_replies').insert({ ...row, sort: (last?.[0]?.sort || 0) + 1 });
      }
      const { error } = await q;
      if (error) throw new Error(error.message);
      await log(`${b.id ? 'Edited' : 'Added'} saved reply ${row.label}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'reply-delete') {
      const { data: r } = await db.from('admin_saved_replies').select('id, label').eq('id', b.id).single();
      if (!r) return res.status(404).json({ error: 'Not found' });
      await db.from('admin_saved_replies').delete().eq('id', r.id);
      await log(`Deleted saved reply ${r.label}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/business/settings]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}