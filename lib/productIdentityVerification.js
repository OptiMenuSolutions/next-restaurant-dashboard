
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


function labeledIdentifierInText(text, labelPattern, identifier) {
  if (!identifier) return false;

  const escaped = String(identifier).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  const pattern = new RegExp(
    `\\b(?:${labelPattern})\\s*(?:SKU|ITEM|CODE|#)\\s*[:#=-]?\\s*${escaped}(?![A-Za-z0-9])`,
    'i'
  );

  return pattern.test(text);
}


/**
 * Detect a possible supplier-to-manufacturer SKU relationship
 * in retrieved source text.
 *
 * This function examines the document content only.
 * It does not establish publisher identity, document
 * authenticity, or conversion approval.
 */
export function detectSkuCrossReference({
  supplierSku,
  manufacturerSku,
  sourceDocument,
} = {}) {
  const review = (reason) => ({
    status: 'needs_review',
    reason,
    relationshipDetected: false,
    evidenceText: null,
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

  const supplier = normalizeSku(supplierSku);
  const manufacturer = normalizeSku(manufacturerSku);

  if (!supplier || !manufacturer || supplier === manufacturer) {
    return review(
      'Distinct supplier and manufacturer SKUs are required'
    );
  }

  const lines = sourceDocument.text.split(/\r?\n/);

    const matchingLines = lines.filter((line) =>
    labeledIdentifierInText(
        line,
        'supplier|distributor',
        supplierSku
    ) &&
    labeledIdentifierInText(
        line,
        'manufacturer|mfr',
        manufacturerSku
    )
    );

  if (matchingLines.length !== 1) {
    return review(
      'A unique explicit SKU relationship was not found'
    );
  }

  const line = matchingLines[0];

  if (
    !/\b(?:supplier|distributor)\s*(?:sku|item|code|#)\b/i.test(line) ||
    !/\b(?:manufacturer|mfr)\s*(?:sku|item|code|#)\b/i.test(line)
  ) {
    return review('SKU relationship labels are missing');
  }

  return {
    status: 'candidate_relationship_found',
    reason: 'Both labeled identifiers appear in one source record',
    relationshipDetected: true,
    evidenceText: line.trim(),
    conversionApproved: false,
  };
}

/**
 * Determine whether a detected SKU relationship can be
 * accepted as verified evidence.
 *
 * Publisher authority is not yet independently established.
 * Caller-supplied attribution fields are not trusted.
 *
 * Until a trusted verification mechanism is implemented,
 * this function must not approve relationships.
 */
export function verifySkuCrossReference({
  supplierSku,
  manufacturerSku,
  sourceDocument,
} = {}) {
  const detection = detectSkuCrossReference({
    supplierSku,
    manufacturerSku,
    sourceDocument,
  });

  if (!detection.relationshipDetected) {
    return {
      status: 'needs_review',
      reason: detection.reason,
      relationshipSupported: false,
      conversionApproved: false,
    };
  }

  return {
    status: 'needs_review',
    reason:
      'Distributor authority has not been independently established',
    relationshipSupported: false,
    conversionApproved: false,
  };
}
