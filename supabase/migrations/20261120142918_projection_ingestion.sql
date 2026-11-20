begin;

alter table public.projection_pos_item_map
  alter column dish_id drop not null,
  add column excluded boolean not null default false,
  add constraint projection_mapping_destination_check check (
    (excluded and dish_id is null)
    or (not excluded and dish_id is not null)
  );

alter table public.projection_pooled_totals
  add constraint projection_pooled_monday_sunday_check check (
    extract(isodow from period_start) = 1
    and period_end = period_start + 6
  );

-- Separate from immutable v4 model settings. Every change is a new version.
create table public.projection_ingestion_policy_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  effective_at timestamptz not null,
  maximum_unmapped_share numeric not null
    check (maximum_unmapped_share >= 0 and maximum_unmapped_share <= 1),
  created_at timestamptz not null default clock_timestamp(),
  unique nulls not distinct (restaurant_id,effective_at)
);

insert into public.projection_ingestion_policy_versions
  (effective_at,maximum_unmapped_share)
values ('2026-01-01T00:00:00Z',0.05);

-- Explicit business-date coverage, independent of authentication health.
-- No connection FK: history survives removal of an old POS credential row.
create table public.projection_pos_source_windows (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  connection_id uuid not null,
  provider text not null check (btrim(provider) <> ''),
  valid_from date,
  valid_until date,
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create index projection_source_window_restaurant_connection
  on public.projection_pos_source_windows(restaurant_id,connection_id);

alter table public.projection_ingestion_policy_versions enable row level security;
alter table public.projection_pos_source_windows enable row level security;

revoke all on public.projection_ingestion_policy_versions,
  public.projection_pos_source_windows
from public, anon, authenticated, service_role;

grant select, insert on public.projection_ingestion_policy_versions
to service_role;
grant select, insert, update on public.projection_pos_source_windows
to service_role;

create trigger projection_policy_immutable
before update or delete on public.projection_ingestion_policy_versions
for each row execute function projection_private.immutable_row();

create trigger projection_policy_no_truncate
before truncate on public.projection_ingestion_policy_versions
for each statement execute function projection_private.immutable_row();

create function projection_private.lock_ingestion_policy()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-ingestion-policy',0
  ));
  return new;
end;
$fn$;

create trigger projection_policy_lock
before insert on public.projection_ingestion_policy_versions
for each row execute function projection_private.lock_ingestion_policy();

revoke all on function projection_private.lock_ingestion_policy()
from public, anon, authenticated, service_role;

create table public.projection_dish_availability (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  dish_id uuid not null,
  valid_from date not null,
  valid_until date,
  unique (restaurant_id, dish_id, valid_from),
  foreign key (restaurant_id, dish_id)
    references public.projection_dishes(restaurant_id, id),
  check (valid_until is null or valid_until > valid_from)
);

create table public.projection_ingestion_state (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  business_date date not null,
  generation bigint not null check (generation > 0),
  transaction_digest text
    check (transaction_digest ~ '^[0-9a-f]{64}$'),
  context_digest text not null
    check (context_digest ~ '^[0-9a-f]{64}$'),
  payload_digest text not null
    check (payload_digest ~ '^[0-9a-f]{64}$'),
  changed_at timestamptz not null,
  last_observed_at timestamptz not null,
  primary key (restaurant_id, business_date)
);

alter table public.projection_dish_availability
  enable row level security;

alter table public.projection_ingestion_state
  enable row level security;

revoke all on
  public.projection_dish_availability,
  public.projection_ingestion_state
from public, anon, authenticated, service_role;

grant select, insert, update
  on public.projection_dish_availability
  to service_role;

grant select
  on public.projection_ingestion_state
  to service_role;

-- Facts and completeness are replaced only by the atomic ingestion function.
revoke insert, update on
  public.projection_nightly_dish_facts,
  public.projection_nightly_flags
from service_role;

alter table public.projection_change_log
  drop constraint projection_change_log_operation_check;

alter table public.projection_change_log
  add constraint projection_change_log_operation_check
  check (operation in ('INSERT','UPDATE','DELETE'));

create function projection_private.lock_ingestion_context()
returns trigger
language plpgsql set search_path = '' as $fn$
declare
  owner_id uuid;
