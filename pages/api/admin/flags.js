// pages/api/admin/flags.js
// CRUD for feature flags.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  // ── GET — list all flags ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('*')
        .order('label');

      if (error) throw error;
      return res.status(200).json({ flags: data || [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT — toggle or update a flag ─────────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, enabled, label, description } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
      const updates = { updated_at: new Date().toISOString() };
      if (enabled !== undefined) updates.enabled = enabled;
      if (label       !== undefined) updates.label = label;
      if (description !== undefined) updates.description = description;

      const { data, error } = await supabase
        .from('feature_flags')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ flag: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — create a new flag ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { key, label, description, enabled } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'key and label are required' });

    try {
      const { data, error } = await supabase
        .from('feature_flags')
        .insert({
          key:         key.trim().toLowerCase().replace(/\s+/g, '_'),
          label:       label.trim(),
          description: description?.trim() || null,
          enabled:     enabled ?? false,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ flag: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
      const { error } = await supabase
        .from('feature_flags')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
});