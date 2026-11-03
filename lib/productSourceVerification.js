
function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsEvidence(documentText, evidenceText) {
  const document = normalize(documentText);
  const evidence = normalize(evidenceText);

  return Boolean(
    document &&
    evidence &&
    document.includes(evidence)
  );
}

/**
 * Check whether original source text supports the
 * reported product evidence.
 *
 * IMPORTANT:
 * sourceDocument.text must come from a separately
 * retrieved original document, NOT Claude's summary.
 *
 * Passing this check does not approve a conversion.
 */


/**
 * Parse an explicit case-pack specification.
 *
 * Examples:
 *   "6/120 oz."   -> 6 containers, 120 oz each
 *   "3/96 fl oz"  -> 3 containers, 96 fl oz each
 *
 * A #10 can designation is NOT a net measurement.
 */
export function parseSourcePackSpecification(value) {
  const text = String(value ?? '').trim();

  const match = text.match(
    /^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(fl\s*oz|oz|lb|g|kg|ml|l|gal)\.?$/i
  );

  if (!match) return null;

  const packageCount = Number(match[1]);
  const netQuantity = Number(match[2]);
  const netUnit = match[3]
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (
    !Number.isSafeInteger(packageCount) ||
    packageCount <= 0 ||
    !Number.isFinite(netQuantity) ||
    netQuantity <= 0
  ) {
    return null;
  }

  return {
    packageCount,
    netQuantity,
    netUnit,
    measurementScope: 'per_container',
  };
}


/**
 * Find an explicitly labeled package specification
 * within a single product-specific source record.
 *
 * Supports:
 *   Pack Size: 6/120 oz.
 *
 *   Pack Size:
 *   6/120 oz.
 *
 * Rejects missing, invalid, or conflicting values.
 *
 * This does not establish product identity or
 * approve a conversion.
 */
export function extractSourcePackSpecification(recordText) {
  if (typeof recordText !== 'string' || !recordText.trim()) {
    return {
      status: 'needs_review',
      reason: 'Product record text is missing',
      specification: null,
    };
  }

  const lines = recordText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  let invalidLabels = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /^(?:pack size|case pack|case size)\s*:\s*(.*)$/i
    );

    if (!match) continue;

    const inlineValue = match[1].trim();

    // Only look at the next nonempty line when
    // the label has no inline value.
    const value = inlineValue || lines[i + 1] || '';

    const parsed = parseSourcePackSpecification(value);

    if (!parsed) {
      invalidLabels++;
      continue;
    }

    candidates.push({
      raw: value,
      parsed,
    });
  }

  if (invalidLabels > 0) {
    return {
      status: 'needs_review',
      reason: 'A labeled package specification is ambiguous',
      specification: null,
    };
  }

  if (candidates.length === 0) {
    return {
      status: 'needs_review',
      reason: 'No explicit package specification found',
      specification: null,
    };
  }

  const unique = new Map();

  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.parsed);
    unique.set(key, candidate);
  }

  if (unique.size !== 1) {
    return {
      status: 'needs_review',
      reason: 'Conflicting package specifications found',
      specification: null,
    };
  }

  return {
    status: 'extracted',
    reason: 'Explicit package specification found',
    specification: [...unique.values()][0],
  };
}


/**
 * Locate a product-specific section in retrieved text.
 *
 * This supports product sections separated by Markdown
 * headings, as commonly returned by Anthropic web_fetch.
 *
 * It does not independently authenticate the document.
 */
