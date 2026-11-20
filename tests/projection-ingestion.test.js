import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS } from '../lib/projections/settings.js';
import {
  projectionBoundary,
  projectionBusinessDate,
  projectionNightWindow,
  shiftProjectionDate,
  projectionInstant,
} from '../lib/projections/businessTime.js';
import {
  buildProjectionNight,
  ingestProjectionNight,
} from '../lib/projections/ingestion.js';
import {
  shift4ProjectionSnapshot,
} from '../lib/projections/shift4Source.js';

const R = n =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const REST = R(1);
const DISH = R(2);
const OTHER = R(3);
const CONN = R(4);
const ZONE = 'America/New_York';
const DAY = '2026-11-19';
const AT = '2026-11-20T11:00:00Z';

export function ingestionFixture() {
  const context = {
    restaurant_id: REST,
    business_date: DAY,
    timezone: ZONE,
    settings: { ...PROJECTION_DEFAULTS },
    context_digest: 'a'.repeat(64),
    state: null,
    connections: [{
      id: CONN,
      restaurant_id: REST,
      provider: 'shift4',
      status: 'connected',
    }],
    dishes: [{
      id: DISH,
      restaurant_id: REST,
      forecastable: true,
      launch_date: '2026-01-01',
      removed_date: null,
    }],
    availability: [],
    mappings: [{
      id: R(5),
      restaurant_id: REST,
      pos_system: 'shift4',
      external_item_id: 'chicken',
      dish_id: DISH,
      valid_from: '2026-01-01',
      valid_until: null,
    }],
  };

  const snapshot = {
    restaurant_id: REST,
    observed_at: AT,
    sources: [{
      connection_id: CONN,
      provider: 'shift4',
      complete: true,
      closed_out: true,
      coverage_from: '2026-11-19T09:00:00Z',
      coverage_to: '2026-11-20T09:00:00Z',
      tickets: [{
        id: 'check-1',
        state: 'closed',
        lines: [{
          id: 'line-1',
          item_id: 'chicken',
          at: '2026-11-20T07:00:00Z',
          quantity: '2',
          kind: 'sale',
        }],
      }],
    }],
  };

  return {
    context,
    snapshot,
    run: () => buildProjectionNight(context, snapshot, AT),
  };
}

test('2 a.m. sales belong to the previous restaurant business date', () => {
  assert.equal(
    projectionBusinessDate('2026-11-20T07:00:00Z', ZONE, 240),
    DAY
  );
  assert.equal(
    projectionBusinessDate('2026-11-20T09:00:00Z', ZONE, 240),
    '2026-11-20'
  );
});

test('the same instant can belong to different restaurant dates', () => {
  assert.equal(
    projectionBusinessDate('2027-01-01T08:00:00Z', ZONE, 240),
    '2026-12-31'
  );
  assert.equal(
    projectionBusinessDate(
      '2027-01-01T08:00:00Z',
      'Asia/Tokyo',
      240
    ),
    '2027-01-01'
  );
});

test('UTC calendar arithmetic handles leap days and year boundaries', () => {
  assert.equal(shiftProjectionDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftProjectionDate('2024-02-29', 1), '2024-03-01');
  assert.equal(shiftProjectionDate('2026-12-31', 1), '2027-01-01');
  assert.throws(() => shiftProjectionDate('2026-02-29', 1));
});

test('a default business night can last 23 or 25 hours across DST', () => {
  for (const [date, hours] of [
    ['2026-03-07', 23],
    ['2026-10-31', 25],
  ]) {
    const w = projectionNightWindow(date, ZONE, 240);

    assert.equal(
      (Date.parse(w.to) - Date.parse(w.from)) / 3600000,
      hours
    );
  }
});

test('a repeated cutoff uses its second occurrence and business dates remain monotonic', () => {
  assert.equal(
    projectionBoundary('2026-11-01', ZONE, 90),
    '2026-11-01T06:30:00.000Z'
  );
  assert.equal(
    projectionBusinessDate('2026-11-01T05:45:00Z', ZONE, 90),
    '2026-10-31'
  );
  assert.equal(
    projectionBusinessDate('2026-11-01T06:30:00Z', ZONE, 90),
    '2026-11-01'
  );
});

test('a skipped cutoff uses the first valid time, not the same minutes an hour later', () => {
  assert.equal(
    projectionBoundary('2026-03-08', ZONE, 150),
    '2026-03-08T07:00:00.000Z'
  );
});

