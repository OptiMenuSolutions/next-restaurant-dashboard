import test from 'node:test';
import assert from 'node:assert/strict';
import {
  restaurantReportContext, loadRestaurantReporting, readRestaurantReportRows,
} from '../lib/admin/restaurantReporting.js';

const NY = { id: 'new-york', operational_timezone: 'America/New_York' };
const LA = { id: 'los-angeles', operational_timezone: 'America/Los_Angeles' };
const NOW = new Date('2026-11-01T04:30:00Z');

function database({ sales = [], taps = [], cap = 137, fail, invalid, ignoreBounds = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.ok(['pos_sales', 'nfc_tag_taps'].includes(table));
      const filters = [];
      const orders = [];
      const query = {
        select() { return query; },
        in(column, values) { filters.push(['in', column, values]); return query; },
        gte(column, value) { filters.push(['gte', column, value]); return query; },
        lte(column, value) { filters.push(['lte', column, value]); return query; },
        order(column, options) { orders.push([column, options]); return query; },
        async range(from, to) {
          calls.push({ table, from, to, filters, orders });
          assert.ok(filters.some(([op, key]) => op === 'in' && key === 'restaurant_id'));
          assert.ok(filters.some(([op]) => op === 'gte'));
          assert.ok(filters.some(([op]) => op === 'lte'));
          assert.deepEqual(orders[1], ['id', { ascending: true }]);
          if (fail?.(table, from)) return { data: null, error: { message: 'Synthetic read failure' } };
          if (invalid?.(table, from)) return { data: null, error: null };
          const rows = (table === 'pos_sales' ? sales : taps).filter(row =>
            filters.every(([op, key, value]) => {
              if (ignoreBounds) return true;
              if (op === 'in') return value.includes(row[key]);
              const actual = key === 'tapped_at' ? Date.parse(row[key]) : row[key];
              const boundary = key === 'tapped_at' ? Date.parse(value) : value;
              return op === 'gte' ? actual >= boundary : actual <= boundary;
            }));
          return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
        },
      };
      return query;
    },
  };
}

const sale = (restaurantId, sale_date, revenue = 10, quantity_sold = 1, id = 'sale') =>
  ({ id, restaurant_id: restaurantId, sale_date, revenue, quantity_sold });
const tap = (restaurantId, tapped_at, id = 'tap') => ({ id, restaurant_id: restaurantId, tapped_at });

test('one instant produces separate restaurant months and seven-day windows', () => {
  const ny = restaurantReportContext(NY, NOW);
  const la = restaurantReportContext(LA, NOW);
  assert.equal(ny.today, '2026-11-01');
  assert.deepEqual(ny.month, { start: '2026-10-01', end: '2026-10-31', label: 'OCT 2026' });
  assert.equal(la.today, '2026-10-31');
  assert.deepEqual(la.month, { start: '2026-09-01', end: '2026-09-30', label: 'SEP 2026' });
  assert.equal(ny.days[0], '2026-10-26');
  assert.equal(la.days[0], '2026-10-25');
});

test('year rollover and leap-month geometry use calendar arithmetic', () => {
  assert.equal(restaurantReportContext(NY, new Date('2027-01-01T12:00:00Z')).month.label, 'DEC 2026');
  assert.equal(restaurantReportContext(NY, new Date('2028-03-01T12:00:00Z')).month.end, '2028-02-29');
});

test('month and day windows roll over at restaurant-local midnight', () => {
  const before = restaurantReportContext(NY, new Date('2026-11-01T03:59:59Z'));
  const after = restaurantReportContext(NY, new Date('2026-11-01T04:00:00Z'));
  assert.equal(before.month.label, 'SEP 2026');
  assert.equal(after.month.label, 'OCT 2026');
  assert.equal(before.days[6], '2026-10-31');
  assert.equal(after.days[6], '2026-11-01');
});

test('monthly sales use each row owner’s month rather than the shared query envelope', async () => {
  const sales = [
    sale(NY.id, '2026-09-30', 900), sale(NY.id, '2026-10-01', 11, 2),
    sale(NY.id, '2026-10-31', 12, 3), sale(NY.id, '2026-11-01', 999),
    sale(LA.id, '2026-08-31', 800), sale(LA.id, '2026-09-01', 21, 4),
    sale(LA.id, '2026-09-30', 22, 5), sale(LA.id, '2026-10-01', 777),
  ];
  const original = structuredClone(sales);
  const reports = await loadRestaurantReporting(database({ sales }), [NY, LA], { now: NOW });
  assert.deepEqual(reports.get(NY.id).sales, { total: 23, items: 5, rows: 2, month: 'OCT 2026' });
  assert.deepEqual(reports.get(LA.id).sales, { total: 43, items: 9, rows: 2, month: 'SEP 2026' });
  assert.deepEqual(sales, original);
});

