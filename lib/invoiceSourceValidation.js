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

function documentedCasePrice(value, purchaseUnit) {
  const unit = normalize(purchaseUnit);

  if (!['cs', 'case'].includes(unit)) {
    return null;
  }

  const match = cleanText(value).match(
    /^\$?(\d+(?:\.\d+)?)\s*\/\s*(CS|CASE)$/i
  );

  if (!match) return null;

  const price = Number(match[1]);

  return Number.isFinite(price)
    ? price
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

      const purchaseUnit = columns.uom >= 0
        ? cells[columns.uom]
        : null;

      const price =
        numeric(cells[columns.price]) ??
        documentedCasePrice(
          cells[columns.price],
          purchaseUnit
        );

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
      } else if (
        columns.pack >= 0 &&
        columns.size < 0 &&
        columns.uom >= 0
      ) {
        // A standalone PACK column can document the
        // complete contents of one purchased case.
        //
        // Require an explicitly documented case unit
        // and case-denominated price. Never interpret
        // a per-pound price as a case price.
        const unit = normalize(cells[columns.uom]);

        if (
          !['cs', 'case'].includes(unit) ||
          documentedCasePrice(
            cells[columns.price],
            cells[columns.uom]
          ) === null
        ) {
          continue;
        }

        packSizeRaw = cells[columns.pack];

        if (!parseOrdinaryInvoicePackage(packSizeRaw)) {
          continue;
        }
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

        // Preserve the full, documented source description.
        // Claude may retain the package suffix in item_name_raw.
        fullDescriptionKey: normalize(
          cells[columns.description]
        ),

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
  const byDescription = new Map();

  // Index both the product-only description and the
  // complete description printed on the invoice.
  //
  // The full description is accepted only when the
  // source row independently passed package parsing
  // and invoice arithmetic validation.
  for (const row of sourceRows) {
    const keys = new Set([
      row.descriptionKey,
      row.fullDescriptionKey,
    ]);

    for (const key of keys) {
      if (!key) continue;

      const matches = byDescription.get(key) || [];
      matches.push(row);
      byDescription.set(key, matches);
    }
  }

  const items = lineItems || [];

  // Identify source candidates before updating anything.
  const sourceCandidates = items.map(item => {
    if (item.catch_weight === true) {
      return null;
    }

    if (
      /#\s*\d+/.test(
        String(item.pack_size_raw || '')
      )
    ) {
      return null;
    }

    const descriptionKey = normalize(
      item.item_name_raw ||
      item.item_name_normalized
    );

    const matches =
      byDescription.get(descriptionKey) || [];

    return matches.length === 1
      ? matches[0]
      : null;
  });

  // Prevent multiple extracted lines from claiming
  // the same invoice source row, including when one
  // uses a clean name and another retains its package.
  const sourceClaims = new Map();

  for (const source of sourceCandidates) {
    if (!source) continue;

    sourceClaims.set(
      source,
      (sourceClaims.get(source) || 0) + 1
    );
  }

  return items.map((item, index) => {
    const source = sourceCandidates[index];

    if (
      !source ||
      sourceClaims.get(source) !== 1
    ) {
      return item;
    }

    // Recover only values established by the
    // independently validated source document.
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