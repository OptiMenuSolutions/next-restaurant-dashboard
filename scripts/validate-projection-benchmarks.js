// Disposable PostgreSQL only. No .env files or connected databases are used.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BENCHMARK_DICTIONARY } from '../lib/projections/benchmarks.js';
import { projectionVolumeDigest } from '../lib/projections/volumeProvenance.js';

const localBin = process.env.OPTIMENU_LOCAL_PG_BIN;
const localPsql = process.env.OPTIMENU_LOCAL_PSQL;
let localDir;
const container = `optimenu-benchmarks-${randomUUID()}`;
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const docker = args => execFileSync('docker', args, {
  encoding: 'utf8',
  timeout: 60000,
});

const q = sql => execFileSync(
  localBin ? localPsql : 'docker',
  localBin
    ? [
        '-h', localDir, '-p', '55462', '-XqAt', '-U', 'postgres',
        '-v', 'ON_ERROR_STOP=1',
      ]
    : [
        'exec', '-i', container, 'psql', '-XqAt', '-U', 'postgres',
        '-v', 'ON_ERROR_STOP=1',
      ],
  {
    input: sql,
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }
).trim();

const lit = value =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

const rejects = (sql, pattern) => assert.throws(
  () => q(sql),
  error => pattern.test(error.stderr || error.message)
);

let started = false;
let version;
let preview;

