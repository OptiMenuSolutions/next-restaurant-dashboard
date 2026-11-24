import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorMetrics, monitorComparison, monitorState, prepareMonitor } from '../lib/projections/monitor.js';

const group = extra => ({ observations: 3, scored: 3, zero_actual: 1, mape_count: 2,
  ape_sum: 0.75, absolute_error: 9, actual_units: 30, coverage_count: 3, covered: 2,
  partial_scope_count: 0, ...extra });

test('MAPE averages observations; WAPE includes zero-actual unit errors', () => {
  const result = monitorMetrics(group());
  assert.equal(result.mape, 0.375);
  assert.equal(result.wape, 0.3);
  assert.equal(result.zero_actual, 1);
  assert.equal(result.mae, 3);
  assert.equal(result.coverage, 2 / 3);
});

test('no observations and zero denominators stay unavailable, not perfect', () => {
  const result = monitorMetrics(group({ observations: 0, scored: 0, zero_actual: 0,
    mape_count: 0, ape_sum: 0, absolute_error: 0, actual_units: 0, coverage_count: 0, covered: 0 }));
  for (const key of ['mape', 'wape', 'mae', 'coverage']) assert.equal(result[key], null);
  assert.throws(() => monitorMetrics(group({ scored: 1 })), /counts/);
});

test('dish evaluation separates volume from share; original ranges remain inclusive', () => {
  const result = monitorComparison({ dish_id: 'dish', expected: 16, actual: 20, raw_expected: 20,
    low: 16, high: 20, reason: null, quantity_reason: null, scope_actual: 160, scope_share: 1, archived_share: 0.1 });
  assert.equal(result.difference, 4);
  assert.equal(result.ape, 0.2);
  assert.equal(result.range_hit, true);
  assert.equal(result.projected_share, 0.1);
  assert.equal(result.actual_share, 0.125);
});

test('partial-category comparison uses conditional shares and discloses its scope', () => {
  const result = monitorComparison({ dish_id: 'dish', expected: 50, actual: 50, raw_expected: 30,
    low: 20, high: 40, reason: null, quantity_reason: null, scope_actual: 100, scope_share: 0.6, archived_share: 0.3 });
  assert.equal(result.projected_share, 0.5);
  assert.equal(result.difference, 0);
  assert.equal(result.range_hit, false);
  assert.equal(result.scope_share, 0.6);
});

test('incomplete or missing actuals keep the volume forecast visible and comparisons unavailable', () => {
  const result = monitorComparison({ dish_id: null, expected: 100, raw_expected: 100,
    actual: null, reason: 'missing_actual', quantity_reason: 'missing_actual' });
  assert.equal(result.expected, 100);
  assert.equal(result.difference, null);
  assert.equal(result.ape, null);
  assert.equal(result.range_hit, null);
});

test('pending is distinct from stale, missed, disabled and older-history publication', () => {
  const row = { enabled: true, backfill: { backfill_complete: true },
    latest_run: { run_date: '2026-01-02', source_through: '2025-12-30' } };
  assert.deepEqual(monitorState({ ...row, job: { status: 'waiting' } }), { label: 'Pending', stale: false });
  assert.deepEqual(monitorState({ ...row, job: { status: 'missed' } }), { label: 'missed', stale: true });
  assert.deepEqual(monitorState({ ...row, enabled: false }), { label: 'Disabled', stale: true });
  assert.equal(monitorState(row).label, 'Published using older history');
});

test('invalid or partial read envelopes fail visibly', () => {
  for (const view of ['overview', 'service', 'accuracy']) assert.throws(() => prepareMonitor({}, view));
});

