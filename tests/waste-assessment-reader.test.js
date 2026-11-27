import test from 'node:test';
import assert from 'node:assert/strict';
import { readWasteAssessment, selectWasteAssessmentForDish } from '../lib/wasteAssessmentReader.js';
import { createWasteAssessmentHandler } from '../pages/api/projections/waste-assessment.js';
import { createWasteAssessmentSwitchHandler } from '../pages/api/admin/projections/waste-assessment-switch.js';

const rid = '91000000-0000-4000-8000-000000000011';
const actor = '91000000-0000-4000-8000-000000000012';
const foreign = '91000000-0000-4000-8000-000000000013';
const now = '2026-11-28T10:30:00Z';

function compact(day = '2026-11-27') {
  return {
    mode: 'assessment',
    restaurant_id: rid,
    assessment_id: 'assessment',
    assessment_date: day,
    business_date: '2026-11-28',
    inventory_cutoff: '2026-11-26',
    inventory_boundary: '2026-11-27T09:00:00Z',
    timezone: 'America/New_York',
    pending_disposals: [{ batch_id: 'disposed', confirmation_id: 'confirmation' }],
    result: {
      restaurant_id: rid,
      assessment_date: day,
      inventory_cutoff: '2026-11-26',
      result_schema_version: 2,
      forecast_fallback: true,
      forecast: { run_id: 'forecast', run_date: '2026-11-26', trace: ['private'] },
      items: [
        { batch_id: 'disposed', risk_qty: 2, risk_value: 11, visible: true, recipe_coverage: ['private'] },
        { batch_id: 'active', risk_qty: 3, risk_value: null, visible: true },
      ],
      needs_review: [{ batch_id: 'review', remaining_qty: null, stock_remaining_qty: 4, stock_unit: 'oz' }],
      omitted_by_status: { overdue: { count: 878, risk_value: 310 } },
    },
  };
}

const dbReturning = data => ({ rpc: async () => ({ data }) });

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('the compact reader preserves stock and summaries while masking individually matched disposal risk', async () => {
  const view = await readWasteAssessment({ async rpc(name, args) {
    assert.equal(name, 'waste_projection_read_surface');
    assert.deepEqual(args, { target: rid, observed_at: now });
    return { data: compact() };
  } }, rid, now);
  assert.equal(view.stale, true);
  assert.equal(view.inventory_cutoff, '2026-11-26');
  assert.equal(view.forecast.run_id, 'forecast');
  assert.equal(view.forecast_fallback, true);
  assert.equal(view.forecast.trace, undefined);
  assert.equal(view.items[0].recipe_coverage, undefined);
  assert.equal(view.items[0].pending_disposal, true);
  assert.equal(view.items[0].visible, false);
  assert.equal(view.items[0].risk_qty, null);
  assert.equal(view.items[0].risk_value, null);
  assert.equal(view.items[1].risk_qty, 3);
  assert.equal(view.items[1].risk_value, null);
  assert.equal(view.needs_review[0].stock_remaining_qty, 4);
  assert.equal(view.omitted_by_status.overdue.count, 878);
});

test('the card retains older compact assessments and the Dish selector permits only two business dates', async () => {
  for (const [day, allowed] of [['2026-11-28', true], ['2026-11-27', true], ['2026-11-26', false]]) {
    const view = await readWasteAssessment(dbReturning(compact(day)), rid, now);
    assert.equal(view.mode, 'assessment');
    assert.equal(view.stale, day < '2026-11-28');
    const dish = selectWasteAssessmentForDish(view);
    if (allowed) assert.equal(dish, view);
    else assert.deepEqual(dish, {
      mode: 'legacy', reason: 'assessment_too_old', assessment_id: 'assessment',
      assessment_date: day, inventory_cutoff: '2026-11-26',
    });
  }
});

test('a missing compact assessment is an explicit fallback and a read error remains an error', async () => {
  const empty = { mode: 'legacy', reason: 'no_compact_assessment' };
  assert.deepEqual(selectWasteAssessmentForDish(await readWasteAssessment(dbReturning(empty), rid)), empty);
  await assert.rejects(readWasteAssessment({ rpc: async () => ({ error: { message: 'Unavailable' } }) }, rid), /Unavailable/);
  await assert.rejects(readWasteAssessment(dbReturning({ ...compact(), restaurant_id: foreign }), rid), /Invalid/);
});

test('the owner route derives its restaurant from authentication and forbids overrides', async () => {
  const calls = [];
  const handler = createWasteAssessmentHandler({
    db: { rpc: async (_name, args) => { calls.push(args); return { data: { mode: 'legacy', reason: 'switch_off' } }; } },
    verifyOwner: async () => ({ user: { id: actor }, restaurant: { id: rid } }),
  });
  const ok = response();
  await handler({ method: 'GET', query: {} }, ok);
  assert.deepEqual(ok.body, { mode: 'legacy', reason: 'switch_off' });
  assert.equal(ok.headers['Cache-Control'], 'private, no-store');
  assert.equal(calls[0].target, rid);
  const denied = response();
  await handler({ method: 'GET', query: { restaurantId: foreign } }, denied);
  assert.equal(denied.code, 400);
  assert.equal(calls.length, 1);
});

test('the admin route passes only the authenticated actor and a strict boolean', async () => {
  const calls = [];
  const handler = createWasteAssessmentSwitchHandler({
    db: { rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: { restaurant_id: rid, enabled: args.desired === true } };
    } },
    verifyAdmin: async () => ({ user: { id: actor } }),
  });
  const ok = response();
  await handler({ method: 'PUT', query: { restaurantId: rid }, body: { enabled: false } }, ok);
  assert.deepEqual(ok.body, { restaurant_id: rid, enabled: false });
  assert.deepEqual(calls[0], ['waste_projection_surface_switch', { target: rid, actor, desired: false }]);
  const invalid = response();
  await handler({ method: 'PUT', query: { restaurantId: rid }, body: { enabled: true, actor: foreign } }, invalid);
  assert.equal(invalid.code, 422);
  assert.equal(calls.length, 1);
  const denied = response();
  await createWasteAssessmentSwitchHandler({ db: {}, verifyAdmin: async (_req, res) => {
    res.status(403).json({ error: 'Admins only' });
  } })({ method: 'PUT', query: { restaurantId: rid }, body: { enabled: true } }, denied);
  assert.equal(denied.code, 403);
});