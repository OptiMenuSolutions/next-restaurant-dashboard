/**
 * Invoice pricing provenance.
 *
 * A valid mathematical conversion is not sufficient
 * to establish that an invoice price was verified.
 *
 * Verification must originate from trusted server-side
 * evidence, not from a client-provided status.
 */

export function hasVerifiedInvoicePrice(line) {
  if (!line || typeof line !== 'object') {
    return false;
  }

  if (line.price_verification_status !== 'verified') {
    return false;
  }

  if (
    typeof line.price_verification_source !== 'string' ||
    !line.price_verification_source.trim()
  ) {
    return false;
  }

  if (
    typeof line.price_verified_at !== 'string' ||
    !Number.isFinite(
      Date.parse(line.price_verified_at)
    )
  ) {
    return false;
  }

  const evidence = line.price_verification_evidence;

  if (
    !evidence ||
    typeof evidence !== 'object' ||
    Array.isArray(evidence) ||
    Object.keys(evidence).length === 0
  ) {
    return false;
  }

  return true;
}