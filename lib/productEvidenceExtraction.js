
import {
  detectSkuCrossReference,
  verifySkuCrossReference,
} from './productIdentityVerification.js';

import {
  evaluateRetrievedPackageEvidence,
} from './productSourceVerification.js';

const VALID_UNITS = new Set([
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'ml', 'l', 'gal',
  'each',
]);

function positiveNumber(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function positiveInteger(value) {
  const number = positiveNumber(value);

  return number !== null && Number.isSafeInteger(number)
    ? number
    : null;
}

function optionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeSku(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

/**
 * Structure reported product information and separately
 * record candidate relationships found in retrieved text.
 *
 * Neither reported research nor candidate detection
 * establishes verified product identity.
 *
 * This function never approves a conversion.
 */
export function extractProductEvidence(
  invoiceProduct,
  research,
  sourceDocument = null
) {
  const raw = research?.findings ?? null;
  const source = research?.source ?? null;

  const empty = {
    status: 'needs_review',
    reason: 'Missing structured product research',
    identity: null,
    package: null,
    measurement: null,
    source,
    verificationStatus: 'unverified',
    conversionApproved: false,
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return empty;
  }

  const identity = {
    name: optionalText(raw.product_name),
    brand: optionalText(raw.brand),
    manufacturerSku: optionalText(raw.manufacturer_sku),
    supplierSku: optionalText(raw.supplier_sku),
  };

  const expectedCount = positiveInteger(
    invoiceProduct?.packageCount
  );

  const reportedCount = positiveInteger(raw.package_count);

  const packageMatches =
    expectedCount !== null &&
    reportedCount !== null &&
    expectedCount === reportedCount;

  const quantity = positiveNumber(raw.net_quantity);
  const unit = optionalText(raw.net_unit)?.toLowerCase() ?? null;

  const measurement =
    quantity !== null &&
    VALID_UNITS.has(unit) &&
    raw.measurement_scope === 'per_container'
      ? {
          quantity,
          unit,
          scope: 'per_container',
        }
      : null;

  const invoiceSku = normalizeSku(invoiceProduct?.sku);

  const identifierMatches =
    Boolean(invoiceSku) &&
    (
      invoiceSku === normalizeSku(identity.supplierSku) ||
      invoiceSku === normalizeSku(identity.manufacturerSku)
    );

  const invoiceBrand = optionalText(invoiceProduct?.brand);

  const brandMatches =
    Boolean(invoiceBrand) &&
    Boolean(identity.brand) &&
    invoiceBrand.toLowerCase() === identity.brand.toLowerCase();

  // These matches are based on reported research,
  // not independently verified manufacturer evidence.
  const identityMatches =
    identifierMatches && brandMatches;

  const identityVerification = {
    invoiceSkuPresent: Boolean(invoiceSku),
    reportedIdentifierMatches: identifierMatches,
    invoiceBrandPresent: Boolean(invoiceBrand),
    reportedBrandMatches: brandMatches,
    crossReferenceStatus: 'not_evaluated',
    status: 'unverified',
  };

  // Candidate detection does not establish source authority.
  const detection = sourceDocument
    ? detectSkuCrossReference({
        supplierSku: invoiceProduct?.sku,
        manufacturerSku: identity.manufacturerSku,
        sourceDocument,
      })
    : null;

  const identityDetection = {
    status: detection?.status ?? 'not_evaluated',
    relationshipDetected:
      detection?.relationshipDetected === true,
    evidenceText:
      detection?.relationshipDetected === true
        ? detection.evidenceText
        : null,
    reason:
      detection?.reason ?? 'No retrieved source document',
  };

  // Verification remains independent and fail-closed.
  const crossReference = sourceDocument
    ? verifySkuCrossReference({
        supplierSku: invoiceProduct?.sku,
        manufacturerSku: identity.manufacturerSku,
        sourceDocument,
      })
    : null;

  if (crossReference) {
    identityVerification.crossReferenceStatus =
      crossReference.status;

    identityVerification.crossReferenceEvidence =
      crossReference.relationshipSupported
        ? crossReference.evidenceText
        : null;
  }

  let reason = 'Product identity requires verification';

  if (!packageMatches) {
    reason = 'Package configuration does not match or is unknown';
  } else if (!measurement) {
    reason = 'Per-container measurement is missing';
  } else if (!identityMatches) {
    reason = 'Product identity or SKU requires verification';
  } else {
    reason = 'Reported details match; source verification required';
  }

    // Evaluate package information found in retrieved
  // source text, separately from Claude's research.
  const packageEvidence = sourceDocument
    ? evaluateRetrievedPackageEvidence(
        {
          identity,
          package: {
            expectedCount,
            reportedCount,
            matches: packageMatches,
          },
          measurement,
          source,
        },
        sourceDocument
      )
    : {
        status: 'not_evaluated',
        reason: 'No retrieved source document',
        packageEvidenceMatches: false,
        verificationStatus: 'unverified',
        conversionApproved: false,
      };

  return {
    status: 'needs_review',
    reason,
    identity,
    package: {
      expectedCount,
      reportedCount,
      matches: packageMatches,
    },
    measurement,
    identityMatches,
    identityDetection,
    identityVerification,
    packageEvidence,
    source,
    verificationStatus: 'unverified',
    conversionApproved: false,
  };
}
