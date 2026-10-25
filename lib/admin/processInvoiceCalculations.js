import { fetchAll } from './fetchAll';
import { repriceFromInvoices } from './invoiceLines';
import { recomputeMenuCosts } from '../recomputeMenuCosts';
import { rebuildCurrentInventory } from '../currentInventory';
import { runUsage } from '../pos/runUsage';
import { noteJobError } from './jobRun';

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function processInvoiceCalculations(db, restaurantId) {
  let outcome = { skipped: true, errors: [] };

  // Also handle a save that arrives while the first pass is running.
  for (let pass = 0; pass < 2; pass++) {
    const [job] = checked(await db.rpc('claim_invoice_calculations', {
      p_restaurant_id: restaurantId,
    })) || [];

    if (!job) return outcome;

    const errors = [];

    try {
      // Include old ingredient links so rematching repairs both sides.
      const ingredients = await fetchAll(() => db
        .from('ingredients')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .order('id')
      );

      const ids = ingredients.map((ingredient) => ingredient.id);

      for (let offset = 0; offset < ids.length; offset += 8) {
        const results = await Promise.allSettled(
          ids.slice(offset, offset + 8).map((id) =>
            repriceFromInvoices(db, restaurantId, id)
          )
        );

        const failures = results.filter((result) =>
          result.status === 'rejected'
        );

        if (failures.length) {
          throw new Error(failures.map((result) =>
            result.reason?.message || String(result.reason)
          ).join('; '));
        }
      }

      const costs = await recomputeMenuCosts(db, restaurantId, ids, {
        effectiveDate: job.effective_date,
        reason: 'admin_review',
      });

      errors.push(...(costs.notificationErrors || []).map((message) =>
        'Notifications: ' + message
      ));
    } catch (error) {
      errors.push('Pricing: ' + error.message);
    }

    // An email or dish-cost failure must not prevent inventory work.
    try {
      const usage = await runUsage(db, restaurantId);

      if (usage.error) throw new Error(usage.error);

      if (!usage.applied) {
        await rebuildCurrentInventory(db, restaurantId);
      }
    } catch (error) {
      errors.push('Inventory: ' + error.message);
    }

    checked(await db.rpc('finish_invoice_calculations', {
      p_restaurant_id: restaurantId,
      p_lease: job.lease_token,
      p_generation: job.generation,
      p_error: errors.length ? errors.join('\n') : null,
    }));

    outcome = { skipped: false, errors };

    console.info('[invoice-calculations]', {
      restaurantId,
      ...outcome,
    });

    if (errors.length) {
      await noteJobError(
        `invoice-calculations:${restaurantId}`,
        'Saved invoice calculations need attention',
        errors.join('\n')
      );

      return outcome;
    }
  }

  return outcome;
}