begin;

-- Historical versions remain readable. Publication requires the new key.
do $b$ declare d text; begin
  d:=pg_get_functiondef('projection_private.settings_template()'::regprocedure);
  execute replace(d,'FUNCTION projection_private.settings_template(', 'FUNCTION projection_private.settings_template_before_nightly(');
  d:=pg_get_functiondef('projection_private.check_settings(jsonb,boolean)'::regprocedure);
  execute replace(d,'FUNCTION projection_private.check_settings(', 'FUNCTION projection_private.check_settings_before_nightly(');
end $b$;

create or replace function projection_private.settings_template() returns jsonb
language sql immutable set search_path='' as $f$
  select projection_private.settings_template_before_nightly()||'{"publish_deadline_minutes":180}'::jsonb;
$f$;

create or replace function projection_private.check_settings(p jsonb,partial boolean default false)
returns boolean language plpgsql immutable set search_path='' as $f$
declare n numeric;
begin
  if not projection_private.check_settings_before_nightly(p-'publish_deadline_minutes',partial) then return false; end if;
  if p ? 'publish_deadline_minutes' then
    if jsonb_typeof(p->'publish_deadline_minutes')<>'number' then return false; end if;
    n:=(p->>'publish_deadline_minutes')::numeric;
    if n<>trunc(n) or n<=0 or n>=1440 then return false; end if;
    if (not partial or p ? 'sync_buffer_minutes') and n<=(p->>'sync_buffer_minutes')::numeric then return false; end if;
  end if;
  return true;
end $f$;

insert into public.projection_setting_versions(model_major,effective_at,settings)
select model_major,clock_timestamp(),settings||'{"publish_deadline_minutes":180}'::jsonb
from (select * from public.projection_setting_versions where restaurant_id is null and model_major=4
  and effective_at<=clock_timestamp() order by effective_at desc limit 1) v;

alter table public.projection_restaurant_config add column enabled boolean not null default false;

insert into public.projection_style_categories(code,label) values
  ('Comfort/Heavy','Comfort/Heavy'),('Light/Fresh','Light/Fresh'),('Neutral','Neutral')
on conflict(code) do nothing;

create table public.projection_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  business_date date not null,
  model_major integer not null references public.projection_model_versions,
  job_kind text not null check(job_kind in ('forecast','backfill','maintenance') or job_kind ~ '^force:[0-9a-f-]{36}$'),
  status text not null default 'pending' check(status in ('pending','running','waiting','succeeded','failed','missed','disabled')),
  due_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  stage text not null default 'pending',
  last_error jsonb,
  parent_run_id uuid,
  run_id uuid references public.projection_forecast_runs(id),
  requested_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(restaurant_id,business_date,model_major,job_kind),
  unique(restaurant_id,id)
);

create table public.projection_job_leases (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  job_id uuid not null,
  token uuid not null,
  expires_at timestamptz not null,
  foreign key(restaurant_id,job_id) references public.projection_jobs(restaurant_id,id) on delete cascade
);

create table public.projection_run_state (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  backfill_from date,
  backfill_until date,
  cursor_date date,
  phase text not null default 'observe' check(phase in ('observe','verify','complete')),
  backfill_complete boolean not null default false,
  setup_error jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.projection_dirty_nights (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  business_date date not null,
  generation bigint not null default 1,
  reason text not null,
  attempted_at timestamptz,
  primary key(restaurant_id,business_date)
);

alter table public.projection_forecast_runs add column job_id uuid unique;

do $b$ declare t text; begin
  foreach t in array array['projection_jobs','projection_job_leases','projection_run_state','projection_dirty_nights'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
end $b$;

revoke insert on public.projection_forecast_runs,public.projection_forecast_nights,public.projection_forecast_dishes from service_role;

create function projection_private.run_timing(rid uuid,at_time timestamptz) returns jsonb
language plpgsql stable set search_path='' set timezone='UTC' as $f$
declare r public.restaurants; c public.projection_restaurant_config; g public.projection_setting_versions;
  o public.projection_setting_versions; s jsonb; day date; starts timestamptz; ends timestamptz; deadline timestamptz;
begin
  select * into r from public.restaurants where id=rid and deactivated_at is null;
  if r.id is null then raise exception 'PROJECTION_RESTAURANT_UNAVAILABLE'; end if;

  if r.operational_timezone is null or not exists(select 1 from pg_timezone_names where name=r.operational_timezone) then
    raise exception 'PROJECTION_TIMEZONE_REQUIRED';
  end if;

  select * into c from public.projection_restaurant_config where restaurant_id=rid;
  select * into strict g from public.projection_setting_versions where restaurant_id is null and model_major=4
    and effective_at<=at_time order by effective_at desc limit 1;
  select * into o from public.projection_setting_versions where restaurant_id=rid and model_major=4
    and effective_at<=at_time order by effective_at desc limit 1;

  s:=g.settings||coalesce(o.settings,'{}');

  if not projection_private.check_settings(s) or not s ? 'publish_deadline_minutes' then
    raise exception 'PROJECTION_DEADLINE_SETUP_REQUIRED';
  end if;

  day:=(at_time at time zone r.operational_timezone)::date;
  if at_time<projection_private.business_boundary(day,r.operational_timezone,(s->>'business_day_cutoff_minutes')::integer) then day:=day-1; end if;

  starts:=projection_private.business_boundary(day,r.operational_timezone,(s->>'business_day_cutoff_minutes')::integer);
  ends:=projection_private.business_boundary(day+1,r.operational_timezone,(s->>'business_day_cutoff_minutes')::integer);
  deadline:=starts+make_interval(mins=>(s->>'publish_deadline_minutes')::integer);

  if deadline>ends then raise exception 'PROJECTION_DEADLINE_PAST_BUSINESS_DAY'; end if;

  return jsonb_build_object('restaurant_id',rid,'business_date',day,'timezone',r.operational_timezone,'starts_at',starts,
    'ready_at',starts+make_interval(mins=>(s->>'sync_buffer_minutes')::integer),'deadline_at',deadline,'ends_at',ends,
    'settings',s,'global_version',to_jsonb(g),'restaurant_version',case when o.id is null then null else to_jsonb(o) end,
    'enabled',coalesce(c.enabled,false),'first_data_date',c.first_data_date,'concept_type',c.concept_type,
    'onboarding_completed_at',r.onboarding_completed_at);
end $f$;

create function projection_private.dirty(rid uuid,day date,why text) returns void
language sql set search_path='' as $f$
  insert into public.projection_dirty_nights(restaurant_id,business_date,generation,reason) values(rid,day,1,why)
  on conflict(restaurant_id,business_date) do update
    set generation=projection_dirty_nights.generation+1,reason=excluded.reason,attempted_at=null;
$f$;

-- Queue actual known nights when mappings, availability or calendar inputs change.
create function projection_private.queue_changed_history() returns trigger
language plpgsql security definer set search_path='' as $f$
declare rid uuid:=coalesce(new.restaurant_id,old.restaurant_id); day date;
begin
  if projection_private.is_account_purge(rid) then return coalesce(new,old); end if;
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||rid::text,0));

  for day in select business_date from public.projection_nightly_flags where restaurant_id=rid loop
    perform projection_private.dirty(rid,day,tg_table_name);
  end loop;

  return coalesce(new,old);
