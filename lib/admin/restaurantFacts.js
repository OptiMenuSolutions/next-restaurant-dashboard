// lib/admin/restaurantFacts.js
// One place that works out, for each restaurant: its status (Live, Setting
// up, Needs help, Demo, Closed), its five setup steps, its health dot and the
// reasons behind it, and the numbers the Restaurants list shows. The list and
// the restaurant page both call this, so they never disagree.

import { TOUR_RESTAURANT_ID, etDate, etHour, addDays } from './requireAdmin';
import { healthFor } from './health';
import { fetchAll } from './fetchAll';
import { loadRestaurantReporting, readRestaurantReportRows } from './restaurantReporting.js';

export const STEP_NAMES = ['Menu parsed', 'First invoice', 'POS connected', 'Tags placed', 'Scanner added'];
const DAY = 86400000;
// Tonight's Dish saves a stand-in title when it had nothing to pick from.
const realPick = (t) => (!t || /^(no (dishes|recommendations?|menu)|unavailable)\b/i.test(String(t).trim()) ? 'No picks' : t);

const ordered = (q) => q.order('id', { ascending: true });

// ids: an array to load just those restaurants, or null for all of them.
export async function loadRestaurantFacts(db, ids = null, { now = new Date() } = {}) {
  const scope = (q) => (ids ? q.in('restaurant_id', ids) : q);
  // Keep the existing briefing schedule checks on their Eastern clock.
  const today = etDate(now);
  const hourET = etHour(now);
  const restaurants = await readRestaurantReportRows(() => {
    let query = db.from('restaurants').select('*');
    if (ids) query = query.in('id', ids);
    return query.order('id');
  }, 'restaurants');

  const [profiles, conns, invoices, menu, scanners, tags, recs, reports] = await Promise.all([
    scope(db.from('profiles').select('id, email, full_name, role, restaurant_id')),
    scope(db.from('pos_connections').select('restaurant_id, provider, status, last_synced_at, last_error, updated_at')),
    fetchAll(() => ordered(scope(db.from('invoices').select('id, restaurant_id, created_at, reviewed').eq('is_sample', false)))),
    fetchAll(() => ordered(scope(db.from('menu_items').select('id, restaurant_id').is('archived_at', null)))),
    scope(db.from('restaurant_scanners').select('id, restaurant_id, name, joined_at, last_seen_at')),
    scope(db.from('nfc_tags').select('id, restaurant_id, code, label, spot, status, tap_count, last_tap_at')),
    fetchAll(() => scope(db.from('ai_recommendations').select('restaurant_id, generated_date, recommendations').gte('generated_date', addDays(today, -60))).order('restaurant_id').order('generated_date')),
    loadRestaurantReporting(db, restaurants, { now }),
  ]);

  const group = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      if (!m.has(r.restaurant_id)) m.set(r.restaurant_id, []);
      m.get(r.restaurant_id).push(r);
    }
    return m;
  };
  const P = group(profiles.data), C = group(conns.data), I = group(invoices), M = group(menu);
  const S = group(scanners.data), T = group(tags.data), R = group(recs);

  return restaurants.map((r) => {
    const report = reports.get(r.id);
    const people = (P.get(r.id) || []).filter((p) => p.role !== 'admin');
    const owner = people[0] || null;
    const conn = (C.get(r.id) || [])[0] || null;
    const inv = (I.get(r.id) || []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const lastInvoice = inv.length ? inv[inv.length - 1].created_at : null;
    const unreviewed = inv.filter((i) => i.reviewed === false);
    const menuCount = (M.get(r.id) || []).length;
    const scannerList = S.get(r.id) || [];
    const tagList = T.get(r.id) || [];
    const recRows = (R.get(r.id) || []).sort((a, b) => (a.generated_date < b.generated_date ? 1 : -1));
    const lastRec = recRows[0] || null;
    const hasDishToday = recRows.some((x) => x.generated_date === today);

    // Restaurant-local days, oldest first; the final bucket is today.
    const views = report.views;

    const setup = [
      menuCount > 0,
      inv.length > 0,
      conn?.status === 'connected',
      tagList.some((t) => t.spot),
      scannerList.length > 0,
    ];
    const setupDone = setup.filter(Boolean).length;
    const nextStep = setup.indexOf(false);

    const closed = !!r.deactivated_at;
    const demo = r.id === TOUR_RESTAURANT_ID;
    const live = !closed && !demo && (['active', 'trialing'].includes(r.subscription_status) || recRows.some((x) => x.generated_date >= addDays(today, -7)));
    const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / DAY);

    // Health. The Dish check only applies once a restaurant is live.
    let health = { level: 'gray', reasons: [closed ? 'Closed account' : 'Internal demo account'] };
    if (!closed && !demo) {
      health = healthFor(r, { conn, hasDishToday: live ? hasDishToday : true, oldestUnreviewed: unreviewed[0]?.created_at || null, hourET });
      if (!live && nextStep !== -1 && ageDays >= 7) {
        health.reasons.push(`Setup stalled at “${STEP_NAMES[nextStep].toLowerCase()}”`);
        if (health.level === 'green') health.level = 'amber';
      }
    }

    let status = 'SETTING UP';
    if (closed) status = 'CLOSED';
    else if (demo) status = 'DEMO';
    else if (live) status = 'LIVE';
    else if (health.level === 'red' || (ageDays >= 14 && setupDone < 3)) status = 'NEEDS HELP';

    const activeTag = tagList.find((t) => t.status === 'active') || null;

    return {
      id: r.id,
      name: r.name || 'Unnamed restaurant',
      town: [r.shipping_city || r.city || r.town || r.location, r.shipping_state].filter(Boolean).join(', '),
      address: { line1: r.shipping_address_line1 || '', city: r.shipping_city || '', state: r.shipping_state || '', zip: r.shipping_zip || '' },
      created_at: r.created_at,
      deactivated_at: r.deactivated_at || null,
      subscription_status: r.subscription_status || null,
      stripe_customer_id: r.stripe_customer_id || null,
      stripe_subscription_id: r.stripe_subscription_id || null,
      target_food_cost: r.target_food_cost ?? null,
      owner: owner ? { name: owner.full_name || owner.email, email: owner.email } : null,
      people: people.map((p) => ({ name: p.full_name || p.email, email: p.email })),
      scanners: scannerList.map((s) => ({ name: s.name, joined_at: s.joined_at, last_seen_at: s.last_seen_at })),
      tags: tagList.map((t) => ({ label: t.label, spot: t.spot, status: t.status, taps: t.tap_count, last_tap_at: t.last_tap_at })),
      staffLink: activeTag ? `/t/${activeTag.code}` : null,
      conn: conn ? { provider: conn.provider, status: conn.status, last_synced_at: conn.last_synced_at, last_error: conn.last_error } : null,
      invoiceCount: inv.length,
      unreviewedCount: unreviewed.length,
      lastInvoice,
      menuCount,
      lastDish: lastRec ? { title: realPick(lastRec.recommendations?.[0]?.title), date: lastRec.generated_date } : null,
      hasDishToday,
      views,
      reportingToday: report.today,
      reportingError: report.error,
      setup,
      setupDone,
      nextStep: nextStep === -1 ? null : STEP_NAMES[nextStep],
      live,
      status,
      health,
      sales: report.sales,
    };
  });
}