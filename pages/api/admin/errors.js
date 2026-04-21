// pages/api/admin/errors.js
// GET and PATCH for the error queue.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const [{ data: errors }, { data: restaurants }] = await Promise.all([
        supabase
          .from('error_queue')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('restaurants').select('id, name'),
      ]);

      const restaurantMap = {};
      for (const r of restaurants || []) restaurantMap[r.id] = r.name;

      const enriched = (errors || []).map(e => ({
        ...e,
        restaurant_name: restaurantMap[e.restaurant_id] || null,
      }));

      const stats = {
        total:         enriched.length,
        open:          enriched.filter(e => e.status === 'open').length,
        investigating: enriched.filter(e => e.status === 'investigating').length,
        resolved:      enriched.filter(e => e.status === 'resolved').length,
      };

      // Group by feature
      const byFeature = {};
      for (const e of enriched.filter(e => e.status === 'open')) {
        byFeature[e.feature] = (byFeature[e.feature] || 0) + 1;
      }
      const featureBreakdown = Object.entries(byFeature)
        .map(([feature, count]) => ({ feature, count }))
        .sort((a, b) => b.count - a.count);

      return res.status(200).json({ errors: enriched, stats, featureBreakdown });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    try {
      const { data, error } = await supabase
        .from('error_queue')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ error: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
});