begin;

do $b$
declare d text;
begin
  d:=pg_get_functiondef(
    'projection_private.check_settings(jsonb,boolean)'::regprocedure
  );
  execute replace(
    d,
    'FUNCTION projection_private.check_settings(',
    'FUNCTION projection_private.check_settings_before_benchmarks('
  );
end $b$;

create or replace function projection_private.check_settings(
  p jsonb,
  partial boolean default false
) returns boolean
language sql immutable set search_path='' as $f$
  select projection_private.check_settings_before_benchmarks(
    p-'minimum_trends_terms',
    partial
  )
  and (
    not p?'minimum_trends_terms'
    or coalesce(
      jsonb_typeof(p->'minimum_trends_terms')='number'
      and (p->>'minimum_trends_terms')::numeric between 2 and 4
      and trunc((p->>'minimum_trends_terms')::numeric)
        =(p->>'minimum_trends_terms')::numeric,
      false
    )
  );
$f$;

insert into public.projection_setting_versions(
  restaurant_id,model_major,effective_at,settings
)
select null,4,greatest(clock_timestamp(),effective_at+interval '1 microsecond'),
  settings||'{"minimum_trends_terms":2}'
from public.projection_setting_versions
where restaurant_id is null and model_major=4
order by effective_at desc limit 1;

create table public.projection_benchmark_versions(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  vintage date not null,
  valid_from date not null,
  valid_until date not null,
  sales_pull_id uuid not null references public.projection_benchmark_pulls,
  cpi_pull_id uuid not null references public.projection_benchmark_pulls,
  dictionary jsonb not null,
  dictionary_digest text not null
    check(dictionary_digest ~ '^[a-f0-9]{64}$'),
  check(valid_until>=valid_from and valid_until<=valid_from+70),
  check(vintage<=created_at::date)
);

create table public.projection_benchmark_publications(
  version_id uuid primary key references public.projection_benchmark_versions,
  published_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  automatic boolean not null default false,
  check(automatic or actor_id is not null)
);

create table public.projection_benchmark_previews(
  version_id uuid not null references public.projection_benchmark_versions,
  restaurant_id uuid not null references public.restaurants,
  name text not null,
  state text,
  concept_type text,
  snapshot_at timestamptz not null,
  source_digest text,
  result jsonb not null,
  primary key(version_id,restaurant_id)
);

create table public.projection_benchmark_contributions(
  version_id uuid not null references public.projection_benchmark_versions,
  restaurant_id uuid not null references public.restaurants,
  concept_type text not null,
  state text not null check(state ~ '^[A-Z]{2}$'),
  target_date date not null,
  metric text not null check(metric in (
    'volume',
    'category:Comfort/Heavy',
    'category:Light/Fresh',
    'category:Neutral',
    'launch:Comfort/Heavy',
    'launch:Light/Fresh',
    'launch:Neutral'
  )),
  ratio double precision not null
    check(ratio>=0 and ratio<'Infinity'::float8),
  source_digest text not null check(source_digest ~ '^[a-f0-9]{64}$'),
  primary key(version_id,restaurant_id,target_date,metric)
);

create index projection_benchmark_contributor_idx
on public.projection_benchmark_contributions(
  version_id,target_date,metric,concept_type,state
);

create function projection_private.benchmark_lock() returns trigger
language plpgsql set search_path='' as $f$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-settings:4',0)
  );
  return coalesce(new,old);
end $f$;

do $b$
declare t text;
begin
  foreach t in array array[
    'projection_benchmark_versions',
    'projection_benchmark_publications',
    'projection_benchmark_previews',
    'projection_benchmark_contributions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format(
      'revoke all on public.%I from public,anon,authenticated,service_role',t
    );
    execute format('grant select on public.%I to service_role',t);
    execute format(
      'create trigger benchmark_immutable
       before update or delete on public.%I
       for each row execute function projection_private.immutable_row()',t
    );
    execute format(
      'create trigger benchmark_no_truncate
       before truncate on public.%I
       for each statement execute function projection_private.immutable_row()',t
    );
  end loop;

  foreach t in array array[
    'projection_pool_permissions','projection_pool_memberships'
  ] loop
    execute format(
      'create trigger benchmark_lock
       before insert or update or delete on public.%I
       for each row execute function projection_private.benchmark_lock()',t
    );
  end loop;
