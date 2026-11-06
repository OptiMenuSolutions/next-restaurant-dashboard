// lib/invoiceMatchDecisions.js

import { fetchAll } from './admin/fetchAll';
import { normalizeSupplierProduct } from './invoiceMatchConflicts';
import { getUnitCategory } from './standardizedUnits';

const emptyMatch = () => ({
  status: 'new',
  matches: [],
});

const decisionKey = (supplierKey, productKey) =>
  JSON.stringify([supplierKey, productKey]);

const rejectionKey = (supplierKey, productKey, ingredientId) =>
  JSON.stringify([supplierKey, productKey, ingredientId]);

// Automatic administrator-approved matches must not invent
// physical-unit conversions.
//
// Unknown or incompatible units require manual review.
// This check does not perform any price conversion itself.

export function invoiceMatchUnitsCompatible(
  invoiceUnit,
  ingredientUnit
) {
  const sourceUnit = String(invoiceUnit || '').trim().toLowerCase();
  const targetUnit = String(ingredientUnit || '').trim().toLowerCase();

  // Cases, numbered cans, and unspecified cans do not
  // establish verified physical quantities.
  // They require product-specific package verification.
  const unverifiedPackage = unit =>
    unit === 'case' ||
    unit === 'cs' ||
    unit === 'can' ||
    unit === '#10' ||
    unit.includes('#10 can');

  if (
    !sourceUnit ||
    !targetUnit ||
    unverifiedPackage(sourceUnit) ||
    unverifiedPackage(targetUnit)
  ) {
    return false;
  }

  const source = getUnitCategory(sourceUnit);
  const target = getUnitCategory(targetUnit);

  return (
    source !== 'unknown' &&
    target !== 'unknown' &&
    source !== 'special' &&
    target !== 'special' &&
    source === target
  );
}

export async function loadInvoiceMatchDecisions(
  db,
  restaurantId,
  supplier
) {
  const supplierKey = normalizeSupplierProduct(supplier);

  if (!supplierKey) {
    return {
      supplierKey,
      approvals: new Map(),
      rejections: new Set(),
    };
  }

  const [approvedRows, rejectedRows] = await Promise.all([
    fetchAll(
      () => db
        .from('invoice_ingredient_mappings')
        .select('product_key, ingredient_id')
        .eq('restaurant_id', restaurantId)
        .eq('supplier_key', supplierKey)
        .order('product_key'),
      { page: 500 }
    ),

    fetchAll(
      () => db
        .from('invoice_match_rejections')
        .select('product_key, ingredient_id')
        .eq('restaurant_id', restaurantId)
        .eq('supplier_key', supplierKey)
        .order('id'),
      { page: 500 }
    ),
  ]);

  const approvals = new Map();
  const rejections = new Set();

  for (const row of approvedRows) {
    approvals.set(
      decisionKey(
        supplierKey,
        row.product_key
      ),
      row.ingredient_id
    );
  }

  for (const row of rejectedRows) {
    rejections.add(
      rejectionKey(
        supplierKey,
        row.product_key,
        row.ingredient_id
      )
    );
  }

  return {
    supplierKey,
    approvals,
    rejections,
  };
}

export function applyInvoiceMatchDecisions({
  description,
  invoiceUnit,
  ingredients,
  match,
  decisions,
}) {
  const productKey = normalizeSupplierProduct(description);
  const supplierKey = decisions.supplierKey;

  const eligibleIngredients = new Map(
    ingredients.map(ingredient => [
      ingredient.id,
      ingredient,
    ])
  );

  const rejected = ingredientId =>
    decisions.rejections.has(
      rejectionKey(
        supplierKey,
        productKey,
        ingredientId
      )
    );

  // An explicit approval takes priority, but only if the
  // ingredient is eligible under the current recipe policy.
  const approvedId = decisions.approvals.get(
    decisionKey(supplierKey, productKey)
  );

  const approvedIngredient = eligibleIngredients.get(approvedId);

  const approvedUnitsCompatible = approvedIngredient
    ? invoiceMatchUnitsCompatible(
        invoiceUnit,
        approvedIngredient.standard_unit ||
          approvedIngredient.unit
      )
    : false;

  if (
    approvedId &&
    eligibleIngredients.has(approvedId) &&
    !rejected(approvedId) &&
    approvedUnitsCompatible
  ) {
    return {
      status: 'auto',
      matches: [{
        ...approvedIngredient,
        score: 1,
      }],
      decision_source: 'admin_approved',
    };
  }

  // No valid approval: filter the existing matching result.
  const original = match || emptyMatch();

  const candidates = (original.matches || [])
    .filter(candidate =>
      candidate?.id &&
      eligibleIngredients.has(candidate.id) &&
      !rejected(candidate.id)
    );

  // Every automatic match must use compatible physical units.
  // This applies to ordinary AI/direct matches as well as
  // administrator-approved relationships.

  if (original.status === 'auto') {
    if (candidates.length !== 1) {
      return {
        ...emptyMatch(),
        decision_source: 'rejected_or_ineligible',
      };
    }

    const ingredient = eligibleIngredients.get(candidates[0].id);

    if (
      !invoiceMatchUnitsCompatible(
        invoiceUnit,
        ingredient.standard_unit || ingredient.unit
      )
    ) {
      return {
        ...emptyMatch(),
        decision_source: 'incompatible_units',
      };
    }
  }

  return {
    ...original,
    matches: candidates,
  };
}