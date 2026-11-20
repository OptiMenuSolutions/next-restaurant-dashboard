import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { projectionHolidayDates, projectionCalendarWeekday } from '../lib/projections/calendar.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
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
const config = () => ({ concept_type: 'full_service', normally_closed_weekdays: [] });
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
  docker(['run', '--detach', '--name', container, '--read-only',
    '--tmpfs', '/var/lib/postgresql/data', '--tmpfs', '/var/run/postgresql', '--tmpfs', '/tmp',
    '-e', `POSTGRES_PASSWORD=${randomUUID()}`, 'postgres:17']);
  started = true;
  let ready = false;
  for (let n = 0; n < 160; n++) {
    try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
    catch { await delay(250); }
  }
  assert.ok(ready, ready ? '' : `Local PostgreSQL did not start: ${docker(['logs', container])}`);
  q(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public,auth to service_role;
    grant execute on function auth.uid() to service_role;
    create table public.restaurants(id uuid primary key,user_id uuid,operational_timezone text,deactivated_at timestamptz,name text default 'Fixture');
    create table public.profiles(id uuid primary key,role text);
    insert into public.profiles values ('${OWNER}','client'),('${FOREIGN}','client'),('${R(103)}','admin');
    grant select on public.profiles to service_role;
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
    insert into public.restaurants(id,user_id,operational_timezone,deactivated_at) values
      ('${REST}','${OWNER}','America/New_York',null),('${OTHER}','${FOREIGN}','Asia/Tokyo',null);`);
  for (const file of ['20261119222523_projection_foundation.sql', '20261120142918_projection_ingestion.sql',
    '20261120171521_projection_calendar.sql']) {
    q(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
});
after(() => { if (started) docker(['rm', '--force', '--volumes', container]); });

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

test('the overlap keeps both holidays and its raw default factor is 0.96', () => {
  q(`select public.projection_prepare_calendar('2027-02-14','2027-02-14');`);
  const ctx = context('2027-02-14');
  // A calculation fixture has an explicit business date; production clocks are untouched.
  const night = JSON.parse(q(`select projection_private.derive_calendar_night(
    ${json({ ...ctx, today: '2026-11-20' })},'2027-02-14');`));
  assert.deepEqual(night.holiday_keys, ['super_bowl', 'valentines_day']);
  assert.ok(Math.abs(night.default_factor - 0.96) < 1e-12);
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
  save(3, { ...config(), normally_closed_weekdays: [2] }, '2024-01-01');
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

test('December forecasts cross an unpublished sports year; February still requires its date', async () => {
  const read = await readProjectionCalendar(database,
    { restaurantId: REST, from: '2028-12-28', until: '2029-01-04' });
  assert.equal(read.nights.length, 8);
  await assert.rejects(readProjectionCalendar(database,
    { restaurantId: REST, from: '2029-01-31', until: '2029-02-01' }),
  error => error.code === 'PROJECTION_CALENDAR_INCOMPLETE');
});

test('database derivation uses full service when optional setup is missing', async () => {
  const read = await readProjectionCalendar(database, { restaurantId: OTHER, from: DAY, until: DAY });
  assert.equal(read.nights[0].concept_fallback, true);
  await applyProjectionCalendarFlags(database, read);
});

test('database derivation also refuses an unpublished February calendar', () => {
  rejects(`begin;
    delete from public.projection_holiday_calendar where holiday_key='super_bowl' and holiday_date='2024-02-11';
    set local role service_role;
    select public.projection_apply_calendar_flags('${REST}','2024-02-11','2024-02-11',
      public.projection_calendar_context('${REST}','2024-02-11','2024-02-11')->>'context_digest',
      '[{"business_date":"2024-02-11"}]'::jsonb);`, /PROJECTION_CALENDAR_INCOMPLETE/);
  assert.equal(q(`select count(*) from public.projection_holiday_calendar where holiday_key='super_bowl' and holiday_date='2024-02-11';`), '1');
});

test('real past POS sales override weekly closures and expose a conflict without promoting completeness', async () => {
  save(context().revision, { ...config(), normally_closed_weekdays: [1] }, '2026-01-01');
  q(`insert into public.projection_nightly_flags
    (restaurant_id,business_date,complete,total_units,source_revision)
    values ('${REST}','2026-11-09',false,42,'pos-proof');`);
  const read = await readProjectionCalendar(database,
    { restaurantId: REST, from: '2026-11-09', until: '2026-11-09' });
  assert.equal(read.nights[0].closed, false);
  await applyProjectionCalendarFlags(database, read);
  assert.equal(q(`select not closed and not complete and total_units=42
    from public.projection_nightly_flags where restaurant_id='${REST}' and business_date='2026-11-09';`), 't');
  assert.equal(Object.hasOwn(context(), 'closure_conflicts'), false);
});

test('saved closure flags cannot override the database decision that POS proves past service', async () => {
  q(`update public.projection_nightly_flags set closed=true,
    flags=jsonb_set(flags,'{calendar,legacy_closed}','true'::jsonb)
    where restaurant_id='${REST}' and business_date='2026-11-09';`);
  const read = await readProjectionCalendar(database,
    { restaurantId: REST, from: '2026-11-09', until: '2026-11-09' });
  assert.equal(read.nights[0].closed, false);
  await applyProjectionCalendarFlags(database, read);
  assert.equal(q(`select not closed and flags#>>'{calendar,legacy_closed}'='true'
    from public.projection_nightly_flags where restaurant_id='${REST}' and business_date='2026-11-09';`), 't');
});

test('POS corrections fence old batches and clear conflicts when the evidence is below threshold', async () => {
  const old = await readProjectionCalendar(database,
    { restaurantId: REST, from: '2026-11-09', until: '2026-11-09' });
  q(`update public.projection_nightly_flags set total_units=2,source_revision='corrected-pos'
    where restaurant_id='${REST}' and business_date='2026-11-09';`);
  await assert.rejects(applyProjectionCalendarFlags(database, old), error => error.code === 'PT409');
  const fresh = await readProjectionCalendar(database,
    { restaurantId: REST, from: '2026-11-09', until: '2026-11-09' });
  assert.equal(fresh.nights[0].closed, false);
  await applyProjectionCalendarFlags(database, fresh);
  assert.equal(q(`select not closed and not complete and flags#>>'{calendar,classification_source}'='incomplete_pos'
    from public.projection_nightly_flags where restaurant_id='${REST}' and business_date='2026-11-09';`), 't');
});

test('past holiday closures with sales become open while holiday identity and source facts remain', async () => {
  save(context().revision, config(), '2024-01-01');
  q(`update public.projection_nightly_flags set total_units=42,complete=true,source_revision='christmas-pos'
    where restaurant_id='${REST}' and business_date='2024-12-25';`);
  const read = await readProjectionCalendar(database,
    { restaurantId: REST, from: '2024-12-25', until: '2024-12-25' });
  assert.equal(read.nights[0].closed, false);
  assert.equal(read.nights[0].default_factor, 1);
  assert.deepEqual(read.nights[0].holiday_keys, ['christmas_day']);
  await applyProjectionCalendarFlags(database, read);
  assert.equal(q(`select complete and total_units=42 and not closed and source_revision='christmas-pos'
    from public.projection_nightly_flags where restaurant_id='${REST}' and business_date='2024-12-25';`), 't');
});

test('the database independently rejects forged closure, early-close, factor and conflict values', async () => {
  const read = await readProjectionCalendar(database,
    { restaurantId: REST, from: '2024-12-24', until: '2024-12-25' });
  const original = read.nights[0];
  for (const patch of [{ closed: !original.closed }, { early_close: !original.early_close },
    { default_factor: 9 }, { regular_service: true }, { closure_conflict: {} }]) {
    const nights = [{ ...original, ...patch }, read.nights[1]];
    await assert.rejects(applyProjectionCalendarFlags(database, { ...read, nights }),
      error => error.code === '22023');
  }
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

test('optional setup saves before a timezone exists and administrators can edit the concept', () => {
  q(`update public.restaurants set operational_timezone=null where id='${REST}';`);
  const expected = contextRevision();
  try {
    assert.equal(save(expected, { ...config(), concept_type: 'bar_pub' }).changed, true);
    const setup = JSON.parse(q(`set role service_role; select public.projection_calendar_setup('${REST}','${OWNER}');`));
    assert.equal(setup.settings.concept_type, 'bar_pub');
    assert.equal(setup.timezone, null);
    rejects(`set role service_role; select public.projection_calendar_setup('${REST}','${FOREIGN}');`, /OWNER_REQUIRED/);
    assert.equal(save(setup.revision, { ...config(), concept_type: 'quick_service' }, null, R(103)).changed, true);
  } finally { q(`update public.restaurants set operational_timezone='America/New_York' where id='${REST}';`); }
  save(context().revision, config());
});

function contextRevision() {
  return Number(q(`select coalesce(max(revision),0) from public.projection_calendar_versions where restaurant_id='${REST}';`));
}

let nextMonday;
let fourMondays;
let promptDate;
let promptAt;
test('four complete source-covered empty weekdays close future service; sales override the optional answer', async () => {
  const today = context().today;
  nextMonday = shiftProjectionDate(today, (1 - projectionCalendarWeekday(today) + 7) % 7);
  fourMondays = [1, 2, 3, 4].map(weeks => shiftProjectionDate(nextMonday, -7 * weeks));
  q(`insert into public.pos_connections(id,restaurant_id,provider,status,shift4_timezone)
    values ('${R(400)}','${REST}','fixture','connected','America/New_York');
    insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision)
    select '${REST}',day,true,0,'weekday-proof' from unnest(array[${fourMondays.map(day => `'${day}'::date`).join(',')}]) day
    on conflict(restaurant_id,business_date) do update set complete=true,total_units=0,source_revision='weekday-proof';`);
  let read = await readProjectionCalendar(database, { restaurantId: REST, from: nextMonday, until: nextMonday });
  assert.equal(read.nights[0].closed, true);
  assert.equal(read.nights[0].weekday_source, 'pos_last_four');
  q(`update public.projection_nightly_flags set total_units=42 where restaurant_id='${REST}' and business_date='${fourMondays[1]}';`);
  save(context().revision, { ...config(), normally_closed_weekdays: [1] });
  read = await readProjectionCalendar(database, { restaurantId: REST, from: nextMonday, until: nextMonday });
  assert.equal(read.nights[0].closed, false);
  const ctx = context(nextMonday);
  const derived = JSON.parse(q(`select projection_private.derive_calendar_night(${json({ ...ctx, as_of: ctx.as_of })},'${nextMonday}');`));
  assert.deepEqual(read.nights[0], derived);
});

test('incomplete occurrences are excluded and the POS-only past rule retains an admin-only disagreement', async () => {
  q(`update public.projection_nightly_flags set complete=false where restaurant_id='${REST}' and business_date='${fourMondays[0]}';`);
  const next = await readProjectionCalendar(database, { restaurantId: REST, from: nextMonday, until: nextMonday });
  assert.equal(next.nights[0].weekday_source, 'optional_onboarding');
  assert.equal(next.nights[0].closed, true);
  const past = await readProjectionCalendar(database, { restaurantId: REST, from: fourMondays[1], until: fourMondays[1] });
  assert.equal(past.nights[0].closed, false);
  // Use an explicit dated correction so the historical optional schedule is known.
  save(context().revision, { ...config(), normally_closed_weekdays: [1] }, fourMondays[1]);
  const corrected = await readProjectionCalendar(database, { restaurantId: REST, from: fourMondays[1], until: fourMondays[1] });
  assert.equal(corrected.nights[0].internal_diagnostic.owner_closed, true);
  await applyProjectionCalendarFlags(database, corrected);
  assert.equal(q(`select not closed and complete and total_units=42 and flags#>>'{calendar,internal_diagnostic,code}'='PROJECTION_CALENDAR_ANSWER_DISAGREEMENT'
    from public.projection_nightly_flags where restaurant_id='${REST}' and business_date='${fourMondays[1]}';`), 't');
});

const promptSQL = (action, date = null, answer = null, revision = null, at = promptAt, actor = OWNER) => `
  set role service_role; select projection_private.holiday_prompt('${REST}','${actor}','${action}',
    ${date ? `'${date}'` : 'null'},${answer ? `'${answer}'` : 'null'},${revision ?? 'null'},'${at}');`;

test('a popup is claimed at most once across concurrent requests and reappears for the next year only', async () => {
  const year = Number(context().today.slice(0, 4)) + 1;
  promptDate = projectionHolidayDates(year).find(row => row.holiday_key === 'thanksgiving_day').holiday_date;
  promptAt = `${shiftProjectionDate(promptDate, -9)}T12:00:00Z`;
  const replies = await Promise.all([asyncSQL(promptSQL('claim')), asyncSQL(promptSQL('claim'))]);
  assert.ok(replies.every(reply => reply.code === 0));
  const prompts = replies.map(reply => JSON.parse(reply.output.trim()).prompt).filter(Boolean);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].business_date, promptDate);
  assert.equal(JSON.parse(q(promptSQL('claim'))).prompt, null);
  const following = projectionHolidayDates(year + 1).find(row => row.holiday_key === 'thanksgiving_day').holiday_date;
  assert.equal(JSON.parse(q(promptSQL('claim', null, null, null, `${shiftProjectionDate(following, -9)}T12:00:00Z`))).prompt.business_date, following);
});

test('source-window coverage gates the four-occurrence rule independently of completeness', async () => {
  const today = context().today;
  const nextTuesday = shiftProjectionDate(today, (2 - projectionCalendarWeekday(today) + 7) % 7);
  const days = [1, 2, 3, 4].map(weeks => shiftProjectionDate(nextTuesday, -7 * weeks));
  q(`insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision)
    select '${REST}',day,true,0,'coverage-proof' from unnest(array[${days.map(day => `'${day}'::date`).join(',')}]) day
    on conflict(restaurant_id,business_date) do update set complete=true,total_units=0,source_revision='coverage-proof';
    update public.projection_pos_source_windows set valid_from='${days[2]}' where restaurant_id='${REST}';`);
  try {
    const read = await readProjectionCalendar(database, { restaurantId: REST, from: nextTuesday, until: nextTuesday });
    assert.equal(read.nights[0].weekday_observations, 3);
    assert.equal(read.nights[0].weekday_source, 'optional_onboarding');
    assert.deepEqual(read.nights[0], JSON.parse(q(`select projection_private.derive_calendar_night(${json(read.context)},'${nextTuesday}');`)));
  } finally { q(`update public.projection_pos_source_windows set valid_from=null where restaurant_id='${REST}';`); }
});

test('dated answers append revisions, exact retries are idempotent, stale and foreign writes reject', () => {
  assert.equal(JSON.parse(q(promptSQL('answer', promptDate, 'open', 0))).revision, 1);
  assert.equal(JSON.parse(q(promptSQL('answer', promptDate, 'open', 0))).changed, false);
  rejects(promptSQL('answer', promptDate, 'closed', 0), /PT409/);
  rejects(promptSQL('answer', promptDate, 'open', 1, undefined, FOREIGN), /OWNER_REQUIRED/);
  rejects(`update public.projection_holiday_answer_versions set answer='closed';`, /append-only/);
  rejects(`set role authenticated; select public.projection_holiday_prompt('${REST}','${OWNER}','claim');`, /permission denied/);
});

test('dated Open wins over the holiday default; early close is explicit and past dates ignore it', async () => {
  const today = context().today;
  const weekday = projectionCalendarWeekday(promptDate);
  const next = shiftProjectionDate(today, (weekday - projectionCalendarWeekday(today) + 7) % 7);
  const days = [1, 2, 3, 4].map(weeks => shiftProjectionDate(next, -7 * weeks));
  q(`insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision)
    select '${REST}',day,true,0,'closed-thursday' from unnest(array[${days.map(day => `'${day}'::date`).join(',')}]) day
    on conflict(restaurant_id,business_date) do update set complete=true,total_units=0,source_revision='closed-thursday';`);
  let read = await readProjectionCalendar(database, { restaurantId: REST, from: promptDate, until: promptDate });
  assert.equal(read.nights[0].closed, false);
  assert.equal(read.nights[0].resolved_holidays[0].answer_source, 'dated_popup');
  assert.equal(read.nights[0].weekday_observations, 4);
  assert.equal(JSON.parse(q(promptSQL('answer', promptDate, 'early_close', 1))).revision, 2);
  read = await readProjectionCalendar(database, { restaurantId: REST, from: promptDate, until: promptDate });
  const derived = JSON.parse(q(`select projection_private.derive_calendar_night(${json(read.context)},'${promptDate}');`));
  assert.deepEqual(read.nights[0], derived);
  assert.equal(read.nights[0].early_close, true);
});

test('last-year same-holiday data overrides its default without asking the owner', async () => {
  const today = context().today;
  const year = Number(today.slice(0, 4)) + (today.slice(5) > '12-25' ? 1 : 0);
  const date = `${year}-12-25`;
  const previous = `${year - 1}-12-25`;
  q(`insert into public.projection_nightly_flags(restaurant_id,business_date,complete,total_units,source_revision)
    values ('${REST}','${previous}',true,42,'last-year-holiday')
    on conflict(restaurant_id,business_date) do update set complete=true,total_units=42,source_revision='last-year-holiday';`);
  let read = await readProjectionCalendar(database, { restaurantId: REST, from: date, until: date });
  assert.equal(read.nights[0].closed, false);
  assert.equal(read.nights[0].resolved_holidays[0].answer_source, 'last_year_pos');
  q(`update public.projection_nightly_flags set total_units=0 where restaurant_id='${REST}' and business_date='${previous}';`);
  read = await readProjectionCalendar(database, { restaurantId: REST, from: date, until: date });
  assert.equal(read.nights[0].closed, true);
  assert.deepEqual(read.nights[0], JSON.parse(q(`select projection_private.derive_calendar_night(${json(read.context)},'${date}');`)));
});

test('permanent account purge removes and counts calendar versions while global dates remain', () => {
  const count = q(`select count(*) from public.projection_calendar_versions where restaurant_id='${REST}';`);
  assert.notEqual(q(`select count(*) from public.projection_holiday_answer_versions where restaurant_id='${REST}';`), '0');
  q(`set role service_role; select public.purge_restaurant('${REST}');`);
  assert.equal(q(`select count(*) from public.projection_calendar_versions where restaurant_id='${REST}';`), '0');
  assert.equal(q(`select count(*) from public.projection_holiday_answer_versions where restaurant_id='${REST}';`), '0');
  assert.equal(q(`select count(*) from public.projection_holiday_prompt_views where restaurant_id='${REST}';`), '0');
  assert.equal(q(`select deleted_rows->>'projection_calendar_versions' from public.projection_account_purge_log;`), count);
  assert.equal(q(`select count(*) from public.projection_calendar_versions where restaurant_id='${OTHER}';`), '1');
  assert.equal(q(`select count(*) from public.projection_holiday_calendar where holiday_date='2027-02-14';`), '2');
});