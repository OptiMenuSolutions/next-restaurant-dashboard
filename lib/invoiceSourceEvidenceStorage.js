import { createHash } from 'node:crypto';

function hash(value) {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positive(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

/**
 * Prepare authenticated evidence for a saved invoice item.
 *
 * The confirmation validator must already have verified
 * the source proof and calculated invoice values.
 *
 * This function does not establish trust independently.
 */
export function prepareInvoiceSourceEvidence({
  savedLine,
  invoiceId,
  restaurantId,
  confirmation,
  proof,
} = {}) {
  if (
    !validId(savedLine?.id) ||
    !validId(invoiceId) ||
    !validId(restaurantId)
  ) {
    return {
      accepted: false,
      reason: 'missing_saved_identity',
      record: null,
    };
  }

  if (
    savedLine.invoice_id !== invoiceId ||
    savedLine.restaurant_id !== restaurantId
  ) {
    return {
      accepted: false,
      reason: 'ownership_mismatch',
      record: null,
    };
  }

  if (
    confirmation?.accepted !== true ||
    !confirmation.evidence
  ) {
    return {
      accepted: false,
      reason: 'unauthenticated_evidence',
      record: null,
    };
  }

  if (
    typeof proof !== 'string' ||
    !proof.includes('.')
  ) {
    return {
      accepted: false,
      reason: 'missing_source_proof',
      record: null,
    };
  }

  const evidence = confirmation.evidence;

  if (
    evidence.source_type !== 'structured_ocr_table' ||
    evidence.validation_status !== 'source_table_consistent'
  ) {
    return {
      accepted: false,
      reason: 'unsupported_source',
      record: null,
    };
  }

  const quantity = positive(savedLine.quantity);
  const unitCost = positive(savedLine.unit_cost);
  const amount = positive(savedLine.amount);

  if (
    quantity === null ||
    unitCost === null ||
    amount === null ||
    !validId(savedLine.unit)
  ) {
    return {
      accepted: false,
      reason: 'invalid_saved_pricing',
      record: null,
    };
  }

  const tolerance = Math.max(
    0.01,
    amount * 0.000001
  );

  if (
    Math.abs(quantity * unitCost - amount) > tolerance
  ) {
    return {
      accepted: false,
      reason: 'invalid_saved_arithmetic',
      record: null,
    };
  }

  if (
    Math.abs(quantity - evidence.quantity) > 0.000001 ||
    savedLine.unit !== evidence.unit ||
    Math.abs(unitCost - evidence.unit_cost) > 0.000001 ||
    Math.abs(amount - evidence.amount) > 0.01
  ) {
    return {
      accepted: false,
      reason: 'saved_pricing_mismatch',
      record: null,
    };
  }

  const pricingSnapshot = {
    invoice_item_id: savedLine.id,
    invoice_id: invoiceId,
    restaurant_id: restaurantId,
    ingredient_id: savedLine.ingredient_id ?? null,
    item_name: savedLine.item_name,
    quantity,
    unit: savedLine.unit,
    unit_cost: unitCost,
    amount,
  };

  return {
    accepted: true,
    reason: null,
    record: {
      invoice_item_id: savedLine.id,
      invoice_id: invoiceId,
      restaurant_id: restaurantId,

      source_type: 'structured_ocr_table',
      validation_status: 'source_table_consistent',
      evidence_version: 1,

      // Fingerprint of the authenticated proof.
      // This is not yet a fingerprint of the original
      // uploaded document.
      source_fingerprint: hash(proof),

      pricing_fingerprint: hash(
        JSON.stringify(pricingSnapshot)
      ),

      evidence: {
        proof_version: evidence.proof_version,
        invoice_number: evidence.invoice_number,
        item_key: evidence.item_key,
        issued_at: evidence.issued_at,
        source_type: evidence.source_type,
        validation_status: evidence.validation_status,
        pricing: pricingSnapshot,
      },
    },
  };
}

/**
 * Persist prepared evidence with the server-side
 * Supabase connection.
 *
 * The caller is responsible for authenticating the proof
 * and checking the saved line's database identity.
 *
 * No ingredient repricing occurs here.
 */
export async function saveInvoiceSourceEvidence(
  db,
  prepared
) {
  if (!prepared?.accepted || !prepared.record) {
    return {
      saved: false,
      reason: prepared?.reason || 'invalid_evidence',
    };
  }

  const { error } = await db
    .from('invoice_supported_price_evidence')
    .insert(prepared.record);

  if (error) {
    throw new Error(
      `Could not persist invoice source evidence: ${error.message}`
    );
  }

  return {
    saved: true,
    reason: null,
  };
}