end $f$;

create trigger projection_mapping_dirty after insert or update or delete on public.projection_pos_item_map
for each row execute function projection_private.queue_changed_history();

create trigger projection_availability_dirty after insert or update or delete on public.projection_dish_availability
for each row execute function projection_private.queue_changed_history();

create trigger projection_sources_dirty after insert or update or delete on public.projection_pos_source_windows
for each row execute function projection_private.queue_changed_history();

create trigger projection_answers_dirty after insert on public.projection_holiday_answer_versions
for each row execute function projection_private.queue_changed_history();

create trigger projection_calendar_dirty after insert on public.projection_calendar_versions
for each row execute function projection_private.queue_changed_history();

create function projection_private.queue_pos_evidence() returns trigger
language plpgsql security definer set search_path='' as $f$
declare row_value jsonb; rid uuid; stamp timestamptz; day date;
begin
  for row_value in select x from jsonb_array_elements(jsonb_build_array(to_jsonb(old),to_jsonb(new))) x where x<>'null'::jsonb loop
    rid:=(row_value->>'restaurant_id')::uuid;
    if projection_private.is_account_purge(rid) then continue; end if;

    perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||rid::text,0));
    stamp:=coalesce((row_value->>'added_at')::timestamptz,(row_value->>'opened_at')::timestamptz,(row_value->>'closed_at')::timestamptz);

    if stamp is not null then
      day:=(projection_private.pos_source_clock(rid,null,stamp)->>'business_date')::date;
      perform projection_private.dirty(rid,day,tg_table_name);
    end if;
  end loop;

  return coalesce(new,old);
end $f$;

create trigger projection_pos_lines_dirty before insert or update or delete on public.pos_ticket_lines
for each row execute function projection_private.queue_pos_evidence();

create trigger projection_pos_tickets_dirty before insert or update or delete on public.pos_tickets
for each row execute function projection_private.queue_pos_evidence();

create function public.projection_enable(rid uuid,turn_on boolean,actor uuid,history_from date default null,deadline integer default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare timing jsonb; previous jsonb;
begin
  perform projection_private.calendar_actor(rid,actor,true);
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-settings:4',0));
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||rid::text,0));

  if history_from is not null then
    update public.projection_restaurant_config set first_data_date=history_from where restaurant_id=rid;
  end if;

  if deadline is not null then
    select settings into previous from public.projection_setting_versions where restaurant_id=rid and model_major=4
      and effective_at<=clock_timestamp() order by effective_at desc limit 1;

    insert into public.projection_setting_versions(restaurant_id,model_major,effective_at,settings)
      values(rid,4,clock_timestamp(),coalesce(previous,'{}')||jsonb_build_object('publish_deadline_minutes',deadline));
  end if;

  if turn_on then
    timing:=projection_private.run_timing(rid,clock_timestamp());
    if timing->>'first_data_date' is null or timing->>'concept_type' is null or timing->>'onboarding_completed_at' is null then
      raise exception 'PROJECTION_INITIAL_SETUP_REQUIRED';
    end if;
  end if;

  if turn_on then
    update public.projection_jobs set status='pending'
      where restaurant_id=rid and status='disabled' and run_id is null;
  end if;

  update public.projection_restaurant_config set enabled=turn_on,updated_at=clock_timestamp() where restaurant_id=rid;
  if not found then raise exception 'PROJECTION_INITIAL_SETUP_REQUIRED'; end if;

  return jsonb_build_object('restaurant_id',rid,'enabled',turn_on);
end $f$;

