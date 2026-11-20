import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectionCalendarHandler } from '../pages/api/projections/calendar.js';

const REST = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000101';
const settings = () => ({ concept_type: 'full_service', normally_closed_weekdays: [] });
const context = () => ({ restaurant_id: REST, revision: 0, today: '2026-11-20', timezone: 'America/New_York',
  effective_from: null, settings: settings() });
const auth = async () => ({ user: { id: OWNER }, restaurant: { id: REST } });

async function request({ method = 'GET', body, query = {}, reply, verifyOwner = auth } = {}) {
  const calls = [];
  const response = { headers: {}, statusCode: null, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
  const db = { rpc: async (name, args) => {
    calls.push({ name, args });
    return reply === undefined ? { data: context(), error: null } : reply;
  } };
  await createProjectionCalendarHandler({ db, verifyOwner })({ method, body, query }, response);
  return { response, calls };
}

test('GET derives restaurant and actor from the verified owner and disables caching', async () => {
  const { response, calls } = await request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(Object.hasOwn(response.body, 'closure_conflicts'), false);
  assert.deepEqual(calls[0].args, { p_restaurant_id: REST, p_actor_id: OWNER });
});

test('unauthenticated and closed-account requests cannot reach the database', async () => {
  for (const status of [401, 403]) {
    const result = await request({ verifyOwner: async () => ({ error: 'Unavailable', status }) });
    assert.equal(result.response.statusCode, status);
    assert.equal(result.calls.length, 0);
  }
});

test('unexpected methods are rejected before authentication', async () => {
  const { response } = await request({ method: 'POST', verifyOwner: async () => assert.fail('Must not authenticate') });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET, PUT');
});

test('query parameters cannot select another restaurant', async () => {
  const { response, calls } = await request({ query: { restaurant_id: 'foreign' } });
  assert.equal(response.statusCode, 422);
  assert.equal(calls.length, 0);
});

test('PUT validates, normalizes and pins the actor and restaurant', async () => {
  const { response, calls } = await request({ method: 'PUT', body: {
    expected_revision: 2, effective_from: '2026-01-01',
    settings: { ...settings(), normally_closed_weekdays: [7, 1] },
  }, reply: { data: { restaurant_id: REST, revision: 3, changed: true, effective_from: '2026-01-01' }, error: null } });
  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].name, 'projection_save_calendar_answers');
  assert.equal(calls[0].args.p_actor_id, OWNER);
  assert.equal(calls[0].args.p_restaurant_id, REST);
  assert.deepEqual(calls[0].args.p_settings.normally_closed_weekdays, [1, 7]);
});

test('spoofed identity, invalid dates, concepts, weekdays and holiday answers never reach a writer', async () => {
  const valid = { expected_revision: 0, settings: settings() };
  for (const body of [null, [], '{',
    { ...valid, actor_id: OWNER }, { ...valid, restaurant_id: REST },
    { ...valid, expected_revision: -1 }, { ...valid, effective_from: '2026-02-30' },
    { ...valid, settings: { ...settings(), concept_type: 'fine_dining' } },
    { ...valid, settings: { ...settings(), normally_closed_weekdays: [0] } },
    { ...valid, settings: { ...settings(), holiday_answers: { halloween: 'closed' } } },
  ]) {
    const result = await request({ method: 'PUT', body });
    assert.equal(result.response.statusCode, 422);
    assert.equal(result.calls.length, 0);
  }
});

test('conflicts, ownership failures and configuration errors surface without automatic retry', async () => {
  for (const [code, status] of [['PT409', 409], ['42501', 403], ['22023', 422], ['XX000', 503]]) {
    const result = await request({ method: 'PUT', body: { expected_revision: 0, settings: settings() },
      reply: { data: null, error: { code, message: 'PRIVATE_DATABASE_DETAIL' } } });
    assert.equal(result.response.statusCode, status);
    assert.equal(result.calls.length, 1);
    assert.ok(!JSON.stringify(result.response.body).includes('PRIVATE_DATABASE_DETAIL'));
  }
});

test('malformed, empty and foreign RPC responses fail visibly', async () => {
  for (const reply of [null, { data: null }, { data: [] }, { data: { ...context(), restaurant_id: 'foreign' } }]) {
    assert.equal((await request({ reply })).response.statusCode, 503);
  }
});

test('unconfigured onboarding answers remain editable through GET', async () => {
  const value = context();
  value.settings.concept_type = null;
  const result = await request({ reply: { data: value, error: null } });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.response.body.settings.concept_type, null);
  assert.equal(result.response.body.setup_required, true);
  assert.equal(Object.hasOwn(result.response.body, 'setup_code'), false);
});

test('GET never exposes internal closure diagnostics to an owner', async () => {
  const value = context();
  value.closure_conflicts = [{ code: 'PROJECTION_CALENDAR_CLOSURE_CONFLICT', business_date: '2026-11-09', total_units: 42 }];
  const result = await request({ reply: { data: value, error: null } });
  assert.equal(Object.hasOwn(result.response.body, 'closure_conflicts'), false);
  assert.equal(result.response.body.setup_required, false);
});