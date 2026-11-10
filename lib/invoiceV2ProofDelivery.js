
import {
  buildInvoiceEvidenceSigningCollection,
} from './invoiceEvidenceSigningCollection.js';

import {
  validateInvoiceEvidenceClaims,
} from './invoiceEvidenceClaims.js';

import {
  createInvoiceEvidenceProofV2,
  verifyInvoiceSourceProof,
} from './invoiceSourceProof.js';

/**
 * Issue V2 proofs to returned invoice items only.
 *
 * This function does not write to the database,
 * authorize ingredient pricing, or persist evidence.
 */
export function deliverInvoiceV2Proofs({
  allRaw,
  foodItems,
  lineItemsWithMatches,
  ocrText,
  restaurantId,
  invoiceNumber,
  documentFingerprint,
  secret,
} = {}) {
  const stats = {
    eligible: 0,
    signed: 0,
    rejected: 0,
  };

  const signingCollection =
    buildInvoiceEvidenceSigningCollection({
      allRaw,
      foodItems,
      lineItemsWithMatches,
    });

  const claims = validateInvoiceEvidenceClaims(
    signingCollection,
    ocrText
  );

  const returnedItems = new Set(lineItemsWithMatches);

  // The collection contains every original invoice
  // line, including non-food and unreadable items.
  // Only the exact returned food-item objects may
  // receive proofs.
  for (let index = 0; index < signingCollection.length; index++) {
    const item = signingCollection[index];
    const claim = claims[index];

    if (!returnedItems.has(item)) {
      continue;
    }

    if (
      item.catch_weight !== true ||
      !claim?.chargeVerified ||
      claim.verifiedValues?.weight_unit !== 'lb'
    ) {
      continue;
    }

    stats.eligible++;

    // Never replace an existing proof.
    if (item.invoice_source_proof) {
      stats.rejected++;
      continue;
    }

    try {
      const proof = createInvoiceEvidenceProofV2({
        restaurantId,
        invoiceNumber,
        documentFingerprint,
        itemKey: item._id,
        item,
        invoiceItems: signingCollection,
        ocrText,
        secret,
      });

      const verification = verifyInvoiceSourceProof({
        proof,
        restaurantId,
        invoiceNumber,
        documentFingerprint,
        itemKey: item._id,
        item,
        secret,
      });

      if (!verification.valid) {
        stats.rejected++;
        continue;
      }

      item.invoice_source_proof = proof;
      stats.signed++;
    } catch {
      stats.rejected++;
    }
  }

  return stats;
}
