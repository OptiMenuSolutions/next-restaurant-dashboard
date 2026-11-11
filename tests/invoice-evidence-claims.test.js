
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateInvoiceEvidenceClaims,
} from '../lib/invoiceEvidenceClaims.js';

const row =
  '<tr><td>2</td><td>CS</td>' +
  '<td>Roasted Turkey Breast</td>' +
  '<td>2/5 LB</td><td>$78.00</td>' +
  '<td>$156.00</td></tr>';

const header =
  '<tr><th>SHIP</th><th>UOM</th>' +
  '<th>DESCRIPTION</th><th>PACK / SIZE</th>' +
  '<th>UNIT $</th><th>EXTENDED</th></tr>';

const ocr = `<table>${header}${row}</table>`;

function item(overrides = {}) {
  return {
    item_name_raw: 'Roasted Turkey Breast',
    quantity_shipped: 2,
    invoice_price: 78,
    line_total: 156,
    pack_size_raw: '2/5 LB',
    pack: 2,
    size: 5,
    size_unit: 'lb',
    catch_weight: false,
    source_evidence: {
      row_text: row,
      description_text: 'Roasted Turkey Breast',
      quantity_text: '2',
      purchase_unit_text: 'CS',
      package_text: '2/5 LB',
      unit_price_text: '$78.00',
      extension_text: '$156.00',
    },
    ...overrides,
  };
}

test('validates an unfamiliar table with source headings', () => {
  const [result] = validateInvoiceEvidenceClaims(
    [item()],
    ocr
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, true);
  assert.equal(result.verifiedValues.pack, 2);
  assert.equal(result.verifiedValues.size, 5);
});

test('rejects fabricated prices', () => {
  const [result] = validateInvoiceEvidenceClaims(
    [item({ invoice_price: 99 })],
    ocr
  );

  assert.equal(result.chargeVerified, false);
});

test('rejects source rows absent from OCR', () => {
  const altered = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: row.replace(
        'Roasted Turkey Breast',
        'Invented Turkey Product'
      ),
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [altered],
    ocr
  );

  assert.equal(result.chargeVerified, false);
});

test('rejects duplicate claims on one OCR row', () => {
  const results = validateInvoiceEvidenceClaims(
    [item(), item()],
    ocr
  );

  assert.equal(results[0].chargeVerified, false);
  assert.equal(results[1].chargeVerified, false);
});

