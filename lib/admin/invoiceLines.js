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

export async function repriceFromInvoices(db, restaurantId, ingredientId) {
  if (!ingredientId) return;
  const { data: ing } = await db.from('ingredients').select('id, name, last_ordered_at').eq('id', ingredientId).eq('restaurant_id', restaurantId).single();
  if (!ing) return;

  const { data: lines, error } = await db
    .from('invoice_items')
    .select('unit, unit_cost, invoices!inner(restaurant_id, date, created_at)')
    .eq('ingredient_id', ingredientId)
    .eq('invoices.restaurant_id', restaurantId);
  if (error) throw new Error(error.message);

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
  const { data: inv } = await db.from('invoices').select('id, restaurant_id, date').eq('id', invoiceId).single();
  if (!inv) throw new Error('Invoice not found');
  const rid = inv.restaurant_id;

  const { data: current } = await db.from('invoice_items')
    .select('id, quantity, unit, unit_cost, amount, ingredient_id, ingredient_name_normalized')
    .eq('invoice_id', invoiceId);
  const byId = new Map((current || []).map((l) => [l.id, l]));

  // Only ingredients that belong to this restaurant may be linked.
  const wanted = [...new Set(lines.map((l) => l.ingredient_id).filter(Boolean))];
  const { data: owned } = wanted.length
    ? await db.from('ingredients').select('id').eq('restaurant_id', rid).in('id', wanted)
    : { data: [] };
  const ownedIds = new Set((owned || []).map((g) => g.id));

  const touched = new Set();
  const errors = [];
  let changed = 0;
  let relinked = 0;

  for (const l of lines) {
    const old = byId.get(l.id);
    if (!old) continue;
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
      // Move this line, and the restaurant's other lines with the same
      // product name that point at the old ingredient, so the name keeps
      // matching on future invoices.
      let q = db.from('invoice_items').update({ ingredient_id: newIng });
      if (old.ingredient_id && old.ingredient_name_normalized && newIng) {
        const { data: sameName } = await db.from('invoice_items')
          .select('id, invoices!inner(restaurant_id)')
          .eq('ingredient_id', old.ingredient_id)
          .eq('ingredient_name_normalized', old.ingredient_name_normalized)
          .eq('invoices.restaurant_id', rid);
        q = q.in('id', (sameName || []).map((x) => x.id).concat(l.id));
      } else {
        q = q.eq('id', l.id);
      }
      const { error } = await q;
      if (error) { errors.push(error.message); continue; }
      relinked++;
      if (old.ingredient_id) touched.add(old.ingredient_id);
      if (newIng) touched.add(newIng);
    }
  }

  for (const id of touched) {
    try { await repriceFromInvoices(db, rid, id); } catch (e) { errors.push(e.message); }
  }
  if (touched.size) {
    try { await recomputeMenuCosts(db, rid, [...touched], { effectiveDate: inv.date || new Date().toISOString().slice(0, 10), reason: 'admin_review' }); } catch (e) { errors.push(e.message); }
    try { await rebuildCurrentInventory(db, rid); } catch (e) { errors.push(e.message); }
  }
  return { changed, relinked, errors, restaurantId: rid };
}