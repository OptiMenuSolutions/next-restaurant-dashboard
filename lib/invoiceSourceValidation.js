import {
  parseOrdinaryInvoicePackage,
} from './invoiceOrdinaryPackage.js';

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numeric(value) {
  const text = cleanText(value)
    .replace(/[$,]/g, '');

  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }

  const result = Number(text);

  return Number.isFinite(result)
    ? result
    : null;
}

function closeEnough(a, b) {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= 0.01
  );
}

function extractCells(row) {
  return [...row.matchAll(
    /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi
  )].map(match => cleanText(match[1]));
}

function columnIndex(headers, names) {
  return headers.findIndex(header =>
    names.includes(normalize(header))
  );
}

function extractSourceRows(ocrText) {
  const tables = [
    ...String(ocrText || '').matchAll(
      /<table\b[^>]*>([\s\S]*?)<\/table>/gi
    ),
  ];

  const rows = [];

  for (const table of tables) {
    const html = table[1];

    const headerMatch = html.match(
      /<thead\b[^>]*>([\s\S]*?)<\/thead>/i
    );

    if (!headerMatch) continue;

    const headers = extractCells(headerMatch[1]);

    const columns = {
      description: columnIndex(headers, [
        'description',
        'product description',
        'item description',
        'item description labeled pack',
      ]),
      shipped: columnIndex(headers, [
        'ship',
        'shipped',
        'shp',
        'qty',
        'quantity',
        'qty shipped',
        'quantity shipped',
      ]),
      uom: columnIndex(headers, [
        'uom',
        'qty unit',
        'quantity unit',
      ]),
      pack: columnIndex(headers, [
        'pack',
        'pk',
      ]),
      size: columnIndex(headers, [
        'size',
        'package size',
      ]),
      price: columnIndex(headers, [
        'unit',
        'unit price',
        'unit cost',
        'unit $',
        'case price',
        'price case',
        'price per case',
      ]),
      extended: columnIndex(headers, [
        'extended',
        'extension',
        'amount',
        'line total',
        'ext price',
      ]),
    };

    const required = [
      columns.description,
      columns.shipped,
      columns.price,
      columns.extended,
    ];

    if (required.some(index => index < 0)) {
      continue;
    }

    const separatePackageColumns =
      columns.pack >= 0 &&
      columns.size >= 0;

    const labeledDescription =
      columns.uom >= 0 &&
      !separatePackageColumns;

    if (!separatePackageColumns && !labeledDescription) {
      continue;
    }

    const body = html.match(
      /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i
    )?.[1] || html.replace(
      /<thead\b[^>]*>[\s\S]*?<\/thead>/i,
      ''
    );

    const htmlRows = [
      ...body.matchAll(
        /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
      ),
    ];

    for (const match of htmlRows) {
      const cells = extractCells(match[1]);

      if (cells.length !== headers.length) {
        continue;
      }

      const shipped = numeric(cells[columns.shipped]);
      const price = numeric(cells[columns.price]);
      const extended = numeric(cells[columns.extended]);

      if (
        !Number.isSafeInteger(shipped) ||
        shipped <= 0 ||
        price == null ||
        price < 0 ||
        extended == null ||
        extended < 0 ||
        !closeEnough(shipped * price, extended)
      ) {
        continue;
      }

      let description = cells[columns.description];
      let packSizeRaw = null;

      if (separatePackageColumns) {
        const pack = numeric(cells[columns.pack]);
        const sizeText = cells[columns.size];

        if (
          !Number.isSafeInteger(pack) ||
          pack <= 0
        ) {
          continue;
        }

        packSizeRaw = `${pack} ${sizeText}`;
      } else {
        const purchaseUnit = normalize(
          cells[columns.uom]
        );

        // A case price can only be divided into physical
        // units when the case contents are documented.
        if (!['case', 'cs'].includes(purchaseUnit)) {
          continue;
        }

        // Require an explicit, separated package suffix.
        // Do not infer a package from numbers appearing
        // elsewhere in a product description.
        const labeled = description.match(
          /^(.*?)\s+-\s+(.+)$/
        );

        if (!labeled) continue;

        const candidateDescription = labeled[1].trim();
        const candidatePackage = labeled[2].trim();

        if (!candidateDescription || !candidatePackage) {
          continue;
        }

        description = candidateDescription;
        packSizeRaw = candidatePackage;
      }

      // Numbered-can designations cannot establish
      // weight or volume without independent evidence.
      if (/#\s*\d+/.test(packSizeRaw)) {
        continue;
      }

      const parsedPackage = parseOrdinaryInvoicePackage(
        packSizeRaw
      );

      if (!parsedPackage || !description) {
        continue;
      }

      rows.push({
        description,
        descriptionKey: normalize(description),
        shipped,
        pack: parsedPackage.pack,
        size: parsedPackage.size,
        size_unit: parsedPackage.size_unit,
        pack_size_raw: packSizeRaw,
        invoice_price: price,
        line_total: extended,
      });
    }
  }

  return rows;
}

export function validateInvoiceAgainstSource(
  lineItems,
  ocrText
) {
  const sourceRows = extractSourceRows(ocrText);

  // Index source rows without discarding duplicates.
  // Duplicate descriptions cannot be recovered safely
  // without an additional source identifier.
  const byDescription = new Map();

  for (const row of sourceRows) {
    const matches =
      byDescription.get(row.descriptionKey) || [];

    matches.push(row);
    byDescription.set(row.descriptionKey, matches);
  }

  const extractedDescriptions = new Map();

  for (const item of lineItems || []) {
    const key = normalize(
      item.item_name_raw ||
      item.item_name_normalized
    );

    extractedDescriptions.set(
      key,
      (extractedDescriptions.get(key) || 0) + 1
    );
  }

  return (lineItems || []).map(item => {
    // Catch-weight calculations must retain their
    // separate source and accounting rules.
    if (item.catch_weight === true) {
      return item;
    }

    // Numbered cans must never acquire invented
    // physical quantities through this validator.
    if (
      /#\s*\d+/.test(
        String(item.pack_size_raw || '')
      )
    ) {
      return item;
    }

    const descriptionKey = normalize(
      item.item_name_raw ||
      item.item_name_normalized
    );

    const candidates =
      byDescription.get(descriptionKey) || [];

    if (
      candidates.length !== 1 ||
      extractedDescriptions.get(descriptionKey) !== 1
    ) {
      return item;
    }

    const source = candidates[0];

    // This layer only recovers quantities supported
    // by an unambiguous, arithmetically valid source row.
    return {
      ...item,
      quantity_shipped: source.shipped,
      pack_size_raw: source.pack_size_raw,
      pack: source.pack,
      size: source.size,
      size_unit: source.size_unit,
      invoice_price: source.invoice_price,
      line_total: source.line_total,
      source_validation_status:
        'source_table_consistent',
    };
  });
}