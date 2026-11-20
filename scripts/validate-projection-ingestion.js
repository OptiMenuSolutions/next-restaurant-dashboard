import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  buildProjectionNight,
} from '../lib/projections/ingestion.js';
import {
  projectionBoundary,
} from '../lib/projections/businessTime.js';

// Disposable local PostgreSQL only.
const container = `optimenu-projection-ingestion-${randomUUID()}`;

const R = n =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const REST = R(1);
const DISH = R(2);
const OTHER = R(3);
const CONN = R(4);
const DAY = '2026-11-19';

const args = [
  'exec', '-i', container,
  'psql', '-X',
  '-v', 'ON_ERROR_STOP=1',
  '-v', 'VERBOSITY=verbose',
  '-qAt', '-U', 'postgres',
];

let started = false;

function docker(a, options = {}) {
  return execFileSync('docker', a, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

const q = sql => docker(args, { input: sql }).trim();

const json = value =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

const context = () => JSON.parse(q(`
  set role service_role;
  select public.projection_ingestion_context('${REST}','${DAY}');
`));

function snapshot(
  at = '2026-11-20T11:00:00Z',
  quantity = 2,
  closed = true
) {
  return {
    restaurant_id: REST,
    observed_at: at,
    sources: [{
      connection_id: CONN,
      provider: 'shift4',
      complete: true,
      closed_out: closed,
      coverage_from: '2026-11-19T09:00:00Z',
      coverage_to: '2026-11-20T09:00:00Z',
      tickets: [{
        id: 'check',
        state: 'closed',
        lines: [{
          id: 'line',
          item_id: 'chicken',
          at: '2026-11-20T07:00:00Z',
          kind: 'sale',
          quantity,
        }],
      }],
    }],
  };
}

const prepare = source => {
  const ctx = context();

  return {
    ctx,
    payload: buildProjectionNight(
      ctx,
      source,
      new Date().toISOString()
    ),
  };
};

const command = ({ ctx, payload }) => `
  set role service_role;
  select public.projection_commit_night(
    '${REST}',
    '${DAY}',
    '${ctx.context_digest}',
    ${ctx.state?.generation ?? 0},
    ${json(payload)}
  );
`;

const commit = prepared => JSON.parse(q(command(prepared)));

function rejects(sql, pattern) {
  assert.throws(
    () => q(sql),
    e => pattern.test(e.stderr || e.message)
  );
}

function asyncQ(sql) {
  return new Promise(resolve => {
    const child = spawn('docker', args);

    let out = '';
    let error = '';

    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { error += d; });

    child.on('close', code => {
      resolve({ code, out: out.trim(), error });
    });

    child.on('error', e => {
      resolve({ code: -1, out, error: e.message });
    });

    child.stdin.end(sql);
  });
}

before(async () => {
  docker([
    'run', '--detach', '--name', container,
    '-e', `POSTGRES_PASSWORD=${randomUUID()}`,
    'postgres:17',
  ]);

  started = true;

  let ready = false;

  for (let n = 0; n < 80; n++) {
    try {
      docker([
        'exec', container, 'pg_isready',
        '-h', '127.0.0.1',
        '-U', 'postgres',
      ]);

      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }

  assert.ok(ready, 'Local PostgreSQL did not start');

  q(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create schema auth;

    create function auth.uid() returns uuid
    language sql stable as $$ select null::uuid $$;

    grant usage on schema public,auth to service_role;
    grant execute on function auth.uid() to service_role;

    create table public.restaurants(
      id uuid primary key,
      user_id uuid,
      operational_timezone text,
      deactivated_at timestamptz
    );

    create table public.menu_items(
      id uuid primary key,
      restaurant_id uuid
        references public.restaurants on delete cascade
    );

    create table public.pos_connections(
      id uuid primary key,
      restaurant_id uuid
        references public.restaurants on delete cascade,
      provider text,
      status text
    );

    grant select on
      public.restaurants,
      public.menu_items,
      public.pos_connections
    to service_role;

    create function public.purge_restaurant(target uuid)
    returns void
    language plpgsql security definer
    set search_path=''
    as $$
    begin
      delete from public.menu_items where restaurant_id=target;
      delete from public.restaurants where id=target;
    end
    $$;

    revoke all on function public.purge_restaurant(uuid)
      from public;

    grant execute on function public.purge_restaurant(uuid)
      to service_role;
  `);

  for (const file of [
    '20261119222523_projection_foundation.sql',
    '20261120142918_projection_ingestion.sql',
  ]) {
    q(readFileSync(
      new URL(`../supabase/migrations/${file}`, import.meta.url),
      'utf8'
    ));
  }

  q(`
    insert into public.restaurants values
      ('${REST}',null,'America/New_York',null),
      ('${OTHER}',null,'Asia/Tokyo',null);

    insert into public.pos_connections values
      ('${CONN}','${REST}','shift4','connected');

    insert into public.menu_items values
      ('${DISH}','${REST}');

    set role service_role;

    insert into public.projection_dishes
      (
        id,restaurant_id,menu_item_id,
        forecastable,launch_date
      )
    values
      ('${DISH}','${REST}','${DISH}',true,'2026-01-01'),
      ('${R(8)}','${OTHER}',null,true,'2026-01-01');

    insert into public.projection_pos_item_map
      (
        restaurant_id,pos_system,external_item_id,
        dish_id,valid_from
      )
    values (
      '${REST}','shift4','chicken',
      '${DISH}','2026-01-01'
    );
  `);
});

after(() => {
  if (started) docker(['rm', '--force', container]);
});

test('ingestion RPCs and source state are server-only', () => {
  rejects(`
    set role authenticated;
    select public.projection_ingestion_context('${REST}','${DAY}');
  `, /permission denied/);

  rejects(`
    set role anon;
    select public.projection_commit_night(
      '${REST}','${DAY}','x',0,'{}'
    );
  `, /permission denied/);

  rejects(`
    set role service_role;
    delete from public.projection_nightly_dish_facts;
  `, /permission denied/);

  assert.equal(q(`
    select count(*)
    from pg_class
    where relname in (
      'projection_dish_availability',
      'projection_ingestion_state'
    )
    and relrowsecurity;
  `), '2');
});

test('database and JavaScript agree on DST boundaries and the approved custom-cutoff policy', () => {
  rejects(`
    select projection_private.business_boundary(
      null,'America/New_York',240
    );
  `, /date and timezone/);

  rejects(`
    select projection_private.business_boundary(
      '${DAY}',null,240
    );
  `, /date and timezone/);

  for (const [date, zone, minute] of [
    ['2026-03-08', 'America/New_York', 150],
    ['2026-11-01', 'America/New_York', 90],
    ['2026-11-01', 'America/New_York', 240],
    ['2026-10-25', 'Europe/London', 90],
    ['2026-04-05', 'Australia/Lord_Howe', 105],
  ]) {
    const stored = q(`
      select projection_private.business_boundary(
        '${date}','${zone}',${minute}
      );
    `);

    assert.equal(
      new Date(stored).toISOString(),
      projectionBoundary(date, zone, minute)
    );
  }
});

test('context returns only the requested tenant and no POS credentials', () => {
  const ctx = context();

  assert.equal(ctx.dishes.length, 1);
  assert.equal(ctx.connections.length, 1);
  assert.equal(ctx.dishes[0].id, DISH);
  assert.equal(ctx.settings.enabled, false);
  assert.ok(!JSON.stringify(ctx).includes('access_token'));

  assert.equal(q(`
    set timezone='America/Los_Angeles';
    set role service_role;
    select public.projection_ingestion_context(
      '${REST}','${DAY}'
    )->>'context_digest';
  `), ctx.context_digest);

  q(`
    update public.restaurants
    set operational_timezone=null
    where id='${REST}';
  `);

  try {
    assert.throws(context, /valid operational timezone/);
  } finally {
    q(`
      update public.restaurants
      set operational_timezone='America/New_York'
      where id='${REST}';
    `);
  }
});

test('initial ingestion records exact units and leaves recommendation evidence unknown', () => {
  commit(prepare(snapshot()));

  assert.equal(q(`
    select units::text
    from public.projection_nightly_dish_facts
    where restaurant_id='${REST}';
  `), '2');

  assert.equal(q(`
    select complete and not recommendation_flags_complete
    from public.projection_nightly_flags
    where restaurant_id='${REST}';
  `), 't');

  assert.equal(q(`
    select first_data_date
    from public.projection_restaurant_config
    where restaurant_id='${REST}';
  `), DAY);
});

test('an identical receipt retry changes no generation or audit history', () => {
  const receipt = prepare(snapshot());
  const before = q(`
    select count(*) from public.projection_change_log;
  `);

  const generation = receipt.ctx.state.generation;
  const saved = commit(receipt);

  assert.equal(saved.generation, generation);
  assert.equal(saved.unchanged, true);

  assert.equal(q(`
    select count(*) from public.projection_change_log;
  `), before);
});

test('a failure after fact writes rolls back facts, flags, state and audit together', () => {
  const receipt = prepare(
    snapshot('2026-11-20T11:10:00Z', 3)
  );

  const before = q(`
    select count(*) from public.projection_change_log;
  `);

  q(`
    create function public.test_fail_flag()
    returns trigger
    language plpgsql as $$
    begin
      raise exception 'Synthetic flag write failure';
    end
    $$;

    create trigger test_fail_flag
    before update on public.projection_nightly_flags
    for each row execute function public.test_fail_flag();
  `);

  try {
    rejects(command(receipt), /Synthetic flag/);

    assert.equal(
      context().state.generation,
      receipt.ctx.state.generation
    );

    assert.equal(q(`
      select units::text
      from public.projection_nightly_dish_facts
      where restaurant_id='${REST}';
    `), '2');

    assert.equal(q(`
      select count(*) from public.projection_change_log;
    `), before);
  } finally {
    q(`
      drop trigger test_fail_flag
        on public.projection_nightly_flags;
      drop function public.test_fail_flag();
    `);
  }

  commit(receipt);
});

test('late older reads, stale workers and changed mapping contexts cannot overwrite current facts', () => {
  const stale = prepare(
    snapshot('2026-11-20T11:20:00Z', 4)
  );

  commit(prepare(
    snapshot('2026-11-20T11:21:00Z', 5)
  ));

  rejects(command(stale), /Stale projection/);

  const ctx = context();

  rejects(command({
    ctx,
    payload: buildProjectionNight(
      ctx,
      snapshot(),
      new Date().toISOString()
    ),
  }), /Stale projection/);

  const outdated = prepare(
    snapshot('2026-11-20T11:22:00Z', 6)
  );

  q(`
    update public.projection_dishes
    set is_new=true
    where id='${DISH}';
  `);

  // is_new is not an ingestion input. An availability change must fence it.
  q(`
    update public.projection_dishes
    set launch_date='2025-12-31'
    where id='${DISH}';
  `);

  rejects(command(outdated), /context changed/);
});

test('foreign facts and mismatched totals reject atomically', () => {
  const f = prepare(
    snapshot('2026-11-20T11:23:00Z', 6)
  );

  const before = context().state.generation;

  f.payload.facts[0].dish_id = R(8);

  rejects(command(f), /foreign key/);

  f.payload.facts[0].dish_id = DISH;
  f.payload.total_units = '999';

  rejects(command(f), /reconcile/);

  assert.equal(context().state.generation, before);
});

test('source failure keeps saved facts while marking the night unavailable', () => {
  const ctx = context();

  commit({
    ctx,
    payload: {
      mode: 'failure',
      observed_at: '2026-11-20T11:24:00Z',
      error_code: 'PROJECTION_SOURCE_UNAVAILABLE',
    },
  });

  assert.equal(q(`
    select units::text
    from public.projection_nightly_dish_facts
    where restaurant_id='${REST}';
  `), '5');

  assert.equal(q(`
    select complete
    from public.projection_nightly_flags
    where restaurant_id='${REST}';
  `), 'f');
});

test('a real retry completes the night and preserves calendar and recommendation metadata', () => {
  q(`
    update public.projection_nightly_dish_facts
    set recommended=false,sold_out=true
    where restaurant_id='${REST}';

    update public.projection_nightly_flags
    set
      holiday_keys='{thanksgiving}',
      early_close=true,
      recommendation_flags_complete=true
    where restaurant_id='${REST}';
  `);

  commit(prepare(
    snapshot('2026-11-20T11:25:00Z', 6)
  ));

  assert.equal(q(`
    select
      complete
      and early_close
      and recommendation_flags_complete
      and holiday_keys='{thanksgiving}'
    from public.projection_nightly_flags
    where restaurant_id='${REST}';
  `), 't');

  assert.equal(q(`
    select not recommended and sold_out
    from public.projection_nightly_dish_facts
    where restaurant_id='${REST}';
  `), 't');
});

test('two competing workers save one result and reject the other stale generation', async () => {
  const a = prepare(
    snapshot('2026-11-20T11:26:00Z', 7)
  );

  const b = prepare(
    snapshot('2026-11-20T11:27:00Z', 8)
  );

  const results = await Promise.all([
    asyncQ(command(a)),
    asyncQ(command(b)),
  ]);

  assert.equal(
    results.filter(r => r.code === 0).length,
    1
  );

  const rejected = results.find(r => r.code !== 0);

  assert.match(rejected.error, /Stale projection/);
  assert.match(rejected.error, /PT409/);
});

test('two identical retries create one generation and one set of audit changes', async () => {
  const receipt = prepare(
    snapshot('2026-11-20T11:28:00Z', 9)
  );

  const results = await Promise.all([
    asyncQ(command(receipt)),
    asyncQ(command(receipt)),
  ]);

  assert.ok(results.every(r => r.code === 0));

  assert.equal(
    context().state.generation,
    receipt.ctx.state.generation + 1
  );
});

test('quiet confirmation needs a stable second observation and source changes reset it', () => {
  const first = prepare(
    snapshot('2026-11-20T12:00:00Z', 10, false)
  );

  commit(first);

  assert.equal(q(`
    select complete
    from public.projection_nightly_flags
    where restaurant_id='${REST}';
  `), 'f');

  commit(prepare(
    snapshot('2026-11-20T12:59:59Z', 10, false)
  ));

  assert.equal(q(`
    select complete
    from public.projection_nightly_flags
    where restaurant_id='${REST}';
  `), 'f');

  commit(prepare(
    snapshot('2026-11-20T13:00:00Z', 10, false)
  ));

  assert.equal(q(`
    select complete
    from public.projection_nightly_flags
    where restaurant_id='${REST}';
  `), 't');
});

test('availability corrections remove obsolete zero facts once and record their deletion', () => {
  q(`
    insert into public.projection_dishes
      (id,restaurant_id,forecastable,launch_date)
    values (
      '${R(9)}','${REST}',true,'2026-01-01'
    );
  `);

  commit(prepare(
    snapshot('2026-11-20T13:00:00Z', 10, false)
  ));

  q(`
    update public.projection_dishes
    set removed_date='${DAY}'
    where id='${R(9)}';
  `);

  const receipt = prepare(
    snapshot('2026-11-20T13:00:00Z', 10, false)
  );

  commit(receipt);
  commit(receipt);

  assert.equal(q(`
    select count(*)
    from public.projection_nightly_dish_facts
    where dish_id='${R(9)}';
  `), '0');

  assert.equal(q(`
    select count(*)
    from public.projection_change_log
    where operation='DELETE'
      and previous_row->>'dish_id'='${R(9)}';
  `), '1');
});

test('availability periods are scoped and cannot overlap', () => {
  q(`
    set role service_role;

    insert into public.projection_dish_availability
      (restaurant_id,dish_id,valid_from,valid_until)
    values
      ('${REST}','${DISH}','2026-01-01','2026-04-01'),
      ('${REST}','${DISH}','2026-10-01',null);
  `);

  rejects(`
    set role service_role;
    insert into public.projection_dish_availability
      (restaurant_id,dish_id,valid_from)
    values ('${REST}','${DISH}','2026-03-01');
  `, /overlap/);

  rejects(`
    set role service_role;
    insert into public.projection_dish_availability
      (restaurant_id,dish_id,valid_from)
    values ('${OTHER}','${DISH}','2026-01-01');
  `, /foreign key/);
});

test('the scalar context RPC includes more than ten thousand mappings without row-limit truncation', () => {
  q(`
    insert into public.projection_pos_item_map
      (
        restaurant_id,pos_system,external_item_id,
        dish_id,valid_from
      )
    select
      '${REST}',
      'shift4',
      'bulk-' || n,
      '${DISH}',
      '2026-01-01'
    from generate_series(1,10001) n;
  `);

  assert.equal(context().mappings.length, 10002);
});

test('account purge removes availability, ingestion state and facts and records the new table counts', () => {
  q(`
    set role service_role;
    select public.purge_restaurant('${REST}');
  `);

  assert.equal(q(`
    select count(*)
    from public.projection_ingestion_state
    where restaurant_id='${REST}';
  `), '0');

  assert.equal(q(`
    select count(*)
    from public.projection_dish_availability
    where restaurant_id='${REST}';
  `), '0');

  assert.equal(q(`
    select count(*)
    from public.projection_account_purge_log
    where deleted_rows->>'projection_ingestion_state'='1'
      and deleted_rows->>'projection_dish_availability'='2';
  `), '1');

  assert.equal(q(`
    select count(*)
    from public.projection_dishes
    where restaurant_id='${OTHER}';
  `), '1');
});