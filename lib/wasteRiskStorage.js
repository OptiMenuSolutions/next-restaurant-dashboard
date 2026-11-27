import { resolveProjectionSettings } from './projections/settings.js';
import { assessProjectedWasteRisk } from './wasteRiskProjection.js';
import { reassessProjectedWasteRisk } from './wasteRiskReassessment.js';

function checked({ data, error }) {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (!data) throw new Error('Waste-risk storage returned no restaurant context.');
  return data;
}

// Call only with the server's service-role client and a normalized, complete
// inventory/archive/recipe snapshot. No browser or owner-supplied snapshots.
export async function prepareWasteRiskAssessment(client, input, requestId, correction = null) {
  const state = checked(await client.rpc('waste_projection_read', {
    target: input.restaurantId, cutoff: input.inventoryCutoff,
    batch_ids: input.batches.map(b => b.id), at_time: input.assessedAt,
  }));
  const snapshot = { ...input, frozen: state.frozen, resolvedSettings: resolveProjectionSettings({
    restaurantId: input.restaurantId, at: input.assessedAt,
    globalVersion: state.globalVersion, restaurantVersion: state.restaurantVersion,
  }) };
  const outcome = correction ? reassessProjectedWasteRisk(snapshot, correction) : assessProjectedWasteRisk(snapshot);
  return { target: input.restaurantId, request_id: requestId, expected_version: state.version,
    snapshot, outcome, correction: input.correctionSources ?? correction };
}

// Retrying this exact envelope is idempotent. PT409 requires a new read and
// calculation, never replacing frozen state with the rejected plan.
export async function commitWasteRiskAssessment(client, envelope) {
  return checked(await client.rpc('waste_projection_commit', envelope));
}