before(async () => {
  if (localBin) {
    assert.ok(localPsql);
    localDir = mkdtempSync('/tmp/optimenu-benchmark-db-');
    execFileSync(`${localBin}/initdb`, [
      '-D', `${localDir}/data`, '-U', 'postgres',
      '-A', 'trust', '--no-locale',
    ], { stdio: 'pipe' });
    execFileSync(`${localBin}/pg_ctl`, [
      '-D', `${localDir}/data`,
      '-l', `${localDir}/log`,
      '-o', `-k ${localDir} -p 55462 -c listen_addresses=''`,
      '-w', 'start',
    ], { stdio: 'pipe' });
    started = true;
  } else {
    docker([
      'run', '-d', '--name', container, '--read-only',
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
        docker([
          'exec', container, 'pg_isready',
          '-h', '127.0.0.1', '-U', 'postgres',
        ]);
        ready = true;
        break;
      } catch {
        await delay(250);
      }
    }
    assert.ok(ready);
  }

  q(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid
      language sql stable as $$select null::uuid$$;
    grant usage on schema public,auth to service_role;

    create table public.restaurants(
      id uuid primary key,user_id uuid,operational_timezone text,
      deactivated_at timestamptz,onboarding_completed_at timestamptz,
      name text,shipping_state text
    );
    create table public.profiles(id uuid primary key,role text);
    create table public.menu_items(
      id uuid primary key,
      restaurant_id uuid references public.restaurants on delete cascade,
      name text,created_at timestamptz not null default clock_timestamp(),
      archived_at timestamptz
    );
    create table public.pos_connections(
      id uuid primary key,
      restaurant_id uuid references public.restaurants on delete cascade,
      provider text,status text,shift4_timezone text,shift4_location_id text
    );
    create table public.pos_tickets(
      id uuid primary key,restaurant_id uuid,pos_system text,ticket_type text,
      opened_at timestamptz,closed_at timestamptz
    );
    create table public.pos_ticket_lines(
      id uuid primary key,ticket_id uuid,restaurant_id uuid,item_ref text,
      line_type text,quantity numeric,is_non_sales_revenue boolean,
      added_at timestamptz
    );
    create table public.ai_recommendations(
      id uuid primary key,restaurant_id uuid,
      generated_date date,recommendations jsonb
    );
    grant select on all tables in schema public to service_role;

    create function public.purge_restaurant(target uuid) returns void
    language plpgsql security definer set search_path='' as $$begin
      delete from public.menu_items where restaurant_id=target;
      delete from public.pos_connections where restaurant_id=target;
      delete from public.restaurants where id=target;
    end$$;
  `);

  const names = readdirSync(
    new URL('../supabase/migrations/', import.meta.url)
  );

  for (const suffix of [
    'foundation', 'ingestion', 'calendar', 'dish_lifecycle',
    'holiday_learning', 'outlier_runs', 'nightly_runs',
    'nightly_review', 'benchmarks',
  ]) {
    const files = names.filter(
      name => name.endsWith(`_projection_${suffix}.sql`)
    );
    assert.equal(files.length, 1);
    q(readFileSync(
      new URL(`../supabase/migrations/${files[0]}`, import.meta.url),
      'utf8'
    ));
  }

  q(`
    insert into public.profiles values('${id(99)}','admin');
    insert into public.restaurants(
      id,name,shipping_state,operational_timezone,onboarding_completed_at
    )
    select
      ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      'Fixture '||n,'NJ','UTC',clock_timestamp()-interval '400 days'
    from generate_series(1,7) n;

    insert into public.projection_restaurant_config(
      restaurant_id,concept_type,first_data_date
    )
    select id,'full_service',current_date-400 from public.restaurants;

    insert into public.projection_pool_permissions(
      restaurant_id,enabled,agreement_permits,agreement_version
    )
    select id,true,true,'fixture-v1' from public.restaurants;
  `);

  const now = new Date().toISOString();
  const vintage = now.slice(0, 10);
  const pulls = [
    ['fred_census', 'MRTSSM722USN'],
    ['fred_cpi', 'CUUR0000SEFV'],
  ].map(([provider, series]) => {
    const payload = {
      observations: [{
        date: `${Number(vintage.slice(0, 4)) - 1}-01-01`,
        value: '100',
        realtime_start: vintage,
        realtime_end: vintage,
      }],
    };
    return {
      provider,
      query_metadata: {
        series_id: series,
        realtime_start: vintage,
        realtime_end: vintage,
      },
      payload,
      payload_sha256: projectionVolumeDigest(payload),
    };
  });

  const restaurants = Array.from({ length: 7 }, (_, i) => ({
    id: id(i + 1),
    as_of: vintage,
    source_digest: null,
    preview: {
      status: 'ok',
      weeks: Array.from({ length: 8 }, () => ({
        week_start: vintage,
        days: [],
      })),
    },
    contributions: [],
  }));

  const doc = {
    snapshot_at: now,
    vintage,
    valid_from: vintage,
    dictionary: BENCHMARK_DICTIONARY,
    dictionary_digest: projectionVolumeDigest(BENCHMARK_DICTIONARY),
    pulls,
    restaurants,
  };

  version = JSON.parse(q(`
    set role service_role;
    select public.projection_stage_benchmark(${lit(doc)});
  `)).id;

  preview = JSON.parse(q(`
    set role service_role;
    select public.projection_benchmark_preview('${version}');
  `));
});

after(() => {
  if (localDir) {
    if (started) {
      execFileSync(`${localBin}/pg_ctl`, [
        '-D', `${localDir}/data`, '-m', 'immediate', 'stop',
      ], { stdio: 'pipe' });
    }
    rmSync(localDir, { recursive: true, force: true });
  } else if (started) {
    docker(['rm', '-f', container]);
  }
});

test('new settings version leaves the old calibration identity intact', () => {
  const versions = JSON.parse(q(`
    select jsonb_agg(settings order by effective_at desc)
    from public.projection_setting_versions where restaurant_id is null;
  `));
  assert.equal(Object.hasOwn(versions[0], 'minimum_benchmark_history_weeks'), false);
  assert.equal(versions[0].minimum_trends_terms, 2);
  assert.equal(
    versions[1].volume_recent_weight,
    versions[0].volume_recent_weight
  );
});

test('new tables have RLS and frontend reads and RPC execution are blocked', () => {
  assert.equal(q(`
    select count(*) from pg_class
    where relname in (
      'projection_benchmark_versions',
      'projection_benchmark_publications',
      'projection_benchmark_previews',
      'projection_benchmark_contributions'
    ) and relrowsecurity;
  `), '4');
  rejects(
    'set role authenticated; select * from public.projection_benchmark_versions;',
    /permission denied/
  );
  rejects(
    'set role anon; select public.projection_benchmark_catalog();',
    /permission denied/
  );
});

test('first publication requires a real admin and the exact preview digest', () => {
  rejects(`
    set role service_role;
    select public.projection_approve_benchmark(
      '${version}','${preview.digest}'
    );
  `, /First benchmark/);
  rejects(`
    set role service_role;
    select public.projection_approve_benchmark(
      '${version}','bad','${id(99)}'
    );
  `, /preview changed/);
  q(`
    set role service_role;
    select public.projection_approve_benchmark(
      '${version}','${preview.digest}','${id(99)}'
    );
  `);
});

test('published data is immutable and retries are idempotent', () => {
  rejects(`
    update public.projection_benchmark_versions
    set vintage=current_date where id='${version}';
  `, /append-only/);
  q(`
    set role service_role;
    select public.projection_approve_benchmark(
      '${version}','${preview.digest}','${id(99)}'
    );
  `);
  assert.equal(
    q('select count(*) from public.projection_benchmark_publications;'),
    '1'
  );
});

test('future-vintage candidates and missing receiver evidence cannot be used', () => {
  const context = JSON.parse(q(`
    select projection_private.benchmark_context(
      '${id(1)}',current_date,
      (
        select created_at from public.projection_benchmark_versions
        where id='${version}'
      )
    );
  `));
  assert.equal(context.release, null);
  assert.deepEqual(context.pooled, []);
});

test('five members are insufficient when the receiver is one of them', () => {
  q(`
    insert into public.projection_benchmark_contributions
    select '${version}',id,'full_service','NJ',
      current_date,'volume',1,repeat('a',64)
    from public.restaurants
    where id in (${[1, 2, 3, 4, 5].map(n => `'${id(n)}'`).join(',')});
  `);
  assert.equal(q(`
    select count(*) from projection_private.benchmark_participants(
      '${version}','${id(1)}',current_date,'volume','full_service','NJ'
    );
  `), '4');
});

test('actual contributors exclude the receiver, respect consent and never cross concepts', () => {
  q(`
    insert into public.projection_benchmark_contributions values(
      '${version}','${id(6)}','full_service','NJ',
      current_date,'volume',2,repeat('a',64)
    );
  `);
  assert.equal(q(`
    select count(*) from projection_private.benchmark_participants(
      '${version}','${id(1)}',current_date,'volume','full_service','NJ'
    );
  `), '5');

  q(`
    update public.projection_pool_permissions
    set enabled=false where restaurant_id='${id(6)}';
  `);
  assert.equal(q(`
    select count(*) from projection_private.benchmark_participants(
      '${version}','${id(1)}',current_date,'volume','full_service','NJ'
    );
  `), '4');
  assert.equal(q(`
    select count(*) from projection_private.benchmark_participants(
      '${version}','${id(1)}',current_date,'volume','bar_pub','US'
    );
  `), '0');
});

test('purge deletes tenant contribution and preview records; the global vintage remains', () => {
  q(`select public.purge_restaurant('${id(1)}');`);
  assert.equal(q(`
    select count(*) from public.projection_benchmark_contributions
    where restaurant_id='${id(1)}';
  `), '0');
  assert.equal(q(`
    select count(*) from public.projection_benchmark_previews
    where restaurant_id='${id(1)}';
  `), '0');
  assert.equal(q(`
    select count(*) from public.projection_benchmark_versions
    where id='${version}';
  `), '1');
});

test('pooled total count and mean come from actual contribution rows, not supplied statistics', () => {
  q(`
    insert into public.projection_setting_versions(
      model_major,effective_at,settings
    )
    select 4,clock_timestamp(),
      settings||'{"pooled_benchmarks_enabled":true}'
    from public.projection_setting_versions
    where restaurant_id is null order by effective_at desc limit 1;

    update public.projection_pool_permissions
    set enabled=true where restaurant_id='${id(6)}';

    insert into public.projection_benchmark_contributions values(
      '${version}','${id(7)}','full_service','NJ',
      current_date,'volume',4,repeat('a',64)
    );

    insert into public.projection_pool_cohorts(
      cohort_key,concept_type,region_code
    ) values('fixture','full_service','NJ');

    insert into public.projection_pooled_totals(
      restaurant_id,benchmark_version_id,cohort_key,metric,target_date,
      period_start,period_end,participant_count,statistics
    ) values(
      '${id(2)}','${version}','fixture','volume',current_date,
      current_date-(extract(isodow from current_date)::int-1),
      current_date-(extract(isodow from current_date)::int-1)+6,
      999,'{"ratio":999}'
    );
  `);

  const total = JSON.parse(q(`
    select to_jsonb(t) from public.projection_pooled_totals t
    where restaurant_id='${id(2)}';
  `));
  assert.equal(total.participant_count, 5);
  assert.equal(total.statistics.ratio, 1.8);

  rejects(`
    insert into public.projection_pooled_totals(
      restaurant_id,benchmark_version_id,cohort_key,metric,target_date,
      period_start,period_end,participant_count,statistics
    ) values(
      '${id(2)}','${version}','fixture','volume',current_date+1,
      current_date-(extract(isodow from current_date)::int-1),
      current_date-(extract(isodow from current_date)::int-1)+6,
      999,'{}'
    );
  `, /five actual contributors|receiver|Contribution/i);
});

test('nightly inputs pin the published vintage and compute state pools from the current consent floor', () => {
  const raw = JSON.parse(q(`
    select public.projection_benchmark_inputs(
      '${id(2)}',clock_timestamp()
    );
  `));
  assert.equal(raw.benchmarks.release.id, version);
  assert.equal(raw.benchmarks.state, 'US-NJ');
  const pooled = raw.benchmarks.pooled.find(row => row.metric === 'volume');
  assert.equal(pooled.ratio, 1.8);
  assert.equal(pooled.contributors, 5);
});

test('counterfactual archive context keeps the original release after a newer publication', () => {
  q(`
    insert into public.projection_benchmark_versions(
      vintage,valid_from,valid_until,sales_pull_id,cpi_pull_id,
      dictionary,dictionary_digest
    )
    select vintage,valid_from,valid_until,sales_pull_id,cpi_pull_id,
      dictionary,dictionary_digest
    from public.projection_benchmark_versions where id='${version}';

    insert into public.projection_benchmark_publications(
      version_id,actor_id
    )
    select id,'${id(99)}' from public.projection_benchmark_versions
    order by created_at desc limit 1;
  `);

  const row = {
    restaurant_id: id(2),
    run_date: new Date().toISOString().slice(0, 10),
    issued_at: new Date().toISOString(),
    trace: {
      provenance: {
        benchmark_snapshot: {
          release_id: version,
          state: 'US-NJ',
          closed_weekdays: [],
          status: 'current',
          values: [],
        },
      },
    },
  };

  const context = JSON.parse(q(`
    select projection_private.archive_benchmark_context(
      jsonb_populate_record(
        null::public.projection_forecast_runs,${lit(row)}
      )
    );
  `));
  assert.equal(context.release.id, version);
});