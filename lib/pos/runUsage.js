import { prepareUsage } from './usageServer';
import { rebuildCurrentInventory } from '../currentInventory';

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function runUsage(db, restaurantId) {
  let last = { skipped: true };

  // One immediate retry. Remaining failures stay queued for the
  // daily inventory job or an explicit retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [job] = checked(await db.rpc(
      'claim_restaurant_pos_usage',
      { p_restaurant_id: restaurantId }
    )) || [];

    if (!job) return last;

    let error = null;
    let applied = false;
    let usage;

    try {
      usage = await prepareUsage(
        db,
        restaurantId,
        Infinity,
        45000,
        job.lease_token
      );

      const settings = checked(
        await db
          .from('pos_usage_settings')
          .select('enabled')
          .eq('restaurant_id', restaurantId)
          .single()
      );

      if (settings.enabled && !usage.skipped) {
        await rebuildCurrentInventory(db, restaurantId);
        applied = true;
      }
    } catch (failure) {
      error = failure.message || String(failure);
    }

    checked(await db.rpc('finish_pos_usage', {
      p_restaurant_id: restaurantId,
      p_lease: job.lease_token,
      p_error: error,
      p_applied: applied,
    }));

    const state = checked(
      await db
        .from('pos_usage_jobs')
        .select('generation,applied_publication_id')
        .eq('restaurant_id', restaurantId)
        .single()
    );

    const changed =
      state.generation !== job.claimed_generation;

    applied = applied &&
      state.applied_publication_id === job.lease_token;

    const retryPending = changed ||
      Boolean(error) ||
      Boolean(usage?.report?.some(
        (row) => row.status === 'blocked' && row.retryable
      ));

    last = {
      skipped: false,
      applied,
      retryPending,
      error,
      prepared: usage?.report?.filter(
        (row) => row.status === 'ready'
      ).length || 0,
      unresolved: usage?.report?.filter(
        (row) => row.status === 'blocked'
      ).length || 0,
    };

    console.info('[pos-usage:event]', {
      restaurantId,
      attempt: attempt + 1,
      ...last,
    });

    if (!retryPending) return last;
  }

  return last;
}