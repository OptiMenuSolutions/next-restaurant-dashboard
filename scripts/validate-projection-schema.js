import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PROJECTION_DEFAULTS,
  projectionSettingsDigest,
  projectionCalibrationKey,
} from '../lib/projections/settings.js';

// Run explicitly: npx tsx --test scripts/validate-projection-schema.js
// Disposable local PostgreSQL only. No application environment files are read.
// The minimal legacy purge fixture tests the wrapper, not every legacy table.
const container = `optimenu-projection-schema-${randomUUID()}`;

const R = n =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const DISH = R(100);
const RUN = R(200);
const OVERRIDE = R(300);

let started = false;

const docker = (args, options = {}) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000,
    ...options,
  });

const q = sql => docker([
  'exec',
  '-i',
  container,
  'psql',
  '-X',
  '-v',
  'ON_ERROR_STOP=1',
  '-qAt',
  '-U',
  'postgres',
], { input: sql }).trim();

function rejects(sql, pattern) {
  assert.throws(
    () => q(sql),
    error => pattern.test(String(error.stderr || error.message))
  );
}

function archive({
  id = RUN,
  override = 'null',
  key = '4|a=0.5|b=0.5|phi=0.8|vh=4|sh=4',
} = {}) {
  return `insert into public.projection_forecast_runs
    (id,restaurant_id,run_date,model_major,global_version_id,restaurant_version_id,
     settings_snapshot,settings_digest,calibration_key,source_through,trace)
    select '${id}','${R(1)}','2026-11-19',4,id,${override},settings,
      '${projectionSettingsDigest(PROJECTION_DEFAULTS)}','${key}','2026-11-18','{}'
    from public.projection_setting_versions
    where restaurant_id is null and effective_at <= now()
    order by effective_at desc limit 1;`;
}

