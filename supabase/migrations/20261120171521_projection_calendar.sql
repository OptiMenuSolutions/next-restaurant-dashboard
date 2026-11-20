begin;

create function projection_private.nth_calendar_weekday(
  p_year integer,p_month integer,p_weekday integer,p_occurrence integer
)
returns date language sql immutable set search_path = '' as $fn$
  select make_date(p_year,p_month,1)
    + ((p_weekday-extract(isodow from make_date(p_year,p_month,1))::integer+7)%7)
    + 7*(p_occurrence-1);
$fn$;

create function projection_private.gregorian_easter(p_year integer)
returns date language plpgsql immutable set search_path = '' as $fn$
declare
  a integer := p_year%19;
  b integer := p_year/100;
  c integer := p_year%100;
  d integer := b/4;
  e integer := b%4;
  f integer := (b+8)/25;
  g integer := (b-f+1)/3;
  h integer := (19*a+b-d-g+15)%30;
  i integer := c/4;
  k integer := c%4;
  l integer := (32+2*e+2*i-h-k)%7;
  m integer := (a+11*h+22*l)/451;
  n integer := h+l-7*m+114;
begin
  return make_date(p_year,n/31,n%31+1);
end;
$fn$;

create function projection_private.core_calendar_dates(p_year integer)
returns table(holiday_date date,holiday_key text)
language sql immutable set search_path = '' as $fn$
  select v.d,v.k from (values
    (make_date(p_year,1,1),'new_years_day'),
    (make_date(p_year,2,14),'valentines_day'),
    (make_date(p_year,3,17),'st_patricks_day'),
    (projection_private.gregorian_easter(p_year),'easter'),
    (make_date(p_year,5,5),'cinco_de_mayo'),
    (projection_private.nth_calendar_weekday(p_year,5,7,2),'mothers_day'),
    (make_date(p_year,5,31)
      -(extract(isodow from make_date(p_year,5,31))::integer-1),'memorial_day'),
    (projection_private.nth_calendar_weekday(p_year,6,7,3),'fathers_day'),
    (make_date(p_year,7,4),'july_4'),
    (projection_private.nth_calendar_weekday(p_year,9,1,1),'labor_day'),
    (make_date(p_year,10,31),'halloween'),
    (projection_private.nth_calendar_weekday(p_year,11,4,4)-1,'thanksgiving_eve'),
    (projection_private.nth_calendar_weekday(p_year,11,4,4),'thanksgiving_day'),
    (projection_private.nth_calendar_weekday(p_year,11,4,4)+1,'black_friday'),
    (make_date(p_year,12,24),'christmas_eve'),
    (make_date(p_year,12,25),'christmas_day'),
    (make_date(p_year,12,31),'new_years_eve')
  ) as v(d,k);
$fn$;

alter table public.projection_holiday_calendar
  add constraint projection_calendar_supported_date check (
    isfinite(holiday_date) and extract(year from holiday_date) between 1 and 9999
    and holiday_key in ('new_years_day','super_bowl','valentines_day','st_patricks_day',
      'easter','cinco_de_mayo','mothers_day','memorial_day','fathers_day','july_4',
      'labor_day','halloween','thanksgiving_eve','thanksgiving_day','black_friday',
      'christmas_eve','christmas_day','new_years_eve')
    and (holiday_key<>'super_bowl' or extract(isodow from holiday_date)=7)
  );

-- Every holiday retains its own row when dates coincide.
create unique index projection_one_holiday_per_year
on public.projection_holiday_calendar
  (holiday_key,(extract(year from holiday_date)));

create function projection_private.prepare_calendar(p_from date,p_until date)
returns void language plpgsql security definer set search_path = '' as $fn$
declare y integer;
begin
  if p_from is null or p_until is null or p_until < p_from
    or extract(year from p_from) < 1 or extract(year from p_until) > 9999
  then raise exception 'Invalid calendar range' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-calendar',0));
  for y in extract(year from p_from)::integer..extract(year from p_until)::integer loop
    insert into public.projection_holiday_calendar(holiday_date,holiday_key,metadata)
    select holiday_date,holiday_key,'{"source":"gregorian_rules_v1"}'::jsonb
    from projection_private.core_calendar_dates(y)
    on conflict (holiday_date,holiday_key) do nothing;
  end loop;
