import test from 'node:test';
import assert from 'node:assert/strict';

import {
  repriceFromInvoices,
} from '../lib/admin/invoiceLines.js';

const RESTAURANT_ID = 'restaurant-test-1';
const INGREDIENT_ID = 'ingredient-test-1';

function createFixture({
  ingredientOverrides = {},
  lines = [],
  evidence = [],
} = {}) {
  const ingredient = {
    id: INGREDIENT_ID,
    restaurant_id: RESTAURANT_ID,
    name: 'Dijon Mustard',
    unit: 'fl oz',
    last_price: 0.20,
    last_ordered_at: null,
    price_status: 'invoice',
    price_approved_at: null,
    ...ingredientOverrides,
  };

  const reads = [];
  const writes = [];

  const tables = {
    restaurant_invoice_matching_controls: [{
      restaurant_id: RESTAURANT_ID,
      status: 'legacy_enabled',
    }],
    recipe_workspaces: [],
    ingredients: [ingredient],
    invoice_items: lines,
    invoice_supported_price_evidence: evidence,
  };

  function query(table) {
    const filters = [];
    let operation = 'select';
    let updateValues = null;

    function filteredRows() {
      return (tables[table] || []).filter((row) =>
        filters.every(({ type, column, value }) => {
          const actual = column.split('.').reduce(
            (object, key) => object?.[key],
            row
          );

          if (type === 'eq') {
            return actual === value;
          }

          if (type === 'in') {
            return value.includes(actual);
          }

          if (type === 'is') {
            return actual == null && value === null;
          }

          return true;
        })
      );
    }

    const builder = {
      select() {
        return builder;
      },

      eq(column, value) {
        filters.push({ type: 'eq', column, value });
        return builder;
      },

      in(column, value) {
        filters.push({ type: 'in', column, value });
        return builder;
      },

      is(column, value) {
        filters.push({ type: 'is', column, value });
        return builder;
      },

      order() {
        return builder;
      },

      update(values) {
        operation = 'update';
        updateValues = values;
        return builder;
      },

      async maybeSingle() {
        const rows = filteredRows();

        reads.push({ table, operation: 'maybeSingle' });

        return {
          data: rows[0] || null,
          error: null,
        };
      },

      async single() {
        const rows = filteredRows();

        reads.push({ table, operation: 'single' });

        return {
          data: rows[0] || null,
          error: null,
        };
      },

      async range(start, end) {
        const rows = filteredRows().slice(start, end + 1);

        reads.push({
          table,
          operation: 'range',
          filters: [...filters],
        });

        return { data: rows, error: null };
      },

      then(resolve, reject) {
        if (operation === 'update') {
          const rows = filteredRows();

          for (const row of rows) {
            Object.assign(row, updateValues);
          }

          writes.push({
            table,
            values: { ...updateValues },
            count: rows.length,
          });

          return Promise.resolve({
            data: rows,
            error: null,
          }).then(resolve, reject);
        }

        return Promise.resolve({
          data: filteredRows(),
          error: null,
        }).then(resolve, reject);
      },
    };

    return builder;
  }

  const db = {
    from: query,

    async rpc(name) {
      assert.equal(name, 'recipe_setup_catalog');

      return {
        data: [],
        error: null,
      };
    },
  };

  return {
    db,
    ingredient,
    reads,
    writes,
  };
}

function invoiceLine(overrides = {}) {
  return {
    id: 'line-1',
    invoice_id: 'invoice-1',
    ingredient_id: INGREDIENT_ID,
    item_name: 'Dijon Mustard',
    restaurant_id: RESTAURANT_ID,
    quantity: 4,
    unit: 'qt',
    unit_cost: 7.5,
    amount: 30,
    price_verification_status: 'unknown',
    price_verification_source: null,
    price_verified_at: null,
    price_verification_evidence: null,
    invoices: {
      restaurant_id: RESTAURANT_ID,
      date: '2026-11-07',
      created_at: '2026-11-07T12:00:00Z',
    },
    ...overrides,
  };
}

