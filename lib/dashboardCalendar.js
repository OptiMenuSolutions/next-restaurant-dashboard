import { getInvoiceEffectiveDate } from './invoiceRepricing.js';
import { restaurantLocalDate } from './restaurantTime.js';

export function dashboardClock(timeZone, now = new Date()) {
  const today = restaurantLocalDate(timeZone, now);
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', hourCycle: 'h23',
  }).format(now));
  return {
    today,
    dateLabel: now.toLocaleDateString(undefined, { timeZone, weekday: 'long', month: 'long', day: 'numeric' }),
    timeLabel: now.toLocaleTimeString(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }),
    greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
  };
}

function requireDate(value) {
  if (typeof value !== 'string' || getInvoiceEffectiveDate({ date: value }) !== value) {
    throw new TypeError('A valid restaurant-local date is required.');
  }
  return value;
}

// Calendar literals use UTC arithmetic only to avoid browser-zone and DST shifts.
// Convert timestamps with restaurantLocalDate before calling these helpers.
export function shiftDashboardDate(date, days) {
  requireDate(date);
  if (!Number.isInteger(days)) throw new TypeError('An integer day offset is required.');
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return requireDate(result.toISOString().slice(0, 10));
}

export function dashboardMonth(today, selected = null) {
  if (today == null) return null;
  requireDate(today);
  const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
  const choice = selected || current;
  if (!Number.isInteger(choice.year) || choice.year < 1 || choice.year > 9999 ||
      !Number.isInteger(choice.month) || choice.month < 0 || choice.month > 11) {
    throw new TypeError('A valid calendar month is required.');
  }
  const isFuture = choice.year > current.year ||
    (choice.year === current.year && choice.month > current.month);
  const { year, month } = isFuture ? current : choice;
  const from = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
  const end = new Date(`${from}T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const to = end.toISOString().slice(0, 10);
  const isCurrentMonth = year === current.year && month === current.month;
  return {
    year, month, from, to, isCurrentMonth,
    daysInMonth: end.getUTCDate(),
    firstWeekdayIndex: (new Date(`${from}T00:00:00.000Z`).getUTCDay() + 6) % 7,
    todayDay: isCurrentMonth ? Number(today.slice(8, 10)) : null,
  };
}

export function trailingDashboardWeek(rows, today) {
  if (today == null) return [];
  const start = shiftDashboardDate(today, -6);
  return rows.filter(row => {
    const date = getInvoiceEffectiveDate({ date: row.date });
    return date != null && date >= start && date <= today;
  });
}

export function dashboardWeekWindow(today, rangeFrom, rangeTo) {
  requireDate(today);
  const last7 = Array.from({ length: 7 }, (_, i) => shiftDashboardDate(today, i - 6));
  const rangeDays = [];
  if (rangeFrom != null || rangeTo != null) {
    requireDate(rangeFrom);
    requireDate(rangeTo);
    if (rangeFrom > rangeTo) throw new TypeError('The calendar range is reversed.');
    const end = rangeTo < today ? rangeTo : today;
    for (let day = rangeFrom; day <= end; day = shiftDashboardDate(day, 1)) {
      rangeDays.push(day);
    }
  }
  const days = [...new Set([...rangeDays, ...last7])].sort();
  const fromDate = days[0];
  return {
    days, fromDate, toDate: days[days.length - 1],
    historyStart: shiftDashboardDate(fromDate, -67),
  };
}

async function readPages(makeQuery, label) {
  const rows = [];
  for (let from = 0; ; ) {
    const { data, error } = await makeQuery().range(from, from + 499);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Invalid ${label} response.`);
    if (!data.length) return rows;
    rows.push(...data);
    from += data.length; // Servers can return fewer rows than requested.
  }
}

export async function loadDashboardWeekRows(db, restaurantId, today, rangeFrom, rangeTo) {
  if (typeof restaurantId !== 'string' || !restaurantId) {
    throw new TypeError('A restaurant ID is required.');
  }
  const window = dashboardWeekWindow(today, rangeFrom, rangeTo);
  const { fromDate, toDate, historyStart, days } = window;
  const salesQuery = (start, end, exclusive = false) => {
    const query = db.from('pos_sales')
      .select('id,item_name,quantity_sold,sale_date')
      .eq('restaurant_id', restaurantId).gte('sale_date', start);
    return (exclusive ? query.lt('sale_date', end) : query.lte('sale_date', end))
      .order('sale_date', { ascending: true }).order('id', { ascending: true });
  };
  const [recs, sales, historicSales] = await Promise.all([
    readPages(() => db.from('ai_recommendations')
      .select('id,generated_date,recommendations')
      .eq('restaurant_id', restaurantId)
      .gte('generated_date', fromDate).lte('generated_date', toDate)
      .order('generated_date', { ascending: true }).order('id', { ascending: true }),
    'dashboard recommendations'),
    readPages(() => salesQuery(fromDate, toDate), 'dashboard sales'),
    readPages(() => salesQuery(historyStart, fromDate, true), 'dashboard sales history'),
  ]);
  const inRange = (value, start, end, exclusive = false) => {
    const date = getInvoiceEffectiveDate({ date: value });
    return date != null && date >= start && (exclusive ? date < end : date <= end);
  };
  return {
    days,
    recs: recs.filter(row => inRange(row.generated_date, fromDate, toDate)),
    sales: sales.filter(row => inRange(row.sale_date, fromDate, toDate)),
    historicSales: historicSales.filter(row => inRange(row.sale_date, historyStart, fromDate, true)),
  };
}