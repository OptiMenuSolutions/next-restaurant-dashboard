import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionCalendarScheduleStatus } from '../lib/projections/calendarHealth.js';

function fixture(reply = { data: null, error: null }) {
  const calls = [];
  const chain = {};
  for (const method of ['select', 'eq', 'gte', 'lt', 'abortSignal']) chain[method] = (...args) => {
    calls.push([method, ...args]); return chain;
  };
  chain.maybeSingle = async () => reply;
  return { calls, db: { from: name => { calls.push(['from', name]); return chain; } } };
}

test('November 1 Eastern starts the next-year alert without waiting for a forecast', async () => {
  const f = fixture();
  assert.equal((await projectionCalendarScheduleStatus(f.db, new Date('2028-11-01T04:00:00Z'))).status, 'NOT SET');
  assert.ok(f.calls.some(call => call[0] === 'gte' && call[2] === '2029-02-01'));
});

test('October and March through October need no calendar query', async () => {
  for (const date of ['2028-11-01T03:59:59Z', '2029-03-01T05:00:00Z']) {
    const f = fixture();
    assert.equal((await projectionCalendarScheduleStatus(f.db, new Date(date))).status, 'UP');
    assert.equal(f.calls.length, 0);
  }
});

test('January and February check the current year and a published Sunday clears the alert', async () => {
  const f = fixture({ data: { holiday_key: 'super_bowl', holiday_date: '2029-02-11' }, error: null });
  for (const date of ['2029-01-01T05:00:00Z', '2029-02-28T12:00:00Z']) {
    assert.equal((await projectionCalendarScheduleStatus(f.db, new Date(date))).status, 'UP');
  }
  assert.ok(f.calls.some(call => call[0] === 'gte' && call[2] === '2029-02-01'));
});

test('read failures and invalid calendar rows are DOWN, never an all-clear or a missing-date claim', async () => {
  for (const reply of [null, {}, { data: null, error: { message: 'Offline' } },
    { data: { holiday_key: 'super_bowl', holiday_date: '2029-02-12' } },
    { data: { holiday_key: 'super_bowl', holiday_date: '2028-02-13' } }]) {
    const f = fixture(reply);
    assert.equal((await projectionCalendarScheduleStatus(f.db, new Date('2028-11-20T12:00:00Z'))).status, 'DOWN');
  }
});