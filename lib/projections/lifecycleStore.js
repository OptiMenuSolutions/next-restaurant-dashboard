import { resolveProjectionSettings } from './settings.js';
import { buildProjectionLifecycle } from './lifecycle.js';

function checked(result) {
  if (!result || result.error || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    const error = new Error(result?.error?.message || 'Invalid lifecycle database response.');
    error.code = result?.error?.code || 'PROJECTION_LIFECYCLE_READ_FAILED'; throw error;
  }
  return result.data;
}
export async function readProjectionLifecycle(db, { restaurantId, asOf, snapshotAt }) {
  const context = checked(await db.rpc('projection_lifecycle_context', {
    p_restaurant_id: restaurantId, p_as_of: asOf, p_snapshot_at: snapshotAt,
  }));
  if (context.restaurant_id !== restaurantId || context.as_of !== asOf || !/^[a-f0-9]{64}$/.test(context.context_digest || '')) {
    throw new Error('Lifecycle database context does not match the request.');
  }
  const version = resolveProjectionSettings({ restaurantId, at: snapshotAt,
    globalVersion: context.global_version, restaurantVersion: context.restaurant_version });
  return buildProjectionLifecycle({ restaurantId, asOf, snapshotAt, resolvedSettings: version,
    restaurant: context.restaurant, dishes: context.dishes, availability: context.availability,
    history: context.history, dishFacts: context.dish_facts, priorSales: context.prior_sales, launchHistory: context.launch_history,
    context_digest: context.context_digest });
}
export async function storeProjectionLaunches(db, plan) {
  if (!/^[a-f0-9]{64}$/.test(plan?.source_context_digest || '')) throw new Error('A database-fenced lifecycle plan is required.');
  const result = checked(await db.rpc('projection_store_launches', {
    p_restaurant_id: plan.restaurant_id, p_as_of: plan.as_of, p_snapshot_at: plan.snapshot_at,
    p_context_digest: plan.source_context_digest, p_plan: plan,
  }));
  if (!Number.isSafeInteger(result.saved) || result.saved < 0 || !Number.isSafeInteger(result.origin_corrections) ||
    result.origin_corrections < 0 || typeof result.retry !== 'boolean') throw new Error('Invalid launch write response.');
  return result;
}