// lib/admin/invoiceLines.js
// Admin edits to invoice lines, with the same pricing rules as the owner's
// link flow (pages/api/invoices/link-item.js):
//   - an ingredient takes its price from its newest linked invoice line
//     (by invoice date, then upload time), never from an older one
//   - relinking a line also moves the restaurant's other lines with the same
//     product name, so future invoices keep matching it ("always match")
// After any change, dish costs and the waste-risk inventory are rebuilt.

import { safeInvoiceStandardPrice } from '../safeInvoicePricing';
import { recomputeMenuCosts } from '../recomputeMenuCosts';
import { rebuildCurrentInventory } from '../currentInventory';
import { fetchAll } from './fetchAll';
import {
  getProgressiveInvoiceMatchingPolicy,
} from '../progressiveInvoiceMatching';
import {
  selectInvoiceRepricingSource,
} from '../invoiceRepricing';

export async function repriceFromInvoices(db, restaurantId, ingredientId) {
  if (!ingredientId) return;

  const control = await getProgressiveInvoiceMatchingPolicy(
    db,
    restaurantId
  );

  if (!control.matching_enabled) {
    throw new Error(
      'Invoice ingredient repricing is disabled for this restaurant.'
    );
  }

  const { data: ing, error: ingredientError } = await db
    .from('ingredients')
    .select(
      'id, name, restaurant_id, unit, ' +
      'last_ordered_at, price_status, price_approved_at'
    )
    .eq('id', ingredientId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (ingredientError) {
    throw new Error(ingredientError.message);
  }

  if (!ing) {
    throw new Error('Ingredient not found during repricing.');
  }

  const allowInvoiceSupported =
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED === 'true';

  // Preserve explicitly approved manual pricing when
  // the new invoice-supported pathway is enabled.
  if (
    allowInvoiceSupported &&
    ing.price_status !== 'invoice' &&
    ing.price_approved_at != null
  ) {
    return;
  }

  const lines = await fetchAll(
    () => db
      .from('invoice_items')
      .select(
        'id, invoice_id, ingredient_id, ' +
        'quantity, amount, unit, unit_cost, ' +
        'price_verification_status, ' +
        'price_verification_source, ' +
        'price_verified_at, ' +
        'price_verification_evidence, ' +
        'invoices!inner(restaurant_id, date, created_at)'
      )
      .eq('ingredient_id', ingredientId)
      .eq('invoices.restaurant_id', restaurantId)
      .order('id'),
    { page: 500 }
  );

  const evidenceByLineId = new Map();

  if (allowInvoiceSupported && lines.length) {
    const lineIds = lines.map((line) => line.id);

    // Fetch authenticated evidence only from the
    // server-controlled database table.
    //
    // Never use evidence submitted by the browser.
    for (let offset = 0; offset < lineIds.length; offset += 100) {
      const batch = lineIds.slice(offset, offset + 100);

      const evidenceRows = await fetchAll(
        () => db
          .from('invoice_supported_price_evidence')
          .select(
            'id, invoice_item_id, invoice_id, ' +
            'restaurant_id, source_type, ' +
            'validation_status, invalidated_at, ' +
            'invalidation_reason, evidence'
          )
          .eq('restaurant_id', restaurantId)
          .in('invoice_item_id', batch)
          .is('invalidated_at', null)
          .order('id'),
        { page: 500 }
      );

      for (const evidence of evidenceRows) {
        evidenceByLineId.set(
          evidence.invoice_item_id,
          evidence
        );
      }
    }
  }

  const eligibleLines = allowInvoiceSupported
    ? lines.map((line) => ({
        ...line,
        restaurant_id: line.invoices?.restaurant_id,
      }))
    : lines;

  const decision = selectInvoiceRepricingSource(
    eligibleLines,
    {
      requireVerified: true,
      allowInvoiceSupported,
      ingredient: ing,
      evidenceByLineId,
    }
  );

  let updates;

  if (decision.status === 'priced') {
    // A remaining verified invoice supports this price.
    updates = decision.updates;
  } else if (
    ing.price_status === 'invoice'
  ) {
    // No remaining verified invoice supports the
    // existing invoice-derived price.
    //
    // Preserve the historical numeric value to avoid
    // destroying potentially legitimate legacy pricing,
    // but prevent the price from remaining classified
    // as verified invoice pricing.
    updates = {
      price_status: 'needs_review',
      is_estimated: true,
      price_approved_at: null,
    };
  } else {
    // Preserve manually approved, estimated, and
    // otherwise non-invoice-derived ingredient prices.
    return;
  }
  const { error: upErr } = await db.from('ingredients').update(updates).eq('id', ingredientId).eq('restaurant_id', restaurantId);
  if (upErr) throw new Error(upErr.message);
}

// Saves edited lines for one invoice. lines: [{ id, quantity, unit, unit_cost, amount, ingredient_id }]
// Returns { changed, relinked, errors }.
export async function saveInvoiceLines(db, invoiceId, lines) {
  const { data: inv, error: invoiceError } = await db
    .from('invoices')
    .select('id, restaurant_id, date')
    .eq('id', invoiceId)
    .single();

  if (invoiceError) throw new Error(invoiceError.message);
  if (!inv) throw new Error('Invoice not found');

  const rid = inv.restaurant_id;

  // Invoice ingredient edits are disabled until restaurant matching
  // is activated. Read-only invoice review remains available.
  const control = await getProgressiveInvoiceMatchingPolicy(
    db,
    rid
  );

  if (!control.matching_enabled) {
    throw new Error(
      'Invoice ingredient matching is not enabled for this restaurant.'
    );
  }

  if (!Array.isArray(lines)) {
    throw new Error('Invoice lines must be an array.');
  }

  const [current, owned] = await Promise.all([
    fetchAll(
      () => db.from('invoice_items')
        .select('id, quantity, unit, unit_cost, amount, ingredient_id, ingredient_name_normalized')
        .eq('invoice_id', invoiceId)
        .order('id'),
      { page: 500 }
    ),
    fetchAll(
      () => db.from('ingredients')
        .select('id')
        .eq('restaurant_id', rid)
        .order('id'),
      { page: 500 }
    ),
  ]);

  const byId = new Map(
    current.map((line) => [line.id, line])
  );

  const ownedIds = new Set(
    owned.map((ingredient) => ingredient.id)
  );

  // Only reprice ingredients affected by submitted invoice-line edits.
  // Do not reprice the entire restaurant's ingredient library.
  const touched = new Set();
  const errors = [];
  let changed = 0;
  let relinked = 0;

  for (const l of lines) {
    const old = byId.get(l.id);

    if (!old) {
      errors.push(
        'An invoice line no longer exists. Reload the invoice before retrying.'
      );
      continue;
    }

    if (l.ingredient_id && !ownedIds.has(l.ingredient_id)) {
      errors.push(
        'The selected ingredient does not belong to this restaurant.'
      );
      continue;
    }
    const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
    const next = { quantity: num(l.quantity), unit: String(l.unit || '').trim() || null, unit_cost: num(l.unit_cost), amount: num(l.amount) };
    const numbersChanged = next.quantity !== num(old.quantity) || next.unit !== (old.unit || null) || next.unit_cost !== num(old.unit_cost) || next.amount !== num(old.amount);
    const newIng = l.ingredient_id && ownedIds.has(l.ingredient_id) ? l.ingredient_id : null;
    const linkChanged = (newIng || null) !== (old.ingredient_id || null);

    if (numbersChanged) {
      const { error } = await db.from('invoice_items').update(next).eq('id', l.id).eq('invoice_id', invoiceId);
      if (error) { errors.push(error.message); continue; }
      changed++;
      if (old.ingredient_id) touched.add(old.ingredient_id);
    }

    if (linkChanged) {
      // Update only the explicitly selected invoice line.
      // Historical corrections require their own explicit review.
      const { error } = await db
        .from('invoice_items')
        .update({ ingredient_id: newIng })
        .eq('id', l.id)
        .eq('invoice_id', invoiceId);

      if (error) {
        errors.push(error.message);
        continue;
      }

      relinked++;

      if (old.ingredient_id) {
        touched.add(old.ingredient_id);
      }

      if (newIng) {
        touched.add(newIng);
      }
    }
  }

  if (errors.length) {
    return { changed, relinked, errors, restaurantId: rid };
  }

  const ids = [...touched];

  if (!ids.length) {
    return {
      changed,
      relinked,
      errors,
      restaurantId: rid,
    };
  }

  // Recheck pricing in small batches, including ingredients affected
  // by an earlier save whose later calculations failed.
  for (let offset = 0; offset < ids.length; offset += 8) {
    const results = await Promise.allSettled(
      ids.slice(offset, offset + 8).map((ingredientId) =>
        repriceFromInvoices(db, rid, ingredientId)
      )
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(
          'Ingredient pricing: ' +
          (result.reason?.message || 'Recalculation failed.')
        );
      }
    }
  }

  if (errors.length) {
    return { changed, relinked, errors, restaurantId: rid };
  }

  try {
    await recomputeMenuCosts(db, rid, ids, {
      effectiveDate: inv.date || new Date().toISOString().slice(0, 10),
      reason: 'admin_review',
    });
  } catch (error) {
    errors.push('Dish costs: ' + error.message);
  }

  if (errors.length) {
    return { changed, relinked, errors, restaurantId: rid };
  }

  // Always rebuild, including retries with no new line edits.
  try {
    await rebuildCurrentInventory(db, rid);
  } catch (error) {
    errors.push('Inventory: ' + error.message);
  }

  return { changed, relinked, errors, restaurantId: rid };
}