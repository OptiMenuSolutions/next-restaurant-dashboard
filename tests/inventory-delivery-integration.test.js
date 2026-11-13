import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateInventory,
  loadCurrentInventory,
} from '../lib/currentInventory.js';

const RID = 'inventory-date-restaurant';

const INGREDIENT = {
  id: 'inventory-date-ingredient',
  name: 'Chicken Breast',
  unit: 'oz',
};

function inventoryDatabase({
  invoiceDate = '2026-11-10',
  deliveryDate = '2026-11-02',
  failTable = null,
  operationalTimezone = 'America/New_York',
  storedDeliveryDate = '2000-01-01',
} = {}) {
  const invoice = {
    id: 'invoice-owned',
    restaurant_id: RID,
    date: invoiceDate,
    delivery_date: deliveryDate,
  };

  const foreignInvoice = {
    id: 'invoice-foreign',
    restaurant_id: 'another-restaurant',
    date: '2026-11-01',
    delivery_date: '2026-11-02',
  };

  const stored = {
    id: 'stored-owned',
    restaurant_id: RID,
    stock_source: 'invoice',
    invoice_item_id: 'line-owned',
    invoice_id: invoice.id,
    ingredient_id: INGREDIENT.id,
    ingredient_name: INGREDIENT.name,
    delivery_date: storedDeliveryDate,
    shelf_life: 7,
    unit: 'oz',
    invoiced_qty: 100,
    remaining_qty: 75,
    unit_cost: 0.25,
  };

  const tables = {
    restaurants: [{ id: RID, operational_timezone: operationalTimezone }],
    inventory_count_sessions: [],

    invoices: [invoice, foreignInvoice],

    invoice_items: [
      {
        id: 'line-owned',
        invoice_id: invoice.id,
        ingredient_id: INGREDIENT.id,
        item_name: INGREDIENT.name,
        quantity: 100,
        unit: 'oz',
        unit_cost: 0.25,
        invoices: invoice,
        ingredients: INGREDIENT,
      },
      {
        id: 'line-foreign',
        invoice_id: foreignInvoice.id,
        ingredient_id: 'foreign-ingredient',
        item_name: 'Foreign Spice',
        quantity: 10000,
        unit: 'oz',
        unit_cost: 1,
        invoices: foreignInvoice,
        ingredients: {
          id: 'foreign-ingredient',
          name: 'Foreign Spice',
          unit: 'oz',
        },
      },
    ],

    pos_sales: [{
      id: 'sale-owned',
      restaurant_id: RID,
      sale_date: '2026-11-03',
      item_name: 'Chicken Sandwich',
      quantity_sold: 25,
      refunds: 0,
    }],

    menu_items: [{
      id: 'dish-owned',
      restaurant_id: RID,
      name: 'Chicken Sandwich',
      menu_item_components: [{
        component_ingredients: [{
          quantity: 1,
          unit: 'oz',
          ingredients: INGREDIENT,
        }],
      }],
    }],

    waste_confirmations: [],
    pos_usage_settings: [],

    current_inventory: [
      stored,
      {
        ...stored,
        id: 'stored-future',
        delivery_date: '2999-12-31',
        remaining_qty: 10000,
      },
      {
        ...stored,
        id: 'stored-unknown',
        delivery_date: null,
        shelf_life: null,
        remaining_qty: 10000,
      },
      {
        ...stored,
        id: 'stored-count',
        stock_source: 'count',
        count_line_id: 'physical-count-line',
        invoice_id: null,
        invoice_item_id: null,
        delivery_date: null,
        shelf_life: null,
        invoiced_qty: null,
        remaining_qty: 10,
        unit_cost: null,
      },
      {
        ...stored,
        id: 'stored-foreign',
        restaurant_id: 'another-restaurant',
        remaining_qty: 10000,
      },
    ],
  };

  const valueAt = (row, column) =>
    column.split('.').reduce(
      (value, key) => value?.[key],
      row
    );

  return {
    from(table) {
      assert.ok(
        Object.hasOwn(tables, table),
        `Unexpected table: ${table}`
      );

      let columns = '*';
      const filters = [];

      const result = () => {
        if (table === failTable) {
          return {
            data: null,
            error: {
              message: 'Synthetic reader failure.',
            },
          };
        }

        const data = tables[table]
          .filter(row =>
            filters.every(filter => filter(row))
          )
          .map(row => {
            const projected = structuredClone(row);

            if (!columns.includes('delivery_date')) {
              if (table === 'invoices') {
                delete projected.delivery_date;
              }

              if (table === 'invoice_items') {
                delete projected.invoices.delivery_date;
              }
            }

            return projected;
          });

        return { data, error: null };
      };

      const query = {
        select(value) {
          columns = value;
          return query;
        },

        eq(column, value) {
          filters.push(row =>
            valueAt(row, column) === value
          );
          return query;
        },

        lte(column, value) {
          filters.push(row =>
            valueAt(row, column) != null &&
            valueAt(row, column) <= value
          );
          return query;
        },

        lt(column, value) {
          filters.push(row =>
            valueAt(row, column) != null &&
            valueAt(row, column) < value
          );
          return query;
        },

        in(column, values) {
          filters.push(row =>
            values.includes(valueAt(row, column))
          );
          return query;
        },

        not(column, operator, value) {
          assert.equal(operator, 'is');
          assert.equal(value, null);

          filters.push(row =>
            valueAt(row, column) != null
          );

          return query;
        },

        // Confirmation fixtures are empty here.
        // Existing replay tests cover their statuses.
        or() {
          assert.equal(table, 'waste_confirmations');
          return query;
        },

        order() {
          return query;
        },

        async range(start, end) {
          const response = result();

          return response.error
            ? response
            : {
                data: response.data.slice(start, end + 1),
                error: null,
              };
        },

        async single() {
          const response = result();

          return {
            data: response.data?.[0] || null,
            error: response.error,
          };
        },

        async maybeSingle() {
          const response = result();

          return {
            data: response.data?.[0] || null,
            error: response.error,
          };
        },
      };

      return query;
    },

    async rpc() {
      throw new Error(
        'Unexpected database write or POS RPC.'
      );
    },
  };
}

