import { resolveProjectionSettings } from './settings.js';
import { classifyProjectionOutliers,outlierError } from './outliers.js';

function checked(reply) {
  if (!reply || reply.error || !reply.data || typeof reply.data!=='object' || Array.isArray(reply.data)) {
    const error=new Error(reply?.error?.message||'Invalid outlier database response.');
    error.code=reply?.error?.code||'PROJECTION_OUTLIER_READ_FAILED';throw error;
  }
  return reply.data;
}
export async function readProjectionOutliers(db,{restaurantId,asOf,snapshotAt}) {
  const raw=checked(await db.rpc('projection_outlier_context',{p_restaurant_id:restaurantId,p_as_of:asOf,p_snapshot_at:snapshotAt}));
  if (raw.restaurant_id!==restaurantId || raw.as_of!==asOf || !/^[a-f0-9]{64}$/.test(raw.context_digest||'')) outlierError('Invalid scoped outlier context.');
  if(!Array.isArray(raw.reviews))outlierError('Complete decision review history is required.');
  const resolvedSettings=resolveProjectionSettings({restaurantId,at:snapshotAt,globalVersion:raw.global_version,restaurantVersion:raw.restaurant_version});
  return classifyProjectionOutliers({restaurantId,asOf,snapshotAt,resolvedSettings,modelVersion:raw.model_version,
    firstDataDate:raw.first_data_date,history:raw.history,archives:raw.archives,decisions:raw.decisions,reviews:raw.reviews,context_digest:raw.context_digest});
}
export async function storeProjectionOutliers(db,plan) {
  if (!/^[a-f0-9]{64}$/.test(plan?.source_context_digest||'')) outlierError('A database-fenced outlier plan is required.');
  const result=checked(await db.rpc('projection_store_outliers',{p_restaurant_id:plan.restaurant_id,p_as_of:plan.as_of,
    p_snapshot_at:plan.snapshot_at,p_context_digest:plan.source_context_digest,p_plan:plan}));
  if (![result.saved,result.flags_changed,result.reviews_saved].every(n=>Number.isSafeInteger(n)&&n>=0) || typeof result.retry!=='boolean') outlierError('Invalid outlier write response.');
  return result;
}