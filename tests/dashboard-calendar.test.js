import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardClock, dashboardMonth, dashboardWeekWindow, shiftDashboardDate,
  trailingDashboardWeek, loadDashboardWeekRows,
} from '../lib/dashboardCalendar.js';

const RID = 'dashboard-restaurant';
const TODAY = '2026-11-14';

test('one instant gives each restaurant its own date, month and greeting', () => {
  const instant = new Date('2026-11-01T04:30:00Z');
  const ny = dashboardClock('America/New_York', instant);
  const la = dashboardClock('America/Los_Angeles', instant);
  assert.equal(ny.today, '2026-11-01');
  assert.equal(la.today, '2026-10-31');
  assert.equal(dashboardMonth(ny.today).month, 10);
  assert.equal(dashboardMonth(la.today).month, 9);
  assert.equal(ny.greeting, 'Good morning');
  assert.equal(la.greeting, 'Good evening');
  assert.notEqual(ny.dateLabel, la.dateLabel);
  assert.notEqual(ny.timeLabel, la.timeLabel);
});

test('local midnight advances the seven-day window and today marker', () => {
  const before = dashboardClock('America/New_York', new Date('2026-11-14T04:59:59Z'));
  const after = dashboardClock('America/New_York', new Date('2026-11-14T05:00:00Z'));
  assert.equal(dashboardWeekWindow(before.today).fromDate, '2026-11-07');
  assert.equal(dashboardWeekWindow(after.today).fromDate, '2026-11-08');
  assert.equal(dashboardMonth(before.today).todayDay, 13);
  assert.equal(dashboardMonth(after.today).todayDay, 14);
});

test('the repeated DST hour keeps the same calendar window', () => {
  const before = dashboardClock('America/New_York', new Date('2026-11-01T05:30:00Z'));
  const after = dashboardClock('America/New_York', new Date('2026-11-01T06:30:00Z'));
  assert.equal(before.today, after.today);
  assert.equal(before.greeting, after.greeting);
  assert.deepEqual(dashboardWeekWindow(before.today), dashboardWeekWindow(after.today));
  assert.equal(shiftDashboardDate('2026-03-08', 1), '2026-03-09');
});

test('leap months, Monday-first geometry and year boundaries stay correct', () => {
  const leap = dashboardMonth('2028-02-29');
  assert.equal(leap.daysInMonth, 29);
  assert.equal(leap.firstWeekdayIndex, 1);
  assert.equal(leap.to, '2028-02-29');
  assert.equal(dashboardMonth('2027-01-01').firstWeekdayIndex, 4);
  assert.equal(shiftDashboardDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDashboardDate('2028-03-01', -1), '2028-02-29');
});

test('current month follows rollover while selected history stays selected', () => {
  assert.equal(dashboardMonth('2026-10-31').month, 9);
  assert.equal(dashboardMonth('2026-11-01').month, 10);
  const past = dashboardMonth(TODAY, { year: 2026, month: 9 });
  assert.equal(past.from, '2026-10-01');
  assert.equal(past.todayDay, null);
  assert.equal(past.isCurrentMonth, false);
  assert.equal(dashboardMonth(TODAY, { year: 2027, month: 0 }).from, '2026-11-01');
});

test('no calendar is invented while the restaurant clock is unavailable', () => {
  assert.equal(dashboardMonth(null), null);
  assert.deepEqual(trailingDashboardWeek([{ date: TODAY }], null), []);
  for (const zone of [undefined, null, '', 'invalid/zone']) {
    assert.throws(() => dashboardClock(zone), /time zone/);
  }
});

test('mobile and summary dates include both endpoints and exclude invalid and future dates', () => {
  const rows = ['2026-11-07', '2026-11-08', TODAY, '2026-11-15', '2026-02-30', null]
    .map(date => ({ date }));
  const original = structuredClone(rows);
  assert.deepEqual(trailingDashboardWeek(rows, TODAY).map(row => row.date), ['2026-11-08', TODAY]);
  assert.deepEqual(rows, original);
});

test('browsed history is combined with the trailing week and its own earlier baseline', () => {
  const window = dashboardWeekWindow(TODAY, '2026-10-01', '2026-10-31');
  assert.equal(window.days.length, 38);
  assert.equal(window.fromDate, '2026-10-01');
  assert.equal(window.toDate, TODAY);
  assert.equal(window.historyStart, '2026-07-26');
});

test('current and future calendar ranges cannot include tomorrow', () => {
  const current = dashboardWeekWindow(TODAY, '2026-11-01', '2026-11-30');
  assert.equal(current.days.length, 14);
  assert.equal(current.toDate, TODAY);
  const future = dashboardWeekWindow(TODAY, '2026-12-01', '2026-12-31');
  assert.equal(future.days.length, 7);
  assert.equal(future.toDate, TODAY);
});

test('malformed calendar input fails before any database read', async () => {
  const db = { from() { throw new Error('Unexpected database read'); } };
  for (const today of [null, undefined, '2026-02-30', '-infinity']) {
    await assert.rejects(loadDashboardWeekRows(db, RID, today), /restaurant-local date/);
  }
  await assert.rejects(loadDashboardWeekRows(db, '', TODAY), /restaurant ID/);
  await assert.rejects(loadDashboardWeekRows(db, RID, TODAY, '2026-11-01'), /restaurant-local date/);
  await assert.rejects(loadDashboardWeekRows(db, RID, TODAY, TODAY, '2026-11-01'), /reversed/);
});

