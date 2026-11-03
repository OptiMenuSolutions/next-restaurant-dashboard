
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProductSourceUrl,
  retrieveProductSource,
} from '../lib/productSourceRetrieval.js';

test('accepts HTTPS manufacturer URL', () => {
  const result = validateProductSourceUrl(
    'https://www.knousefoodservice.com/products/strawberry-glaze-120-oz/'
  );

  assert.equal(result.valid, true);
});

test('blocks localhost', () => {
  const result = validateProductSourceUrl(
    'https://localhost/admin'
  );

  assert.equal(result.valid, false);
});

test('blocks private IPv4 addresses', () => {
  const result = validateProductSourceUrl(
    'https://192.168.1.10/private'
  );

  assert.equal(result.valid, false);
});

test('blocks IPv6 addresses', () => {
  const result = validateProductSourceUrl(
    'https://[::1]/private'
  );

  assert.equal(result.valid, false);
});

test('blocks HTTP URLs', () => {
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

test('blocks internal hostnames', () => {
  const result = validateProductSourceUrl(
    'https://service.internal/data'
  );

  assert.equal(result.valid, false);
});

test('blocked URLs never trigger a fetch', async () => {
  const result = await retrieveProductSource(
    'https://127.0.0.1/private'
  );

  assert.equal(result.status, 'blocked');
  assert.equal(result.content, null);
});
