import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { projectionHolidayDates } from '../lib/projections/calendar.js';
import { readProjectionCalendar, applyProjectionCalendarFlags } from '../lib/projections/calendarStore.js';

// Disposable local PostgreSQL only. No environment file or remote DB is loaded.
const container = `optimenu-calendar-${randomUUID()}`;
const R = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REST = R(1), OTHER = R(2), OWNER = R(101), FOREIGN = R(102);
const DAY = '2026-11-19';
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
let started = false;
const docker = (a, options = {}) => execFileSync('docker', a, {
  encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options,
});
const q = sql => docker(args, { input: sql }).trim();
const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const rejects = (sql, pattern) => assert.throws(() => q(sql), e => pattern.test(e.stderr || e.message));
const config = () => ({ concept_type: 'full_service', normally_closed_weekdays: [],
  holiday_answers: { christmas_eve: 'early_close', christmas_day: 'closed' } });
const saveSQL = (revision, settings = config(), effective = null, actor = OWNER) => `
  set role service_role;
  select public.projection_save_calendar_answers('${REST}','${actor}',${revision},${json(settings)},
    ${effective == null ? 'null' : `'${effective}'`});`;
const save = (...a) => JSON.parse(q(saveSQL(...a)));
const context = (from = DAY, until = from, restaurantId = REST) => JSON.parse(q(`
  set role service_role;
  select public.projection_calendar_context('${restaurantId}','${from}','${until}');`));
const database = { rpc: async (name, a) => {
  try {
    if (name === 'projection_prepare_calendar') {
      q(`set role service_role; select public.projection_prepare_calendar('${a.p_from}','${a.p_until}');`);
      return { data: null, error: null };
    }
    if (name === 'projection_calendar_context') return { data: context(a.p_from, a.p_until, a.p_restaurant_id), error: null };
    if (name === 'projection_apply_calendar_flags') {
      const raw = q(`set role service_role; select public.projection_apply_calendar_flags(
        '${a.p_restaurant_id}','${a.p_from}','${a.p_until}','${a.p_context_digest}',${json(a.p_nights)});`);
      return { data: JSON.parse(raw), error: null };
    }
    throw new Error('Unknown test RPC');
  } catch (error) {
    const message = error.stderr || error.message;
    return { data: null, error: { code: message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1], message } };
  }
} };

function asyncSQL(sql) {
  return new Promise(resolve => {
    const child = spawn('docker', args);
    let output = '', error = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('close', code => resolve({ code, output, error }));
    child.on('error', failure => resolve({ code: -1, error: failure.message }));
    child.stdin.end(sql);
  });
}