function database(data, { fail, invalid, ignoreDates = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const orders = [];
      const q = {
        select() { return q; },
        eq(column, value) { filters.push(['eq', column, value]); return q; },
        gte(column, value) { filters.push(['gte', column, value]); return q; },
        lte(column, value) { filters.push(['lte', column, value]); return q; },
        lt(column, value) { filters.push(['lt', column, value]); return q; },
        order(column, options) { orders.push([column, options]); return q; },
        async range(from, to) {
          const kind = table === 'ai_recommendations' ? 'recs'
            : filters.some(([op]) => op === 'lt') ? 'history' : 'sales';
          calls.push({ kind, from, to, filters, orders });
          assert.ok(filters.some(([op, key, value]) => op === 'eq' && key === 'restaurant_id' && value === RID));
          assert.equal(orders.length, 2);
          assert.deepEqual(orders[1], ['id', { ascending: true }]);
          assert.ok(filters.some(([op]) => op === 'gte'));
          assert.ok(filters.some(([op]) => op === 'lt' || op === 'lte'));
          if (fail?.(kind, from)) return { data: null, error: { message: 'Synthetic read failure' } };
          if (invalid?.(kind, from)) return { data: null, error: null };
          let rows = data[kind] || [];
          rows = rows.filter(row => filters.every(([op, key, value]) =>
            op === 'eq' ? row[key] === value : ignoreDates ? true
              : op === 'gte' ? row[key] >= value : op === 'lte' ? row[key] <= value : row[key] < value));
          // A lower server row limit must not truncate the result.
          return { data: rows.slice(from, Math.min(to + 1, from + 137)), error: null };
        },
      };
      return q;
    },
  };
}

function rows(kind, count) {
  return Array.from({ length: count }, (_, id) => ({
    id, restaurant_id: RID,
    ...(kind === 'recs' ? { generated_date: '2026-11-13', recommendations: [] }
      : { sale_date: kind === 'history' ? '2026-11-01' : '2026-11-13', item_name: 'Dish', quantity_sold: 1 }),
  }));
}

test('all three paginated reads continue beyond 1000 and 10000 rows', async () => {
  const data = { recs: rows('recs', 1101), sales: rows('sales', 11001), history: rows('history', 1501) };
  const db = database(data);
  const result = await loadDashboardWeekRows(db, RID, TODAY);
  assert.deepEqual(result.recs, data.recs);
  assert.deepEqual(result.sales, data.sales);
  assert.deepEqual(result.historicSales, data.history);
  for (const kind of ['recs', 'sales', 'history']) {
    assert.ok(db.calls.filter(call => call.kind === kind).length > 2);
  }
});

test('a first-page failure in any source cannot masquerade as an empty week', async () => {
  for (const source of ['recs', 'sales', 'history']) {
    await assert.rejects(loadDashboardWeekRows(database({}, {
      fail: kind => kind === source,
    }), RID, TODAY), /Synthetic read failure/);
  }
});

test('a later-page failure in any source cannot return partial results', async () => {
  const data = { recs: rows('recs', 300), sales: rows('sales', 300), history: rows('history', 300) };
  for (const source of ['recs', 'sales', 'history']) {
    await assert.rejects(loadDashboardWeekRows(database(data, {
      fail: (kind, from) => kind === source && from >= 137,
    }), RID, TODAY), /Synthetic read failure/);
  }
});

test('invalid database responses remain errors for every source', async () => {
  for (const source of ['recs', 'sales', 'history']) {
    await assert.rejects(loadDashboardWeekRows(database({}, {
      invalid: kind => kind === source,
    }), RID, TODAY), /Invalid dashboard/);
  }
});

test('returned rows are bounded and malformed dates cannot enter either window', async () => {
  const saleDates = ['2026-11-01', '2026-11-13', '2026-11-15', '2026-02-30', '-infinity', null];
  const data = {
    sales: saleDates.map((sale_date, id) => ({ id, restaurant_id: RID, sale_date })),
    history: saleDates.map((sale_date, id) => ({ id, restaurant_id: RID, sale_date })),
    recs: saleDates.map((generated_date, id) => ({ id, restaurant_id: RID, generated_date })),
  };
  const result = await loadDashboardWeekRows(database(data, { ignoreDates: true }), RID, TODAY);
  assert.deepEqual(result.sales.map(row => row.sale_date), ['2026-11-13']);
  assert.deepEqual(result.historicSales.map(row => row.sale_date), ['2026-11-01']);
  assert.deepEqual(result.recs.map(row => row.generated_date), ['2026-11-13']);
});

test('other restaurant rows are excluded by all three database queries', async () => {
  const data = Object.fromEntries(['recs', 'sales', 'history'].map(kind => [kind,
    [...rows(kind, 1), ...rows(kind, 1).map(row => ({ ...row, restaurant_id: 'another-restaurant' }))],
  ]));
  const result = await loadDashboardWeekRows(database(data), RID, TODAY);
  assert.equal(result.recs.length, 1);
  assert.equal(result.sales.length, 1);
  assert.equal(result.historicSales.length, 1);
});

test('an empty result still has seven bounded calendar dates', async () => {
  const result = await loadDashboardWeekRows(database({}), RID, TODAY);
  assert.deepEqual(result.days, ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', TODAY]);
  assert.deepEqual(result.recs, []);
  assert.deepEqual(result.sales, []);
  assert.deepEqual(result.historicSales, []);
});