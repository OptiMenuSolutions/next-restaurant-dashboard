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
returns boolean language plpgsql immutable set search_path='' as $fn$
declare item jsonb; n numeric;
begin
  if p is null or jsonb_typeof(p)<>'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p) k)
      is distinct from array['concept_type','normally_closed_weekdays']
    or not coalesce(p->>'concept_type' in ('full_service','bar_pub','quick_service')
      or p->'concept_type'='null'::jsonb,false)
    or jsonb_typeof(p->'normally_closed_weekdays') is distinct from 'array' then return false; end if;
  for item in select value from jsonb_array_elements(p->'normally_closed_weekdays') loop
    if jsonb_typeof(item)<>'number' then return false; end if;
    n:=(item#>>'{}')::numeric;
    if n<>trunc(n) or n<1 or n>7 then return false; end if;
  end loop;
  return p->'normally_closed_weekdays'=coalesce((select jsonb_agg(d.n order by d.n) from (
    select distinct (value#>>'{}')::numeric::integer n
    from jsonb_array_elements(p->'normally_closed_weekdays')) d),'[]'::jsonb);
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
  ) days),'[]'::jsonb)
),a.answered_by
from public.restaurants r
left join public.projection_restaurant_config c on c.restaurant_id=r.id
left join public.projection_owner_answers a on a.restaurant_id=r.id;

create table public.projection_holiday_answer_versions (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  business_date date not null check (isfinite(business_date) and extract(year from business_date) between 1 and 9999),
  revision bigint not null check (revision>0 and revision<=9007199254740991),
  answer text not null check (answer in ('open','closed','early_close')),
  actor_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(restaurant_id,business_date,revision)
);

create table public.projection_holiday_prompt_views (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  holiday_key text not null check (holiday_key in ('thanksgiving_day','christmas_eve','christmas_day','new_years_day','easter','july_4')),
  business_date date not null check (isfinite(business_date) and extract(year from business_date) between 1 and 9999),
  holiday_year integer generated always as (extract(year from business_date)::integer) stored,
  actor_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(restaurant_id,holiday_key,holiday_year)
);