end $b$;

create function projection_private.benchmark_participants(
  vid uuid,
  rid uuid,
  target date,
  kind text,
  concept text,
  region text
) returns table(restaurant_id uuid,ratio double precision)
language sql stable set search_path='' as $f$
  select c.restaurant_id,c.ratio
  from public.projection_benchmark_contributions c
  join public.projection_pool_permissions p using(restaurant_id)
  join public.restaurants r on r.id=c.restaurant_id
  join public.projection_restaurant_config cfg on cfg.restaurant_id=r.id
  where c.version_id=vid
    and c.restaurant_id<>rid
    and c.target_date=target
    and c.metric=kind
    and c.concept_type=concept
    and cfg.concept_type=concept
    and (region='US' or c.state=region)
    and p.enabled
    and p.agreement_permits
    and nullif(trim(p.agreement_version),'') is not null
    and r.deactivated_at is null;
$f$;

alter table public.projection_pooled_totals
  add column restaurant_id uuid references public.restaurants,
  add column benchmark_version_id uuid
    references public.projection_benchmark_versions,
  add column target_date date;

do $b$
declare n text;
begin
  for n in
    select conname from pg_constraint
    where conrelid='public.projection_pooled_totals'::regclass
      and contype='u'
  loop
    execute format(
      'alter table public.projection_pooled_totals drop constraint %I',n
    );
  end loop;
end $b$;

create unique index projection_pooled_receiver_value_idx
on public.projection_pooled_totals(
  benchmark_version_id,restaurant_id,cohort_key,metric,target_date
);

create or replace function projection_private.validate_pooled_period()
returns trigger language plpgsql set search_path='' as $f$
declare
  c public.projection_pool_cohorts;
  n integer;
  value double precision;
  s jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-settings:4',0)
  );

  select settings into s
  from public.projection_setting_versions
  where restaurant_id is null and model_major=4
    and effective_at<=clock_timestamp()
  order by effective_at desc limit 1;

  if not coalesce((s->>'pooled_benchmarks_enabled')::boolean,false) then
    raise exception 'Pooled benchmarks are globally disabled';
  end if;

  s:=s||coalesce((
    select settings from public.projection_setting_versions
    where restaurant_id=new.restaurant_id and model_major=4
      and effective_at<=clock_timestamp()
    order by effective_at desc limit 1
  ),'{}');

  select * into strict c
  from public.projection_pool_cohorts
  where cohort_key=new.cohort_key;

  if not exists(
    select 1
    from public.projection_restaurant_config cfg
    join public.restaurants r on r.id=cfg.restaurant_id
    where r.id=new.restaurant_id
      and r.deactivated_at is null
      and cfg.concept_type=c.concept_type
      and (
        c.region_code='US'
        or upper(to_jsonb(r)->>'shipping_state')=c.region_code
      )
  ) then
    raise exception 'Receiver is outside the cohort';
  end if;

  if new.restaurant_id is null
    or new.benchmark_version_id is null
    or new.target_date is null
    or extract(isodow from new.period_start)<>1
    or new.period_end<>new.period_start+6
    or new.target_date not between new.period_start and new.period_end
    or not exists(
      select 1 from public.projection_pool_permissions p
      where p.restaurant_id=new.restaurant_id
        and p.enabled and p.agreement_permits
        and nullif(trim(p.agreement_version),'') is not null
    )
  then
    raise exception
      'A permitted receiver and exact contribution evidence are required';
  end if;

  select count(*),avg(x.ratio) into n,value
  from projection_private.benchmark_participants(
    new.benchmark_version_id,
    new.restaurant_id,
    new.target_date,
    new.metric,
    c.concept_type,
    c.region_code
  ) x;

  if n<greatest(5,(s->>'minimum_pooled_restaurants')::integer) then
    raise exception
      'At least five actual contributors other than the receiver are required';
  end if;

  new.participant_count:=n;
  new.statistics:=jsonb_build_object(
    'ratio',value,
    'cohort_level',
    case when c.region_code='US' then 'national' else 'state' end
  );
  new.computed_at:=clock_timestamp();

  return new;
