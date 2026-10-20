// lib/admin/health.js
// The health dot for a restaurant: green, amber or red, with the reasons.
// Used by Today ("Needs attention") now, and by the Restaurants list and the
// restaurant page once those are rebuilt, so all three always agree.

const DAY = 86400000;

// conn: the restaurant's pos_connections row (or null)
// hasDishToday: Tonight's Dish was generated today
// oldestUnreviewed: created_at of its oldest unreviewed invoice (or null)
// hourET: current hour in Eastern time
export function healthFor(r, { conn, hasDishToday, oldestUnreviewed, hourET }) {
  const red = [];
  const amber = [];

  if (r.subscription_status === 'past_due' || r.subscription_status === 'unpaid') red.push('Payment failed');
  if (conn?.status === 'error') red.push('POS sync failing');
  if (conn?.status === 'disconnected') red.push('POS disconnected');

  if (conn?.status === 'connected' && conn.last_synced_at) {
    const days = Math.floor((Date.now() - new Date(conn.last_synced_at).getTime()) / DAY);
    if (days >= 2) amber.push(`POS last synced ${days} days ago`);
  }
  // The Dish job runs at 7 AM Eastern. Give it an hour before flagging.
  if (!hasDishToday && hourET >= 8) amber.push('No Tonight’s Dish today');
  if (oldestUnreviewed && Date.now() - new Date(oldestUnreviewed).getTime() > 3 * DAY) amber.push('Invoices waiting over 3 days');

  if (red.length) return { level: 'red', reasons: [...red, ...amber] };
  if (amber.length) return { level: 'amber', reasons: amber };
  return { level: 'green', reasons: [] };
}