end;
$fn$;

create function public.projection_prepare_calendar(p_from date,p_until date)
returns void language sql security invoker set search_path = '' as $fn$
  select projection_private.prepare_calendar(p_from,p_until);
$fn$;

-- Published starting assumptions, stored as versioned data for Step 7.
insert into public.projection_holiday_rule_versions
  (concept_type,holiday_key,weekday_group,effective_at,default_factor,default_answer)
select concepts.concept,v.k,v.g,statement_timestamp(),
  case concepts.concept when 'full_service' then v.full_factor
    when 'bar_pub' then v.bar_factor else v.quick_factor end,
  v.answer
from (values ('full_service'),('bar_pub'),('quick_service')) as concepts(concept)
cross join (values
  ('new_years_day','all',0.75,0.75,0.85,'open'),
  ('super_bowl','all',0.8,1.3,1.1,'open'),
  ('valentines_day','mon_thu',1.35,1.2,1.15,'open'),
  ('valentines_day','fri_sat',1.15,1.05,1.05,'open'),
  ('valentines_day','sun',1.2,1.1,1.1,'open'),
  ('st_patricks_day','all',1.05,1.4,1.0,'open'),
  ('easter','all',1.0,0.9,1.0,'open'),
  ('cinco_de_mayo','all',1.0,1.0,1.0,'open'),
  ('mothers_day','all',1.45,1.3,1.0,'open'),
  ('memorial_day','all',1.3,1.3,1.1,'open'),
  ('fathers_day','all',1.25,1.15,1.0,'open'),
  ('july_4','all',0.8,0.9,0.9,'open'),
  ('labor_day','all',1.0,1.0,1.0,'open'),
  ('halloween','all',0.9,1.15,1.15,'open'),
  ('thanksgiving_eve','all',1.2,1.35,1.2,'open'),
  ('thanksgiving_day','all',1.0,1.0,1.0,'closed'),
  ('black_friday','all',1.0,1.0,1.0,'open'),
  ('christmas_eve','all',0.7,0.7,0.7,'open'),
  ('christmas_day','all',1.0,1.0,1.0,'closed'),
  ('new_years_eve','all',1.15,1.25,1.0,'open')
) as v(k,g,full_factor,bar_factor,quick_factor,answer)
where not exists (
  select 1 from public.projection_holiday_rule_versions r
  where r.restaurant_id is null and r.concept_type=concepts.concept
    and r.holiday_key=v.k and r.weekday_group=v.g
);


