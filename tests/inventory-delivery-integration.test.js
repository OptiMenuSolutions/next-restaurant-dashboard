import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateInventory,
  loadCurrentInventory,
} from '../lib/currentInventory.js';

import { calculateInventoryAsOf } from '../lib/inventoryAsOf.js';

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
  posSales = null,
  posTickets = [],
  posUsageJobs = [],
  confirmations = [],
  onQuery = () => {},
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

    pos_sales: posSales ?? [{
      id: 'sale-owned',
      restaurant_id: RID,
      sale_date: '2026-11-03',
      item_name: 'Chicken Sandwich',
      quantity_sold: 25,
      refunds: 0,
    }],

    pos_tickets: posTickets,
    pos_usage_jobs: posUsageJobs,

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

    waste_confirmations: confirmations,
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
          onQuery(table, 'eq', column, value);
          filters.push(row =>
            valueAt(row, column) === value
          );
          return query;
        },

        lte(column, value) {
          onQuery(table, 'lte', column, value);
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

        or() {
          assert.equal(table, 'waste_confirmations');
          filters.push(row => row.status === 'kept' || (row.status === 'pending' && row.kept_days > 0));
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

const BOUNDARY = '2026-11-05T09:00:00Z';
const EASTERN = 'America/New_York';

function boundaryTicket(id, time, quantity) {
  const closedAt = time === null ? null : `2026-11-05T${time}Z`;
  return {
    id,
    restaurant_id: RID,
    pos_system: 'shift4',
    ticket_type: 'sale',
    business_date: '2026-11-05',
    closed_at: closedAt,
    raw: {
      posRef: id,
      closedAt,
      ticketItems: [{ name: 'Chicken Sandwich', quantity, type: 'sale' }],
    },
  };
}

function boundarySale(id, hour, quantity) {
  return {
    id,
    restaurant_id: RID,
    pos_system: 'shift4',
    upload_session_id: null,
    sale_date: '2026-11-05',
    hour_of_day: hour,
    item_name: 'Chicken Sandwich',
    quantity_sold: quantity,
    refunds: 0,
  };
}

test('as-of inventory includes only tickets closed strictly before the boundary', async () => {
  const lateTicket = {
    ...boundaryTicket('late', '08:58:00', 3),
    synced_at: '2026-11-05T09:20:00Z',
  };
  const db = inventoryDatabase({
    posTickets: [
      boundaryTicket('early', '07:30:00', 5),
      lateTicket,
      boundaryTicket('boundary', '09:00:00', 7),
      boundaryTicket('next', '11:30:00', 11),
    ],
    posSales: [
      boundarySale('early', 2, 5),
      boundarySale('late', 3, 3),
      boundarySale('boundary', 4, 7),
      boundarySale('next', 6, 11),
    ],
  });

  const { rows } = await calculateInventoryAsOf(db, RID, BOUNDARY, EASTERN);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoice_item_id, 'line-owned');
  assert.equal(rows[0].remaining_qty, 92);
});

test('as-of inventory applies only disposal confirmations recorded before the boundary', async () => {
  const db = inventoryDatabase({
    posSales: [],
    confirmations: ['08:59:59', '09:00:00', '09:00:01'].map((time, index) => ({
      id: `disposal-${index}`, restaurant_id: RID, invoice_item_id: 'line-owned',
      status: 'confirmed_wasted', confirmed_at: `2026-11-05T${time}.000Z`,
      presumed_qty: 10, adjustment_qty: 10,
    })),
  });
  const asOf = await calculateInventoryAsOf(db, RID, BOUNDARY, EASTERN);
  assert.equal(asOf.rows[0].remaining_qty, 90);
});

test('as-of and regular inventory produce the same batches when all tickets precede the boundary', async () => {
  const db = inventoryDatabase({
    posTickets: [
      boundaryTicket('early', '07:30:00', 5),
      boundaryTicket('late', '08:58:00', 3),
    ],
    posSales: [boundarySale('early', 2, 5), boundarySale('late', 3, 3)],
  });

  const regular = await calculateInventory(db, RID, '2026-11-05');
  const asOf = await calculateInventoryAsOf(db, RID, BOUNDARY, EASTERN);
  const batches = rows => rows.map(({ computed_at, ...row }) => row);

  assert.equal(asOf.rows.length, 1);
  assert.deepEqual(batches(asOf.rows), batches(regular.rows));
});

test('as-of inventory rejects missing close timestamps and unmatched aggregates', async () => {
  const missingTime = inventoryDatabase({
    posTickets: [boundaryTicket('missing', null, 5)],
    posSales: [boundarySale('missing', 2, 5)],
  });
  await assert.rejects(
    calculateInventoryAsOf(missingTime, RID, BOUNDARY, EASTERN),
    { code: 'POS_CLOSE_TIMESTAMP_REQUIRED' }
  );

  const missingTicket = inventoryDatabase({
    posTickets: [],
    posSales: [boundarySale('missing', 2, 5)],
  });
  await assert.rejects(
    calculateInventoryAsOf(missingTicket, RID, BOUNDARY, EASTERN),
    { code: 'POS_TICKET_COVERAGE_INCOMPLETE' }
  );
});

test('a historical upload still consumes inventory without close timestamps', async () => {
  const db = inventoryDatabase({
    posTickets: [boundaryTicket('early', '07:30:00', 5)],
    posSales: [
      {
        ...boundarySale('historical-upload', 10, 4),
        sale_date: '2026-11-04',
        upload_session_id: 'upload-1',
      },
      boundarySale('early', 2, 5),
    ],
  });

  const { rows } = await calculateInventoryAsOf(db, RID, BOUNDARY, EASTERN);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].remaining_qty, 91);
});