function invoiceEvidence(overrides = {}) {
  const invoiceItemId =
    overrides.invoice_item_id || 'line-1';

  const invoiceId =
    overrides.invoice_id || 'invoice-1';

  const isSecondLine = invoiceItemId === 'line-2';

  return {
    id: 'evidence-1',
    invoice_item_id: invoiceItemId,
    invoice_id: invoiceId,
    restaurant_id: RESTAURANT_ID,
    source_type: 'structured_ocr_table',
    validation_status: 'source_table_consistent',
    invalidated_at: null,
    invalidation_reason: null,
    evidence: {
      pricing: {
        invoice_item_id: invoiceItemId,
        invoice_id: invoiceId,
        restaurant_id: RESTAURANT_ID,
        ingredient_id: null,
        item_name: 'Dijon Mustard',
        quantity: 4,
        unit: 'qt',
        unit_cost: isSecondLine ? 9 : 7.5,
        amount: isSecondLine ? 36 : 30,
      },
    },
    ...overrides,
  };
}

async function runFixture(
  options,
  enabled = true,
  allowedRestaurantId = RESTAURANT_ID
) {

  const previous =
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;

  const previousRestaurant =
    process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;

  process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
    allowedRestaurantId;

  if (enabled) {
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = 'true';
  } else {
    delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
  }

  try {
    const fixture = createFixture(options);

    await repriceFromInvoices(
      fixture.db,
      RESTAURANT_ID,
      INGREDIENT_ID
    );

    return fixture;
  } finally {
    if (previous === undefined) {
      delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_ENABLED = previous;
    }
    if (previousRestaurant === undefined) {
      delete process.env
        .INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID =
        previousRestaurant;
    }
  }
}

test('active database evidence updates ingredient cost', async () => {
  const result = await runFixture({
    lines: [invoiceLine()],
    evidence: [invoiceEvidence()],
  });

  assert.equal(result.ingredient.last_price, 0.234375);
  assert.equal(result.ingredient.unit, 'fl oz');
  assert.equal(result.ingredient.price_status, 'invoice');

  assert.equal(
    result.writes.filter((write) =>
      write.table === 'ingredients'
    ).length,
    1
  );

  assert.ok(
    result.reads.some((read) =>
      read.table === 'invoice_supported_price_evidence'
    )
  );
});

test('disabled flag preserves existing strict verification behavior', async () => {
  const result = await runFixture({
    lines: [invoiceLine()],
    evidence: [invoiceEvidence()],
  }, false);

  assert.equal(result.ingredient.last_price, 0.20);

  assert.equal(
    result.ingredient.price_status,
    'needs_review'
  );

  assert.equal(
    result.reads.some((read) =>
      read.table === 'invoice_supported_price_evidence'
    ),
    false
  );
});

