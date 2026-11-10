
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isInvoiceSupportedRepricingEnabled,
} from '../lib/invoiceSupportedRepricingFlag.js';

const HARBOR =
  '9c3faab4-a6b5-4d22-9551-83e51760b90e';

const OTHER =
  '5813bf06-7a9d-4fdc-a788-fb74d5bc77eb';

test('authenticated repricing activation is restaurant-specific', () => {
  const oldFlag =
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
  const oldRestaurant =
    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;

  try {
    delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
    delete process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;

    assert.equal(
      isInvoiceSupportedRepricingEnabled(HARBOR),
      false
    );

    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED =
      'true';

    // Global flag alone cannot enable repricing.
    assert.equal(
      isInvoiceSupportedRepricingEnabled(HARBOR),
      false
    );

    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
      HARBOR;

    assert.equal(
      isInvoiceSupportedRepricingEnabled(HARBOR),
      true
    );

    // Other restaurants remain on legacy behavior.
    assert.equal(
      isInvoiceSupportedRepricingEnabled(OTHER),
      false
    );

    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED =
      'false';

    assert.equal(
      isInvoiceSupportedRepricingEnabled(HARBOR),
      false
    );

    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED =
      'true';

    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
      ' ';

    assert.equal(
      isInvoiceSupportedRepricingEnabled(HARBOR),
      false
    );

    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
      OTHER;

    assert.equal(
      isInvoiceSupportedRepricingEnabled(HARBOR),
      false
    );

    assert.equal(
      isInvoiceSupportedRepricingEnabled(OTHER),
      true
    );
  } finally {
    if (oldFlag === undefined) {
      delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_ENABLED =
        oldFlag;
    }

    if (oldRestaurant === undefined) {
      delete process.env
        .INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
        oldRestaurant;
    }
  }
});
