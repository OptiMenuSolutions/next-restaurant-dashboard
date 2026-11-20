import { createHash } from 'node:crypto';
import { shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID, projectionVolumeError } from './eligibility.js';

export const VOLUME_MODEL_MAJOR = 5;
export const VOLUME_LOGIC_REVISION = 'volume-points-recent-only-v1';
// Reviewed seed for a separately versioned policy. Runtime callers must supply
// an explicit complete policy record; this seed is never a fallback.
export const PROJECTION_VOLUME_POLICY_SEED = Object.freeze({
  model_major: VOLUME_MODEL_MAJOR,
  logic_revision: VOLUME_LOGIC_REVISION,
  parameters: Object.freeze({
    minimum_fit_points: 3,
    minimum_ly_base_points: 2,
    minimum_ly_target_points: 2,
  }),
});

export function projectionCanonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(projectionCanonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${projectionCanonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function projectionVolumeDigest(value) {
  return createHash('sha256').update(projectionCanonicalJSON(value)).digest('hex');
}

export function projectionDeepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(projectionDeepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function validateProjectionVolumePolicy(record, { restaurantId, asOf, settings }) {
  if (!record || Array.isArray(record) || Object.keys(record).sort().join(',') !==
    'effective_from,id,logic_revision,model_major,parameters,restaurant_id' ||
    !PROJECTION_UUID.test(record.id || '') ||
    (record.restaurant_id !== null && record.restaurant_id !== restaurantId) ||
    record.model_major !== VOLUME_MODEL_MAJOR || record.logic_revision !== VOLUME_LOGIC_REVISION) {
    projectionVolumeError('An explicit supported volume policy version is required.');
  }
  shiftProjectionDate(record.effective_from, 0);
  if (record.effective_from > asOf) projectionVolumeError('Volume policy is not effective yet.');
  const p = record.parameters;
  if (!p || Array.isArray(p) || Object.keys(p).sort().join(',') !==
    'minimum_fit_points,minimum_ly_base_points,minimum_ly_target_points' ||
    Object.values(p).some(n => !Number.isSafeInteger(n) || n < 2) ||
    p.minimum_ly_target_points > settings.seasonal_smoothing_weeks) {
    projectionVolumeError('Invalid volume policy thresholds.');
  }
  return { ...record, parameters: { ...p } };
}