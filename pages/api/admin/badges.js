// pages/api/admin/badges.js
// Open to-dos per section, for the small counts on the admin section pills.
// Reads the saved rail (admin_tickets) only, so it is quick; Today keeps the
// rail itself up to date.

import { adminDb as db, requireAdmin } from '../../../lib/admin/requireAdmin';

const SECTION = {
  JOB: 'Platform',
  BILLING: 'Restaurants',
  SUPPORT: 'Restaurants',
  REVIEW: 'Data quality',
  COSTS: 'Data quality',
  SALES: 'Sales',
  DEADLINE: 'Business',
  BOOKS: 'Business',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { data, error } = await db.from('admin_tickets').select('kind').eq('status', 'open');
  if (error) return res.status(500).json({ error: error.message });
  const badges = {};
  for (const t of data || []) {
    const s = SECTION[t.kind];
    if (s) badges[s] = (badges[s] || 0) + 1;
  }
  return res.status(200).json({ badges });
}