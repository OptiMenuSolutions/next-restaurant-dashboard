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
  operationalTimezone = 'America/New_York',
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
    restaurants: [{
      id: RESTAURANT_ID,
      operational_timezone: operationalTimezone,
    }],
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
  allowedRestaurantId = RESTAURANT_ID,
  afterReprice = null
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

    if (afterReprice) {
      await afterReprice(fixture);
    }

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

test('repeated authenticated repricing avoids redundant ingredient writes', async () => {
  const result = await runFixture({
    ingredientOverrides: {
      name: 'Chicken breast',
      unit: 'oz',
      standard_unit: 'oz',
      last_price: 0.26875,
      last_ordered_at: '2026-11-10',
      price_status: 'invoice',
      is_estimated: false,
      price_approved_at: null,
    },
    lines: [
      invoiceLine({
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
  });

  assert.equal(result.ingredient.last_price, 0.26875);
  assert.equal(result.ingredient.price_status, 'invoice');

  // Repricing must not write an identical value again.
  assert.equal(
    result.writes.filter(
      write => write.table === 'ingredients'
    ).length,
    0
  );
});

function datedEvidencePurchase({
  id,
  invoiceId,
  invoiceDate,
  deliveryDate,
  unitCost,
  quantity = 4,
  unit = 'qt',
  itemName = 'Dijon Mustard',
  version = 1,
}) {
  const amount = Math.round(quantity * unitCost * 100) / 100;

  const savedLine = invoiceLine({
    id,
    invoice_id: invoiceId,
    item_name: itemName,
    quantity,
    unit,
    unit_cost: unitCost,
    amount,
    invoices: {
      restaurant_id: RESTAURANT_ID,
      date: invoiceDate,
      delivery_date: deliveryDate,
      created_at: `${invoiceDate}T12:00:00Z`,
    },
  });

  const savedEvidence = invoiceEvidence({
    id: `dated-evidence-${id}`,
    invoice_item_id: id,
    invoice_id: invoiceId,
    evidence_version: version,
    source_type: version === 2
      ? 'independent_ocr_evidence'
      : 'structured_ocr_table',
    validation_status: version === 2
      ? 'source_charge_verified'
      : 'source_table_consistent',
    evidence: {
      proof_version: version,
      pricing: {
        invoice_item_id: id,
        invoice_id: invoiceId,
        restaurant_id: RESTAURANT_ID,
        ingredient_id: null,
        item_name: itemName,
        quantity,
        unit,
        unit_cost: unitCost,
        amount,
      },
    },
  });

  return {
    line: savedLine,
    evidence: savedEvidence,
  };
}

test('future authenticated V1 delivery cannot replace delivered pricing', async () => {
  const delivered = datedEvidencePurchase({
    id: 'delivered-v1',
    invoiceId: 'delivered-invoice-v1',
    invoiceDate: '2026-11-07',
    deliveryDate: '2026-11-09',
    unitCost: 7.5,
  });

  const future = datedEvidencePurchase({
    id: 'future-v1',
    invoiceId: 'future-invoice-v1',
    invoiceDate: '2026-11-08',
    deliveryDate: '2999-12-31',
    unitCost: 9,
  });

  const evidence = [delivered.evidence, future.evidence];
  const evidenceBefore = structuredClone(evidence);

  const result = await runFixture({
    lines: [delivered.line, future.line],
    evidence,
  });

  assert.equal(result.ingredient.last_price, 0.234375);
  assert.equal(result.ingredient.last_ordered_at, '2026-11-09');
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.deepEqual(evidence, evidenceBefore);
});

test('future authenticated V2 delivery cannot replace delivered pricing', async () => {
  const delivered = datedEvidencePurchase({
    id: 'delivered-v2',
    invoiceId: 'delivered-invoice-v2',
    invoiceDate: '2026-11-07',
    deliveryDate: '2026-11-09',
    unitCost: 13,
    quantity: 9.96,
    unit: 'lb',
    itemName: 'Beef Skirt Steak',
    version: 2,
  });

  const future = datedEvidencePurchase({
    id: 'future-v2',
    invoiceId: 'future-invoice-v2',
    invoiceDate: '2026-11-08',
    deliveryDate: '2999-12-31',
    unitCost: 14.5,
    quantity: 9.96,
    unit: 'lb',
    itemName: 'Beef Skirt Steak',
    version: 2,
  });

  const evidence = [delivered.evidence, future.evidence];
  const evidenceBefore = structuredClone(evidence);

  const result = await runFixture({
    ingredientOverrides: {
      name: 'Beef Skirt Steak',
      unit: 'oz',
      standard_unit: 'oz',
      last_price: 0.75,
    },
    lines: [delivered.line, future.line],
    evidence,
  });

  assert.equal(result.ingredient.last_price, 0.8125);
  assert.equal(result.ingredient.unit, 'oz');
  assert.equal(result.ingredient.last_ordered_at, '2026-11-09');
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.deepEqual(evidence, evidenceBefore);
});

test('future-only authenticated purchase cannot remain current verified pricing', async () => {
  const future = datedEvidencePurchase({
    id: 'future-only',
    invoiceId: 'future-only-invoice',
    invoiceDate: '2026-11-07',
    deliveryDate: '2999-12-31',
    unitCost: 9,
  });

  const result = await runFixture({
    ingredientOverrides: {
      last_price: 0.20,
      last_ordered_at: '2026-11-07',
      price_status: 'invoice',
    },
    lines: [future.line],
    evidence: [future.evidence],
  });

  assert.equal(result.ingredient.last_price, 0.20);
  assert.equal(result.ingredient.price_status, 'needs_review');
  assert.equal(result.ingredient.is_estimated, true);
});

test('moving latest delivery into the future restores the earlier eligible price', async () => {
  const older = datedEvidencePurchase({
    id: 'correction-older',
    invoiceId: 'correction-older-invoice',
    invoiceDate: '2026-11-07',
    deliveryDate: '2026-11-09',
    unitCost: 7.5,
  });

  const latest = datedEvidencePurchase({
    id: 'correction-latest',
    invoiceId: 'correction-latest-invoice',
    invoiceDate: '2026-11-08',
    deliveryDate: '2026-11-11',
    unitCost: 9,
  });

  const evidence = [older.evidence, latest.evidence];
  const evidenceBefore = structuredClone(evidence);

  const result = await runFixture(
    {
      lines: [older.line, latest.line],
      evidence,
    },
    true,
    RESTAURANT_ID,
    async (fixture) => {
      assert.equal(fixture.ingredient.last_price, 0.28125);
      assert.equal(
        fixture.ingredient.last_ordered_at,
        '2026-11-11'
      );

      latest.line.invoices.delivery_date = '2999-12-31';

      await repriceFromInvoices(
        fixture.db,
        RESTAURANT_ID,
        INGREDIENT_ID
      );
    }
  );

  assert.equal(result.ingredient.last_price, 0.234375);
  assert.equal(result.ingredient.last_ordered_at, '2026-11-09');
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.equal(latest.line.invoices.date, '2026-11-08');
  assert.deepEqual(evidence, evidenceBefore);
});

test('correcting a future delivery to a delivered date reevaluates its price', async () => {
  const older = datedEvidencePurchase({
    id: 'future-correction-older',
    invoiceId: 'future-correction-older-invoice',
    invoiceDate: '2026-11-07',
    deliveryDate: '2026-11-09',
    unitCost: 7.5,
  });

  const corrected = datedEvidencePurchase({
    id: 'future-correction-newer',
    invoiceId: 'future-correction-newer-invoice',
    invoiceDate: '2026-11-05',
    deliveryDate: '2999-12-31',
    unitCost: 9,
  });

  const evidence = [older.evidence, corrected.evidence];
  const evidenceBefore = structuredClone(evidence);

  const result = await runFixture(
    {
      lines: [older.line, corrected.line],
      evidence,
    },
    true,
    RESTAURANT_ID,
    async (fixture) => {
      assert.equal(fixture.ingredient.last_price, 0.234375);
      assert.equal(
        fixture.ingredient.last_ordered_at,
        '2026-11-09'
      );

      corrected.line.invoices.delivery_date = '2026-11-11';

      await repriceFromInvoices(
        fixture.db,
        RESTAURANT_ID,
        INGREDIENT_ID
      );
    }
  );

  assert.equal(result.ingredient.last_price, 0.28125);
  assert.equal(result.ingredient.last_ordered_at, '2026-11-11');
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.equal(corrected.line.invoices.date, '2026-11-05');
  assert.deepEqual(evidence, evidenceBefore);
});

test('delivery-date correction cannot reactivate invalidated evidence', async () => {
  const valid = datedEvidencePurchase({
    id: 'valid-date-evidence',
    invoiceId: 'valid-date-invoice',
    invoiceDate: '2026-11-07',
    deliveryDate: '2026-11-09',
    unitCost: 7.5,
  });

  const invalidated = datedEvidencePurchase({
    id: 'invalidated-date-evidence',
    invoiceId: 'invalidated-date-invoice',
    invoiceDate: '2026-11-08',
    deliveryDate: '2026-11-11',
    unitCost: 9,
  });

  invalidated.evidence.invalidated_at =
    '2026-11-08T15:00:00Z';
  invalidated.evidence.invalidation_reason =
    'invoice_line_modified';

  const evidence = [valid.evidence, invalidated.evidence];
  const evidenceBefore = structuredClone(evidence);

  const result = await runFixture(
    {
      lines: [valid.line, invalidated.line],
      evidence,
    },
    true,
    RESTAURANT_ID,
    async (fixture) => {
      assert.equal(fixture.ingredient.last_price, 0.234375);

      invalidated.line.invoices.delivery_date = '2026-11-10';

      await repriceFromInvoices(
        fixture.db,
        RESTAURANT_ID,
        INGREDIENT_ID
      );
    }
  );

  assert.equal(result.ingredient.last_price, 0.234375);
  assert.equal(result.ingredient.last_ordered_at, '2026-11-09');
  assert.equal(result.ingredient.price_status, 'invoice');
  assert.deepEqual(evidence, evidenceBefore);
});

test('shared repricing uses each restaurant local date at the same instant', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-11-12T06:00:00Z'),
  });

  for (const [operationalTimezone, delivered] of [
    ['America/New_York', true],
    ['America/Los_Angeles', false],
  ]) {
    const result = await runFixture({
      operationalTimezone,
      lines: [invoiceLine({
        invoices: {
          restaurant_id: RESTAURANT_ID,
          date: '2026-11-10',
          delivery_date: '2026-11-12',
          created_at: '2026-11-10T12:00:00Z',
        },
      })],
      evidence: [invoiceEvidence()],
    });

    assert.equal(
      result.ingredient.last_price,
      delivered ? 0.234375 : 0.20
    );
    assert.equal(
      result.ingredient.price_status,
      delivered ? 'invoice' : 'needs_review'
    );
  }
});

