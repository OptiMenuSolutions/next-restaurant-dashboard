
function normalizeSku(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

function exactIdentifierInText(text, identifier) {
  if (!identifier) return false;

  const escaped = String(identifier).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  return new RegExp(
    `(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`,
    'i'
  ).test(text);
}

/**
 * Evaluate whether a supplier-to-manufacturer SKU
 * relationship is explicitly supported by retrieved
 * distributor source text.
 *
 * This is a preliminary evidence check, not proof of
 * document authenticity or conversion approval.
 */
export function verifySkuCrossReference({
  supplierSku,
  manufacturerSku,
  sourceDocument,
} = {}) {
  const review = (reason) => ({
    status: 'needs_review',
    reason,
    relationshipSupported: false,
    conversionApproved: false,
  });

  if (!supplierSku || !manufacturerSku) {
    return review('Both product identifiers are required');
  }

  if (
    !sourceDocument ||
    sourceDocument.origin !== 'anthropic_web_fetch' ||
    typeof sourceDocument.text !== 'string' ||
    !sourceDocument.text.trim()
  ) {
    return review('Retrieved source document is unavailable');
  }

  // Publisher attribution is not yet established by a
  // trusted verification process. A caller-supplied
  // "verified" flag must not establish source authority.
  //
  // Keep SKU cross-references in review until a trusted
  // attribution mechanism is implemented.
  return review(
    'Distributor authority has not been independently established'
  );

  const supplier = normalizeSku(supplierSku);
  const manufacturer = normalizeSku(manufacturerSku);

  if (!supplier || !manufacturer || supplier === manufacturer) {
    return review('Distinct supplier and manufacturer SKUs are required');
  }

  const lines = sourceDocument.text.split(/\r?\n/);

  const matchingLines = lines.filter((line) =>
    exactIdentifierInText(line, supplierSku) &&
    exactIdentifierInText(line, manufacturerSku)
  );

  if (matchingLines.length !== 1) {
    return review(
      'A unique explicit SKU relationship was not found'
    );
  }

  const line = matchingLines[0];

  // Require both identifier roles to be labeled.
  if (
    !/\b(?:supplier|distributor)\s*(?:sku|item|code|#)\b/i.test(line) ||
    !/\b(?:manufacturer|mfr)\s*(?:sku|item|code|#)\b/i.test(line)
  ) {
    return review('SKU relationship labels are missing');
  }

  return {
    status: 'source_relationship_found',
    reason: 'Both labeled identifiers appear in one source record',
    relationshipSupported: true,
    evidenceText: line.trim(),
    conversionApproved: false,
  };
}
