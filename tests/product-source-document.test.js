
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractFetchedSourceDocument,
} from '../lib/productSourceDocument.js';

const url = 'https://example.com/product';

const response = {
  content: [
    {
      type: 'web_fetch_tool_result',
      content: {
        type: 'web_fetch_result',
        url,
        retrieved_at: '2026-11-03T15:51:45+00:00',
        content: {
          type: 'document',
          title: 'Product Specification',
          source: {
            type: 'text',
            media_type: 'text/plain',
            data: [
              'Product Code ABC123',
              'Pack Size 6/120 oz',
              'Net Weight 120 oz per container',
            ].join('\n'),
          },
        },
      },
    },
  ],
};

test('extracts original fetched document text', () => {
  const result = extractFetchedSourceDocument(
    response,
    url
  );

  assert.equal(result.origin, 'anthropic_web_fetch');
  assert.equal(result.url, url);
  assert.match(result.text, /ABC123/);
  assert.match(result.text, /120 oz/);
});

test('rejects a different source URL', () => {
  const result = extractFetchedSourceDocument(
    response,
    'https://example.com/other'
  );

  assert.equal(result, null);
});

test('rejects missing source data', () => {
  const modified = structuredClone(response);

  modified.content[0].content.content.source.data = '';

  assert.equal(
    extractFetchedSourceDocument(modified, url),
    null
  );
});

test('rejects unsupported document formats', () => {
  const modified = structuredClone(response);

  modified.content[0].content.content.source = {
    type: 'base64',
    media_type: 'application/pdf',
    data: 'abc123',
  };

  assert.equal(
    extractFetchedSourceDocument(modified, url),
    null
  );
});

test('rejects a missing fetch result', () => {
  assert.equal(
    extractFetchedSourceDocument(
      { content: [] },
      url
    ),
    null
  );
});
