import { validateProjectionSettings, projectionSettingsDigest } from './projections/settings.js';
import { convertIngredientQuantity } from './ingredientUnitConversions.js';
import { projectionBusinessDate, projectionInstant, shiftProjectionDate as shift } from './projections/businessTime.js';
import { projectionVolumeDigest as digest, projectionDeepFreeze as freeze } from './projections/volumeProvenance.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const check = (ok, message) => {
  if (!ok) throw Object.assign(new TypeError(message), { code: 'WASTE_RISK_PROJECTION_INVALID' });
};
const date = value => shift(value, 0);
const dayNumber = value => Date.parse(`${date(value)}T00:00:00Z`) / 86400000;
const key = (id, day) => `${id}:${day}`;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const positive = (quantity, allowance) => quantity - allowance > 1e-9 * Math.max(1, quantity);
const hashed = value => ({ ...value, digest: digest(value) });

function verified(row) {
  const { digest: saved, ...value } = row;
  check(typeof saved === 'string' && saved === digest(value), 'Frozen record digest does not match.');
  return value;
}

// These are calculation inputs, not live readers. The persistence layer must
// authorize archived forecasts, complete inventory snapshots and corrections.
export function assessProjectedWasteRisk(input) {
  const { restaurantId, assessmentDate, assessedAt, inventoryCutoff, timeZone,
    cutoffMinutes, ingredients, batches, forecast = null, recipes = [],
    frozen = { demands: [], cases: [] } } = input;
  check(UUID.test(restaurantId || ''), 'Restaurant context is required.');
  date(assessmentDate); date(inventoryCutoff);
  const at = projectionInstant(assessedAt);
  const policy = input.resolvedSettings;
  const settings = validateProjectionSettings(policy?.settings);
  check(policy.restaurant_id === restaurantId && policy.model_major === 4 &&
    UUID.test(policy.global_version_id || '') &&
    (policy.restaurant_version_id === null || UUID.test(policy.restaurant_version_id || '')) &&
    policy.settings_digest === projectionSettingsDigest(settings) &&
    Object.hasOwn(settings, 'waste_recipe_uncovered_share_max'), 'A stored waste-risk settings version is required.');
  const coverageLimit = settings.waste_recipe_uncovered_share_max;
  check(projectionBusinessDate(assessedAt, timeZone, cutoffMinutes) === assessmentDate,
    'Assessment must use the restaurant business date.');
  check(inventoryCutoff < assessmentDate && input.inventoryComplete === true,
    'A complete, earlier business-date inventory cutoff is required.');
  for (const rows of [ingredients, batches, recipes, frozen.demands, frozen.cases]) {
    check(Array.isArray(rows), 'Complete input arrays are required.');
  }
  const owned = row => check(row?.restaurant_id === restaurantId, 'Inputs cross restaurants.');
  const catalog = new Map();
  for (const row of ingredients) {
    owned(row);
    check(UUID.test(row.id || '') && !catalog.has(row.id) &&
      (row.unit === null || (typeof row.unit === 'string' && row.unit.trim())),
      'Invalid or duplicate ingredient.');
    catalog.set(row.id, structuredClone(row));
  }
  const recipeDays = new Map(), recipeIds = new Set();
  for (const row of recipes) {
    owned(row); date(row.business_date);
    check(UUID.test(row.dish_id || '') && typeof row.active === 'boolean' &&
      typeof row.complete === 'boolean' && Array.isArray(row.portions), 'Invalid recipe record.');
    const id = key(row.dish_id, row.business_date);
    check(!recipeIds.has(id), 'Duplicate recipe record.'); recipeIds.add(id);
    for (const part of row.portions) {
      check((part.ingredient_id === null || catalog.has(part.ingredient_id)) &&
        (part.quantity === null || (finite(part.quantity) && part.quantity >= 0)) &&
        (part.unit === null || typeof part.unit === 'string'), 'Invalid recipe portion.');
    }
    if (!recipeDays.has(row.business_date)) recipeDays.set(row.business_date, []);
    recipeDays.get(row.business_date).push(structuredClone(row));
  }
  for (const rows of recipeDays.values()) rows.sort((a, b) => order(a.dish_id, b.dish_id));
  const forecastDays = new Map();
  let forecastInfo = null;
  if (forecast !== null) {
    owned(forecast); date(forecast.run_date); date(forecast.source_through);
    const issued = projectionInstant(forecast.issued_at);
    check(UUID.test(forecast.id || '') && issued <= at && forecast.run_date <= assessmentDate &&
      forecast.source_through < forecast.run_date && Number.isSafeInteger(forecast.model_major) &&
      forecast.model_major > 0 && typeof forecast.calibration_key === 'string' && forecast.calibration_key &&
      Array.isArray(forecast.nights) && forecast.nights.length === 8, 'Invalid archived forecast context.');
    forecast.nights.forEach((night, index) => {
      check(night.business_date === shift(forecast.run_date, index) &&
        ['available', 'closed', 'needs_baseline'].includes(night.availability) &&
        (night.low === null || (finite(night.low) && night.low >= 0)) && Array.isArray(night.dishes),
      'Invalid archived forecast night.');
      check(night.availability !== 'closed' || night.low === 0, 'Closed night must have zero demand.');
      const ids = new Set(); let shares = 0;
      for (const dish of night.dishes) {
        check(UUID.test(dish.dish_id || '') && !ids.has(dish.dish_id) && typeof dish.active === 'boolean' &&
          ['ok', 'inactive', 'needs_baseline'].includes(dish.status) &&
          (dish.share === null || (finite(dish.share) && dish.share >= 0 && dish.share <= 1)),
        'Invalid or duplicate archived dish.');
        ids.add(dish.dish_id); shares += dish.active ? dish.share ?? 0 : 0;
      }
      check(shares <= 1 + 1e-9, 'Archived shares exceed one.');
      forecastDays.set(night.business_date, structuredClone(night));
    });
    forecastInfo = { run_id: forecast.id, run_date: forecast.run_date, issued_at: forecast.issued_at,
      source_through: forecast.source_through, model_major: forecast.model_major,
      calibration_key: forecast.calibration_key,
      age_business_days: dayNumber(assessmentDate) - dayNumber(forecast.run_date),
      age_hours: (at - issued) / 3600000 };
  }
  const fixed = new Map(), cases = new Map();
  for (const raw of frozen.demands) {
    owned(raw); const row = verified(raw); date(row.business_date);
    const ingredient = catalog.get(row.ingredient_id), k = key(row.ingredient_id, row.business_date);
    check(ingredient && !fixed.has(k) && typeof row.unit === 'string' && finite(row.quantity) && row.quantity >= 0 &&
      projectionInstant(row.frozen_at) <= at && UUID.test(row.frozen_by_batch_id || '') &&
      UUID.test(row.basis?.run_id || '') && finite(row.basis.night_low) && row.basis.night_low >= 0 &&
      finite(row.basis.weighted_portion) && row.basis.weighted_portion >= 0 &&
      row.quantity === row.basis.night_low * row.basis.weighted_portion, 'Invalid frozen demand.');
    date(row.basis.run_date); date(row.basis.source_through);
    check(projectionInstant(row.basis.issued_at) <= projectionInstant(row.frozen_at) &&
      row.basis.source_through < row.basis.run_date && row.business_date >= row.basis.run_date &&
      row.business_date <= shift(row.basis.run_date, 7), 'Frozen forecast provenance is invalid.');
    fixed.set(k, structuredClone(raw));
  }
  for (const raw of frozen.cases) {
    owned(raw); const row = verified(raw); date(row.received_date); date(row.use_by_date); date(row.first_positive_date); date(row.inventory_cutoff);
    check(UUID.test(row.batch_id || '') && catalog.has(row.ingredient_id) && !cases.has(row.batch_id) &&
      typeof row.unit === 'string' && finite(row.initial_risk_qty) && row.initial_risk_qty > 0 &&
      projectionInstant(row.first_positive_at) <= at && row.first_positive_date <= assessmentDate &&
      row.inventory_cutoff < row.first_positive_date && row.inventory_cutoff <= inventoryCutoff, 'Invalid frozen batch case.');
    cases.set(row.batch_id, structuredClone(raw));
  }
  for (const row of fixed.values()) {
    const owner = row.owner_snapshot || cases.get(row.frozen_by_batch_id);
    if (row.owner_snapshot) verified(row.owner_snapshot);
    check(owner && owner.restaurant_id === restaurantId && owner.batch_id === row.frozen_by_batch_id && owner.ingredient_id === row.ingredient_id && owner.unit === row.unit &&
      projectionInstant(owner.baseline_at || owner.first_positive_at) <= projectionInstant(row.frozen_at) && row.business_date <= owner.use_by_date,
    'Frozen demand must belong to its original positive batch case.');
  }
  const stock = [], seen = new Set();
  for (const row of batches) {
    owned(row);
    check(UUID.test(row.id || '') && !seen.has(row.id) && finite(row.remaining_qty) && row.remaining_qty >= 0 &&
      (row.unit === null || typeof row.unit === 'string') &&
      (row.unit_cost === null || (finite(row.unit_cost) && row.unit_cost >= 0)) &&
      (row.ingredient_id === null || catalog.has(row.ingredient_id)), 'Invalid, duplicate or foreign batch.');
    seen.add(row.id);
    if (row.received_date !== null) date(row.received_date);
    if (row.use_by_date !== null) date(row.use_by_date);
    check(!row.received_date || !row.use_by_date || row.received_date <= row.use_by_date, 'Reversed batch dates.');
    const ingredient = catalog.get(row.ingredient_id);
    let reason = !ingredient ? 'link_ingredient' : !row.received_date ? 'unknown_fifo_date' :
      !row.use_by_date ? 'unknown_use_by_date' : !ingredient.unit ? 'missing_ingredient_unit' :
      !row.unit ? 'missing_inventory_unit' : null;
    const conversion = ingredient && row.unit
      ? convertIngredientQuantity(1, row.unit, ingredient.unit, ingredient) : null;
    if (!reason && !conversion) reason = 'inventory_conversion_required';
    const quantity = conversion ? row.remaining_qty * conversion.quantity : null;
    const cost = conversion && row.unit_cost !== null ? row.unit_cost / conversion.quantity : null;
    check(quantity === null || (finite(quantity) && quantity >= 0), 'Inventory quantity overflow.');
    check(cost === null || (finite(cost) && cost >= 0), 'Inventory cost overflow.');
    const previous = cases.get(row.id);
    if (previous && (previous.ingredient_id !== row.ingredient_id || previous.unit !== ingredient?.unit ||
      previous.received_date !== row.received_date || previous.use_by_date !== row.use_by_date)) {
      reason ||= 'baseline_reassessment_required';
    }
    stock.push({ ...structuredClone(row), quantity, cost, canonical_unit: ingredient?.unit ?? null,
      reason, allowance: 0, allocations: [], simulated: quantity });
  }
  stock.sort((a, b) => order(a.received_date ?? '', b.received_date ?? '') || order(a.id, b.id));
  const newDemands = [], newCases = [], demandTrace = [], firstMissing = new Map();
  const start = shift(inventoryCutoff, 1), horizon = shift(assessmentDate, 7);

  function demand(ingredient, businessDate) {
    const saved = fixed.get(key(ingredient.id, businessDate));
    if (saved) return saved.unit === ingredient.unit
      ? { quantity: saved.quantity, basis: saved.basis, frozen: true }
      : { reason: 'frozen_unit_requires_reassessment' };
    if ([...cases.values()].some(c => c.ingredient_id === ingredient.id &&
      c.inventory_cutoff < businessDate && businessDate <= (c.coverage_through || c.use_by_date))) {
      return { reason: 'frozen_coverage_missing' };
    }
    if (!forecastInfo) return { reason: 'forecast_unavailable' };
    if (forecastInfo.source_through > inventoryCutoff) return { reason: 'inventory_behind_forecast' };
    const night = forecastDays.get(businessDate);
    if (!night) return { reason: 'forecast_horizon_missing' };
    if (night.availability === 'needs_baseline' || night.low === null) return { reason: 'night_forecast_unavailable' };
    const basis = { run_id: forecastInfo.run_id, run_date: forecastInfo.run_date,
      issued_at: forecastInfo.issued_at, source_through: forecastInfo.source_through,
      model_major: forecastInfo.model_major, calibration_key: forecastInfo.calibration_key,
      night_low: night.low, weighted_portion: 0, contributions: [],
      uncovered_dishes: [], uncovered_share: 0, may_be_overstated: false,
      recipe_coverage_limit: coverageLimit,
      settings_version: { global_version_id: policy.global_version_id,
        restaurant_version_id: policy.restaurant_version_id, settings_digest: policy.settings_digest } };
    if (night.availability === 'closed') return { quantity: 0, basis, frozen: false };
    const rows = (recipeDays.get(businessDate) ?? []).filter(r => r.active);
    const byDish = new Map(rows.map(r => [r.dish_id, r]));
    const forecasts = new Map(night.dishes.filter(d => d.active).map(d => [d.dish_id, d]));
    const completeRecipe = r => r?.complete && r.portions.length > 0 &&
      r.portions.every(p => p.ingredient_id !== null && finite(p.quantity) && p.unit);
    for (const projected of forecasts.values()) {
      if (projected.share === 0 || completeRecipe(byDish.get(projected.dish_id))) continue;
      basis.uncovered_dishes.push({ dish_id: projected.dish_id, share: projected.share,
        reason: byDish.has(projected.dish_id) ? 'recipe_incomplete' : 'recipe_missing' });
      if (projected.share === null) {
        return { reason: 'recipe_coverage_incomplete', coverage: { ...basis, uncovered_share: null } };
      }
      basis.uncovered_share += projected.share;
    }
    if (basis.uncovered_share > coverageLimit + Number.EPSILON * Math.max(1, forecasts.size)) {
      return { reason: 'recipe_coverage_incomplete', coverage: basis };
    }
    basis.may_be_overstated = basis.uncovered_share > 0;
    for (const recipe of rows) {
      const projected = forecasts.get(recipe.dish_id);
      if (projected?.share === 0) continue;
      if (!completeRecipe(recipe)) {
        if (!projected) return { reason: 'recipe_coverage_incomplete', coverage: { ...basis, uncovered_share: null } };
        continue;
      }
      const parts = recipe.portions.filter(p => p.ingredient_id === ingredient.id);
      if (!parts.length) continue;
      if (!projected || projected.status !== 'ok' || projected.share === null) return { reason: 'ingredient_dish_forecast_unavailable' };
      const portions = [];
      for (const part of parts) {
        if (part.quantity === null || !part.unit) return { reason: 'ingredient_recipe_incomplete' };
        const converted = convertIngredientQuantity(part.quantity, part.unit, ingredient.unit, ingredient);
        if (!converted) return { reason: 'ingredient_conversion_required' };
        portions.push({ quantity: part.quantity, unit: part.unit, converted_quantity: converted.quantity,
          conversion_id: converted.conversionId, estimated: converted.estimated });
      }
      const portion = portions.reduce((sum, p) => sum + p.converted_quantity, 0);
      basis.weighted_portion += projected.share * portion;
      basis.contributions.push({ dish_id: recipe.dish_id, share: projected.share, portion, portions });
    }
    const quantity = basis.night_low * basis.weighted_portion;
    check(finite(quantity) && quantity >= 0, 'Ingredient demand overflow.');
    return { quantity, basis, frozen: false };
  }

  for (const ingredient of [...catalog.values()].sort((a, b) => order(a.id, b.id))) {
    const lots = stock.filter(b => b.ingredient_id === ingredient.id && b.remaining_qty > 0 &&
      (!b.received_date || b.received_date <= inventoryCutoff));
    const candidates = lots.filter(b => b.use_by_date && b.use_by_date <= horizon);
    if (!candidates.length) continue;
    const end = candidates.map(b => b.use_by_date).sort().at(-1);
    if (lots.some(b => b.reason)) { firstMissing.set(ingredient.id, { date: start, reason: 'inventory_context_incomplete' }); continue; }
    const available = [];
    for (let businessDate = start; businessDate <= end; businessDate = shift(businessDate, 1)) {
      const row = demand(ingredient, businessDate);
      if (row.reason) { firstMissing.set(ingredient.id, { date: businessDate, reason: row.reason, coverage: row.coverage ?? null }); break; }
      let left = row.quantity;
      for (const lot of lots) {
        if (lot.received_date > businessDate || businessDate > lot.use_by_date || lot.simulated <= 0) continue;
        const take = Math.min(left, lot.simulated);
        if (take <= 0) continue;
        lot.simulated -= take; lot.allowance += take; left -= take;
        lot.allocations.push({ business_date: businessDate, quantity: take });
        if (left <= 0) break;
      }
      const trace = { ingredient_id: ingredient.id, business_date: businessDate, ...row,
        allocated: row.quantity - left, unused: left };
      demandTrace.push(trace); available.push(trace);
    }
    for (const lot of candidates) {
      const missing = firstMissing.get(ingredient.id);
      if (lot.reason || (missing && lot.use_by_date >= missing.date) || !positive(lot.quantity, lot.allowance)) continue;
      if (!cases.has(lot.id)) {
        const row = hashed({ restaurant_id: restaurantId, batch_id: lot.id, ingredient_id: ingredient.id,
          received_date: lot.received_date, use_by_date: lot.use_by_date, unit: ingredient.unit,
          first_positive_date: assessmentDate, first_positive_at: assessedAt, baseline_at: assessedAt,
          coverage_through: lot.use_by_date, inventory_cutoff: inventoryCutoff,
          initial_risk_qty: lot.quantity - lot.allowance });
        cases.set(lot.id, row); newCases.push(row);
      }
      for (const value of available.filter(d => d.business_date <= lot.use_by_date)) {
        const k = key(ingredient.id, value.business_date);
        if (fixed.has(k)) continue;
        const frozenRow = hashed({ restaurant_id: restaurantId, ingredient_id: ingredient.id,
          business_date: value.business_date, unit: ingredient.unit, quantity: value.quantity,
          basis: value.basis, frozen_at: assessedAt, frozen_by_batch_id: lot.id,
          owner_snapshot: structuredClone(cases.get(lot.id)) });
        fixed.set(k, frozenRow); newDemands.push(frozenRow);
      }
      const savedCase = cases.get(lot.id);
      if (savedCase.coverage_through < lot.use_by_date) {
        const { digest: unused, ...value } = savedCase;
        cases.set(lot.id, hashed({ ...value, coverage_through: lot.use_by_date }));
      }
    }
  }
  const items = stock.map(lot => {
    const future = lot.received_date && lot.received_date > inventoryCutoff;
    const missing = firstMissing.get(lot.ingredient_id);
    const overdue = lot.use_by_date && lot.use_by_date <= inventoryCutoff;
    const reason = lot.remaining_qty === 0 ? null : lot.reason ||
      (!future && lot.use_by_date <= horizon && !overdue && missing && lot.use_by_date >= missing.date ? missing.reason : null);
    const status = lot.remaining_qty === 0 ? 'depleted' : future ? 'outside_inventory_cutoff' :
      reason ? 'unavailable' : lot.use_by_date > horizon ? 'outside_risk_window' : overdue ? 'overdue' : 'ok';
    const valid = status === 'ok' || status === 'overdue' || status === 'depleted';
    const risk = valid ? positive(lot.quantity, lot.allowance) ? lot.quantity - lot.allowance : 0 : null;
    const value = risk === null || lot.cost === null ? null : risk * lot.cost;
    check(value === null || finite(value), 'At-risk value overflow.');
    const recipeCoverage = demandTrace.filter(d => d.ingredient_id === lot.ingredient_id &&
      d.business_date <= lot.use_by_date && d.basis.uncovered_share > 0).map(d => ({
      business_date: d.business_date, uncovered_share: d.basis.uncovered_share,
      uncovered_dishes: d.basis.uncovered_dishes, limit: d.basis.recipe_coverage_limit }));
    if (missing?.coverage && missing.date <= lot.use_by_date) recipeCoverage.push({
      business_date: missing.date, uncovered_share: missing.coverage.uncovered_share,
      uncovered_dishes: missing.coverage.uncovered_dishes, limit: missing.coverage.recipe_coverage_limit });
    return { batch_id: lot.id, ingredient_id: lot.ingredient_id, unit: lot.canonical_unit,
      received_date: lot.received_date, use_by_date: lot.use_by_date, status, reason,
      remaining_qty: lot.quantity, remaining_allowance: valid ? lot.allowance : null,
      risk_qty: risk, risk_value: value, unit_cost: lot.cost,
      visible: valid && risk > 0, may_be_overstated: recipeCoverage.some(c => c.uncovered_share > 0),
      recipe_coverage: recipeCoverage, allocations: lot.allocations,
      frozen_case: cases.has(lot.id) };
  });
  const sources = new Map();
  for (const row of demandTrace) {
    const b = row.basis;
    sources.set(b.run_id, { run_id: b.run_id, run_date: b.run_date, issued_at: b.issued_at,
      source_through: b.source_through, model_major: b.model_major, calibration_key: b.calibration_key,
      age_business_days: dayNumber(assessmentDate) - dayNumber(b.run_date),
      age_hours: (at - projectionInstant(b.issued_at)) / 3600000 });
  }
  const result = { restaurant_id: restaurantId, assessment_date: assessmentDate, assessed_at: assessedAt,
    inventory_cutoff: inventoryCutoff, settings_version: { global_version_id: policy.global_version_id,
      restaurant_version_id: policy.restaurant_version_id, settings_digest: policy.settings_digest }, forecast: forecastInfo,
    forecast_sources: [...sources.values()].sort((a, b) => order(a.run_id, b.run_id)), items,
    visible_items: items.filter(i => i.visible), needs_review: items.filter(i => i.status === 'unavailable'),
    demand_trace: demandTrace, new_demands: newDemands, new_cases: newCases,
    frozen: { demands: [...fixed.values()].sort((a, b) => order(key(a.ingredient_id, a.business_date), key(b.ingredient_id, b.business_date))),
      cases: [...cases.values()].sort((a, b) => order(a.batch_id, b.batch_id)) } };
  return freeze({ ...result, digest: digest(result) });
}