do $block$
declare t text;
begin
  foreach t in array array['projection_holiday_answer_versions','projection_holiday_prompt_views'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create trigger projection_calendar_immutable before update or delete on public.%I for each row execute function projection_private.immutable_row()',t);
    execute format('create trigger projection_calendar_no_truncate before truncate on public.%I for each statement execute function projection_private.immutable_row()',t);
  end loop;
end;
$block$;

create function projection_private.calendar_actor(p_restaurant_id uuid,p_actor_id uuid,p_admin boolean default true)
returns void language plpgsql stable set search_path='' as $fn$
begin
  if p_actor_id is null or not exists(select 1 from public.restaurants r
    where r.id=p_restaurant_id and r.deactivated_at is null and
      (r.user_id=p_actor_id or (p_admin and exists(select 1 from public.profiles where id=p_actor_id and role='admin')))) then
    raise exception 'PROJECTION_OWNER_REQUIRED' using errcode='42501'; end if;
end;
$fn$;

create function projection_private.calendar_setup(p_restaurant_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable set search_path='' as $fn$
declare v public.projection_calendar_versions; settings jsonb; zone text; today date; ctx jsonb; latest_revision bigint;
begin
  perform projection_private.calendar_actor(p_restaurant_id,p_actor_id);
  select operational_timezone into zone from public.restaurants where id=p_restaurant_id;
  select max(revision) into latest_revision from public.projection_calendar_versions where restaurant_id=p_restaurant_id;
  if zone is not null and exists(select 1 from pg_timezone_names where name=zone) then
    ctx:=projection_private.calendar_context(p_restaurant_id,null,null,statement_timestamp());
    today:=(ctx->>'today')::date;
  end if;
  select * into v from public.projection_calendar_versions where restaurant_id=p_restaurant_id
    and (today is null or effective_from is null or effective_from<=today)
    order by case when today is null then revision end desc,effective_from desc nulls last,revision desc limit 1;
  settings:=v.settings;
  if settings is null then
    select jsonb_build_object('concept_type',c.concept_type,
      'normally_closed_weekdays',coalesce(to_jsonb(c.normally_closed_weekdays),'[]'::jsonb)) into settings
    from public.restaurants r left join public.projection_restaurant_config c on c.restaurant_id=r.id where r.id=p_restaurant_id;
  end if;
  return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',coalesce(latest_revision,0),
    'settings',settings,'effective_from',v.effective_from,'timezone',zone,'today',today);
end;
$fn$;

create function public.projection_calendar_setup(p_restaurant_id uuid,p_actor_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $fn$
  select projection_private.calendar_setup(p_restaurant_id,p_actor_id);
$fn$;

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
  ) days),'[]'::jsonb)))) into versions
    from public.restaurants r
    left join public.projection_restaurant_config c on c.restaurant_id=r.id
    left join public.projection_owner_answers a on a.restaurant_id=r.id where r.id=p_restaurant_id;
  end if;
  value:=jsonb_build_object(
    'restaurant_id',p_restaurant_id,'timezone',zone,'today',today,
    'from',first_day,'until',last_day,'model_major',major,
    'global_version_id',g.id,'restaurant_version_id',o.id,'settings',s,
    'closure_conflict_threshold_units',2,'calendar_policy_revision',2,
    'revision',coalesce((select max(revision) from public.projection_calendar_versions
      where restaurant_id=p_restaurant_id),0),'versions',versions,
    'holidays',coalesce((select jsonb_agg(to_jsonb(h) order by holiday_date,holiday_key collate "C")
      from public.projection_holiday_calendar h where holiday_date between make_date(greatest(1,extract(year from first_day)::integer-1),1,1) and last_day),'[]'::jsonb),
    'scheduled_years',coalesce((select jsonb_agg(y order by y) from (
      select extract(year from holiday_date)::integer y from public.projection_holiday_calendar
      where holiday_key='super_bowl' and extract(year from holiday_date)
        between extract(year from first_day) and extract(year from last_day)
    ) years),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('business_date',f.business_date,'total_units',f.total_units,
      'complete',f.complete,'source_revision',f.source_revision,'source_covered',exists(
        select 1 from public.projection_pos_source_windows w where w.restaurant_id=p_restaurant_id
          and (w.valid_from is null or w.valid_from<=f.business_date) and (w.valid_until is null or f.business_date<w.valid_until))) order by business_date)
      from public.projection_nightly_flags f where restaurant_id=p_restaurant_id and business_date<today
        and total_units>=0 and source_revision is not null),'[]'::jsonb),
    'holiday_answers',coalesce((select jsonb_agg(to_jsonb(a) order by business_date) from (
      select distinct on (business_date) * from public.projection_holiday_answer_versions
      where restaurant_id=p_restaurant_id and business_date between first_day and last_day and recorded_at<=p_at
      order by business_date,revision desc) a),'[]'::jsonb),
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
  if p_actor_id is not null then perform projection_private.calendar_actor(p_restaurant_id,p_actor_id); end if;
  return projection_private.calendar_context(p_restaurant_id,p_from,p_until,statement_timestamp());
end;
$fn$;

