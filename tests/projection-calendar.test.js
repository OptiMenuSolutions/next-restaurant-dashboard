import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectionHolidayDates,
  projectionCalendarWeekday,
  normalizeProjectionCalendarAnswers,
  classifyProjectionCalendarNight,
  reconcileProjectionCalendarSales,
} from '../lib/projections/calendar.js';
import { PROJECTION_DEFAULTS } from '../lib/projections/settings.js';
import { readProjectionCalendar, applyProjectionCalendarFlags, selectProjectionCalendarVersion }
  from '../lib/projections/calendarStore.js';

const REST = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const AS_OF = '2026-11-20T12:00:00Z';
const settings = () => ({ concept_type: 'full_service', normally_closed_weekdays: [], holiday_answers: {} });
const config = () => ({ restaurant_id: REST, settings: settings() });
const rule = (key, factor, extra = {}) => ({ id: `${key}-global`,
  restaurant_id: null, concept_type: 'full_service', holiday_key: key,
  weekday_group: 'all', effective_at: '2026-01-01T00:00:00Z',
  default_factor: factor, default_answer: 'open', ...extra });
const classify = (options = {}) => classifyProjectionCalendarNight({
  restaurantId: REST, date: '2027-02-14', configuration: config(),
  holidays: [
    { holiday_date: '2027-02-14', holiday_key: 'super_bowl' },
    { holiday_date: '2027-02-14', holiday_key: 'valentines_day' },
  ],
  rules: [rule('super_bowl', 0.8), rule('valentines_day', 1.2)],
  asOf: AS_OF, earlyCloseFactor: 0.6, ...options,
});

test('all fixed and computed holidays agree with the v4 dates for five calendar years', () => {
  const expected = [
    [2024, '03-31', '05-12', '05-27', '06-16', '09-02', '11-28'],
    [2025, '04-20', '05-11', '05-26', '06-15', '09-01', '11-27'],
    [2026, '04-05', '05-10', '05-25', '06-21', '09-07', '11-26'],
    [2027, '03-28', '05-09', '05-31', '06-20', '09-06', '11-25'],
    [2028, '04-16', '05-14', '05-29', '06-18', '09-04', '11-23'],
  ];
  for (const [year, ...dates] of expected) {
    const rows = projectionHolidayDates(year);
    assert.equal(rows.length, 17);
    for (const [i, key] of ['easter', 'mothers_day', 'memorial_day', 'fathers_day', 'labor_day', 'thanksgiving_day'].entries()) {
      assert.equal(rows.find(r => r.holiday_key === key).holiday_date, `${year}-${dates[i]}`);
    }
    assert.equal(rows.find(r => r.holiday_key === 'july_4').holiday_date, `${year}-07-04`);
    assert.equal(rows.find(r => r.holiday_key === 'christmas_day').holiday_date, `${year}-12-25`);
    assert.equal(rows.find(r => r.holiday_key === 'valentines_day').holiday_date, `${year}-02-14`);
  }
});

test('Thanksgiving Eve and Black Friday are the adjacent calendar dates', () => {
  const rows = projectionHolidayDates(2026);
  assert.equal(rows.find(r => r.holiday_key === 'thanksgiving_eve').holiday_date, '2026-11-25');
  assert.equal(rows.find(r => r.holiday_key === 'black_friday').holiday_date, '2026-11-27');
});

test('the Super Bowl and Valentine overlap retains both independently keyed rows', () => {
  const rows = projectionHolidayDates(2027, [{ holiday_date: '2027-02-14', holiday_key: 'super_bowl' }]);
  assert.deepEqual(rows.filter(r => r.holiday_date === '2027-02-14').map(r => r.holiday_key), ['super_bowl', 'valentines_day']);
  assert.equal(rows.length, 18);
  assert.ok(Object.isFrozen(rows));
  assert.ok(rows.every(Object.isFrozen));
});

test('calendar arithmetic handles leap years, century years and year boundaries', () => {
  assert.equal(projectionCalendarWeekday('2024-02-29'), 4);
  assert.equal(projectionCalendarWeekday('2027-01-01'), 5);
  assert.equal(projectionHolidayDates(2100).find(r => r.holiday_key === 'easter').holiday_date, '2100-03-28');
  assert.throws(() => projectionCalendarWeekday('2100-02-29'));
  assert.throws(() => projectionHolidayDates(0));
  assert.throws(() => projectionHolidayDates(2026.5));
});

