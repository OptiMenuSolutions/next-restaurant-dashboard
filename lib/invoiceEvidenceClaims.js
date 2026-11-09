
import {
  parseOrdinaryInvoicePackage,
} from './invoiceOrdinaryPackage.js';

function clean(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function number(value) {
  const text = clean(value).replace(/[$,]/g, '');

  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}

function occurrences(haystack, needle) {
  if (!needle) return 0;

  let count = 0;
  let from = 0;

  while (true) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;

    count++;
    from = index + needle.length;
  }

  return count;
}

function findSourceRow(ocrText, quote) {
  if (
    typeof quote !== 'string' ||
    !quote.trim() ||
    quote.length > 2000
  ) {
    return null;
  }

  const row = quote.trim();
  const document = String(ocrText || '');

  // Require one exact source occurrence.
  if (occurrences(document, row) !== 1) {
    return null;
  }

  // HTML evidence must identify one complete table row.
  if (/^<tr\b/i.test(row)) {
    if (!/<\/tr>\s*$/i.test(row)) {
      return null;
    }

    const cells = [
      ...row.matchAll(
        /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi
      ),
    ].map(match => clean(match[1]));

    return cells.length >= 4
      ? { row, cells, html: true }
      : null;
  }

  // Plain-text evidence must identify one product line,
  // not an entire page containing unrelated products.
  if (
    row.includes('\n') ||
    row.includes('\r') ||
    /<table|<tr|<td|<th/i.test(row)
  ) {
    return null;
  }

  return {
    row,
    cells: null,
    html: false,
  };
}

function sourceHasField(source, claim) {
  if (
    typeof claim !== 'string' ||
    !claim.trim()
  ) {
    return false;
  }

  if (source.html) {
    return source.cells.some(cell =>
      cell === clean(claim)
    );
  }

  const escaped = claim.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  const pattern = new RegExp(
    `(^|[^a-zA-Z0-9])${escaped}(?=$|[^a-zA-Z0-9])`
  );

  return pattern.test(source.row);
}

function amountAgrees(first, second) {
  return (
    Number.isFinite(first) &&
    Number.isFinite(second) &&
    Math.abs(first - second) <= 0.01
  );
}


function verifyFinancialRoles(source, ocrText, evidence) {
  // For now, only tables with independently
  // interpretable headings can authenticate pricing.
  // Unsupported layouts must fail closed.
  if (!source.html) return false;

  const tables = [
    ...String(ocrText || '').matchAll(
      /<table\b[^>]*>([\s\S]*?)<\/table>/gi
    ),
  ];

  const roleNames = {
    quantity: new Set([
      'ship',
      'shipped',
      'shp',
      'qty',
      'quantity',
      'qty shipped',
      'quantity shipped',
    ]),
    price: new Set([
      'unit price',
      'unit cost',
      'unit $',
      'case price',
      'price per case',
      'price case',
      'price',
    ]),
    extension: new Set([
      'extended',
      'extension',
      'amount',
      'line total',
      'ext price',
    ]),
  };

  for (const tableMatch of tables) {
    const table = tableMatch[1];

    if (!table.includes(source.row)) {
      continue;
    }

    const rows = [
      ...table.matchAll(
        /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
      ),
    ];

    const matchingRows = rows.filter(match =>
      match[0].includes(source.row)
    );

    if (matchingRows.length !== 1) {
      return false;
    }

    const headerRows = rows.filter(match =>
      /<th\b/i.test(match[1]) &&
      match.index < matchingRows[0].index
    );

    if (headerRows.length !== 1) {
      return false;
    }

    const headers = [
      ...headerRows[0][1].matchAll(
        /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi
      ),
    ].map(match =>
      clean(match[1])
        .toLowerCase()
        .replace(/[^a-z0-9$]+/g, ' ')
        .trim()
    );

    if (headers.length !== source.cells.length) {
      return false;
    }

    const positions = {};

    for (const [role, names] of Object.entries(roleNames)) {
      const matches = headers
        .map((header, index) =>
          names.has(header) ? index : -1
        )
        .filter(index => index >= 0);

      if (matches.length !== 1) {
        return false;
      }

      positions[role] = matches[0];
    }

    if (
      new Set(Object.values(positions)).size !== 3
    ) {
      return false;
    }

    const financialValuesAgree = (
      source.cells[positions.quantity] ===
        clean(evidence.quantity_text) &&
      source.cells[positions.price] ===
        clean(evidence.unit_price_text) &&
      source.cells[positions.extension] ===
        clean(evidence.extension_text)
    );

    if (!financialValuesAgree) {
      return false;
    }

    const findColumn = names => {
      const matches = headers
        .map((header, index) =>
          names.includes(header) ? index : -1
        )
        .filter(index => index >= 0);

      return matches.length === 1
        ? matches[0]
        : null;
    };

    return {
      packageIndex: findColumn([
        'pack size',
        'package size',
        'case pack',
        'packaging',
      ]),
      purchaseUnitIndex: findColumn([
        'uom',
        'purchase unit',
        'qty unit',
        'quantity unit',
      ]),
    };
  }

  return false;
}