function packed() {
  const ids = [1, 2, 3].map(n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  const result = {
    format: 1, restaurant: { id: ids[0], name: 'Fixture', timezone: 'UTC' },
    snapshot_at: '2027-01-02T12:00:00Z', from: '2027-01-01', until: '2027-01-01',
    regular_only: true, selected_dish: null, catalog: ids.map((id, i) => [id, `Dish ${i}`]),
    categories: ['A', 'B'], bias: [], revisions: [],
    actuals: [{ business_date: '2027-01-01', complete: true, total_units: 1000,
      source_revision: 'r', closed: false, early_close: false, holiday_keys: [],
      outlier_status: 'kept', source_covered: true, source_issue: null, calendar_pending: false }],
    facts: [[ '2027-01-01', 0, 50, false, false, true ],
      [ '2027-01-01', 1, 50, false, false, true ], [ '2027-01-01', 2, 900, false, false, true ]],
    nights: [[ ids[0], '2027-01-01', '2027-01-01', 1, 4, 'calibration',
      '2027-01-01T06:00:00Z', '2026-12-31', 1000, 800, 1200, 0.8, 'available', ['A'],
      [[0, 0, 0.3, 300, 200, 400, 1], [1, 0, 0.3, 300, 200, 400, 1], [2, 1, null, null, null, null, -1]] ]],
  };
  const rows = result.nights[0][14];
  result.nights[0][14] = rows[0].map((_, column) => rows.map(row => row[column]));
  return result;
}

test('packed snapshots normalize partial scope and retain original quantity coverage', () => {
  const result = prepareMonitor(packed(), 'service');
  const dishes = result.observations.filter(r => r.dish_id);
  assert.equal(dishes[0].expected, 50);
  assert.equal(dishes[0].scope_actual, 100);
  assert.equal(dishes[0].scope_share, 0.6);
  assert.equal(dishes[0].ape, 0);
  assert.equal(dishes[0].range_hit, false);
  assert.equal(dishes[2].expected, null);
});

test('weekly summaries use stored dates across year boundaries and separate quantity coverage', () => {
  const result = prepareMonitor(packed(), 'accuracy');
  const dishes = result.groups.find(g => g.kind === 'dishes' && g.bucket === 'week');
  assert.equal(dishes.week, '2026-12-28');
  assert.equal(dishes.mape, 0);
  assert.equal(dishes.scored, 2);
  assert.equal(dishes.excluded, 1);
  assert.equal(dishes.coverage, 0);
  assert.equal(dishes.partial_scope_count, 2);
});

test('missing and reingested facts exclude comparisons instead of becoming zero demand', () => {
  for (const change of [p => p.facts.pop(), p => { p.facts[0][5] = false; }]) {
    const input = packed(); change(input);
    const result = prepareMonitor(input, 'service');
    assert.ok(result.observations.every(r => r.reason === 'actual_facts_require_reingestion'));
    assert.ok(result.observations.every(r => r.ape === null));
  }
});

test('missing vintages remain absent and malformed or duplicate facts fail', () => {
  const empty = packed(); empty.nights = [];
  assert.deepEqual(prepareMonitor(empty, 'service').observations, []);
  const duplicate = packed(); duplicate.facts.push(duplicate.facts[0]);
  assert.throws(() => prepareMonitor(duplicate, 'service'), /Duplicate/);
  const invalid = packed(); invalid.facts[0][1] = 999;
  assert.throws(() => prepareMonitor(invalid, 'accuracy'), /Invalid/);
});

test('a failed rerun preserves an already published forecast for that same business date', () => {
  assert.deepEqual(monitorState({ enabled: true, backfill: { backfill_complete: true },
    latest_run: { run_date: '2027-01-01', source_through: '2026-12-31' },
    job: { status: 'failed', business_date: '2027-01-01' } }),
  { label: 'Published; latest attempt failed', stale: false });
});

test('constant archive columns decode identically without changing any score', () => {
  for (const view of ['service', 'accuracy']) {
    const full = packed();
    full.nights[0][14][2] = [0.12345678901234566, 0.12345678901234566, 0.12345678901234566];
    const compact = structuredClone(full);
    compact.nights[0][14][2] = [full.nights[0][14][2][0]];
    assert.deepEqual(prepareMonitor(compact, view), prepareMonitor(full, view));
  }
});

test('constant null columns preserve unavailability; malformed vectors still reject', () => {
  const full = packed();
  for (let column = 2; column <= 5; column++) full.nights[0][14][column] = [null, null, null];
  const compact = structuredClone(full);
  for (let column = 2; column <= 5; column++) compact.nights[0][14][column] = [null];
  assert.deepEqual(prepareMonitor(compact, 'service'), prepareMonitor(full, 'service'));
  const invalid = packed(); invalid.nights[0][14][2] = [0.3, 0.3];
  assert.throws(() => prepareMonitor(invalid, 'service'), /different lengths/);
});