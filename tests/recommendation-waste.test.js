import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRecommendationCandidates } from '../lib/ai/recommendationScoring.js';
import { buildWeightedPrompt } from '../lib/ai/prompts/weightedTonightsDish.js';
import { projectedWasteForSavedTicket, readRecommendationWaste } from '../lib/ai/recommendationWaste.js';
import { addPendingWasteDisposal } from '../lib/wasteAssessmentCard.js';
import { readWasteAssessment } from '../lib/wasteAssessmentReader.js';

const restaurantId = 'maple';
const now = '2026-11-28T11:00:00Z';
const serviceDate = '2026-11-28';

function database(data, error = null) {
  return {
    async rpc(name, params) {
      assert.equal(name, 'waste_projection_read_surface');
      assert.deepEqual(params, { target: restaurantId, observed_at: now });
      return { data, error };
    },
  };
}

function batch(batch_id, use_by_date, attributes = {}) {
  return {
    batch_id, ingredient_id: batch_id, use_by_date, status: 'ok',
    remaining_qty: 4, unit: 'lb', risk_qty: 2, risk_value: 8, visible: true, ...attributes,
  };
}

function compact(assessmentDate = '2026-11-27', businessDate = '2026-11-27') {
  const inventoryCutoff = '2026-11-26';
  return {
    mode: 'assessment', restaurant_id: restaurantId, assessment_id: 'assessment-1',
    assessment_date: assessmentDate, business_date: businessDate,
    inventory_cutoff: inventoryCutoff, inventory_boundary: '2026-11-27T12:00:00Z',
    timezone: 'America/Los_Angeles',
    pending_disposals: [{ batch_id: 'disposed' }],
    result: {
      result_schema_version: 2, restaurant_id: restaurantId,
      assessment_date: assessmentDate, inventory_cutoff: inventoryCutoff,
      items: [
        batch('until-today', serviceDate),
        batch('tomorrow', '2026-11-29'),
        batch('past-use-by', '2026-11-27'),
        batch('overdue', '2026-11-25', { status: 'overdue' }),
        batch('far-away', '2026-12-04'),
        batch('disposed', '2026-11-28'),
        batch('unavailable', '2026-11-28', { status: 'unavailable' }),
        batch('no-excess', '2026-11-28', { risk_qty: 0 }),
        batch('unvalued', '2026-11-30', { risk_value: null }),
      ],
      needs_review: [batch('needs-review', '2026-11-28', { status: 'unavailable' })],
      omitted_by_status: { overdue: { count: 88 } },
    },
  };
}

test('the pre-cutoff Pacific cron uses the target service date to exclude past-use-by and unsuitable batches', async () => {
  const { input, batches } = await readRecommendationWaste(database(compact()), restaurantId, serviceDate, now);
  assert.deepEqual(input, {
    mode: 'assessment', assessment_id: 'assessment-1', assessment_date: '2026-11-27',
    inventory_cutoff: '2026-11-26', service_date: serviceDate, stale: false,
  });
  assert.deepEqual(batches.map(row => [row.batchId, row.daysLeft]), [
    ['until-today', 0], ['tomorrow', 1], ['unvalued', 2],
  ]);
});

test('a previous business date is stale and anything older falls back with the source and reason', async () => {
  const previous = await readRecommendationWaste(database(compact('2026-11-26')), restaurantId, serviceDate, now);
  assert.equal(previous.input.stale, true);
  assert.equal(previous.batches.some(row => row.batchId === 'past-use-by'), false);
  const older = await readRecommendationWaste(database(compact('2026-11-25')), restaurantId, serviceDate, now);
  assert.deepEqual(older, {
    input: {
      mode: 'legacy', reason: 'assessment_too_old', assessment_id: 'assessment-1',
      assessment_date: '2026-11-25', inventory_cutoff: '2026-11-26',
    },
    batches: null,
  });
});

test('the off switch and an absent compact assessment keep generation on existing inputs', async () => {
  for (const reason of ['switch_off', 'projections_disabled', 'no_compact_assessment']) {
    const input = { mode: 'legacy', reason };
    assert.deepEqual(await readRecommendationWaste(database(input), restaurantId, serviceDate, now), {
      input, batches: null,
    });
  }
  const empty = compact();
  empty.result.items = [];
  const selected = await readRecommendationWaste(database(empty), restaurantId, serviceDate, now);
  assert.equal(selected.input.mode, 'assessment');
  assert.deepEqual(selected.batches, []);
});

test('a reader error records a fallback reason and leaves generation on existing inputs', async () => {
  const result = await readRecommendationWaste(database(null, { code: '57014', message: 'timeout' }), restaurantId, serviceDate, now);
  assert.deepEqual(result, { input: { mode: 'legacy', reason: 'assessment_read_failed' }, batches: null });
});

test('scoring and the weighted prompt accept verified use-by today while legacy day zero stays excluded', async () => {
  const { batches } = await readRecommendationWaste(database(compact()), restaurantId, serviceDate, now);
  const cases = [
    { name: 'Projected', expiringIngredients: [{ ...batches[0], name: 'Basil' }] },
    { name: 'Legacy', expiringIngredients: [{ ingredientId: 'legacy', name: 'Parsley', daysLeft: 0 }] },
    { name: 'Overdue', expiringIngredients: [{ ingredientId: 'past', name: 'Chives', daysLeft: -1, useByDate: '2026-11-27' }] },
  ];
  const { candidates, shortlist, config } = scoreRecommendationCandidates(cases);
  assert.equal(candidates.find(item => item.name === 'Projected').recommendationScoring.scores.inventory, 100);
  assert.equal(candidates.find(item => item.name === 'Legacy').recommendationScoring.scores.inventory, null);
  assert.equal(candidates.find(item => item.name === 'Overdue').recommendationScoring.scores.inventory, null);
  assert.match(buildWeightedPrompt(shortlist, [], 'Saturday', serviceDate, config), /"useByDate": "2026-11-28"/);
});

test('saved dashboard tickets use their own compact assessment and immediately omit a newly handled batch', async () => {
  const db = database(compact());
  const view = await readWasteAssessment(db, restaurantId, now);
  const { input, batches } = await readRecommendationWaste(db, restaurantId, serviceDate, now);
  const ticketDate = new Date(now);
  assert.deepEqual(projectedWasteForSavedTicket(view, input, ticketDate), batches);
  const handled = addPendingWasteDisposal(view, { id: 'confirmation', invoiceItemId: 'until-today' });
  assert.deepEqual(projectedWasteForSavedTicket(handled, input, ticketDate).map(row => row.batchId), ['tomorrow', 'unvalued']);
  assert.deepEqual(projectedWasteForSavedTicket(view, input, new Date('2026-11-29T08:00:00Z')).map(row => row.batchId), ['tomorrow', 'unvalued']);
  assert.deepEqual(projectedWasteForSavedTicket({ ...view, assessment_id: 'newer' }, input, ticketDate), []);
  assert.equal(projectedWasteForSavedTicket({ mode: 'legacy', reason: 'switch_off' }, input, ticketDate), null);
  assert.equal(projectedWasteForSavedTicket(view, { mode: 'legacy' }, ticketDate), null);
});