function inspectClaim(item, ocrText) {
  const evidence = item?.source_evidence;

  const reject = (reason) => ({
    chargeVerified: false,
    packageVerified: false,
    reason,
    sourceRow: null,
    verifiedValues: null,
  });

  if (!evidence || typeof evidence !== 'object') {
    return reject('missing_source_evidence');
  }

  const source = findSourceRow(
    ocrText,
    evidence.row_text
  );

  if (!source) {
    return reject('source_row_not_found_or_ambiguous');
  }

  const fields = [
    evidence.description_text,
    evidence.quantity_text,
    evidence.unit_price_text,
    evidence.extension_text,
  ];

  if (!fields.every(field =>
    sourceHasField(source, field)
  )) {
    return reject('source_field_not_found');
  }

  const verifiedRoles = verifyFinancialRoles(
    source,
    ocrText,
    evidence
  );

  if (!verifiedRoles) {
    return reject('unverified_financial_roles');
  }

  // On HTML rows, financial roles must come from
  // distinct cells, rather than sharing a number
  // found somewhere in a product description.
  if (source.html) {
    const financial = [
      evidence.quantity_text,
      evidence.unit_price_text,
      evidence.extension_text,
    ];

    const positions = financial.map(field =>
      source.cells
        .map((cell, index) =>
          cell === clean(field) ? index : -1
        )
        .filter(index => index >= 0)
    );

    const assignments = new Set();

    for (const possible of positions) {
      if (possible.length !== 1) {
        return reject('ambiguous_financial_cell');
      }

      if (assignments.has(possible[0])) {
        return reject('overlapping_financial_cells');
      }

      assignments.add(possible[0]);
    }
  }

  const printedName = normalize(
    evidence.description_text
  );

  const extractedName = normalize(
    item.item_name_raw ||
    item.item_name_normalized
  );

  if (
    !printedName ||
    !extractedName ||
    (
      printedName !== extractedName &&
      !extractedName.startsWith(
        `${printedName} `
      )
    )
  ) {
    return reject('product_identity_mismatch');
  }

  // A printed monetary value cannot serve as a
  // shipped-quantity claim. Arithmetic alone cannot
  // establish the roles of financial values.
  const quantityText = clean(evidence.quantity_text);
  const unitPriceText = clean(evidence.unit_price_text);
  const extensionText = clean(evidence.extension_text);

  if (
    /[$€£]/.test(quantityText) ||
    /[$€£]/.test(
      quantityText.replace(/\s+/g, '')
    )
  ) {
    return reject('quantity_contains_currency');
  }

  // If the source explicitly marks prices as currency,
  // do not accept a bare quantity as the unit price
  // while treating a currency amount as quantity.
  if (
    /[$€£]/.test(extensionText) &&
    /[$€£]/.test(source.row) &&
    !/[$€£]/.test(unitPriceText) &&
    /[$€£]/.test(
      clean(evidence.quantity_text)
    )
  ) {
    return reject('financial_roles_inconsistent');
  }

  const quantity = number(evidence.quantity_text);
  const unitPrice = number(evidence.unit_price_text);
  const extension = number(evidence.extension_text);

  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    unitPrice === null ||
    unitPrice <= 0 ||
    extension === null ||
    extension <= 0 ||
    !amountAgrees(quantity * unitPrice, extension)
  ) {
    return reject('invalid_source_arithmetic');
  }

  // An OCR-backed field must also agree with the
  // corresponding AI-extracted value.
  if (
    number(item.quantity_shipped) !== quantity ||
    !amountAgrees(
      number(item.invoice_price),
      unitPrice
    ) ||
    !amountAgrees(
      number(item.line_total),
      extension
    )
  ) {
    return reject('extracted_values_disagree');
  }

  const verifiedValues = {
    quantity_shipped: quantity,
    invoice_price: unitPrice,
    line_total: extension,
  };

  const chargeResult = {
    chargeVerified: true,
    packageVerified: false,
    reason: 'package_not_verified',
    sourceRow: source.row,
    verifiedValues,
  };

  const purchaseUnit = evidence.purchase_unit_text;

  // Charge verification and packaging verification
  // are separate decisions. Missing package headings
  // cannot invalidate a verified supplier charge.
  if (
    verifiedRoles.purchaseUnitIndex === null ||
    verifiedRoles.packageIndex === null ||
    typeof purchaseUnit !== 'string' ||
    source.cells[verifiedRoles.purchaseUnitIndex] !==
      clean(purchaseUnit)
  ) {
    return chargeResult;
  }

  // Package verification is separate from confirming
  // the supplier's invoice charges.
  if (
    item.catch_weight === true ||
    purchaseUnit == null ||
    !['cs', 'case'].includes(
      normalize(purchaseUnit)
    )
  ) {
    return chargeResult;
  }

  const packageText = evidence.package_text;

  if (
    typeof packageText !== 'string' ||
    !packageText.trim() ||
    source.cells[verifiedRoles.packageIndex] !==
      clean(packageText) ||
    /#\s*\d+/.test(packageText)
  ) {
    return chargeResult;
  }

  const parsed = parseOrdinaryInvoicePackage(
    packageText
  );

  if (!parsed) {
    return chargeResult;
  }

  const extractedPack = Number(item.pack);
  const extractedSize = Number(item.size);
  const extractedUnit = String(
    item.size_unit || ''
  ).trim().toLowerCase();

  const countUnits = new Set([
    'ct', 'count', 'counts', 'ea', 'each',
  ]);

  const normalizedUnit = countUnits.has(extractedUnit)
    ? 'each'
    : extractedUnit;

  // Standalone source quantities, such as 12 CT or
  // 25 LB, may have equivalent pack/size representations.
  // Compound packages retain their exact structure.
  const standalonePackage =
    /^\d+(?:\.\d+)?\s*[a-z]/i.test(
      packageText.trim()
    );

  const validExtractedQuantities =
    Number.isSafeInteger(extractedPack) &&
    extractedPack > 0 &&
    Number.isFinite(extractedSize) &&
    extractedSize > 0;

  const quantitiesAgree = standalonePackage
    ? extractedPack * extractedSize ===
        parsed.pack * parsed.size
    : extractedPack === parsed.pack &&
        extractedSize === parsed.size;

  if (
    !validExtractedQuantities ||
    normalizedUnit !== parsed.size_unit ||
    !quantitiesAgree
  ) {
    return chargeResult;
  }

  return {
    chargeVerified: true,
    packageVerified: true,
    reason: null,
    sourceRow: source.row,
    verifiedValues: {
      ...verifiedValues,
      pack_size_raw: packageText,
      pack: parsed.pack,
      size: parsed.size,
      size_unit: parsed.size_unit,
    },
  };
}

/**
 * Checks AI-provided OCR source references.
 *
 * This module does not authenticate document fingerprints,
 * issue signed proofs, persist evidence, or update prices.
 *
 * Its results must pass the downstream security and
 * pricing checks before becoming financially authoritative.
 */
export function validateInvoiceEvidenceClaims(
  lineItems,
  ocrText
) {
  const items = Array.isArray(lineItems)
    ? lineItems
    : [];

  const results = items.map(item =>
    inspectClaim(item, ocrText)
  );

  // A single OCR row cannot authenticate two extracted
  // products, even if both claim identical values.
  const claims = new Map();

  for (const result of results) {
    if (!result.chargeVerified) continue;

    claims.set(
      result.sourceRow,
      (claims.get(result.sourceRow) || 0) + 1
    );
  }

  return results.map(result => {
    if (
      result.chargeVerified &&
      claims.get(result.sourceRow) > 1
    ) {
      return {
        chargeVerified: false,
        packageVerified: false,
        reason: 'duplicate_source_claim',
        sourceRow: null,
        verifiedValues: null,
      };
    }

    return result;
  });
}
