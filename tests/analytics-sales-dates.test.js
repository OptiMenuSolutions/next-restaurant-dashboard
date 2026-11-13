import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleAnalyticsSales, loadAnalyticsSales } from '../lib/analyticsReporting.js';
import { restaurantLocalDate } from '../lib/restaurantTime.js';

const RID = 'analytics-sales-restaurant';

test('future, unknown and malformed sales dates are excluded without changing inputs', () => {
  const rows = [
    { id: 'past', sale_date: '2026-11-12' },
    { id: 'today', sale_date: '2026-11-13' },
    { id: 'future', sale_date: '2026-11-14' },
    { id: 'unknown', sale_date: null },
    { id: 'invalid', sale_date: '2026-02-30' },
    { id: 'nonfinite', sale_date: '-infinity' },
  ];
  const original = structuredClone(rows);
  assert.deepEqual(eligibleAnalyticsSales(rows, '2026-11-13').map(r => r.id), ['past', 'today']);
  assert.deepEqual(rows, original);
});

test('the same instant uses the date of each restaurant', () => {
  const now = new Date('2026-11-13T06:00:00Z');
  const rows = [{ sale_date: '2026-11-13' }];
  assert.equal(eligibleAnalyticsSales(rows, restaurantLocalDate('America/New_York', now)).length, 1);
  assert.equal(eligibleAnalyticsSales(rows, restaurantLocalDate('America/Los_Angeles', now)).length, 0);
});

function database(rows, { failAt = Infinity, nullAt = Infinity } = {}) {
  return {
    from(table) {
      assert.equal(table, 'pos_sales');
      const q = {
        select(columns) { assert.equal(columns, '*'); return q; },
        eq(column, value) {
          assert.equal(column, 'restaurant_id'); assert.equal(value, RID); return q;
        },
        lte(column, value) {
          assert.equal(column, 'sale_date'); assert.equal(value, '2026-11-13'); return q;
        },
        order() { return q; },
        async range(from) {
          if (from >= failAt) return { data: null, error: { message: 'Synthetic read failure' } };
          if (from >= nullAt) return { data: null, error: null };
          return { data: rows.slice(from, from + 137), error: null };
        },
      };
      return q;
    },
  };
}

test('all tenant-scoped sales are read beyond the former 10000-row cap', async () => {
  const rows = Array.from({ length: 11001 }, (_, id) => ({ id, sale_date: '2026-11-12' }));
  assert.deepEqual(await loadAnalyticsSales(database(rows), RID, '2026-11-13'), rows);
});

test('first-page errors cannot masquerade as no sales', async () => {
  await assert.rejects(loadAnalyticsSales(database([], { failAt: 0 }), RID, '2026-11-13'), /Synthetic read failure/);
});

test('later-page errors cannot return partial sales', async () => {
  const rows = Array.from({ length: 300 }, (_, id) => ({ id, sale_date: '2026-11-12' }));
  await assert.rejects(loadAnalyticsSales(database(rows, { failAt: 137 }), RID, '2026-11-13'), /Synthetic read failure/);
});

test('invalid database responses remain visible as failures', async () => {
  await assert.rejects(loadAnalyticsSales(database([], { nullAt: 0 }), RID, '2026-11-13'), /Invalid POS sales response/);
});

test('missing timezone context or restaurant identity cannot fall back silently', async () => {
  const db = { from() { throw new Error('Database must not be read'); } };
  for (const today of [null, undefined, '2026-02-30']) {
    await assert.rejects(loadAnalyticsSales(db, RID, today), /restaurant-local date/);
  }
  await assert.rejects(loadAnalyticsSales(db, '', '2026-11-13'), /restaurant ID/);
});