begin
  if tg_table_name = 'restaurants' then
    owner_id := new.id;
  elsif tg_op = 'DELETE' then
    owner_id := old.restaurant_id;
  else
    owner_id := new.restaurant_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-ingest:' || owner_id::text,
    0
  ));

  if tg_table_name = 'projection_dish_availability'
    and tg_op <> 'DELETE'
  then
    if tg_op = 'UPDATE'
      and (
        new.restaurant_id,
        new.dish_id,
        new.valid_from
      ) is distinct from (
        old.restaurant_id,
        old.dish_id,
        old.valid_from
      )
    then
      raise exception
        'Close the availability interval and add its replacement';
    end if;

    if exists (
      select 1
      from public.projection_dish_availability p
      where p.restaurant_id = new.restaurant_id
        and p.dish_id = new.dish_id
        and p.id <> new.id
        and daterange(p.valid_from,p.valid_until,'[)')
          && daterange(new.valid_from,new.valid_until,'[)')
    ) then
      raise exception 'Dish availability intervals overlap'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'projection_pos_source_windows'
    and tg_op <> 'DELETE'
  then
    if tg_op = 'UPDATE' and (
      new.restaurant_id,new.connection_id,new.provider
    ) is distinct from (
      old.restaurant_id,old.connection_id,old.provider
    ) then
      raise exception 'Source window identity cannot change';
    end if;

    if tg_op = 'INSERT' and not exists (
      select 1 from public.pos_connections c
      where c.id = new.connection_id
        and c.restaurant_id = new.restaurant_id
        and c.provider = new.provider
    ) then
      raise exception 'Source connection belongs to another restaurant or provider'
        using errcode = '23514';
    end if;

    if exists (
      select 1 from public.projection_pos_source_windows w
      where w.restaurant_id = new.restaurant_id
        and w.connection_id = new.connection_id
        and w.id <> new.id
        and daterange(w.valid_from,w.valid_until,'[)')
          && daterange(new.valid_from,new.valid_until,'[)')
    ) then
      raise exception 'POS source windows overlap' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;

  return new;
end;
$fn$;

create trigger projection_source_window_lock
before insert or update or delete on public.projection_pos_source_windows
for each row execute function projection_private.lock_ingestion_context();

create trigger projection_source_window_audit
after insert or update on public.projection_pos_source_windows
for each row execute function projection_private.log_change();

create trigger projection_availability_lock
before insert or update or delete
on public.projection_dish_availability
for each row execute function projection_private.lock_ingestion_context();

create trigger projection_dish_ingestion_lock
before insert or update or delete
on public.projection_dishes
for each row execute function projection_private.lock_ingestion_context();

create trigger projection_mapping_ingestion_lock
before insert or update or delete
on public.projection_pos_item_map
for each row execute function projection_private.lock_ingestion_context();

create trigger projection_timezone_ingestion_lock
before update of operational_timezone
on public.restaurants
for each row
when (old.operational_timezone is distinct from new.operational_timezone)
execute function projection_private.lock_ingestion_context();

create trigger projection_availability_audit
after insert or update
on public.projection_dish_availability
for each row execute function projection_private.log_change();

create function projection_private.business_boundary(
  p_date date,
  p_zone text,
  p_cutoff integer
)
returns timestamptz
language plpgsql stable set search_path = '' as $fn$
declare
  nominal timestamp;
  base timestamptz;
  probe timestamptz;
  candidate timestamptz;
  exact timestamptz;
  lo timestamptz;
  hi timestamptz;
  mid timestamptz;
  h integer;
begin
  if p_date is null or p_zone is null or p_zone = '' then
    raise exception 'A business date and timezone are required';
  end if;

  if p_cutoff is null or p_cutoff < 0 or p_cutoff >= 1440 then
    raise exception 'Invalid business cutoff';
  end if;

  nominal := p_date::timestamp + make_interval(mins => p_cutoff);
  base := nominal at time zone 'UTC';

  for h in -36..36 by 6 loop
    probe := base + make_interval(hours => h);

    candidate := base - (
      (probe at time zone p_zone) -
      (probe at time zone 'UTC')
    );

    lo := least(lo,candidate);
    hi := greatest(hi,candidate);

    if candidate at time zone p_zone = nominal then
      exact := greatest(exact,candidate);
    end if;
  end loop;

  if exact is not null then return exact; end if;

  if not (
    (lo at time zone p_zone) < nominal
    and (hi at time zone p_zone) > nominal
  ) then
    raise exception 'Cannot resolve restaurant business cutoff';
  end if;

  while hi - lo > interval '1 millisecond' loop
    mid := date_trunc('milliseconds',lo + (hi - lo) / 2);

    if (mid at time zone p_zone) >= nominal then
      hi := mid;
    else
      lo := mid;
    end if;
  end loop;

  return hi;
end;
$fn$;

-- Reuse the approved cutoff policy for pooled period closure.
create or replace function projection_private.validate_pooled_period()
returns trigger
language plpgsql set search_path = '' as $fn$
declare
  major integer;
  base jsonb;
  s jsonb;
  r record;
  participants integer := 0;
  closes_at timestamptz;
