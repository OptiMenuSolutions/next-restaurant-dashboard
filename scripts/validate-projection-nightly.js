// Disposable local PostgreSQL only. Never reads .env or a connected database.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { processProjectionJob, projectionRPC } from '../lib/projections/nightlyWorker.js';
import { buildProjectionRun } from '../lib/projections/nightlyPlan.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';

const container = `optimenu-nightly-${randomUUID()}`;
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REST = id(1), OTHER = id(2), ADMIN = id(3), CONN = id(4);

let started = false;
let DAY, cutoff, forecastJob, raw, plan, token, originalRun;

const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 64 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'],
  ...options,
});

const command = [
  'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
];

const q = sql => docker(command, { input: sql }).trim();

const literal = value => value === null || value === undefined
  ? 'null'
  : typeof value === 'boolean' || typeof value === 'number'
    ? String(value)
    : `'${(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''")}'${typeof value === 'object' ? '::jsonb' : ''}`;

const rejects = (sql, pattern) => assert.throws(
  () => q(sql),
  e => pattern.test(e.stderr || e.message)
);

const db = {
  async rpc(name, args = {}) {
    assert.match(name, /^projection_[a-z_]+$/);

    try {
      const text = q(`set role service_role;
        select public.${name}(${Object.entries(args)
          .map(([key, value]) =>
            `${key}=>${key === 'excluded_dates'
              ? `array[${value.map(literal).join(',')}]::date[]`
              : literal(value)}`
          ).join(',')});`);

      return { data: text ? JSON.parse(text) : null, error: null };
    } catch (e) {
      const text = e.stderr || e.message;
      const match = text.match(/ERROR:\s+([A-Z0-9]{5}):\s+([^\n]+)/);

      return {
        data: null,
        error: { code: match?.[1], message: match?.[2] || text },
      };
    }
  },

  from(table) {
    assert.match(table, /^[a-z_]+$/);
    const conditions = [];
    let limit = '';

    const run = single => {
      try {
        const sql = `select to_jsonb(t) from public.${table} t
          ${conditions.length ? `where ${conditions.join(' and ')}` : ''} ${limit}`;
        const rows = q(`set role service_role;
          select coalesce(jsonb_agg(x),'[]') from (${sql}) v(x);`);
        const values = JSON.parse(rows);

        return { data: single ? values[0] ?? null : values, error: null };
      } catch (e) {
        return { data: null, error: { message: e.stderr || e.message } };
      }
    };

    const builder = {
      select: () => builder,
      eq: (key, value) => {
        assert.match(key, /^[a-z_]+$/);
        conditions.push(`${key}=${literal(value)}`);
        return builder;
      },
      limit: n => {
        limit = `limit ${Number(n)}`;
        return builder;
      },
      single: async () => run(true),
      then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
    };

    return builder;
  },
};

const rpc = (name, args) => projectionRPC(db, name, args);

const countRuns = () => Number(q(`
  select count(*) from public.projection_forecast_runs where restaurant_id='${REST}';
`));

const source = async ctx => ({
  restaurant_id: ctx.restaurant_id,
  observed_at: new Date().toISOString(),
  sources: [{
    connection_id: CONN,
    provider: 'shift4',
    coverage_from: ctx.window_from,
    coverage_to: ctx.window_to,
    complete: true,
    closed_out: false,
    tickets: [{
      id: `ticket:${ctx.business_date}`,
      state: 'closed',
      opened_at: ctx.window_from,
      lines: [0, 1, 2].map(i => ({
        id: `line:${i}`,
        item_id: `p${i}`,
        at: ctx.window_from,
        kind: 'sale',
        quantity: 10,
        non_sales_revenue: false,
      })),
    }],
  }],
});

