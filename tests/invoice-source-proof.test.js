import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInvoiceSourceProof,
  createInvoiceEvidenceProofV2,
  verifyInvoiceSourceProof,
} from '../lib/invoiceSourceProof.js';

import { createHmac } from 'node:crypto';

const SECRET =
  'opt imenu testing secret for signed invoice evidence 2026';

const DOCUMENT_FINGERPRINT = 'a'.repeat(64);

const NOW = Date.parse('2026-11-07T12:00:00Z');

function item(overrides = {}) {
  return {
    item_name_raw: 'MUSTARD DIJON SMOOTH',
    quantity_shipped: 1,
    pack_size_raw: '4 1 QT',
    pack: 4,
    size: 1,
    size_unit: 'qt',
    invoice_price: 30,
    line_total: 30,
    catch_weight: false,
    source_validation_status: 'source_table_consistent',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    restaurantId: 'cedar-test-bistro',
    invoiceNumber: 'CTB-2111',
    itemKey: 'item_0',
    item: item(),
    issuedAt: NOW,
    secret: SECRET,
    documentFingerprint: DOCUMENT_FINGERPRINT,
    ...overrides,
  };
}

function signedProof(overrides = {}) {
  return createInvoiceSourceProof(
    context(overrides)
  );
}

function verify(proof, overrides = {}) {
  return verifyInvoiceSourceProof({
    proof,
    restaurantId: 'cedar-test-bistro',
    invoiceNumber: 'CTB-2111',
    itemKey: 'item_0',
    item: item(),
    now: NOW,
    secret: SECRET,
    documentFingerprint: DOCUMENT_FINGERPRINT,
    ...overrides,
  });
}

test('valid source proof authenticates original pricing', () => {
  const proof = signedProof();
  const result = verify(proof);

  assert.equal(result.valid, true);
  assert.equal(result.payload.pricing.invoice_price, 30);
});