begin
  new.computed_at := clock_timestamp();

  select model_major into major
  from public.projection_model_versions
  where released_at <= new.computed_at
  order by released_at desc, model_major desc
  limit 1;

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-settings:' || major::text,
    0
  ));

  new.computed_at := clock_timestamp();

  select settings into base
  from public.projection_setting_versions
  where restaurant_id is null
    and model_major = major
    and effective_at <= new.computed_at
  order by effective_at desc
  limit 1;

  if base is null
    or not (base->>'pooled_benchmarks_enabled')::boolean
  then
    raise exception 'Pooled benchmarks are globally disabled'
      using errcode = '23514';
  end if;

  for r in
    select m.restaurant_id, a.operational_timezone
    from public.projection_pool_memberships m
    join public.projection_pool_permissions p using (restaurant_id)
    join public.restaurants a on a.id = m.restaurant_id
    where m.cohort_key = new.cohort_key
      and m.eligible
      and p.enabled
      and p.agreement_permits
      and a.deactivated_at is null
    order by m.restaurant_id
  loop
    participants := participants + 1;

    if r.operational_timezone is null
      or not exists (
        select 1
        from pg_timezone_names
        where name = r.operational_timezone
      )
    then
      raise exception
        'Valid operational timezone required for pooled participant %',
        r.restaurant_id
        using errcode = '23514';
    end if;

    select base || coalesce((
      select settings
      from public.projection_setting_versions
      where restaurant_id = r.restaurant_id
        and model_major = major
        and effective_at <= new.computed_at
      order by effective_at desc
      limit 1
    ), '{}'::jsonb) into s;

    closes_at := projection_private.business_boundary(
      new.period_end + 1,
      r.operational_timezone,
      (s->>'business_day_cutoff_minutes')::integer
    ) + make_interval(
      mins => (s->>'sync_buffer_minutes')::integer
    );

    if new.computed_at < closes_at then
      raise exception
        'Pooled period is not closed for restaurant %',
        r.restaurant_id
        using errcode = '23514';
    end if;
  end loop;

  if participants < 5 then
    raise exception
      'Pooled totals require at least 5 eligible restaurants'
      using errcode = '23514';
  end if;

  new.participant_count := participants;
  return new;
end;
$fn$;

create function projection_private.ingestion_context(
  p_restaurant_id uuid,
  p_business_date date,
  p_at timestamptz
)
returns jsonb
language plpgsql stable
set search_path = ''
set timezone = 'UTC'
as $fn$
declare
  zone text;
  major integer;
  g jsonb;
  o jsonb;
  value jsonb;
  policy jsonb;
  override_policy jsonb;