test('wrong-year, unknown and duplicate scheduled holidays are rejected', () => {
  for (const rows of [
    [{ holiday_date: '2028-02-13', holiday_key: 'super_bowl' }],
    [{ holiday_date: '2027-02-14', holiday_key: 'private_event' }],
    [{ holiday_date: '2027-02-14', holiday_key: 'super_bowl' }, { holiday_date: '2027-02-14', holiday_key: 'super_bowl' }],
  ]) assert.throws(() => projectionHolidayDates(2027, rows));
});

test('owner answers accept exactly the three concepts and six recurring holidays', () => {
  for (const concept of ['full_service', 'bar_pub', 'quick_service']) {
    const normalized = normalizeProjectionCalendarAnswers({ ...settings(), concept_type: concept,
      normally_closed_weekdays: [7, 1], holiday_answers: { christmas_eve: 'early_close', july_4: 'closed' } });
    assert.deepEqual(normalized.normally_closed_weekdays, [1, 7]);
    assert.ok(Object.isFrozen(normalized.holiday_answers));
  }
  for (const bad of [
    { ...settings(), concept_type: 'fine_dining' },
    { ...settings(), normally_closed_weekdays: [1, 1] },
    { ...settings(), normally_closed_weekdays: [0] },
    { ...settings(), holiday_answers: { super_bowl: 'closed' } },
    { ...settings(), holiday_answers: { july_4: 'default' } },
    { ...settings(), actor_id: 'spoof' },
  ]) assert.throws(() => normalizeProjectionCalendarAnswers(bad));
});

test('raw overlapping defaults reproduce the three approved concept examples', () => {
  for (const [concept, valentine, bowl, expected] of [
    ['full_service', 1.2, 0.8, 0.96], ['bar_pub', 1.1, 1.3, 1.43], ['quick_service', 1.1, 1.1, 1.21],
  ]) {
    const value = classify({ configuration: { restaurant_id: REST, settings: { ...settings(), concept_type: concept } },
      rules: [rule('valentines_day', valentine, { concept_type: concept }), rule('super_bowl', bowl, { concept_type: concept })] });
    assert.ok(Math.abs(value.default_factor - expected) < 1e-12);
    assert.deepEqual(value.holiday_keys, ['super_bowl', 'valentines_day']);
    assert.equal(value.regular_service, false);
  }
});

test('normal weekday closure wins over holiday defaults', () => {
  const configuration = config();
  configuration.settings.normally_closed_weekdays = [7];
  const value = classify({ configuration });
  assert.equal(value.closed, true);
  assert.equal(value.default_factor, 0);
});

test('an owner Open answer replaces a default holiday closure', () => {
  const configuration = config();
  configuration.settings.holiday_answers.christmas_day = 'open';
  const value = classify({ date: '2026-12-25', configuration,
    holidays: [{ holiday_date: '2026-12-25', holiday_key: 'christmas_day' }],
    rules: [rule('christmas_day', 1, { default_answer: 'closed' })] });
  assert.equal(value.closed, false);
  assert.equal(value.default_factor, 1);
});

test('early close uses its own factor and a Closed answer still overrides it', () => {
  const configuration = config();
  configuration.settings.holiday_answers.easter = 'early_close';
  const options = { date: '2027-03-28', configuration,
    holidays: [{ holiday_date: '2027-03-28', holiday_key: 'easter' }], rules: [rule('easter', 1.8)] };
  assert.equal(classify(options).default_factor, 0.6);
  configuration.settings.normally_closed_weekdays = [7];
  assert.equal(classify(options).default_factor, 0);
  assert.equal(classify(options).early_close, false);
});

test('Valentine weekday-specific rules override the all-weekday global rule', () => {
  const value = classify({ rules: [rule('super_bowl', 0.8), rule('valentines_day', 99),
    rule('valentines_day', 1.2, { id: 'sunday', weekday_group: 'sun' })] });
  assert.ok(Math.abs(value.default_factor - 0.96) < 1e-12);
});

test('restaurant rule overrides win; future versions do not leak into the current run', () => {
  const value = classify({ rules: [rule('super_bowl', 0.8), rule('valentines_day', 1.2),
    rule('valentines_day', 1.5, { id: 'own', restaurant_id: REST }),
    rule('valentines_day', 9, { id: 'future', restaurant_id: REST, effective_at: '2027-01-01T00:00:00Z' })] });
  assert.ok(Math.abs(value.default_factor - 1.2) < 1e-12);
  assert.equal(value.resolved_holidays.find(r => r.holiday_key === 'valentines_day').rule_id, 'own');
});

test('missing configuration, foreign rules and incomplete holiday rules fail visibly', () => {
  assert.throws(() => classify({ configuration: { ...config(), restaurant_id: OTHER } }));
  assert.throws(() => classify({ rules: [rule('super_bowl', 0.8)] }));
  assert.throws(() => classify({ rules: [rule('super_bowl', 0.8, { restaurant_id: OTHER })] }));
  assert.throws(() => classify({ asOf: '2026-11-20' }));
});