before(async () => {
  docker([
    'run', '--detach', '--name', container, '--read-only',
    '--tmpfs', '/var/lib/postgresql/data',
    '--tmpfs', '/var/run/postgresql',
    '--tmpfs', '/tmp',
    '-e', `POSTGRES_PASSWORD=${randomUUID()}`,
    'postgres:17',
  ]);
  started = true;

  let ready = false;
  for (let n = 0; n < 160; n++) {
    try {
      docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(ready);

  q(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    grant usage on schema public,auth to service_role;
    grant execute on function auth.uid() to service_role;

    create table public.restaurants(
      id uuid primary key,user_id uuid,operational_timezone text,
      deactivated_at timestamptz,onboarding_completed_at timestamptz,name text
    );
    create table public.profiles(id uuid primary key,role text);
    create table public.menu_items(
      id uuid primary key,restaurant_id uuid references public.restaurants on delete cascade,
      name text,created_at timestamptz not null default clock_timestamp(),archived_at timestamptz
    );
    create table public.pos_connections(
      id uuid primary key,restaurant_id uuid references public.restaurants on delete cascade,
      provider text,status text,shift4_timezone text,shift4_location_id text
    );
    create table public.pos_tickets(
      id uuid primary key,restaurant_id uuid,pos_system text,ticket_type text,
      opened_at timestamptz,closed_at timestamptz
    );
    create table public.pos_ticket_lines(
      id uuid primary key,ticket_id uuid,restaurant_id uuid,item_ref text,
      line_type text,quantity numeric,is_non_sales_revenue boolean,added_at timestamptz
    );
    create table public.ai_recommendations(
      id uuid primary key,restaurant_id uuid,generated_date date,recommendations jsonb
    );
    grant select on all tables in schema public to service_role;

    create function public.purge_restaurant(target uuid) returns void
    language plpgsql security definer set search_path='' as $$begin
      delete from public.menu_items where restaurant_id=target;
      delete from public.pos_connections where restaurant_id=target;
      delete from public.restaurants where id=target;
    end$$;
  `);

  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url));

  for (const suffix of [
    'foundation', 'ingestion', 'calendar', 'dish_lifecycle',
    'holiday_learning', 'outlier_runs', 'nightly_runs', 'nightly_review',
    'benchmarks', 'benchmark_build_fixes', 'snapshot_performance', 'cpi_gap', 'national_census', 'timezone_cache', 'monitor', 'waste_risk_storage',
  ]) {
    const files = names.filter(n => n.endsWith(`_projection_${suffix}.sql`));
    assert.equal(files.length, 1);
    q(readFileSync(new URL(`../supabase/migrations/${files[0]}`, import.meta.url), 'utf8'));
  }

  cutoff = Number(q(`
    select greatest(0,(extract(epoch from clock_timestamp())::bigint/60%1440)::integer-90);
  `));

  q(`
    insert into public.profiles values('${ADMIN}','admin');
    insert into public.restaurants values
      ('${REST}','${ADMIN}','UTC',null,
        ((clock_timestamp() at time zone 'UTC')::date-35)+time '12:00' at time zone 'UTC','Fixture'),
      ('${OTHER}',null,'UTC',null,
        ((clock_timestamp() at time zone 'UTC')::date-35)+time '12:00' at time zone 'UTC','Other');

    insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings)
    values('${REST}',4,clock_timestamp(),
      jsonb_build_object('business_day_cutoff_minutes',${cutoff},'sync_buffer_minutes',0));
  `);

  DAY = JSON.parse(q(`
    select projection_private.run_timing('${REST}',clock_timestamp());
  `)).business_date;

  q(`
    insert into public.projection_restaurant_config(restaurant_id,concept_type,first_data_date) values
      ('${REST}','full_service','${shiftProjectionDate(DAY, -35)}'),
      ('${OTHER}','full_service','${shiftProjectionDate(DAY, -35)}');

    insert into public.pos_connections values('${CONN}','${REST}','shift4','connected','UTC','1');

    insert into public.menu_items(id,restaurant_id,name,created_at) values
      ${[0, 1, 2].map(i =>
        `('${id(10 + i)}','${REST}','Dish ${i}',clock_timestamp()-interval '365 days')`
      ).join(',')};

    update public.projection_dishes set forecastable=true,style_category='Neutral'
      where restaurant_id='${REST}';

    insert into public.projection_pos_item_map(
      restaurant_id,pos_system,external_item_id,dish_id,valid_from
    )
    select restaurant_id,'shift4','p'||(row_number() over(order by menu_item_id)-1)::text,
      id,'${shiftProjectionDate(DAY, -35)}'
    from public.projection_dishes where restaurant_id='${REST}';
  `);
});

after(() => {
  if (started) docker(['rm', '--force', '--volumes', container]);
});

test('new settings append a global version; old versions and calibration keys remain valid', () => {
  assert.equal(q(`
    select count(*) from public.projection_setting_versions where restaurant_id is null;
  `), '5');

  assert.equal(q(`
    select bool_and(projection_private.check_settings(settings,restaurant_id is not null))
    from public.projection_setting_versions;
  `), 't');

  assert.equal(q(`
    select count(distinct projection_private.calibration_key(4,settings))
    from public.projection_setting_versions;
  `), '1');

  assert.equal(q(`
    select projection_private.settings_template()->>'publish_deadline_minutes';
  `), '180');

  for (const n of [0, 60, 1440, 1500, 60.5]) {
    assert.equal(q(`
      select projection_private.check_settings(
        projection_private.settings_template()||'{"publish_deadline_minutes":${n}}'
      );
    `), 'f');
  }
});

test('frontend RPC access and direct archive insertion are blocked', () => {
  for (const role of ['anon', 'authenticated']) {
    rejects(`set role ${role};select public.projection_dispatch();`, /permission denied/);
  }

  rejects(`
    set role service_role;insert into public.projection_forecast_runs default values;
  `, /permission denied/);

  rejects(`
    set role service_role;update public.projection_job_leases set token=gen_random_uuid();
  `, /permission denied/);
});

test('disabled restaurants are skipped and enabled restaurants get an incomplete backfill gate', async () => {
  assert.deepEqual((await rpc('projection_dispatch')).jobs, []);
  assert.equal((await rpc('projection_latest', { rid: REST })).status, 'disabled');

  await rpc('projection_enable', { rid: REST, turn_on: true, actor: ADMIN });

  const dispatched = await rpc('projection_dispatch');
  assert.equal(dispatched.jobs.length, 1);
  const pending = await rpc('projection_latest', { rid: REST });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.stale, false);

  assert.equal(q(`
    select backfill_complete from public.projection_run_state where restaurant_id='${REST}';
  `), 'f');

  forecastJob = q(`
    select id from public.projection_jobs
    where restaurant_id='${REST}' and job_kind='forecast';
  `);

  const claim = await rpc('projection_claim', { jid: forecastJob });
  token = claim.token;
  raw = await rpc('projection_snapshot', { jid: forecastJob, tok: token });
  plan = buildProjectionRun(raw);

  await assert.rejects(() => rpc('projection_publish', {
    jid: forecastJob,
    tok: token,
    snapshot_at: raw.snapshot_at,
    source_digest: raw.context_digest,
    plan,
  }), /BACKFILL_INCOMPLETE/);

  await rpc('projection_checkpoint', {
    jid: forecastJob,
    tok: token,
    stage_name: 'test_release',
    retry_at: new Date().toISOString(),
  });
});

test('real two-phase backfill and the complete worker produce an atomic eight-night forecast', async () => {
  const backfill = q(`
    select id from public.projection_jobs
    where restaurant_id='${REST}' and job_kind='backfill';
  `);

  for (let i = 0; i < 15; i++) {
    const result = await processProjectionJob(db, { job_id: backfill }, source, {
      onError: e => console.error(e),
    });

    assert.equal(result.error, undefined, JSON.stringify(result));
    if (!result.again) break;
  }

  assert.equal(q(`
    select backfill_complete from public.projection_run_state where restaurant_id='${REST}';
  `), 't');

  const result = await processProjectionJob(db, { job_id: forecastJob }, source, {
    onError: e => console.error(e),
  });

  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  originalRun = result.run_id;

  assert.equal(countRuns(), 1);
  assert.equal(q(`
    select count(*) from public.projection_forecast_nights where run_id='${originalRun}';
  `), '8');
  assert.equal(q(`
    select count(*) from public.projection_forecast_dishes where run_id='${originalRun}';
  `), '24');
  assert.equal(q(`
    select expected from public.projection_forecast_nights
    where run_id='${originalRun}' order by target_date limit 1;
  `), '30');

  const retry = await rpc('projection_publish', {
    jid: forecastJob,
    tok: id(999),
    snapshot_at: raw.snapshot_at,
    source_digest: 'wrong',
    plan: {},
  });

  assert.equal(retry.run_id, originalRun);
  assert.equal(countRuns(), 1);
});

test('forced publication is append-only and invalid or incomplete plans roll back', async () => {
  const forced = await rpc('projection_force', {
    rid: REST,
    request_id: id(200),
    actor: ADMIN,
  });
  const claim = await rpc('projection_claim', { jid: forced.job_id });

  token = claim.token;
  raw = await rpc('projection_snapshot', { jid: forced.job_id, tok: token });
  plan = buildProjectionRun(raw);

  const bad = structuredClone(plan);
  bad.nights[7].dishes[0].dish_id = id(999);

  await assert.rejects(() => rpc('projection_publish', {
    jid: forced.job_id,
    tok: token,
    snapshot_at: raw.snapshot_at,
    source_digest: raw.context_digest,
    plan: bad,
  }), /Foreign/);

  assert.equal(countRuns(), 1);

  const saved = await rpc('projection_publish', {
    jid: forced.job_id,
    tok: token,
    snapshot_at: raw.snapshot_at,
    source_digest: raw.context_digest,
    plan,
  });

  assert.equal(saved.status, 'succeeded');
  assert.equal(countRuns(), 2);
  assert.equal(q(`
    select supersedes_id from public.projection_forecast_runs where id='${saved.run_id}';
  `), originalRun);

  rejects(`
    update public.projection_forecast_runs set issued_at=clock_timestamp()
    where id='${originalRun}';
  `, /append-only/);
});

test('source digests and worker leases fence stale publications', async () => {
  const forced = await rpc('projection_force', {
    rid: REST,
    request_id: id(201),
    actor: ADMIN,
  });
  const claim = await rpc('projection_claim', { jid: forced.job_id });

  raw = await rpc('projection_snapshot', { jid: forced.job_id, tok: claim.token });
  plan = buildProjectionRun(raw);

  await assert.rejects(() => rpc('projection_publish', {
    jid: forced.job_id,
    tok: id(999),
    snapshot_at: raw.snapshot_at,
    source_digest: raw.context_digest,
    plan,
  }), /LEASE_CONFLICT/);

  q(`
    update public.projection_nightly_dish_facts set recommended=true
    where restaurant_id='${REST}' and business_date='${shiftProjectionDate(DAY, -1)}';
  `);

  await assert.rejects(() => rpc('projection_publish', {
    jid: forced.job_id,
    tok: claim.token,
    snapshot_at: raw.snapshot_at,
    source_digest: raw.context_digest,
    plan,
  }), /SOURCE_CHANGED/);

  await rpc('projection_checkpoint', {
    jid: forced.job_id,
    tok: claim.token,
    stage_name: 'released',
    done: true,
  });
});

test('an expired lease can be reclaimed while the old token cannot checkpoint', async () => {
  const forced = await rpc('projection_force', {
    rid: REST,
    request_id: id(202),
    actor: ADMIN,
  });

  const first = await rpc('projection_claim', { jid: forced.job_id });
  assert.equal((await rpc('projection_claim', { jid: forced.job_id })).skip, true);

  q(`
    update public.projection_job_leases
    set expires_at=clock_timestamp()-interval '1 second'
    where job_id='${forced.job_id}';
  `);

  const second = await rpc('projection_claim', { jid: forced.job_id });
  assert.notEqual(second.token, first.token);

  await assert.rejects(() => rpc('projection_checkpoint', {
    jid: forced.job_id,
    tok: first.token,
    stage_name: 'old',
    done: true,
  }), /LEASE_CONFLICT/);

  await rpc('projection_checkpoint', {
    jid: forced.job_id,
    tok: second.token,
    stage_name: 'released',
    done: true,
  });
});

test('POS bulk rewrites stay fast even when projection clock/queue helpers fail', () => {
  const ms = Number(q(`begin;
    set local statement_timeout='2s';

    create or replace function projection_private.pos_source_clock(
      p_restaurant_id uuid,p_shift4_timezone text,p_at timestamptz
    ) returns jsonb language plpgsql as $bulk$
    begin raise exception 'Synthetic projection clock failure'; end
    $bulk$;

    create or replace function projection_private.dirty(rid uuid,day date,why text)
    returns void language plpgsql as $bulk$
    begin raise exception 'Synthetic projection queue failure'; end
    $bulk$;

    create temp table perf(started timestamptz);
    insert into perf values(clock_timestamp());

    insert into public.pos_ticket_lines(
      id,ticket_id,restaurant_id,item_ref,line_type,quantity,added_at
    )
    select gen_random_uuid(),'${id(900)}','${REST}','p0','sale',1,clock_timestamp()
      from generate_series(1,2000);

    delete from public.pos_ticket_lines where ticket_id='${id(900)}';

    insert into public.pos_ticket_lines(
      id,ticket_id,restaurant_id,item_ref,line_type,quantity,added_at
    )
    select gen_random_uuid(),'${id(900)}','${REST}','p0','sale',1,clock_timestamp()
      from generate_series(1,2000);

    select extract(epoch from clock_timestamp()-started)*1000 from perf;
    rollback;
  `));

  console.info(`Bulk POS rewrite: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1500, `Bulk rewrite took ${ms}ms`);

  assert.equal(q(`
    select count(*) from pg_trigger where not tgisinternal
      and tgname in ('projection_pos_lines_dirty','projection_pos_tickets_dirty');
  `), '0');
});

test('a narrow mapping change preserves the rest of a long forecast history', () => {
  q(`
    insert into public.projection_nightly_flags(restaurant_id,business_date,complete)
    select '${REST}',d::date,false
    from generate_series(
      '${shiftProjectionDate(DAY, -400)}'::date,
      '${shiftProjectionDate(DAY, -36)}'::date,
      interval '1 day'
    ) d;
  `);

  const before = buildProjectionRun(JSON.parse(q(`
    select projection_private.run_inputs('${REST}','${DAY}',clock_timestamp());
  `)));

  try {
    const dish = q(`
      select id from public.projection_dishes
      where restaurant_id='${REST}' order by id limit 1;
    `);

    q(`
      insert into public.projection_pos_item_map(
        restaurant_id,pos_system,external_item_id,dish_id,valid_from,valid_until
      )
      values(
        '${REST}','shift4','narrow-test','${dish}',
        '${shiftProjectionDate(DAY, -10)}','${shiftProjectionDate(DAY, -8)}'
      );
    `);

    assert.equal(q(`
      select count(*) from public.projection_dirty_nights where restaurant_id='${REST}';
    `), '2');

    assert.equal(q(`
      select projection_private.source_covered('${REST}','${shiftProjectionDate(DAY, -1)}');
    `), 't');

    q(`
      update public.projection_pos_item_map set dish_id=dish_id
      where restaurant_id='${REST}' and external_item_id='narrow-test';
    `);

    assert.equal(q(`
      select max(generation) from public.projection_dirty_nights
      where restaurant_id='${REST}';
    `), '1');

    const after = buildProjectionRun(JSON.parse(q(`
      select projection_private.run_inputs('${REST}','${DAY}',clock_timestamp());
    `)));

    assert.equal(after.nights[0].expected, before.nights[0].expected);
  } finally {
    q(`
      delete from public.projection_pos_item_map
        where restaurant_id='${REST}' and external_item_id='narrow-test';
      delete from public.projection_dirty_nights where restaurant_id='${REST}';
      delete from public.projection_nightly_flags where restaurant_id='${REST}'
        and business_date<'${shiftProjectionDate(DAY, -35)}';
    `);
  }
});

test('calendar versions and holiday answers queue only calendar work without hiding source history', () => {
  assert.equal(q(`begin;
    insert into public.projection_nightly_flags(restaurant_id,business_date)
      values('${REST}','${shiftProjectionDate(DAY, -10)}') on conflict do nothing;

    insert into public.projection_holiday_answer_versions(
      restaurant_id,business_date,revision,answer,actor_id
    )
    values('${REST}','${shiftProjectionDate(DAY, -10)}',1,'open','${ADMIN}');

    select count(*)=1 and bool_and(not requires_source)
      from public.projection_dirty_nights where restaurant_id='${REST}';
    rollback;
  `), 't');

  assert.equal(q(`begin;
    insert into public.projection_nightly_flags(restaurant_id,business_date)
    select '${REST}',d::date
    from generate_series(
      '${shiftProjectionDate(DAY, -2)}'::date,'${DAY}'::date,interval '1 day'
    ) d on conflict do nothing;

    insert into public.projection_run_state(
      restaurant_id,backfill_from,backfill_until,cursor_date
    )
    values(
      '${REST}','${shiftProjectionDate(DAY, -35)}',
      '${shiftProjectionDate(DAY, -1)}','${shiftProjectionDate(DAY, -35)}'
    ) on conflict do nothing;

    insert into public.projection_calendar_versions(
      restaurant_id,revision,effective_from,settings,actor_id
    )
    values(
      '${REST}',1,'${shiftProjectionDate(DAY, -2)}',
      projection_private.calendar_context(
        '${REST}','${DAY}','${DAY}',clock_timestamp()
      )->'versions'->0->'settings',
      '${ADMIN}'
    );

    insert into public.projection_jobs(
      id,restaurant_id,business_date,model_major,job_kind
    )
    values('${id(901)}','${REST}','${DAY}',4,'maintenance');

    insert into public.projection_job_leases
    values('${REST}','${id(901)}','${id(902)}',clock_timestamp()+interval '7 minutes');

    select count(*)=(
      select count(*) from public.projection_nightly_flags f
      where f.restaurant_id='${REST}'
        and f.business_date>='${shiftProjectionDate(DAY, -2)}'
    )
    and bool_and(not requires_source)
    and bool_and(projection_private.source_covered(restaurant_id,business_date))
    and jsonb_array_length(
      public.projection_work('${id(901)}','${id(902)}')->'dates'
    )=0
    from public.projection_dirty_nights where restaurant_id='${REST}';
    rollback;
  `), 't');

  assert.equal(q(`begin;
    update public.projection_pos_source_windows
      set valid_until='${shiftProjectionDate(DAY, 1)}'
      where restaurant_id='${REST}';
    select count(*) from public.projection_dirty_nights where restaurant_id='${REST}';
    rollback;
  `), '0');
});

test('archived dish confidence retains dish-specific evidence and range labels', () => {
  assert.equal(q(`
    select bool_and(d.confidence<>n.confidence and d.confidence like '%clean nights%')
    from public.projection_forecast_dishes d
    join public.projection_forecast_nights n using(restaurant_id,run_id,target_date)
    where d.restaurant_id='${REST}';
  `), 't');
});

test('a source outage publishes an older complete cutoff without changing saved completeness', async () => {
  const t = JSON.parse(q(`
    select projection_private.run_timing('${REST}',clock_timestamp());
  `));
  const elapsed = Math.floor((Date.now() - Date.parse(t.starts_at)) / 60000);

  q(`
    insert into public.projection_setting_versions(
      restaurant_id,model_major,effective_at,settings
    )
    values('${REST}',4,clock_timestamp(),jsonb_build_object(
      'business_day_cutoff_minutes',${cutoff},
      'sync_buffer_minutes',0,
      'publish_deadline_minutes',${elapsed + 15}
    ));
  `);

  const forced = await rpc('projection_force', {
    rid: REST,
    request_id: id(211),
    actor: ADMIN,
  });

  const r = await processProjectionJob(db, { job_id: forced.job_id }, async () => {
    throw Object.assign(new Error('Synthetic Shift4 outage'), {
      code: 'PROJECTION_SOURCE_UNAVAILABLE',
      kind: 'source',
    });
  }, { onError: e => console.error(e) });

  assert.equal(r.status, 'succeeded', JSON.stringify(r));

  assert.equal(q(`
    select source_through from public.projection_forecast_runs where id='${r.run_id}';
  `), shiftProjectionDate(DAY, -2));

  assert.equal(q(`
    select complete from public.projection_nightly_flags
    where restaurant_id='${REST}' and business_date='${shiftProjectionDate(DAY, -1)}';
  `), 't');

  assert.equal(q(`
    select trace->>'source_cutoff_status'
    from public.projection_forecast_runs where id='${r.run_id}';
  `), 'older_complete_history');
});

test('a quiet wait beyond the deadline publishes the older complete cutoff', async () => {
  const forced = await rpc('projection_force', {
    rid: REST,
    request_id: id(212),
    actor: ADMIN,
  });

  const wrapped = {
    ...db,
    rpc: async (name, args) => {
      const reply = await db.rpc(name, args);

      if (
        name === 'projection_ack_night' &&
        args.day === shiftProjectionDate(DAY, -1) &&
        reply.data
      ) {
        reply.data.quiet_ready_at = new Date(Date.now() + 86400000).toISOString();
      }

      return reply;
    },
  };

  const r = await processProjectionJob(
    wrapped,
    { job_id: forced.job_id },
    source,
    { onError: e => console.error(e) }
  );

  assert.equal(r.status, 'succeeded', JSON.stringify(r));
  assert.equal(q(`
    select source_through from public.projection_forecast_runs where id='${r.run_id}';
  `), shiftProjectionDate(DAY, -2));
});

test('disabling a restaurant mid-run records disabled and publishes nothing', async () => {
  const forced = await rpc('projection_force', {
    rid: REST,
    request_id: id(213),
    actor: ADMIN,
  });
  const claim = await rpc('projection_claim', { jid: forced.job_id });
  const snapshot = await rpc('projection_snapshot', {
    jid: forced.job_id,
    tok: claim.token,
  });

  const nextPlan = buildProjectionRun(snapshot);
  const count = countRuns();

  await rpc('projection_enable', { rid: REST, turn_on: false, actor: ADMIN });

  try {
    const r = await rpc('projection_publish', {
      jid: forced.job_id,
      tok: claim.token,
      snapshot_at: snapshot.snapshot_at,
      source_digest: snapshot.context_digest,
      plan: nextPlan,
    });

    assert.equal(r.status, 'disabled');
    assert.equal(countRuns(), count);
    assert.equal((await rpc('projection_latest', { rid: REST })).status, 'disabled');
  } finally {
    await rpc('projection_enable', { rid: REST, turn_on: true, actor: ADMIN });
  }
});

test('late day-of jobs and an outage spanning a business day are missed without backdated forecasts', async () => {
  const yesterday = shiftProjectionDate(DAY, -1);

  q(`
    insert into public.projection_jobs(restaurant_id,business_date,model_major,job_kind)
    values('${REST}','${yesterday}',4,'forecast');
  `);

  await rpc('projection_dispatch');

  assert.equal(q(`
    select status from public.projection_jobs where restaurant_id='${REST}'
    and business_date='${yesterday}' and job_kind='forecast';
  `), 'missed');

  assert.equal(q(`
    select count(*) from public.projection_forecast_runs where run_date='${yesterday}';
  `), '0');
});

test('publication waiting on the settings lock cannot issue after its deadline', async () => {
  if (new Date().getUTCSeconds() > 54) {
    await delay((61 - new Date().getUTCSeconds()) * 1000);
  }

  const minute = Number(q(`
    select (extract(epoch from clock_timestamp())::bigint/60%1440)::integer;
  `));

  q(`
    insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings)
    values('${REST}',4,clock_timestamp(),
      jsonb_build_object(
        'business_day_cutoff_minutes',${minute},
        'sync_buffer_minutes',0,
        'publish_deadline_minutes',1
      ));
  `);

  const forced = await rpc('projection_force', {
    rid: REST,
    request_id: id(204),
    actor: ADMIN,
  });
  const claim = await rpc('projection_claim', { jid: forced.job_id });
  const snapshot = await rpc('projection_snapshot', {
    jid: forced.job_id,
    tok: claim.token,
  });

  const nextPlan = buildProjectionRun(snapshot);
  const beforeCount = countRuns();
  const deadline = Date.parse(snapshot.timing.deadline_at);
  const seconds = Math.max(1, (deadline - Date.now()) / 1000 + 1.2);
  const locker = spawn('docker', command, { stdio: ['pipe', 'pipe', 'pipe'] });

  const locked = new Promise((resolve, reject) => {
    let out = '';
    locker.stdout.on('data', b => {
      out += b;
      if (out.includes('LOCKED')) resolve();
    });
    locker.on('error', reject);
    locker.on('close', () => {
      if (!out.includes('LOCKED')) reject(new Error('Settings lock was not acquired'));
    });
  });

  const released = new Promise((resolve, reject) => {
    locker.on('error', reject);
    locker.on('close', n =>
      n === 0 ? resolve() : reject(new Error('Settings locker failed'))
    );
  });

  locker.stdin.end(`
    begin;
    select pg_advisory_xact_lock(hashtextextended('optimenu:projection-settings:4',0));
    \\echo LOCKED
    select pg_sleep(${seconds});
    commit;
  `);

  await locked;

  const result = await rpc('projection_publish', {
    jid: forced.job_id,
    tok: claim.token,
    snapshot_at: snapshot.snapshot_at,
    source_digest: snapshot.context_digest,
    plan: nextPlan,
  });

  await released;
  assert.equal(result.status, 'missed');
  assert.equal(result.code, 'PROJECTION_PUBLISH_DEADLINE');
  assert.equal(countRuns(), beforeCount);
});

test('a daylight-saving short business day cannot have a deadline past its actual end', () => {
  q(`
    update public.restaurants set operational_timezone='America/New_York'
    where id='${OTHER}';

    insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings)
    values('${OTHER}',4,clock_timestamp(),
      '{"business_day_cutoff_minutes":240,"sync_buffer_minutes":60,"publish_deadline_minutes":1439}');
  `);

  rejects(`
    select projection_private.run_timing('${OTHER}','2027-03-13T12:00:00Z');
  `, /DEADLINE_PAST_BUSINESS_DAY/);
});

test('late forced reruns reject and the archive trigger checks the actual issuance time', async () => {
  q(`
    insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings)
    values('${REST}',4,clock_timestamp(),
      jsonb_build_object(
        'business_day_cutoff_minutes',${cutoff},
        'sync_buffer_minutes',0,
        'publish_deadline_minutes',1
      ));
  `);

  await assert.rejects(() => rpc('projection_force', {
    rid: REST,
    request_id: id(203),
    actor: ADMIN,
  }), /FORCE_DEADLINE/);

  rejects(`
    select set_config('optimenu.projection_publish','on',false);
    insert into public.projection_forecast_runs(
      restaurant_id,run_date,model_major,global_version_id,restaurant_version_id,
      settings_snapshot,settings_digest,calibration_key,source_through,trace
    )
    select '${REST}','${DAY}',4,
      (t->'global_version'->>'id')::uuid,
      (t->'restaurant_version'->>'id')::uuid,
      t->'settings','${'a'.repeat(64)}',
      projection_private.calibration_key(4,t->'settings'),
      '${shiftProjectionDate(DAY, -1)}','{}'
    from (select projection_private.run_timing('${REST}',clock_timestamp()) t) v;
  `, /PUBLISH_DEADLINE/);

  assert.equal(countRuns(), 4);
});

test('purge removes jobs, leases, state and dirty nights, and preserves the other restaurant', () => {
  q(`set role service_role;select public.purge_restaurant('${REST}');`);

  for (const table of [
    'projection_jobs',
    'projection_job_leases',
    'projection_run_state',
    'projection_dirty_nights',
    'projection_forecast_runs',
  ]) {
    assert.equal(q(`
      select count(*) from public.${table} where restaurant_id='${REST}';
    `), '0');
  }

  assert.equal(q(`
    select count(*) from public.restaurants where id='${OTHER}';
  `), '1');

  assert.ok(Number(q(`
    select (deleted_rows->>'projection_jobs')::integer
    from public.projection_account_purge_log order by purged_at desc limit 1;
  `)) > 0);
});