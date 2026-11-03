
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProductSourceUrl,
  retrieveProductSource,
} from '../lib/productSourceRetrieval.js';

test('blocks localhost URLs', () => {
  const result = validateProductSourceUrl(
    'https://localhost/admin'
  );

  assert.equal(result.valid, false);
});

test('blocks private network addresses', () => {
  const result = validateProductSourceUrl(
    'https://192.168.1.10/secret'
  );

  assert.equal(result.valid, false);
});

test('blocks non-HTTPS URLs', () => {
  const result = validateProductSourceUrl(
    'http://example.com/product'
  );

  assert.equal(result.valid, false);
});

test('blocks embedded credentials', () => {
  const result = validateProductSourceUrl(
    'https://user:pass@example.com/product'
  );

  assert.equal(result.valid, false);
});

test('blocks unapproved external hosts', () => {
  const result = validateProductSourceUrl(
    'https://manufacturer.example/product'
  );

  assert.equal(result.valid, false);
});

test('blocked source cannot be retrieved', async () => {
  const result = await retrieveProductSource(
    'https://127.0.0.1/private'
  );

  assert.equal(result.status, 'blocked');
  assert.equal(result.content, null);
});