create function projection_private.save_calendar_answers(p_restaurant_id uuid,p_actor_id uuid,p_expected_revision bigint,p_settings jsonb,p_effective_from date)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $fn$
declare latest public.projection_calendar_versions; chosen public.projection_calendar_versions; baseline jsonb; zone text; start_date date; rev bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  perform projection_private.calendar_actor(p_restaurant_id,p_actor_id);
  perform 1 from public.restaurants where id=p_restaurant_id for key share;
  if p_expected_revision is null or p_expected_revision<0 or not projection_private.valid_calendar_settings(p_settings) then
    raise exception 'PROJECTION_INVALID_OWNER_ANSWERS' using errcode='22023'; end if;
  baseline:=projection_private.calendar_setup(p_restaurant_id,p_actor_id);
  insert into public.projection_calendar_versions(restaurant_id,revision,settings)
    values(p_restaurant_id,0,baseline->'settings') on conflict(restaurant_id,revision) do nothing;
  select * into strict latest from public.projection_calendar_versions where restaurant_id=p_restaurant_id order by revision desc limit 1;
  if p_expected_revision<=latest.revision and latest.settings=p_settings
    and (p_effective_from is null or latest.effective_from is not distinct from p_effective_from) then
    return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',latest.revision,'changed',false,'effective_from',latest.effective_from); end if;
  if p_expected_revision<>latest.revision then raise exception 'PROJECTION_CALENDAR_CONFLICT' using errcode='PT409'; end if;
  if p_effective_from is not null and baseline->>'today' is null then
    raise exception 'PROJECTION_INVALID_EFFECTIVE_DATE' using errcode='22023'; end if;
  zone:=baseline->>'timezone';
  start_date:=p_effective_from;
  if start_date is null and (zone is null or not exists(select 1 from pg_timezone_names where name=zone)) then
    select max(effective_from) into start_date from public.projection_calendar_versions where restaurant_id=p_restaurant_id; end if;
  if start_date is null and latest.revision>0 and zone is not null and exists(select 1 from pg_timezone_names where name=zone) then
    start_date:=(baseline->>'today')::date;
  end if;
  if start_date is not null and (not isfinite(start_date) or extract(year from start_date) not between 1 and 9999
    or (zone is not null and exists(select 1 from pg_timezone_names where name=zone) and start_date>(baseline->>'today')::date)) then
    raise exception 'PROJECTION_INVALID_EFFECTIVE_DATE' using errcode='22023'; end if;
  rev:=latest.revision+1;
  insert into public.projection_calendar_versions(restaurant_id,revision,effective_from,settings,actor_id)
    values(p_restaurant_id,rev,start_date,p_settings,p_actor_id);
  select * into chosen from public.projection_calendar_versions where restaurant_id=p_restaurant_id
    and (baseline->>'today' is null or effective_from is null or effective_from<=(baseline->>'today')::date)
    order by case when baseline->>'today' is null then revision end desc,effective_from desc nulls last,revision desc limit 1;
  insert into public.projection_restaurant_config(restaurant_id,concept_type,normally_closed_weekdays)
    values(p_restaurant_id,chosen.settings->>'concept_type',array(select value::smallint from jsonb_array_elements_text(chosen.settings->'normally_closed_weekdays')))
    on conflict(restaurant_id) do update set concept_type=excluded.concept_type,normally_closed_weekdays=excluded.normally_closed_weekdays,updated_at=clock_timestamp();
  return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',rev,'changed',true,'effective_from',start_date);
end;
$fn$;

create function public.projection_save_calendar_answers(
  p_restaurant_id uuid,p_actor_id uuid,p_expected_revision bigint,p_settings jsonb,p_effective_from date default null
)
returns jsonb language sql security invoker set search_path='' as $fn$
  select projection_private.save_calendar_answers(
    p_restaurant_id,p_actor_id,p_expected_revision,p_settings,p_effective_from);
$fn$;


