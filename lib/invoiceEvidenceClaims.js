
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


// Read weight and price units only when the original
// source explicitly identifies pounds. Never infer a
// unit solely from invoice arithmetic.
function explicitPoundWeight(value) {
  const match = clean(value).match(
    /^(\d+(?:\.\d+)?)\s+(LB|LBS)$/i
  );

  return match ? Number(match[1]) : null;
}

function explicitPerPoundPrice(value) {
  const match = clean(value).match(
    /^\$?(\d+(?:\.\d+)?)\s*\/\s*(LB|LBS)$/i
  );

  return match ? Number(match[1]) : null;
}

function shippedQuantity(value, purchaseUnit) {
  const direct = number(value);

  if (direct !== null) return direct;

  // A supplier may sell a fractional quantity directly
  // by weight, without a separate shipped case count.
  // Require an explicit matching purchase unit.
  if (['lb', 'lbs'].includes(normalize(purchaseUnit))) {
    const weight = explicitPoundWeight(value);

    if (weight !== null) return weight;
  }

  // Some suppliers print a shipped case count in one
  // cell, e.g. "1 CS". This is not the billed weight.
  const match = clean(value).match(
    /^(\d+)\s+(CS|CASE)$/i
  );

  if (
    !match ||
    !['cs', 'case'].includes(
      normalize(purchaseUnit)
    )
  ) {
    return null;
  }

  return Number(match[1]);
}

function shippedQuantitySourceAgrees(
  sourceCell,
  claimedQuantity,
  purchaseUnit
) {
  if (
    clean(sourceCell) === clean(claimedQuantity)
  ) {
    return true;
  }

  // Permit a separately extracted integer quantity
  // when the original shipped cell says "1 CS".
  const match = clean(sourceCell).match(
    /^(\d+)\s+(CS|CASE)$/i
  );

  return Boolean(
    match &&
    clean(claimedQuantity) === match[1] &&
    ['cs', 'case'].includes(
      normalize(purchaseUnit)
    )
  );
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

  // Markdown table rows retain explicit cell boundaries.
  // Financial roles are verified separately against
  // the original Markdown table headings.
  if (row.startsWith('|') && row.endsWith('|')) {
    if (/\\\|/.test(row)) return null;

    const cells = row
      .slice(1, -1)
      .split('|')
      .map(clean);

    if (
      cells.length < 4 ||
      cells.some(cell => !cell)
    ) {
      return null;
    }

    return {
      row,
      cells,
      html: false,
      markdown: true,
    };
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

  // Explicitly labeled plain-text fields can be
  // verified without relying on table formatting.
  //
  // Each field must have its own label and value.
  // Unlabeled or ambiguous text remains unsupported.
  const segments = row.split(';').map(
    segment => segment.trim()
  );

  if (segments.length >= 4) {
    const fields = segments.map(segment =>
      segment.match(/^([^:]+):\s*(.+)$/)
    );

    if (fields.every(Boolean)) {
      return {
        row,
        cells: fields.map(field => clean(field[2])),
        headers: fields.map(field =>
          clean(field[1])
            .toLowerCase()
            .replace(/[^a-z0-9$]+/g, ' ')
            .trim()
        ),
        html: false,
        labeled: true,
      };
    }
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

  if (source.cells) {
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



function normalizeHeading(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim();
}

function verifyColumnRoles(headers, cells, evidence) {
  if (
    !Array.isArray(headers) ||
    !Array.isArray(cells) ||
    headers.length !== cells.length
  ) {
    return false;
  }


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
      'price per lb',
      'price lb',
      'lb price',
    ]),
    extension: new Set([
      'extended',
      'extension',
      'amount',
      'line total',
      'ext price',
      'total',
    ]),
  };

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

  if (new Set(Object.values(positions)).size !== 3) {
    return false;
  }

  if (
    !shippedQuantitySourceAgrees(
      cells[positions.quantity],
      evidence.quantity_text,
      evidence.purchase_unit_text
    ) ||
    cells[positions.price] !==
      clean(evidence.unit_price_text) ||
    cells[positions.extension] !==
      clean(evidence.extension_text)
  ) {
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
    financialPositions: positions,
    descriptionIndex: findColumn([
      'description',
      'item description',
      'product description',
    ]),
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
      'unit',
    ]),
    packIndex: findColumn([
      'pack',
    ]),
    sizeIndex: findColumn([
      'size',
    ]),
    weightIndex: findColumn([
      'weight',
      'actual weight',
      'weight lb',
      'weight lbs',
      'actual weight lb',
      'actual weight lbs',
    ]),

    pricePerLb:
      [
        'price per lb',
        'price lb',
        'lb price',
      ].includes(headers[positions.price]) ||
      explicitPerPoundPrice(
        cells[positions.price]
      ) !== null,

  };
}

