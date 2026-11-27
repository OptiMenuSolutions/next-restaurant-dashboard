import { shiftProjectionDate } from './projections/businessTime.js';

const LEGACY_REASONS = new Set(['switch_off', 'projections_disabled', 'no_compact_assessment']);

export async function readWasteAssessment(
  db, restaurantId, observedAt = new Date().toISOString(), { previewActor, shadow = false } = {}
) {
  const params = { target: restaurantId, observed_at: observedAt };
  const { data, error } = previewActor
    ? await db.rpc('waste_projection_preview_surface', { ...params, actor: previewActor })
    : await db.rpc(shadow ? 'waste_projection_shadow_surface' : 'waste_projection_read_surface', params);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (data?.mode === 'legacy' && LEGACY_REASONS.has(data.reason)) {
    return { mode: 'legacy', reason: data.reason };
  }

  const result = data?.result;
  if (data?.mode !== 'assessment' || data.restaurant_id !== restaurantId ||
      result?.restaurant_id !== restaurantId || result.result_schema_version !== 2 ||
      result.assessment_date !== data.assessment_date || result.inventory_cutoff !== data.inventory_cutoff ||
      !data.assessment_id || !data.inventory_boundary || !data.timezone ||
      !Array.isArray(result.items) || !Array.isArray(result.needs_review) ||
      !result.omitted_by_status || Array.isArray(result.omitted_by_status) ||
      typeof result.omitted_by_status !== 'object' || !Array.isArray(data.pending_disposals)) {
    throw new Error('Invalid waste assessment response');
  }

  const businessDate = shiftProjectionDate(data.business_date, 0);
  const assessmentDate = shiftProjectionDate(data.assessment_date, 0);
  if (assessmentDate > businessDate) throw new Error('Waste assessment is dated in the future');

  const pendingBatchIds = new Set(data.pending_disposals.map(row => row.batch_id));
  const toRow = row => {
    const pending = pendingBatchIds.has(row.batch_id);
    return {
      batch_id: row.batch_id,
      ingredient_id: row.ingredient_id,
      received_date: row.received_date,
      use_by_date: row.use_by_date,
      remaining_qty: row.remaining_qty,
      unit: row.unit,
      stock_remaining_qty: row.stock_remaining_qty ?? row.remaining_qty,
      stock_unit: row.stock_unit ?? row.unit,
      status: row.status,
      reason: row.reason,
      risk_qty: pending ? null : row.risk_qty,
      risk_value: pending ? null : row.risk_value,
      visible: !pending && row.visible === true,
      pending_disposal: pending,
      may_be_overstated: row.may_be_overstated === true,
    };
  };
  const forecast = result.forecast;
  return {
    mode: 'assessment',
    restaurant_id: restaurantId,
    assessment_id: data.assessment_id,
    assessment_date: assessmentDate,
    business_date: businessDate,
    inventory_cutoff: data.inventory_cutoff,
    inventory_boundary: data.inventory_boundary,
    inventory_timezone: data.inventory_timezone ?? data.timezone,
    timezone: data.timezone,
    stale: assessmentDate < businessDate,
    forecast_fallback: result.forecast_fallback === true,
    forecast: forecast ? {
      run_id: forecast.run_id,
      run_date: forecast.run_date,
      issued_at: forecast.issued_at,
      source_through: forecast.source_through,
    } : null,
    items: result.items.map(toRow),
    needs_review: result.needs_review.map(toRow),
    omitted_by_status: result.omitted_by_status,
    pending_disposals: data.pending_disposals,
  };
}

export function selectWasteAssessmentForDish(view) {
  if (view.mode === 'assessment' &&
      view.assessment_date < shiftProjectionDate(view.business_date, -1)) {
    return {
      mode: 'legacy', reason: 'assessment_too_old',
      assessment_id: view.assessment_id, assessment_date: view.assessment_date,
      inventory_cutoff: view.inventory_cutoff,
    };
  }
  return view;
}