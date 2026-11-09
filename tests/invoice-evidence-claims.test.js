
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