test(
  'inventory reader includes early delivery despite later invoice date and isolates the tenant',
  async () => {
    const { rows } = await calculateInventory(
      inventoryDatabase(),
      RID,
      '2026-11-05'
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].invoice_item_id, 'line-owned');
    assert.equal(rows[0].remaining_qty, 75);
    assert.equal(rows[0].delivery_date, '2026-11-02');
  }
);

test(
  'inventory reader excludes future delivery even when invoice date is before the cutoff',
  async () => {
    const { rows } = await calculateInventory(
      inventoryDatabase({
        invoiceDate: '2026-11-01',
        deliveryDate: '2026-11-06',
      }),
      RID,
      '2026-11-05'
    );

    assert.deepEqual(rows, []);
  }
);

test(
  'inventory reader uses invoice-date fallback when delivery date is absent',
  async () => {
    const { rows } = await calculateInventory(
      inventoryDatabase({
        invoiceDate: '2026-11-02',
        deliveryDate: null,
      }),
      RID,
      '2026-11-05'
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].remaining_qty, 75);
    assert.equal(rows[0].delivery_date, '2026-11-02');
  }
);

test(
  'inventory reader cannot create stock when both source dates are unknown',
  async () => {
    const { rows } = await calculateInventory(
      inventoryDatabase({
        invoiceDate: null,
        deliveryDate: null,
      }),
      RID,
      '2026-11-05'
    );

    assert.deepEqual(rows, []);
  }
);

test(
  'inventory reader fails explicitly if invoice lines cannot be loaded',
  async () => {
    await assert.rejects(
      calculateInventory(
        inventoryDatabase({
          failTable: 'invoice_items',
        }),
        RID,
        '2026-11-05'
      ),
      /could not load invoice lines/
    );
  }
);

test(
  'stored inventory reader hides future and unknown invoice batches but retains counted stock',
  async () => {
    const rows = await loadCurrentInventory(
      inventoryDatabase(),
      RID
    );

    assert.equal(rows.length, 2);

    assert.equal(
      rows.find(row =>
        row.stockSource === 'invoice'
      ).remainingQty,
      75
    );

    const counted = rows.find(row =>
      row.stockSource === 'count'
    );

    assert.equal(counted.remainingQty, 10);
    assert.equal(counted.ageKnown, false);
    assert.equal(counted.totalValue, null);
  }
);

test('stored inventory waits for the restaurant local delivery day', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-11-12T06:00:00Z'),
  });

  for (const [operationalTimezone, expectedInvoiceRows] of [
    ['America/New_York', 1],
    ['America/Los_Angeles', 0],
  ]) {
    const rows = await loadCurrentInventory(inventoryDatabase({
      operationalTimezone,
      storedDeliveryDate: '2026-11-12',
    }), RID);

    assert.equal(
      rows.filter(row => row.stockSource === 'invoice').length,
      expectedInvoiceRows
    );
    assert.equal(
      rows.find(row => row.stockSource === 'count').remainingQty,
      10
    );
  }
});

test('stored inventory age uses the restaurant local calendar', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-11-12T06:00:00Z'),
  });

  for (const [operationalTimezone, expectedAge] of [
    ['America/New_York', 2],
    ['America/Los_Angeles', 1],
  ]) {
    const rows = await loadCurrentInventory(inventoryDatabase({
      operationalTimezone,
      storedDeliveryDate: '2026-11-10',
    }), RID);
    const purchase = rows.find(row => row.stockSource === 'invoice');

    assert.equal(purchase.daysSinceDelivery, expectedAge);
    assert.equal(purchase.daysLeft, 7 - expectedAge);
  }
});

test('inventory calculations and reads require configured local time', async () => {
  await assert.rejects(
    calculateInventory(
      inventoryDatabase({ operationalTimezone: null }),
      RID,
      '2026-11-05'
    ),
    { code: 'RESTAURANT_TIMEZONE_REQUIRED' }
  );

  await assert.rejects(
    loadCurrentInventory(
      inventoryDatabase({ operationalTimezone: null }),
      RID
    ),
    { code: 'RESTAURANT_TIMEZONE_REQUIRED' }
  );
});