test('the last staff-view bucket is today for each restaurant', async () => {
  const taps = [tap(NY.id, NOW.toISOString()), tap(LA.id, NOW.toISOString())];
  const reports = await loadRestaurantReporting(database({ taps }), [NY, LA], { now: NOW });
  for (const restaurant of [NY, LA]) assert.deepEqual(reports.get(restaurant.id).views, [0, 0, 0, 0, 0, 0, 1]);
});

test('the earliest summer midnight hour is included despite the winter UTC offset', async () => {
  const now = new Date('2026-07-07T16:00:00Z');
  const taps = [tap(NY.id, '2026-07-01T04:30:00Z'), tap(NY.id, '2026-07-01T03:59:59Z')];
  const reports = await loadRestaurantReporting(database({ taps }), [NY], { now });
  assert.deepEqual(reports.get(NY.id).views, [1, 0, 0, 0, 0, 0, 0]);
});

test('the UTC query envelope includes midnight in a UTC+14 restaurant', async () => {
  const restaurant = { id: 'pacific', operational_timezone: 'Pacific/Kiritimati' };
  const now = new Date('2026-11-02T00:00:00Z');
  const taps = [tap(restaurant.id, '2026-10-26T10:30:00Z'), tap(restaurant.id, '2026-10-26T09:59:59Z')];
  const reports = await loadRestaurantReporting(database({ taps }), [restaurant], { now });
  assert.deepEqual(reports.get(restaurant.id).views, [1, 0, 0, 0, 0, 0, 0]);
});

test('both occurrences of a repeated daylight-saving hour count on the same day', async () => {
  const now = new Date('2026-11-01T07:00:00Z');
  const taps = [tap(NY.id, '2026-11-01T05:30:00Z'), tap(NY.id, '2026-11-01T06:30:00Z')];
  const reports = await loadRestaurantReporting(database({ taps }), [NY], { now });
  assert.equal(reports.get(NY.id).views[6], 2);
});

test('the spring daylight-saving transition stays on one calendar day', async () => {
  const now = new Date('2026-03-08T12:00:00Z');
  const taps = [tap(NY.id, '2026-03-08T06:30:00Z'), tap(NY.id, '2026-03-08T07:30:00Z')];
  const reports = await loadRestaurantReporting(database({ taps }), [NY], { now });
  assert.equal(reports.get(NY.id).views[6], 2);
});

test('future, out-of-window, malformed and foreign rows cannot enter a report', async () => {
  const sales = [
    sale(NY.id, '2026-10-31', 10), sale(NY.id, '2026-11-02', 900),
    sale(NY.id, '2026-02-30', 800), sale(NY.id, '-infinity', 700), sale('foreign', '2026-10-31', 600),
  ];
  const taps = [
    tap(NY.id, NOW.toISOString()), tap(NY.id, '2026-11-01T05:00:00Z'),
    tap(NY.id, '2026-10-25T04:00:00Z'), tap(NY.id, 'invalid'),
    tap(NY.id, '2026-11-01T00:15:00'), tap('foreign', NOW.toISOString()),
  ];
  const reports = await loadRestaurantReporting(database({ sales, taps, ignoreBounds: true }), [NY], { now: NOW });
  assert.equal(reports.get(NY.id).sales.total, 10);
  assert.deepEqual(reports.get(NY.id).views, [0, 0, 0, 0, 0, 0, 1]);
});

test('missing and invalid timezone settings stay unavailable without blocking valid restaurants', async () => {
  const restaurants = [NY, { id: 'missing' }, { id: 'invalid', operational_timezone: 'invalid/zone' }];
  const db = database({ sales: [sale(NY.id, '2026-10-31')] });
  const reports = await loadRestaurantReporting(db, restaurants, { now: NOW });
  assert.equal(reports.get(NY.id).sales.total, 10);
  for (const id of ['missing', 'invalid']) {
    assert.match(reports.get(id).error, /time zone/);
    assert.equal(reports.get(id).sales.total, null);
    assert.equal(reports.get(id).sales.rows, null);
    assert.deepEqual(reports.get(id).views, Array(7).fill(null));
  }
  for (const call of db.calls) assert.deepEqual(call.filters.find(([op]) => op === 'in')[2], [NY.id]);
});