create function projection_private.holiday_prompt(p_restaurant_id uuid,p_actor_id uuid,p_action text,p_business_date date,p_answer text,p_expected_revision bigint,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $fn$
declare ctx jsonb; day date; key text; latest public.projection_holiday_answer_versions; rev bigint; zone text;
begin
  perform projection_private.calendar_actor(p_restaurant_id,p_actor_id,false);
  if p_action not in ('claim','answer','dismiss') or p_action is null then raise exception 'Invalid prompt action' using errcode='22023'; end if;
  select operational_timezone into zone from public.restaurants where id=p_restaurant_id;
  if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then
    if p_action='claim' then return jsonb_build_object('restaurant_id',p_restaurant_id,'prompt',null); end if;
    raise exception 'Projection timezone is unavailable' using errcode='22023'; end if;
  ctx:=projection_private.calendar_context(p_restaurant_id,null,null,p_at);
  day:=(ctx->>'today')::date;
  perform projection_private.prepare_calendar(day,day+10);
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  perform projection_private.calendar_actor(p_restaurant_id,p_actor_id,false);
  ctx:=projection_private.calendar_context(p_restaurant_id,null,null,p_at);
  day:=(ctx->>'today')::date;
  if p_action='claim' then
    select h.holiday_date,h.holiday_key into day,key from public.projection_holiday_calendar h
    where h.holiday_date between (ctx->>'today')::date and (ctx->>'today')::date+10
      and h.holiday_key in ('thanksgiving_day','christmas_eve','christmas_day','new_years_day','easter','july_4')
      and not exists(select 1 from public.projection_holiday_prompt_views v
        where v.restaurant_id=p_restaurant_id and v.holiday_key=h.holiday_key and v.holiday_year=extract(year from h.holiday_date))
    order by h.holiday_date,h.holiday_key collate "C" limit 1;
    if day is null then return jsonb_build_object('restaurant_id',p_restaurant_id,'prompt',null); end if;
  else
    if p_business_date is null or p_business_date<day or p_business_date>day+10 then
      raise exception 'Holiday response must be for an upcoming prompt date' using errcode='22023'; end if;
    day:=p_business_date;
    select h.holiday_key into key from public.projection_holiday_calendar h where holiday_date=day
      and holiday_key in ('thanksgiving_day','christmas_eve','christmas_day','new_years_day','easter','july_4') limit 1;
    if key is null then raise exception 'Not a supported owner holiday' using errcode='22023'; end if;
  end if;
  insert into public.projection_holiday_prompt_views(restaurant_id,holiday_key,business_date,actor_id)
    values(p_restaurant_id,key,day,p_actor_id) on conflict do nothing;
  select * into latest from public.projection_holiday_answer_versions
    where restaurant_id=p_restaurant_id and business_date=day order by revision desc limit 1;
  rev:=coalesce(latest.revision,0);
  if p_action='answer' then
    if p_answer not in ('open','closed','early_close') or p_answer is null or p_expected_revision is null or p_expected_revision<0 then
      raise exception 'Invalid dated holiday answer' using errcode='22023'; end if;
    if p_expected_revision<=rev and latest.answer=p_answer then
      return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',rev,'changed',false); end if;
    if p_expected_revision<>rev then raise exception 'PROJECTION_CALENDAR_CONFLICT' using errcode='PT409'; end if;
    rev:=rev+1;
    insert into public.projection_holiday_answer_versions(restaurant_id,business_date,revision,answer,actor_id)
      values(p_restaurant_id,day,rev,p_answer,p_actor_id);
  end if;
  return jsonb_build_object('restaurant_id',p_restaurant_id,'revision',rev,'changed',p_action='answer',
    'prompt',case when p_action='claim' then jsonb_build_object('business_date',day,'holiday_key',key,'revision',rev) else null end);
end;
$fn$;

create function public.projection_holiday_prompt(p_restaurant_id uuid,p_actor_id uuid,p_action text,p_business_date date default null,p_answer text default null,p_expected_revision bigint default null)
returns jsonb language sql security invoker set search_path='' as $fn$
  select projection_private.holiday_prompt(p_restaurant_id,p_actor_id,p_action,p_business_date,p_answer,p_expected_revision,clock_timestamp());
$fn$;

create function public.projection_calendar_missing_concepts()
returns jsonb language sql stable security invoker set search_path='' as $fn$
  select jsonb_build_object('count',count(*),'names',coalesce(jsonb_agg(name order by name),'[]'::jsonb))
  from public.restaurants r left join public.projection_restaurant_config c on c.restaurant_id=r.id
  where r.deactivated_at is null and r.id<>'00000000-0000-0000-0000-000000000001'::uuid and c.concept_type is null;
$fn$;

-- Authoritative derivation from the locked, tenant-scoped database context.
create function projection_private.derive_calendar_night(ctx jsonb,day date)
returns jsonb language plpgsql stable set search_path='' as $fn$
declare configuration jsonb; rule jsonb; actual jsonb; prior jsonb; popup jsonb;
  keys text[]; resolved jsonb:='[]'; key text; answer text; source text; concept text; prior_day date;
  weekday integer:=extract(isodow from day)::integer; weekday_group text;
  weekday_closed boolean; weekday_source text; observation_count integer;
  holiday_closed boolean:=false; holiday_open boolean:=false; planned_closed boolean;
  planned_early boolean:=false; closed_flag boolean; early_flag boolean; past boolean:=day<(ctx->>'today')::date;
  factor numeric:=1; threshold numeric:=(ctx->>'closure_conflict_threshold_units')::numeric;
  diagnostic jsonb:='null'; owner_closed boolean;
begin
  if extract(month from day)=2 and not (ctx->'scheduled_years') @> to_jsonb(array[extract(year from day)::integer]) then
    raise exception 'PROJECTION_CALENDAR_INCOMPLETE' using errcode='P0001'; end if;
  select v into configuration from jsonb_array_elements(ctx->'versions') v
    where v->>'effective_from' is null or (v->>'effective_from')::date<=day
    order by (v->>'effective_from')::date desc nulls last,(v->>'revision')::bigint desc limit 1;
  if not projection_private.valid_calendar_settings(configuration->'settings') then
    raise exception 'PROJECTION_INVALID_CALENDAR_SETTINGS' using errcode='22023'; end if;
  concept:=coalesce(configuration#>>'{settings,concept_type}','full_service');
  weekday_group:=case when weekday<=4 then 'mon_thu' when weekday<=6 then 'fri_sat' else 'sun' end;
  select count(*),coalesce(bool_and((v->>'total_units')::numeric<=threshold),false)
    into observation_count,weekday_closed from (
      select v from jsonb_array_elements(ctx->'history') v
      where (v->>'complete')::boolean and (v->>'source_covered')::boolean
        and (v->>'business_date')::date<(ctx->>'today')::date
        and extract(isodow from (v->>'business_date')::date)=weekday
      order by (v->>'business_date')::date desc limit 4) four;
  weekday_source:=case when observation_count=4 then 'pos_last_four' else 'optional_onboarding' end;
  if observation_count<4 then
    weekday_closed:=(configuration#>'{settings,normally_closed_weekdays}') @> to_jsonb(array[weekday]); end if;
  select v into popup from jsonb_array_elements(ctx->'holiday_answers') v where (v->>'business_date')::date=day;
  keys:=array(select h->>'holiday_key' from jsonb_array_elements(ctx->'holidays') h
    where (h->>'holiday_date')::date=day order by (h->>'holiday_key') collate "C");
  foreach key in array keys loop
    select r into rule from jsonb_array_elements(ctx->'rules') r
      where r->>'holiday_key'=key and r->>'concept_type'=concept and r->>'weekday_group' in ('all',weekday_group)
        and (r->>'effective_at')::timestamptz<=(ctx->>'as_of')::timestamptz
      order by (r->>'restaurant_id' is not null) desc,(r->>'weekday_group'=weekday_group) desc,
        (r->>'effective_at')::timestamptz desc limit 1;
    if rule is null then raise exception 'PROJECTION_CALENDAR_RULE_REQUIRED' using errcode='22023'; end if;
    answer:=case when rule->>'default_answer'='closed' then 'closed' else 'open' end;
    source:='default_rule';
    if key in ('thanksgiving_day','christmas_eve','christmas_day','new_years_day','easter','july_4') then
      select (h->>'holiday_date')::date into prior_day from jsonb_array_elements(ctx->'holidays') h
        where h->>'holiday_key'=key and extract(year from (h->>'holiday_date')::date)=extract(year from day)-1;
      select v into prior from jsonb_array_elements(ctx->'history') v where (v->>'business_date')::date=prior_day;
      if (prior->>'complete')::boolean and (prior->>'total_units')::numeric<=threshold then
        answer:='closed'; source:='last_year_pos';
      elsif (prior->>'total_units')::numeric>threshold then answer:='open'; source:='last_year_pos'; end if;
      if popup is not null then answer:=popup->>'answer'; source:='dated_popup'; end if;
    end if;
    factor:=factor*(rule->>'default_factor')::numeric;
    holiday_closed:=holiday_closed or answer='closed';
    holiday_open:=holiday_open or (answer<>'closed' and source in ('dated_popup','last_year_pos'));
    planned_early:=planned_early or (answer='early_close' and source='dated_popup');
    resolved:=resolved||jsonb_build_array(jsonb_build_object('holiday_key',key,'rule_id',rule->>'id',
      'answer',answer,'answer_source',source,'default_factor',rule->'default_factor'));
  end loop;
  planned_closed:=holiday_closed or (weekday_closed and not holiday_open);
  planned_early:=not planned_closed and planned_early;
  select v into actual from jsonb_array_elements(ctx->'history') v where (v->>'business_date')::date=day;
  closed_flag:=case when past then coalesce((actual->>'complete')::boolean,false)
    and coalesce((actual->>'total_units')::numeric<=threshold,false) else planned_closed end;
  early_flag:=not past and planned_early;
  owner_closed:=case when popup is not null then popup->>'answer'='closed'
    when (configuration#>'{settings,normally_closed_weekdays}') @> to_jsonb(array[weekday]) then true else null end;
  if past and (actual->>'complete')::boolean and owner_closed is not null and owner_closed<>closed_flag then
    diagnostic:=jsonb_build_object('code','PROJECTION_CALENDAR_ANSWER_DISAGREEMENT',
      'owner_closed',owner_closed,'actual_closed',closed_flag,'total_units',actual->'total_units'); end if;
  return jsonb_build_object('business_date',day,'weekday',weekday,'holiday_keys',keys,'closed',closed_flag,'early_close',early_flag,
    'regular_service',not closed_flag and not early_flag and cardinality(keys)=0,
    'default_factor',case when closed_flag then 0 when past then 1 when early_flag then (ctx#>>'{settings,early_close_factor}')::numeric else factor end,
    'resolved_holidays',resolved,'concept_type',concept,'concept_fallback',configuration#>>'{settings,concept_type}' is null,
    'weekday_source',weekday_source,'weekday_observations',observation_count,
    'classification_source',case when not past then 'planned' when (actual->>'complete')::boolean then 'complete_pos' else 'incomplete_pos' end,
    'internal_diagnostic',diagnostic,'configuration_revision',(configuration->>'revision')::bigint);
end;
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
declare ctx jsonb; row jsonb; expected jsonb; day date;
  expected_count integer; changed_count integer:=0; n integer;
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
    if day is null or day<p_from or day>least(p_until,(ctx->>'today')::date) then
      raise exception 'PROJECTION_INVALID_CALENDAR_FLAGS' using errcode='22023'; end if;
    expected:=projection_private.derive_calendar_night(ctx,day);
    if (row-'default_factor') is distinct from (expected-'default_factor')
      or jsonb_typeof(row->'default_factor') is distinct from 'number'
    then raise exception 'PROJECTION_INVALID_CALENDAR_FLAGS' using errcode='22023'; end if;
    if (row->>'default_factor')::numeric<0
      or abs((row->>'default_factor')::numeric-(expected->>'default_factor')::numeric)
        > 0.000000000001*greatest(1,abs((expected->>'default_factor')::numeric))
    then raise exception 'PROJECTION_INVALID_CALENDAR_FLAGS' using errcode='22023'; end if;
    -- Persist database-derived values; tolerance above only accepts normal JS
    -- floating point multiplication differences, never worker-selected flags.
    row:=expected;
    insert into public.projection_nightly_flags
      (restaurant_id,business_date,closed,early_close,holiday_keys,flags)
    values(p_restaurant_id,day,(row->>'closed')::boolean,(row->>'early_close')::boolean,array(select jsonb_array_elements_text(row->'holiday_keys')),
      jsonb_build_object('calendar',row||jsonb_build_object('context_digest',p_context_digest,
        'legacy_closed',false,'legacy_early_close',false)))
    on conflict(restaurant_id,business_date) do update set
      closed=excluded.closed,
      early_close=excluded.early_close,
      holiday_keys=excluded.holiday_keys,
      flags=projection_nightly_flags.flags||jsonb_build_object('calendar',
        (excluded.flags->'calendar')||jsonb_build_object(
          'legacy_closed',coalesce((projection_nightly_flags.flags#>>'{calendar,legacy_closed}')::boolean,
            projection_nightly_flags.closed),
          'legacy_early_close',coalesce((projection_nightly_flags.flags#>>'{calendar,legacy_early_close}')::boolean,
            projection_nightly_flags.early_close))),
      updated_at=clock_timestamp()
    where projection_nightly_flags.flags#>>'{calendar,context_digest}' is distinct from p_context_digest
      or projection_nightly_flags.closed is distinct from excluded.closed
      or projection_nightly_flags.early_close is distinct from excluded.early_close
      or projection_nightly_flags.holiday_keys is distinct from excluded.holiday_keys
      or (projection_nightly_flags.flags->'calendar')-array['context_digest','legacy_closed','legacy_early_close']
        is distinct from (excluded.flags->'calendar')-array['context_digest','legacy_closed','legacy_early_close'];
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
    'projection_holiday_prompt_views',
    'projection_holiday_answer_versions',
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
  projection_private.calendar_actor(uuid,uuid,boolean),
  projection_private.calendar_setup(uuid,uuid),
  projection_private.holiday_prompt(uuid,uuid,text,date,text,bigint,timestamptz),
  public.projection_calendar_setup(uuid,uuid),
  public.projection_holiday_prompt(uuid,uuid,text,date,text,bigint),
  public.projection_calendar_missing_concepts()
from public,anon,authenticated,service_role;

grant execute on function
  projection_private.calendar_actor(uuid,uuid,boolean),
  projection_private.calendar_setup(uuid,uuid),
  projection_private.holiday_prompt(uuid,uuid,text,date,text,bigint,timestamptz),
  public.projection_calendar_setup(uuid,uuid),
  public.projection_holiday_prompt(uuid,uuid,text,date,text,bigint),
  public.projection_calendar_missing_concepts()
to service_role;

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
  projection_private.derive_calendar_night(jsonb,date),
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