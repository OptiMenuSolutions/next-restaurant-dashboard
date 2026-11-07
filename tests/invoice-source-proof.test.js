import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInvoiceSourceProof,
  verifyInvoiceSourceProof,
} from '../lib/invoiceSourceProof.js';

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