
/**
 * Consolidate research and retrieved-source evidence into
 * one verification decision.
 *
 * This is an evidence assessment, not conversion approval.
 * Publisher authority and exact product identity must be
 * independently established before approval is possible.
 */
export function decideProductVerification(evidence) {
  const result = (status, reason, checks) => ({
    status,
    reason,
    checks,
    verificationStatus: 'unverified',
    conversionApproved: false,
    conversion: null,
  });

  const checks = {
    invoicePackageMatches:
      evidence?.package?.matches === true,
    sourcePackageMatches:
      evidence?.packageEvidence?.packageEvidenceMatches === true,
    reportedIdentityMatches:
      evidence?.identityMatches === true,
    skuRelationshipDetected:
      evidence?.identityDetection?.relationshipDetected === true,
    skuRelationshipVerified:
      evidence?.identityVerification?.relationshipSupported === true,
    sourceAuthorityVerified: false,
  };

  if (!evidence) {
    return result(
      'needs_review',
      'Product evidence is unavailable',
      checks
    );
  }

  if (!checks.invoicePackageMatches) {
    return result(
      'rejected',
      'Research package count contradicts the invoice',
      checks
    );
  }

  if (!checks.sourcePackageMatches) {
    return result(
      'needs_review',
      evidence.packageEvidence?.reason ??
        'Retrieved source package evidence is incomplete or inconsistent',
      checks
    );
  }

  if (!checks.reportedIdentityMatches) {
    return result(
      'needs_review',
      'Product identity has not been established',
      checks
    );
  }

  if (
    evidence.identity?.supplierSku &&
    evidence.identity?.manufacturerSku &&
    evidence.identity.supplierSku !==
      evidence.identity.manufacturerSku &&
    !checks.skuRelationshipVerified
  ) {
    return result(
      'needs_review',
      'Supplier-to-manufacturer SKU relationship is not verified',
      checks
    );
  }

  return result(
    'needs_review',
    'Package evidence is consistent, but source authority remains unverified',
    checks
  );
}
