// Disposable PostgreSQL, synthetic evidence only. Never uses .env or connected data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionTestSQL as q } from './validate-projection-benchmarks.js';
import { prepareMonitor } from '../lib/projections/monitor.js';

const rid = '80000000-0000-4000-8000-000000000001';
const other = '80000000-0000-4000-8000-000000000002';
const reject = (sql, pattern = /permission denied/) => assert.throws(() => q(sql), e => pattern.test(e.stderr || e.message));
let date;

function fixture() {
  date = q('select (current_date-1)::text;');
  q(`
    insert into public.restaurants(id,name,operational_timezone,onboarding_completed_at)
      values('${rid}','Synthetic monitor fixture','America/New_York',clock_timestamp()-interval '2 years'),
      ('${other}','Other monitor tenant','UTC',clock_timestamp()-interval '2 years');
    insert into public.projection_restaurant_config(restaurant_id,concept_type,first_data_date,enabled)
      values('${rid}','full_service',current_date-365,true);
    insert into public.pos_connections(id,restaurant_id,provider,status,shift4_timezone)
      values('${rid}','${rid}','shift4','connected','America/New_York');
    insert into public.projection_run_state(restaurant_id,backfill_complete,phase)
      values('${rid}',true,'complete');
    insert into public.menu_items(id,restaurant_id,name,created_at)
      select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        '${rid}','Fixture dish '||n,clock_timestamp()-interval '2 years' from generate_series(1,300) n;
    update public.projection_dishes set forecastable=true,
      style_category=case when right(m.name,1) in ('0','1','2','3','4') then 'Comfort/Heavy' else 'Light/Fresh' end
      from public.menu_items m where projection_dishes.menu_item_id=m.id and m.restaurant_id='${rid}';
    -- The load is synthetic; disable publication guards only in this disposable database.
    alter table public.projection_forecast_runs disable trigger user;
    alter table public.projection_forecast_nights disable trigger user;
    alter table public.projection_forecast_dishes disable trigger user;
    -- UNLOGGED changes fixture loading only; the measured SELECTs and indexes are identical.
    alter table public.projection_forecast_dishes set unlogged;
    alter table public.projection_forecast_nights set unlogged;
    alter table public.projection_job_leases set unlogged;
    alter table public.projection_jobs set unlogged;
    alter table public.projection_forecast_runs set unlogged;
    alter table public.projection_nightly_dish_facts set unlogged;
    alter table public.projection_nightly_flags set unlogged;
    insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision)
      select '${rid}',current_date-n,true,1500,repeat('a',64) from generate_series(1,365) n;
    insert into public.projection_nightly_dish_facts(restaurant_id,business_date,dish_id,units,recommended,sold_out,source_revision)
      select '${rid}',current_date-n,d.id,5,false,false,repeat('a',64)
      from generate_series(1,365) n cross join public.projection_dishes d where d.restaurant_id='${rid}';
    insert into public.projection_forecast_runs(id,restaurant_id,run_date,model_major,global_version_id,
      settings_snapshot,settings_digest,calibration_key,source_through,issued_at,trace)
      select ('82000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${rid}',current_date-n,4,g.id,
        g.settings,repeat('a',64),'fixture-calibration',current_date-n-1,(current_date-n)::timestamptz+interval '10 hours','{}'
      from generate_series(1,365) n cross join lateral(select * from public.projection_setting_versions
        where restaurant_id is null order by effective_at desc limit 1) g;
    insert into public.projection_forecast_nights(restaurant_id,run_id,target_date,days_ahead,availability,expected,low,high,confidence,trace)
      select '${rid}',r.id,r.run_date+h,h+1,'available',1500,1200,1800,'fixture',
        '{"categories":[{"style_category":"Comfort/Heavy","status":"ok"},{"style_category":"Light/Fresh","status":"ok"}],"range":{"bias":{"status":"NO PERSISTENT BIAS","fixture":true}}}'
      from public.projection_forecast_runs r cross join generate_series(0,7) h where r.restaurant_id='${rid}';
    insert into public.projection_forecast_dishes(restaurant_id,run_id,target_date,dish_id,share,expected,low,high,confidence,trace)
      select '${rid}',n.run_id,n.target_date,d.id,1.0/300,5,3,7,'fixture',
        jsonb_build_object('style_category',d.style_category,'status','ok','range',jsonb_build_object('bias',jsonb_build_object('status','NO PERSISTENT BIAS','fixture',true)))
      from public.projection_forecast_nights n cross join public.projection_dishes d
      where n.restaurant_id='${rid}' and d.restaurant_id='${rid}';
    alter table public.projection_forecast_runs enable trigger user;
    alter table public.projection_forecast_nights enable trigger user;
    alter table public.projection_forecast_dishes enable trigger user;
    analyze public.projection_forecast_runs; analyze public.projection_forecast_nights;
    analyze public.projection_forecast_dishes; analyze public.projection_nightly_flags;
    analyze public.projection_nightly_dish_facts;
  `);
}

