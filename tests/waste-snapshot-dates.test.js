import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previousCalendarDate,
  wasteSnapshotDates,
} from '../lib/wasteSnapshotDates.js';

test('snapshot dates follow each restaurant at the same instant', () => {
  const now = new Date('2026-11-12T06:00:00Z');
  assert.deepEqual(wasteSnapshotDates('America/New_York', now), {
    today: '2026-11-12', snapshotDate: '2026-11-11',
  });
  assert.deepEqual(wasteSnapshotDates('America/Los_Angeles', now), {
    today: '2026-11-11', snapshotDate: '2026-11-10',
  });
});

test('opposite date-line zones use their own completed day', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  assert.deepEqual(wasteSnapshotDates('Pacific/Kiritimati', now), {
    today: '2026-11-13', snapshotDate: '2026-11-12',
  });
  assert.deepEqual(wasteSnapshotDates('Pacific/Honolulu', now), {
    today: '2026-11-12', snapshotDate: '2026-11-11',
  });
});

test('yesterday uses calendar arithmetic across both DST transitions', () => {
  for (const [instant, today, yesterday] of [
    ['2026-03-09T04:30:00Z', '2026-03-09', '2026-03-08'],
    ['2026-11-02T05:30:00Z', '2026-11-02', '2026-11-01'],
  ]) {
    assert.deepEqual(
      wasteSnapshotDates('America/New_York', new Date(instant)),
      { today, snapshotDate: yesterday }
    );
  }
});

test('previous dates handle month, year and leap-year boundaries', () => {
  for (const [date, expected] of [
    ['2026-01-01', '2025-12-31'],
    ['2026-03-01', '2026-02-28'],
    ['2028-03-01', '2028-02-29'],
  ]) {
    assert.equal(previousCalendarDate(date), expected);
  }
});

test('missing or invalid timezones never receive a default', () => {
  for (const zone of [null, undefined, '', 'EST', 'Mars/Restaurant']) {
    assert.throws(() => wasteSnapshotDates(zone));
  }
});

test('malformed and impossible calendar dates are rejected', () => {
  for (const value of [null, '', '2026-2-01', '2026-02-30', '2026-13-01']) {
    assert.throws(() => previousCalendarDate(value));
  }
});

test('invalid timestamps cannot generate snapshot dates', () => {
  assert.throws(() => wasteSnapshotDates('UTC', new Date('invalid')));
});