function markdownCells(line) {
  const value = String(line || '').trim();

  if (
    !value.startsWith('|') ||
    !value.endsWith('|') ||
    /\\\|/.test(value)
  ) {
    return null;
  }

  return value
    .slice(1, -1)
    .split('|')
    .map(clean);
}

function verifyMarkdownRoles(source, ocrText, evidence) {
  const lines = String(ocrText || '').split(/\r?\n/);

  const matches = lines
    .map((line, index) =>
      line.trim() === source.row ? index : -1
    )
    .filter(index => index >= 0);

  if (matches.length !== 1) {
    return false;
  }

  const rowIndex = matches[0];

  // Find the beginning of the contiguous Markdown
  // table containing the authenticated source row.
  let first = rowIndex;

  while (
    first > 0 &&
    markdownCells(lines[first - 1]) !== null
  ) {
    first--;
  }

  if (rowIndex < first + 2) {
    return false;
  }

  const headers = markdownCells(lines[first]);
  const separator = markdownCells(lines[first + 1]);

  if (
    !headers ||
    !separator ||
    headers.length !== separator.length ||
    headers.length !== source.cells.length ||
    !separator.every(cell =>
      /^:?-{3,}:?$/.test(cell)
    )
  ) {
    return false;
  }

  // Every intervening data row must maintain
  // the same number of columns.
  for (let index = first + 2; index <= rowIndex; index++) {
    const cells = markdownCells(lines[index]);

    if (!cells || cells.length !== headers.length) {
      return false;
    }
  }

  return verifyColumnRoles(
    headers.map(normalizeHeading),
    source.cells,
    evidence
  );
}

