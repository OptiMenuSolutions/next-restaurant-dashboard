import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProjectionCalendarNight } from '../lib/projections/calendar.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { projectionHolidayDateLabel } from '../lib/projections/calendarClient.js';
import { createProjectionHolidayHandler } from '../pages/api/projections/holiday.js';

const REST = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000101';
const fact = (business_date, total_units, extra = {}) => ({ business_date, total_units,
  complete: true, source_covered: true, source_revision: 'fixture', ...extra });
const priorWeeks = (day, units = 42) => [7, 14, 21, 28].map(n => fact(shiftProjectionDate(day, -n), units));
function night({ date = '2027-07-04', prior = '2026-07-04', key = 'july_4',
  closedDays = [], history = [], holidayAnswers = [], defaultAnswer = 'open' } = {}) {
  return classifyProjectionCalendarNight({ restaurantId: REST, date, today: '2026-11-20',
    asOf: '2026-11-20T12:00:00Z', thresholdUnits: 2, earlyCloseFactor: 0.6,
    configuration: { restaurant_id: REST, settings: { concept_type: 'full_service', normally_closed_weekdays: closedDays } },
    holidays: [{ holiday_date: prior, holiday_key: key }, { holiday_date: date, holiday_key: key }],
    rules: [{ id: 'fixture-rule', restaurant_id: null, concept_type: 'full_service', holiday_key: key,
      weekday_group: 'all', effective_at: '2026-01-01T00:00:00Z', default_factor: 0.7, default_answer: defaultAnswer }],
    history, holidayAnswers });
}

test('a trusted last-year Saturday July 4 cannot reopen this year’s closed Sunday', () => {
  const value = night({ closedDays: [7], history: [fact('2026-07-04', 42), ...priorWeeks('2026-07-04')] });
  assert.equal(value.closed, true);
  assert.equal(value.resolved_holidays[0].answer_source, 'last_year_pos');
  assert.equal(value.resolved_holidays[0].last_year_weekday_open, true);
});

test('Christmas Eve on a normally closed prior Sunday does not close an ordinary upcoming Monday', () => {
  const value = night({ date: '2035-12-24', prior: '2034-12-24', key: 'christmas_eve',
    history: [fact('2034-12-24', 0), ...priorWeeks('2034-12-24', 0)] });
  assert.equal(value.closed, false);
  assert.equal(value.resolved_holidays[0].answer_source, 'default_rule');
  assert.equal(value.resolved_holidays[0].last_year_weekday_open, false);
});

test('a genuine holiday closure is retained when its prior weekday was normally open', () => {
  const history = [fact('2026-07-04', 0), ...priorWeeks('2026-07-04', 0)];
  history[2].total_units = 3;
  const value = night({ history });
  assert.equal(value.closed, true);
  assert.equal(value.resolved_holidays[0].last_year_weekday_observations, 4);
  assert.equal(value.resolved_holidays[0].answer_source, 'last_year_pos');
});

test('only the four exact prior weekday dates qualify, with complete and covered evidence on each', () => {
  for (const change of ['missing', 'incomplete', 'uncovered', 'older']) {
    const history = [fact('2026-07-04', 0), ...priorWeeks('2026-07-04')];
    if (change === 'missing') history.pop();
    if (change === 'incomplete') history.at(-1).complete = false;
    if (change === 'uncovered') history.at(-1).source_covered = false;
    if (change === 'older') history.at(-1).business_date = '2026-05-30';
    const value = night({ history });
    assert.equal(value.closed, false, change);
    assert.equal(value.resolved_holidays[0].answer_source, 'default_rule', change);
    assert.equal(value.resolved_holidays[0].last_year_weekday_observations, 3, change);
  }
});

test('an untrusted prior holiday opening cannot override the closed default', () => {
  const value = night({ defaultAnswer: 'closed', history: [fact('2026-07-04', 42), ...priorWeeks('2026-07-04', 0)] });
  assert.equal(value.closed, true);
  assert.equal(value.resolved_holidays[0].answer_source, 'default_rule');
});

test('only a dated Open or Closing early answer reopens a normally closed upcoming weekday', () => {
  for (const answer of ['open', 'early_close']) {
    const value = night({ closedDays: [7], history: [fact('2026-07-04', 0), ...priorWeeks('2026-07-04')],
      holidayAnswers: [{ restaurant_id: REST, business_date: '2027-07-04', answer }] });
    assert.equal(value.closed, false);
    assert.equal(value.early_close, answer === 'early_close');
    assert.equal(value.resolved_holidays[0].answer_source, 'dated_popup');
  }
});

