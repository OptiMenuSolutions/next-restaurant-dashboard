import { requireRestaurantTimezone } from '../restaurantTime.js';

async function defaultProcess(db, id) {
  const { processInvoiceCalculations } = await import('./processInvoiceCalculations');
  return processInvoiceCalculations(db, id);
}

async function defaultPolicy(db, id) {
  const { getProgressiveInvoiceMatchingPolicy } = await import('../progressiveInvoiceMatching');
  return getProgressiveInvoiceMatchingPolicy(db, id);
}

async function defaultReport(id, error) {
  const { noteJobError } = await import('./jobRun');

  return noteJobError(
    `invoice-calculations:${id}`,
    'Delivery calculations need attention',
    error.message
  );
}

function generation(value) {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error('Invalid delivery calculation generation.');
  }

  return BigInt(value);
}

export async function processDeliveryCalculation(db, message, {
  process = defaultProcess,
  getPolicy = defaultPolicy,
  report = defaultReport,
} = {}) {
  const id = message?.restaurant_id;

  if (
    message?.version !== 1 ||
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error('Invalid delivery calculation message.');
  }

  const target = generation(message.generation);

  try {
    const { data: restaurant, error } = await db.from('restaurants')
      .select('id, operational_timezone, deactivated_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!restaurant || restaurant.deactivated_at) {
      return { skipped: true, reason: 'inactive_or_deleted' };
    }

    requireRestaurantTimezone(restaurant.operational_timezone);

    const policy = await getPolicy(db, id);

    if (typeof policy?.matching_enabled !== 'boolean') {
      throw new Error('Matching policy unavailable.');
    }

    if (!policy.matching_enabled) {
      return { skipped: true, reason: 'matching_locked' };
    }

    async function readJob() {
      const { data, error: jobError } = await db
        .from('invoice_calculation_jobs')
        .select('generation, completed_generation')
        .eq('restaurant_id', id)
        .maybeSingle();

      if (jobError) throw new Error(jobError.message);
      return data;
    }

    const before = await readJob();

    if (!before) {
      return { skipped: true, reason: 'job_removed' };
    }

    if (generation(before.generation) < target) {
      throw new Error(
        'Delivery calculation generation is ahead of the saved job.'
      );
    }

    if (BigInt(before.completed_generation) >= target) {
      return { skipped: true, reason: 'already_completed' };
    }

    const outcome = await process(db, id);

    if (!Array.isArray(outcome?.errors)) {
      throw new Error('Unexpected calculation result.');
    }

    if (outcome.errors.length) {
      throw new Error(outcome.errors.join('; '));
    }

    const after = await readJob();

    if (after && BigInt(after.completed_generation) < target) {
      throw new Error(
        'Delivery calculations remain pending; retry after the active lease.'
      );
    }

    return outcome;
  } catch (error) {
    try {
      await report(id, error);
    } catch (reportError) {
      console.error(
        '[delivery-calculations:report]',
        reportError.message
      );
    }

    throw error;
  }
}