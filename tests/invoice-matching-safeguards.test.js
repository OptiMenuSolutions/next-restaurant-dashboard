
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INVOICE_MATCHING_STATUS,
  isInvoiceMatchingEnabled,
  isValidInvoiceMatchingStatus,
  getRestaurantInvoiceMatchingControl,
} from '../lib/invoiceMatchingControls.js';

const RESTAURANT_ID = 'restaurant-test-1';

function mockDatabase({
  status = 'locked',
  missing = false,
  error = null,
} = {}) {
  const calls = [];

  const db = {
    from(table) {
      calls.push({ method: 'from', value: table });

      const query = {
        select(columns) {
          calls.push({ method: 'select', value: columns });
          return query;
        },

        eq(column, value) {
          calls.push({ method: 'eq', column, value });
          return query;
        },

        async maybeSingle() {
          calls.push({ method: 'maybeSingle' });

          return {
            data: missing
              ? null
              : {
                  restaurant_id: RESTAURANT_ID,
                  status,
                },
            error: error ? { message: error } : null,
          };
        },
      };

      return query;
    },
  };

  return { db, calls };
}

test('locked restaurant cannot use invoice matching', async () => {
  const { db, calls } = mockDatabase({
    status: INVOICE_MATCHING_STATUS.LOCKED,
  });

  const control = await getRestaurantInvoiceMatchingControl(
    db,
    RESTAURANT_ID
  );

  assert.equal(control.status, 'locked');
  assert.equal(control.matching_enabled, false);
  assert.equal(control.is_locked, true);

  assert.ok(
    calls.some(
      call =>
        call.method === 'from' &&
        call.value === 'restaurant_invoice_matching_controls'
    )
  );

  assert.ok(
    calls.some(
      call =>
        call.method === 'eq' &&
        call.column === 'restaurant_id' &&
        call.value === RESTAURANT_ID
    )
  );
});

test('legacy-enabled restaurant retains matching access', async () => {
  const { db } = mockDatabase({
    status: INVOICE_MATCHING_STATUS.LEGACY_ENABLED,
  });

  const control = await getRestaurantInvoiceMatchingControl(
    db,
    RESTAURANT_ID
  );

  assert.equal(control.matching_enabled, true);
  assert.equal(control.is_locked, false);
});

test('automatically activated restaurant can use matching', async () => {
  const { db } = mockDatabase({
    status: INVOICE_MATCHING_STATUS.AUTO_ENABLED,
  });

  const control = await getRestaurantInvoiceMatchingControl(
    db,
    RESTAURANT_ID
  );

  assert.equal(control.matching_enabled, true);
  assert.equal(control.is_locked, false);
});

test('admin-activated restaurant can use matching', async () => {
  const { db } = mockDatabase({
    status: INVOICE_MATCHING_STATUS.ADMIN_ENABLED,
  });

  const control = await getRestaurantInvoiceMatchingControl(
    db,
    RESTAURANT_ID
  );

  assert.equal(control.matching_enabled, true);
  assert.equal(control.is_locked, false);
});

test('missing control record fails closed', async () => {
  const { db } = mockDatabase({ missing: true });

  await assert.rejects(
    getRestaurantInvoiceMatchingControl(
      db,
      RESTAURANT_ID
    ),
    /Missing invoice matching control/
  );
});

test('database lookup failure fails closed', async () => {
  const { db } = mockDatabase({
    error: 'Database unavailable',
  });

  await assert.rejects(
    getRestaurantInvoiceMatchingControl(
      db,
      RESTAURANT_ID
    ),
    /Could not load invoice matching control/
  );
});

test('invalid matching status fails closed', async () => {
  const { db } = mockDatabase({
    status: 'unexpected_status',
  });

  await assert.rejects(
    getRestaurantInvoiceMatchingControl(
      db,
      RESTAURANT_ID
    ),
    /Invalid invoice matching status/
  );
});

test('missing restaurant ID is rejected', async () => {
  const { db } = mockDatabase();

  await assert.rejects(
    getRestaurantInvoiceMatchingControl(db, null),
    /Restaurant ID is required/
  );
});

test('only approved statuses enable matching', () => {
  assert.equal(isInvoiceMatchingEnabled('locked'), false);
  assert.equal(isInvoiceMatchingEnabled('legacy_enabled'), true);
  assert.equal(isInvoiceMatchingEnabled('auto_enabled'), true);
  assert.equal(isInvoiceMatchingEnabled('admin_enabled'), true);

  assert.equal(isInvoiceMatchingEnabled(null), false);
  assert.equal(isInvoiceMatchingEnabled('unknown'), false);
});

test('status validation rejects unknown values', () => {
  for (const status of Object.values(INVOICE_MATCHING_STATUS)) {
    assert.equal(isValidInvoiceMatchingStatus(status), true);
  }

  assert.equal(isValidInvoiceMatchingStatus('unknown'), false);
  assert.equal(isValidInvoiceMatchingStatus(null), false);
  assert.equal(isValidInvoiceMatchingStatus(''), false);
});
