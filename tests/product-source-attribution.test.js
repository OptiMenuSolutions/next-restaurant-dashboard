
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSourceUrlMetadata,
  extractFetchedSourceDocument,
} from '../lib/productSourceDocument.js';

test('extracts hostname without assigning authority', () => {
  const result = extractSourceUrlMetadata(
    'https://www.example.com/products/item'
  );

  assert.equal(result.hostname, 'www.example.com');
  assert.equal(result.protocol, 'https:');
});

test('rejects non-HTTPS source URL', () => {
  assert.equal(
    extractSourceUrlMetadata('http://example.com/product'),
    null
  );
});

test('rejects local hostname', () => {
  assert.equal(
    extractSourceUrlMetadata('https://localhost/product'),
    null
  );
});

test('retrieved document has unverified attribution', () => {
  const url = 'https://www.example.com/products/item';

  const response = {
    content: [{
      type: 'web_fetch_tool_result',
      content: {
        type: 'web_fetch_result',
        url,
        retrieved_at: '2026-11-03T15:51:45+00:00',
        content: {
          type: 'document',
          source: {
            type: 'text',
            media_type: 'text/plain',
            data: 'Pack Size: 6/120 oz',
          },
        },
      },
    }],
  };

  const document = extractFetchedSourceDocument(
    response,
    url
  );

  assert.equal(document.hostname, 'www.example.com');
  assert.equal(document.attribution.publisher, null);
  assert.equal(
    document.attribution.publisherType,
    'unknown'
  );
  assert.equal(
    document.attribution.verificationStatus,
    'unverified'
  );
});

test('does not infer distributor status from hostname', () => {
  const result = extractSourceUrlMetadata(
    'https://distributor.example.com/item'
  );

  assert.equal(result.hostname, 'distributor.example.com');
  assert.equal('publisherType' in result, false);
});