test('invalidated evidence cannot authorize a price update', async () => {
  const result = await runFixture({
    lines: [invoiceLine()],
    evidence: [
      invoiceEvidence({
        invalidated_at: '2026-11-08T12:00:00Z',
        invalidation_reason: 'invoice_line_modified',
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 0.20);
  assert.equal(result.ingredient.price_status, 'needs_review');
});

test('manual approved pricing remains protected', async () => {
  const result = await runFixture({
    ingredientOverrides: {
      last_price: 0.50,
      price_status: 'manual',
      price_approved_at: '2026-11-01T12:00:00Z',
    },
    lines: [invoiceLine()],
    evidence: [invoiceEvidence()],
  });

  assert.equal(result.ingredient.last_price, 0.50);
  assert.equal(result.ingredient.price_status, 'manual');
  assert.equal(result.writes.length, 0);
});

test('unsupported package prices cannot overwrite ingredient costs', async () => {
  const result = await runFixture({
    lines: [
      invoiceLine({
        quantity: 3,
        unit: 'can',
        unit_cost: 10,
        amount: 30,
      }),
    ],
    evidence: [invoiceEvidence()],
  });

  assert.equal(result.ingredient.last_price, 0.20);
  assert.equal(result.ingredient.price_status, 'needs_review');
});

test('evidence belonging to another restaurant is excluded', async () => {
  const result = await runFixture({
    lines: [invoiceLine()],
    evidence: [
      invoiceEvidence({
        restaurant_id: 'another-restaurant',
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 0.20);
  assert.equal(result.ingredient.price_status, 'needs_review');
});

test('newest eligible invoice determines ingredient price', async () => {
  const result = await runFixture({
    lines: [
      invoiceLine(),
      invoiceLine({
        id: 'line-2',
        invoice_id: 'invoice-2',
        quantity: 4,
        unit_cost: 9,
        amount: 36,
        invoices: {
          restaurant_id: RESTAURANT_ID,
          date: '2026-11-08',
          created_at: '2026-11-08T12:00:00Z',
        },
      }),
    ],
    evidence: [
      invoiceEvidence(),
      invoiceEvidence({
        id: 'evidence-2',
        invoice_item_id: 'line-2',
        invoice_id: 'invoice-2',
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 0.28125);
  assert.equal(result.ingredient.last_ordered_at, '2026-11-08');
});

test('supplier-verified pricing remains eligible with invoice-supported pricing enabled', async () => {
  const result = await runFixture({
    lines: [
      invoiceLine({
        price_verification_status: 'verified',
        price_verification_source: 'trusted_supplier',
        price_verified_at: '2026-11-07T12:00:00Z',
        price_verification_evidence: {
          supplier: 'Synthetic Development Supplier',
          verification: 'supplier_document',
        },
      }),
    ],
    evidence: [],
  });

  assert.equal(result.ingredient.last_price, 0.234375);
  assert.equal(result.ingredient.unit, 'fl oz');
  assert.equal(result.ingredient.price_status, 'invoice');

  assert.equal(
    result.writes.filter((write) =>
      write.table === 'ingredients'
    ).length,
    1
  );
});

test('invalidation reason alone prevents invoice-supported repricing', async () => {
  const result = await runFixture({
    lines: [invoiceLine()],
    evidence: [
      invoiceEvidence({
        invalidated_at: null,
        invalidation_reason: 'invoice_line_modified',
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 0.20);
  assert.equal(result.ingredient.price_status, 'needs_review');
});

test('newer invalidated evidence cannot override older supplier-verified pricing', async () => {
  const result = await runFixture({
    lines: [
      invoiceLine({
        id: 'verified-line',
        invoice_id: 'verified-invoice',
        unit_cost: 6.40,
        amount: 25.60,
        price_verification_status: 'verified',
        price_verification_source: 'trusted_supplier',
        price_verified_at: '2026-11-06T12:00:00Z',
        price_verification_evidence: {
          supplier: 'Synthetic Development Supplier',
          verification: 'supplier_document',
        },
        invoices: {
          restaurant_id: RESTAURANT_ID,
          date: '2026-11-06',
          created_at: '2026-11-06T12:00:00Z',
        },
      }),
      invoiceLine({
        id: 'invalidated-line',
        invoice_id: 'invalidated-invoice',
        unit_cost: 9.60,
        amount: 38.40,
        invoices: {
          restaurant_id: RESTAURANT_ID,
          date: '2026-11-08',
          created_at: '2026-11-08T12:00:00Z',
        },
      }),
    ],
    evidence: [
      invoiceEvidence({
        id: 'invalidated-evidence',
        invoice_item_id: 'invalidated-line',
        invoice_id: 'invalidated-invoice',
        invalidated_at: '2026-11-08T15:00:00Z',
        invalidation_reason: 'invoice_line_modified',
      }),
    ],
  });

  // The older supplier-verified invoice remains eligible.
  // $6.40 / 32 fl oz = $0.20/fl oz.
  assert.equal(result.ingredient.last_price, 0.20);
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.equal(result.ingredient.last_ordered_at, '2026-11-06');

  assert.equal(
    result.writes.filter((write) =>
      write.table === 'ingredients'
    ).length,
    1
  );
});


test('authenticated V2 catch-weight evidence updates only the linked ingredient at standardized cost', async () => {
  const result = await runFixture({
    ingredientOverrides: {
      name: 'Beef Skirt Steak',
      unit: 'oz',
      last_price: 0.75,
    },
    lines: [
      invoiceLine({
        item_name: 'Beef Skirt Steak',
        quantity: 9.96,
        unit: 'lb',
        unit_cost: 14.5,
        amount: 144.42,
      }),
    ],
    evidence: [
      invoiceEvidence({
        source_type: 'independent_ocr_evidence',
        validation_status: 'source_charge_verified',
        evidence_version: 2,
        evidence: {
          proof_version: 2,
          pricing: {
            invoice_item_id: 'line-1',
            invoice_id: 'invoice-1',
            restaurant_id: RESTAURANT_ID,
            ingredient_id: null,
            item_name: 'Beef Skirt Steak',
            quantity: 9.96,
            unit: 'lb',
            unit_cost: 14.5,
            amount: 144.42,
          },
        },
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 0.90625);
  assert.equal(result.ingredient.unit, 'oz');
  assert.equal(result.ingredient.standard_unit, 'oz');
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.equal(result.ingredient.last_ordered_at, '2026-11-07');

  assert.equal(
    result.writes.filter((write) =>
      write.table === 'ingredients'
    ).length,
    1
  );
});


test('V2 evidence cannot overwrite manually approved ingredient pricing', async () => {
  const result = await runFixture({
    ingredientOverrides: {
      name: 'Beef Skirt Steak',
      unit: 'oz',
      last_price: 1.25,
      price_status: 'manual',
      price_approved_at: '2026-11-09T12:00:00Z',
    },
    lines: [
      invoiceLine({
        item_name: 'Beef Skirt Steak',
        quantity: 9.96,
        unit: 'lb',
        unit_cost: 14.5,
        amount: 144.42,
      }),
    ],
    evidence: [
      invoiceEvidence({
        source_type: 'independent_ocr_evidence',
        validation_status: 'source_charge_verified',
        evidence_version: 2,
        evidence: {
          proof_version: 2,
          pricing: {
            invoice_item_id: 'line-1',
            invoice_id: 'invoice-1',
            restaurant_id: RESTAURANT_ID,
            item_name: 'Beef Skirt Steak',
            quantity: 9.96,
            unit: 'lb',
            unit_cost: 14.5,
            amount: 144.42,
          },
        },
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 1.25);
  assert.equal(result.ingredient.price_status, 'manual');
  assert.equal(result.writes.length, 0);
});

test('invalidated V2 evidence cannot overwrite ingredient pricing', async () => {
  const result = await runFixture({
    ingredientOverrides: {
      name: 'Beef Skirt Steak',
      unit: 'oz',
      last_price: 0.75,
    },
    lines: [
      invoiceLine({
        item_name: 'Beef Skirt Steak',
        quantity: 9.96,
        unit: 'lb',
        unit_cost: 14.5,
        amount: 144.42,
      }),
    ],
    evidence: [
      invoiceEvidence({
        source_type: 'independent_ocr_evidence',
        validation_status: 'source_charge_verified',
        evidence_version: 2,
        invalidated_at: '2026-11-10T12:00:00Z',
        invalidation_reason: 'invoice_line_modified',
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 0.75);
  assert.equal(result.ingredient.price_status, 'needs_review');
});

test('V2 evidence from another restaurant cannot update ingredient pricing', async () => {
  const result = await runFixture({
    ingredientOverrides: {
      name: 'Beef Skirt Steak',
      unit: 'oz',
      last_price: 0.75,
    },
    lines: [
      invoiceLine({
        item_name: 'Beef Skirt Steak',
        quantity: 9.96,
        unit: 'lb',
        unit_cost: 14.5,
        amount: 144.42,
      }),
    ],
    evidence: [
      invoiceEvidence({
        restaurant_id: 'another-restaurant',
        source_type: 'independent_ocr_evidence',
        validation_status: 'source_charge_verified',
        evidence_version: 2,
      }),
    ],
  });

  assert.equal(result.ingredient.last_price, 0.75);
  assert.equal(result.ingredient.price_status, 'needs_review');
});


test('older authenticated V2 price wins over newer unverified invoice', async () => {
  const result = await runFixture({
    ingredientOverrides: {
      name: 'Chicken breast',
      unit: 'oz',
      standard_unit: 'oz',
      last_price: null,
      price_status: 'pending',
      price_approved_at: null,
    },
    lines: [
      // Newer invoice: recorded price, but no
      // authenticated evidence.
      invoiceLine({
        id: 'newer-line',
        invoice_id: 'newer-invoice',
        item_name: 'Chicken Breast Fresh',
        quantity: 10,
        unit: 'lb',
        unit_cost: 4.60,
        amount: 46,
        invoices: {
          restaurant_id: RESTAURANT_ID,
          date: '2026-11-14',
          created_at: '2026-11-14T12:00:00Z',
        },
      }),

      // Older invoice: authenticated V2 source.
      invoiceLine({
        id: 'verified-line',
        invoice_id: 'verified-invoice',
        item_name: 'Chicken Breast Fresh',
        quantity: 18.4,
        unit: 'lb',
        unit_cost: 4.30,
        amount: 79.12,
        invoices: {
          restaurant_id: RESTAURANT_ID,
          date: '2026-11-10',
          created_at: '2026-11-10T17:50:00Z',
        },
      }),
    ],
    evidence: [
      invoiceEvidence({
        id: 'verified-evidence',
        invoice_item_id: 'verified-line',
        invoice_id: 'verified-invoice',
        source_type: 'independent_ocr_evidence',
        validation_status: 'source_charge_verified',
        evidence_version: 2,
        evidence: {
          proof_version: 2,
          pricing: {
            invoice_item_id: 'verified-line',
            invoice_id: 'verified-invoice',
            restaurant_id: RESTAURANT_ID,
            item_name: 'Chicken Breast Fresh',
            quantity: 18.4,
            unit: 'lb',
            unit_cost: 4.30,
            amount: 79.12,
          },
        },
      }),
    ],
  });

  // $4.30 per lb / 16 oz per lb.
  // Do not use the newer unsupported $4.60 price.
  assert.equal(result.ingredient.last_price, 0.26875);
  assert.equal(result.ingredient.unit, 'oz');
  assert.equal(result.ingredient.standard_unit, 'oz');
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.equal(result.ingredient.is_estimated, false);
  assert.equal(
    result.ingredient.last_ordered_at,
    '2026-11-10'
  );

  // Exactly one ingredient update is expected.
  assert.equal(
    result.writes.filter(
      write => write.table === 'ingredients'
    ).length,
    1
  );
});


test('authenticated V2 evidence cannot reprice a restaurant outside the allowlist', async () => {
  const result = await runFixture(
    {
      ingredientOverrides: {
        name: 'Chicken breast',
        unit: 'oz',
        standard_unit: 'oz',
        last_price: null,
        price_status: 'pending',
        price_approved_at: null,
      },
      lines: [
        invoiceLine({
          item_name: 'Chicken Breast Fresh',
          quantity: 18.4,
          unit: 'lb',
          unit_cost: 4.30,
          amount: 79.12,
        }),
      ],
      evidence: [
        invoiceEvidence({
          source_type: 'independent_ocr_evidence',
          validation_status: 'source_charge_verified',
          evidence_version: 2,
          evidence: {
            proof_version: 2,
            pricing: {
              invoice_item_id: 'line-1',
              invoice_id: 'invoice-1',
              restaurant_id: RESTAURANT_ID,
              item_name: 'Chicken Breast Fresh',
              quantity: 18.4,
              unit: 'lb',
              unit_cost: 4.30,
              amount: 79.12,
            },
          },
        }),
      ],
    },
    true,
    'different-restaurant-id'
  );

  // The global flag is enabled, but this restaurant
  // is not the authorized restaurant.
  assert.equal(result.ingredient.last_price, null);
  assert.equal(result.ingredient.price_status, 'pending');

  // No ingredient pricing changes are permitted.
  assert.equal(
    result.writes.filter(
      write => write.table === 'ingredients'
    ).length,
    0
  );

  // The unauthorized restaurant must never query
  // the authenticated evidence table.
  assert.equal(
    result.reads.some(
      read =>
        read.table ===
        'invoice_supported_price_evidence'
    ),
    false
  );
});