before(async () => {
  docker(['run', '--detach', '--name', container, '-e', `POSTGRES_PASSWORD=${randomUUID()}`, 'postgres:17']);
  started = true;
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
    catch { await delay(250); }
  }
  assert.ok(ready, 'Local PostgreSQL did not start');
  q(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public,auth to service_role;
    grant execute on function auth.uid() to service_role;
    create table public.restaurants(id uuid primary key,user_id uuid,operational_timezone text,deactivated_at timestamptz);
    create table public.menu_items(id uuid primary key,restaurant_id uuid references public.restaurants on delete cascade);
    create table public.pos_connections(id uuid primary key,restaurant_id uuid references public.restaurants on delete cascade,
      provider text,status text,shift4_timezone text);
    grant select on public.restaurants,public.menu_items,public.pos_connections to service_role;
    create function public.purge_restaurant(target uuid) returns void
    language plpgsql security definer set search_path='' as $$ begin
      delete from public.menu_items where restaurant_id=target;
      delete from public.restaurants where id=target;
    end $$;
    revoke all on function public.purge_restaurant(uuid) from public;
    grant execute on function public.purge_restaurant(uuid) to service_role;
    insert into public.restaurants values
      ('${REST}','${OWNER}','America/New_York',null),('${OTHER}','${FOREIGN}','Asia/Tokyo',null);`);
  for (const file of ['20261119222523_projection_foundation.sql', '20261120142918_projection_ingestion.sql',
    '20261120171521_projection_calendar.sql']) {
    q(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
});
after(() => { if (started) docker(['rm', '--force', container]); });

test('calendar storage is server-only, RLS is enabled and version history is immutable', () => {
  for (const role of ['anon', 'authenticated']) {
    rejects(`set role ${role}; select public.projection_calendar_context('${REST}');`, /permission denied/);
    rejects(`set role ${role}; select * from public.projection_calendar_versions;`, /permission denied/);
  }
  rejects(`set role service_role; insert into public.projection_calendar_versions
    (restaurant_id,revision,settings) values ('${REST}',2,${json(config())});`, /permission denied/);
  rejects(`update public.projection_calendar_versions set effective_from='2026-01-01';`, /append-only/);
  assert.equal(q(`select relrowsecurity from pg_class where oid='public.projection_calendar_versions'::regclass;`), 't');
});

test('the migration initializes every restaurant and seeds all 60 concept holiday defaults', () => {
  assert.equal(context().revision, 0);
  assert.equal(context().versions[0].settings.concept_type, null);
  assert.equal(q(`select count(*) from public.projection_holiday_rule_versions where restaurant_id is null;`), '60');
  assert.equal(q(`select count(*) from public.projection_calendar_versions where revision=0;`), '2');
});

test('SQL and JavaScript holiday arithmetic agree for the v4 years and century boundaries', () => {
  for (const year of [2024, 2025, 2026, 2027, 2028, 2100]) {
    const rows = JSON.parse(q(`select jsonb_agg(to_jsonb(d) order by holiday_date,holiday_key collate "C")
      from projection_private.core_calendar_dates(${year}) d;`));
    assert.deepEqual(rows, projectionHolidayDates(year));
  }
});

test('initial owner answers cover backfilled history and identical retries write no duplicate version', () => {
  const saved = save(0);
  assert.equal(saved.revision, 1);
  assert.equal(saved.effective_from, null);
  assert.equal(save(0).changed, false);
  assert.equal(context('2024-12-24').versions.at(-1).revision, 1);
});

test('the overlap keeps both holidays and its raw default factor is 0.96', async () => {
  const read = await readProjectionCalendar(database, { restaurantId: REST, from: '2027-02-14', until: '2027-02-14' });
  assert.deepEqual(read.nights[0].holiday_keys, ['super_bowl', 'valentines_day']);
  assert.ok(Math.abs(read.nights[0].default_factor - 0.96) < 1e-12);
});

test('an owner can read and save only their own restaurant and malformed answers reject atomically', () => {
  rejects(`set role service_role; select public.projection_calendar_context('${REST}',null,null,'${FOREIGN}');`, /OWNER_REQUIRED/);
  rejects(saveSQL(1, config(), null, FOREIGN), /OWNER_REQUIRED/);
  rejects(saveSQL(1, { ...config(), concept_type: 'fine_dining' }), /INVALID_OWNER_ANSWERS/);
  rejects(saveSQL(1, { ...config(), holiday_answers: { super_bowl: 'closed' } }), /INVALID_OWNER_ANSWERS/);
  assert.equal(context().revision, 1);
});

test('later answer changes start today and a dated correction preserves later snapshots', () => {
  const current = context();
  const changed = { ...config(), normally_closed_weekdays: [5] };
  assert.equal(save(1, changed).effective_from, current.today);
  assert.equal(save(2, config(), '2024-01-01').revision, 3);
  assert.equal(context().revision, 3);
  rejects(saveSQL(1, { ...config(), concept_type: 'bar_pub' }), /PT409/);
  rejects(saveSQL(3, config(), '9999-01-01'), /INVALID_EFFECTIVE_DATE/);
});

test('applying calendar flags preserves POS facts, completeness, actual closures and unrelated metadata', async () => {
  q(`insert into public.projection_dishes(id,restaurant_id,forecastable,launch_date)
    values ('${R(200)}','${REST}',true,'2024-01-01');
    insert into public.projection_nightly_dish_facts
      (restaurant_id,business_date,dish_id,units,recommended,sold_out,source_revision)
    values ('${REST}','${DAY}','${R(200)}',2,false,true,'native-fact');
    insert into public.projection_nightly_flags
    (restaurant_id,business_date,complete,total_units,closed,recommendation_flags_complete,outlier_status,source_revision,flags)
    values ('${REST}','${DAY}',true,2,true,true,'provisional','native-source','{"ingestion":{"ok":true}}');`);
  const read = await readProjectionCalendar(database, { restaurantId: REST, from: DAY, until: DAY });
  assert.equal(read.nights[0].closed, true);
  assert.equal((await applyProjectionCalendarFlags(database, read)).changed_nights, 1);
  assert.equal(q(`select complete and total_units=2 and closed and recommendation_flags_complete
    and outlier_status='provisional' and source_revision='native-source' and flags#>>'{ingestion,ok}'='true'
    from public.projection_nightly_flags where restaurant_id='${REST}' and business_date='${DAY}';`), 't');
  assert.equal(q(`select units=2 and not recommended and sold_out and source_revision='native-fact'
    from public.projection_nightly_dish_facts where restaurant_id='${REST}';`), 't');
  const again = await readProjectionCalendar(database, { restaurantId: REST, from: DAY, until: DAY });
  assert.equal((await applyProjectionCalendarFlags(database, again)).changed_nights, 0);
});

test('calendar-only holiday rows remain incomplete and never invent source totals', async () => {
  const read = await readProjectionCalendar(database, { restaurantId: REST, from: '2024-12-24', until: '2024-12-25' });
  await applyProjectionCalendarFlags(database, read);
  assert.equal(q(`select bool_and(not complete and total_units is null)
    from public.projection_nightly_flags where restaurant_id='${REST}' and business_date between '2024-12-24' and '2024-12-25';`), 't');
});

test('stale contexts and partial calendar batches reject without saved changes', async () => {
  const read = await readProjectionCalendar(database, { restaurantId: REST, from: '2026-01-02', until: '2026-01-03' });
  const args = { ...read, nights: read.nights.slice(0, 1) };
  await assert.rejects(applyProjectionCalendarFlags(database, args), error => error.code === '22023');
  save(3, { ...config(), holiday_answers: { christmas_day: 'open' } }, '2024-01-01');
  await assert.rejects(applyProjectionCalendarFlags(database, read), error => error.code === 'PT409');
  assert.equal(q(`select count(*) from public.projection_nightly_flags
    where restaurant_id='${REST}' and business_date between '2026-01-02' and '2026-01-03';`), '0');
});

test('calendar corrections clear only calendar-derived closure flags', async () => {
  const read = await readProjectionCalendar(database, { restaurantId: REST, from: '2024-12-25', until: '2024-12-25' });
  await applyProjectionCalendarFlags(database, read);
  assert.equal(q(`select closed from public.projection_nightly_flags
    where restaurant_id='${REST}' and business_date='2024-12-25';`), 'f');
});

test('missing scheduled sports years fail visibly rather than publishing an ordinary-day calendar', async () => {
  await assert.rejects(readProjectionCalendar(database,
    { restaurantId: REST, from: '2030-02-10', until: '2030-02-10' }),
  error => error.code === 'PROJECTION_CALENDAR_INCOMPLETE');
});

test('context hashes are stable across database session timezones', () => {
  const before = context();
  const digest = q(`set timezone='Asia/Tokyo'; set role service_role;
    select public.projection_calendar_context('${REST}','${DAY}','${DAY}')->>'context_digest';`);
  assert.equal(digest, before.context_digest);
});

test('a failure on a later flag row rolls back the whole batch and its audits', async () => {
  const read = await readProjectionCalendar(database, { restaurantId: REST, from: '2026-01-02', until: '2026-01-03' });
  const audits = q(`select count(*) from public.projection_change_log;`);
  q(`create function public.test_later_calendar_failure() returns trigger language plpgsql as $$ begin
    if new.business_date='2026-01-03' then raise exception 'Synthetic calendar failure'; end if;
    return new; end $$;
    create trigger test_later_calendar_failure before insert on public.projection_nightly_flags
    for each row execute function public.test_later_calendar_failure();`);
  try {
    await assert.rejects(applyProjectionCalendarFlags(database, read), /Synthetic calendar failure/);
    assert.equal(q(`select count(*) from public.projection_nightly_flags
      where restaurant_id='${REST}' and business_date between '2026-01-02' and '2026-01-03';`), '0');
    assert.equal(q(`select count(*) from public.projection_change_log;`), audits);
  } finally {
    q(`drop trigger test_later_calendar_failure on public.projection_nightly_flags;
      drop function public.test_later_calendar_failure();`);
  }
});

test('a newly effective global setting fences an old calendar batch', async () => {
  const read = await readProjectionCalendar(database, { restaurantId: REST, from: DAY, until: DAY });
  q(`insert into public.projection_setting_versions(model_major,effective_at,settings)
    select model_major,clock_timestamp(),settings||'{"early_close_factor":0.7,"horizon_days":8.0}'::jsonb
    from public.projection_setting_versions where restaurant_id is null
    order by effective_at desc limit 1;`);
  await assert.rejects(applyProjectionCalendarFlags(database, read), error => error.code === 'PT409');
});

test('more than ten thousand answer versions are read without a row-limit cutoff', () => {
  const snapshot = context();
  const before = snapshot.revision;
  q(`insert into public.projection_calendar_versions(restaurant_id,revision,effective_from,settings,actor_id)
    select '${REST}',${before}+n,'2020-01-01',${json(config())},'${OWNER}' from generate_series(1,10001) n;`);
  const value = context();
  assert.equal(value.revision, before + 10001);
  assert.equal(value.versions.length, snapshot.versions.length + 10001);
});

test('competing owner edits save one revision and return one explicit conflict', async () => {
  const expected = context().revision;
  const replies = await Promise.all([
    asyncSQL(saveSQL(expected, { ...config(), concept_type: 'bar_pub' })),
    asyncSQL(saveSQL(expected, { ...config(), concept_type: 'quick_service' })),
  ]);
  assert.equal(replies.filter(reply => reply.code === 0).length, 1);
  assert.match(replies.find(reply => reply.code !== 0).error, /PT409/);
  assert.equal(context().revision, expected + 1);
});

test('owner saves and native timezone updates finish without a row-lock cycle', async () => {
  const expected = context().revision;
  const owner = asyncSQL(`begin; set local lock_timeout='4s';
    select pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:${REST}',0));
    select pg_sleep(1);
    ${saveSQL(expected, { ...config(), concept_type: 'full_service' })}
    commit;`);
  const timezone = asyncSQL(`begin; set local lock_timeout='4s';
    select pg_sleep(0.2);
    update public.restaurants set operational_timezone='Asia/Tokyo' where id='${REST}';
    commit;`);
  const results = await Promise.all([owner, timezone]);
  assert.ok(results.every(result => result.code === 0), JSON.stringify(results));
  q(`update public.restaurants set operational_timezone='America/New_York' where id='${REST}';`);
});

test('permanent account purge removes and counts calendar versions while global dates remain', () => {
  const count = q(`select count(*) from public.projection_calendar_versions where restaurant_id='${REST}';`);
  q(`set role service_role; select public.purge_restaurant('${REST}');`);
  assert.equal(q(`select count(*) from public.projection_calendar_versions where restaurant_id='${REST}';`), '0');
  assert.equal(q(`select deleted_rows->>'projection_calendar_versions' from public.projection_account_purge_log;`), count);
  assert.equal(q(`select count(*) from public.projection_calendar_versions where restaurant_id='${OTHER}';`), '1');
  assert.equal(q(`select count(*) from public.projection_holiday_calendar where holiday_date='2027-02-14';`), '2');
});