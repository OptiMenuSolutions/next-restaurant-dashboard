import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceMonthSpend, readAllInvoiceRows } from '../lib/invoiceReporting.js';
import { restaurantLocalDate } from '../lib/restaurantTime.js';

const row = (date, amount, delivery = null) => ({
  isoDate: date, displayIsoDate: delivery, amount,
});

test('month follows delivery date with invoice-date fallback', () => {
  const rows = [row('2026-10-31', 72, '2026-11-01'), row('2026-11-02', 28)];
  assert.equal(invoiceMonthSpend(rows, '2026-11-13'), 100);
  assert.equal(invoiceMonthSpend(rows, '2026-10-31'), 0);
});

test('future and unknown dates stay out of current spending', () => {
  const rows = [
    row('2026-11-01', 72), row('2026-11-20', 999),
    row(null, 500), row('2026-11-01', 500, '2026-02-30'),
  ];
  assert.equal(invoiceMonthSpend(rows, '2026-11-13'), 72);
});

test('the restaurant month can differ from the UTC month', () => {
  const now = new Date('2026-12-01T01:00:00Z');
  const today = restaurantLocalDate('America/New_York', now);
  assert.equal(invoiceMonthSpend([row('2026-11-30', 72), row('2026-12-01', 999)], today), 72);
});

test('the restaurant year can differ from the UTC year', () => {
  const today = restaurantLocalDate('America/New_York', new Date('2027-01-01T01:00:00Z'));
  assert.equal(invoiceMonthSpend([row('2026-12-31', 72), row('2027-01-01', 999)], today), 72);
});

test('unknown eligible amounts cannot produce an apparently complete total', () => {
  assert.equal(invoiceMonthSpend([row('2026-11-01', 72), row('2026-11-02', null)], '2026-11-13'), null);
  assert.equal(invoiceMonthSpend([row('2026-11-01', NaN)], '2026-11-13'), null);
});

test('zero and credit amounts remain meaningful', () => {
  assert.equal(invoiceMonthSpend([row('2026-11-01', 72), row('2026-11-02', 0), row('2026-11-03', -2)], '2026-11-13'), 70);
});

test('unconfigured dates cannot silently use the browser date', () => {
  assert.equal(invoiceMonthSpend([], null), null);
  assert.equal(invoiceMonthSpend([], '2026-02-30'), null);
});

test('pagination reads more than 1000 records despite shortened responses', async () => {
  const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const result = await readAllInvoiceRows(() => ({
    async range(from) { return { data: rows.slice(from, from + 100), error: null }; },
  }));
  assert.deepEqual(result.data, rows);
});

test('a failed later page never returns a partial total', async () => {
  let calls = 0;
  await assert.rejects(readAllInvoiceRows(() => ({
    async range() {
      return ++calls === 1
        ? { data: [{ id: 1 }], error: null }
        : { data: null, error: { message: 'Synthetic read failure' } };
    },
  })), /Synthetic read failure/);
});