test('verifies supplier charge without inventing loaf conversion', () => {
  const breadRow =
    '<tr><td>2</td><td>CS</td>' +
    '<td>Sourdough Bread</td>' +
    '<td>8 LOAF</td><td>$46.00</td>' +
    '<td>$92.00</td></tr>';

  const bread = item({
    item_name_raw: 'Sourdough Bread',
    invoice_price: 46,
    line_total: 92,
    pack_size_raw: '8 LOAF',
    pack: 8,
    size: 1,
    size_unit: 'each',
    source_evidence: {
      row_text: breadRow,
      description_text: 'Sourdough Bread',
      quantity_text: '2',
      purchase_unit_text: 'CS',
      package_text: '8 LOAF',
      unit_price_text: '$46.00',
      extension_text: '$92.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [bread],
    `<table>${header}${breadRow}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
});

test('rejects inconsistent source arithmetic', () => {
  const badRow = row.replace(
    '$156.00',
    '$999.00'
  );

  const bad = item({
    line_total: 999,
    source_evidence: {
      ...item().source_evidence,
      row_text: badRow,
      extension_text: '$999.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [bad],
    `<table>${badRow}</table>`
  );

  assert.equal(result.chargeVerified, false);
});

test('rejects a package that only matches a substring', () => {
  const actualRow = row.replace(
    '2/5 LB',
    '12/5 LB'
  );

  const altered = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: actualRow,
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [altered],
    `<table>${header}${actualRow}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
});

test('validates source charges from plain-text OCR', () => {
  const line =
    'Roasted Turkey Breast | 2 | CS | 2/5 LB | $78.00 | $156.00';

  const plainItem = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [plainItem],
    line
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
  assert.equal(result.reason, 'unverified_financial_roles');
});

test('rejects ambiguous repeated OCR rows', () => {
  const [result] = validateInvoiceEvidenceClaims(
    [item()],
    `<table>${row}${row}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(
    result.reason,
    'source_row_not_found_or_ambiguous'
  );
});

test('rejects reversed quantity and unit price roles', () => {
  const reversed = item({
    quantity_shipped: 78,
    invoice_price: 2,
    source_evidence: {
      ...item().source_evidence,
      quantity_text: '$78.00',
      unit_price_text: '2',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [reversed],
    ocr
  );

  assert.equal(
    result.chargeVerified,
    false,
    'Source arithmetic alone cannot establish financial column roles'
  );
});

test('rejects reversed numeric roles without currency symbols', () => {
  const numericRow =
    '<tr><td>2</td><td>CS</td>' +
    '<td>Roasted Turkey Breast</td>' +
    '<td>2/5 LB</td><td>78.00</td>' +
    '<td>156.00</td></tr>';

  const reversed = item({
    quantity_shipped: 78,
    invoice_price: 2,
    source_evidence: {
      ...item().source_evidence,
      row_text: numericRow,
      quantity_text: '78.00',
      unit_price_text: '2',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [reversed],
    `<table>${header}${numericRow}</table>`
  );

  assert.equal(
    result.chargeVerified,
    false,
    'Numeric arithmetic cannot establish column roles'
  );
});


test('does not authenticate headerless numeric tables', () => {
  const [result] = validateInvoiceEvidenceClaims(
    [item()],
    `<table>${row}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
  assert.equal(
    result.reason,
    'unverified_financial_roles'
  );
});


test('rejects package text taken from a product name', () => {
  const misleadingRow =
    '<tr><td>2</td><td>CS</td>' +
    '<td>Roasted Turkey Breast 2/5 LB</td>' +
    '<td>12/5 LB</td><td>$78.00</td>' +
    '<td>$156.00</td></tr>';

  const misleading = item({
    item_name_raw: 'Roasted Turkey Breast 2/5 LB',
    source_evidence: {
      ...item().source_evidence,
      row_text: misleadingRow,
      description_text: 'Roasted Turkey Breast 2/5 LB',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [misleading],
    `<table>${header}${misleadingRow}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
});

test('validates reordered invoice columns', () => {
  const reorderedHeader =
    '<tr><th>DESCRIPTION</th><th>EXTENDED</th>' +
    '<th>PACK / SIZE</th><th>UNIT $</th>' +
    '<th>UOM</th><th>SHIP</th></tr>';

  const reorderedRow =
    '<tr><td>Roasted Turkey Breast</td>' +
    '<td>$156.00</td><td>2/5 LB</td>' +
    '<td>$78.00</td><td>CS</td><td>2</td></tr>';

  const reordered = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: reorderedRow,
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [reordered],
    `<table>${reorderedHeader}${reorderedRow}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, true);
});


test('verifies complete OTC-3103 invoice with independent source evidence', () => {
  const products = [
    {
      name: 'Roasted Turkey Breast',
      package: '2/5 LB',
      price: 78,
      total: 156,
      pack: 2,
      size: 5,
      unit: 'lb',
      expectedPackageVerified: true,
    },
    {
      name: 'Sliced Bacon',
      package: '2/5 LB',
      price: 59,
      total: 118,
      pack: 2,
      size: 5,
      unit: 'lb',
      expectedPackageVerified: true,
    },
    {
      name: 'Sourdough Bread',
      package: '8 LOAF',
      price: 46,
      total: 92,
      pack: 8,
      size: 1,
      unit: 'each',
      expectedPackageVerified: false,
    },
    {
      name: 'Romaine Hearts',
      package: '12 CT',
      price: 24,
      total: 72,
      pack: 1,
      size: 12,
      unit: 'each',
      expectedPackageVerified: true,
    },
    {
      name: 'Fresh Tomatoes',
      package: '25 LB',
      price: 39,
      total: 78,
      pack: 1,
      size: 25,
      unit: 'lb',
      expectedPackageVerified: true,
    },
  ];

  const sourceHeader =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>PACK / SIZE</th>' +
    '<th>UNIT $</th><th>EXTENDED</th></tr>';

  const items = products.map(product => {
    const shipped = product.total / product.price;

    const sourceRow =
      `<tr><td>${shipped}</td><td>CS</td>` +
      `<td>${product.name}</td>` +
      `<td>${product.package}</td>` +
      `<td>$${product.price.toFixed(2)}</td>` +
      `<td>$${product.total.toFixed(2)}</td></tr>`;

    return {
      item_name_raw: product.name,
      quantity_shipped: shipped,
      invoice_price: product.price,
      line_total: product.total,
      pack_size_raw: product.package,
      pack: product.pack,
      size: product.size,
      size_unit: product.unit,
      catch_weight: false,
      source_evidence: {
        row_text: sourceRow,
        description_text: product.name,
        quantity_text: String(shipped),
        purchase_unit_text: 'CS',
        package_text: product.package,
        unit_price_text: `$${product.price.toFixed(2)}`,
        extension_text: `$${product.total.toFixed(2)}`,
      },
    };
  });

  const sourceDocument =
    '<table>' +
    sourceHeader +
    items.map(item => item.source_evidence.row_text).join('') +
    '</table>';

  const results = validateInvoiceEvidenceClaims(
    items,
    sourceDocument
  );

  assert.equal(results.length, 5);

  results.forEach((result, index) => {
    assert.equal(
      result.chargeVerified,
      true,
      `${products[index].name}: invoice charge should verify`
    );

    assert.equal(
      result.packageVerified,
      products[index].expectedPackageVerified,
      `${products[index].name}: package verification mismatch`
    );
  });

  const verifiedMerchandise = results.reduce(
    (sum, result) =>
      sum + result.verifiedValues.line_total,
    0
  );

  assert.equal(verifiedMerchandise, 516);

  assert.equal(
    results.filter(result => result.chargeVerified).length,
    5
  );

  assert.equal(
    results.filter(result => result.packageVerified).length,
    4
  );
});

test('accepts equivalent standalone count representations', () => {
  const countRow =
    '<tr><td>3</td><td>CS</td>' +
    '<td>Romaine Hearts</td><td>12 CT</td>' +
    '<td>$24.00</td><td>$72.00</td></tr>';

  const countItem = item({
    item_name_raw: 'Romaine Hearts',
    quantity_shipped: 3,
    invoice_price: 24,
    line_total: 72,
    pack_size_raw: '12 CT',
    pack: 12,
    size: 1,
    size_unit: 'ct',
    source_evidence: {
      row_text: countRow,
      description_text: 'Romaine Hearts',
      quantity_text: '3',
      purchase_unit_text: 'CS',
      package_text: '12 CT',
      unit_price_text: '$24.00',
      extension_text: '$72.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [countItem],
    `<table>${header}${countRow}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, true);
  assert.equal(result.verifiedValues.pack, 1);
  assert.equal(result.verifiedValues.size, 12);
  assert.equal(result.verifiedValues.size_unit, 'each');
});

test('rejects incorrect standalone package quantities', () => {
  const countRow =
    '<tr><td>3</td><td>CS</td>' +
    '<td>Romaine Hearts</td><td>12 CT</td>' +
    '<td>$24.00</td><td>$72.00</td></tr>';

  const countItem = item({
    item_name_raw: 'Romaine Hearts',
    quantity_shipped: 3,
    invoice_price: 24,
    line_total: 72,
    pack_size_raw: '12 CT',
    pack: 13,
    size: 1,
    size_unit: 'ct',
    source_evidence: {
      row_text: countRow,
      description_text: 'Romaine Hearts',
      quantity_text: '3',
      purchase_unit_text: 'CS',
      package_text: '12 CT',
      unit_price_text: '$24.00',
      extension_text: '$72.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [countItem],
    `<table>${header}${countRow}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
});

test('authenticates invoice charges from Markdown tables', () => {
  const markdown = [
    '| Product | Extended | Case Pack | Unit Price | UOM | Shipped |',
    '|---|---:|---|---:|---|---:|',
    '| Roasted Turkey Breast | $156.00 | 2/5 LB | $78.00 | CS | 2 |',
  ].join('\n');

  const markdownRow =
    '| Roasted Turkey Breast | $156.00 | 2/5 LB | $78.00 | CS | 2 |';

  const markdownItem = item({
    source_evidence: {
      row_text: markdownRow,
      description_text: 'Roasted Turkey Breast',
      quantity_text: '2',
      purchase_unit_text: 'CS',
      package_text: '2/5 LB',
      unit_price_text: '$78.00',
      extension_text: '$156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [markdownItem],
    markdown
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, true);
  assert.equal(result.verifiedValues.pack, 2);
  assert.equal(result.verifiedValues.size, 5);
  assert.equal(result.verifiedValues.size_unit, 'lb');
});


test('Markdown rejects reversed financial roles', () => {
  const sourceRow =
    '| Roasted Turkey Breast | 2 | CS | 2/5 LB | 78.00 | 156.00 |';

  const markdown = [
    '| Product | Shipped | UOM | Case Pack | Unit Price | Extended |',
    '|---|---:|---|---|---:|---:|',
    sourceRow,
  ].join('\n');

  const reversed = item({
    quantity_shipped: 78,
    invoice_price: 2,
    source_evidence: {
      row_text: sourceRow,
      description_text: 'Roasted Turkey Breast',
      quantity_text: '78.00',
      purchase_unit_text: 'CS',
      package_text: '2/5 LB',
      unit_price_text: '2',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [reversed],
    markdown
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
});

test('Markdown rejects ambiguous financial headings', () => {
  const sourceRow =
    '| Roasted Turkey Breast | 2 | CS | 2/5 LB | 78.00 | 156.00 |';

  const markdown = [
    '| Product | Boxes | UOM | Case Pack | Unit Price | Extended |',
    '|---|---:|---|---|---:|---:|',
    sourceRow,
  ].join('\n');

  const extracted = item({
    source_evidence: {
      row_text: sourceRow,
      description_text: 'Roasted Turkey Breast',
      quantity_text: '2',
      purchase_unit_text: 'CS',
      package_text: '2/5 LB',
      unit_price_text: '78.00',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    markdown
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.reason, 'unverified_financial_roles');
});

test('Markdown cannot take packaging from product description', () => {
  const sourceRow =
    '| Roasted Turkey Breast 2/5 LB | 2 | CS | 12/5 LB | 78.00 | 156.00 |';

  const markdown = [
    '| Product | Shipped | UOM | Case Pack | Unit Price | Extended |',
    '|---|---:|---|---|---:|---:|',
    sourceRow,
  ].join('\n');

  const extracted = item({
    item_name_raw: 'Roasted Turkey Breast 2/5 LB',
    source_evidence: {
      row_text: sourceRow,
      description_text: 'Roasted Turkey Breast 2/5 LB',
      quantity_text: '2',
      purchase_unit_text: 'CS',
      package_text: '2/5 LB',
      unit_price_text: '78.00',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    markdown
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
});

test('Markdown rejects duplicate source-row claims', () => {
  const sourceRow =
    '| Roasted Turkey Breast | 2 | CS | 2/5 LB | 78.00 | 156.00 |';

  const markdown = [
    '| Product | Shipped | UOM | Case Pack | Unit Price | Extended |',
    '|---|---:|---|---|---:|---:|',
    sourceRow,
  ].join('\n');

  const extracted = item({
    source_evidence: {
      row_text: sourceRow,
      description_text: 'Roasted Turkey Breast',
      quantity_text: '2',
      purchase_unit_text: 'CS',
      package_text: '2/5 LB',
      unit_price_text: '78.00',
      extension_text: '156.00',
    },
  });

  const results = validateInvoiceEvidenceClaims(
    [extracted, extracted],
    markdown
  );

  assert.equal(results[0].chargeVerified, false);
  assert.equal(results[1].chargeVerified, false);
  assert.equal(results[0].reason, 'duplicate_source_claim');
});


test('authenticates explicitly labeled plain-text invoice lines', () => {
  const line =
    'Product: Roasted Turkey Breast; ' +
    'Shipped: 2; UOM: CS; Case Pack: 2/5 LB; ' +
    'Unit Price: $78.00; Extended: $156.00';

  const extracted = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    line
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, true);
  assert.equal(result.verifiedValues.pack, 2);
  assert.equal(result.verifiedValues.size, 5);
});

test('authenticates reordered labeled plain-text fields', () => {
  const line =
    'Extended: $156.00; Product: Roasted Turkey Breast; ' +
    'Case Pack: 2/5 LB; Unit Price: $78.00; ' +
    'UOM: CS; Shipped: 2';

  const extracted = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    line
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, true);
});

test('rejects reversed financial roles in labeled plain text', () => {
  const line =
    'Product: Roasted Turkey Breast; ' +
    'Shipped: 2; UOM: CS; Case Pack: 2/5 LB; ' +
    'Unit Price: 78.00; Extended: 156.00';

  const reversed = item({
    quantity_shipped: 78,
    invoice_price: 2,
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
      quantity_text: '78.00',
      unit_price_text: '2',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [reversed],
    line
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
  assert.equal(result.reason, 'unverified_financial_roles');
});


test('rejects duplicate quantity labels in plain text', () => {
  const line =
    'Product: Roasted Turkey Breast; ' +
    'Shipped: 2; Shipped: 3; UOM: CS; ' +
    'Case Pack: 2/5 LB; Unit Price: $78.00; ' +
    'Extended: $156.00';

  const extracted = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    line
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
  assert.equal(result.reason, 'unverified_financial_roles');
});

test('rejects unlabeled plain-text financial values', () => {
  const line =
    'Roasted Turkey Breast 2 CS 2/5 LB 78.00 156.00';

  const extracted = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
      unit_price_text: '78.00',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    line
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
  assert.equal(result.reason, 'unverified_financial_roles');
});

test('rejects altered prices in labeled plain text', () => {
  const line =
    'Product: Roasted Turkey Breast; ' +
    'Shipped: 2; UOM: CS; Case Pack: 2/5 LB; ' +
    'Unit Price: $78.00; Extended: $156.00';

  const altered = item({
    invoice_price: 79,
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [altered],
    line
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
  assert.equal(result.reason, 'extracted_values_disagree');
});

test('rejects package claims from the wrong labeled field', () => {
  const line =
    'Product: Roasted Turkey Breast 2/5 LB; ' +
    'Shipped: 2; UOM: CS; Case Pack: 12/5 LB; ' +
    'Unit Price: $78.00; Extended: $156.00';

  const extracted = item({
    item_name_raw: 'Roasted Turkey Breast 2/5 LB',
    source_evidence: {
      ...item().source_evidence,
      row_text: line,
      description_text: 'Roasted Turkey Breast 2/5 LB',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    line
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
});


test('authenticates catch-weight pricing from documented actual weight', () => {
  const catchWeightRow =
    '<tr><td>6</td><td>CS</td>' +
    '<td>Baby Back Ribs</td>' +
    '<td>148.00</td><td>$3.10</td>' +
    '<td>$458.80</td></tr>';

  const catchWeightHeader =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>WEIGHT LB</th>' +
    '<th>PRICE PER LB</th><th>EXTENDED</th></tr>';

  const extracted = item({
    item_name_raw: 'Baby Back Ribs',
    quantity_shipped: 6,
    actual_weight: 148,
    invoice_price: 3.10,
    line_total: 458.80,
    pack_size_raw: null,
    pack: null,
    size: null,
    size_unit: 'lb',
    catch_weight: true,
    source_evidence: {
      row_text: catchWeightRow,
      description_text: 'Baby Back Ribs',
      quantity_text: '6',
      purchase_unit_text: 'CS',
      package_text: null,
      weight_text: '148.00',
      weight_unit_text: 'LB',
      unit_price_text: '$3.10',
      extension_text: '$458.80',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${catchWeightHeader}${catchWeightRow}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
  assert.equal(result.verifiedValues.actual_weight, 148);
  assert.equal(result.verifiedValues.weight_unit, 'lb');
  assert.equal(result.verifiedValues.invoice_price, 3.10);
  assert.equal(result.verifiedValues.line_total, 458.80);
});

test('rejects catch-weight pricing when weight disagrees with source', () => {
  const catchWeightRow =
    '<tr><td>6</td><td>CS</td>' +
    '<td>Baby Back Ribs</td>' +
    '<td>148.00</td><td>$3.10</td>' +
    '<td>$458.80</td></tr>';

  const catchWeightHeader =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>WEIGHT LB</th>' +
    '<th>PRICE PER LB</th><th>EXTENDED</th></tr>';

  const extracted = item({
    item_name_raw: 'Baby Back Ribs',
    quantity_shipped: 6,
    actual_weight: 888,
    invoice_price: 3.10,
    line_total: 458.80,
    catch_weight: true,
    source_evidence: {
      row_text: catchWeightRow,
      description_text: 'Baby Back Ribs',
      quantity_text: '6',
      purchase_unit_text: 'CS',
      package_text: null,
      weight_text: '148.00',
      weight_unit_text: 'LB',
      unit_price_text: '$3.10',
      extension_text: '$458.80',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${catchWeightHeader}${catchWeightRow}</table>`
  );

  assert.equal(result.chargeVerified, false);
});

test('rejects catch-weight prices without documented weight units', () => {
  const catchWeightRow =
    '<tr><td>6</td><td>CS</td>' +
    '<td>Baby Back Ribs</td>' +
    '<td>148.00</td><td>$3.10</td>' +
    '<td>$458.80</td></tr>';

  const catchWeightHeader =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>WEIGHT</th>' +
    '<th>UNIT PRICE</th><th>EXTENDED</th></tr>';

  const extracted = item({
    item_name_raw: 'Baby Back Ribs',
    quantity_shipped: 6,
    actual_weight: 148,
    invoice_price: 3.10,
    line_total: 458.80,
    catch_weight: true,
    source_evidence: {
      row_text: catchWeightRow,
      description_text: 'Baby Back Ribs',
      quantity_text: '6',
      purchase_unit_text: 'CS',
      package_text: null,
      weight_text: '148.00',
      weight_unit_text: null,
      unit_price_text: '$3.10',
      extension_text: '$458.80',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${catchWeightHeader}${catchWeightRow}</table>`
  );

  assert.equal(result.chargeVerified, false);
});


test('rejects catch-weight pricing without a documented per-pound price basis', () => {
  const sourceRow =
    '<tr><td>6</td><td>CS</td>' +
    '<td>Baby Back Ribs</td>' +
    '<td>148.00</td><td>$3.10</td>' +
    '<td>$458.80</td></tr>';

  const sourceHeader =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>WEIGHT LB</th>' +
    '<th>UNIT PRICE</th><th>EXTENDED</th></tr>';

  const extracted = item({
    item_name_raw: 'Baby Back Ribs',
    quantity_shipped: 6,
    actual_weight: 148,
    invoice_price: 3.10,
    line_total: 458.80,
    catch_weight: true,
    source_evidence: {
      row_text: sourceRow,
      description_text: 'Baby Back Ribs',
      quantity_text: '6',
      purchase_unit_text: 'CS',
      package_text: null,
      weight_text: '148.00',
      weight_unit_text: 'LB',
      unit_price_text: '$3.10',
      extension_text: '$458.80',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${sourceHeader}${sourceRow}</table>`
  );

  assert.equal(result.chargeVerified, false);
});

test('rejects kilograms incorrectly interpreted as pounds', () => {
  const sourceRow =
    '<tr><td>2</td><td>CS</td>' +
    '<td>Fresh Salmon</td>' +
    '<td>50.00</td><td>$8.00</td>' +
    '<td>$400.00</td></tr>';

  const sourceHeader =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>WEIGHT KG</th>' +
    '<th>PRICE PER KG</th><th>EXTENDED</th></tr>';

  const extracted = item({
    item_name_raw: 'Fresh Salmon',
    quantity_shipped: 2,
    actual_weight: 50,
    invoice_price: 8,
    line_total: 400,
    catch_weight: true,
    source_evidence: {
      row_text: sourceRow,
      description_text: 'Fresh Salmon',
      quantity_text: '2',
      purchase_unit_text: 'CS',
      package_text: null,
      weight_text: '50.00',
      weight_unit_text: 'LB',
      unit_price_text: '$8.00',
      extension_text: '$400.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${sourceHeader}${sourceRow}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
});

test('rejects catch-weight claims using weight from another column', () => {
  const sourceRow =
    '<tr><td>6</td><td>CS</td>' +
    '<td>Baby Back Ribs</td>' +
    '<td>150.00</td><td>148.00</td>' +
    '<td>$3.10</td><td>$458.80</td></tr>';

  const sourceHeader =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>WEIGHT LB</th>' +
    '<th>REFERENCE</th><th>PRICE PER LB</th>' +
    '<th>EXTENDED</th></tr>';

  const extracted = item({
    item_name_raw: 'Baby Back Ribs',
    quantity_shipped: 6,
    actual_weight: 148,
    invoice_price: 3.10,
    line_total: 458.80,
    catch_weight: true,
    source_evidence: {
      row_text: sourceRow,
      description_text: 'Baby Back Ribs',
      quantity_text: '6',
      purchase_unit_text: 'CS',
      package_text: null,
      weight_text: '148.00',
      weight_unit_text: 'LB',
      unit_price_text: '$3.10',
      extension_text: '$458.80',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${sourceHeader}${sourceRow}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
});


test('authenticates Performance Foodservice OCR with td headings and repeated quantities', () => {
  const header =
    '<tr><td>Item Number</td><td>Ordered</td>' +
    '<td>Shipped</td><td>Pack</td>' +
    '<td>Size</td><td>Unit</td>' +
    '<td colspan="4">Description</td>' +
    '<td>Price</td><td>Extension</td>' +
    '<td>ST</td><td></td></tr>';

  const row =
    '<tr><td>556332</td><td>1</td><td>1</td>' +
    '<td>6</td><td>1 GA</td><td></td>' +
    '<td colspan="4">FRST MRK+BLEACH GERMICIDAL ULTRA EMERGENCY PHONE: 800-424-9300</td>' +
    '<td>21.0000</td><td>21.00</td>' +
    '<td>T</td><td></td></tr>';

  const extracted = {
    item_name_raw:
      'FRST MRK+BLEACH GERMICIDAL ULTRA EMERGENCY PHONE: 800-424-9300',
    quantity_shipped: 1,
    invoice_price: 21,
    line_total: 21,
    pack_size_raw: '6 1 GA',
    pack: 6,
    size: 1,
    size_unit: 'gal',
    catch_weight: false,
    source_evidence: {
      row_text: row,
      description_text:
        'FRST MRK+BLEACH GERMICIDAL ULTRA EMERGENCY PHONE: 800-424-9300',
      quantity_text: '1',
      purchase_unit_text: null,
      package_text: '6 1 GA',
      unit_price_text: '21.0000',
      extension_text: '21.00',
    },
  };

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.verifiedValues.invoice_price, 21);
  assert.equal(result.verifiedValues.line_total, 21);
  assert.equal(result.packageVerified, false);
});


test('td headings reject reversed shipped and price values', () => {
  const header =
    '<tr><td>Ordered</td><td>Shipped</td>' +
    '<td>Description</td><td>Price</td>' +
    '<td>Extension</td></tr>';

  const row =
    '<tr><td>1</td><td>2</td>' +
    '<td>Roasted Turkey Breast</td>' +
    '<td>78.00</td><td>156.00</td></tr>';

  const extracted = item({
    quantity_shipped: 78,
    invoice_price: 2,
    source_evidence: {
      ...item().source_evidence,
      row_text: row,
      quantity_text: '78.00',
      unit_price_text: '2',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.packageVerified, false);
});

test('td headings reject conflicting financial column labels', () => {
  const header =
    '<tr><td>Shipped</td><td>Shipped</td>' +
    '<td>Description</td><td>Price</td>' +
    '<td>Extension</td></tr>';

  const row =
    '<tr><td>2</td><td>2</td>' +
    '<td>Roasted Turkey Breast</td>' +
    '<td>78.00</td><td>156.00</td></tr>';

  const extracted = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: row,
      quantity_text: '2',
      unit_price_text: '78.00',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(
    result.reason,
    'unverified_financial_roles'
  );
});

test('td headings reject multiple competing header rows', () => {
  const header =
    '<tr><td>Shipped</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td></tr>';

  const row =
    '<tr><td>2</td>' +
    '<td>Roasted Turkey Breast</td>' +
    '<td>78.00</td><td>156.00</td></tr>';

  const extracted = item({
    source_evidence: {
      ...item().source_evidence,
      row_text: row,
      quantity_text: '2',
      unit_price_text: '78.00',
      extension_text: '156.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(
    result.reason,
    'unverified_financial_roles'
  );
});

test('td headings authenticate repeated values using column roles', () => {
  const header =
    '<tr><td>Ordered</td><td>Shipped</td>' +
    '<td>Description</td><td>Price</td>' +
    '<td>Extension</td></tr>';

  const row =
    '<tr><td>1</td><td>1</td>' +
    '<td>Roasted Turkey Breast</td>' +
    '<td>21.0000</td><td>21.00</td></tr>';

  const extracted = item({
    quantity_shipped: 1,
    invoice_price: 21,
    line_total: 21,
    source_evidence: {
      ...item().source_evidence,
      row_text: row,
      quantity_text: '1',
      unit_price_text: '21.0000',
      extension_text: '21.00',
    },
  });

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.verifiedValues.invoice_price, 21);
  assert.equal(result.verifiedValues.line_total, 21);
});


test('authenticates split Pack and Size columns when case unit is explicit', () => {
  const header =
    '<tr><td>Item Number</td>' +
    '<td>Ordered</td><td>Shipped</td>' +
    '<td>Pack</td><td>Size</td>' +
    '<td>Unit</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td></tr>';

  const row =
    '<tr><td>123456</td><td>1</td>' +
    '<td>1</td><td>6</td>' +
    '<td>5 LB</td><td>CS</td>' +
    '<td>Chicken Breast</td>' +
    '<td>90.0000</td><td>90.00</td></tr>';

  const extracted = {
    item_name_raw: 'Chicken Breast',
    quantity_shipped: 1,
    invoice_price: 90,
    line_total: 90,
    pack_size_raw: '6 5 LB',
    pack: 6,
    size: 5,
    size_unit: 'lb',
    catch_weight: false,
    source_evidence: {
      row_text: row,
      description_text: 'Chicken Breast',
      quantity_text: '1',
      purchase_unit_text: 'CS',
      package_text: '6 5 LB',
      unit_price_text: '90.0000',
      extension_text: '90.00',
    },
  };

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, true);
  assert.equal(result.verifiedValues.pack, 6);
  assert.equal(result.verifiedValues.size, 5);
  assert.equal(result.verifiedValues.size_unit, 'lb');
});


function splitPackageFixture({
  printedPack = '6',
  printedSize = '5 LB',
  printedUnit = 'CS',
  quotedPackage = '6 5 LB',
  extractedPack = 6,
  extractedSize = 5,
  extractedUnit = 'lb',
} = {}) {
  const header =
    '<tr><td>Item Number</td>' +
    '<td>Ordered</td><td>Shipped</td>' +
    '<td>Pack</td><td>Size</td>' +
    '<td>Unit</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td></tr>';

  const row =
    '<tr><td>123456</td><td>1</td>' +
    `<td>1</td><td>${printedPack}</td>` +
    `<td>${printedSize}</td><td>${printedUnit}</td>` +
    '<td>Chicken Breast</td>' +
    '<td>90.0000</td><td>90.00</td></tr>';

  return {
    ocrText: `<table>${header}${row}</table>`,
    item: {
      item_name_raw: 'Chicken Breast',
      quantity_shipped: 1,
      invoice_price: 90,
      line_total: 90,
      pack_size_raw: quotedPackage,
      pack: extractedPack,
      size: extractedSize,
      size_unit: extractedUnit,
      catch_weight: false,
      source_evidence: {
        row_text: row,
        description_text: 'Chicken Breast',
        quantity_text: '1',
        purchase_unit_text: printedUnit,
        package_text: quotedPackage,
        unit_price_text: '90.0000',
        extension_text: '90.00',
      },
    },
  };
}

const splitPackageRejections = [
  {
    name: 'does not verify a split package without a case purchase unit',
    changes: {
      printedUnit: '',
    },
  },
  {
    name: 'rejects a split package when printed Pack and Size are swapped',
    changes: {
      printedPack: '5',
      printedSize: '6 LB',
    },
  },
  {
    name: 'rejects a split package when extracted quantities disagree',
    changes: {
      extractedPack: 12,
    },
  },
  {
    name: 'rejects unsupported split package units',
    changes: {
      printedSize: '5 UNKNOWN',
      quotedPackage: '6 5 UNKNOWN',
      extractedUnit: 'unknown',
    },
  },
];

for (const scenario of splitPackageRejections) {
  test(scenario.name, () => {
    const fixture = splitPackageFixture(
      scenario.changes
    );

    const [result] = validateInvoiceEvidenceClaims(
      [fixture.item],
      fixture.ocrText
    );

    // Correct financial information must remain
    // independently authenticated.
    assert.equal(result.chargeVerified, true);

    // Unsupported packaging must never gain
    // verified physical quantities.
    assert.equal(result.packageVerified, false);

    assert.equal(
      result.verifiedValues?.pack,
      undefined
    );
  });
}


test('authenticates a product description followed by supplier safety information', () => {
  const header =
    '<tr><td>Item Number</td><td>Ordered</td>' +
    '<td>Shipped</td><td>Pack</td>' +
    '<td>Size</td><td>Unit</td>' +
    '<td>Description</td><td>Price</td>' +
    '<td>Extension</td><td>ST</td><td></td></tr>';

  const row =
    '<tr><td>556332</td><td>1</td>' +
    '<td>1</td><td>6</td>' +
    '<td>1 GA</td><td></td>' +
    '<td>FRST MRK+BLEACH GERMICIDAL ULTRA' +
    '<br/>EMERGENCY PHONE: 800-424-9300</td>' +
    '<td>21.0000</td><td>21.00</td>' +
    '<td>T</td><td></td></tr>';

  const item = {
    item_name_raw: 'FRST MRK+BLEACH GERMICIDAL ULTRA',
    quantity_shipped: 1,
    invoice_price: 21,
    line_total: 21,
    pack_size_raw: '6 1 GA',
    pack: 6,
    size: 1,
    size_unit: 'gal',
    catch_weight: false,
    source_evidence: {
      row_text: row,
      description_text: 'FRST MRK+BLEACH GERMICIDAL ULTRA',
      quantity_text: '1',
      purchase_unit_text: null,
      package_text: '6 1 GA',
      unit_price_text: '21.0000',
      extension_text: '21.00',
    },
  };

  const [result] = validateInvoiceEvidenceClaims(
    [item],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.verifiedValues.invoice_price, 21);
  assert.equal(result.verifiedValues.line_total, 21);

  // The missing purchase unit must still prevent
  // unsupported package verification.
  assert.equal(result.packageVerified, false);
});


function descriptionSecurityFixture({
  printedDescription = 'FRST MRK+BLEACH GERMICIDAL ULTRA EMERGENCY PHONE: 800-424-9300',
  claimedDescription = 'FRST MRK+BLEACH GERMICIDAL ULTRA',
  otherCell = '',
} = {}) {
  const header =
    '<tr><td>Shipped</td><td>Description</td>' +
    '<td>Reference</td><td>Price</td>' +
    '<td>Extension</td></tr>';

  const row =
    `<tr><td>1</td><td>${printedDescription}</td>` +
    `<td>${otherCell}</td>` +
    '<td>21.0000</td><td>21.00</td></tr>';

  const item = {
    item_name_raw: claimedDescription,
    quantity_shipped: 1,
    invoice_price: 21,
    line_total: 21,
    catch_weight: false,
    source_evidence: {
      row_text: row,
      description_text: claimedDescription,
      quantity_text: '1',
      unit_price_text: '21.0000',
      extension_text: '21.00',
    },
  };

  return {
    item,
    ocrText: `<table>${header}${row}</table>`,
  };
}

test('rejects a product description appearing only in another column', () => {
  const fixture = descriptionSecurityFixture({
    printedDescription: 'OVEN CLEANER',
    otherCell: 'FRST MRK+BLEACH GERMICIDAL ULTRA',
  });

  const [result] = validateInvoiceEvidenceClaims(
    [fixture.item],
    fixture.ocrText
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.reason, 'source_field_not_found');
});

test('rejects a product description appearing in the middle of another description', () => {
  const fixture = descriptionSecurityFixture({
    printedDescription:
      'OTHER PRODUCT FRST MRK+BLEACH GERMICIDAL ULTRA',
  });

  const [result] = validateInvoiceEvidenceClaims(
    [fixture.item],
    fixture.ocrText
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.reason, 'source_field_not_found');
});

test('rejects a partial product name that ends inside a word', () => {
  const fixture = descriptionSecurityFixture({
    printedDescription:
      'CHICKEN BREAST MEDIUM GRADE',
    claimedDescription:
      'CHICKEN BRE',
  });

  const [result] = validateInvoiceEvidenceClaims(
    [fixture.item],
    fixture.ocrText
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.reason, 'source_field_not_found');
});


test('authenticates catch-weight pricing with weight in Description and LB purchase unit', () => {
  const header =
    '<tr><td>Item Number</td>' +
    '<td>Ordered</td><td>Shipped</td>' +
    '<td>Pack</td><td>Size</td>' +
    '<td>Unit</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td>' +
    '<td>ST</td><td></td></tr>';

  const row =
    '<tr><td>1030906</td><td>1</td>' +
    '<td>1</td><td>22</td>' +
    '<td>7 OZ</td><td>LB</td>' +
    '<td>RANRNCH BEEF SKIRT STK OUTSIDE NR 9.96</td>' +
    '<td>14.5000</td><td>144.42</td>' +
    '<td></td><td></td></tr>';

  const extracted = {
    item_name_raw:
      'RANRNCH BEEF SKIRT STK OUTSIDE NR 9.96',
    quantity_shipped: 1,
    quantity_unit: 'LB',
    invoice_price: 14.5,
    line_total: 144.42,
    pack_size_raw: '22 7 OZ',
    pack: 22,
    size: 7,
    size_unit: 'oz',
    catch_weight: true,
    actual_weight: 9.96,
    source_evidence: {
      row_text: row,
      description_text:
        'RANRNCH BEEF SKIRT STK OUTSIDE NR 9.96',
      quantity_text: '1',
      purchase_unit_text: 'LB',
      package_text: '22 7 OZ',
      weight_text: '9.96',
      weight_unit_text: 'LB',
      unit_price_text: '14.5000',
      extension_text: '144.42',
    },
  };

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);

  assert.equal(
    result.verifiedValues.actual_weight,
    9.96
  );

  assert.equal(
    result.verifiedValues.weight_unit,
    'lb'
  );

  assert.equal(
    result.verifiedValues.invoice_price,
    14.5
  );

  assert.equal(
    result.verifiedValues.line_total,
    144.42
  );
});


function embeddedCatchWeightFixture({
  printedDescription = 'BEEF SKIRT STEAK 9.96',
  claimedWeight = '9.96',
  actualWeight = 9.96,
  printedUnit = 'LB',
  quantityUnit = 'LB',
  printedPrice = '14.5000',
  printedExtension = '144.42',
  extractedPrice = 14.5,
  extractedExtension = 144.42,
} = {}) {
  const header =
    '<tr><td>Item Number</td>' +
    '<td>Ordered</td><td>Shipped</td>' +
    '<td>Pack</td><td>Size</td>' +
    '<td>Unit</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td></tr>';

  const row =
    '<tr><td>1030906</td><td>1</td>' +
    '<td>1</td><td>22</td>' +
    '<td>7 OZ</td>' +
    `<td>${printedUnit}</td>` +
    `<td>${printedDescription}</td>` +
    `<td>${printedPrice}</td>` +
    `<td>${printedExtension}</td></tr>`;

  return {
    ocrText: `<table>${header}${row}</table>`,
    item: {
      item_name_raw: printedDescription,
      quantity_shipped: 1,
      quantity_unit: quantityUnit,
      invoice_price: extractedPrice,
      line_total: extractedExtension,
      pack_size_raw: '22 7 OZ',
      pack: 22,
      size: 7,
      size_unit: 'oz',
      catch_weight: true,
      actual_weight: actualWeight,
      source_evidence: {
        row_text: row,
        description_text: printedDescription,
        quantity_text: '1',
        purchase_unit_text: printedUnit,
        package_text: '22 7 OZ',
        weight_text: claimedWeight,
        weight_unit_text: 'LB',
        unit_price_text: printedPrice,
        extension_text: printedExtension,
      },
    },
  };
}

const embeddedCatchWeightRejections = [
  {
    name: 'rejects a weight appearing only in the middle of the description',
    changes: {
      printedDescription: 'BEEF SKIRT 9.96 STEAK',
    },
  },
  {
    name: 'rejects an embedded weight that differs from the printed value',
    changes: {
      claimedWeight: '8.96',
    },
  },
  {
    name: 'rejects an extracted weight inconsistent with the printed weight',
    changes: {
      actualWeight: 8.96,
    },
  },
  {
    name: 'rejects an embedded weight without an LB purchase unit',
    changes: {
      printedUnit: '',
    },
  },
  {
    name: 'rejects an extracted purchase unit that disagrees with LB',
    changes: {
      quantityUnit: 'CS',
    },
  },
  {
    name: 'rejects incorrect catch-weight arithmetic',
    changes: {
      printedExtension: '140.00',
      extractedExtension: 140,
    },
  },
];

for (const scenario of embeddedCatchWeightRejections) {
  test(scenario.name, () => {
    const fixture = embeddedCatchWeightFixture(
      scenario.changes
    );

    const [result] = validateInvoiceEvidenceClaims(
      [fixture.item],
      fixture.ocrText
    );

    assert.equal(
      result.chargeVerified,
      false,
      scenario.name
    );

    assert.equal(result.packageVerified, false);
    assert.equal(result.verifiedValues, null);
  });
}


test('authenticates product identity when supplier emergency phone follows the name', () => {
  const header =
    '<tr><td>Shipped</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td></tr>';

  const row =
    '<tr><td>1</td>' +
    '<td>FRST MRK+BLEACH GERMICIDAL ULTRA ' +
    'EMERGENCY PHONE: 800-424-9300</td>' +
    '<td>21.0000</td><td>21.00</td></tr>';

  const extracted = {
    item_name_raw: 'FRST MRK+BLEACH GERMICIDAL ULTRA',
    quantity_shipped: 1,
    invoice_price: 21,
    line_total: 21,
    catch_weight: false,
    source_evidence: {
      row_text: row,
      description_text:
        'FRST MRK+BLEACH GERMICIDAL ULTRA ' +
        'EMERGENCY PHONE: 800-424-9300',
      quantity_text: '1',
      unit_price_text: '21.0000',
      extension_text: '21.00',
    },
  };

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.verifiedValues.invoice_price, 21);
  assert.equal(result.verifiedValues.line_total, 21);
});

test('rejects an incomplete product name without recognized supplier metadata', () => {
  const header =
    '<tr><td>Shipped</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td></tr>';

  const row =
    '<tr><td>1</td>' +
    '<td>CHICKEN BREAST BONELESS SKINLESS</td>' +
    '<td>21.0000</td><td>21.00</td></tr>';

  const extracted = {
    item_name_raw: 'CHICKEN BREAST',
    quantity_shipped: 1,
    invoice_price: 21,
    line_total: 21,
    catch_weight: false,
    source_evidence: {
      row_text: row,
      description_text:
        'CHICKEN BREAST BONELESS SKINLESS',
      quantity_text: '1',
      unit_price_text: '21.0000',
      extension_text: '21.00',
    },
  };

  const [result] = validateInvoiceEvidenceClaims(
    [extracted],
    `<table>${header}${row}</table>`
  );

  assert.equal(result.chargeVerified, false);
  assert.equal(result.reason, 'product_identity_mismatch');
});


test('authenticates catch weight with compact supplier financial headings', () => {
  const header =
    '<tr><th>SKU</th><th>DESCRIPTION</th>' +
    '<th>SHIPPED</th><th>WEIGHT LB</th>' +
    '<th>PRICE / LB</th><th>TOTAL</th></tr>';

  const row =
    '<tr><td>CB-102</td>' +
    '<td>CHICKEN BREAST FRESH</td>' +
    '<td>1 CS</td><td>18.40</td>' +
    '<td>4.30</td><td>79.12</td></tr>';

  const makeItem = (overrides = {}) => ({
    item_name_raw: 'CHICKEN BREAST FRESH',
    quantity_shipped: 1,
    quantity_unit: 'lb',
    invoice_price: 4.30,
    line_total: 79.12,
    catch_weight: true,
    actual_weight: 18.40,
    source_evidence: {
      row_text: row,
      description_text: 'CHICKEN BREAST FRESH',
      quantity_text: '1 CS',
      purchase_unit_text: 'CS',
      weight_text: '18.40',
      weight_unit_text: 'LB',
      unit_price_text: '4.30',
      extension_text: '79.12',
    },
    ...overrides,
  });

  const document = `<table>${header}${row}</table>`;

  const [result] = validateInvoiceEvidenceClaims(
    [makeItem()],
    document
  );

  assert.equal(result.chargeVerified, true);
  assert.equal(result.packageVerified, false);
  assert.equal(result.verifiedValues.quantity_shipped, 1);
  assert.equal(result.verifiedValues.actual_weight, 18.4);
  assert.equal(result.verifiedValues.weight_unit, 'lb');
  assert.equal(result.verifiedValues.invoice_price, 4.3);
  assert.equal(result.verifiedValues.line_total, 79.12);

  // The extractor may separate "1" from "CS".
  const separated = makeItem({
    source_evidence: {
      ...makeItem().source_evidence,
      quantity_text: '1',
    },
  });

  const [separatedResult] =
    validateInvoiceEvidenceClaims(
      [separated],
      document
    );

  assert.equal(separatedResult.chargeVerified, true);

  // Incorrect weight cannot be authenticated.
  const [badWeight] = validateInvoiceEvidenceClaims(
    [makeItem({ actual_weight: 20 })],
    document
  );

  assert.equal(badWeight.chargeVerified, false);

  // Incorrect total cannot be authenticated.
  const [badTotal] = validateInvoiceEvidenceClaims(
    [makeItem({ line_total: 90 })],
    document
  );

  assert.equal(badTotal.chargeVerified, false);

  // The shipped quantity must still match.
  const [badCount] = validateInvoiceEvidenceClaims(
    [makeItem({ quantity_shipped: 2 })],
    document
  );

  assert.equal(badCount.chargeVerified, false);

  // No unsupported case-count interpretation.
  const unsupportedUnit = makeItem({
    source_evidence: {
      ...makeItem().source_evidence,
      purchase_unit_text: 'EA',
    },
  });

  const [badUnit] = validateInvoiceEvidenceClaims(
    [unsupportedUnit],
    document
  );

  assert.equal(badUnit.chargeVerified, false);

  // Ambiguous financial column headings remain unsafe.
  const ambiguous = document.replace(
    '<th>SHIPPED</th>',
    '<th>ITEMS</th>'
  );

  const [badHeading] = validateInvoiceEvidenceClaims(
    [makeItem()],
    ambiguous
  );

  assert.equal(badHeading.chargeVerified, false);
});


test(
  'authenticates catch weight with units in source cells',
  () => {
    const sourceHeader =
      '<tr><th>ITEM / DESCRIPTION</th>' +
      '<th>SHP</th><th>UOM</th>' +
      '<th>WEIGHT</th><th>UNIT COST</th>' +
      '<th>EXTENDED</th></tr>';

    const sourceRow =
      '<tr><td>Chicken Breast Fresh</td>' +
      '<td>1</td><td>CS</td>' +
      '<td>18.40 LB</td>' +
      '<td>$4.50 / LB</td>' +
      '<td>$82.80</td></tr>';

    const extracted = {
      item_name_raw: 'Chicken Breast Fresh',
      quantity_shipped: 1,
      quantity_unit: 'CS',
      actual_weight: 18.4,
      invoice_price: 4.5,
      line_total: 82.8,
      catch_weight: true,
      pack_size_raw: null,
      pack: null,
      size: null,
      size_unit: 'lb',
      source_evidence: {
        row_text: sourceRow,
        description_text: 'Chicken Breast Fresh',
        quantity_text: '1',
        purchase_unit_text: 'CS',
        package_text: null,
        weight_text: '18.40 LB',
        weight_unit_text: 'LB',
        unit_price_text: '$4.50 / LB',
        extension_text: '$82.80',
      },
    };

    const [result] = validateInvoiceEvidenceClaims(
      [extracted],
      `<table>${sourceHeader}${sourceRow}</table>`
    );

    assert.equal(result.chargeVerified, true);
    assert.equal(result.packageVerified, false);
    assert.equal(result.verifiedValues.actual_weight, 18.4);
    assert.equal(result.verifiedValues.invoice_price, 4.5);
    assert.equal(result.verifiedValues.line_total, 82.8);
    assert.equal(result.verifiedValues.weight_unit, 'lb');
  }
);

test(
  'rejects kilograms presented as pounds',
  () => {
    const sourceHeader =
      '<tr><th>ITEM / DESCRIPTION</th>' +
      '<th>SHP</th><th>UOM</th>' +
      '<th>WEIGHT</th><th>UNIT COST</th>' +
      '<th>EXTENDED</th></tr>';

    const sourceRow =
      '<tr><td>Chicken Breast Fresh</td>' +
      '<td>1</td><td>CS</td>' +
      '<td>18.40 KG</td>' +
      '<td>$4.50 / KG</td>' +
      '<td>$82.80</td></tr>';

    const extracted = {
      item_name_raw: 'Chicken Breast Fresh',
      quantity_shipped: 1,
      quantity_unit: 'CS',
      actual_weight: 18.4,
      invoice_price: 4.5,
      line_total: 82.8,
      catch_weight: true,
      source_evidence: {
        row_text: sourceRow,
        description_text: 'Chicken Breast Fresh',
        quantity_text: '1',
        purchase_unit_text: 'CS',
        package_text: null,
        weight_text: '18.40 KG',
        weight_unit_text: 'LB',
        unit_price_text: '$4.50 / KG',
        extension_text: '$82.80',
      },
    };

    const [result] = validateInvoiceEvidenceClaims(
      [extracted],
      `<table>${sourceHeader}${sourceRow}</table>`
    );

    assert.equal(result.chargeVerified, false);
    assert.equal(result.packageVerified, false);
  }
);