before(async () => {
  docker([
    'run',
    '--detach',
    '--name',
    container,
    '-e',
    `POSTGRES_PASSWORD=${randomUUID()}`,
    'postgres:17',
  ]);

  started = true;

  let ready = false;

  for (let i = 0; i < 80; i++) {
    try {
      docker([
        'exec',
        container,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
      ]);
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }

  assert.ok(ready, 'Disposable PostgreSQL did not become ready');

  q(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create schema auth;

    create function auth.uid() returns uuid
    language sql stable as $$ select null::uuid $$;

    grant usage on schema public, auth to service_role;
    grant execute on function auth.uid() to service_role;

    create table public.restaurants(
      id uuid primary key,
      user_id uuid,
      operational_timezone text,
      deactivated_at timestamptz
    );

    create table public.menu_items(
      id uuid primary key,
      restaurant_id uuid references public.restaurants on delete cascade
    );

    grant select on public.restaurants, public.menu_items to service_role;

    create function public.purge_restaurant(target uuid) returns void
    language plpgsql security definer set search_path = '' as $$
    begin
      delete from public.menu_items where restaurant_id = target;
      delete from public.restaurants where id = target;
    end
    $$;

    revoke all on function public.purge_restaurant(uuid) from public;
    grant execute on function public.purge_restaurant(uuid) to service_role;
  `);

  q(readFileSync(new URL(
    '../supabase/migrations/20261119222523_projection_foundation.sql',
    import.meta.url
  ), 'utf8'));

  q(`
    insert into public.restaurants(id, operational_timezone) values
      ${[1, 2, 3, 4, 5, 6].map(n =>
        `('${R(n)}','America/New_York')`
      ).join(',')};

    insert into public.menu_items values ('${DISH}','${R(1)}');

    set role service_role;

    insert into public.projection_dishes
      (id, restaurant_id, menu_item_id, forecastable)
    values ('${DISH}','${R(1)}','${DISH}',true);
  `);
});

after(() => {
  if (started) docker(['rm', '--force', container]);
});

test('all projection tables have RLS and no frontend grants', () => {
  assert.equal(q(`
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind='r'
      and starts_with(c.relname,'projection_')
      and (
        not c.relrowsecurity
        or has_table_privilege('anon',c.oid,'select')
        or has_table_privilege('authenticated',c.oid,'select')
      );
  `), '0');
});

test('seeded settings are disabled, complete and internally valid', () => {
  assert.equal(q(`
    select projection_private.check_settings(settings)
      and not (settings->>'enabled')::boolean
      and not (settings->>'pooled_benchmarks_enabled')::boolean
    from public.projection_setting_versions
    where restaurant_id is null;
  `), 't');

  assert.deepEqual(JSON.parse(q(`
    select settings
    from public.projection_setting_versions
    where restaurant_id is null;
  `)), PROJECTION_DEFAULTS);

  assert.equal(q(`
    select calibration_key
    from public.projection_model_versions
    where model_major=4;
  `), '4|a=0.5|b=0.5|phi=0.8|vh=4|sh=4');
});

test('global major defaults cannot drift; scalar and privacy violations reject', () => {
  rejects(`
    insert into public.projection_setting_versions
      (model_major,effective_at,settings)
    select 4, now()+interval '1 day',
      settings || '{"trend_damping":0.7}'
    from public.projection_setting_versions;
  `, /new model version/);

  for (const override of [
    '{"minimum_pooled_restaurants":4}',
    '{"base_window_weeks":17}',
    '{"unknown":1}',
  ]) {
    rejects(`
      insert into public.projection_setting_versions
        (restaurant_id,model_major,effective_at,settings)
      values ('${R(1)}',4,now(),'${override}');
    `, /constraint|valid effective/);
  }
});

test('foreign menu items and foreign dish mappings cannot cross tenants', () => {
  rejects(`
    set role service_role;
    insert into public.projection_dishes(restaurant_id,menu_item_id)
    values ('${R(2)}','${DISH}');
  `, /another restaurant/);

  rejects(`
    set role service_role;
    insert into public.projection_pos_item_map
      (restaurant_id,pos_system,external_item_id,dish_id,valid_from)
    values ('${R(2)}','test','item','${DISH}','2026-11-01');
  `, /foreign key/);
});

test('POS mapping intervals cannot overlap and adjacent versions work', () => {
  q(`
    set role service_role;
    insert into public.projection_pos_item_map
      (restaurant_id,pos_system,external_item_id,dish_id,valid_from,valid_until)
    values (
      '${R(1)}','test','item','${DISH}','2026-11-01','2026-11-10'
    );
  `);

  rejects(`
    set role service_role;
    insert into public.projection_pos_item_map
      (restaurant_id,pos_system,external_item_id,dish_id,valid_from)
    values ('${R(1)}','test','item','${DISH}','2026-11-09');
  `, /overlap/);

  q(`
    set role service_role;
    insert into public.projection_pos_item_map
      (restaurant_id,pos_system,external_item_id,dish_id,valid_from)
    values ('${R(1)}','test','item','${DISH}','2026-11-10');
  `);
});

test('caller session variables cannot bypass mutable-row audit logging', () => {
  q(`
    set role service_role;
    set optimenu.projection_purge_restaurant = '${R(1)}';

    insert into public.projection_restaurant_config
      (restaurant_id, concept_type)
    values ('${R(1)}','full_service');

    update public.projection_restaurant_config
    set concept_type='bar_pub'
    where restaurant_id='${R(1)}';
  `);

  assert.equal(q(`
    select count(*)
    from public.projection_change_log
    where restaurant_id='${R(1)}'
      and table_name='projection_restaurant_config';
  `), '2');

  rejects(`
    set role service_role;
    insert into projection_private.purge_context
    values (pg_backend_pid(),txid_current(),'${R(1)}');
  `, /permission denied/);
});

test('archives reject foreign overrides and invalid calibration identities', () => {
  q(`
    insert into public.projection_setting_versions
      (id,restaurant_id,model_major,effective_at,settings)
    values ('${OVERRIDE}','${R(2)}',4,now(),'{}');
  `);

  rejects(
    archive({ override: `'${OVERRIDE}'` }),
    /override context/
  );

  rejects(archive({ key: 'wrong' }), /calibration key/);

  q(`set role service_role; ${archive()}`);
});

test('ordinary reruns are unique and forced supersession preserves the original', () => {
  rejects(archive({ id: R(201) }), /duplicate key/);

  q(`
    insert into public.projection_forecast_runs
      (
        id,restaurant_id,run_date,model_major,global_version_id,
        settings_snapshot,settings_digest,calibration_key,
        source_through,trace,supersedes_id
      )
    select
      '${R(201)}',restaurant_id,run_date,model_major,global_version_id,
      settings_snapshot,settings_digest,calibration_key,
      source_through,trace,id
    from public.projection_forecast_runs
    where id='${RUN}';
  `);

  assert.equal(q(`
    select count(*) from public.projection_forecast_runs;
  `), '2');

  rejects(
    archive({ id: R(202) })
      .replace(
        'source_through,trace)',
        'source_through,trace,supersedes_id)'
      )
      .replace(
        "'2026-11-18','{}'",
        `'2026-11-18','{}','${R(202)}'`
      ),
    /check constraint/
  );
});

test('unavailable forecasts retain nulls; invalid ranges and target dates reject', () => {
  const prefix = `
    insert into public.projection_forecast_nights
      (
        restaurant_id,run_id,target_date,days_ahead,
        availability,expected,low,high,confidence,trace
      )
    values
  `;

  q(`${prefix}
    ('${R(1)}','${RUN}','2026-11-19',1,
     'needs_baseline',null,null,null,'Needs baseline','{}');
  `);

  rejects(`${prefix}
    ('${R(1)}','${RUN}','2026-11-20',2,
     'available',9,10,13,'Normal','{}');
  `, /check constraint/);

  rejects(`${prefix}
    ('${R(1)}','${RUN}','2026-11-28',3,
     'available',9,5,13,'Normal','{}');
  `, /run horizon/);

  rejects(`${prefix}
    ('${R(1)}','${RUN}','2026-11-20',2,
     'available',9,5,'NaN','Normal','{}');
  `, /check constraint/);
});

test('archives cannot be updated or deleted, including by the table owner', () => {
  rejects(`
    set role service_role;
    update public.projection_forecast_runs
    set trace='{}' where id='${RUN}';
  `, /permission denied/);

  rejects(`
    update public.projection_forecast_runs
    set trace='{}' where id='${RUN}';
  `, /append-only/);

  rejects(`
    delete from public.projection_forecast_runs
    where id='${RUN}';
  `, /append-only/);

  rejects(`
    truncate public.projection_model_versions cascade;
  `, /append-only/);
});

test('purge entry points and the secret salt are unavailable to frontend roles', () => {
  rejects(`
    set role authenticated;
    select public.purge_restaurant('${R(1)}');
  `, /permission denied/);

  rejects(`
    set role service_role;
    select public.purge_restaurant_before_projections('${R(1)}');
  `, /permission denied/);

  rejects(`
    set role service_role;
    select * from projection_private.purge_salt;
  `, /permission denied/);
});

test('pooled values require five participants and hide immediately after a purge', () => {
  q(`
    insert into public.projection_setting_versions
      (model_major,effective_at,settings)
    select
      4,
      clock_timestamp(),
      settings || '{"pooled_benchmarks_enabled":true}'
    from public.projection_setting_versions
    where restaurant_id is null
    order by effective_at desc
    limit 1;

    insert into public.projection_pool_cohorts
    values ('test','full_service','NJ',null);

    insert into public.projection_pool_permissions
      (restaurant_id,agreement_permits,enabled,agreement_version)
    select id,true,true,'test'
    from public.restaurants where id <> '${R(1)}';

    insert into public.projection_pool_memberships
      (restaurant_id,cohort_key,eligible)
    select id,'test',true
    from public.restaurants where id <> '${R(1)}';
  `);

  rejects(`
    insert into public.projection_pooled_totals
      (
        cohort_key,metric,period_start,period_end,
        participant_count,statistics
      )
    values (
      'test','volume','2026-11-01','2026-11-07',4,'{"sum":100}'
    );
  `, /check constraint/);

  q(`
    insert into public.projection_pooled_totals
      (
        cohort_key,metric,period_start,period_end,
        participant_count,statistics
      )
    values (
      'test','volume','2026-11-01','2026-11-07',5,'{"sum":100}'
    );
  `);

  assert.equal(q(`
    set role service_role;
    select count(*) from public.projection_available_pooled_totals;
  `), '1');

  q(`
    set role service_role;
    select public.purge_restaurant('${R(6)}');
  `);

  assert.equal(q(`
    set role service_role;
    select count(*) from public.projection_available_pooled_totals;
  `), '0');

  assert.equal(q(`
    select count(*) from public.projection_pooled_totals;
  `), '1');
});

test('holiday observations have one original and a single correction chain', () => {
  const insert = (id, supersedes = 'null', day = '2026-02-14') => `
    insert into public.projection_holiday_observations
      (
        id,restaurant_id,business_date,holiday_keys,
        observed_ratio,trace,supersedes_id
      )
    values (
      '${R(id)}','${R(1)}','${day}',
      '{super_bowl,valentines_day}',1,'{}',${supersedes}
    );
  `;

  q(insert(500));
  rejects(insert(501), /duplicate key/);

  q(insert(502, `'${R(500)}'`));
  rejects(insert(503, `'${R(500)}'`), /duplicate key/);

  rejects(
    insert(504, `'${R(502)}'`, '2026-02-15'),
    /foreign key/
  );

  q(insert(505, `'${R(502)}'`));

  assert.equal(q(`
    set role service_role;
    select id
    from public.projection_current_holiday_observations
    where restaurant_id='${R(1)}';
  `), R(505));
});

test('launches cannot be duplicated and corrections cannot branch or change launch identity', () => {
  q(`
    insert into public.projection_style_categories
    values ('review','Review','{}');
  `);

  const insert = (
    id,
    supersedes = 'null',
    launch = '2026-09-01'
  ) => `
    insert into public.projection_launch_history
      (
        id,restaurant_id,dish_id,style_category,launch_date,
        observed_through,existing_dishes,first_four_week_share,
        launch_index,trace,supersedes_id
      )
    values (
      '${R(id)}','${R(1)}','${DISH}','review','${launch}',
      '2026-10-01',2,0.2,0.6,'{}',${supersedes}
    );
  `;

  q(insert(510));
  rejects(insert(511), /duplicate key/);

  q(insert(512, `'${R(510)}'`));
  rejects(insert(513, `'${R(510)}'`), /duplicate key/);

  rejects(
    insert(514, `'${R(512)}'`, '2026-09-02'),
    /foreign key/
  );

  q(insert(515, `'${R(512)}'`));

  assert.equal(q(`
    set role service_role;
    select id
    from public.projection_current_launch_history
    where restaurant_id='${R(1)}';
  `), R(515));
});

test('holiday arrays reject unsorted, duplicate, null and blank keys in both tables', () => {
  for (const keys of [
    "'{valentines_day,super_bowl}'",
    "'{super_bowl,super_bowl}'",
    "array['']",
    "array['super_bowl',null]",
    "array['super bowl']",
  ]) {
    rejects(`
      insert into public.projection_nightly_flags
        (restaurant_id,business_date,holiday_keys)
      values ('${R(1)}','2026-03-01',${keys});
    `, /check constraint/);

    rejects(`
      insert into public.projection_holiday_observations
        (
          restaurant_id,business_date,holiday_keys,
          observed_ratio,trace
        )
      values ('${R(1)}','2026-03-01',${keys},1,'{}');
    `, /check constraint/);
  }

  q(`
    set role service_role;
    insert into public.projection_nightly_flags
      (restaurant_id,business_date,holiday_keys)
    values
      ('${R(1)}','2026-03-01','{super_bowl,valentines_day}'),
      ('${R(1)}','2026-03-02','{}');
  `);
});

test('holiday rule weekday groups use only the approved identifiers', () => {
  const insert = group => `
    insert into public.projection_holiday_rule_versions
      (
        concept_type,holiday_key,weekday_group,
        effective_at,default_factor,default_answer
      )
    values (
      'full_service','valentines_day','${group}',
      clock_timestamp(),1,'open'
    );
  `;

  rejects(insert('mon-thurs'), /check constraint/);

  for (const group of ['all', 'mon_thu', 'fri_sat', 'sun']) {
    q(insert(group));
  }
});

test('restaurant pool switches are rejected by the database too', () => {
  for (const enabled of [true, false]) {
    rejects(`
      insert into public.projection_setting_versions
        (restaurant_id,model_major,effective_at,settings)
      values (
        '${R(1)}',4,clock_timestamp(),
        '${JSON.stringify({ pooled_benchmarks_enabled: enabled })}'
      );
    `, /check constraint/);
  }
});

test('global updates validate existing overrides and identify the conflicting values', () => {
  q(`
    insert into public.projection_setting_versions
      (restaurant_id,model_major,effective_at,settings)
    values (
      '${R(1)}',4,clock_timestamp(),
      '{"volume_half_width_near":0.20}'
    );
  `);

  rejects(`
    insert into public.projection_setting_versions
      (model_major,effective_at,settings)
    select
      4,
      clock_timestamp(),
      settings || '{"volume_half_width_far":0.18}'
    from public.projection_setting_versions
    where restaurant_id is null
      and effective_at<=clock_timestamp()
    order by effective_at desc
    limit 1;
  `, /volume_half_width_near exceeds volume_half_width_far/);

  q(`
    insert into public.projection_setting_versions
      (model_major,effective_at,settings)
    select
      4,
      clock_timestamp(),
      settings || '{"volume_half_width_far":0.30}'
    from public.projection_setting_versions
    where restaurant_id is null
      and effective_at<=clock_timestamp()
    order by effective_at desc
    limit 1;
  `);
});

test('scheduled changes cannot create an incompatible future overlap', () => {
  q(`
    insert into public.projection_setting_versions
      (model_major,effective_at,settings)
    select
      4,
      clock_timestamp()+interval '2 days',
      settings
    from public.projection_setting_versions
    where restaurant_id is null
      and effective_at<=clock_timestamp()
    order by effective_at desc
    limit 1;
  `);

  rejects(`
    insert into public.projection_setting_versions
      (restaurant_id,model_major,effective_at,settings)
    values (
      '${R(1)}',4,clock_timestamp()+interval '3 days',
      '{"volume_half_width_near":0.29}'
    );

    insert into public.projection_setting_versions
      (model_major,effective_at,settings)
    select
      4,
      clock_timestamp()+interval '4 days',
      settings || '{"volume_half_width_far":0.28}'
    from public.projection_setting_versions
    where restaurant_id is null
      and effective_at<=clock_timestamp()
    order by effective_at desc
    limit 1;
  `, /volume_half_width_near|Invalid merged/);
});

function reviewedArchive({
  globalId = null,
  overrideId = undefined,
} = {}) {
  const g = JSON.parse(q(`
    select row_to_json(s)
    from public.projection_setting_versions s
    where restaurant_id is null
      and model_major=4
      ${globalId
        ? `and id='${globalId}'`
        : 'and effective_at<=clock_timestamp() order by effective_at desc limit 1'}
    ;
  `));

  const raw = q(`
    select row_to_json(s)
    from public.projection_setting_versions s
    where restaurant_id='${R(1)}'
      and model_major=4
      and effective_at<=clock_timestamp()
    order by effective_at desc
    limit 1;
  `);

  const o = raw ? JSON.parse(raw) : null;
  const selected = overrideId === undefined
    ? o?.id ?? null
    : overrideId;

  const settings = {
    ...g.settings,
    ...(selected ? o?.settings : {}),
  };

  return `
    insert into public.projection_forecast_runs
      (
        restaurant_id,run_date,model_major,
        global_version_id,restaurant_version_id,
        settings_snapshot,settings_digest,calibration_key,
        source_through,trace
      )
    values (
      '${R(1)}','2026-11-20',4,
      '${g.id}',${selected ? `'${selected}'` : 'null'},
      '${JSON.stringify(settings)}',
      '${projectionSettingsDigest(settings)}',
      '${projectionCalibrationKey(4, settings)}',
      '2026-11-19','{}'
    );
  `;
}

test('archives require the latest effective global version and override', () => {
  const old = q(`
    select id
    from public.projection_setting_versions
    where restaurant_id is null and model_major=4
    order by effective_at
    limit 1;
  `);

  rejects(
    reviewedArchive({ globalId: old }),
    /latest effective version/
  );

  rejects(
    reviewedArchive({ overrideId: null }),
    /latest effective override/
  );

  q(`
    begin;
    set role service_role;
    ${reviewedArchive()}
    rollback;
  `);
});

test('pooled periods are published once, after closing, with valid timezones', () => {
  q(`
    insert into public.projection_pool_permissions
      (
        restaurant_id,agreement_permits,
        enabled,agreement_version
      )
    values ('${R(1)}',true,true,'reviewed');

    insert into public.projection_pool_cohorts
    values ('review','full_service','NJ',null);

    insert into public.projection_pool_memberships
      (restaurant_id,cohort_key,eligible)
    select id,'review',true
    from public.restaurants;
  `);

  const insert = (start, end) => `
    insert into public.projection_pooled_totals
      (
        cohort_key,metric,period_start,period_end,
        participant_count,statistics
      )
    values (
      'review','volume',${start},${end},5,'{"sum":100}'
    );
  `;

  q(insert("'2026-10-01'", "'2026-10-07'"));

  rejects(
    insert("'2026-10-01'", "'2026-10-07'"),
    /duplicate key/
  );

  const today =
    "(clock_timestamp() at time zone 'America/New_York')::date";

  rejects(insert(today, today), /not closed/);

  q(`
    update public.restaurants
    set operational_timezone=null
    where id='${R(1)}';
  `);

  try {
    rejects(
      insert("'2026-10-08'", "'2026-10-14'"),
      /timezone required/
    );
  } finally {
    q(`
      update public.restaurants
      set operational_timezone='America/New_York'
      where id='${R(1)}';
    `);
  }
});

function sqlSession() {
  const child = spawn('docker', [
    'exec',
    '-i',
    container,
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-qAt',
    '-U',
    'postgres',
  ]);

  let out = '';
  let error = '';
  let closed = false;

  child.stdout.on('data', data => {
    out += data;
  });

  child.stderr.on('data', data => {
    error += data;
  });

  const done = new Promise(resolve => {
    child.on('close', code => {
      closed = true;
      resolve({ code, out, error });
    });

    child.on('error', failure => {
      closed = true;
      resolve({ code: -1, out, error: failure.message });
    });
  });

  return {
    send: sql => child.stdin.write(`${sql}\n`),

    end: () => {
      if (!child.stdin.writableEnded) child.stdin.end();
    },

    done,

    async ready() {
      const until = Date.now() + 5000;

      while (
        !out.includes('READY') &&
        !closed &&
        Date.now() < until
      ) {
        await delay(10);
      }

      assert.ok(
        out.includes('READY'),
        error || 'Database writer did not become ready'
      );
    },
  };
}

async function waiting(name) {
  const until = Date.now() + 5000;

  while (Date.now() < until) {
    const count = q(`
      select count(*)
      from pg_stat_activity
      where application_name='${name}'
        and wait_event='advisory';
    `);

    if (count === '1') return;

    await delay(20);
  }

  assert.fail(`Expected ${name} to wait for the settings lock`);
}

test('a concurrent global update cannot bypass an uncommitted restaurant override', async () => {
  const a = sqlSession();
  const b = sqlSession();

  try {
    a.send(`
      begin;

      insert into public.projection_setting_versions
        (restaurant_id,model_major,effective_at,settings)
      values (
        '${R(1)}',4,clock_timestamp(),
        '{"volume_half_width_near":0.25}'
      );

      select 'READY';
    `);

    await a.ready();

    b.send(`
      set application_name='projection-review-global';

      insert into public.projection_setting_versions
        (model_major,effective_at,settings)
      select
        4,
        clock_timestamp(),
        settings || '{"volume_half_width_far":0.22}'
      from public.projection_setting_versions
      where restaurant_id is null
        and effective_at<=clock_timestamp()
      order by effective_at desc
      limit 1;
    `);

    b.end();

    await waiting('projection-review-global');

    a.send('commit;');
    a.end();

    assert.equal((await a.done).code, 0);

    const result = await b.done;

    assert.notEqual(result.code, 0);
    assert.match(
      result.error,
      /volume_half_width_near exceeds volume_half_width_far/
    );
  } finally {
    a.end();
    b.end();
    await Promise.all([a.done, b.done]);
  }
});

test('a forecast waiting behind a settings writer must retry with the new version', async () => {
  const sql = reviewedArchive();
  const a = sqlSession();
  const b = sqlSession();

  try {
    a.send(`
      begin;

      insert into public.projection_setting_versions
        (model_major,effective_at,settings)
      select
        4,
        clock_timestamp(),
        settings || '{"bias_threshold":0.12}'
      from public.projection_setting_versions
      where restaurant_id is null
        and effective_at<=clock_timestamp()
      order by effective_at desc
      limit 1;

      select 'READY';
    `);

    await a.ready();

    b.send(`
      set application_name='projection-review-archive';
      ${sql}
    `);

    b.end();

    await waiting('projection-review-archive');

    a.send('commit;');
    a.end();

    assert.equal((await a.done).code, 0);

    const result = await b.done;

    assert.notEqual(result.code, 0);
    assert.match(result.error, /latest effective version/);
  } finally {
    a.end();
    b.end();
    await Promise.all([a.done, b.done]);
  }
});

test('a failure in the legacy purge rolls back projection deletes and the purge log', () => {
  const before = q(`
    select count(*) from public.projection_account_purge_log;
  `);

  q(`
    create function public.test_block_purge() returns trigger
    language plpgsql as $$
    begin
      raise exception 'Synthetic legacy purge failure';
    end
    $$;

    create trigger test_block_purge
    before delete on public.restaurants
    for each row execute function public.test_block_purge();
  `);

  try {
    rejects(`
      set role service_role;
      select public.purge_restaurant('${R(1)}');
    `, /Synthetic legacy/);

    assert.equal(q(`
      select count(*) from public.projection_forecast_runs;
    `), '2');

    assert.equal(q(`
      select count(*) from public.projection_account_purge_log;
    `), before);

    assert.equal(q(`
      select count(*) from projection_private.purge_context;
    `), '0');
  } finally {
    q(`
      drop trigger test_block_purge on public.restaurants;
      drop function public.test_block_purge();
    `);
  }
});

test('authorized purge deletes all tenant history, logs counts and preserves other tenants', () => {
  q(`
    set role service_role;
    select public.purge_restaurant('${R(1)}');
  `);

  assert.equal(q(`
    select count(*) from public.projection_forecast_runs;
  `), '0');

  assert.equal(q(`
    select count(*) from public.projection_dishes;
  `), '0');

  assert.equal(q(`
    select count(*) from public.projection_change_log
    where restaurant_id='${R(1)}';
  `), '0');

  assert.equal(q(`
    select count(*) from public.projection_setting_versions
    where restaurant_id='${R(2)}';
  `), '1');

  assert.equal(q(`
    select count(*) from public.projection_account_purge_log
    where deleted_rows->>'projection_forecast_runs'='2'
      and account_hash ~ '^[0-9a-f]{64}$'
      and authorized_role='service_role';
  `), '1');

  assert.equal(q(`
    select count(*) from projection_private.purge_context;
  `), '0');

  q(`
    do $$
    declare
      t text;
      n bigint;
    begin
      for t in
        select table_name
        from information_schema.columns
        where table_schema='public'
          and column_name='restaurant_id'
          and starts_with(table_name,'projection_')
      loop
        execute format(
          'select count(*) from public.%I where restaurant_id=$1',
          t
        ) into n using '${R(1)}'::uuid;

        if n <> 0 then
          raise exception 'Purge left rows in %',t;
        end if;
      end loop;
    end
    $$;
  `);

  rejects(`
    update public.projection_account_purge_log
    set authorized_role='changed';
  `, /append-only/);
});