end $f$;

create or replace view public.projection_available_pooled_totals
with(security_invoker=true) as
select t.*
from public.projection_pooled_totals t
join public.projection_pool_cohorts c using(cohort_key)
where t.restaurant_id is not null
  and exists(
    select 1 from public.projection_pool_permissions p
    where p.restaurant_id=t.restaurant_id
      and p.enabled and p.agreement_permits
  )
  and (
    select count(*)
    from projection_private.benchmark_participants(
      t.benchmark_version_id,t.restaurant_id,t.target_date,
      t.metric,c.concept_type,c.region_code
    )
  )>=5;

create function projection_private.benchmark_context(
  rid uuid,
  day date,
  at_time timestamptz
) returns jsonb
language plpgsql stable set search_path='' as $f$
declare
  v public.projection_benchmark_versions;
  published timestamptz;
  region text;
  concept text;
  settings jsonb;
  pooled jsonb:='[]';
  row record;
  chosen record;
  national record;
  minimum integer;
  zone text;
  current_day date;
begin
  select upper(to_jsonb(r)->>'shipping_state'),
    cfg.concept_type,r.operational_timezone
  into region,concept,zone
  from public.restaurants r
  join public.projection_restaurant_config cfg on cfg.restaurant_id=r.id
  where r.id=rid;

  select x.*,p.published_at into row
  from public.projection_benchmark_versions x
  join public.projection_benchmark_publications p on p.version_id=x.id
  where p.published_at<=at_time and x.created_at<=at_time
  order by p.published_at desc limit 1;

  if found then
    select * into v
    from public.projection_benchmark_versions where id=row.id;
    published:=row.published_at;
  end if;

  settings:=projection_private.run_timing(rid,at_time)->'settings';
  minimum:=greatest(5,(settings->>'minimum_pooled_restaurants')::integer);

  if v.id is not null
    and day between v.valid_from and v.valid_until
    and coalesce((settings->>'pooled_benchmarks_enabled')::boolean,false)
    and exists(
      select 1 from public.projection_pool_permissions p
      where p.restaurant_id=rid and p.enabled and p.agreement_permits
        and nullif(trim(p.agreement_version),'') is not null
    )
  then
    for row in
      select distinct target_date,metric
      from public.projection_benchmark_contributions
      where version_id=v.id and target_date between day and day+7
      order by target_date,metric
    loop
      select count(*) n,avg(ratio) ratio into chosen
      from projection_private.benchmark_participants(
        v.id,rid,row.target_date,row.metric,concept,region
      );

      if chosen.n>=minimum then
        pooled:=pooled||jsonb_build_array(jsonb_build_object(
          'target_date',row.target_date,
          'metric',row.metric,
          'ratio',chosen.ratio,
          'contributors',chosen.n,
          'cohort_level','state',
          'version_id',v.id
        ));
      else
        select count(*) n,avg(ratio) ratio into national
        from projection_private.benchmark_participants(
          v.id,rid,row.target_date,row.metric,concept,'US'
        );

        if national.n>=minimum then
          pooled:=pooled||jsonb_build_array(jsonb_build_object(
            'target_date',row.target_date,
            'metric',row.metric,
            'ratio',national.ratio,
            'contributors',national.n,
            'cohort_level','national',
            'version_id',v.id
          ));
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'restaurant_id',rid,
    'as_of',day,
    'state',case when region ~ '^[A-Z]{2}$' then 'US-'||region else null end,
    'closed_weekdays',coalesce((
      select jsonb_agg(w order by w)
      from generate_series(1,7) w
      where case
        when (
          select count(*) from (
            select 1 from public.projection_nightly_flags f
            where f.restaurant_id=rid and f.business_date<day
              and f.complete
              and extract(isodow from f.business_date)=w
              and projection_private.source_covered(rid,f.business_date)
            order by f.business_date desc limit 4
          ) a
        )=4
        then (
          select bool_and(a.total_units<=2) from (
            select f.total_units from public.projection_nightly_flags f
            where f.restaurant_id=rid and f.business_date<day
              and f.complete
              and extract(isodow from f.business_date)=w
              and projection_private.source_covered(rid,f.business_date)
            order by f.business_date desc limit 4
          ) a
        )
        else coalesce((
          select cv.settings->'normally_closed_weekdays'
          from public.projection_calendar_versions cv
          where cv.restaurant_id=rid
            and (cv.effective_from is null or cv.effective_from<=day)
          order by cv.effective_from desc nulls last,cv.revision desc
          limit 1
        ),'[]')@>to_jsonb(array[w])
      end
    ),'[]'),
    'status',case
      when v.id is null then 'awaiting_first_approval'
      when at_time>v.created_at+interval '40 days'
        or exists(
          select 1 from public.projection_benchmark_status
          where provider='census' and stale
        )
      then 'stale_last_good'
      else 'current'
    end,
    'pooled',pooled,
    'release',case when v.id is null then null else jsonb_build_object(
      'id',v.id,
      'created_at',v.created_at,
      'published_at',published,
      'dictionary_digest',v.dictionary_digest,
      'census',jsonb_build_object(
        'sales',(
          select jsonb_agg(jsonb_build_object(
            'date',x->>'date',
            'value',case when x->>'value'='.'
              then null else (x->>'value')::float8 end
          ) order by x->>'date')
          from public.projection_benchmark_pulls p
          cross join lateral jsonb_array_elements(
            p.payload->'observations'
          ) x
          where p.id=v.sales_pull_id
        ),
        'cpi',(
          select jsonb_agg(jsonb_build_object(
            'date',x->>'date',
            'value',case when x->>'value'='.'
              then null else (x->>'value')::float8 end
          ) order by x->>'date')
          from public.projection_benchmark_pulls p
          cross join lateral jsonb_array_elements(
            p.payload->'observations'
          ) x
          where p.id=v.cpi_pull_id
        )
      )
    ) end
  );