test('modified quantity is rejected', () => {
  const result = verify(signedProof(), {
    item: item({ quantity_shipped: 2 }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('modified unit cost source is rejected', () => {
  const result = verify(signedProof(), {
    item: item({ invoice_price: 20 }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('modified line total is rejected', () => {
  const result = verify(signedProof(), {
    item: item({ line_total: 60 }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('modified package structure is rejected', () => {
  const result = verify(signedProof(), {
    item: item({ pack: 8 }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('modified physical unit is rejected', () => {
  const result = verify(signedProof(), {
    item: item({ size_unit: 'lb' }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('another restaurant cannot reuse the proof', () => {
  const result = verify(signedProof(), {
    restaurantId: 'another-restaurant',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('another invoice cannot reuse the proof', () => {
  const result = verify(signedProof(), {
    invoiceNumber: 'CTB-9999',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('another item cannot reuse the proof', () => {
  const result = verify(signedProof(), {
    itemKey: 'item_1',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('expired proof is rejected', () => {
  const result = verify(signedProof(), {
    now: NOW + 3 * 60 * 60 * 1000,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired_proof');
});

test('future-issued proof is rejected', () => {
  const result = verify(signedProof(), {
    now: NOW - 1000,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired_proof');
});

test('tampered signature is rejected', () => {
  const proof = signedProof();
  const [payload] = proof.split('.');

  const result = verify(
    `${payload}.invalidsignature`
  );

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_signature');
});

test('fabricated validation status cannot create a proof', () => {
  assert.throws(() => {
    signedProof({
      item: item({
        source_validation_status: 'unknown',
      }),
    });
  });
});

test('unsigned ordinary AI extraction cannot create a proof', () => {
  assert.throws(() => {
    signedProof({
      item: item({
        source_validation_status: undefined,
      }),
    });
  });
});

test('missing signing secret is rejected', () => {
  assert.throws(() => {
    signedProof({
      secret: '',
    });
  });
});

test('wrong signing secret fails verification', () => {
  const result = verify(signedProof(), {
    secret: 'a different cryptographic verification secret 2026',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_signature');
});

test('changing catch-weight status invalidates the proof', () => {
  const result = verify(signedProof(), {
    item: item({
      catch_weight: true,
    }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('a different uploaded document cannot reuse the proof', () => {
  const result = verify(signedProof(), {
    documentFingerprint: 'b'.repeat(64),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('missing document fingerprint cannot create a proof', () => {
  assert.throws(() => {
    signedProof({
      documentFingerprint: null,
    });
  });
});


test('version 1 refuses to sign catch-weight pricing', () => {
  const catchWeightItem = item({
    item_name_raw: 'Baby Back Ribs',
    quantity_shipped: 6,
    invoice_price: 3.10,
    line_total: 458.80,
    catch_weight: true,
    actual_weight: 148,
  });

  assert.throws(
    () => signedProof({
      item: catchWeightItem,
    }),
    /Version 1 source proofs do not support catch-weight pricing/
  );
});


test('previously signed version 1 catch-weight proofs are rejected', () => {
  const catchWeightItem = item({
    item_name_raw: 'Baby Back Ribs',
    quantity_shipped: 6,
    invoice_price: 3.10,
    line_total: 458.80,
    catch_weight: true,
    actual_weight: 148,
  });

  // Reconstruct the original version 1 payload to
  // simulate a proof issued before the restriction.
  const payload = {
    version: 1,
    restaurant_id: 'cedar-test-bistro',
    invoice_number: 'CTB-2111',
    document_fingerprint: DOCUMENT_FINGERPRINT,
    item_key: 'item_0',
    issued_at: NOW,
    source_type: 'structured_ocr_table',
    validation_status: 'source_table_consistent',
    pricing: {
      item_name_raw: catchWeightItem.item_name_raw,
      quantity_shipped: catchWeightItem.quantity_shipped,
      pack_size_raw: catchWeightItem.pack_size_raw,
      pack: catchWeightItem.pack,
      size: catchWeightItem.size,
      size_unit: catchWeightItem.size_unit,
      invoice_price: catchWeightItem.invoice_price,
      line_total: catchWeightItem.line_total,
      catch_weight: true,
    },
  };

  const encoded = Buffer.from(
    JSON.stringify(payload),
    'utf8'
  ).toString('base64url');

  const signature = createHmac('sha256', SECRET)
    .update(encoded)
    .digest('base64url');

  const legacyProof = `${encoded}.${signature}`;

  const result = verify(legacyProof, {
    item: catchWeightItem,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'unsupported_catch_weight');
});

function catchWeightFixture(overrides = {}) {
  const row =
    '<tr><td>6</td><td>CS</td>' +
    '<td>Baby Back Ribs</td>' +
    '<td>148.00</td><td>$3.10</td>' +
    '<td>$458.80</td></tr>';

  const header =
    '<tr><th>SHIP</th><th>UOM</th>' +
    '<th>DESCRIPTION</th><th>WEIGHT LB</th>' +
    '<th>PRICE PER LB</th><th>EXTENDED</th></tr>';

  return {
    ocrText: `<table>${header}${row}</table>`,
    invoiceItem: {
      _id: 'item_0',
      item_name_raw: 'Baby Back Ribs',
      quantity_shipped: 6,
      actual_weight: 148,
      invoice_price: 3.10,
      line_total: 458.80,
      catch_weight: true,
      pack_size_raw: null,
      pack: null,
      size: null,
      size_unit: 'lb',
      source_evidence: {
        row_text: row,
        description_text: 'Baby Back Ribs',
        quantity_text: '6',
        purchase_unit_text: 'CS',
        package_text: null,
        weight_text: '148.00',
        weight_unit_text: 'LB',
        unit_price_text: '$3.10',
        extension_text: '$458.80',
      },
      ...overrides,
    },
  };
}

function createV2(fixture) {
  return createInvoiceEvidenceProofV2({
    restaurantId: 'cedar-test-bistro',
    invoiceNumber: 'CTB-2111',
    documentFingerprint: DOCUMENT_FINGERPRINT,
    itemKey: 'item_0',
    item: fixture.invoiceItem,
    ocrText: fixture.ocrText,
    issuedAt: NOW,
    secret: SECRET,
  });
}

test('version 2 authenticates source-backed catch-weight pricing', () => {
  const fixture = catchWeightFixture();

  const proof = createV2(fixture);

  const result = verify(proof, {
    item: fixture.invoiceItem,
  });

  assert.equal(result.valid, true);
  assert.equal(result.payload.version, 2);
  assert.equal(result.payload.pricing.actual_weight, 148);
  assert.equal(result.payload.pricing.weight_unit, 'lb');
  assert.equal(result.payload.pricing.price_basis, 'per_lb');
  assert.equal(result.payload.pricing.line_total, 458.80);
});

test('version 2 rejects modified actual weight after signing', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: {
      ...fixture.invoiceItem,
      actual_weight: 888,
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('version 2 refuses to sign fabricated OCR pricing', () => {
  const fixture = catchWeightFixture({
    actual_weight: 888,
    source_validation_status: 'source_table_consistent',
    chargeVerified: true,
    packageVerified: true,
  });

  assert.throws(() => createV2(fixture));
});


test('version 2 prevents cross-restaurant proof reuse', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: fixture.invoiceItem,
    restaurantId: 'another-restaurant',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('version 2 prevents cross-invoice proof reuse', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: fixture.invoiceItem,
    invoiceNumber: 'DIFFERENT-9999',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('version 2 prevents document substitution', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: fixture.invoiceItem,
    documentFingerprint: 'b'.repeat(64),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('version 2 prevents proof reuse for another item', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: fixture.invoiceItem,
    itemKey: 'item_1',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('version 2 rejects expired evidence proofs', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: fixture.invoiceItem,
    now: NOW + 3 * 60 * 60 * 1000,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired_proof');
});


test('version 2 rejects modified invoice prices after signing', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: {
      ...fixture.invoiceItem,
      invoice_price: 4.10,
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('version 2 rejects modified line totals after signing', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const result = verify(proof, {
    item: {
      ...fixture.invoiceItem,
      line_total: 999.00,
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('version 2 refuses pricing that disagrees with original OCR', () => {
  const fixture = catchWeightFixture({
    invoice_price: 4.10,
    line_total: 606.80,
  });

  assert.throws(
    () => createV2(fixture),
    /could not be authenticated/
  );
});

test('version 2 refuses source rows missing from original OCR', () => {
  const fixture = catchWeightFixture();

  fixture.invoiceItem.source_evidence = {
    ...fixture.invoiceItem.source_evidence,
    row_text: fixture.invoiceItem.source_evidence.row_text
      .replace('Baby Back Ribs', 'Invented Product'),
  };

  assert.throws(
    () => createV2(fixture),
    /could not be authenticated/
  );
});

test('version 2 rejects tampered cryptographic signatures', () => {
  const fixture = catchWeightFixture();
  const proof = createV2(fixture);

  const [payload] = proof.split('.');
  const tamperedProof = `${payload}.invalidsignature`;

  const result = verify(tamperedProof, {
    item: fixture.invoiceItem,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_signature');
});


test('version 2 refuses to sign a mismatched invoice item identity', () => {
  const fixture = catchWeightFixture({
    _id: 'item_1',
  });

  // The source item identifies itself as item_1,
  // but the signing request claims item_0.
  assert.throws(
    () => createV2(fixture),
    /Invoice item identity mismatch/
  );
});