test('missing timezone, missing cutoff and invalid timestamps fail visibly', () => {
  assert.throws(
    () => projectionBoundary(DAY, null, 240),
    /time zone/
  );
  assert.throws(
    () => projectionBoundary(DAY, 'Not/AZone', 240),
    /time zone/
  );
  assert.throws(
    () => projectionBoundary(DAY, ZONE, undefined),
    /cutoff/
  );

  for (const at of [
    DAY,
    '2026-02-30T12:00:00Z',
    '2026-11-19T12:00:00',
    '2026-11-19T24:00:00Z',
  ]) {
    assert.throws(() => projectionInstant(at));
  }
});

test('normal sales, comps, refunds and voids reconcile without counting modifiers', () => {
  const f = ingestionFixture();

  f.snapshot.sources[0].tickets[0].lines = [
    {
      id: 's',
      item_id: 'chicken',
      at: '2026-11-20T07:00:00Z',
      kind: 'sale',
      quantity: 8,
      modifiers: [{ quantity: 999 }],
    },
    {
      id: 'c',
      item_id: 'chicken',
      at: '2026-11-20T07:00:00Z',
      kind: 'comp',
      quantity: 2,
    },
    {
      id: 'r',
      item_id: 'chicken',
      at: '2026-11-20T07:00:00Z',
      kind: 'refund',
      quantity: -3,
    },
    {
      id: 'v',
      item_id: 'chicken',
      at: '2026-11-20T07:00:00Z',
      kind: 'void',
      quantity: 9,
    },
  ];

  assert.equal(f.run().total_units, '7');
  assert.equal(f.run().complete, true);
});

test('source decimal quantities retain their precision', () => {
  const f = ingestionFixture();
  const line = f.snapshot.sources[0].tickets[0].lines[0];

  line.quantity = '0.1';
  f.snapshot.sources[0].tickets[0].lines.push({
    ...line,
    id: 'second',
    quantity: '0.2',
  });

  assert.equal(f.run().total_units, '0.3');
});

test('changed POS IDs map to the same canonical dish without splitting its history', () => {
  const f = ingestionFixture();

  f.context.mappings[0].valid_until = DAY;
  f.context.mappings.push({
    ...f.context.mappings[0],
    id: R(6),
    external_item_id: 'new-chicken',
    valid_from: DAY,
    valid_until: null,
  });

  f.snapshot.sources[0].tickets[0].lines[0].item_id = 'new-chicken';

  assert.deepEqual(f.run().facts, [{
    dish_id: DISH,
    units: '2',
  }]);
});

test('known active dishes get zero rows; future and removed dishes get no rows', () => {
  const f = ingestionFixture();

  f.context.dishes.push(
    { ...f.context.dishes[0], id: R(10) },
    {
      ...f.context.dishes[0],
      id: R(11),
      launch_date: '2026-12-01',
    },
    {
      ...f.context.dishes[0],
      id: R(12),
      removed_date: DAY,
    },
    {
      ...f.context.dishes[0],
      id: R(13),
      launch_date: null,
      removed_date: DAY,
    }
  );

  assert.deepEqual(f.run().facts.map(x => x.units), ['2', '0']);
});

test('returning dishes use explicit separate menu seasons', () => {
  const f = ingestionFixture();

  f.context.dishes[0].is_returning = true;
  assert.throws(f.run, /availability history/);

  f.context.availability.push(
    {
      restaurant_id: REST,
      dish_id: DISH,
      valid_from: '2025-11-01',
      valid_until: '2026-02-01',
    },
    {
      restaurant_id: REST,
      dish_id: DISH,
      valid_from: '2026-11-01',
      valid_until: null,
    }
  );

  assert.equal(f.run().facts[0].units, '2');
});

test('explicit combo components replace the parent; a combo without components uses its main dish', () => {
  const f = ingestionFixture();

  f.snapshot.sources[0].tickets[0].lines[0].components = [{
    item_id: 'chicken',
    quantity: 2,
  }];

  assert.equal(f.run().total_units, '4');

  delete f.snapshot.sources[0].tickets[0].lines[0].components;

  assert.equal(f.run().total_units, '2');
});

test('unmapped and nonforecastable items are excluded and unmapped IDs are logged', () => {
  const f = ingestionFixture();
  const line = f.snapshot.sources[0].tickets[0].lines[0];

  f.snapshot.sources[0].tickets[0].lines.push({
    ...line,
    id: 'drink',
    item_id: 'unmapped-drink',
  });

  f.context.dishes.push({
    id: R(15),
    restaurant_id: REST,
    forecastable: false,
  });

  f.context.mappings.push({
    ...f.context.mappings[0],
    id: R(16),
    dish_id: R(15),
    external_item_id: 'mapped-drink',
  });

  f.snapshot.sources[0].tickets[0].lines.push({
    ...line,
    id: 'another-drink',
    item_id: 'mapped-drink',
  });

  f.snapshot.sources[0].tickets[0].lines.push({
    id: 'gift-card',
    at: line.at,
    item_id: null,
    quantity: null,
    kind: 'charge',
    non_sales_revenue: true,
  });

  assert.equal(f.run().total_units, '2');
  assert.equal(
    f.run().diagnostics.unmapped_items[0].item_id,
    'unmapped-drink'
  );
  assert.equal(f.run().diagnostics.unmapped_items.length, 1);
});

