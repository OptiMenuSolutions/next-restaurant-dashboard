// lib/historicalInvoiceMatching.js

import { fetchAll } from './admin/fetchAll';

import {
  getProgressiveInvoiceMatchingPolicy,
  findStrictDirectMatch,
} from './progressiveInvoiceMatching';

import { getUnitCategory } from './standardizedUnits';

import {
  loadInvoiceMatchDecisions,
  applyInvoiceMatchDecisions,
} from './invoiceMatchDecisions';

import { repriceFromInvoices } from './admin/invoiceLines';
import { recomputeMenuCosts } from './recomputeMenuCosts';
import { rebuildCurrentInventory } from './currentInventory';


function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}


// Count-based vendor packs must not be assigned a made-up
// weight- or volume-based ingredient price.

export function historicalUnitCompatible(
  invoiceUnit,
  ingredientUnit
) {
  const source = getUnitCategory(invoiceUnit);
  const target = getUnitCategory(ingredientUnit);

  return (
    source !== 'unknown' &&
    target !== 'unknown' &&
    source !== 'special' &&
    target !== 'special' &&
    source === target
  );
}


// Match previously uploaded invoice lines after recipe publication.
//
// Safety properties:
// - Per-restaurant leased processing
// - No modification of already-linked invoice lines
// - No automatic reopening of manually corrected lines
// - Only direct, unambiguous ingredient matches
// - No invented unit conversions
// - Atomic NULL-only database linking
// - Financial calculation retries for unfinished matches
// - Original invoice quantities and prices preserved