test('PostgreSQL microsecond rule versions retain their exact order and as-of boundary', () => {
  const options = { asOf: '2026-11-20T12:00:00.000800Z', rules: [rule('super_bowl', 1),
    rule('valentines_day', 2, { id: 'earlier', effective_at: '2026-11-20T12:00:00.000600Z' }),
    rule('valentines_day', 3, { id: 'latest', effective_at: '2026-11-20T12:00:00.000700Z' }),
    rule('valentines_day', 4, { id: 'future', effective_at: '2026-11-20T12:00:00.000900Z' })] };
  assert.equal(classify(options).default_factor, 3);
  assert.equal(classify({ ...options, rules: [...options.rules].reverse() }).default_factor, 3);
});

test('duplicate rule versions and numeric overflow fail before producing flags', () => {
  assert.throws(() => classify({ rules: [rule('super_bowl', 1), rule('super_bowl', 2)] }), /Duplicate/);
  assert.throws(() => classify({ rules: [rule('super_bowl', 1e300), rule('valentines_day', 1e300)] }), /overflowed/);
});

test('dated answer selection preserves later snapshots after a historical correction', () => {
  const versions = [
    { restaurant_id: REST, revision: 0, effective_from: null },
    { restaurant_id: REST, revision: 1, effective_from: '2026-01-01' },
    { restaurant_id: REST, revision: 2, effective_from: '2027-01-01' },
    { restaurant_id: REST, revision: 3, effective_from: '2026-02-01' },
  ];
  assert.equal(selectProjectionCalendarVersion(versions, REST, '2025-12-31').revision, 0);
  assert.equal(selectProjectionCalendarVersion(versions, REST, '2026-03-01').revision, 3);
  assert.equal(selectProjectionCalendarVersion(versions, REST, '2027-03-01').revision, 2);
  assert.throws(() => selectProjectionCalendarVersion([{ ...versions[0], restaurant_id: OTHER }], REST, '2027-03-01'));
});

function calendarDatabase(mutate = value => value) {
  const context = mutate({ restaurant_id: REST, revision: 0, from: '2026-11-19', until: '2026-11-20',
    today: '2026-11-20', timezone: 'America/New_York', as_of: AS_OF, context_digest: 'a'.repeat(64),
    settings: { ...PROJECTION_DEFAULTS }, scheduled_years: [2026], holidays: [], rules: [], observed_closures: [], sales_evidence: [], closure_conflict_threshold_units: 2,
    versions: [{ ...config(), revision: 0, effective_from: null }] });
  const calls = [];
  return { calls, context, db: { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name === 'projection_prepare_calendar' ? null : context, error: null };
  } } };
}

test('calendar reads keep historical ranges and observed closures together', async () => {
  const f = calendarDatabase(value => ({ ...value,
    observed_closures: [{ business_date: '2026-11-19', closed: true, early_close: false }] }));
  const read = await readProjectionCalendar(f.db, { restaurantId: REST, from: f.context.from, until: f.context.until });
  assert.equal(read.nights.length, 2);
  assert.equal(read.nights[0].closed, true);
  assert.equal(read.nights[0].default_factor, 0);
  assert.equal(read.nights[1].regular_service, true);
});

test('missing calendar context and inconsistent local dates fail visibly', async () => {
  for (const mutate of [
    value => ({ ...value, restaurant_id: OTHER }),
    value => ({ ...value, timezone: null }),
    value => ({ ...value, today: '2026-11-21' }),
    value => ({ ...value, scheduled_years: undefined }),
    value => ({ ...value, observed_closures: undefined }),
  ]) {
    const f = calendarDatabase(mutate);
    await assert.rejects(readProjectionCalendar(f.db, { restaurantId: REST, from: '2026-11-19', until: '2026-11-20' }));
  }
});

test('source preparation, context read and commit failures never become empty success responses', async () => {
  for (const phase of ['projection_prepare_calendar', 'projection_calendar_context']) {
    const f = calendarDatabase();
    const db = { rpc: async (name, args) => name === phase
      ? { data: null, error: { code: 'XX000', message: 'Synthetic failure' } } : f.db.rpc(name, args) };
    await assert.rejects(readProjectionCalendar(db, { restaurantId: REST, from: '2026-11-19', until: '2026-11-20' }));
  }
  await assert.rejects(applyProjectionCalendarFlags({ rpc: async () => ({ data: null,
    error: { code: 'PT409', message: 'Changed' } }) }, { context: calendarDatabase().context, nights: [] }),
  error => error.code === 'PT409');
});