begin
  if p_business_date is null or p_at is null then
    raise exception 'Business date and timestamp are required';
  end if;

  select operational_timezone into zone
  from public.restaurants
  where id = p_restaurant_id
    and deactivated_at is null;

  if not found then
    raise exception 'Restaurant is absent or inactive';
  end if;

  if zone is null
    or not exists (
      select 1 from pg_timezone_names where name = zone
    )
  then
    raise exception 'Configure a valid operational timezone';
  end if;

  select model_major into major
  from public.projection_model_versions
  where released_at <= p_at
  order by released_at desc, model_major desc
  limit 1;

  select jsonb_build_object(
    'id',id,
    'settings',settings
  ) into g
  from public.projection_setting_versions
  where restaurant_id is null
    and model_major = major
    and effective_at <= p_at
  order by effective_at desc
  limit 1;

  select jsonb_build_object(
    'id',id,
    'settings',settings
  ) into o
  from public.projection_setting_versions
  where restaurant_id = p_restaurant_id
    and model_major = major
    and effective_at <= p_at
  order by effective_at desc
  limit 1;

  if g is null then
    raise exception 'Effective projection settings are missing';
  end if;

  if not projection_private.check_settings(
    (g->'settings') || coalesce(o->'settings','{}'::jsonb)
  ) then
    raise exception 'Effective projection settings are invalid';
  end if;

  select jsonb_build_object(
    'global_version_id',id,
    'restaurant_version_id',null,
    'maximum_unmapped_share',maximum_unmapped_share
  ) into policy
  from public.projection_ingestion_policy_versions
  where restaurant_id is null and effective_at <= p_at
  order by effective_at desc limit 1;

  select jsonb_build_object(
    'restaurant_version_id',id,
    'maximum_unmapped_share',maximum_unmapped_share
  ) into override_policy
  from public.projection_ingestion_policy_versions
  where restaurant_id = p_restaurant_id and effective_at <= p_at
  order by effective_at desc limit 1;

  if policy is null then
    raise exception 'Effective ingestion policy is missing';
  end if;

  value := jsonb_build_object(
    'ingestion_policy',policy || coalesce(override_policy,'{}'::jsonb),
    'restaurant_id',p_restaurant_id,
    'business_date',p_business_date,
    'timezone',zone,
    'model_major',major,
    'global_version_id',g->'id',
    'restaurant_version_id',o->'id',
    'settings',(g->'settings') || coalesce(o->'settings','{}'::jsonb),

    'window_from',projection_private.business_boundary(
      p_business_date,
      zone,
      (
        (
          (g->'settings') ||
          coalesce(o->'settings','{}'::jsonb)
        )->>'business_day_cutoff_minutes'
      )::integer
    ),

    'window_to',projection_private.business_boundary(
      p_business_date + 1,
      zone,
      (
        (
          (g->'settings') ||
          coalesce(o->'settings','{}'::jsonb)
        )->>'business_day_cutoff_minutes'
      )::integer
    ),

    'dishes',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',id,
          'restaurant_id',restaurant_id,
          'forecastable',forecastable,
          'launch_date',launch_date,
          'removed_date',removed_date,
          'is_returning',is_returning
        )
        order by id
      )
      from public.projection_dishes
      where restaurant_id = p_restaurant_id
    ),'[]'::jsonb),

    'availability',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id)
      from public.projection_dish_availability a
      where restaurant_id = p_restaurant_id
    ),'[]'::jsonb),

    'mappings',coalesce((
      select jsonb_agg(to_jsonb(m) order by m.id)
      from public.projection_pos_item_map m
      where restaurant_id = p_restaurant_id
    ),'[]'::jsonb),

    'connections',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',w.connection_id,
          'restaurant_id',w.restaurant_id,
          'provider',w.provider
        )
        order by w.connection_id
      )
      from public.projection_pos_source_windows w
      where w.restaurant_id = p_restaurant_id
        and (w.valid_from is null or w.valid_from <= p_business_date)
        and (w.valid_until is null or p_business_date < w.valid_until)
    ),'[]'::jsonb)
  );

  return value || jsonb_build_object(
    'context_digest',
      encode(sha256(convert_to(value::text,'UTF8')),'hex'),
    'connection_health',coalesce((
      select jsonb_object_agg(w.connection_id::text,coalesce(c.status,'unavailable'))
      from public.projection_pos_source_windows w
      left join public.pos_connections c
        on c.id = w.connection_id and c.restaurant_id = w.restaurant_id
        and c.provider = w.provider
      where w.restaurant_id = p_restaurant_id
        and (w.valid_from is null or w.valid_from <= p_business_date)
        and (w.valid_until is null or p_business_date < w.valid_until)
    ),'{}'::jsonb),
    'state',(
      select to_jsonb(s)
      from public.projection_ingestion_state s
      where restaurant_id = p_restaurant_id
        and business_date = p_business_date
    )
  );
end;
$fn$;

create function public.projection_ingestion_context(
  p_restaurant_id uuid,
  p_business_date date
)
returns jsonb
language sql stable security invoker
set search_path = ''
as $fn$
  select projection_private.ingestion_context(
    p_restaurant_id,
    p_business_date,
    statement_timestamp()
  );
$fn$;