function read(view, from = date) {
  return JSON.parse(q(`set role service_role; select public.projection_monitor_read(
    '${rid}','${from}','${date}','${view}');`));
}
function timed(sql, label) {
  const result = JSON.parse(q(`explain (analyze,format json) ${sql};`))[0];
  const ms = result['Execution Time'];
  console.log(`${label}: ${ms.toFixed(3)} ms`);
  assert.ok(ms < 1000, `${label}: ${ms} ms`);
}

test('monitor RPCs are private, bounded and never call the forecasting pipeline', () => {
  fixture();
  reject('set role anon;select public.projection_monitor_overview();');
  reject(`set role authenticated;select public.projection_monitor_read('${rid}',current_date-1,current_date-1);`);
  reject(`set role service_role;select public.projection_monitor_read('${rid}',current_date-100,current_date-1,'accuracy');`, /Invalid monitor request/);
  q(`create or replace function projection_private.pos_source_clock(p_restaurant_id uuid,p_shift4_timezone text,p_at timestamptz) returns jsonb
    language plpgsql stable as $$begin raise exception 'Monitor called source clock';end$$;
    create or replace function projection_private.run_timing(rid uuid,at_time timestamptz) returns jsonb
    language plpgsql stable as $$begin raise exception 'Monitor called timing';end$$;`);
  assert.equal(read('service').restaurant.id, rid);
  assert.ok(JSON.parse(q('select public.projection_monitor_overview();')).restaurants.length);
});

test('365 nights, 300 dishes and 365 eight-night archives stay under one second', () => {
  timed('select public.projection_monitor_overview()', 'Overview');
  timed(`select public.projection_monitor_read('${rid}','${date}','${date}','service')`, 'Service review');
  timed(`select public.projection_monitor_read('${rid}','${date}'::date-83,'${date}','accuracy')`, '12-week accuracy');
});

test('service reads all eight vintages with complete dish lists and scoped actuals', () => {
  const result = prepareMonitor(read('service'), 'service');
  assert.equal(result.observations.length, 8 * 301);
  const volumes = result.observations.filter(r => r.dish_id === null);
  assert.deepEqual(volumes.map(r => r.days_ahead), [1,2,3,4,5,6,7,8]);
  assert.ok(result.observations.filter(r => r.dish_id).every(r => Math.abs(r.expected - 5) < 1e-9));
});

test('accuracy reads aggregate complete evidence and retain original Step 9 bias', () => {
  const from = q(`select ('${date}'::date-83)::text;`);
  const result = prepareMonitor(read('accuracy', from), 'accuracy');
  assert.equal(result.groups.filter(g => g.bucket === 'dish').length, 300 * 8);
  assert.ok(result.groups.every(g => g.mape < 1e-12 && g.coverage === 1));
  assert.equal(result.bias[0].nights[0].volume.fixture, true);
});

test('another tenant cannot return the selected restaurant run', () => {
  const id = q(`select id from public.projection_forecast_runs where restaurant_id='${rid}' order by run_date desc limit 1;`);
  assert.equal(q(`select public.projection_monitor_run('${other}','${id}') is null;`), 't');
});

test('an unavailable category does not bias the available-category expectation', () => {
  const result = prepareMonitor(JSON.parse(q(`begin;
    alter table public.projection_forecast_nights disable trigger user;
    alter table public.projection_forecast_dishes disable trigger user;
    update public.projection_forecast_nights set trace=jsonb_set(trace,'{categories}',
      '[{"style_category":"Comfort/Heavy","status":"ok"},{"style_category":"Light/Fresh","status":"needs_baseline"}]')
      where restaurant_id='${rid}' and target_date='${date}' and days_ahead=1;
    update public.projection_forecast_dishes set share=null,expected=null,low=null,high=null,
      trace=jsonb_set(trace,'{status}','"needs_baseline"')
      where restaurant_id='${rid}' and target_date='${date}' and monitor_category='Light/Fresh'
        and run_id in(select run_id from public.projection_forecast_nights where restaurant_id='${rid}' and target_date='${date}' and days_ahead=1);
    select public.projection_monitor_read('${rid}','${date}','${date}','service');
    rollback;`)), 'service');
  const available = result.observations.filter(r => r.dish_id && r.days_ahead === 1 && r.reason === null);
  assert.equal(available.length, 150);
  assert.ok(available.every(r => Math.abs(r.expected - 5) < 1e-9 && r.scope_actual === 750));
});

test('missing facts and changed source revisions stay unavailable, never zero sales', () => {
  const result = prepareMonitor(JSON.parse(q(`begin;
    delete from public.projection_nightly_dish_facts where restaurant_id='${rid}' and business_date='${date}'
      and dish_id=(select min(dish_id::text)::uuid from public.projection_nightly_dish_facts where restaurant_id='${rid}' and business_date='${date}');
    select public.projection_monitor_read('${rid}','${date}','${date}','service');
    rollback;`)), 'service');
  assert.ok(result.observations.every(r => r.reason === 'actual_facts_require_reingestion'));
});

