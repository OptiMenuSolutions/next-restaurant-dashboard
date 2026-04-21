// pages/api/admin/audit.js
// Returns the activity log from the admin_activity table.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [{ data: activity }, { data: restaurants }] = await Promise.all([
      supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('restaurants').select('id, name'),
    ]);

    const restaurantMap = {};
    for (const r of restaurants || []) restaurantMap[r.id] = r.name;

    const enriched = (activity || []).map(a => ({
      ...a,
      restaurant_name: restaurantMap[a.restaurant_id] || null,
    }));

    // Type breakdown
    const typeMap = {};
    for (const a of enriched) {
      typeMap[a.type] = (typeMap[a.type] || 0) + 1;
    }
    const typeBreakdown = Object.entries(typeMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return res.status(200).json({
      activity: enriched,
      total: enriched.length,
      typeBreakdown,
    });
  } catch (err) {
    console.error('[audit API] Error:', err);
    return res.status(500).json({ error: 'Failed to load audit log' });
  }
});