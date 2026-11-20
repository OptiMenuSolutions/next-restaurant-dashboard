import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProjectionCalendarNight, normalizeProjectionCalendarAnswers } from '../lib/projections/calendar.js';
import { projectionCalendarConceptStatus } from '../lib/projections/calendarHealth.js';
import { createProjectionCalendarHandler } from '../pages/api/projections/calendar.js';
import { createProjectionHolidayHandler } from '../pages/api/projections/holiday.js';
import { saveOptionalProjectionSetup, claimOptionalProjectionHoliday } from '../lib/projections/calendarClient.js';

const REST = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000101';
const settings = () => ({ concept_type: null, normally_closed_weekdays: [] });
const holiday = (year = 2026) => ({ holiday_date: `${year}-12-25`, holiday_key: 'christmas_day' });
const rule = (answer = 'closed') => ({ id: 'global-rule', restaurant_id: null, concept_type: 'full_service',
  holiday_key: 'christmas_day', weekday_group: 'all', effective_at: '2026-01-01T00:00:00Z', default_factor: 0.7, default_answer: answer });
const fact = (business_date, total_units = 0, extra = {}) => ({ business_date, total_units,
  complete: true, source_covered: true, source_revision: 'pos', ...extra });
function classify(extra = {}) {
  return classifyProjectionCalendarNight({ restaurantId: REST, date: '2026-11-23', today: '2026-11-20',
    configuration: { restaurant_id: REST, settings: settings() }, holidays: [], rules: [],
    asOf: '2026-11-20T12:00:00Z', earlyCloseFactor: 0.6, thresholdUnits: 2,
    history: [], holidayAnswers: [], ...extra });
}
const mondays = () => ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26'].map(day => fact(day));

test('missing concept and missing optional answers never block classification', () => {
  const value = classify();
  assert.equal(value.concept_type, 'full_service');
  assert.equal(value.concept_fallback, true);
  assert.equal(value.closed, false);
  assert.throws(() => normalizeProjectionCalendarAnswers({ ...settings(), holiday_answers: {} }));
});

test('four complete source-covered empty occurrences close the upcoming weekday', () => {
  const value = classify({ history: mondays() });
  assert.equal(value.closed, true);
  assert.equal(value.weekday_source, 'pos_last_four');
  assert.equal(value.weekday_observations, 4);
});

test('one occurrence above the threshold opens the weekday despite the onboarding answer', () => {
  const history = mondays(); history[1].total_units = 3;
  const value = classify({ history,
    configuration: { restaurant_id: REST, settings: { ...settings(), normally_closed_weekdays: [1] } } });
  assert.equal(value.closed, false);
});

test('incomplete and uncovered occurrences do not count toward four; only the latest four qualify', () => {
  for (const excluded of [{ complete: false }, { source_covered: false }]) {
    const history = mondays(); Object.assign(history[0], excluded);
    assert.equal(classify({ history }).weekday_source, 'optional_onboarding');
    assert.equal(classify({ history }).closed, false);
  }
  const history = [...mondays(), fact('2026-10-19', 42)];
  assert.equal(classify({ history }).closed, true);
});

test('a dated Open popup overrides four closed weekday occurrences and the holiday default', () => {
  const history = ['2026-11-13', '2026-11-06', '2026-10-30', '2026-10-23'].map(day => fact(day));
  const value = classify({ date: '2026-12-25', holidays: [holiday()], rules: [rule()], history,
    holidayAnswers: [{ restaurant_id: REST, business_date: '2026-12-25', answer: 'open' }] });
  assert.equal(value.closed, false);
  assert.equal(value.resolved_holidays[0].answer_source, 'dated_popup');
});

test('a dated answer never carries into another year', () => {
  const value = classify({ date: '2027-12-25', holidays: [holiday(2027)], rules: [rule()],
    holidayAnswers: [{ restaurant_id: REST, business_date: '2026-12-25', answer: 'open' }] });
  assert.equal(value.closed, true);
  assert.equal(value.resolved_holidays[0].answer_source, 'default_rule');
});

test('same holiday last year precedes the default and differs from shifting by 364 days', () => {
  for (const [units, answer, closed] of [[0, 'open', true], [42, 'closed', false]]) {
    const value = classify({ date: '2026-12-25', holidays: [holiday(), holiday(2025)], rules: [rule(answer)],
      history: [fact('2025-12-25', units), fact('2025-12-26', 999)] });
    assert.equal(value.closed, closed);
    assert.equal(value.resolved_holidays[0].answer_source, 'last_year_pos');
  }
});

