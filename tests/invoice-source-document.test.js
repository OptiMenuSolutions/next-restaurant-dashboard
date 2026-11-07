import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  getInvoiceDocumentFingerprint,
} from '../lib/invoiceSourceDocument.js';

const RESTAURANT_ID = 'restaurant-1';
const FILE_PATH = 'restaurant-1/invoice.pdf';

const DOCUMENT = Buffer.from(
  'Synthetic invoice CTB-2111: Dijon mustard $30'
);

function mockDatabase({
  bytes = DOCUMENT,
  error = null,
} = {}) {
  return {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'invoices');

        return {
          async download(path) {
            assert.equal(path, FILE_PATH);

            if (error) {
              return {
                data: null,
                error,
              };
            }

            return {
              data: {
                async arrayBuffer() {
                  return bytes;
                },
              },
              error: null,
            };
          },
        };
      },
    },
  };
}

function verify(overrides = {}) {
  return getInvoiceDocumentFingerprint({
    db: mockDatabase(),
    restaurantId: RESTAURANT_ID,
    filePaths: [FILE_PATH],
    ...overrides,
  });
}

test('original invoice bytes produce correct SHA-256 fingerprint', async () => {
  const result = await verify();

  const expected = createHash('sha256')
    .update(DOCUMENT)
    .digest('hex');

  assert.equal(result.verified, true);
  assert.equal(result.fingerprint, expected);
});

test('different document bytes produce different fingerprints', async () => {
  const original = await verify();

  const modified = await verify({
    db: mockDatabase({
      bytes: Buffer.from(
        'Synthetic invoice CTB-2111: Dijon mustard $60'
      ),
    }),
  });

  assert.equal(modified.verified, true);

  assert.notEqual(
    modified.fingerprint,
    original.fingerprint
  );
});

test('another restaurant cannot access the file', async () => {
  const result = await verify({
    restaurantId: 'restaurant-2',
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'invalid_document_path');
});

test('directory traversal paths are rejected', async () => {
  const result = await verify({
    filePaths: [
      'restaurant-1/../restaurant-2/invoice.pdf',
    ],
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'invalid_document_path');
});

test('missing document path is rejected', async () => {
  const result = await verify({
    filePaths: [],
  });

  assert.equal(result.verified, false);
  assert.equal(
    result.reason,
    'unsupported_document_count'
  );
});

test('multiple invoice documents are not authenticated together', async () => {
  const result = await verify({
    filePaths: [
      FILE_PATH,
      'restaurant-1/second-page.pdf',
    ],
  });

  assert.equal(result.verified, false);
  assert.equal(
    result.reason,
    'unsupported_document_count'
  );
});

test('storage download failures reject verification', async () => {
  const result = await verify({
    db: mockDatabase({
      error: {
        message: 'Storage unavailable',
      },
    }),
  });

  assert.equal(result.verified, false);
  assert.equal(
    result.reason,
    'document_download_failed'
  );
});

test('empty invoice documents are rejected', async () => {
  const result = await verify({
    db: mockDatabase({
      bytes: Buffer.alloc(0),
    }),
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'empty_document');
});

test('missing database context is rejected', async () => {
  const result = await verify({
    db: null,
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'invalid_context');
});