function verifyFinancialRoles(source, ocrText, evidence) {
  if (source.labeled) {
    return verifyColumnRoles(
      source.headers,
      source.cells,
      evidence
    );
  }

  if (source.markdown) {
    return verifyMarkdownRoles(
      source,
      ocrText,
      evidence
    );
  }

  if (!source.html) {
    return false;
  }

  const tables = [
    ...String(ocrText || '').matchAll(
      /<table\b[^>]*>([\s\S]*?)<\/table>/gi
    ),
  ];

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


    // Invoice headings may use either <th> or <td>.
    // Identify them by their independently verified
    // financial roles, not by HTML tag type alone.
    const precedingRows = rows.filter(match =>
      match.index < matchingRows[0].index
    );

    const candidates = precedingRows
      .map(match => {
        const headers = [
          ...match[1].matchAll(
            /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi
          ),
        ].map(cell =>
          normalizeHeading(cell[1])
        );

        return verifyColumnRoles(
          headers,
          source.cells,
          evidence
        );
      })
      .filter(Boolean);

    // Multiple matching heading rows are ambiguous.
    // Do not select one arbitrarily.
    return candidates.length === 1
      ? candidates[0]
      : false;

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
    evidence.quantity_text,
    evidence.unit_price_text,
    evidence.extension_text,
  ];

  const quantityPresent =
    sourceHasField(
      source,
      evidence.quantity_text
    ) ||
    (
      Array.isArray(source.cells) &&
      source.cells.some(cell =>
        shippedQuantitySourceAgrees(
          cell,
          evidence.quantity_text,
          evidence.purchase_unit_text
        )
      )
    );

  if (
    !quantityPresent ||
    ![
      evidence.unit_price_text,
      evidence.extension_text,
    ].every(field =>
      sourceHasField(source, field)
    )
  ) {
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


  // Product identity must be supported by the
  // original source Description column.
  //
  // Permit additional text after a complete
  // product name (such as supplier safety details),
  // but never an arbitrary partial word match.
  const claimedDescription = clean(
    evidence.description_text
  );

  const descriptionIndex =
    verifiedRoles.descriptionIndex;

  const printedDescription =
    descriptionIndex !== null &&
    descriptionIndex !== undefined
      ? source.cells?.[descriptionIndex]
      : null;

  const descriptionVerified =
    Boolean(claimedDescription) &&
    (
      printedDescription !== null
        ? (
            printedDescription ===
              claimedDescription ||
            printedDescription.startsWith(
              `${claimedDescription} `
            )
          )
        : sourceHasField(
            source,
            evidence.description_text
          )
    );

  if (!descriptionVerified) {
    return reject('source_field_not_found');
  }

  // Supplier safety contact information is not
  // part of the product's identity.
  //
  // Remove only a recognized terminal emergency
  // phone field. Preserve the original source
  // description for independent OCR verification.
  const productDescription = clean(
    evidence.description_text
  ).replace(
    /\s+EMERGENCY\s+PHONE:\s*\+?\d[\d().\-\s]*\d\s*$/i,
    ''
  );

  const printedName = normalize(
    productDescription
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

  const quantity = shippedQuantity(
    evidence.quantity_text,
    evidence.purchase_unit_text
  );

  const isCatchWeight = item.catch_weight === true;

  const unitPrice =
    number(evidence.unit_price_text) ??
    (
      isCatchWeight
        ? explicitPerPoundPrice(
            evidence.unit_price_text
          )
        : null
    );

  const extension = number(evidence.extension_text);

  const actualWeight = isCatchWeight
    ? (
        number(evidence.weight_text) ??
        explicitPoundWeight(
          evidence.weight_text
        )
      )
    : null;

  if (isCatchWeight) {
    const weightText = clean(
      evidence.weight_text
    );

    const weightUnit = normalize(
      evidence.weight_unit_text
    );

    const validWeightValue =
      actualWeight !== null &&
      actualWeight > 0 &&
      ['lb', 'lbs'].includes(weightUnit) &&
      amountAgrees(
        number(item.actual_weight),
        actualWeight
      );

    // Existing supported format:
    // Dedicated Weight LB and Price Per LB columns.
    const dedicatedWeightSource =
      verifiedRoles.weightIndex != null &&
      verifiedRoles.pricePerLb === true &&
      source.cells?.[verifiedRoles.weightIndex] ===
        weightText;

    // Direct-weight supplier format:
    // The quantity column itself establishes the weight.
    // No case count or separate weight column is needed.
    // Require explicit pound units in both the source
    // quantity and the independently quoted weight.
    const directWeightSource =
      verifiedRoles.pricePerLb === true &&
      ['lb', 'lbs'].includes(
        normalize(evidence.purchase_unit_text)
      ) &&
      ['lb', 'lbs'].includes(
        normalize(item.quantity_unit)
      ) &&
      explicitPoundWeight(
        source.cells?.[
          verifiedRoles.financialPositions.quantity
        ]
      ) === actualWeight &&
      clean(evidence.quantity_text) === weightText;

    // Alternative supplier format:
    // A terminal weight in the Description column,
    // an explicitly labeled Unit column containing
    // LB, and invoice arithmetic based on that weight.
    const descriptionIndex =
      verifiedRoles.descriptionIndex;

    const purchaseUnitIndex =
      verifiedRoles.purchaseUnitIndex;

    const printedDescription =
      descriptionIndex != null
        ? source.cells?.[descriptionIndex]
        : null;

    const printedPurchaseUnit =
      purchaseUnitIndex != null
        ? source.cells?.[purchaseUnitIndex]
        : null;

    const embeddedWeightSource =
      typeof printedDescription === 'string' &&
      printedDescription.endsWith(
        ` ${weightText}`
      ) &&
      printedPurchaseUnit === 'LB' &&
      weightUnit === 'lb' &&
      normalize(item.quantity_unit) === 'lb' &&
      verifiedRoles.financialPositions.price !==
        descriptionIndex &&
      verifiedRoles.financialPositions.extension !==
        descriptionIndex &&
      verifiedRoles.financialPositions.quantity !==
        descriptionIndex;

    if (
      !validWeightValue ||
      !(
        dedicatedWeightSource ||
        directWeightSource ||
        embeddedWeightSource
      )
    ) {
      return reject('catch_weight_evidence_mismatch');
    }
  }

  const chargeQuantity = isCatchWeight
    ? actualWeight
    : quantity;

  // Case and item counts must remain whole numbers.
  // Fractional quantities are permitted only when the
  // source explicitly sells the product by pounds.
  const directWeightQuantity =
    isCatchWeight &&
    ['lb', 'lbs'].includes(
      normalize(evidence.purchase_unit_text)
    ) &&
    ['lb', 'lbs'].includes(
      normalize(item.quantity_unit)
    ) &&
    explicitPoundWeight(
      evidence.quantity_text
    ) === quantity &&
    quantity === actualWeight &&
    verifiedRoles.pricePerLb === true;

  if (
    !(
      Number.isSafeInteger(quantity) ||
      (
        directWeightQuantity &&
        Number.isFinite(quantity)
      )
    ) ||
    quantity <= 0 ||
    unitPrice === null ||
    unitPrice <= 0 ||
    extension === null ||
    extension <= 0 ||
    !amountAgrees(
      chargeQuantity * unitPrice,
      extension
    )
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
    ...(isCatchWeight
      ? {
          actual_weight: actualWeight,
          weight_unit: 'lb',
        }
      : {}),
  };

  const chargeResult = {
    chargeVerified: true,
    packageVerified: false,
    reason: 'package_not_verified',
    sourceRow: source.row,
    verifiedValues,
  };


  const purchaseUnit = evidence.purchase_unit_text;

  // Charge verification and package verification
  // remain independent.
  if (
    verifiedRoles.purchaseUnitIndex === null ||
    typeof purchaseUnit !== 'string' ||
    !source.cells ||
    source.cells[verifiedRoles.purchaseUnitIndex] !==
      clean(purchaseUnit)
  ) {
    return chargeResult;
  }

  // Only explicitly labeled case purchases are
  // eligible for ordinary package verification.
  if (
    item.catch_weight === true ||
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
    /#\s*\d+/.test(packageText)
  ) {
    return chargeResult;
  }

  let sourcePackageText = null;

  // Existing single-column package format.
  if (verifiedRoles.packageIndex !== null) {
    sourcePackageText =
      source.cells[verifiedRoles.packageIndex];
  } else if (
    verifiedRoles.packIndex !== null &&
    verifiedRoles.sizeIndex !== null &&
    verifiedRoles.packIndex !==
      verifiedRoles.sizeIndex &&
    ![
      verifiedRoles.packIndex,
      verifiedRoles.sizeIndex,
    ].includes(verifiedRoles.purchaseUnitIndex) &&
    ![
      verifiedRoles.packIndex,
      verifiedRoles.sizeIndex,
    ].includes(
      verifiedRoles.financialPositions.quantity
    ) &&
    ![
      verifiedRoles.packIndex,
      verifiedRoles.sizeIndex,
    ].includes(
      verifiedRoles.financialPositions.price
    ) &&
    ![
      verifiedRoles.packIndex,
      verifiedRoles.sizeIndex,
    ].includes(
      verifiedRoles.financialPositions.extension
    )
  ) {
    // Performance Foodservice prints Pack and
    // Size in separate, explicitly labeled cells.
    const printedPack =
      source.cells[verifiedRoles.packIndex];

    const printedSize =
      source.cells[verifiedRoles.sizeIndex];

    if (
      printedPack &&
      printedSize &&
      /^\d+$/.test(printedPack)
    ) {
      sourcePackageText =
        `${printedPack} ${printedSize}`;
    }
  }

  // The reconstructed package must agree exactly
  // with the AI-quoted source evidence.
  if (
    sourcePackageText === null ||
    clean(sourcePackageText) !==
      clean(packageText)
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
