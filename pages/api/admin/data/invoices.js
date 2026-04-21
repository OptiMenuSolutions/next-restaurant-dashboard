// pages/api/admin/data/invoices.js
// Returns all invoices across all restaurants with restaurant context.

import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [
      { data: invoices },
      { data: restaurants },
    ] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, restaurant_id, supplier, number, date, amount, parse_status, confidence_score, file_url, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('restaurants').select('id, name'),
    ]);

    const restaurantMap = {};
    for (const r of restaurants || []) restaurantMap[r.id] = r.name;

    const enriched = (invoices || []).map(inv => ({
      ...inv,
      restaurant_name: restaurantMap[inv.restaurant_id] || 'Unknown',
    }));

    // Summary stats
    const total        = enriched.length;
    const completed    = enriched.filter(i => i.parse_status === 'completed').length;
    const failed       = enriched.filter(i => i.parse_status === 'failed').length;
    const pending      = enriched.filter(i => i.parse_status === 'pending' || !i.parse_status).length;
    const totalValue   = enriched.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    const avgConfidence = completed > 0
      ? enriched.filter(i => i.confidence_score).reduce((s, i) => s + parseFloat(i.confidence_score || 0), 0) / completed
      : null;

    // This week
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thisWeek = enriched.filter(i => i.created_at >= weekAgo).length;

    return res.status(200).json({
      invoices: enriched,
      stats: {
        total,
        completed,
        failed,
        pending,
        thisWeek,
        totalValue: Math.round(totalValue * 100) / 100,
        avgConfidence: avgConfidence ? Math.round(avgConfidence * 10) / 10 : null,
        successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    });

  } catch (err) {
    console.error('[invoices data API] Error:', err);
    return res.status(500).json({ error: 'Failed to load invoices' });
  }
});