test('no useful last-year observation uses the default; early close only comes from a dated popup', () => {
  const value = classify({ date: '2026-12-25', holidays: [holiday(), holiday(2025)], rules: [rule('early_close')],
    history: [fact('2025-12-25', 0, { complete: false })] });
  assert.equal(value.closed, false);
  assert.equal(value.early_close, false);
  assert.equal(value.default_factor, 0.7);
  const early = classify({ date: '2026-12-25', holidays: [holiday()], rules: [rule()],
    holidayAnswers: [{ restaurant_id: REST, business_date: '2026-12-25', answer: 'early_close' }] });
  assert.equal(early.early_close, true);
  assert.equal(early.default_factor, 0.6);
});

test('past nights ignore optional schedules, popups and holiday default multipliers', () => {
  for (const [units, complete, closed] of [[42, true, false], [2, true, true], [0, false, false]]) {
    const value = classify({ date: '2025-12-25', holidays: [holiday(2025)], rules: [rule()],
      history: [fact('2025-12-25', units, { complete })],
      configuration: { restaurant_id: REST, settings: { ...settings(), normally_closed_weekdays: [4] } },
      holidayAnswers: [{ restaurant_id: REST, business_date: '2025-12-25', answer: units === 42 ? 'closed' : 'early_close' }] });
    assert.equal(value.closed, closed);
    assert.equal(value.early_close, false);
    assert.equal(value.default_factor, closed ? 0 : 1);
    if (units === 42) assert.equal(value.internal_diagnostic.code, 'PROJECTION_CALENDAR_ANSWER_DISAGREEMENT');
  }
});

test('concept fallback produces an admin-only monitoring follow-up; read failures remain visible', async () => {
  const db = { rpc: async () => ({ data: { count: 1, names: ['Echo Tap'] }, error: null }) };
  assert.equal((await projectionCalendarConceptStatus(db)).status, 'NOT SET');
  assert.equal((await projectionCalendarConceptStatus({ rpc: async () => ({ error: { message: 'Offline' } }) })).status, 'DOWN');
});

function response() {
  return { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('verified admin mode can edit a selected restaurant; owner requests cannot select tenants', async () => {
  let argumentsSent;
  const handler = createProjectionCalendarHandler({ adminMode: true,
    verifyOwner: async () => ({ user: { id: OWNER } }),
    db: { rpc: async (_name, args) => { argumentsSent = args;
      return { data: { restaurant_id: REST, revision: 1, changed: true }, error: null }; } } });
  const res = response();
  await handler({ method: 'PUT', query: { restaurantId: REST }, body: { expected_revision: 0, settings: settings() } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(argumentsSent.p_actor_id, OWNER);
  assert.equal(argumentsSent.p_restaurant_id, REST);
});

test('holiday API pins restaurant and actor and rejects spoofed or malformed answers', async () => {
  const calls = [];
  const handler = createProjectionHolidayHandler({ verifyOwner: async () => ({ user: { id: OWNER }, restaurant: { id: REST } }),
    db: { rpc: async (_name, args) => { calls.push(args); return { data: { restaurant_id: REST, prompt: null }, error: null }; } } });
  const ok = response(); await handler({ method: 'POST', body: { action: 'claim' } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(calls[0].p_restaurant_id, REST);
  for (const body of [{ action: 'claim', restaurant_id: REST }, { action: 'answer', business_date: '2026-02-30', answer: 'open', expected_revision: 0 },
    { action: 'answer', business_date: '2026-12-25', answer: 'maybe', expected_revision: 0 }]) {
    const res = response(); await handler({ method: 'POST', body }, res); assert.equal(res.statusCode, 422);
  }
  assert.equal(calls.length, 1);
});

test('optional setup preserves skipped answers and uses only the authenticated server save path', async () => {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () =>
    calls.length === 1 ? { revision: 2, settings: { concept_type: 'bar_pub', normally_closed_weekdays: [1] } } : { changed: false } }; };
  try {
    await saveOptionalProjectionSetup({ auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } }, { style: '', normallyClosedWeekdays: null });
    const body = JSON.parse(calls[1].options.body);
    assert.deepEqual(body.settings, { concept_type: 'bar_pub', normally_closed_weekdays: [1] });
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(Object.hasOwn(body, 'restaurant_id'), false);
  } finally { globalThis.fetch = old; }
});

test('simultaneous client mounts share one in-flight popup claim', async () => {
  const old = globalThis.fetch; let count = 0;
  globalThis.fetch = async () => { count++; return { ok: true, json: async () => ({ prompt: null }) }; };
  const auth = { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } };
  try { await Promise.all([claimOptionalProjectionHoliday(auth, 'same'), claimOptionalProjectionHoliday(auth, 'same')]); assert.equal(count, 1); }
  finally { globalThis.fetch = old; }
});