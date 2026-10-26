// pages/api/admin/recipe-restaurants.js
// GET  the restaurants list for /admin/recipes, with each one's recipe setup
//      status. Open follow-ups first.

import { adminDb as db, requireAdmin } from '../../../lib/admin/requireAdmin';

const TOUR_SAMPLE = '00000000-0000-0000-0000-000000000001';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const [restaurants, workspaces] = await Promise.all([
    db.from('restaurants')
      .select('id, name, created_at, deactivated_at')
      .neq('id', TOUR_SAMPLE)
      .order('name'),
    db.from('recipe_workspaces')
      .select('restaurant_id, updated_at, assistance:state->>assistance, method:state->>method'),
  ]);

  if (restaurants.error) return res.status(500).json({ error: restaurants.error.message });
  if (workspaces.error) return res.status(500).json({ error: workspaces.error.message });

  const byId = new Map((workspaces.data || []).map((w) => [w.restaurant_id, w]));

  const rows = (restaurants.data || []).map((r) => {
    const w = byId.get(r.id);
    return {
      id: r.id,
      name: r.name || 'Unnamed restaurant',
      closed: !!r.deactivated_at,
      method: w?.method || null,
      followUp: w?.assistance === 'requested',
      updated_at: w?.updated_at || null,
    };
  });

  rows.sort((a, b) =>
    (b.followUp - a.followUp) ||
    String(b.updated_at || '').localeCompare(String(a.updated_at || '')) ||
    a.name.localeCompare(b.name)
  );

  return res.status(200).json({ restaurants: rows });
}