test('zero actual dish units are counted beside MAPE and remain in WAPE', () => {
  const result = prepareMonitor(JSON.parse(q(`begin;
    update public.projection_nightly_dish_facts set units=0 where restaurant_id='${rid}' and business_date='${date}'
      and dish_id=(select min(dish_id::text)::uuid from public.projection_nightly_dish_facts where restaurant_id='${rid}' and business_date='${date}');
    update public.projection_nightly_flags set total_units=1495 where restaurant_id='${rid}' and business_date='${date}';
    select public.projection_monitor_read('${rid}','${date}','${date}','accuracy');rollback;`)), 'accuracy');
  const row = result.groups.find(g => g.bucket === 'week' && g.kind === 'dishes' && g.days_ahead === 1);
  assert.equal(row.zero_actual, 1);
  assert.equal(row.mape_count, 299);
  assert.ok(row.wape > 0);
});

test('a superseding revision replaces the whole run and retains earlier issue-time links', () => {
  const child = '83000000-0000-4000-8000-000000000001';
  const result = prepareMonitor(JSON.parse(q(`begin;
    alter table public.projection_forecast_runs disable trigger user;
    alter table public.projection_forecast_nights disable trigger user;
    alter table public.projection_forecast_dishes disable trigger user;
    insert into public.projection_forecast_runs(id,restaurant_id,run_date,model_major,global_version_id,
      settings_snapshot,settings_digest,calibration_key,source_through,issued_at,supersedes_id,trace)
    select '${child}',restaurant_id,run_date,model_major,global_version_id,settings_snapshot,
      settings_digest,'changed-calibration',source_through,issued_at+interval '1 minute',id,trace
      from public.projection_forecast_runs where restaurant_id='${rid}' and run_date='${date}';
    insert into public.projection_forecast_nights(restaurant_id,run_id,target_date,days_ahead,availability,expected,low,high,confidence,trace)
    select restaurant_id,'${child}',target_date,days_ahead,availability,expected*1.1,low,high,confidence,trace
      from public.projection_forecast_nights where restaurant_id='${rid}' and run_id in(
        select supersedes_id from public.projection_forecast_runs where id='${child}');
    insert into public.projection_forecast_dishes(restaurant_id,run_id,target_date,dish_id,share,expected,low,high,confidence,trace)
    select restaurant_id,'${child}',target_date,dish_id,share,expected*1.1,low,high,confidence,trace
      from public.projection_forecast_dishes where restaurant_id='${rid}' and run_id in(
        select supersedes_id from public.projection_forecast_runs where id='${child}');
    select public.projection_monitor_read('${rid}','${date}','${date}','service');rollback;`)), 'service');
  const dayOf = result.observations.filter(r => r.days_ahead === 1);
  assert.equal(dayOf.length, 301);
  assert.ok(dayOf.every(r => r.run_id === child && r.calibration_key === 'changed-calibration'));
  assert.equal(dayOf.find(r => r.dish_id === null).raw_expected, 1650);
  const revision = result.revisions.find(r => r.id === child);
  assert.ok(revision.supersedes_id && revision.issued_at);
  assert.ok(result.revisions.some(r => r.id === revision.supersedes_id));
});

test('monitor functions are stable and contain no per-row source or timezone conversion', () => {
  assert.equal(q(`select count(*) from pg_proc where oid in(
    'projection_private.monitor_catalog(uuid)'::regprocedure,
    'public.projection_monitor_overview(timestamptz)'::regprocedure,
    'public.projection_monitor_read(uuid,date,date,text,timestamptz,boolean,uuid)'::regprocedure,
    'public.projection_monitor_run(uuid,uuid,date,uuid)'::regprocedure
  ) and provolatile='s' and prosrc !~* '(run_inputs|lifecycle_context|pos_source_clock|at time zone|business_boundary)';`), '4');
});

test('bounded reads plus JavaScript scoring finish under one second locally', () => {
  const from = q(`select ('${date}'::date-83)::text;`);
  for (const [view, start] of [['service', date], ['accuracy', from]]) {
    const before = performance.now();
    const result = prepareMonitor(read(view, start), view);
    const ms = performance.now() - before;
    console.log(`${view} read + decode: ${ms.toFixed(3)} ms`);
    assert.ok(result.restaurant.id === rid && ms < 1000, `${view} total ${ms} ms`);
  }
});

test('numeric transport is lossless for constant, varied, null and empty columns', () => {
  reject('set role authenticated;select projection_private.monitor_vector(array[1,1]::float8[]);');
  for (const [sql, expected] of [
    ['array[0.12345678901234566,0.12345678901234566]::float8[]', [0.12345678901234566]],
    ['array[1,2,1]::float8[]', [1,2,1]],
    ['array[null,null]::float8[]', [null]],
    ['array[null,1,null]::float8[]', [null,1,null]],
    ["'{}'::float8[]", []],
    ['array[0]::float8[]', [0]],
  ]) {
    assert.deepEqual(JSON.parse(q(`set role service_role;select projection_private.monitor_vector(${sql});`)), expected);
  }
  const snapshot = read('service');
  assert.equal(snapshot.nights[0][14][0].length, 300);
  assert.equal(snapshot.nights[0][14][2].length, 1);
  assert.equal(prepareMonitor(snapshot, 'service').observations.length, 8 * 301);
});