export function extractProductSourceRecord(
  documentText,
  productIdentifier
) {
  const review = (reason) => ({
    status: 'needs_review',
    reason,
    record: null,
  });

  if (
    typeof documentText !== 'string' ||
    !documentText.trim() ||
    typeof productIdentifier !== 'string' ||
    !productIdentifier.trim()
  ) {
    return review('Document or product identifier is missing');
  }

  const identifier = productIdentifier.trim();

  const lines = documentText.split(/\r?\n/);

  // Identify product headings, not metadata headings.
  const headings = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,3}\s+\S/.test(lines[i].trim())) {
      headings.push(i);
    }
  }

  if (headings.length === 0) {
    return review('No product sections found');
  }

  const matchingRecords = [];

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i];
    const end = headings[i + 1] ?? lines.length;

    const recordText = lines
      .slice(start, end)
      .join('\n')
      .trim();

    const escapedIdentifier = identifier.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

    const identifierPattern = new RegExp(
      `(^|[^A-Za-z0-9])${escapedIdentifier}($|[^A-Za-z0-9])`,
      'i'
    );

    if (!identifierPattern.test(recordText)) {
      continue;
    }


    // Multiple values for the same identifier type can
    // indicate different products in one section.
    // Different identifier types may legitimately
    // describe the same product.
    const identifiersByType = new Map();

    const recordLines = recordText.split(/\r?\n/);

    for (let j = 0; j < recordLines.length; j++) {
      const line = recordLines[j].trim();

      const identifierMatch = line.match(
        /^(manufacturer\s+sku|supplier\s+sku|product\s+code|item\s+(?:number|no\.?|#)|sku)\s*:\s*(.*)$/i
      );

      if (!identifierMatch) continue;

      const identifierType = identifierMatch[1]
        .toLowerCase()
        .replace(/\s+/g, ' ');

      const identifierValue =
        identifierMatch[2].trim() ||
        recordLines[j + 1]?.trim() ||
        '';

      if (!identifierValue) continue;

      if (!identifiersByType.has(identifierType)) {
        identifiersByType.set(identifierType, new Set());
      }

      identifiersByType
        .get(identifierType)
        .add(identifierValue.toUpperCase());
    }

    // Reject multiple distinct values assigned to the
    // same identifier type within one product section.
    const conflictingIdentifiers = [
      ...identifiersByType.values(),
    ].some((values) => values.size > 1);

    if (conflictingIdentifiers) {
      continue;
    }


    const packageResult =
      extractSourcePackSpecification(recordText);

    if (packageResult.status !== 'extracted') {
      continue;
    }

    matchingRecords.push({
      text: recordText,
      identifier,
      packageSpecification: packageResult.specification,
    });
  }

  if (matchingRecords.length === 0) {
    return review(
      'No product section contains both identifier and package specification'
    );
  }

  if (matchingRecords.length !== 1) {
    return review(
      'Multiple product sections match the identifier'
    );
  }

  return {
    status: 'record_found',
    reason: 'Product identifier and package specification share a section',
    record: matchingRecords[0],
  };
}

/**
 * Compare a structured measurement against an explicit
 * package specification from retrieved source text.
 *
 * This validates the measurement, not product identity.
 */
export function validateSourcePackMeasurement(
  measurement,
  packageCount,
  sourceSpecification
) {
  const parsed = parseSourcePackSpecification(
    sourceSpecification
  );

  if (!parsed) {
    return {
      matches: false,
      reason: 'Source package specification is missing or ambiguous',
    };
  }

  if (parsed.packageCount !== Number(packageCount)) {
    return {
      matches: false,
      reason: 'Package count differs from source',
    };
  }

  if (
    parsed.netQuantity !== Number(measurement?.quantity) ||
    parsed.netUnit !== String(measurement?.unit ?? '')
      .trim()
      .toLowerCase() ||
    measurement?.scope !== 'per_container'
  ) {
    return {
      matches: false,
      reason: 'Per-container measurement differs from source',
    };
  }

  return {
    matches: true,
    reason: 'Measurement matches explicit source specification',
    parsed,
  };
}

