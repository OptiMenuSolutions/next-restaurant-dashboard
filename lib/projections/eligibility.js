import { shiftProjectionDate } from './businessTime.js';
import { canonicalProjectionHolidayKeys } from './holidayKeys.js';

export const PROJECTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEPT = new Set(['unchecked', 'normal', 'kept', 'confirmed_shift', 'active_run']);
const EXCLUDED = new Set(['excluded', 'isolated_outlier', 'short_run', 'provisional', 'pending_review', 'one_off_event']);

export function projectionVolumeError(message) {
  const error = new TypeError(message);
  error.code = 'PROJECTION_VOLUME_INVALID';
  throw error;
}

export function projectionDayNumber(date) {
  shiftProjectionDate(date, 0);
  return Date.parse(`${date}T00:00:00Z`) / 86400000;
}

export function projectionISOWeekday(date) {
  return ((projectionDayNumber(date) + 3) % 7 + 7) % 7 + 1;
}

// Shared volume eligibility for Steps 4, 5, 7 and 8. Dish-level treatment
// of recommended/sold-out nights is additional to this rule, never part of it.
export function projectionVolumeEligibility(night, { restaurantId, asOf }) {
  if (!PROJECTION_UUID.test(restaurantId || '')) projectionVolumeError('Restaurant context is required.');
  shiftProjectionDate(asOf, 0);
  if (!night || night.restaurant_id !== restaurantId) projectionVolumeError('History belongs to another restaurant.');
  shiftProjectionDate(night.business_date, 0);
  if (night.business_date >= asOf) return Object.freeze({ eligible: false, reasons: Object.freeze(['not_before_as_of']) });
  for (const key of ['complete', 'source_covered', 'closed', 'early_close']) {
    if (typeof night[key] !== 'boolean') projectionVolumeError(`Missing boolean history flag: ${key}`);
  }
  const keys = canonicalProjectionHolidayKeys(night.holiday_keys);
  if (!KEPT.has(night.outlier_status) && !EXCLUDED.has(night.outlier_status)) {
    projectionVolumeError('Unknown outlier status.');
  }
  if (night.total_units != null && (typeof night.total_units !== 'number' || !Number.isFinite(night.total_units))) {
    projectionVolumeError('History units must be finite numbers or unavailable.');
  }
  if (night.source_revision != null && typeof night.source_revision !== 'string') projectionVolumeError('Invalid source revision.');
  const validUnits = Number.isFinite(night.total_units) && night.total_units >= 0;
  if (night.complete && (!validUnits || typeof night.source_revision !== 'string' || !night.source_revision)) {
    projectionVolumeError('Complete history needs valid units and a source revision.');
  }
  const reasons = [];
  if (!night.complete) reasons.push('incomplete');
  if (!night.source_covered) reasons.push('not_pos_covered');
  if (night.closed) reasons.push('closed');
  if (night.early_close) reasons.push('early_close');
  if (keys.length) reasons.push('holiday');
  if (EXCLUDED.has(night.outlier_status)) reasons.push('excluded_outlier');
  if (!validUnits) reasons.push('invalid_units');
  return Object.freeze({ eligible: reasons.length === 0, reasons: Object.freeze(reasons) });
}