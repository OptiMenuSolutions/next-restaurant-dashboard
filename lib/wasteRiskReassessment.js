import { assessProjectedWasteRisk } from './wasteRiskProjection.js';
import { projectionVolumeDigest as digest } from './projections/volumeProvenance.js';

export const WASTE_REASSESSMENT_REASONS = Object.freeze([
  'invoice_quantity_or_date', 'physical_count', 'confirmed_disposal',
  'storage_or_shelf_life', 'dish_removal', 'confirmed_closure',
]);
const hash = ({ digest: ignored, ...value }) => ({ ...value, digest: digest(value) });
const fail = message => { throw Object.assign(new TypeError(message), { code: 'WASTE_REASSESSMENT_INVALID' }); };

// Internal calculation only. The database independently authorizes actor, scope
// and reason. This is not an owner-controlled reset switch or an API handler.
export function reassessProjectedWasteRisk(input, correction) {
  const { reason, batch_ids: batches, ingredient_ids: ingredients,
    business_dates: dates, dish_ids: dishes } = correction || {};
  if (!WASTE_REASSESSMENT_REASONS.includes(reason) || correction.restaurant_id !== input.restaurantId ||
    ![batches, ingredients, dates, dishes].every(Array.isArray)) fail('Invalid reassessment scope.');
  // Verify every original digest and invariant before deriving a changed state.
  assessProjectedWasteRisk(input);
  const frozen = { demands: (input.frozen?.demands || []).map(r => structuredClone(r)),
    cases: (input.frozen?.cases || []).map(r => structuredClone(r)) };
  const stock = new Map(input.batches.map(b => [b.id, b]));
  for (const row of frozen.cases) {
    if (!batches.includes(row.batch_id)) continue;
    const lot = stock.get(row.batch_id);
    if (!lot || lot.ingredient_id !== row.ingredient_id || !lot.received_date || !lot.use_by_date) {
      fail('A correction cannot replace an ingredient or invent batch dates.');
    }
    const metadataChanged = lot.received_date !== row.received_date || lot.use_by_date !== row.use_by_date;
    if (metadataChanged && !['invoice_quantity_or_date', 'storage_or_shelf_life'].includes(reason)) {
      fail('This reason cannot change batch dates.');
    }
    row.coverage_through ||= row.use_by_date;
    row.received_date = lot.received_date;
    row.use_by_date = lot.use_by_date;
    row.baseline_at = input.assessedAt;
    row.last_correction_id = correction.id;
    Object.assign(row, hash(row));
  }
  if (['confirmed_closure', 'dish_removal'].includes(reason)) {
    if (!dates.length || !ingredients.length || (reason === 'dish_removal' && !dishes.length)) {
      fail('Demand corrections need explicit dates, ingredients and removed dishes.');
    }
    for (const row of frozen.demands) {
      if (!ingredients.includes(row.ingredient_id) || !dates.includes(row.business_date)) continue;
      if (row.business_date <= input.inventoryCutoff) fail('Elapsed demand cannot be reassessed.');
      const b = row.basis;
      if (reason === 'confirmed_closure') b.night_low = 0;
      else {
        b.contributions = b.contributions.filter(c => !dishes.includes(c.dish_id));
        b.uncovered_dishes = (b.uncovered_dishes || []).filter(c => !dishes.includes(c.dish_id));
        b.uncovered_share = b.uncovered_dishes.reduce((n, c) => n + c.share, 0);
        b.may_be_overstated = b.uncovered_share > 0;
        b.weighted_portion = b.contributions.reduce((n, c) => n + c.share * c.portion, 0);
      }
      row.quantity = b.night_low * b.weighted_portion;
      row.last_correction_id = correction.id;
      row.reassessed_at = input.assessedAt;
      Object.assign(row, hash(row));
    }
  }
  return assessProjectedWasteRisk({ ...input, frozen });
}