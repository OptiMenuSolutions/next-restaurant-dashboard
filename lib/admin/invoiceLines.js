// lib/admin/invoiceLines.js
// Admin edits to invoice lines, with the same pricing rules as the owner's
// link flow (pages/api/invoices/link-item.js):
//   - an ingredient takes its price from its newest linked invoice line
//     (by invoice date, then upload time), never from an older one
//   - relinking a line also moves the restaurant's other lines with the same
//     product name, so future invoices keep matching it ("always match")
// After any change, dish costs and the waste-risk inventory are rebuilt.

import { convertInvoiceCostToStandardUnit, getStandardUnitForIngredient } from '../standardizedUnits';
import { recomputeMenuCosts } from '../recomputeMenuCosts';
import { rebuildCurrentInventory } from '../currentInventory';
import { fetchAll } from './fetchAll';
import {
  getProgressiveInvoiceMatchingPolicy,
} from '../progressiveInvoiceMatching';

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
    .select('id, name, last_ordered_at')
    .eq('id', ingredientId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (ingredientError) {
    throw new Error(ingredientError.message);
  }

  if (!ing) {
    throw new Error('Ingredient not found during repricing.');
  }

  const lines = await fetchAll(
    () => db
      .from('invoice_items')
      .select('unit, unit_cost, invoices!inner(restaurant_id, date, created_at)')
      .eq('ingredient_id', ingredientId)
      .eq('invoices.restaurant_id', restaurantId)
      .order('id'),
    { page: 500 }
  );

  const latest = (lines || [])
    .filter((l) => Number(l.unit_cost) > 0)
    .sort((a, b) =>
      String(b.invoices.date || '').localeCompare(String(a.invoices.date || '')) ||
      String(b.invoices.created_at || '').localeCompare(String(a.invoices.created_at || '')))[0];

  let updates;
  if (latest) {
    const unit = latest.unit || 'each';
    const stdUnit = getStandardUnitForIngredient(unit, ing.name);
    updates = {
      last_price: convertInvoiceCostToStandardUnit(Number(latest.unit_cost), unit, ing.name),
      unit: stdUnit,
      standard_unit: stdUnit,
      last_ordered_at: latest.invoices.date,
      is_estimated: false,
      price_status: 'invoice',
    };
  } else if (ing.last_ordered_at) {
    updates = { last_price: null, last_ordered_at: null, is_estimated: true, price_approved_at: null };
  } else {
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