create function public.projection_dispatch() returns jsonb
language plpgsql security definer set search_path='' as $f$
declare rid uuid; t jsonb; job public.projection_jobs; ids jsonb:='[]'; errors jsonb:='[]'; day date; first_day date; onboard date;
begin
  for rid in select c.restaurant_id from public.projection_restaurant_config c join public.restaurants r on r.id=c.restaurant_id
    where c.enabled and r.deactivated_at is null order by c.restaurant_id loop
    begin
      perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||rid::text,0));
      t:=projection_private.run_timing(rid,clock_timestamp());
      day:=(t->>'business_date')::date;

      if t->>'first_data_date' is null or t->>'concept_type' is null or t->>'onboarding_completed_at' is null then
        raise exception 'PROJECTION_INITIAL_SETUP_REQUIRED';
      end if;

      onboard:=(projection_private.pos_source_clock(rid,null,(t->>'onboarding_completed_at')::timestamptz)->>'business_date')::date;
      first_day:=least((t->>'first_data_date')::date,onboard);
      if first_day>=day then raise exception 'PROJECTION_HISTORY_BOUNDARY_REQUIRED'; end if;

      insert into public.projection_run_state(restaurant_id,backfill_from,backfill_until,cursor_date)
        values(rid,first_day,day-1,first_day) on conflict(restaurant_id) do nothing;

      if exists(select 1 from public.projection_run_state where restaurant_id=rid and (backfill_from is null or backfill_from>first_day)) then
        update public.projection_run_state set backfill_from=first_day,backfill_until=day-1,cursor_date=first_day,
          phase='observe',backfill_complete=false where restaurant_id=rid;
      end if;

      insert into public.projection_jobs(restaurant_id,business_date,model_major,job_kind)
        values(rid,day,4,'forecast') on conflict do nothing;

      -- No backdated forecasts after an outage.
      update public.projection_jobs set status='missed',stage='deadline',
        last_error='{"code":"PROJECTION_PUBLISH_DEADLINE","kind":"missed"}',updated_at=clock_timestamp()
        where restaurant_id=rid and job_kind not in ('backfill','maintenance') and run_id is null and status not in ('missed','disabled')
          and (business_date<day or (business_date=day and clock_timestamp()>=(t->>'deadline_at')::timestamptz));

      if exists(select 1 from public.projection_run_state where restaurant_id=rid and not backfill_complete) then
        insert into public.projection_jobs(restaurant_id,business_date,model_major,job_kind)
          select rid,day,4,'backfill' where not exists(select 1 from public.projection_jobs where restaurant_id=rid
            and job_kind='backfill' and status in ('pending','waiting','running','failed')) on conflict do nothing;
      end if;

      if exists(select 1 from public.projection_dirty_nights where restaurant_id=rid) then
        insert into public.projection_jobs(restaurant_id,business_date,model_major,job_kind)
          values(rid,day,4,'maintenance') on conflict(restaurant_id,business_date,model_major,job_kind)
          do update set status=case when projection_jobs.status='succeeded' then 'pending' else projection_jobs.status end;
      end if;

      for job in select j.* from public.projection_jobs j
        where j.restaurant_id=rid and j.status in ('pending','waiting','failed','running')
        and j.due_at<=clock_timestamp()
        and not exists(select 1 from public.projection_job_leases l where l.restaurant_id=rid and l.expires_at>clock_timestamp())
        and (j.job_kind='backfill' or exists(select 1 from public.projection_run_state s where s.restaurant_id=rid and s.backfill_complete))
        order by (j.job_kind='backfill') desc,j.created_at limit 1
      loop
        ids:=ids||jsonb_build_array(job.id);
      end loop;

      update public.projection_run_state set setup_error=null where restaurant_id=rid;
    exception when others then
      errors:=errors||jsonb_build_array(jsonb_build_object('restaurant_id',rid,'code',sqlerrm));
      insert into public.projection_run_state(restaurant_id,setup_error) values(rid,jsonb_build_object('code',sqlerrm))
        on conflict(restaurant_id) do update set setup_error=excluded.setup_error;
    end;
  end loop;

  return jsonb_build_object('jobs',ids,'errors',errors);
end $f$;

create function public.projection_claim(jid uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs; lease public.projection_job_leases; t jsonb; token uuid:=gen_random_uuid();
begin
  select * into strict j from public.projection_jobs where id=jid;
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||j.restaurant_id::text,0));
  select * into j from public.projection_jobs where id=jid for update;

  if j.run_id is not null or j.status in ('succeeded','missed','disabled') then
    return jsonb_build_object('skip',true,'status',j.status,'run_id',j.run_id);
  end if;

  if not exists(select 1 from public.projection_restaurant_config c join public.restaurants r on r.id=c.restaurant_id
    where c.restaurant_id=j.restaurant_id and c.enabled and r.deactivated_at is null) then
    update public.projection_jobs set status='disabled' where id=jid;
    return jsonb_build_object('skip',true,'status','disabled');
  end if;

  select * into lease from public.projection_job_leases where restaurant_id=j.restaurant_id for update;
  if lease.expires_at>clock_timestamp() or j.due_at>clock_timestamp() then
    return jsonb_build_object('skip',true,'status','busy');
  end if;

  t:=projection_private.run_timing(j.restaurant_id,clock_timestamp());

  if j.job_kind not in ('backfill','maintenance') and
    (j.business_date<>(t->>'business_date')::date or clock_timestamp()>=(t->>'deadline_at')::timestamptz) then
    update public.projection_jobs set status='missed',stage='deadline',
      last_error='{"code":"PROJECTION_PUBLISH_DEADLINE","kind":"missed"}' where id=jid;
    return jsonb_build_object('skip',true,'status','missed');
  end if;

  insert into public.projection_job_leases values(j.restaurant_id,j.id,token,clock_timestamp()+interval '7 minutes')
    on conflict(restaurant_id) do update set job_id=excluded.job_id,token=excluded.token,expires_at=excluded.expires_at;

  update public.projection_jobs set status='running',attempts=attempts+1,updated_at=clock_timestamp()
    where id=jid returning * into j;

  return jsonb_build_object('skip',false,'job',to_jsonb(j),'token',token,'timing',t,
    'backfill',(select to_jsonb(s) from public.projection_run_state s where restaurant_id=j.restaurant_id));
end $f$;

create function projection_private.require_lease(jid uuid,tok uuid) returns public.projection_jobs
language plpgsql set search_path='' as $f$
declare j public.projection_jobs;
begin
  select * into strict j from public.projection_jobs where id=jid;
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||j.restaurant_id::text,0));

  if not exists(select 1 from public.projection_job_leases
    where restaurant_id=j.restaurant_id and job_id=jid and token=tok and expires_at>clock_timestamp()) then
    raise exception 'PROJECTION_LEASE_CONFLICT' using errcode='PT409';
  end if;

  return j;
