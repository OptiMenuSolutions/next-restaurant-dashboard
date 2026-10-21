// pages/api/admin/restaurant-list.js
// The Restaurants list: every restaurant with its status, setup steps,
// health dot, POS, last invoice, last Tonight's Dish, staff page views for
// the last 7 days, plan and last month's sales from its POS.

import { adminDb as db, requireAdmin } from '../../../lib/admin/requireAdmin';
import { loadRestaurantFacts, lastMonthRange } from '../../../lib/admin/restaurantFacts';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const facts = await loadRestaurantFacts(db, null);
    const order = { 'NEEDS HELP': 0, LIVE: 1, 'SETTING UP': 2, DEMO: 3, CLOSED: 4 };
    facts.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    return res.status(200).json({ restaurants: facts, salesMonth: lastMonthRange().label });
  } catch (err) {
    console.error('[admin/restaurant-list]', err);
    return res.status(500).json({ error: 'Could not load restaurants' });
  }
}