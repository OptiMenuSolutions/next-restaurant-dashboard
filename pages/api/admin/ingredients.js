// pages/api/admin/ingredients.js
// CRUD for the global ingredients library used by the menu parser.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  // ── GET — list all ────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('global_ingredients')
        .select('*')
        .order('name');

      if (error) throw error;

      const unitMap = {};
      for (const ing of data || []) {
        unitMap[ing.unit] = (unitMap[ing.unit] || 0) + 1;
      }

      return res.status(200).json({
        ingredients: data || [],
        stats: {
          total: data?.length || 0,
          units: Object.entries(unitMap)
            .map(([unit, count]) => ({ unit, count }))
            .sort((a, b) => b.count - a.count),
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — create ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, unit } = req.body;
    if (!name || !unit) return res.status(400).json({ error: 'name and unit are required' });

    try {
      const { data, error } = await supabase
        .from('global_ingredients')
        .insert({ name: name.trim(), unit: unit.trim() })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ ingredient: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT — update ──────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, name, unit } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
      const updates = {};
      if (name) updates.name = name.trim();
      if (unit) updates.unit = unit.trim();

      const { data, error } = await supabase
        .from('global_ingredients')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ ingredient: data });
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
        .from('global_ingredients')
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