end $f$;

create function public.projection_checkpoint(jid uuid,tok uuid,stage_name text,progress jsonb default null,
  retry_at timestamptz default null,problem jsonb default null,done boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs;
begin
  j:=projection_private.require_lease(jid,tok);

  if progress is not null then
    if j.job_kind<>'backfill' or (progress->>'phase') not in ('observe','verify','complete') then
      raise exception 'Invalid backfill checkpoint';
    end if;

    if progress->>'phase'='complete' and exists(
      select 1 from public.projection_run_state b
      cross join lateral generate_series(b.backfill_from,b.backfill_until,interval '1 day') x(day)
      left join public.projection_ingestion_state i on i.restaurant_id=b.restaurant_id and i.business_date=x.day::date
      where b.restaurant_id=j.restaurant_id
      and exists(select 1 from public.projection_pos_source_windows w where w.restaurant_id=b.restaurant_id
        and (w.valid_from is null or w.valid_from<=x.day::date)
        and (w.valid_until is null or w.valid_until>x.day::date))
      and (i.transaction_digest is null or i.last_observed_at<i.changed_at+
        make_interval(mins=>(projection_private.run_timing(j.restaurant_id,clock_timestamp())->'settings'->>'sync_buffer_minutes')::integer))
    ) then raise exception 'PROJECTION_BACKFILL_INCOMPLETE'; end if;

    update public.projection_run_state set cursor_date=(progress->>'cursor_date')::date,phase=progress->>'phase',
      backfill_complete=progress->>'phase'='complete',updated_at=clock_timestamp() where restaurant_id=j.restaurant_id;
  end if;

  update public.projection_jobs set stage=stage_name,last_error=problem,
    status=case when done then 'succeeded' when retry_at is null then 'running' when problem is null then 'waiting' else 'failed' end,
    due_at=coalesce(retry_at,due_at),updated_at=clock_timestamp() where id=jid;

  if retry_at is not null or done then
    delete from public.projection_job_leases where restaurant_id=j.restaurant_id and token=tok;
  else
    update public.projection_job_leases set expires_at=clock_timestamp()+interval '7 minutes'
      where restaurant_id=j.restaurant_id and token=tok;
  end if;

  return jsonb_build_object('saved',true);
end $f$;

create function projection_private.source_covered(rid uuid,day date) returns boolean
language sql stable security definer set search_path='' as $f$
  select exists(select 1 from public.projection_pos_source_windows w where w.restaurant_id=rid
    and (w.valid_from is null or w.valid_from<=day) and (w.valid_until is null or day<w.valid_until))
  and not exists(select 1 from public.projection_dirty_nights d where d.restaurant_id=rid and d.business_date=day)
  and not exists(select 1 from public.projection_pos_source_repairs p where p.restaurant_id=rid and
    (exists(select 1 from public.projection_pos_source_windows w where w.restaurant_id=rid and w.connection_id=p.connection_id
      and (w.valid_from is null or w.valid_from<=day) and (w.valid_until is null or day<w.valid_until))
    or day>=(projection_private.pos_source_clock(rid,null,p.last_failure_at)->>'business_date')::date));
$f$;

-- Keep existing context contracts and fence only affected source evidence.
do $b$ declare name text; d text; sig text; begin
  foreach name in array array['calendar_context','holiday_context','lifecycle_context'] loop
    sig:=case when name='calendar_context' then '(uuid,date,date,timestamp with time zone)' else '(uuid,date,timestamp with time zone)' end;
    d:=pg_get_functiondef(('projection_private.'||name||sig)::regprocedure);
    execute replace(d,'FUNCTION projection_private.'||name||'(', 'FUNCTION projection_private.'||name||'_before_nightly(');
  end loop;
end $b$;

create or replace function projection_private.calendar_context(p_restaurant_id uuid,p_from date,p_until date,p_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $f$
declare r jsonb;
begin
  r:=projection_private.calendar_context_before_nightly(p_restaurant_id,p_from,p_until,p_at)-'context_digest';
  r:=r||jsonb_build_object('history',coalesce((select jsonb_agg(n||jsonb_build_object('source_covered',
    (n->>'source_covered')::boolean and projection_private.source_covered(p_restaurant_id,(n->>'business_date')::date))
    order by n->>'business_date') from jsonb_array_elements(r->'history') n),'[]'));
  return r||jsonb_build_object('context_digest',encode(sha256(convert_to((r-'as_of')::text,'UTF8')),'hex'));
end $f$;

create or replace function projection_private.holiday_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $f$
declare r jsonb;
begin
  r:=projection_private.holiday_context_before_nightly(p_restaurant_id,p_as_of,p_snapshot_at)-'context_digest';
  r:=r||jsonb_build_object('history',coalesce((select jsonb_agg(n||jsonb_build_object('source_covered',
    (n->>'source_covered')::boolean and projection_private.source_covered(p_restaurant_id,(n->>'business_date')::date))
    order by n->>'business_date') from jsonb_array_elements(r->'history') n),'[]'));
  return r||jsonb_build_object('context_digest',encode(sha256(convert_to((r-'observations')::text,'UTF8')),'hex'));
end $f$;

create or replace function projection_private.lifecycle_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $f$
declare r jsonb;
begin
  r:=projection_private.lifecycle_context_before_nightly(p_restaurant_id,p_as_of,p_snapshot_at)-'context_digest';
  r:=r||jsonb_build_object('history',coalesce((select jsonb_agg(n||jsonb_build_object('source_covered',
    (n->>'source_covered')::boolean and projection_private.source_covered(p_restaurant_id,(n->>'business_date')::date))
    order by n->>'business_date') from jsonb_array_elements(r->'history') n),'[]'));
  return r||jsonb_build_object('context_digest',encode(sha256(convert_to((r-'launch_history')::text,'UTF8')),'hex'));
end $f$;

create function public.projection_work(jid uuid,tok uuid,repair boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs; r public.projection_pos_source_repairs; c public.pos_connections;
  source_window public.projection_pos_source_windows; state public.projection_run_state;
  dates jsonb; timing jsonb; local_day date;
begin
  j:=projection_private.require_lease(jid,tok);
  timing:=projection_private.run_timing(j.restaurant_id,clock_timestamp());

  if repair then
    for r in select * from public.projection_pos_source_repairs where restaurant_id=j.restaurant_id order by connection_id loop
      begin
        select * into strict c from public.pos_connections where id=r.connection_id and restaurant_id=j.restaurant_id;

        if c.status is distinct from r.observed_status or c.status not in ('connected','disconnected') then
          raise exception 'Source identity needs reconciliation';
        end if;

        select * into source_window from public.projection_pos_source_windows
          where restaurant_id=j.restaurant_id and connection_id=c.id
          order by valid_until desc nulls first,id limit 1;

        local_day:=(projection_private.pos_source_clock(j.restaurant_id,to_jsonb(c)->>'shift4_timezone',r.last_failure_at)->>'business_date')::date;

        if c.status='disconnected' and source_window.id is not null and source_window.valid_until is null then
          update public.projection_pos_source_windows
            set valid_until=greatest(local_day+1,coalesce(valid_from,local_day)+1),
            lifecycle_context=jsonb_build_object('operation','repair_disconnect','observed_at',r.last_failure_at)
            where id=source_window.id;
        elsif c.status='connected' and (source_window.id is null or source_window.valid_until is not null) then
          insert into public.projection_pos_source_windows(restaurant_id,connection_id,provider,valid_from,lifecycle_context)
            values(j.restaurant_id,c.id,c.provider,case when source_window.id is null then null else local_day end,
              jsonb_build_object('operation','repair_connect','observed_at',r.last_failure_at));
        end if;

        delete from public.projection_pos_source_repairs where restaurant_id=r.restaurant_id and connection_id=r.connection_id;
      exception when others then
        update public.projection_pos_source_repairs set error_code=sqlstate
          where restaurant_id=r.restaurant_id and connection_id=r.connection_id;
      end;
    end loop;

    perform public.projection_repair_menu(j.restaurant_id);
  end if;

  select * into strict state from public.projection_run_state where restaurant_id=j.restaurant_id;

  if j.job_kind='backfill' then
    select jsonb_agg(jsonb_build_object('business_date',day::date,'generation',d.generation) order by day) into dates
      from generate_series(state.cursor_date,least(state.backfill_until,state.cursor_date+6),interval '1 day') day
      left join public.projection_dirty_nights d on d.restaurant_id=j.restaurant_id and d.business_date=day::date;
  else
    select jsonb_agg(jsonb_build_object('business_date',x.day,'generation',d.generation) order by x.day) into dates from (
      select day::date from generate_series((timing->>'business_date')::date-7,(timing->>'business_date')::date-1,interval '1 day') day
      union
      select business_date from (
        select business_date from public.projection_dirty_nights where restaurant_id=j.restaurant_id
          and business_date<(timing->>'business_date')::date
          order by attempted_at nulls first,business_date limit 14
      ) oldest
    ) x left join public.projection_dirty_nights d on d.restaurant_id=j.restaurant_id and d.business_date=x.day;
  end if;

  select coalesce(jsonb_agg(n||jsonb_build_object('covered',
    exists(select 1 from public.projection_pos_source_windows w
      where w.restaurant_id=j.restaurant_id
      and (w.valid_from is null or w.valid_from<=(n->>'business_date')::date)
      and (w.valid_until is null or w.valid_until>(n->>'business_date')::date)))
    order by n->>'business_date'),'[]')
    into dates from jsonb_array_elements(coalesce(dates,'[]')) n;

  update public.projection_dirty_nights set attempted_at=clock_timestamp() where restaurant_id=j.restaurant_id
    and business_date in (select (n->>'business_date')::date from jsonb_array_elements(dates) n);

  return jsonb_build_object('dates',dates,'backfill',to_jsonb(state),'timing',timing);
end $f$;

create function public.projection_ack_night(jid uuid,tok uuid,day date,generation bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs; i public.projection_ingestion_state; ctx jsonb;
begin
  j:=projection_private.require_lease(jid,tok);
  select * into i from public.projection_ingestion_state where restaurant_id=j.restaurant_id and business_date=day;
  ctx:=projection_private.ingestion_context(j.restaurant_id,day,clock_timestamp());

  if i.transaction_digest is null or i.context_digest is distinct from ctx->>'context_digest' then
    raise exception 'PROJECTION_SOURCE_NOT_VERIFIED';
  end if;

  delete from public.projection_dirty_nights d where d.restaurant_id=j.restaurant_id and d.business_date=day
    and d.generation=projection_ack_night.generation;

  return jsonb_build_object('quiet_ready_at',greatest((ctx->>'window_to')::timestamptz,i.changed_at)+
    make_interval(mins=>(ctx->'settings'->>'sync_buffer_minutes')::integer),'last_observed_at',i.last_observed_at);
end $f$;

create function projection_private.run_inputs(rid uuid,day date,at_time timestamptz) returns jsonb
language plpgsql stable set search_path='' as $f$
declare result jsonb; timing jsonb; lifecycle jsonb; last_complete date; archive_from date;
begin
  timing:=projection_private.run_timing(rid,at_time);
  lifecycle:=projection_private.lifecycle_context(rid,day,at_time);

  select max((n->>'business_date')::date) into last_complete
    from jsonb_array_elements(lifecycle->'history') n
    where (n->>'complete')::boolean and (n->>'source_covered')::boolean;

  archive_from:=coalesce(last_complete,day-1)-((timing->'settings'->>'empirical_lookback_weeks')::integer*7+7);

  result:=jsonb_build_object('restaurant_id',rid,'as_of',day,'snapshot_at',at_time,
    'style_categories',(select jsonb_agg(code order by code) from public.projection_style_categories
      where code in ('Comfort/Heavy','Light/Fresh','Neutral')),
    'timing',timing,
    'lifecycle',lifecycle,
    'holiday',projection_private.holiday_context(rid,day,at_time),
    'backfill',(select jsonb_build_object('from',backfill_from,'until',backfill_until,'complete',backfill_complete)
      from public.projection_run_state where restaurant_id=rid),
    'connections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'provider',provider,'timezone',shift4_timezone) order by id)
      from public.pos_connections where restaurant_id=rid),'[]'),
    'archives',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'restaurant_id',r.restaurant_id,'run_date',r.run_date,
      'model_major',r.model_major,'issued_at',r.issued_at,'supersedes_id',r.supersedes_id,
      'source_through',r.source_through,'calibration_key',r.calibration_key,
      'nights',coalesce((select jsonb_agg(jsonb_build_object(
        'target_date',n.target_date,'days_ahead',n.days_ahead,'availability',n.availability,'expected',n.expected,
        'dishes',coalesce((select jsonb_agg(jsonb_build_object('dish_id',d.dish_id,'expected',d.expected) order by dish_id)
          from public.projection_forecast_dishes d
          where d.restaurant_id=rid and d.run_id=r.id and d.target_date=n.target_date),'[]'))
        order by n.target_date)
        from public.projection_forecast_nights n where n.restaurant_id=rid and n.run_id=r.id),'[]'))
      order by r.id)
      from public.projection_forecast_runs r where r.restaurant_id=rid and r.run_date>=archive_from
        and r.run_date<day and r.issued_at<=at_time),'[]'));

  return result||jsonb_build_object('context_digest',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $f$;

create function public.projection_snapshot(jid uuid,tok uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs;
begin
  j:=projection_private.require_lease(jid,tok);
  return projection_private.run_inputs(j.restaurant_id,j.business_date,clock_timestamp());
end $f$;

create function projection_private.assert_publication(rid uuid,day date,issued timestamptz,s jsonb) returns void
language plpgsql set search_path='' as $f$
declare zone text; starts timestamptz; ends timestamptz;
begin
  if current_setting('optimenu.projection_publish',true) is distinct from 'on' then
    raise exception 'Restricted archive writer required' using errcode='42501';
  end if;

  select r.operational_timezone into zone from public.restaurants r
    join public.projection_restaurant_config c on c.restaurant_id=r.id
    join public.projection_run_state b on b.restaurant_id=r.id
    where r.id=rid and r.deactivated_at is null and c.enabled and b.backfill_complete;

  if zone is null then raise exception 'PROJECTION_PUBLICATION_NOT_ENABLED' using errcode='PT410'; end if;
  if not s ? 'publish_deadline_minutes' or not projection_private.check_settings(s) then
    raise exception 'Invalid publication settings';
  end if;

  starts:=projection_private.business_boundary(day,zone,(s->>'business_day_cutoff_minutes')::integer);
  ends:=projection_private.business_boundary(day+1,zone,(s->>'business_day_cutoff_minutes')::integer);

  if issued<starts+make_interval(mins=>(s->>'sync_buffer_minutes')::integer) then
    raise exception 'PROJECTION_PUBLICATION_TOO_EARLY' using errcode='PT409';
  end if;

  if starts+make_interval(mins=>(s->>'publish_deadline_minutes')::integer)>ends then
    raise exception 'PROJECTION_DEADLINE_PAST_BUSINESS_DAY' using errcode='PT410';
  end if;

  if issued<starts or issued>=ends or issued>=starts+make_interval(mins=>(s->>'publish_deadline_minutes')::integer) then
    raise exception 'PROJECTION_PUBLISH_DEADLINE' using errcode='PT410';
  end if;
end $f$;

-- The authoritative clock is assigned by the existing trigger AFTER its
-- settings lock. Check that exact timestamp, not a function-start timestamp.
do $b$ declare d text; begin
  d:=pg_get_functiondef('projection_private.validate_archive()'::regprocedure);
  if strpos(d,'new.issued_at := clock_timestamp();')=0 then raise exception 'Archive issuance hook is missing'; end if;

  d:=replace(d,'new.issued_at := clock_timestamp();','new.issued_at := clock_timestamp();
  perform projection_private.assert_publication(new.restaurant_id,new.run_date,new.issued_at,new.settings_snapshot);');
  execute d;

  d:=pg_get_functiondef('projection_private.commit_night(uuid,date,text,bigint,jsonb)'::regprocedure);
  d:=replace(d,'first_data_date = excluded.first_data_date,',
    'first_data_date = least(projection_restaurant_config.first_data_date,excluded.first_data_date),');
  d:=replace(d,'is distinct from excluded.first_data_date;',
    'is distinct from least(projection_restaurant_config.first_data_date,excluded.first_data_date);');
  execute d;
end $b$;

create function public.projection_publish(jid uuid,tok uuid,snapshot_at timestamptz,source_digest text,plan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs; fresh jsonb; r public.projection_forecast_runs;
  n jsonb; d jsonb; head uuid; old_guard text;
  total numeric; allocated numeric; counts integer; expected_count integer;
begin
  select * into strict j from public.projection_jobs where id=jid;

  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-settings:'||j.model_major::text,0));
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-calendar',0));
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||j.restaurant_id::text,0));

  select * into j from public.projection_jobs where id=jid for update;

  if j.run_id is not null then
    return jsonb_build_object('status','succeeded','run_id',j.run_id,'retry',true);
  end if;

  j:=projection_private.require_lease(jid,tok);
  if j.job_kind in ('backfill','maintenance') then raise exception 'This job cannot publish'; end if;

  fresh:=projection_private.run_inputs(j.restaurant_id,j.business_date,snapshot_at);
  if fresh->>'context_digest' is distinct from source_digest then
    raise exception 'PROJECTION_SOURCE_CHANGED' using errcode='PT409';
  end if;

  if snapshot_at>clock_timestamp() or plan->>'restaurant_id' is distinct from j.restaurant_id::text
    or plan->>'run_date' is distinct from j.business_date::text
    or (plan->>'model_major')::integer is distinct from j.model_major
    or jsonb_typeof(plan->'nights') is distinct from 'array' or jsonb_array_length(plan->'nights')<>8
    or (plan->'settings_snapshot') is distinct from fresh->'timing'->'settings'
  then raise exception 'Invalid scoped forecast plan'; end if;

  if not coalesce((fresh->'backfill'->>'complete')::boolean,false)
    or (fresh->'backfill'->>'from')::date is null
    or (fresh->'backfill'->>'from')::date>least((fresh->'timing'->>'first_data_date')::date,
      (projection_private.pos_source_clock(j.restaurant_id,null,
        (fresh->'timing'->>'onboarding_completed_at')::timestamptz)->>'business_date')::date)
  then raise exception 'PROJECTION_BACKFILL_INCOMPLETE'; end if;

  select id into head from public.projection_forecast_runs x
    where restaurant_id=j.restaurant_id and run_date=j.business_date and model_major=j.model_major
    and not exists(select 1 from public.projection_forecast_runs child where child.supersedes_id=x.id);

  if j.job_kind='forecast' and head is not null then
    update public.projection_jobs set run_id=head,status='succeeded' where id=jid;
    delete from public.projection_job_leases where job_id=jid and token=tok;
    return jsonb_build_object('status','succeeded','run_id',head,'retry',true);
  end if;

  if j.job_kind like 'force:%' and (head is null or head is distinct from j.parent_run_id) then
    raise exception 'PROJECTION_FORCE_CONFLICT' using errcode='PT409';
  end if;

  if (select count(distinct v->>'business_date') from jsonb_array_elements(plan->'nights') v)<>8 then
    raise exception 'Duplicate forecast date';
  end if;

  old_guard:=current_setting('optimenu.projection_publish',true);

  begin
    perform set_config('optimenu.projection_publish','on',true);

    insert into public.projection_forecast_runs(
      restaurant_id,run_date,model_major,global_version_id,restaurant_version_id,
      settings_snapshot,settings_digest,calibration_key,source_through,supersedes_id,trace,job_id
    ) values(
      j.restaurant_id,j.business_date,j.model_major,(fresh->'timing'->'global_version'->>'id')::uuid,
      (fresh->'timing'->'restaurant_version'->>'id')::uuid,plan->'settings_snapshot',plan->>'settings_digest',
      plan->>'calibration_key',(plan->>'source_through')::date,
      case when j.job_kind like 'force:%' then head else null end,
      (plan->'trace')||jsonb_build_object('source_digest',source_digest,'snapshot_at',snapshot_at),jid
    ) returning * into r;

    select count(*) into expected_count from public.projection_dishes
      where restaurant_id=j.restaurant_id and forecastable;

    for n in select * from jsonb_array_elements(plan->'nights') loop
      if jsonb_typeof(n->'dishes') is distinct from 'array' or jsonb_array_length(n->'dishes')<>expected_count then
        raise exception 'Incomplete dish archive';
      end if;

      insert into public.projection_forecast_nights(
        restaurant_id,run_id,target_date,days_ahead,availability,expected,low,high,confidence,trace
      ) values(
        j.restaurant_id,r.id,(n->>'business_date')::date,(n->>'days_ahead')::integer,n->>'availability',
        (n->>'expected')::numeric,(n->>'low')::numeric,(n->>'high')::numeric,n->>'confidence',n->'trace'
      );

      for d in select * from jsonb_array_elements(n->'dishes') loop
        if not exists(select 1 from public.projection_dishes
          where id=(d->>'dish_id')::uuid and restaurant_id=j.restaurant_id and forecastable) then
          raise exception 'Foreign or non-forecastable dish';
        end if;

        insert into public.projection_forecast_dishes(
          restaurant_id,run_id,target_date,dish_id,share,expected,low,high,confidence,trace
        ) values(
          j.restaurant_id,r.id,(n->>'business_date')::date,(d->>'dish_id')::uuid,(d->>'share')::numeric,
          (d->>'expected')::numeric,(d->>'low')::numeric,(d->>'high')::numeric,n->>'confidence',d->'trace'
        );
      end loop;

      if n->>'availability'='available' and n->'trace'->>'share_status'='needs_baseline' and
        (jsonb_typeof(n->'trace'->'partial_categories') is distinct from 'array'
          or jsonb_array_length(n->'trace'->'partial_categories')=0
          or position('partial categories' in coalesce(n->>'confidence',''))=0) then
        raise exception 'Undisclosed partial category availability';
      end if;

      if n->'trace'->>'share_status'='ok' then
        select sum(expected),sum(share),count(*) filter(where expected is null or share is null)
          into total,allocated,counts
          from public.projection_forecast_dishes
          where restaurant_id=j.restaurant_id and run_id=r.id and target_date=(n->>'business_date')::date;

        if counts>0 or abs(total-(n->>'expected')::numeric)>1e-9*greatest(1,abs(total),abs((n->>'expected')::numeric))
          or abs(allocated-1)>1e-9 then
          raise exception 'Forecast does not conserve units or shares';
        end if;
      elsif coalesce(n->'trace'->>'share_status','') not in ('closed','needs_baseline') then
        raise exception 'Missing allocation trace';
      end if;
    end loop;

    perform set_config('optimenu.projection_publish',coalesce(old_guard,''),true);
  exception when sqlstate 'PT410' then
    perform set_config('optimenu.projection_publish',coalesce(old_guard,''),true);
    update public.projection_jobs set status='missed',stage='deadline',
      last_error=jsonb_build_object('kind','missed','code',sqlerrm) where id=jid;
    delete from public.projection_job_leases where job_id=jid and token=tok;
    return jsonb_build_object('status','missed','code',sqlerrm);
  end;

  update public.projection_jobs set status='succeeded',stage='published',run_id=r.id,
    last_error=null,updated_at=clock_timestamp() where id=jid;
  delete from public.projection_job_leases where job_id=jid and token=tok;

  return jsonb_build_object('status','succeeded','run_id',r.id,'retry',false,'issued_at',r.issued_at);
end $f$;

create function public.projection_force(rid uuid,request_id uuid,actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t jsonb; head uuid; jid uuid;
begin
  perform projection_private.calendar_actor(rid,actor,true);
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||rid::text,0));
  t:=projection_private.run_timing(rid,clock_timestamp());

  if not (t->>'enabled')::boolean or clock_timestamp()>=(t->>'deadline_at')::timestamptz then
    raise exception 'PROJECTION_FORCE_DEADLINE' using errcode='PT410';
  end if;

  select id into head from public.projection_forecast_runs x
    where restaurant_id=rid and run_date=(t->>'business_date')::date and model_major=4
    and not exists(select 1 from public.projection_forecast_runs child where child.supersedes_id=x.id);

  if head is null then raise exception 'A forced revision requires an existing forecast'; end if;

  insert into public.projection_jobs(restaurant_id,business_date,model_major,job_kind,parent_run_id,requested_by)
    values(rid,(t->>'business_date')::date,4,'force:'||request_id::text,head,actor)
    on conflict(restaurant_id,business_date,model_major,job_kind)
    do update set requested_by=projection_jobs.requested_by returning id into jid;

  return jsonb_build_object('job_id',jid);
end $f$;

create function public.projection_latest(rid uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t jsonb; r public.projection_forecast_runs;
begin
  begin
    t:=projection_private.run_timing(rid,clock_timestamp());
  exception when others then
    t:=jsonb_build_object('enabled',false,'business_date',null,'setup_error',sqlerrm);
  end;

  select * into r from public.projection_forecast_runs x where restaurant_id=rid and model_major=4
    and not exists(select 1 from public.projection_forecast_runs child where child.supersedes_id=x.id)
    order by run_date desc,issued_at desc limit 1;

  return jsonb_build_object('restaurant_id',rid,'business_date',t->'business_date','setup_error',t->'setup_error',
    'stale',r.id is null or r.run_date<>(t->>'business_date')::date or not (t->>'enabled')::boolean,
    'run',to_jsonb(r),
    'nights',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('dishes',
      coalesce((select jsonb_agg(to_jsonb(d) order by dish_id) from public.projection_forecast_dishes d
        where d.restaurant_id=rid and d.run_id=r.id and d.target_date=n.target_date),'[]')) order by target_date)
      from public.projection_forecast_nights n where n.restaurant_id=rid and n.run_id=r.id),'[]'),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by created_at desc) from public.projection_jobs j
      where j.restaurant_id=rid and j.business_date=(t->>'business_date')::date),'[]'));