create function projection_private.commit_night(
  p_restaurant_id uuid,
  p_business_date date,
  p_context_digest text,
  p_expected_generation bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
set timezone = 'UTC'
as $fn$
declare
  ctx jsonb;
  prior public.projection_ingestion_state;
  payload_hash text;
  observed timestamptz;
  changed timestamptz;
  generation bigint;
  total numeric;
  row_count bigint;
  distinct_count bigint;
  mode text;
  complete boolean;
  fact_revision text;
  expected_complete boolean;
  saved_complete boolean;
  unresolved numeric;
  maximum_share numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid ingestion payload';
  end if;

  mode := p_payload->>'mode';

  if mode is null
    or mode not in ('success','failure')
    or p_expected_generation is null
    or p_expected_generation < 0
  then
    raise exception 'Invalid ingestion request';
  end if;

  if coalesce(p_payload->>'observed_at','')
    !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
  then
    raise exception 'An explicit observation timestamp is required';
  end if;

  observed := (p_payload->>'observed_at')::timestamptz;

  if observed > clock_timestamp() then
    raise exception 'POS observation is in the future';
  end if;

  select projection_private.ingestion_context(
    p_restaurant_id,
    p_business_date,
    clock_timestamp()
  ) into ctx;

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-ingestion-policy',0
  ));

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-settings:' || (ctx->>'model_major'),
    0
  ));

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-ingest:' || p_restaurant_id::text,
    0
  ));

  ctx := projection_private.ingestion_context(
    p_restaurant_id,
    p_business_date,
    clock_timestamp()
  );

  if p_context_digest is distinct from ctx->>'context_digest' then
    raise exception
      'Projection ingestion context changed; reload and retry'
      using errcode = 'PT409';
  end if;

  select * into prior
  from public.projection_ingestion_state
  where restaurant_id = p_restaurant_id
    and business_date = p_business_date
  for update;

  select f.complete into saved_complete
  from public.projection_nightly_flags f
  where f.restaurant_id = p_restaurant_id and f.business_date = p_business_date;

  payload_hash := encode(sha256(convert_to(
    (p_payload - 'observed_at' - 'changed_at')::text ||
      p_context_digest,
    'UTF8'
  )),'hex');

  if prior.generation is not null
    and observed = prior.last_observed_at
    and payload_hash = prior.payload_digest
  then
    return jsonb_build_object(
      'restaurant_id',p_restaurant_id,
      'business_date',p_business_date,
      'generation',prior.generation,
      'unchanged',true,
      'complete',coalesce(saved_complete,false),
      'preserved_complete',mode = 'failure' and coalesce(saved_complete,false),
      'recheck_failed',mode = 'failure'
    );
  end if;

  if coalesce(prior.generation,0) <> p_expected_generation
    or observed < prior.last_observed_at
    or (
      observed = prior.last_observed_at
      and (
        prior.context_digest = p_context_digest
        or (p_payload->>'transaction_digest')
          is distinct from prior.transaction_digest
      )
    )
  then
    raise exception
      'Stale projection ingestion; reload and retry'
      using errcode = 'PT409';
  end if;

  generation := coalesce(prior.generation,0) + 1;

  if mode = 'failure' then
    if coalesce(p_payload->>'error_code','')
      !~ '^PROJECTION_[A-Z_]+$'
    then
      raise exception 'Invalid ingestion error code';
    end if;

    insert into public.projection_nightly_flags
      (restaurant_id,business_date,complete,flags)
    values (
      p_restaurant_id,
      p_business_date,
      false,
      jsonb_build_object(
        'ingestion',
        jsonb_build_object(
          'recheck_failed',true,
          'last_recheck_error',jsonb_build_object(
            'error_code',p_payload->>'error_code',
            'observed_at',observed
          )
        )
      )
    )
    on conflict (restaurant_id,business_date)
    do update set
      complete = projection_nightly_flags.complete,
      flags = projection_nightly_flags.flags || jsonb_build_object(
        'ingestion',
        coalesce(projection_nightly_flags.flags->'ingestion','{}'::jsonb)
          || (excluded.flags->'ingestion')
      ),
      updated_at = clock_timestamp();

    changed := coalesce(prior.changed_at,observed);
  else
    if jsonb_typeof(p_payload->'facts') is distinct from 'array'
      or jsonb_typeof(p_payload->'complete')
        is distinct from 'boolean'
      or coalesce(p_payload->>'transaction_digest','')
        !~ '^[0-9a-f]{64}$'
    then
      raise exception 'Invalid normalized night';
    end if;

    select
      count(*),
      count(distinct dish_id),
      sum(units)
    into row_count, distinct_count, total
    from jsonb_to_recordset(p_payload->'facts')
      as f(dish_id uuid,units numeric);

    if row_count = 0
      or row_count <> distinct_count
      or total is distinct from (p_payload->>'total_units')::numeric
    then
      raise exception
        'Dish facts do not reconcile with the night total'
        using errcode = '23514';
    end if;

    complete := (p_payload->>'complete')::boolean;

    if complete and exists (
      select 1
      from jsonb_to_recordset(p_payload->'facts')
        as f(units numeric)
      where units < 0
    ) then
      raise exception
        'Negative dish units cannot form a complete night'
        using errcode = '23514';
    end if;

    changed := case
      when prior.transaction_digest =
        p_payload->>'transaction_digest'
      then prior.changed_at
      else observed
    end;

    unresolved := (p_payload#>>'{diagnostics,unmapped_units}')::numeric
      + (p_payload#>>'{diagnostics,outside_menu_units}')::numeric;
    maximum_share := (ctx#>>'{ingestion_policy,maximum_unmapped_share}')::numeric;

    if unresolved is null or unresolved < 0
      or unresolved in ('NaN'::numeric,'Infinity'::numeric)
      or (p_payload#>>'{diagnostics,unmapped_units}')::numeric < 0
      or (p_payload#>>'{diagnostics,outside_menu_units}')::numeric < 0
      or (p_payload#>>'{diagnostics,open_lines}')::integer < 0
      or (p_payload#>>'{diagnostics,mapping_needed}')::boolean
        is distinct from (unresolved > (total + unresolved) * maximum_share)
    then
      raise exception 'Mapping quality evidence does not reconcile'
        using errcode = '23514';
    end if;

    expected_complete :=
      unresolved <= (total + unresolved) * maximum_share
      and not exists (
        select 1
        from jsonb_to_recordset(p_payload->'facts')
          as f(units numeric)
        where units < 0
      )
      and observed >= (ctx->>'window_to')::timestamptz
      and (
        (
          (p_payload#>>'{diagnostics,daily_closeout}')::boolean
          and (p_payload#>>'{diagnostics,open_lines}')::integer = 0
        )
        or observed >= greatest(
          changed,
          (ctx->>'window_to')::timestamptz
        ) + make_interval(
          mins => (ctx#>>'{settings,sync_buffer_minutes}')::integer
        )
      );

    if complete is distinct from expected_complete then
      raise exception
        'Completeness evidence does not reconcile'
        using errcode = '23514';
    end if;

    fact_revision := encode(sha256(convert_to(
      jsonb_build_object(
        'facts',p_payload->'facts',
        'source',p_payload->>'transaction_digest',
        'context',p_context_digest
      )::text,
      'UTF8'
    )),'hex');

    insert into public.projection_change_log
      (
        restaurant_id,
        table_name,
        operation,
        previous_row,
        replacement_row,
        actor_id
      )
    select
      p_restaurant_id,
      'projection_nightly_dish_facts',
      'DELETE',
      to_jsonb(f),
      jsonb_build_object(
        'deleted',true,
        'dish_id',f.dish_id,
        'business_date',p_business_date
      ),
      auth.uid()
    from public.projection_nightly_dish_facts f
    where f.restaurant_id = p_restaurant_id
      and f.business_date = p_business_date
      and not exists (
        select 1
        from jsonb_to_recordset(p_payload->'facts')
          as n(dish_id uuid)
        where n.dish_id = f.dish_id
      );

    delete from public.projection_nightly_dish_facts f
    where f.restaurant_id = p_restaurant_id
      and f.business_date = p_business_date
      and not exists (
        select 1
        from jsonb_to_recordset(p_payload->'facts')
          as n(dish_id uuid)
        where n.dish_id = f.dish_id
      );

    insert into public.projection_nightly_dish_facts
      (
        restaurant_id,
        business_date,
        dish_id,
        units,
        source_revision
      )
    select
      p_restaurant_id,
      p_business_date,
      dish_id,
      units,
      fact_revision
    from jsonb_to_recordset(p_payload->'facts')
      as n(dish_id uuid,units numeric)
    on conflict (restaurant_id,business_date,dish_id)
    do update set
      units = excluded.units,
      source_revision = excluded.source_revision,
      updated_at = clock_timestamp()
    where
      projection_nightly_dish_facts.units
        is distinct from excluded.units
      or projection_nightly_dish_facts.source_revision
        is distinct from excluded.source_revision;

    insert into public.projection_nightly_flags
      (
        restaurant_id,
        business_date,
        complete,
        total_units,
        source_revision,
        flags
      )
    values (
      p_restaurant_id,
      p_business_date,
      complete,
      total,
      fact_revision,
      jsonb_build_object(
        'ingestion',p_payload->'diagnostics'
      )
    )
    on conflict (restaurant_id,business_date)
    do update set
      complete = excluded.complete,
      total_units = excluded.total_units,
      source_revision = excluded.source_revision,
      flags = projection_nightly_flags.flags || excluded.flags,
      recommendation_flags_complete =
        projection_nightly_flags.recommendation_flags_complete
        and not exists (
          select 1
          from public.projection_nightly_dish_facts f
          where f.restaurant_id = p_restaurant_id
            and f.business_date = p_business_date
            and f.recommended is null
        ),
      outlier_status = case
        when projection_nightly_flags.source_revision
          is distinct from excluded.source_revision
        then 'unchecked'
        else projection_nightly_flags.outlier_status
      end,
      updated_at = clock_timestamp()
    where (
      projection_nightly_flags.complete,
      projection_nightly_flags.total_units,
      projection_nightly_flags.source_revision,
      projection_nightly_flags.flags->'ingestion'
    ) is distinct from (
      excluded.complete,
      excluded.total_units,
      excluded.source_revision,
      excluded.flags->'ingestion'
    );
  end if;

  insert into public.projection_ingestion_state
    (
      restaurant_id,
      business_date,
      generation,
      transaction_digest,
      context_digest,
      payload_digest,
      changed_at,
      last_observed_at
    )
  values (
    p_restaurant_id,
    p_business_date,
    generation,
    case
      when mode = 'success'
      then p_payload->>'transaction_digest'
      else prior.transaction_digest
    end,
    case when mode = 'success' then p_context_digest
      else coalesce(prior.context_digest,p_context_digest) end,
    payload_hash,
    changed,
    observed
  )
  on conflict (restaurant_id,business_date)
  do update set
    generation = excluded.generation,
    transaction_digest = excluded.transaction_digest,
    context_digest = excluded.context_digest,
    payload_digest = excluded.payload_digest,
    changed_at = excluded.changed_at,
    last_observed_at = excluded.last_observed_at;

  insert into public.projection_restaurant_config
    (restaurant_id,first_data_date)
  select p_restaurant_id,min(f.business_date)
  from public.projection_nightly_flags f
  where f.restaurant_id = p_restaurant_id
    and f.complete
  on conflict (restaurant_id)
  do update set
    first_data_date = excluded.first_data_date,
    updated_at = clock_timestamp()
  where projection_restaurant_config.first_data_date
    is distinct from excluded.first_data_date;

  return jsonb_build_object(
    'restaurant_id',p_restaurant_id,
    'business_date',p_business_date,
    'generation',generation,
    'unchanged',false,
    'complete',case when mode = 'failure' then coalesce(saved_complete,false)
      else complete end,
    'preserved_complete',mode = 'failure' and coalesce(saved_complete,false),
    'recheck_failed',mode = 'failure',
    'needs_reingestion',mode = 'failure'
      and prior.context_digest is distinct from p_context_digest
  );
end;
$fn$;

create function public.projection_commit_night(
  p_restaurant_id uuid,
  p_business_date date,
  p_context_digest text,
  p_expected_generation bigint,
  p_payload jsonb
)
returns jsonb
language sql security invoker
set search_path = ''
as $fn$
  select projection_private.commit_night(
    p_restaurant_id,
    p_business_date,
    p_context_digest,
    p_expected_generation,
    p_payload
  );
$fn$;

revoke all on function
  public.projection_ingestion_context(uuid,date),
  public.projection_commit_night(uuid,date,text,bigint,jsonb),
  projection_private.business_boundary(date,text,integer),
  projection_private.ingestion_context(uuid,date,timestamptz),
  projection_private.commit_night(uuid,date,text,bigint,jsonb),
  projection_private.lock_ingestion_context()
from public, anon, authenticated, service_role;

grant execute on function
  public.projection_ingestion_context(uuid,date),
  public.projection_commit_night(uuid,date,text,bigint,jsonb),
  projection_private.business_boundary(date,text,integer),
  projection_private.ingestion_context(uuid,date,timestamptz),
  projection_private.commit_night(uuid,date,text,bigint,jsonb)
to service_role;

-- Keep POS installation state and projection source coverage atomic.
-- The existing install, OAuth, uninstall webhook and reconciliation routes
-- already write pos_connections; all of them therefore use this trigger.
create function projection_private.sync_pos_source_window()
returns trigger
language plpgsql security definer
set search_path = ''
set timezone = 'UTC'
as $fn$
declare
  zone text;
  at_time timestamptz;
  local_day date;
  ctx jsonb;
  latest public.projection_pos_source_windows;
begin
  if tg_op = 'UPDATE' and (
    new.id,new.restaurant_id,new.provider
  ) is distinct from (
    old.id,old.restaurant_id,old.provider
  ) then
    if exists (
      select 1 from public.projection_pos_source_windows w
      where w.connection_id = old.id
    ) then
      raise exception 'A POS connection with source history cannot change identity'
        using errcode = '23514';
    end if;
  end if;

  if new.status not in ('connected','disconnected') or new.status is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-ingest:' || new.restaurant_id::text,0
  ));

  select w.* into latest
  from public.projection_pos_source_windows w
  where w.restaurant_id = new.restaurant_id
    and w.connection_id = new.id
    and w.provider = new.provider
  order by w.valid_until desc nulls first,w.id
  limit 1
  for update;

  -- Repeated connects and transient sync-error recovery reuse an open window.
  if latest.id is not null and latest.valid_until is null
    and new.status = 'connected'
  then
    return new;
  end if;

  -- A repeated disconnect never moves an existing historical boundary.
  if new.status = 'disconnected'
    and (latest.id is null or latest.valid_until is not null)
  then
    return new;
  end if;

  -- A restaurant's first source can supply history from before installation.
  -- Its actual complete data coverage is still required by ingestion.
  if new.status = 'connected' and not exists (
    select 1 from public.projection_pos_source_windows w
    where w.restaurant_id = new.restaurant_id
  ) then
    insert into public.projection_pos_source_windows
      (restaurant_id,connection_id,provider,valid_from)
    values (new.restaurant_id,new.id,new.provider,null);
    return new;
  end if;

  select r.operational_timezone into zone
  from public.restaurants r
  where r.id = new.restaurant_id;

  if zone is null or not exists (
    select 1 from pg_timezone_names where name = zone
  ) then
    raise exception 'Configure a valid operational timezone before changing POS source dates'
      using errcode = '23514';
  end if;

  at_time := clock_timestamp();
  local_day := (at_time at time zone zone)::date;
  ctx := projection_private.ingestion_context(
    new.restaurant_id,local_day,at_time
  );

  if at_time < (ctx->>'window_from')::timestamptz then
    local_day := local_day - 1;
  end if;

  if new.status = 'disconnected' then
    -- valid_until is exclusive. Preserve food made on the disconnect night.
    update public.projection_pos_source_windows
    set valid_until = local_day + 1
    where id = latest.id;
  elsif latest.id is not null and latest.valid_until >= local_day then
    -- Same-night and adjacent-night reconnects leave no uncovered date.
    update public.projection_pos_source_windows
    set valid_until = null
    where id = latest.id;
  else
    -- A real gap stays absent from the connection's historical coverage.
    insert into public.projection_pos_source_windows
      (restaurant_id,connection_id,provider,valid_from)
    values (new.restaurant_id,new.id,new.provider,local_day);
  end if;

  return new;
end;
$fn$;

revoke all on function projection_private.sync_pos_source_window()
from public, anon, authenticated, service_role;

-- Block connection writes until the backfill and lifecycle trigger are ready.
lock table public.pos_connections in share row exclusive mode;

insert into public.projection_pos_source_windows
  (restaurant_id,connection_id,provider,valid_from)
select c.restaurant_id,c.id,c.provider,null
from public.pos_connections c
where c.status = 'connected'
order by c.restaurant_id,c.id;

create trigger projection_pos_source_lifecycle
after insert or update of id,restaurant_id,provider,status
on public.pos_connections
for each row execute function projection_private.sync_pos_source_window();


-- Preserve the existing purge behavior and include the new ingestion tables.
create or replace function projection_private.purge_account(
  target uuid
)
returns void
language plpgsql security definer
set search_path = ''
as $fn$
declare
  t text;
  n bigint;
  counts jsonb := '{}';
  salt text;
  caller text := coalesce(
    nullif(current_setting('role',true),'none'),
    session_user
  );
  actor uuid := auth.uid();
begin
  if target = '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Refusing to purge the tour sample restaurant';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-ingest:' || target::text,
    0
  ));

  perform 1
  from public.restaurants
  where id = target
  for update;

  if not found then
    raise exception 'Restaurant does not exist';
  end if;

  insert into projection_private.purge_context
  values (pg_backend_pid(),txid_current(),target);

  foreach t in array array[
    'projection_ingestion_policy_versions',
    'projection_pos_source_windows',
    'projection_ingestion_state',
    'projection_dish_availability',
    'projection_forecast_dishes',
    'projection_forecast_nights',
    'projection_forecast_runs',
    'projection_run_decision_nights',
    'projection_run_decisions',
    'projection_holiday_observations',
    'projection_launch_history',
    'projection_nightly_dish_facts',
    'projection_pos_item_map',
    'projection_dishes',
    'projection_nightly_flags',
    'projection_holiday_rule_versions',
    'projection_owner_answers',
    'projection_restaurant_config',
    'projection_pool_memberships',
    'projection_pool_permissions',
    'projection_setting_versions',
    'projection_change_log'
  ] loop
    execute format(
      'delete from public.%I where restaurant_id = $1',
      t
    ) using target;

    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t,n);
  end loop;

  perform public.purge_restaurant_before_projections(target);

  select value into strict salt
  from projection_private.purge_salt
  where singleton;

  insert into public.projection_account_purge_log
    (
      account_hash,
      authorized_role,
      authorized_actor,
      deleted_rows
    )
  values (
    encode(
      sha256(convert_to(salt || target::text,'UTF8')),
      'hex'
    ),
    caller,
    actor,
    counts
  );

  delete from projection_private.purge_context
  where backend_pid = pg_backend_pid()
    and transaction_id = txid_current();
end;
$fn$;

notify pgrst, 'reload schema';

commit;