test('future events are excluded; negative net quantities and open checks are incomplete', () => {
  const f = ingestionFixture();
  const line = f.snapshot.sources[0].tickets[0].lines[0];

  f.snapshot.sources[0].tickets[0].lines.push({
    ...line,
    id: 'future',
    at: '2026-11-21T02:00:00Z',
  });

  assert.equal(f.run().total_units, '2');
  assert.equal(f.run().diagnostics.future_lines_excluded, 1);

  line.kind = 'refund';
  assert.equal(f.run().complete, false);

  line.kind = 'sale';
  f.snapshot.sources[0].tickets[0].state = 'open';
  assert.equal(f.run().complete, false);
});

test('quiet completion requires two stable observations and the full sync buffer', () => {
  const f = ingestionFixture();

  f.snapshot.sources[0].closed_out = false;

  const first = f.run();
  assert.equal(first.complete, false);

  f.context.state = {
    transaction_digest: first.transaction_digest,
    changed_at: AT,
  };

  f.snapshot.observed_at = '2026-11-20T11:59:59Z';

  assert.equal(
    buildProjectionNight(
      f.context,
      f.snapshot,
      f.snapshot.observed_at
    ).complete,
    false
  );

  f.snapshot.observed_at = '2026-11-20T12:00:00Z';

  assert.equal(
    buildProjectionNight(
      f.context,
      f.snapshot,
      f.snapshot.observed_at
    ).complete,
    true
  );

  f.snapshot.sources[0].tickets[0].lines[0].quantity = 3;

  assert.equal(
    buildProjectionNight(
      f.context,
      f.snapshot,
      f.snapshot.observed_at
    ).complete,
    false
  );
});

test('an earlier stable observation cannot complete a night before cutoff plus buffer', () => {
  const f = ingestionFixture();

  f.snapshot.sources[0].closed_out = false;
  f.snapshot.observed_at = '2026-11-20T08:00:00Z';

  const first = buildProjectionNight(
    f.context,
    f.snapshot,
    f.snapshot.observed_at
  );

  f.context.state = {
    transaction_digest: first.transaction_digest,
    changed_at: f.snapshot.observed_at,
  };

  f.snapshot.observed_at = '2026-11-20T09:59:59Z';

  assert.equal(
    buildProjectionNight(
      f.context,
      f.snapshot,
      f.snapshot.observed_at
    ).complete,
    false
  );

  f.snapshot.observed_at = '2026-11-20T10:00:00Z';

  assert.equal(
    buildProjectionNight(
      f.context,
      f.snapshot,
      f.snapshot.observed_at
    ).complete,
    true
  );
});

test('multiple providers retain separate POS identities and require complete coverage from both', () => {
  const f = ingestionFixture();

  f.context.connections.push({
    id: R(20),
    restaurant_id: REST,
    provider: 'square',
    status: 'connected',
  });

  f.context.mappings.push({
    ...f.context.mappings[0],
    id: R(21),
    pos_system: 'square',
  });

  f.snapshot.sources.push({
    ...structuredClone(f.snapshot.sources[0]),
    connection_id: R(20),
    provider: 'square',
  });

  assert.equal(f.run().total_units, '4');

  f.snapshot.sources[1].complete = false;

  assert.throws(f.run, /coverage/);
});

test('missing sources, partial reads, duplicate rows and foreign tenants never become successful zero nights', () => {
  for (const mutate of [
    f => { f.snapshot.sources = []; },
    f => { f.snapshot.sources[0].complete = false; },
    f => {
      f.snapshot.sources[0].tickets.push(
        f.snapshot.sources[0].tickets[0]
      );
    },
    f => { f.snapshot.restaurant_id = OTHER; },
    f => { f.context.mappings[0].restaurant_id = OTHER; },
  ]) {
    const f = ingestionFixture();
    mutate(f);
    assert.throws(f.run);
  }
});

test('full snapshots beyond ten thousand events are not truncated', () => {
  const f = ingestionFixture();
  const line = f.snapshot.sources[0].tickets[0].lines[0];

  f.snapshot.sources[0].tickets[0].lines = Array.from(
    { length: 10001 },
    (_, i) => ({
      ...line,
      id: `line-${i}`,
      quantity: 1,
    })
  );

  assert.equal(f.run().total_units, '10001');
});

