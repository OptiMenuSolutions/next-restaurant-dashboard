import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createConflictConfirmation,
  verifyConflictConfirmation,
} from '../lib/admin/invoiceConflictConfirmation.js';

const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use a test-only signing key, never a production credential.
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'step7-test-confirmation-signing-key';

const ADMIN_ID = 'admin-test-1';

const request = {
  restaurant_id: 'restaurant-test-1',
  supplier: 'Keystone Foodservice Supply',
  product_description: 'Gravy Mix Brown',
  changes: [
    {
      invoice_item_id: 'invoice-item-test-1',
      expected_ingredient_id: null,
      ingredient_id: 'ingredient-test-1',
    },
  ],
  approve_future: true,
  future_ingredient_id: 'ingredient-test-1',
  expected_mapping_updated_at: null,
};

test('1. Valid administrator confirmation is accepted', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  assert.equal(
    verifyConflictConfirmation(token, ADMIN_ID, request),
    true
  );
});

test('2. Confirmation cannot be reused by another administrator', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  assert.equal(
    verifyConflictConfirmation(
      token,
      'different-admin',
      request
    ),
    false
  );
});

test('3. Confirmation cannot be reused for another supplier', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  assert.equal(
    verifyConflictConfirmation(
      token,
      ADMIN_ID,
      {
        ...request,
        supplier: 'Another Foodservice Supplier',
      }
    ),
    false
  );
});

test('4. Confirmation cannot be reused for another restaurant', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  assert.equal(
    verifyConflictConfirmation(
      token,
      ADMIN_ID,
      {
        ...request,
        restaurant_id: 'different-restaurant',
      }
    ),
    false
  );
});

test('5. Confirmation cannot authorize different ingredient changes', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  assert.equal(
    verifyConflictConfirmation(
      token,
      ADMIN_ID,
      {
        ...request,
        changes: [
          {
            invoice_item_id: 'invoice-item-test-1',
            expected_ingredient_id: null,
            ingredient_id: 'different-ingredient',
          },
        ],
      }
    ),
    false
  );
});

test('6. Confirmation cannot authorize a different future approval', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  assert.equal(
    verifyConflictConfirmation(
      token,
      ADMIN_ID,
      {
        ...request,
        future_ingredient_id: 'different-ingredient',
      }
    ),
    false
  );
});

test('7. Confirmation cannot bypass the expected mapping version', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  assert.equal(
    verifyConflictConfirmation(
      token,
      ADMIN_ID,
      {
        ...request,
        expected_mapping_updated_at:
          '2026-11-05T12:00:00Z',
      }
    ),
    false
  );
});

test('8. Modified confirmation signatures are rejected', () => {
  const token = createConflictConfirmation(
    ADMIN_ID,
    request
  );

  const [payload, signature] = token.split('.');

  const modifiedSignature =
    (signature[0] === 'a' ? 'b' : 'a') +
    signature.slice(1);

  assert.equal(
    verifyConflictConfirmation(
      `${payload}.${modifiedSignature}`,
      ADMIN_ID,
      request
    ),
    false
  );
});

test('9. Missing confirmation tokens are rejected', () => {
  assert.equal(
    verifyConflictConfirmation(
      null,
      ADMIN_ID,
      request
    ),
    false
  );
});

test('10. Expired confirmation tokens are rejected', () => {
  const originalNow = Date.now;

  try {
    const issuedAt = originalNow();

    Date.now = () => issuedAt;

    const token = createConflictConfirmation(
      ADMIN_ID,
      request
    );

    Date.now = () => issuedAt + 11 * 60 * 1000;

    assert.equal(
      verifyConflictConfirmation(
        token,
        ADMIN_ID,
        request
      ),
      false
    );
  } finally {
    Date.now = originalNow;
  }
});

// Restore the original environment.
test.after(() => {
  if (originalKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});