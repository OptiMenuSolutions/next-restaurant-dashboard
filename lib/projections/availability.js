import { shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID } from './eligibility.js';

export function availabilityError(message) {
  const error = new TypeError(message); error.code = 'PROJECTION_AVAILABILITY_INVALID'; throw error;
}
export const availableOn = (row, date) =>
  (row.valid_from === null || row.valid_from <= date) && (row.valid_until === null || date < row.valid_until);

export function projectionAvailability(rows, restaurantId, dishIds) {
  if (!Array.isArray(rows)) availabilityError('Explicit availability windows are required.');
  const ids = new Set(), result = rows.map(row => {
    if (!row || row.restaurant_id !== restaurantId || !dishIds.has(row.dish_id) ||
      !PROJECTION_UUID.test(row.id || '') || ids.has(row.id)) availabilityError('Invalid, duplicate or foreign availability.');
    ids.add(row.id);
    for (const key of ['valid_from', 'valid_until']) {
      if (row[key] !== null) shiftProjectionDate(row[key], 0);
    }
    if (row.valid_from && row.valid_until && row.valid_until < row.valid_from) availabilityError('Reversed availability dates.');
    if (row.is_initial !== undefined && typeof row.is_initial !== 'boolean') availabilityError('Invalid initial-menu flag.');
    return { id: row.id, restaurant_id: restaurantId, dish_id: row.dish_id,
      valid_from: row.valid_from, valid_until: row.valid_until, is_initial: row.is_initial === true,
      lifecycle_context: structuredClone(row.lifecycle_context ?? {}) };
  }).sort((a, b) => a.dish_id.localeCompare(b.dish_id) ||
    (a.valid_from ?? '').localeCompare(b.valid_from ?? '') || a.id.localeCompare(b.id));
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1], b = result[i];
    if (a.dish_id === b.dish_id && (a.valid_until === null || b.valid_from === null || a.valid_until > b.valid_from)) {
      availabilityError('Availability windows overlap.');
    }
  }
  return result;
}