test('only current or historical calendar flags are sent to the writer', async () => {
  const f = calendarDatabase();
  let sent;
  const db = { rpc: async (_name, args) => {
    sent = args;
    return { data: { restaurant_id: REST, changed_nights: 0 }, error: null };
  } };
  await applyProjectionCalendarFlags(db, { context: f.context,
    nights: [{ business_date: '2026-11-20' }, { business_date: '2026-11-21' }] });
  assert.deepEqual(sent.p_nights, [{ business_date: '2026-11-20' }]);
});

test('missing sports dates block February only, including a partial February range', async () => {
  for (const [from, until, fails] of [
    ['2028-12-28', '2029-01-04', false],
    ['2029-01-24', '2029-01-31', false],
    ['2029-01-31', '2029-02-01', true],
    ['2029-02-28', '2029-03-01', true],
    ['2029-03-01', '2029-03-08', false],
  ]) {
    const fixture = calendarDatabase(value => ({ ...value, from, until, scheduled_years: [] }));
    const run = readProjectionCalendar(fixture.db, { restaurantId: REST, from, until });
    if (fails) await assert.rejects(run, error => error.code === 'PROJECTION_CALENDAR_INCOMPLETE');
    else assert.ok((await run).nights.length > 0);
  }
});

test('missing setup has a distinct projection code and survives a database response', async () => {
  const configuration = config();
  configuration.settings.concept_type = null;
  assert.throws(() => classify({ configuration }), error => error.code === 'PROJECTION_CALENDAR_SETUP_REQUIRED');
  const fixture = calendarDatabase(value => ({ ...value,
    versions: [{ ...configuration, revision: 0, effective_from: null }] }));
  await assert.rejects(readProjectionCalendar(fixture.db, { restaurantId: REST,
    from: fixture.context.from, until: fixture.context.until }),
  error => error.code === 'PROJECTION_CALENDAR_SETUP_REQUIRED');
  await assert.rejects(readProjectionCalendar({ rpc: async name => name === 'projection_prepare_calendar'
    ? { data: null, error: null } : { data: null,
      error: { code: 'P0001', message: 'PROJECTION_CALENDAR_SETUP_REQUIRED' } } },
  { restaurantId: REST, from: '2026-11-19', until: '2026-11-20' }),
  error => error.code === 'PROJECTION_CALENDAR_SETUP_REQUIRED');
});

test('past POS activity overrides a planned closure above the threshold without changing completeness', async () => {
  const fixture = calendarDatabase(value => ({ ...value, from: '2026-11-09', until: '2026-11-09',
    versions: [{ restaurant_id: REST, revision: 1, effective_from: null,
      settings: { ...settings(), normally_closed_weekdays: [1] } }],
    sales_evidence: [{ business_date: '2026-11-09', total_units: 42, complete: false, source_revision: 'pos-42' }] }));
  const read = await readProjectionCalendar(fixture.db, { restaurantId: REST,
    from: fixture.context.from, until: fixture.context.until });
  assert.equal(read.nights[0].closed, false);
  assert.equal(read.nights[0].default_factor, 1);
  assert.equal(read.nights[0].closure_conflict.total_units, 42);
  assert.match(read.nights[0].closure_conflict.message, /2026-11-09 had 42 dishes sold/);
  assert.equal(Object.hasOwn(read.nights[0], 'complete'), false);
});

test('tiny totals and unfinished business dates do not override planned closures', () => {
  const configuration = config();
  configuration.settings.normally_closed_weekdays = [7];
  const planned = classify({ configuration });
  for (const [units, today, closed] of [[0, '2027-02-15', true], [2, '2027-02-15', true],
    [2.01, '2027-02-15', false], [42, '2027-02-14', true], [42, '2027-02-13', true]]) {
    const night = reconcileProjectionCalendarSales(planned, null, { total_units: units }, today, 0.6, 2);
    assert.equal(night.closed, closed);
    if (!closed) assert.ok(Math.abs(night.default_factor - 0.96) < 1e-12);
  }
});

test('foreign, duplicate and malformed POS evidence fails visibly', async () => {
  const good = { business_date: '2026-11-19', total_units: 42, complete: true, source_revision: 'pos' };
  for (const rows of [[{ ...good, restaurant_id: OTHER }], [good, good],
    [{ ...good, total_units: -1 }], [{ ...good, total_units: '42' }],
    [{ ...good, source_revision: null }], [{ ...good, business_date: '2026-11-21' }]]) {
    const fixture = calendarDatabase(value => ({ ...value, sales_evidence: rows }));
    await assert.rejects(readProjectionCalendar(fixture.db,
      { restaurantId: REST, from: fixture.context.from, until: fixture.context.until }));
  }
});