end $f$;

do $b$
declare d text;
begin
  d:=pg_get_functiondef(
    'projection_private.run_inputs(uuid,date,timestamptz)'::regprocedure
  );
  execute replace(
    d,
    'FUNCTION projection_private.run_inputs(',
    'FUNCTION projection_private.run_inputs_before_benchmarks('
  );
end $b$;

create or replace function projection_private.run_inputs(
  rid uuid,day date,at_time timestamptz
) returns jsonb
language plpgsql stable set search_path='' as $f$
declare r jsonb;
begin
  r:=projection_private.run_inputs_before_benchmarks(
    rid,day,at_time
  )-'context_digest';

  if r#>'{timing,settings}'?'minimum_trends_terms' then
    r:=r||jsonb_build_object(
      'benchmarks',projection_private.benchmark_context(rid,day,at_time)
    );
  end if;

  return r||jsonb_build_object(
    'context_digest',encode(sha256(convert_to(r::text,'UTF8')),'hex')
  );
end $f$;

create function public.projection_benchmark_inputs(
  rid uuid,at_time timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t jsonb;
begin
  if at_time>clock_timestamp() then
    raise exception 'Future benchmark snapshot';
  end if;

  t:=projection_private.run_timing(rid,at_time);

  return projection_private.run_inputs(
    rid,(t->>'business_date')::date,at_time
  );
end $f$;

create function public.projection_benchmark_catalog() returns jsonb
language sql security definer set search_path='' as $f$
  select jsonb_build_object(
    'status',(
      select to_jsonb(s)
      from public.projection_benchmark_status s where provider='census'
    ),
    'restaurants',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,
        'name',r.name,
        'state',upper(to_jsonb(r)->>'shipping_state'),
        'concept_type',c.concept_type
      ) order by r.id)
      from public.restaurants r
      left join public.projection_restaurant_config c on c.restaurant_id=r.id
      where r.deactivated_at is null
        and r.id<>'00000000-0000-0000-0000-000000000001'::uuid
    ),'[]'),
    'versions',coalesce((
      select jsonb_agg(
        to_jsonb(v)||jsonb_build_object('published_at',p.published_at)
        order by v.created_at desc
      )
      from public.projection_benchmark_versions v
      left join public.projection_benchmark_publications p on p.version_id=v.id
    ),'[]')
  );
