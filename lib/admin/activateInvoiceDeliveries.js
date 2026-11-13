import { requireRestaurantTimezone } from '../restaurantTime.js';

async function defaultList(make) {
  const { fetchAll } = await import('./fetchAll');
  return fetchAll(make, { page: 500, max: 10000, strictLimit: true });
}

async function defaultPolicy(db, id) {
  const { getProgressiveInvoiceMatchingPolicy } = await import('../progressiveInvoiceMatching');
  return getProgressiveInvoiceMatchingPolicy(db, id);
}

async function defaultProcess(db, id) {
  const { processInvoiceCalculations } = await import('./processInvoiceCalculations');
  return processInvoiceCalculations(db, id);
}

export async function activateInvoiceDeliveries(db, {
  list = defaultList,
  getPolicy = defaultPolicy,
  process = defaultProcess,
  now = new Date(),
  maxJobs = 3,
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('A valid scheduler timestamp is required.');
  }
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 10) {
    throw new TypeError('Invalid calculation batch size.');
  }

  const result = { checked: 0, queued: [], processed: [], skipped: [], failed: [] };
  const eligible = new Set();
  const restaurants = await list(() => db.from('restaurants')
    .select('id, operational_timezone, onboarding_completed_at, deactivated_at')
    .is('deactivated_at', null)
    .order('id')
  );

  for (const restaurant of restaurants) {
    const id = restaurant.id;
    result.checked++;

    if (restaurant.deactivated_at || (
      !restaurant.onboarding_completed_at && restaurant.operational_timezone == null
    )) {
      result.skipped.push({ restaurant_id: id, reason: 'inactive_or_unconfigured' });
      continue;
    }

    try {
      requireRestaurantTimezone(restaurant.operational_timezone);

      const policy = await getPolicy(db, id);
      if (typeof policy?.matching_enabled !== 'boolean') {
        throw new Error('Matching policy unavailable.');
      }

      if (!policy.matching_enabled) {
        result.skipped.push({ restaurant_id: id, reason: 'matching_locked' });
        continue;
      }

      const { data, error } = await db.rpc('queue_due_invoice_deliveries', {
        p_restaurant_id: id,
      });

      if (error) throw new Error(error.message);

      if (
        data?.restaurant_id !== id ||
        !Number.isSafeInteger(data.eligible_invoices) || data.eligible_invoices < 0 ||
        data.calculations_queued !== (data.eligible_invoices > 0)
      ) {
        throw new Error('Unexpected delivery activation result.');
      }

      eligible.add(id);
      if (data.calculations_queued) result.queued.push(data);
    } catch (error) {
      result.failed.push({ restaurant_id: id, error: error.message });
    }
  }

  // Also retry earlier pending jobs when no new delivery activates this run.
  const jobs = await list(() => db.from('invoice_calculation_jobs')
    .select('restaurant_id, generation, completed_generation, lease_until, updated_at, finished_at')
    .order('restaurant_id')
  );

  const lastAttempt = job => Math.max(
    Date.parse(job.updated_at) || 0,
    Date.parse(job.finished_at) || 0
  );

  const pending = jobs.filter(job =>
    eligible.has(job.restaurant_id) &&
    BigInt(job.generation) > BigInt(job.completed_generation) &&
    (!job.lease_until || Date.parse(job.lease_until) < now.getTime())
  ).sort((a, b) =>
    lastAttempt(a) - lastAttempt(b) || a.restaurant_id.localeCompare(b.restaurant_id)
  );

  for (const job of pending.slice(0, maxJobs)) {
    try {
      const outcome = await process(db, job.restaurant_id);

      if (!Array.isArray(outcome?.errors)) {
        throw new Error('Unexpected calculation result.');
      }

      result.processed.push({ restaurant_id: job.restaurant_id, ...outcome });

      if (outcome.errors.length) {
        result.failed.push({
          restaurant_id: job.restaurant_id,
          error: outcome.errors.join('; '),
        });
      }
    } catch (error) {
      result.failed.push({ restaurant_id: job.restaurant_id, error: error.message });
    }
  }

  return result;
}