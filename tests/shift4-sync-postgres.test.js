import test, {
  before,
  beforeEach,
  after,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';

let db;

before(async () => {
  db = new PGlite();

  await db.exec(readFileSync(
    new URL('./fixtures/shift4-schema.sql', import.meta.url),
    'utf8'
  ));

  const dir = new URL(
    '../supabase/migrations/',
    import.meta.url
  );

  const migration = readdirSync(dir).find(
    (s) => s.endsWith('_atomic_shift4_sync.sql')
  );

  await db.exec(readFileSync(
    new URL(migration, dir),
    'utf8'
  ));
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`
    RESET ROLE;
    DELETE FROM pos_ticket_lines;
    DELETE FROM pos_tickets;
    DELETE FROM pos_sales;
    DELETE FROM pos_connections;
  `);

  await db.query(`
    INSERT INTO pos_connections(
      id,restaurant_id,provider,status,
      shift4_location_id,access_token
    )
    VALUES ($1,$2,'shift4','connected',10,'old-access')
  `, [CID, RID]);

  await db.query(`
    INSERT INTO pos_sales(
      restaurant_id,pos_system,sale_date,item_name,revenue
    )
    VALUES ($1,'shift4','2026-11-16','Original',5)
  `, [RID]);
});

const sale = {
  sale_date: '2026-11-16',
  item_name: 'Burger',
  quantity_sold: 2,
  revenue: 20,
  voids: 0,
  comps: 0,
  refunds: 0,
};

const ticket = {
  external_ticket_id: 'ticket-1',
  business_date: '2026-11-16',
  total_items: 20,
  total_tax: 2,
  total_grand: 22,
  raw: { posRef: 'ticket-1' },
  lines: [{
    external_line_id: 'line-1',
    item_name: 'Burger',
    quantity: 2,
    modifiers: [],
    discounts: [],
    special_requests: [],
  }],
};

async function save(overrides = {}) {
  const p = {
    connection: CID,
    restaurant: RID,
    location: 10,
    token: 'old-access',
    from: '2026-11-16',
    to: '2026-11-16',
    started: '2030-01-01T00:00:00Z',
    sales: [sale],
    tickets: [ticket],
    ...overrides,
  };

  const { rows } = await db.query(`
    SELECT public.save_shift4_sync(
      $1,$2,$3,$4,$5,$6,$7,$8,$9
    ) AS result
  `, [
    p.connection,
    p.restaurant,
    p.location,
    p.token,
    p.from,
    p.to,
    p.started,
    JSON.stringify(p.sales),
    JSON.stringify(p.tickets),
  ]);

  return rows[0].result;
}

async function snapshot() {
  const sales = (await db.query(`
    SELECT item_name,revenue
    FROM pos_sales
    ORDER BY item_name
  `)).rows;

  const tickets = (await db.query(`
    SELECT external_ticket_id,total_grand
    FROM pos_tickets
  `)).rows;

  const lines = (await db.query(`
    SELECT external_line_id,quantity
    FROM pos_ticket_lines
  `)).rows;

  return { sales, tickets, lines };
}

test('actual transaction saves sales, ticket totals and lines; rerunning does not duplicate', async () => {
  assert.deepEqual(
    await save(),
    { saved: true, tickets: 1, lines: 1 }
  );

  assert.deepEqual(
    await save(),
    { saved: true, tickets: 1, lines: 1 }
  );

  const state = await snapshot();

  assert.equal(state.sales.length, 1);
  assert.equal(state.tickets.length, 1);
  assert.equal(state.lines.length, 1);
  assert.equal(Number(state.tickets[0].total_grand), 22);
});

test('disconnect winning before persistence leaves every saved record untouched', async () => {
  const before = await snapshot();

  await db.exec(`
    UPDATE pos_connections
    SET status='disconnected',
        shift4_location_id=NULL,
        access_token=NULL
  `);

  assert.equal((await save()).saved, false);
  assert.deepEqual(await snapshot(), before);

  assert.equal(
    (await db.query(
      'SELECT status FROM pos_connections'
    )).rows[0].status,
    'disconnected'
  );
});

test('an in-progress disconnect also prevents persistence', async () => {
  await db.exec(`
    UPDATE pos_connections
    SET status='disconnecting'
  `);

  assert.equal((await save()).saved, false);
});

