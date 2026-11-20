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

    grant insert, update on public.pos_connections to service_role;

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

  // Seed an already connected source before applying either migration.
  q(`
    insert into public.restaurants values
      ('${REST}',null,'America/New_York',null),
      ('${OTHER}',null,'Asia/Tokyo',null);

    insert into public.pos_connections values
      ('${CONN}','${REST}','shift4','connected');

    insert into public.pos_connections values
      ('${R(31)}','${OTHER}','shift4','error'),
      ('${R(32)}','${OTHER}','square','pending'),
      ('${R(33)}','${OTHER}','clover','disconnected');
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

test('migration backfills connected sources and leaves other statuses unconfigured', () => {
  const rows = JSON.parse(q(`select jsonb_agg(to_jsonb(w))
    from public.projection_pos_source_windows w;`));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].connection_id, CONN);
  assert.equal(rows[0].valid_from, null);
  assert.equal(rows[0].valid_until, null);
});

test('a direct connected insert also opens the first source for legacy installation', () => {
  q(`begin;
    insert into public.restaurants values ('${R(42)}',null,'America/New_York',null);
    set role service_role;
    insert into public.pos_connections values ('${R(43)}','${R(42)}','shift4','connected');
    do $$ begin
      if (select count(*) from public.projection_pos_source_windows
        where restaurant_id='${R(42)}' and connection_id='${R(43)}'
          and valid_from is null and valid_until is null) <> 1 then
        raise exception 'Direct installation did not create its source';
      end if;
    end $$;
    rollback;`);
});

test('first install opens history once; repeated connected saves create no extra audit', () => {
  q(`begin;
    set role service_role;
    insert into public.pos_connections values
      ('${R(40)}','${OTHER}','shift4','pending');
    do $$ begin
      if exists (select 1 from public.projection_pos_source_windows
        where connection_id='${R(40)}') then
        raise exception 'Pending connection opened a source';
      end if;
    end $$;
    update public.pos_connections set status='connected' where id='${R(40)}';
    do $$ declare n bigint; begin
      if (select count(*) from public.projection_pos_source_windows
        where connection_id='${R(40)}' and valid_from is null
          and valid_until is null) <> 1 then
        raise exception 'First install did not open historical coverage';
      end if;
      select count(*) into n from public.projection_change_log;
      update public.pos_connections set status='connected' where id='${R(40)}';
      if (select count(*) from public.projection_change_log) <> n then
        raise exception 'Repeated connect wrote another audit';
      end if;
    end $$;
    rollback;`);
});

test('sync errors and pending reauthorization preserve source membership', () => {
  const before = context().context_digest;
  q(`update public.pos_connections set status='error' where id='${CONN}';`);
  assert.equal(context().context_digest, before);
  q(`update public.pos_connections set status='pending' where id='${CONN}';`);
  assert.equal(context().context_digest, before);
  q(`update public.pos_connections set status='connected' where id='${CONN}';`);
  assert.equal(context().context_digest, before);
});

test('disconnect keeps its business night; retries and same-night reconnects preserve history', () => {
  q(`begin;
    set role service_role;
    update public.pos_connections set status='disconnected' where id='${CONN}';
    do $$ declare
      w public.projection_pos_source_windows;
      day date;
      ctx jsonb;
      n bigint;
    begin
      select * into strict w from public.projection_pos_source_windows
      where connection_id='${CONN}';
      day := (clock_timestamp() at time zone 'America/New_York')::date;
      ctx := public.projection_ingestion_context('${REST}',day);
      if clock_timestamp() < (ctx->>'window_from')::timestamptz then
        day := day - 1;
      end if;
      if w.valid_until is distinct from day + 1 then
        raise exception 'Disconnect did not retain its business night';
      end if;
      if jsonb_array_length(public.projection_ingestion_context(
        '${REST}',day)->'connections') <> 1 then
        raise exception 'Disconnect night lost its source';
      end if;
      if jsonb_array_length(public.projection_ingestion_context(
        '${REST}',day+1)->'connections') <> 0 then
        raise exception 'Source remained active after disconnect';
      end if;
      select count(*) into n from public.projection_change_log;
      update public.pos_connections set status='disconnected' where id='${CONN}';
      if (select count(*) from public.projection_change_log) <> n then
        raise exception 'Disconnect retry changed history';
      end if;
      update public.pos_connections set status='connected' where id='${CONN}';
      if not exists (select 1 from public.projection_pos_source_windows
        where id=w.id and valid_until is null)
        or (select count(*) from public.projection_pos_source_windows
          where connection_id='${CONN}') <> 1 then
        raise exception 'Same-night reconnect duplicated source history';
      end if;
    end $$;
    rollback;`);
});

test('reconnecting after a gap creates a new window without filling the gap', () => {
  q(`begin;
    set role service_role;
    update public.projection_pos_source_windows
      set valid_until='2026-01-02' where connection_id='${CONN}';
    update public.pos_connections set status='disconnected' where id='${CONN}';
    update public.pos_connections set status='connected' where id='${CONN}';
    do $$ begin
      if (select count(*) from public.projection_pos_source_windows
        where connection_id='${CONN}') <> 2 then
        raise exception 'Reconnect did not create a new interval';
      end if;
      if not exists (select 1 from public.projection_pos_source_windows
        where connection_id='${CONN}' and valid_until='2026-01-02') then
        raise exception 'Old interval was overwritten';
      end if;
      if jsonb_array_length(public.projection_ingestion_context(
        '${REST}','2026-01-03')->'connections') <> 0 then
        raise exception 'Reconnect filled the historical gap';
      end if;
    end $$;
    rollback;`);
});

test('a source-window failure rolls back the connection status and its audit', () => {
  const before = q(`select count(*) from public.projection_change_log;`);
  q(`create function public.test_source_window_failure()
    returns trigger language plpgsql as $$ begin
      raise exception 'Synthetic source-window failure';
    end $$;
    create trigger test_source_window_failure
    before update on public.projection_pos_source_windows
    for each row execute function public.test_source_window_failure();`);
  try {
    rejects(`set role service_role;
      update public.pos_connections set status='disconnected' where id='${CONN}';`,
    /Synthetic source-window/);
    assert.equal(q(`select status from public.pos_connections where id='${CONN}';`), 'connected');
    assert.equal(q(`select valid_until is null from public.projection_pos_source_windows
      where connection_id='${CONN}';`), 't');
    assert.equal(q(`select count(*) from public.projection_change_log;`), before);
  } finally {
    q(`drop trigger test_source_window_failure on public.projection_pos_source_windows;
      drop function public.test_source_window_failure();`);
  }
});

test('source dates reject missing timezone and historical connection identities cannot move tenants', () => {
  q(`update public.restaurants set operational_timezone=null where id='${REST}';`);
  try {
    rejects(`set role service_role;
      update public.pos_connections set status='disconnected' where id='${CONN}';`,
    /valid operational timezone/);
    assert.equal(q(`select status from public.pos_connections where id='${CONN}';`), 'connected');
  } finally {
    q(`update public.restaurants set operational_timezone='America/New_York' where id='${REST}';`);
  }
  rejects(`update public.pos_connections set restaurant_id='${OTHER}' where id='${CONN}';`,
    /cannot change identity/);
  assert.equal(q(`select has_function_privilege('service_role',
    'projection_private.sync_pos_source_window()','execute');`), 'f');
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
      'projection_ingestion_state',
      'projection_ingestion_policy_versions',
      'projection_pos_source_windows'
    )
    and relrowsecurity;
  `), '4');
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