$f$;

create function public.projection_stage_benchmark(doc jsonb) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare
  vid uuid;
  sid uuid;
  cid uuid;
  row jsonb;
  p jsonb;
  item jsonb;
  r public.restaurants;
  timing jsonb;
  current_digest text;
  cfg public.projection_restaurant_config;
  pool record;
  cohort text;
  region text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-settings:4',0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-calendar',0)
  );

  if doc->>'dictionary_digest'<>
      '368fe0409da3fb0439ce4def0533768a752e0c983ea59e553c44a2da48328ca5'
    or doc->'dictionary'->>'version'<>'1'
    or doc->'dictionary'->>'effective_from'<>'2026-11-22'
    or (doc->>'snapshot_at')::timestamptz>clock_timestamp()
  then
    raise exception 'Invalid benchmark identity';
  end if;

  for p in select value from jsonb_array_elements(doc->'pulls') loop
    if p->>'provider' not in ('fred_census','fred_cpi')
      or p->'query_metadata'?'api_key'
      or p->'query_metadata'->>'realtime_start'<>doc->>'vintage'
      or p->'query_metadata'->>'realtime_end'<>doc->>'vintage'
      or not (
        p->'query_metadata'->>'series_id'=case
          when p->>'provider'='fred_census'
          then 'MRTSSM722USN' else 'CUUR0000SEFV'
        end
      )
      or jsonb_array_length(p->'payload'->'observations')=0
    then
      raise exception 'Invalid benchmark pull';
    end if;

    insert into public.projection_benchmark_pulls(
      provider,query_metadata,payload,payload_sha256
    ) values(
      p->>'provider',p->'query_metadata',p->'payload',p->>'payload_sha256'
    ) returning id into vid;

    if p->>'provider'='fred_census' then
      sid:=vid;
    else
      cid:=vid;
    end if;
  end loop;

  insert into public.projection_benchmark_versions(
    vintage,valid_from,valid_until,sales_pull_id,cpi_pull_id,
    dictionary,dictionary_digest
  ) values(
    (doc->>'vintage')::date,
    (doc->>'valid_from')::date,
    (doc->>'valid_from')::date+62,
    sid,cid,doc->'dictionary',doc->>'dictionary_digest'
  ) returning id into vid;

  for row in
    select value from jsonb_array_elements(doc->'restaurants')
    order by value->>'id'
  loop
    select * into strict r
    from public.restaurants
    where id=(row->>'id')::uuid and deactivated_at is null;

    perform pg_advisory_xact_lock(
      hashtextextended('optimenu:projection-ingest:'||r.id::text,0)
    );

    if row->>'source_digest' is not null then
      select projection_private.run_inputs(
        r.id,(row->>'as_of')::date,(doc->>'snapshot_at')::timestamptz
      )->>'context_digest' into current_digest;

      if current_digest<>row->>'source_digest' then
        raise exception 'PROJECTION_BENCHMARK_SOURCE_CHANGED'
          using errcode='PT409';
      end if;
    end if;

    select * into cfg
    from public.projection_restaurant_config where restaurant_id=r.id;

    insert into public.projection_benchmark_previews values(
      vid,r.id,r.name,upper(to_jsonb(r)->>'shipping_state'),cfg.concept_type,
      (doc->>'snapshot_at')::timestamptz,
      row->>'source_digest',row->'preview'
    );

    if exists(
      select 1 from public.projection_pool_permissions x
      where x.restaurant_id=r.id and x.enabled and x.agreement_permits
        and nullif(trim(x.agreement_version),'') is not null
    ) then
      for item in
        select value from jsonb_array_elements(row->'contributions')
      loop
        if (item->>'target_date')::date not between
          (doc->>'valid_from')::date and (doc->>'valid_from')::date+62
        then
          raise exception 'Contribution outside release window';
        end if;

        insert into public.projection_benchmark_contributions values(
          vid,r.id,cfg.concept_type,upper(to_jsonb(r)->>'shipping_state'),
          (item->>'target_date')::date,item->>'metric',
          (item->>'ratio')::float8,row->>'source_digest'
        );
      end loop;
    end if;
  end loop;

  if coalesce((
    (
      select settings->>'pooled_benchmarks_enabled'
      from public.projection_setting_versions
      where restaurant_id is null and model_major=4
        and effective_at<=clock_timestamp()
      order by effective_at desc limit 1
    )
  )::boolean,false) then
    for r in
      select a.* from public.restaurants a
      join public.projection_pool_permissions p on p.restaurant_id=a.id
      where a.deactivated_at is null and p.enabled and p.agreement_permits
      order by a.id
    loop
      select * into cfg
      from public.projection_restaurant_config where restaurant_id=r.id;

      foreach region in array array[
        upper(to_jsonb(r)->>'shipping_state'),'US'
      ] loop
        if region is null or cfg.concept_type is null then continue; end if;

        cohort:=cfg.concept_type||':'||region;

        insert into public.projection_pool_cohorts(
          cohort_key,concept_type,region_code
        ) values(cohort,cfg.concept_type,region)
        on conflict do nothing;

        for pool in
          select c.target_date,c.metric
          from public.projection_benchmark_contributions c
          where c.version_id=vid
          group by c.target_date,c.metric
        loop
          if (
            select count(*)
            from projection_private.benchmark_participants(
              vid,r.id,pool.target_date,pool.metric,cfg.concept_type,region
            )
          )>=greatest(
            5,
            (
              (projection_private.run_timing(
                r.id,clock_timestamp()
              )->'settings')->>'minimum_pooled_restaurants'
            )::integer
          ) then
            insert into public.projection_pooled_totals(
              restaurant_id,benchmark_version_id,cohort_key,metric,
              target_date,period_start,period_end,
              participant_count,statistics
            ) values(
              r.id,vid,cohort,pool.metric,pool.target_date,
              pool.target_date-
                (extract(isodow from pool.target_date)::integer-1),
              pool.target_date-
                (extract(isodow from pool.target_date)::integer-1)+6,
              5,'{}'
            );
          end if;
        end loop;
      end loop;
    end loop;
  end if;

  insert into public.projection_benchmark_status(
    provider,last_success_at,last_attempt_at,stale,failure_code
  ) values(
    'census',clock_timestamp(),clock_timestamp(),false,null
  ) on conflict(provider) do update set
    last_success_at=excluded.last_success_at,
    last_attempt_at=excluded.last_attempt_at,
    stale=false,
    failure_code=null;

  return jsonb_build_object('id',vid);
