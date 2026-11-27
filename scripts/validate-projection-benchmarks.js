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
import { BENCHMARK_DICTIONARY, benchmarkWeek } from '../lib/projections/benchmarks.js';
import { CENSUS_BENCHMARK_SETTINGS, censusCurve } from '../lib/projections/nationalCensus.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
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
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PGOPTIONS: '-c timezone=UTC' },
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
const national = censusCurve({
  sales: [{ date: '2025-01-01', value: 3100 }],
  cpi: [{ date: '2025-01-01', value: 100 }],
});
const nationalDoc = {
  benchmark_settings: CENSUS_BENCHMARK_SETTINGS,
  census_curve: national.snapshot,
  census_curve_digest: national.digest,
};

before(async () => {
  if (localBin) {
    assert.ok(localPsql);
    localDir = mkdtempSync(process.env.OPTIMENU_LOCAL_PG_TMP || '/tmp/optimenu-benchmark-db-');
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
    create table public.profiles(id uuid primary key,role text,email text);
    create table public.waste_confirmations(
      id uuid primary key, restaurant_id uuid not null, status text not null,
      invoice_item_id uuid, confirmed_by uuid, confirmed_at timestamptz, ingredient_name text
    );
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
    'nightly_review', 'benchmarks', 'benchmark_build_fixes',
    'snapshot_performance', 'cpi_gap', 'national_census', 'timezone_cache', 'monitor', 'waste_risk_storage',
    'pos_sync_lease', 'waste_daily_jobs', 'waste_daily_runner', 'waste_compact_result', 'waste_correction_sources', 'waste_assessment_reader', 'waste_assessment_admin', 'waste_assessment_preview', 'waste_review_cap', 'waste_dish_shadow', 'waste_rollout',
  ]) {
    if (suffix === 'timezone_cache') {
      q(`do $copy$ declare d text; begin
        d:=pg_get_functiondef('projection_private.pos_source_clock(uuid,text,timestamptz)'::regprocedure);
        execute replace(d,'FUNCTION projection_private.pos_source_clock(',
          'FUNCTION projection_private.test_source_clock_before_cache(');
      end $copy$;`);
    }
    if (suffix === 'snapshot_performance') {
      q(`do $copy$ declare d text; begin
        d:=pg_get_functiondef('projection_private.lifecycle_context_before_nightly(uuid,date,timestamptz)'::regprocedure);
        execute replace(d,'FUNCTION projection_private.lifecycle_context_before_nightly(',
          'FUNCTION projection_private.test_lifecycle_context_original(');
        d:=pg_get_functiondef('projection_private.lifecycle_prior_sales(uuid,date,timestamptz)'::regprocedure);
        execute replace(d,'FUNCTION projection_private.lifecycle_prior_sales(',
          'FUNCTION projection_private.test_prior_sales_original(');
      end $copy$;`);
    }
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
    insert into public.profiles(id,role) values('${id(99)}','admin');
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

    insert into public.projection_setting_versions(
      restaurant_id,model_major,effective_at,settings
    )
    select id,4,clock_timestamp(),'{"business_day_cutoff_minutes":0}'::jsonb
    from public.restaurants;

    insert into public.projection_run_state(
      restaurant_id,backfill_from,backfill_until,cursor_date,phase,backfill_complete
    )
    select id,current_date-400,current_date-1,current_date,'complete',true
    from public.restaurants;

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
      weeks: Array.from({ length: 8 }, (_, week) => ({
        week_start: shiftProjectionDate(benchmarkWeek(vintage), week * 7),
        days: Array.from({ length: 7 }, (_, day) => ({
          target_date: shiftProjectionDate(benchmarkWeek(vintage), week * 7 + day),
          ratio: 1, capped_S: 1, applies: true,
        })),
      })),
    },
    contributions: [],
  }));

  const doc = {
    ...nationalDoc,
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

test('unnamed accounts can be previewed without changing restaurant records', () => {
  const restaurantId = id(50);
  q(`insert into public.restaurants(id,name) values('${restaurantId}',null);`);
  const catalog = JSON.parse(q('select public.projection_benchmark_catalog();'));
  assert.equal(catalog.restaurants.find(r => r.id === restaurantId).name, 'Unnamed restaurant');

  const seed = JSON.parse(q(`
    select jsonb_build_object(
      'vintage',v.vintage,'valid_from',v.valid_from,
      'pulls',jsonb_build_array(to_jsonb(s),to_jsonb(c))
    ) from public.projection_benchmark_versions v
    join public.projection_benchmark_pulls s on s.id=v.sales_pull_id
    join public.projection_benchmark_pulls c on c.id=v.cpi_pull_id
    where v.id='${version}';
  `));
  const doc = {
    ...nationalDoc,
    ...seed,
    snapshot_at: new Date().toISOString(),
    dictionary: BENCHMARK_DICTIONARY,
    dictionary_digest: projectionVolumeDigest(BENCHMARK_DICTIONARY),
    restaurants: [{
      id: restaurantId,
      as_of: seed.valid_from,
      source_digest: null,
      preview: { status: 'unavailable', reason: 'BACKFILL_PENDING', weeks: [] },
      contributions: [],
    }],
  };
  const staged = JSON.parse(q(`set role service_role;
    select public.projection_stage_benchmark(${lit(doc)});`));
  const result = JSON.parse(q(`select public.projection_benchmark_preview('${staged.id}');`));
  assert.equal(result.preview[0].name, 'Unnamed restaurant');
  assert.equal(q(`select name is null from public.restaurants where id='${restaurantId}';`), 't');
  q(`update public.restaurants set deactivated_at=clock_timestamp() where id='${restaurantId}';`);
});

test('vintage checks use UTC consistently across database session timezones', () => {
  q(`
    begin;
    set local timezone='America/New_York';
    insert into public.projection_benchmark_versions(
      created_at,vintage,valid_from,valid_until,sales_pull_id,cpi_pull_id,
      dictionary,dictionary_digest
    ) select '2026-01-01T00:30:00Z','2026-01-01','2026-01-01','2026-01-15',
      sales_pull_id,cpi_pull_id,dictionary,dictionary_digest
    from public.projection_benchmark_versions where id='${version}';
    rollback;
  `);
});

const dateFixture = id(60);
const dateSnapshot = '2027-11-08T12:00:00Z';

test('batched menu dates preserve historical cutoffs, DST, tenant and snapshot bounds', () => {
  q(`
    insert into public.restaurants(id,name,operational_timezone,onboarding_completed_at)
      values('${dateFixture}','Date fixture','America/New_York','2020-01-01T12:00:00Z');
    insert into public.projection_restaurant_config(restaurant_id,concept_type,first_data_date)
      values('${dateFixture}','full_service','2020-01-01');
    insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings)
      values('${dateFixture}',4,'2027-01-01T00:00:00Z','{"business_day_cutoff_minutes":150}'),
        ('${dateFixture}',4,'2027-07-01T00:00:00Z','{"business_day_cutoff_minutes":90}');
    insert into public.menu_items(id,restaurant_id,name,created_at)
      select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        '${dateFixture}','Date '||n,at_time
      from unnest(array[
        '2019-12-31T03:00:00Z','2027-03-14T06:59:59Z',
        '2027-03-14T07:00:00Z','2027-07-01T00:00:00Z',
        '2027-11-07T05:45:00Z','2027-11-07T06:29:59Z',
        '2027-11-07T06:30:00Z','2027-12-01T12:00:00Z'
      ]::timestamptz[]) with ordinality v(at_time,n);
  `);
  assert.equal(q(`
    select count(*) from projection_private.menu_source_dates('${dateFixture}','${dateSnapshot}') b
    join public.menu_items m on m.id=b.menu_item_id
    where b.added_business_date is distinct from
      (projection_private.pos_source_clock('${dateFixture}',null,m.created_at)->>'business_date')::date;
  `), '0');
  assert.equal(q(`select count(*) from projection_private.menu_source_dates('${dateFixture}','${dateSnapshot}');`), '7');
  assert.equal(q(`
    select string_agg(b.added_business_date::text,',' order by m.name)
    from projection_private.menu_source_dates('${dateFixture}','${dateSnapshot}') b
    join public.menu_items m on m.id=b.menu_item_id
    where m.name in ('Date 2','Date 3','Date 5','Date 6','Date 7');
  `), '2027-03-13,2027-03-14,2027-11-06,2027-11-06,2027-11-07');
  assert.equal(q(`select count(*) from projection_private.menu_source_dates('${id(2)}','${dateSnapshot}') b
    join public.menu_items m on m.id=b.menu_item_id where m.restaurant_id='${dateFixture}';`), '0');
});

test('batching preserves the complete lifecycle payload and context digest', () => {
  assert.equal(q(`
    select projection_private.lifecycle_context_before_nightly(
      '${dateFixture}','2027-11-08','${dateSnapshot}'
    ) = projection_private.test_lifecycle_context_original(
      '${dateFixture}','2027-11-08','${dateSnapshot}'
    );
  `), 't');
});

test('batched prior-sales inference preserves the earliest eligible positive sale', () => {
  q(`
    insert into public.pos_connections(id,restaurant_id,provider,status,shift4_timezone)
      values('${id(63)}','${dateFixture}','shift4','connected','America/New_York');
    insert into public.projection_pos_item_map(
      restaurant_id,pos_system,external_item_id,dish_id,valid_from
    ) values('${dateFixture}','shift4','prior-food',
      '30000000-0000-4000-8000-000000000002','2027-03-01');
    insert into public.projection_nightly_flags(
      restaurant_id,business_date,complete,total_units,source_revision
    ) values('${dateFixture}','2027-03-10',true,2,repeat('a',64));
    insert into public.pos_tickets(id,restaurant_id,pos_system,ticket_type,opened_at,closed_at)
      values('${id(64)}','${dateFixture}','shift4','closed','2027-03-10T17:00:00Z','2027-03-10T18:00:00Z');
    insert into public.pos_ticket_lines(id,ticket_id,restaurant_id,item_ref,line_type,quantity,is_non_sales_revenue,added_at)
      values('${id(65)}','${id(64)}','${dateFixture}','prior-food','sale',2,false,'2027-03-10T17:00:00Z');
  `);
  assert.equal(q(`select projection_private.lifecycle_prior_sales(
    '${dateFixture}','2027-11-08','${dateSnapshot}'
  )=projection_private.test_prior_sales_original(
    '${dateFixture}','2027-11-08','${dateSnapshot}'
  );`), 't');
  const rows = JSON.parse(q(`select projection_private.lifecycle_prior_sales(
    '${dateFixture}','2027-11-08','${dateSnapshot}');`));
  assert.equal(rows[0].business_date, '2027-03-10');
  assert.equal(rows[0].units, 2);
});

test('1000 distinct menu timestamps in one policy period use one source clock lookup', () => {
  const rid = id(61);
  q(`
    insert into public.restaurants(id,name,operational_timezone)
      values('${rid}','Bulk fixture','America/New_York');
    alter table public.menu_items disable trigger user;
    insert into public.menu_items(id,restaurant_id,name,created_at)
      select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        '${rid}','Bulk '||n,'2026-01-15T12:00:00Z'::timestamptz+n*interval '1 second'
      from generate_series(1,1000) n;
    alter table public.menu_items enable trigger user;
  `);
  assert.equal(q(`
    begin;
    do $copy$ declare d text; begin
      d:=pg_get_functiondef('projection_private.pos_source_clock(uuid,text,timestamptz)'::regprocedure);
      execute replace(d,'FUNCTION projection_private.pos_source_clock(',
        'FUNCTION projection_private.test_source_clock_original(');
    end $copy$;
    create or replace function projection_private.pos_source_clock(
      p_restaurant_id uuid,p_shift4_timezone text,p_at timestamptz
    ) returns jsonb language plpgsql stable set search_path='' as $spy$
    begin
      perform set_config('optimenu.test_clock_calls',
        (coalesce(nullif(current_setting('optimenu.test_clock_calls',true),''),'0')::int+1)::text,true);
      return projection_private.test_source_clock_original(p_restaurant_id,p_shift4_timezone,p_at);
    end $spy$;
    select count(*) from projection_private.menu_source_dates('${rid}','2026-02-01T00:00:00Z');
    select current_setting('optimenu.test_clock_calls');
    rollback;
  `), '1000\n1');
});

test('incomplete backfills return a lightweight unavailable context', () => {
  const rid = id(62);
  q(`insert into public.restaurants(id,name,operational_timezone)
    values('${rid}','Pending fixture','UTC');`);
  const raw = JSON.parse(q(`set role service_role;
    select public.projection_benchmark_inputs('${rid}',clock_timestamp());`));
  assert.equal(raw.restaurant_id, rid);
  assert.equal(raw.backfill.complete, false);
  assert.equal(Object.hasOwn(raw, 'lifecycle'), false);
});

test('the batched reader stays private and future benchmark snapshots remain blocked', () => {
  rejects(`set role anon;select * from projection_private.menu_source_dates('${dateFixture}',clock_timestamp());`, /permission denied/);
  rejects(`set role authenticated;select * from projection_private.menu_source_dates('${dateFixture}',clock_timestamp());`, /permission denied/);
  rejects(`set role service_role;select public.projection_benchmark_inputs('${dateFixture}',clock_timestamp()+interval '1 day');`, /Future benchmark snapshot/);
});

test('CPI rule metadata is pinned in live and archived contexts without changing legacy pulls', () => {
  const seed = JSON.parse(q(`select to_jsonb(v) from public.projection_benchmark_versions v where id='${version}';`));
  const payload = { observations: [
    ['2025-01-01', '100'], ['2025-02-01', '.'], ['2025-03-01', '121'],
  ].map(([date, value]) => ({ date, value, realtime_start: seed.vintage, realtime_end: seed.vintage })) };
  const cpiId = q(`
    insert into public.projection_benchmark_pulls(provider,query_metadata,payload,payload_sha256)
    select provider,query_metadata||'{"cpi_gap_policy":"isolated-log-linear-v1","cpi_interpolated":[{"date":"2025-02-01","value":110,"cpi_interpolated":true}]}',
      ${lit(payload)},'${projectionVolumeDigest(payload)}' from public.projection_benchmark_pulls where id='${seed.cpi_pull_id}'
    returning id;
  `);
  const releaseId = q(`
    insert into public.projection_benchmark_versions(vintage,valid_from,valid_until,sales_pull_id,cpi_pull_id,dictionary,dictionary_digest)
    select vintage,valid_from,valid_until,sales_pull_id,'${cpiId}',dictionary,dictionary_digest
    from public.projection_benchmark_versions where id='${version}' returning id;
  `);
  q(`insert into public.projection_benchmark_publications(version_id,actor_id) values('${releaseId}','${id(99)}');`);
  const current = JSON.parse(q(`select projection_private.benchmark_context('${id(2)}','${seed.valid_from}',clock_timestamp());`));
  assert.equal(current.release.census.cpi_gap_policy, 'isolated-log-linear-v1');
  assert.equal(current.release.census.cpi_interpolated[0].cpi_interpolated, true);
  for (const [release, marked] of [[releaseId, true], [version, false]]) {
    const row = {
      restaurant_id: id(2), run_date: seed.valid_from, issued_at: new Date().toISOString(),
      trace: { provenance: { benchmark_snapshot: {
        release_id: release, state: 'US-NJ', closed_weekdays: [], status: 'current', values: [],
      } } },
    };
    const archived = JSON.parse(q(`select projection_private.archive_benchmark_context(
      jsonb_populate_record(null::public.projection_forecast_runs,${lit(row)}));`));
    assert.equal(Object.hasOwn(archived.release.census, 'cpi_gap_policy'), marked);
  }
});

test('SQL approval permits partial days but rejects an unusable eight-week preview', () => {
  const full = JSON.parse(q(`select result from public.projection_benchmark_previews where version_id='${version}' limit 1;`));
  const partial = structuredClone(full);
  for (const week of partial.weeks) {
    Object.assign(week.days[0], { ratio: null, capped_S: null, applies: false, reason: 'missing_or_nonpositive_week' });
  }
  assert.equal(q(`select projection_private.usable_benchmark_preview(${lit(partial)});`), 't');
  const missing = structuredClone(partial);
  missing.weeks[0].days.forEach(day => { day.ratio = null; day.applies = false; });
  assert.equal(q(`select projection_private.usable_benchmark_preview(${lit(missing)});`), 'f');
  const seed = JSON.parse(q(`select jsonb_build_object('vintage',v.vintage,'valid_from',v.valid_from,
    'pulls',jsonb_build_array(to_jsonb(s),to_jsonb(c)))
    from public.projection_benchmark_versions v
    join public.projection_benchmark_pulls s on s.id=v.sales_pull_id
    join public.projection_benchmark_pulls c on c.id=v.cpi_pull_id where v.id='${version}';`));
  const catalog = JSON.parse(q('select public.projection_benchmark_catalog();'));
  for (const [result, accepted] of [[missing, false], [partial, true]]) {
    const doc = { ...seed, ...nationalDoc, snapshot_at: new Date().toISOString(),
      dictionary: BENCHMARK_DICTIONARY, dictionary_digest: projectionVolumeDigest(BENCHMARK_DICTIONARY),
      restaurants: catalog.restaurants.map(r => ({ id: r.id, as_of: seed.valid_from,
        source_digest: null, preview: result, contributions: [] })),
    };
    const staged = JSON.parse(q(`set role service_role;select public.projection_stage_benchmark(${lit(doc)});`));
    const preview = JSON.parse(q(`select public.projection_benchmark_preview('${staged.id}');`));
    const approve = `set role service_role;select public.projection_approve_benchmark('${staged.id}','${preview.digest}','${id(99)}');`;
    if (accepted) assert.equal(JSON.parse(q(approve)).published, true);
    else rejects(approve, /No validated eight-week preview/);
  }
});

test('national settings and the same immutable curve are pinned for different receivers', () => {
  const contexts = [2, 3].map(n => JSON.parse(q(`
    select projection_private.benchmark_context('${id(n)}',current_date,clock_timestamp());
  `)));
  assert.deepEqual(contexts[0].release.census.national_curve, contexts[1].release.census.national_curve);
  assert.deepEqual(contexts[0].release.census.benchmark_settings.census_weekday_weights, [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(contexts[0].release.census.census_curve_digest, national.digest);
  rejects(`update public.projection_benchmark_versions set census_curve='{}' where id='${version}';`, /append-only/);
  rejects('set role authenticated;select projection_private.national_census_metadata(null);', /permission denied/);
});

test('archives retain their original national weights and curve digest', () => {
  const row = { restaurant_id: id(2), run_date: new Date().toISOString().slice(0, 10),
    issued_at: new Date().toISOString(), trace: { provenance: { benchmark_snapshot: {
      release_id: version, state: 'US-NJ', closed_weekdays: [], status: 'current', values: [],
    } } },
  };
  const archived = JSON.parse(q(`select projection_private.archive_benchmark_context(
    jsonb_populate_record(null::public.projection_forecast_runs,${lit(row)}));`));
  assert.equal(archived.release.census.census_curve_digest, national.digest);
  assert.deepEqual(archived.release.census.national_curve, national.snapshot);
});

test('legacy candidates remain unchanged and cannot be approved', () => {
  const legacy = q(`insert into public.projection_benchmark_versions(
    vintage,valid_from,valid_until,sales_pull_id,cpi_pull_id,dictionary,dictionary_digest)
    select vintage,valid_from,valid_until,sales_pull_id,cpi_pull_id,dictionary,dictionary_digest
    from public.projection_benchmark_versions where id='${version}' returning id;`);
  const read = JSON.parse(q(`select public.projection_benchmark_preview('${legacy}');`));
  rejects(`set role service_role;select public.projection_approve_benchmark('${legacy}','${read.digest}','${id(99)}');`,
    /Rebuild this candidate with national Census weights/);
  assert.equal(q(`select count(*) from public.projection_benchmark_publications where version_id='${legacy}';`), '0');
});

test('national settings reject short vectors, zero weights and changed v1 weights', () => {
  for (const weights of [[1, 1], [1, 1, 1, 1, 1, 1, 0], [1, 1, 1, 1, 1, 1, 2]]) {
    assert.equal(q(`select projection_private.valid_census_settings(${lit({
      ...CENSUS_BENCHMARK_SETTINGS, census_weekday_weights: weights,
    })});`), 'f');
  }
});


export { q as projectionTestSQL };
export const projectionTestConnection = () => ({ localBin, localPsql, localDir, container });