create function projection_private.valid_calendar_settings(p jsonb,p_initial boolean default false)
returns boolean language plpgsql immutable set search_path = '' as $fn$
declare item jsonb; key text; n numeric;
begin
  if p is null or jsonb_typeof(p)<>'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p) k)
      is distinct from array['concept_type','holiday_answers','normally_closed_weekdays']
    or not coalesce(p->>'concept_type' in ('full_service','bar_pub','quick_service')
      or (p_initial and p->'concept_type'='null'::jsonb),false)
    or jsonb_typeof(p->'normally_closed_weekdays') is distinct from 'array'
    or jsonb_typeof(p->'holiday_answers') is distinct from 'object'
  then return false; end if;
  for item in select value from jsonb_array_elements(p->'normally_closed_weekdays') loop
    if jsonb_typeof(item)<>'number' then return false; end if;
    n:=(item#>>'{}')::numeric;
    if n<>trunc(n) or n<1 or n>7 then return false; end if;
  end loop;
  if p->'normally_closed_weekdays' is distinct from coalesce((
    select jsonb_agg(d.n order by d.n) from (
      select distinct (value#>>'{}')::numeric::integer n
      from jsonb_array_elements(p->'normally_closed_weekdays')
    ) d
  ),'[]'::jsonb) then return false; end if;
  for key,item in select * from jsonb_each(p->'holiday_answers') loop
    if key not in ('thanksgiving_day','christmas_eve','christmas_day','new_years_day','easter','july_4')
      or jsonb_typeof(item)<>'string' or item#>>'{}' not in ('open','closed','early_close')
    then return false; end if;
  end loop;
  return true;
end;
$fn$;

create table public.projection_calendar_versions (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  revision bigint not null check (revision>=0 and revision<=9007199254740991),
  effective_from date check (effective_from is null or
    (isfinite(effective_from) and extract(year from effective_from) between 1 and 9999)),
  settings jsonb not null,
  actor_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(restaurant_id,revision),
  check (projection_private.valid_calendar_settings(settings,revision=0))
);
create index projection_calendar_effective_idx
on public.projection_calendar_versions(restaurant_id,effective_from,revision);
alter table public.projection_calendar_versions enable row level security;
revoke all on public.projection_calendar_versions from public,anon,authenticated,service_role;
grant select on public.projection_calendar_versions to service_role;
create trigger projection_calendar_version_immutable
before update or delete on public.projection_calendar_versions
for each row execute function projection_private.immutable_row();
create trigger projection_calendar_version_no_truncate
before truncate on public.projection_calendar_versions
for each statement execute function projection_private.immutable_row();

insert into public.projection_calendar_versions(restaurant_id,revision,settings,actor_id)
select r.id,0,jsonb_build_object(
  'concept_type',c.concept_type,
  'normally_closed_weekdays',coalesce((select jsonb_agg(d order by d) from (
    select distinct unnest(coalesce(c.normally_closed_weekdays,'{}'::smallint[])) d
  ) days),'[]'::jsonb),
  'holiday_answers',coalesce(a.holiday_answers,'{}'::jsonb)
),a.answered_by
from public.restaurants r
left join public.projection_restaurant_config c on c.restaurant_id=r.id
left join public.projection_owner_answers a on a.restaurant_id=r.id;

create function projection_private.calendar_context(
  p_restaurant_id uuid,p_from date,p_until date,p_at timestamptz
)
returns jsonb language plpgsql stable set search_path = '' set timezone='UTC' as $fn$
declare
  zone text; major integer; g record; o record; s jsonb;
  today date; first_day date; last_day date; value jsonb; versions jsonb;
begin
  select operational_timezone into zone from public.restaurants
  where id=p_restaurant_id and deactivated_at is null;
  if not found then raise exception 'PROJECTION_RESTAURANT_UNAVAILABLE' using errcode='42501'; end if;
  if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then
    raise exception 'PROJECTION_TIMEZONE_REQUIRED' using errcode='22023';
  end if;
  select model_major into major from public.projection_model_versions
  where released_at<=p_at order by released_at desc,model_major desc limit 1;
  select id,settings into g from public.projection_setting_versions
  where restaurant_id is null and model_major=major and effective_at<=p_at
  order by effective_at desc limit 1;
  select id,settings into o from public.projection_setting_versions
  where restaurant_id=p_restaurant_id and model_major=major and effective_at<=p_at
  order by effective_at desc limit 1;
  s:=g.settings||coalesce(o.settings,'{}'::jsonb);
  if s is null or not projection_private.check_settings(s) then
    raise exception 'PROJECTION_SETTINGS_REQUIRED' using errcode='22023';
  end if;
  today:=(p_at at time zone zone)::date;
  if p_at<projection_private.business_boundary(today,zone,(s->>'business_day_cutoff_minutes')::numeric::integer)
    then today:=today-1; end if;
  first_day:=coalesce(p_from,today);
  last_day:=coalesce(p_until,first_day+(s->>'horizon_days')::numeric::integer-1);
  if last_day<first_day or extract(year from first_day)<1 or extract(year from last_day)>9999 then
    raise exception 'PROJECTION_INVALID_CALENDAR_RANGE' using errcode='22023';
  end if;
  select jsonb_agg(to_jsonb(v) order by effective_from nulls first,revision) into versions
  from public.projection_calendar_versions v
  where restaurant_id=p_restaurant_id and (effective_from is null or effective_from<=last_day);
  if versions is null then
    select jsonb_build_array(jsonb_build_object(
      'restaurant_id',r.id,'revision',0,'effective_from',null,'actor_id',a.answered_by,
      'settings',jsonb_build_object('concept_type',c.concept_type,
        'normally_closed_weekdays',coalesce((select jsonb_agg(d order by d) from (
    select distinct unnest(coalesce(c.normally_closed_weekdays,'{}'::smallint[])) d
  ) days),'[]'::jsonb),
        'holiday_answers',coalesce(a.holiday_answers,'{}'::jsonb)))) into versions
    from public.restaurants r
    left join public.projection_restaurant_config c on c.restaurant_id=r.id
    left join public.projection_owner_answers a on a.restaurant_id=r.id where r.id=p_restaurant_id;
  end if;
  value:=jsonb_build_object(
    'restaurant_id',p_restaurant_id,'timezone',zone,'today',today,
    'from',first_day,'until',last_day,'model_major',major,
    'global_version_id',g.id,'restaurant_version_id',o.id,'settings',s,
    'revision',coalesce((select max(revision) from public.projection_calendar_versions
      where restaurant_id=p_restaurant_id),0),'versions',versions,
    'holidays',coalesce((select jsonb_agg(to_jsonb(h) order by holiday_date,holiday_key collate "C")
      from public.projection_holiday_calendar h where holiday_date between first_day and last_day),'[]'::jsonb),
    'scheduled_years',coalesce((select jsonb_agg(y order by y) from (
      select extract(year from holiday_date)::integer y from public.projection_holiday_calendar
      where holiday_key='super_bowl' and extract(year from holiday_date)
        between extract(year from first_day) and extract(year from last_day)
    ) years),'[]'::jsonb),
    'observed_closures',coalesce((select jsonb_agg(jsonb_build_object(
      'business_date',f.business_date,
      'closed',coalesce((f.flags#>>'{calendar,legacy_closed}')::boolean,f.closed),
      'early_close',coalesce((f.flags#>>'{calendar,legacy_early_close}')::boolean,f.early_close)
    ) order by business_date) from public.projection_nightly_flags f
    where restaurant_id=p_restaurant_id and business_date between first_day and last_day
      and (coalesce((f.flags#>>'{calendar,legacy_closed}')::boolean,f.closed)
        or coalesce((f.flags#>>'{calendar,legacy_early_close}')::boolean,f.early_close))),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(to_jsonb(h) order by id)
      from public.projection_holiday_rule_versions h
      where (restaurant_id is null or restaurant_id=p_restaurant_id) and effective_at<=p_at),'[]'::jsonb)
  );
  return value||jsonb_build_object('as_of',p_at,
    'context_digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'));
end;
$fn$;

create function public.projection_calendar_context(
  p_restaurant_id uuid,p_from date default null,p_until date default null,p_actor_id uuid default null
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $fn$
begin
  if p_actor_id is not null and not exists (
    select 1 from public.restaurants where id=p_restaurant_id and user_id=p_actor_id
  ) then raise exception 'PROJECTION_OWNER_REQUIRED' using errcode='42501'; end if;
  return projection_private.calendar_context(p_restaurant_id,p_from,p_until,statement_timestamp());
end;
$fn$;

create function projection_private.save_calendar_answers(
  p_restaurant_id uuid,p_actor_id uuid,p_expected_revision bigint,
  p_settings jsonb,p_effective_from date
)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $fn$
declare ctx jsonb; latest public.projection_calendar_versions;
  chosen public.projection_calendar_versions; next_revision bigint; start_date date; baseline_actor uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  perform 1 from public.restaurants where id=p_restaurant_id and user_id=p_actor_id
    and deactivated_at is null for key share;
  if not found or p_actor_id is null then
    raise exception 'PROJECTION_OWNER_REQUIRED' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<0
    or not projection_private.valid_calendar_settings(p_settings,false) then
    raise exception 'PROJECTION_INVALID_OWNER_ANSWERS' using errcode='22023'; end if;
  ctx:=projection_private.calendar_context(p_restaurant_id,null,null,clock_timestamp());
  insert into public.projection_calendar_versions(restaurant_id,revision,settings,actor_id)
  select p_restaurant_id,0,v->'settings',(v->>'actor_id')::uuid
  from jsonb_array_elements(ctx->'versions') v where (v->>'revision')::bigint=0
  on conflict(restaurant_id,revision) do nothing;
  select * into strict latest from public.projection_calendar_versions
  where restaurant_id=p_restaurant_id order by revision desc limit 1;
  if p_effective_from is null and p_expected_revision<=latest.revision and latest.settings=p_settings then
    return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',latest.revision,
      'changed',false,'effective_from',latest.effective_from);
  end if;
  start_date:=coalesce(p_effective_from,(ctx->>'today')::date);
  if latest.revision=0 and latest.actor_id is null and p_effective_from is null then
    start_date:=null;
  end if;
  if start_date>(ctx->>'today')::date then
    raise exception 'PROJECTION_INVALID_EFFECTIVE_DATE' using errcode='22023'; end if;
  if p_expected_revision<=latest.revision and latest.settings=p_settings
    and latest.effective_from is not distinct from start_date then
    return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',latest.revision,
      'changed',false,'effective_from',start_date);
  end if;
  if p_expected_revision<>latest.revision then
    raise exception 'PROJECTION_CALENDAR_CONFLICT' using errcode='PT409'; end if;
  next_revision:=latest.revision+1;
  insert into public.projection_calendar_versions
    (restaurant_id,revision,effective_from,settings,actor_id)
  values(p_restaurant_id,next_revision,start_date,p_settings,p_actor_id);
  select * into strict chosen from public.projection_calendar_versions
  where restaurant_id=p_restaurant_id and (effective_from is null or effective_from<=(ctx->>'today')::date)
  order by effective_from desc nulls last,revision desc limit 1;
  insert into public.projection_restaurant_config(restaurant_id,concept_type,normally_closed_weekdays)
  values(p_restaurant_id,chosen.settings->>'concept_type',array(
    select value::smallint from jsonb_array_elements_text(chosen.settings->'normally_closed_weekdays')))
  on conflict(restaurant_id) do update set concept_type=excluded.concept_type,
    normally_closed_weekdays=excluded.normally_closed_weekdays,updated_at=clock_timestamp()
  where (projection_restaurant_config.concept_type,projection_restaurant_config.normally_closed_weekdays)
    is distinct from (excluded.concept_type,excluded.normally_closed_weekdays);
  insert into public.projection_owner_answers(restaurant_id,holiday_answers,answered_by)
  values(p_restaurant_id,chosen.settings->'holiday_answers',chosen.actor_id)
  on conflict(restaurant_id) do update set holiday_answers=excluded.holiday_answers,
    answered_by=excluded.answered_by,updated_at=clock_timestamp()
  where (projection_owner_answers.holiday_answers,projection_owner_answers.answered_by)
    is distinct from (excluded.holiday_answers,excluded.answered_by);
  return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',next_revision,
    'changed',true,'effective_from',start_date);
end;
$fn$;

create function public.projection_save_calendar_answers(
  p_restaurant_id uuid,p_actor_id uuid,p_expected_revision bigint,p_settings jsonb,p_effective_from date default null
)
returns jsonb language sql security invoker set search_path='' as $fn$
  select projection_private.save_calendar_answers(
    p_restaurant_id,p_actor_id,p_expected_revision,p_settings,p_effective_from);
$fn$;


create function projection_private.lock_calendar_catalog()
returns trigger language plpgsql set search_path='' as $fn$
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-calendar',0));
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$fn$;
create trigger projection_calendar_catalog_lock
before insert or update or delete on public.projection_holiday_calendar
for each row execute function projection_private.lock_calendar_catalog();
create trigger projection_calendar_rule_lock
before insert on public.projection_holiday_rule_versions
for each row execute function projection_private.lock_calendar_catalog();

create function projection_private.apply_calendar_flags(
  p_restaurant_id uuid,p_from date,p_until date,p_context_digest text,p_nights jsonb
)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $fn$
declare ctx jsonb; row jsonb; day date; keys text[]; expected_keys text[];
  expected_count integer; changed_count integer:=0; n integer; configuration_revision bigint;
begin
  if p_from is null or p_until is null then
    raise exception 'PROJECTION_INVALID_CALENDAR_RANGE' using errcode='22023'; end if;
  ctx:=projection_private.calendar_context(p_restaurant_id,p_from,p_until,clock_timestamp());
  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-settings:'||(ctx->>'model_major'),0));
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-calendar',0));
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  ctx:=projection_private.calendar_context(p_restaurant_id,p_from,p_until,clock_timestamp());
  if p_context_digest is distinct from ctx->>'context_digest' then
    raise exception 'PROJECTION_CALENDAR_CONFLICT' using errcode='PT409'; end if;
  expected_count:=greatest(0,least(p_until,(ctx->>'today')::date)-p_from+1);
  if jsonb_typeof(p_nights) is distinct from 'array'
    or jsonb_array_length(p_nights)<>expected_count then
    raise exception 'PROJECTION_PARTIAL_CALENDAR_FLAGS' using errcode='22023'; end if;
  if (select count(distinct value->>'business_date') from jsonb_array_elements(p_nights))<>expected_count then
    raise exception 'PROJECTION_DUPLICATE_CALENDAR_FLAGS' using errcode='22023'; end if;
  for row in select value from jsonb_array_elements(p_nights) loop
    day:=(row->>'business_date')::date;
    keys:=array(select jsonb_array_elements_text(row->'holiday_keys'));
    select coalesce(array_agg(holiday_key order by holiday_key collate "C"),'{}') into expected_keys
    from public.projection_holiday_calendar where holiday_date=day;
    select v.revision into configuration_revision from public.projection_calendar_versions v
    where v.restaurant_id=p_restaurant_id and (effective_from is null or effective_from<=day)
    order by effective_from desc nulls last,revision desc limit 1;
    if day is null or day<p_from or day>least(p_until,(ctx->>'today')::date)
      or jsonb_typeof(row->'closed') is distinct from 'boolean'
      or jsonb_typeof(row->'early_close') is distinct from 'boolean'
      or ((row->>'closed')::boolean and (row->>'early_close')::boolean)
      or jsonb_typeof(row->'holiday_keys') is distinct from 'array'
      or keys is distinct from expected_keys
      or not projection_private.valid_holiday_keys(keys)
      or coalesce(configuration_revision,0) is distinct from (row->>'configuration_revision')::bigint
      or jsonb_typeof(row->'default_factor') is distinct from 'number'
      or (row->>'default_factor')::numeric<0
      or (row->>'default_factor')::numeric>='Infinity'::numeric
    then raise exception 'PROJECTION_INVALID_CALENDAR_FLAGS' using errcode='22023'; end if;
    insert into public.projection_nightly_flags
      (restaurant_id,business_date,closed,early_close,holiday_keys,flags)
    values(p_restaurant_id,day,(row->>'closed')::boolean,(row->>'early_close')::boolean,keys,
      jsonb_build_object('calendar',row||jsonb_build_object('context_digest',p_context_digest,
        'legacy_closed',false,'legacy_early_close',false)))
    on conflict(restaurant_id,business_date) do update set
      closed=excluded.closed or coalesce(
        (projection_nightly_flags.flags#>>'{calendar,legacy_closed}')::boolean,
        projection_nightly_flags.closed),
      early_close=not (excluded.closed or coalesce(
        (projection_nightly_flags.flags#>>'{calendar,legacy_closed}')::boolean,
        projection_nightly_flags.closed)) and (excluded.early_close or coalesce(
        (projection_nightly_flags.flags#>>'{calendar,legacy_early_close}')::boolean,
        projection_nightly_flags.early_close)),
      holiday_keys=excluded.holiday_keys,
      flags=projection_nightly_flags.flags||jsonb_build_object('calendar',
        (excluded.flags->'calendar')||jsonb_build_object(
          'legacy_closed',coalesce((projection_nightly_flags.flags#>>'{calendar,legacy_closed}')::boolean,
            projection_nightly_flags.closed),
          'legacy_early_close',coalesce((projection_nightly_flags.flags#>>'{calendar,legacy_early_close}')::boolean,
            projection_nightly_flags.early_close))),
      updated_at=clock_timestamp()
    where projection_nightly_flags.flags#>>'{calendar,context_digest}' is distinct from p_context_digest;
    get diagnostics n=row_count;
    changed_count:=changed_count+n;
  end loop;
  return jsonb_build_object('restaurant_id',p_restaurant_id,'changed_nights',changed_count);
end;
$fn$;

create function public.projection_apply_calendar_flags(
  p_restaurant_id uuid,p_from date,p_until date,p_context_digest text,p_nights jsonb
)
returns jsonb language sql security invoker set search_path='' as $fn$
  select projection_private.apply_calendar_flags(p_restaurant_id,p_from,p_until,p_context_digest,p_nights);
$fn$;


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
    'projection_calendar_versions',
    'projection_ingestion_policy_versions',
    'projection_pos_source_repairs',
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

revoke all on function
  projection_private.nth_calendar_weekday(integer,integer,integer,integer),
  projection_private.gregorian_easter(integer),
  projection_private.core_calendar_dates(integer),
  projection_private.prepare_calendar(date,date),
  projection_private.valid_calendar_settings(jsonb,boolean),
  projection_private.calendar_context(uuid,date,date,timestamptz),
  projection_private.save_calendar_answers(uuid,uuid,bigint,jsonb,date),
  projection_private.apply_calendar_flags(uuid,date,date,text,jsonb),
  projection_private.lock_calendar_catalog(),
  public.projection_prepare_calendar(date,date),
  public.projection_calendar_context(uuid,date,date,uuid),
  public.projection_save_calendar_answers(uuid,uuid,bigint,jsonb,date),
  public.projection_apply_calendar_flags(uuid,date,date,text,jsonb)
from public,anon,authenticated,service_role;

grant execute on function
  projection_private.prepare_calendar(date,date),
  projection_private.calendar_context(uuid,date,date,timestamptz),
  projection_private.save_calendar_answers(uuid,uuid,bigint,jsonb,date),
  projection_private.apply_calendar_flags(uuid,date,date,text,jsonb),
  public.projection_prepare_calendar(date,date),
  public.projection_calendar_context(uuid,date,date,uuid),
  public.projection_save_calendar_answers(uuid,uuid,bigint,jsonb,date),
  public.projection_apply_calendar_flags(uuid,date,date,text,jsonb)
to service_role;

-- Scheduled sports dates are approved calendar data, not a recurring formula.
insert into public.projection_holiday_calendar(holiday_date,holiday_key,metadata)
select d,'super_bowl','{"source":"approved_v4_calendar"}'::jsonb
from (values (date '2024-02-11'),(date '2025-02-09'),(date '2026-02-08'),
  (date '2027-02-14'),(date '2028-02-13')) as dates(d)
on conflict(holiday_date,holiday_key) do nothing;

select projection_private.prepare_calendar(
  make_date(extract(year from statement_timestamp() at time zone 'UTC')::integer-2,1,1),
  make_date(extract(year from statement_timestamp() at time zone 'UTC')::integer+1,12,31)
);

notify pgrst,'reload schema';
commit;