test('all-unconfigured and empty restaurant lists do not invent zero reports or query data', async () => {
  const db = { from() { throw new Error('Unexpected read'); } };
  const reports = await loadRestaurantReporting(db, [{ id: 'missing' }], { now: NOW });
  assert.equal(reports.get('missing').sales.total, null);
  assert.equal((await loadRestaurantReporting(db, [], { now: NOW })).size, 0);
});

test('valid restaurants with complete empty responses have real zero totals', async () => {
  const reports = await loadRestaurantReporting(database(), [NY], { now: NOW });
  assert.deepEqual(reports.get(NY.id).sales, { total: 0, items: 0, rows: 0, month: 'OCT 2026' });
  assert.deepEqual(reports.get(NY.id).views, Array(7).fill(0));
});

test('all sales and tap pages are read beyond 1000 and 10000 rows', async () => {
  const sales = Array.from({ length: 11001 }, (_, id) => sale(NY.id, '2026-10-31', 1, 1, id));
  const taps = Array.from({ length: 1101 }, (_, id) => tap(NY.id, NOW.toISOString(), id));
  const reports = await loadRestaurantReporting(database({ sales, taps }), [NY], { now: NOW });
  assert.equal(reports.get(NY.id).sales.total, 11001);
  assert.equal(reports.get(NY.id).sales.rows, 11001);
  assert.equal(reports.get(NY.id).views[6], 1101);
});

test('restaurant scopes are retained across ID batches', async () => {
  const restaurants = Array.from({ length: 301 }, (_, id) => ({ ...NY, id: String(id) }));
  const sales = restaurants.map(restaurant => sale(restaurant.id, '2026-10-31'));
  const reports = await loadRestaurantReporting(database({ sales }), restaurants, { now: NOW });
  assert.equal(reports.size, 301);
  for (const restaurant of restaurants) assert.equal(reports.get(restaurant.id).sales.rows, 1);
});

test('a first-page failure in either source cannot masquerade as an empty report', async () => {
  for (const source of ['pos_sales', 'nfc_tag_taps']) {
    await assert.rejects(loadRestaurantReporting(database({ fail: table => table === source }), [NY], { now: NOW }), /Synthetic read failure/);
  }
});

test('a later-page failure in either source cannot return partial totals', async () => {
  const sales = Array.from({ length: 300 }, (_, id) => sale(NY.id, '2026-10-31', 1, 1, id));
  const taps = Array.from({ length: 300 }, (_, id) => tap(NY.id, NOW.toISOString(), id));
  for (const source of ['pos_sales', 'nfc_tag_taps']) {
    await assert.rejects(loadRestaurantReporting(database({ sales, taps,
      fail: (table, from) => table === source && from >= 137,
    }), [NY], { now: NOW }), /Synthetic read failure/);
  }
});

test('invalid database responses remain errors for both sources', async () => {
  for (const source of ['pos_sales', 'nfc_tag_taps']) {
    await assert.rejects(loadRestaurantReporting(database({ invalid: table => table === source }), [NY], { now: NOW }), /Invalid/);
  }
});

test('metadata pagination also handles shortened pages and propagates errors', async () => {
  const rows = Array.from({ length: 1101 }, (_, id) => ({ id }));
  assert.deepEqual(await readRestaurantReportRows(() => ({ range: async from => ({ data: rows.slice(from, from + 137), error: null }) }), 'restaurants'), rows);
  await assert.rejects(readRestaurantReportRows(() => ({ range: async () => ({ data: null, error: { message: 'Metadata failure' } }) }), 'restaurants'), /Metadata failure/);
  await assert.rejects(readRestaurantReportRows(() => ({ range: async () => ({ data: null, error: null }) }), 'restaurants'), /Invalid/);
});

test('invalid clocks cannot silently choose a host date', async () => {
  for (const now of [null, '2026-11-01', new Date('invalid')]) {
    await assert.rejects(loadRestaurantReporting(database(), [NY], { now }), /valid report timestamp/);
  }
});

test('invalid numeric sales cannot become a successful partial financial total', async () => {
  await assert.rejects(loadRestaurantReporting(database({ sales: [sale(NY.id, '2026-10-31', 'NaN')] }), [NY], { now: NOW }), /Invalid restaurant sales values/);
});