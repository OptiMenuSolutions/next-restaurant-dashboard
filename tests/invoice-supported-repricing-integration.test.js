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
  return {
    id: 'evidence-1',
    invoice_item_id: 'line-1',
    invoice_id: 'invoice-1',
    restaurant_id: RESTAURANT_ID,
    source_type: 'structured_ocr_table',
    validation_status: 'source_table_consistent',
    invalidated_at: null,
    invalidation_reason: null,
    ...overrides,
  };
}

async function runFixture(options, enabled = true) {
  const previous =
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;

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