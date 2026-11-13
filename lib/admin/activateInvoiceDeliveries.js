import { requireRestaurantTimezone } from '../restaurantTime.js';

async function defaultList(make) {
  const { fetchAll } = await import('./fetchAll');
  return fetchAll(make, { page: 500, max: 10000, strictLimit: true });
}

async function defaultPolicy(db, id) {
  const { getProgressiveInvoiceMatchingPolicy } = await import('../progressiveInvoiceMatching');
  return getProgressiveInvoiceMatchingPolicy(db, id);
}

async function defaultDispatch(message, options) {
  const { DELIVERY_TOPIC, deliveryQueue } = await import('./invoiceDeliveryQueue.js');

  // Retrying a send is safe because all attempts use the same idempotency key.
  for (let attempt = 0; ; attempt++) {
    try {
      return await deliveryQueue.send(DELIVERY_TOPIC, message, options);
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

export async function activateInvoiceDeliveries(db, {
  list = defaultList,
  getPolicy = defaultPolicy,
  dispatch = defaultDispatch,
  now = new Date(),
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('A valid scheduler timestamp is required.');
  }

  const result = {
    checked: 0,
    queued: [],
    dispatched: [],
    skipped: [],
    failed: [],
  };

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
      !restaurant.onboarding_completed_at &&
      restaurant.operational_timezone == null
    )) {
      result.skipped.push({
        restaurant_id: id,
        reason: 'inactive_or_unconfigured',
      });
      continue;
    }

    try {
      requireRestaurantTimezone(restaurant.operational_timezone);

      const policy = await getPolicy(db, id);

      if (typeof policy?.matching_enabled !== 'boolean') {
        throw new Error('Matching policy unavailable.');
      }

      if (!policy.matching_enabled) {
        result.skipped.push({
          restaurant_id: id,
          reason: 'matching_locked',
        });
        continue;
      }

      const { data, error } = await db.rpc('queue_due_invoice_deliveries', {
        p_restaurant_id: id,
      });

      if (error) throw new Error(error.message);

      if (
        data?.restaurant_id !== id ||
        !Number.isSafeInteger(data.eligible_invoices) ||
        data.eligible_invoices < 0 ||
        data.calculations_queued !== (data.eligible_invoices > 0)
      ) {
        throw new Error('Unexpected delivery activation result.');
      }

      eligible.add(id);

      if (data.calculations_queued) {
        result.queued.push(data);
      }
    } catch (error) {
      result.failed.push({
        restaurant_id: id,
        error: error.message,
      });
    }
  }

  // Publish every pending restaurant, including work already held by a worker.
  // The consumer checks completion and retries safely if a database lease is active.
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
    BigInt(job.generation) > BigInt(job.completed_generation)
  ).sort((a, b) =>
    lastAttempt(a) - lastAttempt(b) ||
    a.restaurant_id.localeCompare(b.restaurant_id)
  );

  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length) {
        const job = pending[next++];
        const id = job.restaurant_id;

        try {
          const message = {
            version: 1,
            restaurant_id: id,
            generation: String(job.generation),
          };

          await dispatch(message, {
            retentionSeconds: 86400,
            idempotencyKey: [
              'invoice-delivery',
              now.toISOString().slice(0, 10),
              id,
              message.generation,
            ].join(':'),
          });

          result.dispatched.push(message);
        } catch (error) {
          result.failed.push({
            restaurant_id: id,
            error: error.message,
          });
        }
      }
    })
  );

  return result;
}