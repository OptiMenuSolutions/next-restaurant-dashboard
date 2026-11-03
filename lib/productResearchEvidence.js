
const MEASUREMENT_UNITS = new Set([
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'ml', 'l', 'gal',
  'each',
]);

const TRUSTED_SOURCE_TYPES = new Set([
  'manufacturer',
  'distributor',
]);

const normalize = (value) =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const normalizeSku = (value) =>
  String(value ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

function validSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Evaluate whether product research is ready for independent
 * source verification before an automatic conversion is saved.
 *
 * This function does NOT verify that a webpage exists or that
 * its content supports the claimed measurement.
 */
export function evaluateProductResearch(product, finding) {
  const review = (reason) => ({
    status: 'needs_review',
    reason,
    conversion: null,
  });

  if (!product || !finding) {
    return review('Missing product or research evidence');
  }

  if (!product.brand || !product.sku) {
    return review('Insufficient product identification');
  }


  const brandMatches =
    normalize(product.brand) === normalize(finding.brand);

  const skuMatches =
    normalizeSku(product.sku) === normalizeSku(finding.sku);

  const crossReference = finding.skuCrossReference || null;

  const crossReferenceMatches =
    crossReference?.supplierSku &&
    crossReference?.manufacturerSku &&
    normalizeSku(crossReference.supplierSku) ===
      normalizeSku(product.sku) &&
    normalizeSku(crossReference.manufacturerSku) ===
      normalizeSku(finding.sku);

  if (!brandMatches) {
    return review('Product brand does not match');
  }

  if (!skuMatches && !crossReferenceMatches) {
    return review('Product SKU does not match');
  }

  // A claimed SKU cross-reference still needs independent
  // verification before it can be used for a conversion.
  if (!skuMatches && crossReferenceMatches) {
    return review('SKU cross-reference requires source verification');
  }


  const expectedCount = Number(product.packageCount);
  const foundCount = Number(finding.packageCount);

  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount <= 0 ||
    foundCount !== expectedCount
  ) {
    return review('Package configuration does not match');
  }

  const quantity = Number(finding.netQuantity);
  const unit = normalize(finding.netUnit);

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !MEASUREMENT_UNITS.has(unit)
  ) {
    return review('Missing or unsupported net measurement');
  }

  if (finding.measurementScope !== 'per_container') {
    return review(
      'Net measurement is not confirmed per container'
    );
  }

  if (
    !TRUSTED_SOURCE_TYPES.has(normalize(finding.sourceType)) ||
    !validSourceUrl(finding.sourceUrl)
  ) {
    return review('Authoritative source evidence is missing');
  }

  if (!normalize(finding.evidenceText)) {
    return review('Source measurement evidence is missing');
  }

  const containerUnit = normalize(product.containerUnit);

  if (!containerUnit) {
    return review('Container unit is missing');
  }


  return {
    status: 'eligible_for_verification',
    reason:
      'Reported product details are eligible for independent verification',
    conversion: null,
    proposedMeasurement: {
      quantity,
      unit,
      scope: 'per_container',
    },
    source: {
      url: finding.sourceUrl,
      claimedType: normalize(finding.sourceType),
      evidenceText: finding.evidenceText,
      verificationStatus: 'unverified',
    },
    conversionApproved: false,
  };
}
