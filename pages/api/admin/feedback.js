// pages/api/admin/feedback.js
// GET and PATCH for user feedback submissions.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const [{ data: feedback }, { data: restaurants }] = await Promise.all([
        supabase
          .from('feedback')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('restaurants').select('id, name'),
      ]);

      const restaurantMap = {};
      for (const r of restaurants || []) restaurantMap[r.id] = r.name;

      const enriched = (feedback || []).map(f => ({
        ...f,
        restaurant_name: restaurantMap[f.restaurant_id] || null,
      }));

      const stats = {
        total:    enriched.length,
        new:      enriched.filter(f => f.status === 'new').length,
        reviewed: enriched.filter(f => f.status === 'reviewed').length,
        resolved: enriched.filter(f => f.status === 'resolved').length,
      };

      return res.status(200).json({ feedback: enriched, stats });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    try {
      const { data, error } = await supabase
        .from('feedback')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ feedback: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
});