test('the Shift4 adapter preserves native quantities and drops personal and financial fields', () => {
  const snapshot = shift4ProjectionSnapshot({
    restaurantId: REST,
    connectionId: CONN,
    complete: true,
    observedAt: AT,
    coverageFrom: '2026-11-19T09:00:00Z',
    coverageTo: '2026-11-20T09:00:00Z',
    records: {
      tickets: [{
        external_ticket_id: 'check',
        ticket_type: 'closed',
        closed_at: '2026-11-20T07:00:00Z',
        raw: {
          customerName: 'DO_NOT_COPY',
          ticketItems: [{
            posRef: 'line',
            itemRef: 'chicken',
            type: 'sale',
            quantity: 2,
            unitPrice: 999,
          }],
        },
      }],
    },
  });

  assert.equal(
    snapshot.sources[0].tickets[0].lines[0].quantity,
    2
  );
  assert.ok(!JSON.stringify(snapshot).includes('DO_NOT_COPY'));
  assert.ok(!JSON.stringify(snapshot).includes('unitPrice'));
  assert.equal(snapshot.sources[0].closed_out, false);
});

test('an adapter cannot silently bless an incomplete or aggregate-only response', () => {
  assert.throws(
    () => shift4ProjectionSnapshot({ records: { tickets: [] } }),
    /fully read/
  );

  assert.throws(() => shift4ProjectionSnapshot({
    complete: true,
    records: { sales: [] },
  }), /fully read/);

  assert.throws(() => shift4ProjectionSnapshot({
    complete: true,
    records: { sales: [{}], tickets: [] },
  }), /coverage/);
});

test('invalid native quantities and close times cannot turn into zero-sales successes', () => {
  const args = {
    restaurantId: REST,
    connectionId: CONN,
    complete: true,
    observedAt: AT,
    coverageFrom: '2026-11-19T09:00:00Z',
    coverageTo: '2026-11-20T09:00:00Z',
    records: {
      tickets: [{
        external_ticket_id: 'check',
        ticket_type: 'closed',
        closed_at: '2026-11-20T07:00:00Z',
        raw: {
          ticketItems: [{
            posRef: 'line',
            itemRef: 'chicken',
            type: 'sale',
          }],
        },
      }],
    },
  };

  const { context } = ingestionFixture();

  assert.throws(() => buildProjectionNight(
    context,
    shift4ProjectionSnapshot(args),
    AT
  ), /quantity/);

  args.records.tickets[0].closed_at = 'not-a-timestamp';

  assert.throws(
    () => shift4ProjectionSnapshot(args),
    /timestamp/
  );

  args.records.tickets[0].closed_at = '2026-11-20T07:00:00Z';
  args.records.tickets[0].raw.ticketItems[0].itemRef = {};

  assert.throws(
    () => shift4ProjectionSnapshot(args),
    /identifier/
  );
});

test('read failures are recorded as unavailable and rethrown, without sending zero facts', async () => {
  const f = ingestionFixture();
  const calls = [];

  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });

      return {
        data: name === 'projection_ingestion_context'
          ? f.context
          : { generation: 1 },
        error: null,
      };
    },
  };

  await assert.rejects(ingestProjectionNight(db, {
    restaurantId: REST,
    businessDate: DAY,
    readSource: async () => {
      throw new Error('Later provider page failed');
    },
  }), /Later provider page/);

  const payload = calls.at(-1).args.p_payload;

  assert.equal(payload.mode, 'failure');
  assert.equal(payload.facts, undefined);
});

test('invalid context RPC responses fail before reading or publishing POS data', async () => {
  for (const reply of [
    null,
    { data: null, error: null },
    { data: [], error: null },
  ]) {
    await assert.rejects(ingestProjectionNight(
      { rpc: async () => reply },
      {
        restaurantId: REST,
        businessDate: DAY,
        readSource: async () => {
          assert.fail('Source must not be read');
        },
      }
    ), /Invalid projection ingestion response/);
  }
});

test('an ingestion conflict is returned for retry without marking a healthy night unavailable', async () => {
  const f = ingestionFixture();
  const calls = [];

  const db = {
    rpc: async name => {
      calls.push(name);

      return name === 'projection_ingestion_context'
        ? { data: f.context, error: null }
        : {
            data: null,
            error: {
              code: 'PT409',
              message: 'Context changed',
            },
          };
    },
  };

  await assert.rejects(ingestProjectionNight(db, {
    restaurantId: REST,
    businessDate: DAY,
    readSource: async () => f.snapshot,
  }), error => error.code === 'PT409');

  assert.deepEqual(calls, [
    'projection_ingestion_context',
    'projection_commit_night',
  ]);
});