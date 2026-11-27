import { projectionDayNumber } from '../projections/eligibility.js';
import { restaurantLocalDate } from '../restaurantTime.js';
import { isProtein } from '../shelfLife.js';
import { readWasteAssessment, selectWasteAssessmentForDish } from '../wasteAssessmentReader.js';

export function hasUsableWasteDate(ingredient) {
  const days = ingredient.daysLeft;
  return Number.isFinite(days) && (days > 0 || (days === 0 && !!ingredient.useByDate));
}

function projectedDishWasteBatches(view, serviceDate) {
  const serviceDay = projectionDayNumber(serviceDate);
  const pending = new Set(view.pending_disposals.map(row => row.batch_id));
  const eligible = [];
  for (const row of view.items) {
    if (row.status !== 'ok' || !row.ingredient_id || !row.use_by_date ||
        row.pending_disposal || pending.has(row.batch_id) ||
        !Number.isFinite(row.risk_qty) || row.risk_qty <= 0) continue;
    const daysLeft = projectionDayNumber(row.use_by_date) - serviceDay;
    if (daysLeft < 0 || daysLeft > 5) continue;
    eligible.push({
      batchId: row.batch_id,
      ingredientId: row.ingredient_id,
      useByDate: row.use_by_date,
      daysLeft,
      unit: row.unit,
      quantity: row.risk_qty,
    });
  }
  return eligible.sort((a, b) => a.daysLeft - b.daysLeft || a.batchId.localeCompare(b.batchId));
}

export async function readRecommendationWaste(db, restaurantId, serviceDate, observedAt, options) {
  try {
    const view = selectWasteAssessmentForDish(await readWasteAssessment(db, restaurantId, observedAt, options));
    if (view.mode === 'legacy') return { input: view, batches: null };
    const localDate = restaurantLocalDate(view.timezone, new Date(observedAt));
    const targetDate = serviceDate > localDate ? serviceDate : localDate;
    return {
      input: {
        mode: 'assessment',
        assessment_id: view.assessment_id,
        assessment_date: view.assessment_date,
        inventory_cutoff: view.inventory_cutoff,
        service_date: targetDate,
        stale: view.stale,
      },
      batches: projectedDishWasteBatches(view, targetDate),
    };
  } catch (error) {
    console.warn('[recommendation-waste] Assessment read failed:', restaurantId, error.code || 'READ_FAILED');
    return { input: { mode: 'legacy', reason: 'assessment_read_failed' }, batches: null };
  }
}

// null selects the existing ticket decoration. An empty array keeps an
// assessment-backed ticket clear when its original input is unavailable.
export function projectedWasteForSavedTicket(view, input, now = new Date()) {
  if (input?.mode !== 'assessment' || view?.mode === 'legacy') return null;
  if (view?.mode !== 'assessment' || view.assessment_id !== input.assessment_id ||
      selectWasteAssessmentForDish(view).mode !== 'assessment') return [];
  const today = restaurantLocalDate(view.timezone, now);
  const elapsed = Math.max(0, projectionDayNumber(today) - projectionDayNumber(input.service_date));
  return projectedDishWasteBatches(view, input.service_date)
    .filter(batch => batch.daysLeft >= elapsed)
    .map(batch => ({ ...batch, daysLeft: batch.daysLeft - elapsed }));
}

export function nameProjectedWasteBatches(batches, menuItems) {
  const names = new Map();
  for (const item of menuItems) {
    for (const component of item.menu_item_components || []) {
      for (const line of component.component_ingredients || []) {
        const ingredient = line.ingredients;
        if (ingredient?.id) names.set(ingredient.id, ingredient.name);
      }
    }
  }
  const earliest = new Map();
  for (const batch of batches) {
    const name = names.get(batch.ingredientId);
    if (!name || earliest.has(batch.ingredientId)) continue;
    earliest.set(batch.ingredientId, { ...batch, name, isProtein: isProtein(name) });
  }
  return [...earliest.values()];
}

function evidenceList(ingredients) {
  return ingredients.filter(hasUsableWasteDate).map(row => ({
    ingredient_id: row.ingredientId ?? null, name: row.name, days_left: row.daysLeft,
    ...(row.useByDate ? { use_by_date: row.useByDate } : {}),
    ...(row.batchId ? { batch_id: row.batchId } : {}),
  }));
}

export async function collectRecommendationWasteEvidence({
  db, restaurantId, serviceDate, observedAt, actual, ingredients, menuItems, loadLegacy,
}) {
  const needsShadow = ['switch_off', 'assessment_read_failed'].includes(actual.input.reason);
  const projected = needsShadow
    ? await readRecommendationWaste(db, restaurantId, serviceDate, observedAt, { shadow: true })
    : actual;
  if (projected.input.reason === 'projections_disabled') return null;

  const actualIngredients = evidenceList(ingredients);
  let legacyIngredients = null;
  if (actual.input.mode === 'assessment') {
    try { legacyIngredients = evidenceList(await loadLegacy(restaurantId)); }
    catch (error) {
      console.warn('[recommendation-waste] Legacy evidence unavailable:', restaurantId, error.code || 'READ_FAILED');
    }
  }

  return {
    observed_at: observedAt,
    projected_input: projected.input,
    actual_ingredients: actualIngredients,
    projected_ingredients: projected.batches === null || !menuItems
      ? null : evidenceList(nameProjectedWasteBatches(projected.batches, menuItems)),
    ...(actual.input.mode === 'assessment' && { legacy_ingredients: legacyIngredients }),
  };
}