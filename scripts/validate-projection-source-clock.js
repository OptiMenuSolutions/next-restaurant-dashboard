// Reuses only the disposable benchmark database harness. No connected data or .env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionTestSQL as q } from './validate-projection-benchmarks.js';

const rid = '70000000-0000-4000-8000-000000000001';
const connection = '70000000-0000-4000-8000-000000000002';
const repair = '70000000-0000-4000-8000-000000000003';
const lit = value => `'${value.replaceAll("'", "''")}'`;
const rejects = sql => assert.throws(() => q(sql), error =>
  /permission denied/.test(error.stderr || error.message));

function setup() {
  q(`
    insert into public.restaurants(id,name,operational_timezone,onboarding_completed_at)
      values('${rid}','Clock fixture','America/New_York',clock_timestamp()-interval '2 years');
    insert into public.projection_restaurant_config(restaurant_id,concept_type,first_data_date)
      values('${rid}','full_service',current_date-400);
    insert into public.pos_connections(id,restaurant_id,provider,status,shift4_timezone)
      values('${connection}','${rid}','shift4','connected','America/New_York');
  `);
}

test('timezone cache exactly matches catalog membership and stays private', () => {
  setup();
  assert.equal(q(`select count(*) from (
    (select name from pg_catalog.pg_timezone_names except select name from projection_private.timezone_names)
    union all
    (select name from projection_private.timezone_names except select name from pg_catalog.pg_timezone_names)
  ) differences;`), '0');
  assert.equal(q(`select relrowsecurity from pg_class
    where oid='projection_private.timezone_names'::regclass;`), 't');
  rejects('set role anon;select * from projection_private.timezone_names;');
  rejects('set role authenticated;select * from projection_private.timezone_names;');
  rejects("set role service_role;insert into projection_private.timezone_names values('Invalid/Zone');");
  assert.equal(q("set role service_role;select count(*)>0 from projection_private.timezone_names;"), 't');
});

test('both clock checks and the four context validators use indexed membership', () => {
  assert.equal(q(`select count(*) from pg_proc p where p.oid in (
    'projection_private.pos_source_clock(uuid,text,timestamptz)'::regprocedure,
    'projection_private.run_timing(uuid,timestamptz)'::regprocedure,
    'projection_private.ingestion_context(uuid,date,timestamptz)'::regprocedure,
    'projection_private.calendar_context_before_nightly(uuid,date,date,timestamptz)'::regprocedure,
    'projection_private.lifecycle_context_before_nightly(uuid,date,timestamptz)'::regprocedure
  ) and position('pg_timezone_names' in pg_get_functiondef(p.oid))=0
    and position('projection_private.timezone_names' in pg_get_functiondef(p.oid))>0;`), '5');
  assert.equal(q(`select count(*) from pg_index where indrelid='projection_private.timezone_names'::regclass
    and indisprimary and indisvalid;`), '1');
});

test('clock JSON is unchanged for valid, invalid, missing, alias and Shift4 fallback zones', () => {
  const zones = [
    ['America/New_York', 'Australia/Sydney'],
    ['UTC', 'Invalid/Zone'],
    ['US/Eastern', 'UTC'],
    ['america/new_york', 'UTC'],
    ['Invalid/Zone', 'Australia/Sydney'],
    [null, 'America/Los_Angeles'],
    [null, null],
    ['Invalid/Zone', 'Invalid/Shift4'],
  ];
  for (const [operational, shift4] of zones) {
    assert.equal(q(`begin;
      update public.restaurants set operational_timezone=${operational === null ? 'null' : lit(operational)} where id='${rid}';
      select bool_and(projection_private.pos_source_clock('${rid}',${shift4 === null ? 'null' : lit(shift4)},at_time)
        =projection_private.test_source_clock_before_cache('${rid}',${shift4 === null ? 'null' : lit(shift4)},at_time))
      from unnest(array['2027-03-14T06:59:59Z','2027-03-14T07:00:00Z',
        '2027-11-07T05:30:00Z','2027-11-07T06:30:00Z']::timestamptz[]) at_time;
      rollback;`), 't');
  }
});

test('one 100-row menu insert spends under one second in triggers', () => {
  const result = JSON.parse(q(`explain (analyze,format json)
    insert into public.menu_items(id,restaurant_id,name,created_at)
    select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      '${rid}','Clock menu '||n,clock_timestamp()
    from generate_series(1,100) n;`))[0];
  const triggerMs = (result.Triggers || []).reduce((sum, trigger) => sum + trigger.Time, 0);
  console.log(`100 menu rows: ${triggerMs.toFixed(3)} ms trigger time; ${result['Execution Time'].toFixed(3)} ms execution`);
  assert.ok((result.Triggers || []).some(t => t.Calls === 100));
  assert.ok(triggerMs < 1000, `Trigger time ${triggerMs} ms`);
  assert.equal(q(`select count(*) from public.menu_items where restaurant_id='${rid}';`), '100');
  assert.equal(q(`select count(*) from public.projection_dishes where restaurant_id='${rid}';`), '100');
  assert.equal(q(`select count(*) from public.projection_menu_repairs where restaurant_id='${rid}';`), '0');
});

test('365 source coverage checks with a pending repair finish under one second', () => {
  q(`insert into public.projection_pos_source_repairs(
    restaurant_id,connection_id,observed_status,error_code,last_failure_at
  ) values('${rid}','${repair}','connected','test-repair',
    (current_date-30)::timestamptz+interval '12 hours');`);
  const result = JSON.parse(q(`explain (analyze,format json)
    select count(*) filter(where projection_private.source_covered('${rid}',current_date-n))
    from generate_series(0,364) n;`))[0];
  const ms = result['Execution Time'];
  console.log(`365 source coverage checks, one pending repair: ${ms.toFixed(3)} ms execution`);
  assert.ok(ms < 1000, `Coverage time ${ms} ms`);
  assert.equal(q(`select count(*) filter(where projection_private.source_covered('${rid}',current_date-n))
    from generate_series(0,364) n;`), '334');
});