export async function runHistoricalInvoiceMatching(
  db,
  restaurantId
) {
  const claims = checked(
    await db.rpc('claim_historical_invoice_matching', {
      p_restaurant_id: restaurantId,
    })
  );

  const claim = claims?.[0];

  if (!claim) {
    return {
      skipped: true,
      matched: 0,
      ingredientCount: 0,
    };
  }

  let matched = 0;
  let failure = null;

  const touched = new Set();

  try {
    // ---------------------------------------------------------
    // 1. Load progressive matching policy.
    // ---------------------------------------------------------

    const policy = await getProgressiveInvoiceMatchingPolicy(
      db,
      restaurantId
    );

    // ---------------------------------------------------------
    // 2. Match currently eligible historical invoice lines.
    // ---------------------------------------------------------

    if (policy.matching_enabled) {
      const allIngredients = await fetchAll(
        () =>
          db
            .from('ingredients')
            .select('id, name, unit, standard_unit')
            .eq('restaurant_id', restaurantId)
            .order('id'),
        { page: 500 }
      );

      const ingredients =
        policy.mode === 'strict'
          ? allIngredients.filter(ingredient =>
              policy.eligibleIngredientIds.has(
                ingredient.id
              )
            )
          : allIngredients;

      // Read invoice IDs first.
      // Do not paginate over a changing unmatched-line set.

      const invoices = await fetchAll(
        () =>
          db
            .from('invoices')
            .select('id, date, supplier')
            .eq('restaurant_id', restaurantId)
            .order('id'),
        { page: 500 }
      );

      const decisionCache = new Map();

      for (const invoice of invoices) {
        const supplier = invoice.supplier || '';

        if (!decisionCache.has(supplier)) {
          decisionCache.set(
            supplier,
            await loadInvoiceMatchDecisions(
              db,
              restaurantId,
              supplier
            )
          );
        }

        const decisions = decisionCache.get(supplier);

        const lines = await fetchAll(
          () =>
            db
              .from('invoice_items')
              .select(
                'id, item_name, ingredient_id, reviewed, unit, unit_cost'
              )
              .eq('invoice_id', invoice.id)
              .order('id'),
          { page: 500 }
        );

        for (const line of lines) {
          // Never replace an existing ingredient relationship.

          if (line.ingredient_id) continue;

          // Reviewed lines require explicit administrative action.

          if (line.reviewed) continue;

          // Unresolved prices cannot create verified ingredient costs.

          if (!(Number(line.unit_cost) > 0)) continue;

          const directMatch = findStrictDirectMatch(
            line.item_name,
            ingredients
          );

          const choice = applyInvoiceMatchDecisions({
            description: line.item_name,
            ingredients,
            invoiceUnit: line.unit,
            match: directMatch,
            decisions,
          });

          if (choice.status !== 'auto') continue;

          const ingredient = choice.matches[0];

          if (!ingredient?.id) continue;

          // Refuse incompatible physical units.

          if (
            !historicalUnitCompatible(
              line.unit,
              ingredient.standard_unit ||
                ingredient.unit
            )
          ) {
            continue;
          }

          // Database RPC validates the processing lease,
          // restaurant ownership, existing corrections,
          // and NULL-only linking.

          const linked = checked(
            await db.rpc('link_historical_invoice_item', {
              p_restaurant_id: restaurantId,
              p_invoice_item_id: line.id,
              p_ingredient_id: ingredient.id,
              p_lease: claim.lease_token,
              p_generation: claim.generation,
            })
          );

          if (linked) {
            matched++;
            touched.add(ingredient.id);
          }
        }
      }
    }

    // ---------------------------------------------------------
    // 3. Recover unfinished financial calculations.
    //
    // Only process historical matches that have not yet
    // completed their pricing and costing work.
    //
    // This replaces the previous behavior of recalculating
    // every historically matched ingredient on every retry.
    // ---------------------------------------------------------

    const pendingAudits = await fetchAll(
      () =>
        db
          .from('historical_invoice_match_audit')
          .select('id, invoice_item_id, ingredient_id')
          .eq('restaurant_id', restaurantId)
          .is('calculated_at', null)
          .order('id'),
      { page: 500 }
    );

    for (const audit of pendingAudits) {
      touched.add(audit.ingredient_id);
    }

    // A locked restaurant must not perform ingredient costing.

    if (touched.size && !policy.matching_enabled) {
      throw new Error(
        'Historical invoice calculations are not enabled.'
      );
    }

    // ---------------------------------------------------------
    // 4. Reprice affected ingredients only.
    // ---------------------------------------------------------

    if (touched.size) {
      for (const ingredientId of touched) {
        await repriceFromInvoices(
          db,
          restaurantId,
          ingredientId
        );
      }

      // -------------------------------------------------------
      // 5. Recompute downstream menu costs.
      // -------------------------------------------------------

      const result = await recomputeMenuCosts(
        db,
        restaurantId,
        [...touched],
        {
          reason: 'historical_invoice_matching',
        }
      );

      // A calculation failure must leave audit records pending
      // so the next worker run can recover them.

      if (
        result?.errors?.length ||
        result?.notificationErrors?.length
      ) {
        throw new Error(
          [
            ...(result.errors || []),
            ...(result.notificationErrors || []),
          ].join('; ')
        );
      }

      // -------------------------------------------------------
      // 6. Rebuild inventory after successful costing.
      // -------------------------------------------------------

      await rebuildCurrentInventory(
        db,
        restaurantId
      );

      // -------------------------------------------------------
      // 7. Mark this batch's pending calculations complete.
      //
      // Do not mark unrelated or previously completed audit
      // records. A failed update leaves the job retryable.
      // -------------------------------------------------------

      const auditIds = pendingAudits.map(
        audit => audit.id
      );

      if (auditIds.length) {
        // Supabase request sizes stay bounded.

        for (
          let offset = 0;
          offset < auditIds.length;
          offset += 500
        ) {
          const batch = auditIds.slice(
            offset,
            offset + 500
          );

          const { error } = await db
            .from('historical_invoice_match_audit')
            .update({
              calculated_at: new Date().toISOString(),
            })
            .eq('restaurant_id', restaurantId)
            .in('id', batch)
            .is('calculated_at', null);

          if (error) throw error;
        }
      }
    }

  } catch (error) {
    failure = error;
  }

  // -----------------------------------------------------------
  // 8. Finalize the processing lease.
  //
  // On failure, completed_generation remains unchanged.
  // Pending audit records remain available for retry.
  // -----------------------------------------------------------

  const finished = checked(
    await db.rpc('finish_historical_invoice_matching', {
      p_restaurant_id: restaurantId,
      p_lease: claim.lease_token,
      p_generation: claim.generation,
      p_error: failure?.message || null,
    })
  );

  if (!finished) {
    throw new Error(
      'Historical invoice matching lease could not be finalized.'
    );
  }

  if (failure) {
    throw failure;
  }

  return {
    skipped: false,
    matched,
    ingredientCount: touched.size,
  };
}