end $f$;

create function public.projection_benchmark_preview(vid uuid) returns jsonb
language sql security definer set search_path='' as $f$
  select jsonb_build_object(
    'version',to_jsonb(v),
    'published_at',p.published_at,
    'preview',coalesce(x.rows,'[]'),
    'digest',encode(sha256(convert_to(
      to_jsonb(v)::text||coalesce(x.rows,'[]')::text,'UTF8'
    )),'hex')
  )
  from public.projection_benchmark_versions v
  left join public.projection_benchmark_publications p on p.version_id=v.id
  left join lateral(
    select jsonb_agg(to_jsonb(a) order by restaurant_id) rows
    from public.projection_benchmark_previews a where a.version_id=v.id
  ) x on true
  where v.id=vid;
$f$;

create function public.projection_approve_benchmark(
  vid uuid,
  expected_digest text,
  actor uuid default null
) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare preview jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-settings:4',0)
  );

  preview:=public.projection_benchmark_preview(vid);

  if exists(
    select 1 from public.projection_benchmark_publications where version_id=vid
  ) then
    return jsonb_build_object('id',vid,'published',true);
  end if;

  if exists(
    select 1
    from public.projection_benchmark_versions v
    join public.projection_benchmark_publications p on p.version_id=v.id
    where v.created_at>(
      select created_at from public.projection_benchmark_versions where id=vid
    )
  ) then
    raise exception 'A newer benchmark is already published';
  end if;

  if preview is null or preview->>'digest'<>expected_digest then
    raise exception 'Benchmark preview changed';
  end if;

  if not exists(select 1 from public.projection_benchmark_publications)
    and actor is null
  then
    raise exception 'First benchmark requires admin approval';
  end if;

  if actor is not null and not exists(
    select 1 from public.profiles where id=actor and role='admin'
  ) then
    raise exception 'Admin required';
  end if;

  if exists(
    select 1 from public.restaurants r
    where r.deactivated_at is null
      and r.id<>'00000000-0000-0000-0000-000000000001'::uuid
      and not exists(
        select 1 from public.projection_benchmark_previews p
        where p.version_id=vid and p.restaurant_id=r.id
      )
  ) then
    raise exception 'Preview must cover every active restaurant';
  end if;

  if not exists(
    select 1 from public.projection_benchmark_previews
    where version_id=vid and jsonb_array_length(result->'weeks')=8
  ) then
    raise exception 'No validated eight-week preview';
  end if;

  insert into public.projection_benchmark_publications(
    version_id,actor_id,automatic
  ) values(vid,actor,actor is null)
  on conflict(version_id) do nothing;

  return jsonb_build_object('id',vid,'published',true);
