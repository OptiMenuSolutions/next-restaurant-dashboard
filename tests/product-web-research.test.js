
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyProductResearch,
} from '../lib/productWebResearch.js';

import {
  parseResearchJSON,
} from '../lib/productWebResearch.js';

import {
  extractProductResearchSources,
} from '../lib/productWebResearch.js';

const sources = [{
  url: 'https://example.com/product',
  title: 'Example manufacturer specification',
}];

const finding = {
  match_status: 'exact_match',
  identity_evidence: 'exact_identifier',
  product_name: 'Strawberry Glaze',
  brand: 'Example Foods',
  manufacturer_sku: 'ABC123',
  supplier_sku: '74135',
  package_count: 3,
  net_quantity: 104,
  net_unit: 'oz',
  measurement_scope: 'per_container',
  reason: 'Matching manufacturer specification',
};

test('exact product with citation becomes verification candidate', () => {
  const result = classifyProductResearch(finding, sources);

  assert.equal(result.status, 'verified_candidate');
  assert.equal(result.measurement.quantity, 104);
  assert.equal(result.measurement.unit, 'oz');
});

test('missing source requires review', () => {
  const result = classifyProductResearch(finding, []);

  assert.equal(result.status, 'needs_review');
});

test('descriptive match requires review', () => {
  const result = classifyProductResearch({
    ...finding,
    identity_evidence: 'descriptive_only',
  }, sources);

  assert.equal(result.status, 'needs_review');
});

test('case measurement requires review', () => {
  const result = classifyProductResearch({
    ...finding,
    measurement_scope: 'per_case',
  }, sources);

  assert.equal(result.status, 'needs_review');
});

test('unknown measurement requires review', () => {
  const result = classifyProductResearch({
    ...finding,
    net_quantity: null,
  }, sources);

  assert.equal(result.status, 'needs_review');
});

test('product not found is classified separately', () => {
  const result = classifyProductResearch({
    match_status: 'not_found',
    reason: 'No matching product',
  });

  assert.equal(result.status, 'not_found');
});

test('missing identifier requires review', () => {
  const result = classifyProductResearch({
    ...finding,
    manufacturer_sku: null,
    supplier_sku: null,
  }, sources);

  assert.equal(result.status, 'needs_review');
});


test('parses JSON after Claude commentary and a code fence', () => {
  const response = [
    "I'll search for the product.",
    '```json',
    '{',
    '  "match_status": "not_found",',
    '  "identity_evidence": "none",',
    '  "reason": "Exact SKU could not be verified"',
    '}',
    '```',
  ].join('\n');

  const parsed = parseResearchJSON(response);
  const result = classifyProductResearch(parsed, []);

  assert.equal(result.status, 'not_found');
  assert.equal(result.reason, 'Exact SKU could not be verified');
});


test('extracts search results without treating them as citations', () => {
  const blocks = [
    {
      type: 'web_search_tool_result',
      content: [
        {
          type: 'web_search_result',
          url: 'https://manufacturer.example/spec',
          title: 'Product specification',
          page_age: '2 months ago',
        },
        {
          type: 'web_search_result',
          url: 'https://distributor.example/item',
          title: 'Distributor listing',
        },
      ],
    },
    {
      type: 'text',
      text: 'No exact product match found.',
      citations: [],
    },
  ];

  const result = extractProductResearchSources(blocks);

  assert.equal(result.searchResults.length, 2);
  assert.equal(result.sources.length, 0);
  assert.equal(
    result.searchResults[0].url,
    'https://manufacturer.example/spec'
  );
  assert.equal(
    result.searchResults[0].pageAge,
    '2 months ago'
  );
});


test('uncertain product cannot expose a usable measurement', () => {
  const result = classifyProductResearch({
    match_status: 'uncertain',
    identity_evidence: 'descriptive_only',
    product_name: 'Strawberry Glaze',
    brand: null,
    manufacturer_sku: null,
    supplier_sku: '74135',
    package_count: 3,
    net_quantity: 120,
    net_unit: 'fl oz',
    measurement_scope: 'per_container',
    reason: 'Exact product identity not verified',
  }, []);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.measurement, null);
  assert.equal(result.proposedMeasurement.quantity, 120);
});