test('source failure preserves a confirmed night and its counts with a recheck warning', () => {
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
  `), 't');

  assert.equal(q(`
    select flags#>>'{ingestion,last_recheck_error,error_code}'
    from public.projection_nightly_flags
    where restaurant_id='${REST}';
  `), 'PROJECTION_SOURCE_UNAVAILABLE');
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
      and not (flags->'ingestion' ? 'last_recheck_error')
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

test('source windows scope historical membership independently of POS health', () => {
  const before = context();
  q(`
    update public.pos_connections set status='error' where id='${CONN}';
    insert into public.pos_connections values ('${R(30)}','${REST}','square','disconnected');
    set role service_role;
    insert into public.projection_pos_source_windows
      (restaurant_id,connection_id,provider,valid_from)
    values ('${REST}','${R(30)}','square','2027-01-01');
  `);
  assert.equal(context().connections.length, 1);
  assert.equal(context().context_digest, before.context_digest);
  assert.equal(context().connection_health[CONN], 'error');
  assert.equal(prepare(snapshot('2026-11-20T13:01:00Z', 10)).payload.complete, true);
  const future = JSON.parse(q(`
    set role service_role;
    select public.projection_ingestion_context('${REST}','2027-01-01');
  `));
  assert.equal(future.connections.length, 2);
  rejects(`
    set role service_role;
    insert into public.projection_pos_source_windows
      (restaurant_id,connection_id,provider)
    values ('${OTHER}','${CONN}','shift4');
  `, /another restaurant/);
  rejects(`
    set role service_role;
    insert into public.projection_pos_source_windows
      (restaurant_id,connection_id,provider)
    values ('${REST}','${CONN}','shift4');
  `, /overlap/);
  q(`update public.pos_connections set status='connected' where id='${CONN}';`);
});

test('open food counts finalize after quiet; empty open tickets cannot postpone it', () => {
  const first = snapshot('2026-11-20T14:00:00Z', 12);
  first.sources[0].tickets[0].state = 'open';
  assert.equal(commit(prepare(first)).complete, false);
  const second = structuredClone(first);
  second.observed_at = '2026-11-20T15:00:00Z';
  second.sources[0].tickets.push({ state: 'open', lines: [] });
  assert.equal(commit(prepare(second)).complete, true);
  assert.equal(q(`select units from public.projection_nightly_dish_facts
    where restaurant_id='${REST}';`), '12');
});

test('the database enforces the exact mapping boundary and retains known partial facts', () => {
  const source = snapshot('2026-11-20T15:01:00Z', '0.19');
  const line = source.sources[0].tickets[0].lines[0];
  source.sources[0].tickets[0].lines.push({
    ...line, id: 'unknown', item_id: null, quantity: '0.01',
  });
  assert.equal(commit(prepare(source)).complete, true);
  source.observed_at = '2026-11-20T15:02:00Z';
  source.sources[0].tickets[0].lines[1].quantity = '0.010000000000000001';
  const receipt = prepare(source);
  const forged = structuredClone(receipt);
  forged.payload.complete = true;
  rejects(command(forged), /Completeness evidence/);
  assert.equal(commit(receipt).complete, false);
  assert.equal(q(`select units from public.projection_nightly_dish_facts
    where restaurant_id='${REST}';`), '0.19');
});

test('excluded mappings require no dish, while another tenants dish still rejects', () => {
  q(`set role service_role;
    insert into public.projection_pos_item_map
      (restaurant_id,pos_system,external_item_id,dish_id,excluded,valid_from)
    values ('${REST}','shift4','drink',null,true,'2026-01-01');`);
  rejects(`set role service_role;
    insert into public.projection_pos_item_map
      (restaurant_id,pos_system,external_item_id,dish_id,excluded,valid_from)
    values ('${REST}','shift4','bad-exclusion','${DISH}',true,'2026-01-01');`, /check constraint/);
  rejects(`set role service_role;
    insert into public.projection_pos_item_map
      (restaurant_id,pos_system,external_item_id,dish_id,valid_from)
    values ('${OTHER}','shift4','foreign','${DISH}','2026-01-01');`, /foreign key/);
  const source = snapshot('2026-11-20T15:03:00Z', 2);
  const line = source.sources[0].tickets[0].lines[0];
  source.sources[0].tickets[0].lines.push(
    { ...line, id: 'drink', item_id: 'drink', quantity: 999 },
    { ...line, id: 'refund', kind: 'refund', quantity: -99 }
  );
  assert.equal(commit(prepare(source)).complete, true);
  assert.equal(q(`select total_units from public.projection_nightly_flags
    where restaurant_id='${REST}';`), '2');
});

test('an unconfirmed failed read stays incomplete without creating zero dish facts', () => {
  const previous = '2026-11-18';
  const ctx = JSON.parse(q(`set role service_role;
    select public.projection_ingestion_context('${REST}','${previous}');`));
  const output = q(`begin;
    set role service_role;
    select public.projection_commit_night('${REST}','${previous}',
      '${ctx.context_digest}',0,${json({ mode: 'failure', observed_at: '2026-11-20T15:04:00Z', error_code: 'PROJECTION_MENU_HISTORY_REQUIRED' })});
    select not complete and total_units is null
      and flags#>>'{ingestion,last_recheck_error,error_code}'='PROJECTION_MENU_HISTORY_REQUIRED'
    from public.projection_nightly_flags
    where restaurant_id='${REST}' and business_date='${previous}';
    rollback;`);
  assert.equal(output.split('\n').at(-1), 't');
});

test('ingestion policy versions are tenant-scoped, immutable and fence stale writes', () => {
  const stale = prepare(snapshot('2026-11-20T15:05:00Z', 2));
  const originalSettings = JSON.stringify(stale.ctx.settings);
  q(`set role service_role;
    insert into public.projection_ingestion_policy_versions
      (restaurant_id,effective_at,maximum_unmapped_share)
    values ('${OTHER}','2026-01-01T00:00:00Z',0.2);`);
  assert.equal(context().context_digest, stale.ctx.context_digest);
  q(`set role service_role;
    insert into public.projection_ingestion_policy_versions
      (restaurant_id,effective_at,maximum_unmapped_share)
    values ('${REST}','2026-01-01T00:00:00Z',0.1);`);
  assert.equal(context().ingestion_policy.maximum_unmapped_share, 0.1);
  assert.equal(JSON.stringify(context().settings), originalSettings);
  rejects(command(stale), /context changed/);
  rejects(`set role service_role;
    update public.projection_ingestion_policy_versions set maximum_unmapped_share=0.3;`, /permission denied/);
  rejects(`update public.projection_ingestion_policy_versions
    set maximum_unmapped_share=0.3;`, /append-only/);
  rejects(`set role service_role;
    insert into public.projection_ingestion_policy_versions
      (restaurant_id,effective_at,maximum_unmapped_share)
    values ('${REST}','2026-02-01T00:00:00Z',1.01);`, /check constraint/);
  for (const table of ['projection_pos_source_windows', 'projection_ingestion_policy_versions']) {
    rejects(`set role authenticated; select * from public.${table};`, /permission denied/);
  }
});

test('pooled periods are Monday to Sunday and participant counts are computed', () => {
  q(`begin;
    insert into public.projection_setting_versions(model_major,effective_at,settings)
    select model_major,clock_timestamp()-interval '1 second',
      settings || '{"pooled_benchmarks_enabled":true}'::jsonb
    from public.projection_setting_versions where restaurant_id is null
    order by effective_at desc limit 1;
    insert into public.projection_pool_cohorts
      (cohort_key,concept_type,region_code)
    values ('review-test','full_service','NJ');
    insert into public.restaurants
    select ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      null,'America/New_York',null from generate_series(1,5) n;
    insert into public.projection_pool_permissions
      (restaurant_id,enabled,agreement_permits,agreement_version)
    select id,true,true,'test' from public.restaurants where id::text like '20000000-%';
    insert into public.projection_pool_memberships
      (restaurant_id,cohort_key,eligible)
    select restaurant_id,'review-test',true
    from public.projection_pool_permissions where agreement_version='test';
    insert into public.projection_pooled_totals
      (cohort_key,metric,period_start,period_end,participant_count,statistics)
    values ('review-test','volume','2026-11-02','2026-11-08',999,'{}');
    do $$ begin
      if (select participant_count from public.projection_pooled_totals
        where cohort_key='review-test') <> 5 then
        raise exception 'Count was not derived';
      end if;
      begin
        insert into public.projection_pooled_totals
          (cohort_key,metric,period_start,period_end,participant_count,statistics)
        values ('review-test','bad','2026-11-01','2026-11-07',5,'{}');
        raise exception 'Sunday period accepted';
      exception when check_violation then null;
      end;
    end $$;
    rollback;`);
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
      and deleted_rows->>'projection_dish_availability'='2'
      and deleted_rows->>'projection_pos_source_windows'='2'
      and deleted_rows->>'projection_ingestion_policy_versions'='1';
  `), '1');

  assert.equal(q(`
    select count(*)
    from public.projection_dishes
    where restaurant_id='${OTHER}';
  `), '1');
});