end $f$;

-- Rebuild R for counterfactuals, while retaining the original public vintage.
create function projection_private.archive_benchmark_context(
  r public.projection_forecast_runs
) returns jsonb
language plpgsql stable set search_path='' as $f$
declare
  snap jsonb:=r.trace#>'{provenance,benchmark_snapshot}';
  v public.projection_benchmark_versions;
  pub timestamptz;
begin
  if snap is null or snap->>'release_id' is null then return null; end if;

  select * into strict v
  from public.projection_benchmark_versions
  where id=(snap->>'release_id')::uuid;

  select published_at into strict pub
  from public.projection_benchmark_publications where version_id=v.id;

  if pub>r.issued_at then raise exception 'Future benchmark in archive'; end if;

  return jsonb_build_object(
    'restaurant_id',r.restaurant_id,
    'as_of',r.run_date,
    'state',snap->'state',
    'closed_weekdays',snap->'closed_weekdays',
    'status',snap->'status',
    'pooled',coalesce((
      select jsonb_agg(n->'pooled')
      from jsonb_array_elements(snap->'values') n
      where n->'pooled'<>'null'::jsonb
    ),'[]'),
    'release',jsonb_build_object(
      'id',v.id,
      'created_at',v.created_at,
      'published_at',pub,
      'dictionary_digest',v.dictionary_digest,
      'census',jsonb_build_object(
        'sales',(
          select jsonb_agg(jsonb_build_object(
            'date',x->>'date',
            'value',case when x->>'value'='.'
              then null else (x->>'value')::float8 end
          ) order by x->>'date')
          from public.projection_benchmark_pulls p
          cross join lateral jsonb_array_elements(
            p.payload->'observations'
          ) x
          where p.id=v.sales_pull_id
        ),
        'cpi',(
          select jsonb_agg(jsonb_build_object(
            'date',x->>'date',
            'value',case when x->>'value'='.'
              then null else (x->>'value')::float8 end
          ) order by x->>'date')
          from public.projection_benchmark_pulls p
          cross join lateral jsonb_array_elements(
            p.payload->'observations'
          ) x
          where p.id=v.cpi_pull_id
        )
      )
    )
  );