export function verifyProductSourceEvidence(
  evidence,
  sourceDocument
) {
  const review = (reason) => ({
    status: 'needs_review',
    reason,
    verificationStatus: 'unverified',
    conversionApproved: false,
  });

  if (!evidence || !sourceDocument) {
    return review('Original source document is unavailable');
  }

  if (
    sourceDocument.origin !== 'original_document' ||
    typeof sourceDocument.text !== 'string' ||
    !sourceDocument.text.trim()
  ) {
    return review('Independent source text is unavailable');
  }

  if (
    !evidence.source?.url ||
    evidence.source.url !== sourceDocument.url
  ) {
    return review('Source URL does not match');
  }

  if (
    evidence.package?.matches !== true ||
    evidence.identityMatches !== true ||
    !evidence.measurement
  ) {
    return review('Product or package evidence does not match');
  }

  const claims = sourceDocument.claims;
  const record = sourceDocument.productRecord;

  if (!claims || typeof claims !== 'object') {
    return review('Source evidence excerpts are missing');
  }

  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.text !== 'string' ||
    !record.text.trim()
  ) {
    return review('Product-specific source record is missing');
  }

  // The product record must appear verbatim in the
  // independently retrieved original document.
  if (!containsEvidence(sourceDocument.text, record.text)) {
    return review('Product record is not present in source');
  }

  // Check that the reported identifier belongs to
  // the same product as the reported measurement.
  const expectedIdentifiers = [
    evidence.identity?.manufacturerSku,
    evidence.identity?.supplierSku,
  ].filter(Boolean);

  if (expectedIdentifiers.length === 0) {
    return review('Product identifier is missing');
  }

  const identifierMatches = expectedIdentifiers.some(
    (identifier) =>
      normalize(record.identifier) === normalize(identifier)
  );

  if (!identifierMatches) {
    return review('Product record identifier does not match');
  }

  if (
    Number(record.packageCount) !==
    evidence.package.expectedCount
  ) {
    return review('Product record package count does not match');
  }

  if (
    Number(record.netQuantity) !==
      evidence.measurement.quantity ||
    normalize(record.netUnit) !==
      normalize(evidence.measurement.unit) ||
    record.measurementScope !== 'per_container'
  ) {
    return review('Product record measurement does not match');
  }

  const requiredClaims = [
    'productIdentifier',
    'packageCount',
    'netMeasurement',
  ];

  for (const key of requiredClaims) {
    if (
      !containsEvidence(record.text, claims[key]) ||
      !containsEvidence(sourceDocument.text, claims[key])
    ) {
      return review(
        `Product record does not contain ${key} evidence`
      );
    }
  }

  return {
    status: 'source_evidence_present',
    reason: 'Required excerpts appear in supplied source text',
    verificationStatus: 'pending_independent_validation',
    conversionApproved: false,
  };
}


/**
 * Compare invoice product evidence against a package
 * specification in retrieved source text.
 *
 * This checks textual consistency only.
 * It does not establish source authority, independently
 * verify product identity, or approve conversions.
 */
export function evaluateRetrievedPackageEvidence(
  evidence,
  sourceDocument
) {
  const review = (reason) => ({
    status: 'needs_review',
    reason,
    packageEvidenceMatches: false,
    verificationStatus: 'unverified',
    conversionApproved: false,
  });

  if (
    !evidence ||
    !sourceDocument ||
    sourceDocument.origin !== 'anthropic_web_fetch' ||
    typeof sourceDocument.text !== 'string' ||
    !sourceDocument.text.trim()
  ) {
    return review('Retrieved source document is unavailable');
  }

  if (
    !evidence.source?.url ||
    !sourceDocument.url ||
    evidence.source.url !== sourceDocument.url
  ) {
    return review('Source URL does not match');
  }

  if (
    evidence.package?.matches !== true ||
    !evidence.measurement
  ) {
    return review(
      'Invoice package or reported measurement is incomplete'
    );
  }

  const manufacturerSku = evidence.identity?.manufacturerSku;

  if (!manufacturerSku) {
    return review(
      'Manufacturer product identifier is unavailable'
    );
  }

  const recordResult = extractProductSourceRecord(
    sourceDocument.text,
    manufacturerSku
  );

  if (recordResult.status !== 'record_found') {
    return review(recordResult.reason);
  }

  const specification =
    recordResult.record.packageSpecification;

  const measurementResult = validateSourcePackMeasurement(
    evidence.measurement,
    evidence.package.expectedCount,
    specification.raw
  );

  if (!measurementResult.matches) {
    return review(measurementResult.reason);
  }

  return {
    status: 'package_evidence_found',
    reason:
      'Retrieved product section contains matching package information',
    packageEvidenceMatches: true,
    productIdentifier: manufacturerSku,
    sourceSpecification: specification.raw,
    verificationStatus: 'unverified',
    conversionApproved: false,
  };
}
