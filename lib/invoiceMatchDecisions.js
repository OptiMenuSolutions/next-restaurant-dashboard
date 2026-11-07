// lib/invoiceMatchDecisions.js

import { fetchAll } from './admin/fetchAll';
import { normalizeSupplierProduct } from './invoiceMatchConflicts';
import { getUnitCategory } from './standardizedUnits';
import {
  safeguardIngredientMatch,
  ingredientIdentityExplicitlyContradicts,
} from './invoiceIngredientIdentity';
import { isStrictDirectMatch } from './progressiveInvoiceMatching';

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
      rejectionKey(supplierKey, productKey, ingredientId)
    );

  // An explicit approval takes priority, but only if the
  // ingredient is eligible under the current recipe policy.
  // Exact supplier-product approvals always take precedence.
  let approvedId = decisions.approvals.get(
    decisionKey(supplierKey, productKey)
  );

  let approvedProductKey = productKey;

  // If no exact approval exists, recognize equivalent supplier
  // descriptions with different word ordering or packaging text.
  //
  // Requiring a match in BOTH directions prevents additional
  // meaningful product characteristics from being ignored.
  //
  // Never choose between multiple equivalent approvals.
  if (!approvedId) {
    const equivalentApprovals = [];

    for (const [key, ingredientId] of decisions.approvals) {
      let parts;

      try {
        parts = JSON.parse(key);
      } catch {
        continue;
      }

      if (
        !Array.isArray(parts) ||
        parts.length !== 2 ||
        parts[0] !== supplierKey
      ) {
        continue;
      }

      const storedProductKey = parts[1];

      if (
        isStrictDirectMatch(description, storedProductKey) &&
        isStrictDirectMatch(storedProductKey, description)
      ) {
        equivalentApprovals.push({
          productKey: storedProductKey,
          ingredientId,
        });
      }
    }

    if (equivalentApprovals.length === 1) {
      approvedId = equivalentApprovals[0].ingredientId;
      approvedProductKey = equivalentApprovals[0].productKey;
    }
  }

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
    !decisions.rejections.has(
      rejectionKey(
        supplierKey,
        approvedProductKey,
        approvedId
      )
    ) &&
    approvedUnitsCompatible
  ) {
    const approvedMatch = {
      status: 'auto',
      matches: [{
        ...approvedIngredient,
        score: 1,
      }],
      decision_source: 'admin_approved',
    };

    // An explicitly approved relationship may resolve missing
    // descriptive details, but not contradictory product identities.
    if (
      !isStrictDirectMatch(
        description,
        approvedIngredient.name
      ) ||
      ingredientIdentityExplicitlyContradicts(
        description,
        approvedIngredient.name
      )
    ) {
      return {
        ...approvedMatch,
        status: 'ambiguous',
        decision_source: 'identity_review_required',
      };
    }

    return approvedMatch;
  }

  // No valid approval: filter the existing matching result.
  const original = match || emptyMatch();

  // Retain only eligible, non-rejected restaurant ingredients.
  // Deduplicate candidate IDs without trusting AI-provided
  // ingredient names or duplicate confidence scores.
  const seen = new Set();

  const candidates = (Array.isArray(original.matches)
    ? original.matches
    : []
  )
    .filter(candidate => {
      if (
        !candidate?.id ||
        seen.has(candidate.id) ||
        !eligibleIngredients.has(candidate.id) ||
        rejected(candidate.id)
      ) {
        return false;
      }

      seen.add(candidate.id);
      return true;
    })
    .map(candidate => ({
      ...candidate,
      ...eligibleIngredients.get(candidate.id),
    }));

  // Never automatically select among multiple candidates.
  // Preserve plausible alternatives for administrator review.

  if (original.status === 'auto') {
    if (candidates.length > 1) {
      return {
        status: 'ambiguous',
        matches: candidates,
        decision_source: 'multiple_candidates',
      };
    }

    if (candidates.length === 0) {
      return {
        ...emptyMatch(),
        decision_source: 'rejected_or_ineligible',
      };
    }

    const ingredient = candidates[0];

    if (
      !invoiceMatchUnitsCompatible(
        invoiceUnit,
        ingredient.standard_unit || ingredient.unit
      )
    ) {
      return {
        status: 'ambiguous',
        matches: candidates,
        decision_source: 'incompatible_units',
      };
    }

    return safeguardIngredientMatch(
      description,
      {
        ...original,
        matches: candidates,
      }
    );
  }

  // Preserve review candidates without automatically upgrading
  // an ambiguous or possible match to an approved match.
  if (
    original.status === 'ambiguous' ||
    original.status === 'possible'
  ) {
    return {
      ...original,
      matches: candidates,
    };
  }

  return {
    ...emptyMatch(),
    ...(original.canonical
      ? { canonical: original.canonical }
      : {}),
  };
}