end $f$;

do $b$
declare d text;
begin
  d:=pg_get_functiondef(
    'projection_private.outlier_context(uuid,date,timestamptz)'::regprocedure
  );
  execute replace(
    d,
    'FUNCTION projection_private.outlier_context(',
    'FUNCTION projection_private.outlier_context_before_benchmarks('
  );
end $b$;

create or replace function projection_private.outlier_context(
  p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz
) returns jsonb
language plpgsql stable set search_path='' as $f$
declare result jsonb;
begin
  result:=projection_private.outlier_context_before_benchmarks(
    p_restaurant_id,p_as_of,p_snapshot_at
  )-'context_digest';

  result:=jsonb_set(result,'{archives}',coalesce((
    select jsonb_agg(
      case when b.ctx is null then a
      else a||jsonb_build_object('benchmark_context',b.ctx) end
      order by a->>'id'
    )
    from jsonb_array_elements(result->'archives') a
    join public.projection_forecast_runs r
      on r.id=(a->>'id')::uuid and r.restaurant_id=p_restaurant_id
    cross join lateral(
      select projection_private.archive_benchmark_context(r) ctx
    ) b
  ),'[]'));

  return result||jsonb_build_object(
    'context_digest',
    encode(sha256(convert_to((result-'decisions'-'reviews')::text,'UTF8')),'hex')
  );
end $f$;

do $b$
declare
  d text;
  f record;
begin
  d:=pg_get_functiondef(
    'projection_private.purge_account(uuid)'::regprocedure
  );

  if strpos(d,'''projection_job_leases'',')=0 then
    raise exception 'Unexpected purge definition';
  end if;

  d:=replace(
    d,
    '''projection_job_leases'',',
    '''projection_benchmark_previews'',''projection_benchmark_contributions'',''projection_pooled_totals'',''projection_job_leases'','
  );
  d:=replace(
    d,
    'begin',
    'begin
  perform pg_advisory_xact_lock(hashtextextended(''optimenu:projection-settings:4'',0));'
  );
  execute d;

  for f in
    select oid::regprocedure signature
    from pg_proc where pronamespace='projection_private'::regnamespace
  loop
    execute format(
      'revoke all on function %s from public,anon,authenticated',f.signature
    );
  end loop;

  for f in
    select oid::regprocedure signature
    from pg_proc
    where pronamespace='public'::regnamespace
      and proname in (
        'projection_benchmark_inputs',
        'projection_benchmark_catalog',
        'projection_stage_benchmark',
        'projection_benchmark_preview',
        'projection_approve_benchmark'
      )
  loop
    execute format(
      'revoke all on function %s from public,anon,authenticated',f.signature
    );
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $b$;

grant execute on function
  projection_private.benchmark_participants(uuid,uuid,date,text,text,text),
  projection_private.check_settings_before_benchmarks(jsonb,boolean),
  projection_private.run_inputs_before_benchmarks(uuid,date,timestamptz)
to service_role;

commit;