end $f$;

do $b$ declare d text; f record; begin
  d:=pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure);
  if strpos(d,'''projection_holiday_prompt_views'',')=0 then raise exception 'Unexpected purge definition'; end if;

  execute replace(d,'''projection_holiday_prompt_views'',',
    '''projection_job_leases'',''projection_jobs'',''projection_dirty_nights'',''projection_run_state'',''projection_holiday_prompt_views'',');

  for f in select oid::regprocedure signature from pg_proc where pronamespace='projection_private'::regnamespace loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.signature::text like '%before_nightly%' or f.signature::text like '%source_covered%' then
      execute format('grant execute on function %s to service_role',f.signature);
    end if;
  end loop;

  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('projection_enable','projection_dispatch','projection_claim','projection_checkpoint','projection_work','projection_ack_night',
     'projection_snapshot','projection_publish','projection_force','projection_latest') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $b$;

create trigger projection_config_lock before insert or update or delete on public.projection_restaurant_config
for each row execute function projection_private.lock_ingestion_context();

-- Read existing recommendation outcomes only. Do not change recommendation selection.
create function public.projection_refresh_treatments(jid uuid,tok uuid,day date) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs; recs jsonb;
begin
  j:=projection_private.require_lease(jid,tok);

  select recommendations into recs from public.ai_recommendations
    where restaurant_id=j.restaurant_id and generated_date=day order by id desc limit 1;

  if jsonb_typeof(recs)='array' then
    update public.projection_nightly_dish_facts f set recommended=case when
      (select count(*) from public.menu_items other
        where other.restaurant_id=j.restaurant_id and lower(btrim(other.name))=lower(btrim(m.name)))=1
      then exists(select 1 from jsonb_array_elements(recs) r where lower(btrim(r->>'title'))=lower(btrim(m.name)))
      else null end
    from public.projection_dishes d
    join public.menu_items m on m.id=d.menu_item_id and m.restaurant_id=d.restaurant_id
    where f.restaurant_id=j.restaurant_id and f.business_date=day
      and d.restaurant_id=f.restaurant_id and d.id=f.dish_id;
  end if;

  update public.projection_nightly_flags
    set recommendation_flags_complete=coalesce(jsonb_typeof(recs)='array',false) and not exists(
      select 1 from public.projection_nightly_dish_facts
      where restaurant_id=j.restaurant_id and business_date=day and recommended is null)
    where restaurant_id=j.restaurant_id and business_date=day;

  return jsonb_build_object('saved',true);
end $f$;

revoke all on function public.projection_refresh_treatments(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.projection_refresh_treatments(uuid,uuid,date) to service_role;

commit;