test('a new authorization or changed location rejects an older pull', async () => {
  await db.exec(`
    UPDATE pos_connections
    SET access_token='new-access'
  `);

  assert.equal((await save()).saved, false);

  assert.equal(
    (await save({
      token: 'new-access',
      location: 11,
    })).saved,
    false
  );
});

test('a later completed sync prevents an earlier pull from overwriting it', async () => {
  await db.exec(`
    UPDATE pos_connections
    SET last_synced_at='2026-11-16T18:00:00Z'
  `);

  assert.equal(
    (await save({
      started: '2026-11-16T17:00:00Z',
    })).saved,
    false
  );
});

test('failed line insertion rolls back the sales replacement and ticket changes', async () => {
  await save();
  const before = await snapshot();

  await assert.rejects(
    save({
      sales: [{ ...sale, revenue: 99 }],
      tickets: [{
        ...ticket,
        total_grand: 999,
        lines: [ticket.lines[0], ticket.lines[0]],
      }],
    }),
    /duplicate key/i
  );

  assert.deepEqual(await snapshot(), before);
});

test('replacement preserves CSV uploads, other providers and other restaurants', async () => {
  const foreign = '33333333-3333-4333-8333-333333333333';

  await db.query(`
    INSERT INTO pos_sales(
      restaurant_id,pos_system,sale_date,
      item_name,upload_session_id
    )
    VALUES
      ($1,'shift4','2026-11-16','CSV',$2),
      ($1,'square','2026-11-16','Square',NULL),
      ($2,'shift4','2026-11-16','Foreign',NULL),
      ($1,'shift4','2026-11-15','Older',NULL)
  `, [RID, foreign]);

  await save();

  assert.deepEqual(
    (await snapshot()).sales.map((s) => s.item_name),
    ['Burger', 'CSV', 'Foreign', 'Older', 'Square']
  );
});

test('invalid ranges, out-of-range records and malformed data cannot erase history', async () => {
  const before = await snapshot();

  for (const input of [
    { from: '2026-11-17' },
    { sales: null },
    { tickets: null },
    { sales: [{ ...sale, sale_date: '2026-11-15' }] },
    { tickets: [{ ...ticket, lines: null }] },
  ]) {
    await assert.rejects(save(input));
    assert.deepEqual(await snapshot(), before);
  }
});

test('RPC forces ownership and is inaccessible to anon/authenticated roles', async () => {
  assert.equal(
    (await save({
      restaurant: '33333333-3333-4333-8333-333333333333',
    })).saved,
    false
  );

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(save(), /permission denied/i);
    await db.exec('RESET ROLE');
  }

  await db.exec('SET ROLE service_role');
  assert.equal((await save()).saved, true);
});

async function change(changes, overrides = {}) {
  const p = {
    status: 'connected',
    location: 10,
    access: 'old-access',
    refresh: null,
    ...overrides,
  };

  return (await db.query(`
    SELECT public.update_shift4_connection(
      $1,$2,$3,$4,$5,$6
    ) AS changed
  `, [
    CID,
    p.status,
    p.location,
    p.access,
    p.refresh,
    JSON.stringify(changes),
  ])).rows[0].changed;
}

test('lifecycle RPC atomically compares expected credentials and rejects stale refreshes', async () => {
  assert.equal(
    await change({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    }),
    true
  );

  assert.equal(
    await change({ access_token: 'stale-access' }),
    false
  );

  assert.equal(
    (await db.query(
      'SELECT access_token FROM pos_connections'
    )).rows[0].access_token,
    'new-access'
  );
});

test('lifecycle RPC rejects disconnected-to-connected state without a location', async () => {
  await assert.rejects(
    change({
      status: 'connected',
      shift4_location_id: null,
    }),
    /Invalid Shift4/
  );

  await assert.rejects(
    change({
      restaurant_id: '33333333-3333-4333-8333-333333333333',
    }),
    /Unsupported Shift4/
  );
});

test('lifecycle RPC cannot be called by browser roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);

    await assert.rejects(
      change({ status: 'disconnecting' }),
      /permission denied/i
    );

    await db.exec('RESET ROLE');
  }
});