test('holiday labels format calendar dates independently of the browser timezone', () => {
  const old = process.env.TZ;
  try {
    for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      assert.equal(projectionHolidayDateLabel('2026-12-24'), 'Thursday, December 24');
    }
    assert.throws(() => projectionHolidayDateLabel('2026-02-30'));
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

const answer = (day = '2026-12-24') => ({ business_date: day, answer: 'open', expected_revision: 0 });
async function request(body, reply, query = {}, verifyOwner) {
  const calls = [];
  const res = { statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
  await createProjectionHolidayHandler({
    verifyOwner: verifyOwner || (async () => ({ user: { id: OWNER }, restaurant: { id: REST } })),
    db: { rpc: async (name, args) => { calls.push({ name, args }); return reply; } },
  })({ method: 'POST', body, query }, res);
  return { res, calls };
}

test('the holiday API passes one owned batch and returns all claimed dates', async () => {
  const holidays = ['2026-12-24', '2026-12-25', '2027-01-01'].map((day, i) => ({
    business_date: day, holiday_key: ['christmas_eve', 'christmas_day', 'new_years_day'][i], revision: 0 }));
  const claim = await request({ action: 'claim' }, { data: { restaurant_id: REST, prompt: { holidays } } });
  assert.equal(claim.res.statusCode, 200);
  assert.deepEqual(claim.res.body.prompt.holidays, holidays);
  const responses = [answer(), answer('2027-01-01')];
  const saved = await request({ action: 'answer', responses }, { data: { restaurant_id: REST, changed: true,
    responses: responses.map(row => ({ business_date: row.business_date, revision: 1 })) } });
  assert.equal(saved.res.statusCode, 200);
  assert.equal(saved.calls.length, 1);
  assert.deepEqual(saved.calls[0].args, { p_restaurant_id: REST, p_actor_id: OWNER, p_action: 'answer', p_responses: responses });
  assert.equal(saved.res.headers['Cache-Control'], 'private, no-store');
});

test('invalid batches and spoofed identities never reach the database', async () => {
  for (const body of [{ action: 'answer', responses: [] }, { action: 'answer', responses: [answer(), answer()] },
    { action: 'answer', responses: [null] }, { action: 'answer', responses: [answer('2026-02-30')] },
    { action: 'answer', responses: [{ ...answer(), restaurant_id: REST }] },
    { action: 'answer', responses: [{ ...answer(), expected_revision: 0.5 }] },
    { action: 'answer', responses: [{ ...answer(), answer: 'maybe' }] },
    { action: 'dismiss', business_date: '2026-12-24' }, { action: 'claim', actor_id: OWNER }]) {
    const result = await request(body);
    assert.equal(result.res.statusCode, 422);
    assert.equal(result.calls.length, 0);
  }
  assert.equal((await request({ action: 'claim' }, undefined, { restaurant_id: REST })).calls.length, 0);
  const denied = await request({ action: 'claim' }, undefined, {}, async () => ({ error: 'Sign in', status: 401 }));
  assert.equal(denied.res.statusCode, 401);
  assert.equal(denied.calls.length, 0);
});

test('malformed or foreign claimed groups and answer receipts fail visibly', async () => {
  const valid = { business_date: '2026-12-24', holiday_key: 'christmas_eve', revision: 0 };
  for (const data of [{ restaurant_id: 'foreign', prompt: null }, { restaurant_id: REST },
    { restaurant_id: REST, prompt: { holidays: [] } }, { restaurant_id: REST, prompt: { holidays: [valid, valid] } },
    { restaurant_id: REST, prompt: { holidays: [{ ...valid, holiday_key: 'halloween' }] } }]) {
    assert.equal((await request({ action: 'claim' }, { data })).res.statusCode, 503);
  }
  for (const responses of [[], [{ business_date: 'foreign', revision: 1 }], [{ business_date: '2026-12-24', revision: -1 }]]) {
    assert.equal((await request({ action: 'answer', responses: [answer()] },
      { data: { restaurant_id: REST, changed: true, responses } })).res.statusCode, 503);
  }
});

test('batch failures surface without retrying or exposing private details', async () => {
  for (const [code, status] of [['PT409', 409], ['42501', 403], ['22023', 422], ['XX000', 503]]) {
    const result = await request({ action: 'answer', responses: [answer()] }, { error: { code, message: 'PRIVATE_DETAIL' } });
    assert.equal(result.res.statusCode, status);
    assert.equal(result.calls.length, 1);
    assert.ok(!JSON.stringify(result.res.body).includes('PRIVATE_DETAIL'));
  }
  const dismissed = await request({ action: 'dismiss' }, { data: { restaurant_id: REST, changed: false, prompt: null } });
  assert.equal(dismissed.res.statusCode, 200);
  assert.deepEqual(dismissed.calls[0].args.p_responses, []);
});