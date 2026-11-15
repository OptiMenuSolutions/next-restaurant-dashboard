import { requireRestaurantTimezone, restaurantLocalDate } from '../restaurantTime.js';
import { dashboardMonth, shiftDashboardDate } from '../dashboardCalendar.js';
import { getInvoiceEffectiveDate } from '../invoiceRepricing.js';

export function restaurantReportContext(restaurant, now = new Date()) {
  if (!restaurant?.id) throw new TypeError('A restaurant ID is required.');
  const timeZone = requireRestaurantTimezone(restaurant.operational_timezone);
  const today = restaurantLocalDate(timeZone, now);
  const current = dashboardMonth(today);
  const previous = dashboardMonth(shiftDashboardDate(current.from, -1));
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${previous.from}T00:00:00.000Z`)).toUpperCase();
  return {
    restaurantId: restaurant.id, timeZone, today,
    days: Array.from({ length: 7 }, (_, i) => shiftDashboardDate(today, i - 6)),
    month: { start: previous.from, end: previous.to, label: `${monthName} ${previous.year}` },
  };
}

export async function readRestaurantReportRows(makeQuery, label) {
  const rows = [];
  for (let from = 0; ; ) {
    const { data, error } = await makeQuery().range(from, from + 499);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Invalid ${label} response.`);
    if (!data.length) return rows;
    rows.push(...data);
    from += data.length;
  }
}

export async function loadRestaurantReporting(db, restaurants, { now = new Date() } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('A valid report timestamp is required.');
  }
  const reports = new Map();
  const contexts = new Map();
  for (const restaurant of restaurants) {
    try {
      const context = restaurantReportContext(restaurant, now);
      contexts.set(restaurant.id, context);
      reports.set(restaurant.id, {
        today: context.today, timeZone: context.timeZone, error: null,
        views: Array(7).fill(0),
        sales: { total: 0, items: 0, rows: 0, month: context.month.label },
      });
    } catch (error) {
      if (!['RESTAURANT_TIMEZONE_REQUIRED', 'RESTAURANT_TIMEZONE_INVALID'].includes(error.code)) throw error;
      reports.set(restaurant.id, {
        today: null, timeZone: null, error: error.message,
        views: Array(7).fill(null),
        sales: { total: null, items: null, rows: null, month: null },
      });
    }
  }

  const ids = [...contexts.keys()];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const selected = chunk.map(id => contexts.get(id));
    const firstMonth = selected.map(context => context.month.start).sort()[0];
    const lastMonth = selected.map(context => context.month.end).sort().at(-1);
    const firstDay = selected.map(context => context.days[0]).sort()[0];
    // Read a conservative UTC envelope, then bucket each instant locally.
    // This includes local midnight across UTC offsets and daylight saving.
    const tapFrom = `${shiftDashboardDate(firstDay, -1)}T00:00:00.000Z`;
    const [sales, taps] = await Promise.all([
      readRestaurantReportRows(() => db.from('pos_sales')
        .select('id, restaurant_id, sale_date, quantity_sold, revenue')
        .in('restaurant_id', chunk).gte('sale_date', firstMonth).lte('sale_date', lastMonth)
        .order('sale_date', { ascending: true }).order('id', { ascending: true }), 'restaurant sales'),
      readRestaurantReportRows(() => db.from('nfc_tag_taps')
        .select('id, restaurant_id, tapped_at')
        .in('restaurant_id', chunk).gte('tapped_at', tapFrom).lte('tapped_at', now.toISOString())
        .order('tapped_at', { ascending: true }).order('id', { ascending: true }), 'staff page views'),
    ]);
    for (const row of sales) {
      if (!chunk.includes(row.restaurant_id)) continue;
      const context = contexts.get(row.restaurant_id);
      const date = getInvoiceEffectiveDate({ date: row.sale_date });
      if (!date || date < context.month.start || date > context.month.end || date > context.today) continue;
      const report = reports.get(row.restaurant_id).sales;
      const revenue = parseFloat(row.revenue || 0);
      const quantity = parseFloat(row.quantity_sold || 0);
      if (!Number.isFinite(revenue) || !Number.isFinite(quantity)) {
        throw new Error('Invalid restaurant sales values.');
      }
      report.total += revenue;
      report.items += quantity;
      report.rows += 1;
    }
    for (const row of taps) {
      if (!chunk.includes(row.restaurant_id) || typeof row.tapped_at !== 'string' ||
          !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.tapped_at)) continue;
      const timestamp = new Date(row.tapped_at);
      if (!Number.isFinite(timestamp.getTime()) || timestamp > now) continue;
      const context = contexts.get(row.restaurant_id);
      const index = context.days.indexOf(restaurantLocalDate(context.timeZone, timestamp));
      if (index !== -1) reports.get(row.restaurant_id).views[index] += 1;
    }
  }
  return reports;
}