test('an upload on the boundary calendar date requires close timestamps', async () => {
  const db = inventoryDatabase({
    posSales: [{ ...boundarySale('upload', 2, 5), upload_session_id: 'upload-1' }],
  });

  await assert.rejects(
    calculateInventoryAsOf(db, RID, BOUNDARY, EASTERN),
    { code: 'POS_CLOSE_TIMESTAMP_REQUIRED' }
  );
});

test('as-of inventory requires matching Shift4 and restaurant time zones', async () => {
  await assert.rejects(
    calculateInventoryAsOf(inventoryDatabase(), RID, BOUNDARY, 'America/Chicago'),
    { code: 'POS_TIMEZONE_MISMATCH' }
  );
});

test('a year of Shift4 tickets is bounded to one date and replays in under one second', async () => {
  const day = '2026-11-05';
  const last = Date.parse(day);
  const posTickets = [];
  const posSales = [];

  for (let offset = 364; offset >= 0; offset--) {
    const date = new Date(last - offset * 86400000).toISOString().slice(0, 10);
    for (let index = 0; index < 200; index++) {
      const ticket = boundaryTicket(`${date}-${index}`, '07:30:00', 1);
      ticket.business_date = date;
      ticket.closed_at = `${date}T07:30:00Z`;
      ticket.raw.closedAt = ticket.closed_at;
      posTickets.push(ticket);
    }
    posSales.push({ ...boundarySale(date, 2, 200), sale_date: date });
  }

  const dateFilters = [];
  const db = inventoryDatabase({
    posTickets,
    posSales,
    onQuery(table, operator, column, value) {
      if (table === 'pos_tickets' && column === 'business_date') {
        dateFilters.push([operator, value]);
      }
    },
  });

  const started = performance.now();
  await calculateInventoryAsOf(db, RID, BOUNDARY, EASTERN);
  const elapsed = performance.now() - started;

  assert.ok(dateFilters.length > 0);
  assert.ok(dateFilters.every(([operator, date]) => operator === 'eq' && date === day));
  assert.ok(elapsed < 1000, `Boundary replay took ${elapsed.toFixed(1)} ms`);
});

test('as-of inventory rejects a POS rewrite that races the stock calculation', async () => {
  const posUsageJobs = [{
    restaurant_id: RID,
    generation: 1,
    applied_publication_id: 'publication-1',
  }];
  const db = inventoryDatabase({
    posSales: [],
    posUsageJobs,
    onQuery(table) {
      if (table === 'pos_tickets') {
        posUsageJobs[0] = {
          restaurant_id: RID,
          generation: 2,
          applied_publication_id: null,
        };
      }
    },
  });

  await assert.rejects(
    calculateInventoryAsOf(db, RID, BOUNDARY, EASTERN),
    { code: 'POS_USAGE_NOT_APPLIED' }
  );
});