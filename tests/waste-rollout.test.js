import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWasteCards } from '../lib/admin/wasteRollout.js';
import { collectRecommendationWasteEvidence } from '../lib/ai/recommendationWaste.js';

const target = 'restaurant';
const observedAt = '2026-11-28T11:00:00Z';
const serviceDate = '2026-11-28';
const legacy = [{ ingredientId: 'leaf', name: 'Chives', daysLeft: 1 }];
const menus = [{
  menu_item_components: [{ component_ingredients: [{ ingredients: { id: 'leaf', name: 'Chives' } }] }],
}];
const off = { input: { mode: 'legacy', reason: 'switch_off' }, batches: null };

function projected(date) {
  return {
    mode: 'assessment', restaurant_id: target, assessment_id: 'assessment', assessment_date: date,
    inventory_cutoff: '2026-11-25', inventory_boundary: '2026-11-26T09:00:00Z', business_date: serviceDate,
    timezone: 'America/New_York', pending_disposals: [{ batch_id: 'pending' }],
    result: {
      result_schema_version: 2, restaurant_id: target, assessment_date: date, inventory_cutoff: '2026-11-25',
      omitted_by_status: {}, needs_review: [],
      items: [
        { batch_id: 'usable', ingredient_id: 'leaf', status: 'ok', use_by_date: serviceDate, risk_qty: 3 },
        { batch_id: 'pending', ingredient_id: 'leaf', status: 'ok', use_by_date: serviceDate, risk_qty: 2 },
        { batch_id: 'expired', ingredient_id: 'leaf', status: 'ok', use_by_date: '2026-11-27', risk_qty: 1 },
      ],
    },
  };
}

function shadow(data, actual = off, loadLegacy = async () => legacy) {
  return collectRecommendationWasteEvidence({
    db: { rpc: async (name, args) => {
      assert.equal(name, 'waste_projection_shadow_surface');
      assert.deepEqual(args, { target, observed_at: observedAt });
      return { data };
    } },
    restaurantId: target, serviceDate, observedAt, actual, ingredients: legacy, menuItems: menus, loadLegacy,
  });
}

test('Off shadow evidence preserves the actual ingredients and applies the Stage 4 filters', async () => {
  const evidence = await shadow(projected('2026-11-27'));
  assert.equal(evidence.projected_input.stale, true);
  assert.deepEqual(evidence.actual_ingredients, [{ ingredient_id: 'leaf', name: 'Chives', days_left: 1 }]);
  assert.equal(evidence.legacy_ingredients, undefined);
  assert.deepEqual(evidence.projected_ingredients, [{
    ingredient_id: 'leaf', name: 'Chives', days_left: 0, use_by_date: serviceDate, batch_id: 'usable',
  }]);
  assert.equal(off.input.reason, 'switch_off');
});

test('disabled projection restaurants skip evidence and a too-old assessment records the shared fallback', async () => {
  assert.equal(await shadow({ mode: 'legacy', reason: 'projections_disabled' }), null);
  const result = await shadow(projected('2026-11-26'));
  assert.equal(result.projected_input.reason, 'assessment_too_old');
  assert.equal(result.projected_ingredients, null);
});

test('On shadow evidence reuses the assessment and preserves evidence when the legacy read fails', async () => {
  const actual = { input: { mode: 'assessment', assessment_id: 'assessment' },
    batches: [{ batchId: 'usable', ingredientId: 'leaf', useByDate: serviceDate, daysLeft: 0 }] };
  const result = await shadow(null, actual, async () => { throw new Error('legacy unavailable'); });
  assert.equal(result.projected_ingredients[0].batch_id, 'usable');
  assert.equal(result.legacy_ingredients, null);
});

test('compares dated matching batches and retains known totals and reasons', () => {
  const legacyRows = [
    { invoice_item_id: 'old', ingredient_name: 'Chives', days_left: 8, remaining_qty: 2, total_value: 9 },
    { invoice_item_id: 'same', ingredient_name: 'Basil', days_left: 2, remaining_qty: 4, total_value: null },
  ];
  const assessment = {
    needs_review: [{ batch_id: 'old', status: 'unavailable', reason: 'link_ingredient' }],
    items: [
      { batch_id: 'same', status: 'ok', visible: true, risk_qty: 3, unit: 'lb', risk_value: 5 },
      { batch_id: 'new', ingredient_id: 'leaf', status: 'ok', visible: true, risk_qty: 1, unit: 'lb', risk_value: 2 },
    ],
    pending_batch_ids: [],
    omitted: { overdue: { count: 3, risk_value: 20, unvalued_count: 1 },
      needs_review: { count: 6, by_reason: { link_ingredient: 6 } } },
  };
  const result = compareWasteCards(legacyRows, assessment, new Map([['leaf', 'Mint']]), 1);
  assert.deepEqual(result.rows.map(row => [row.name, row.reason]), [
    ['Chives', 'link_ingredient'], ['Basil', null], ['Mint', 'No batch in the dated invoice snapshot.'],
  ]);
  assert.equal(result.legacy.knownValue, 9);
  assert.equal(result.legacy.unvalued, 1);
  assert.deepEqual(result.projected, { count: 5, knownValue: 27, unvalued: 1, amounts: [['lb', 4]] });
  assert.deepEqual(result.review, [['link_ingredient', 7]]);
  assert.equal(compareWasteCards([], assessment, new Map(), 1).legacy, null);
});