for (const [season, midnight] of [
  ['winter', '2026-11-12T08:00:00Z'],
  ['summer', '2026-07-12T07:00:00Z'],
]) {
  test('shared repricing waits for Los Angeles midnight in ' + season, async (t) => {
    const midnightMs = Date.parse(midnight);
    const deliveryDate = midnight.slice(0, 10);
    t.mock.timers.enable({
      apis: ['Date'],
      now: midnightMs - 1,
    });

    const options = () => ({
      operationalTimezone: 'America/Los_Angeles',
      lines: [invoiceLine({
        invoices: {
          restaurant_id: RESTAURANT_ID,
          date: deliveryDate,
          delivery_date: deliveryDate,
          created_at: deliveryDate + 'T12:00:00Z',
        },
      })],
      evidence: [invoiceEvidence()],
    });

    const before = await runFixture(options());
    assert.equal(before.ingredient.last_price, 0.20);
    assert.equal(before.ingredient.price_status, 'needs_review');

    t.mock.timers.tick(1);

    const delivered = await runFixture(options());
    assert.equal(delivered.ingredient.last_price, 0.234375);
    assert.equal(delivered.ingredient.price_status, 'invoice');
    assert.equal(delivered.ingredient.last_ordered_at, deliveryDate);
  });
}

test('missing restaurant timezone blocks shared repricing before ingredient writes', async () => {
  const fixture = createFixture({ operationalTimezone: null });

  await assert.rejects(
    repriceFromInvoices(fixture.db, RESTAURANT_ID, INGREDIENT_ID),
    { code: 'RESTAURANT_TIMEZONE_REQUIRED' }
  );

  assert.deepEqual(fixture.writes, []);
});