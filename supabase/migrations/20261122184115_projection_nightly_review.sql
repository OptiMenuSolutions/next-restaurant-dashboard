begin;

drop trigger if exists projection_pos_lines_dirty on public.pos_ticket_lines;
drop trigger if exists projection_pos_tickets_dirty on public.pos_tickets;
drop function if exists projection_private.queue_pos_evidence();

alter table public.projection_dirty_nights
  add column requires_source boolean not null default true;

alter table public.projection_jobs
  add column work_state jsonb not null default '{}';

alter table public.projection_jobs
  add column source_exclusions date[] not null default '{}';

create or replace function projection_private.queue_changed_history() returns trigger
language plpgsql security definer set search_path='' as $f$
declare
  a jsonb:=to_jsonb(old);
  b jsonb:=to_jsonb(new);
  rid uuid:=coalesce(new.restaurant_id,old.restaurant_id);
  source_read boolean:=tg_table_name not in (
    'projection_calendar_versions','projection_holiday_answer_versions'
  );
  range_only boolean;
begin
  if tg_op='UPDATE' and (a-'updated_at') is not distinct from (b-'updated_at') then
    return new;
  end if;

  if projection_private.is_account_purge(rid) then return coalesce(new,old); end if;

  range_only:=tg_op='UPDATE' and case tg_table_name
    when 'projection_pos_item_map' then
      (a->'pos_system',a->'external_item_id',a->'dish_id') is not distinct from
      (b->'pos_system',b->'external_item_id',b->'dish_id')
    when 'projection_dish_availability' then
      a->'dish_id' is not distinct from b->'dish_id'
    when 'projection_pos_source_windows' then
      (a->'connection_id',a->'provider') is not distinct from
      (b->'connection_id',b->'provider')
    else false
  end;

  insert into public.projection_dirty_nights(
    restaurant_id,business_date,generation,reason,requires_source
  )
  select rid,f.business_date,1,tg_table_name,source_read
  from public.projection_nightly_flags f
  where f.restaurant_id=rid
  and exists(
    select 1 from jsonb_array_elements(jsonb_build_array(a,b)) v
    where v<>'null'::jsonb
    and case tg_table_name
      when 'projection_holiday_answer_versions' then
        f.business_date=(v->>'business_date')::date
      when 'projection_calendar_versions' then
        v->>'effective_from' is null or f.business_date>=(v->>'effective_from')::date
      else
        (v->>'valid_from' is null or f.business_date>=(v->>'valid_from')::date)
        and (v->>'valid_until' is null or f.business_date<(v->>'valid_until')::date)
    end
  )
  and (
    not range_only or not (
      (a->>'valid_from' is null or f.business_date>=(a->>'valid_from')::date)
      and (a->>'valid_until' is null or f.business_date<(a->>'valid_until')::date)
      and (b->>'valid_from' is null or f.business_date>=(b->>'valid_from')::date)
      and (b->>'valid_until' is null or f.business_date<(b->>'valid_until')::date)
    )
  )
  on conflict(restaurant_id,business_date) do update
    set generation=projection_dirty_nights.generation+1,
        reason=excluded.reason,
        requires_source=projection_dirty_nights.requires_source or excluded.requires_source,
        attempted_at=null;

  return coalesce(new,old);
exception when others then
  raise warning 'Projection history maintenance deferred (%)',sqlstate;
  return coalesce(new,old);
end $f$;

create or replace function projection_private.source_covered(rid uuid,day date) returns boolean
language sql stable security definer set search_path='' as $f$
  select exists(
    select 1 from public.projection_pos_source_windows w
    where w.restaurant_id=rid
      and (w.valid_from is null or w.valid_from<=day)
      and (w.valid_until is null or day<w.valid_until)
  )
  and not exists(
    select 1 from public.projection_dirty_nights d
    where d.restaurant_id=rid and d.business_date=day and d.requires_source
  )
  and not exists(
    select 1 from public.projection_pos_source_repairs p
    where p.restaurant_id=rid and (
      exists(
        select 1 from public.projection_pos_source_windows w
        where w.restaurant_id=rid and w.connection_id=p.connection_id
          and (w.valid_from is null or w.valid_from<=day)
          and (w.valid_until is null or day<w.valid_until)
      )
      or day>=(projection_private.pos_source_clock(rid,null,p.last_failure_at)->>'business_date')::date
    )
  )
  and not exists(
    select 1 from public.projection_job_leases l
    join public.projection_jobs j on j.id=l.job_id and j.restaurant_id=l.restaurant_id
    where l.restaurant_id=rid and l.expires_at>clock_timestamp()
      and day=any(j.source_exclusions)
  );
$f$;

create function public.projection_fallback(jid uuid,tok uuid,excluded_dates date[]) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs;
begin
  j:=projection_private.require_lease(jid,tok);

  if j.job_kind in ('backfill','maintenance') or excluded_dates is null or
    exists(select 1 from unnest(excluded_dates) d where d is null or d>=j.business_date)
  then raise exception 'Invalid fallback scope'; end if;

  update public.projection_jobs set source_exclusions=excluded_dates where id=jid;
  return jsonb_build_object('saved',true);
end $f$;

create function public.projection_ack_calendar(jid uuid,tok uuid,generations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs;
begin
  j:=projection_private.require_lease(jid,tok);

  if jsonb_typeof(generations)<>'array' then raise exception 'Invalid calendar receipt'; end if;

  delete from public.projection_dirty_nights d
  using jsonb_array_elements(generations) x
  where d.restaurant_id=j.restaurant_id and not d.requires_source
    and d.business_date=(x->>'business_date')::date
    and d.generation=(x->>'generation')::bigint;

  return jsonb_build_object('saved',true);
end $f$;

create or replace function public.projection_work(jid uuid,tok uuid,repair boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare
  j public.projection_jobs;
  r public.projection_pos_source_repairs;
  c public.pos_connections;
  source_window public.projection_pos_source_windows;
  state public.projection_run_state;
  dates jsonb;
  timing jsonb;
  local_day date;
begin
  j:=projection_private.require_lease(jid,tok);
  timing:=projection_private.run_timing(j.restaurant_id,clock_timestamp());

  if repair then
    for r in select * from public.projection_pos_source_repairs
      where restaurant_id=j.restaurant_id order by connection_id
    loop
      begin
        select * into strict c from public.pos_connections
          where id=r.connection_id and restaurant_id=j.restaurant_id;

        if c.status is distinct from r.observed_status or c.status not in ('connected','disconnected') then
          raise exception 'Source identity needs reconciliation';
        end if;

        select * into source_window from public.projection_pos_source_windows
          where restaurant_id=j.restaurant_id and connection_id=c.id
          order by valid_until desc nulls first,id limit 1;

        local_day:=(projection_private.pos_source_clock(
          j.restaurant_id,to_jsonb(c)->>'shift4_timezone',r.last_failure_at
        )->>'business_date')::date;

        if c.status='disconnected' and source_window.id is not null and source_window.valid_until is null then
          update public.projection_pos_source_windows
            set valid_until=greatest(local_day+1,coalesce(valid_from,local_day)+1),
                lifecycle_context=jsonb_build_object(
                  'operation','repair_disconnect','observed_at',r.last_failure_at
                )
            where id=source_window.id;
        elsif c.status='connected' and (source_window.id is null or source_window.valid_until is not null) then
          insert into public.projection_pos_source_windows(
            restaurant_id,connection_id,provider,valid_from,lifecycle_context
          )
          values(
            j.restaurant_id,c.id,c.provider,
            case when source_window.id is null then null else local_day end,
            jsonb_build_object('operation','repair_connect','observed_at',r.last_failure_at)
          );
        end if;

        delete from public.projection_pos_source_repairs
          where restaurant_id=r.restaurant_id and connection_id=r.connection_id;
      exception when others then
        update public.projection_pos_source_repairs set error_code=sqlstate
          where restaurant_id=r.restaurant_id and connection_id=r.connection_id;
      end;
    end loop;

    perform public.projection_repair_menu(j.restaurant_id);
  end if;

  select * into strict state from public.projection_run_state
    where restaurant_id=j.restaurant_id;

  if j.job_kind='backfill' then
    select jsonb_agg(jsonb_build_object(
      'business_date',day::date,'generation',d.generation
    ) order by day) into dates
    from generate_series(
      state.cursor_date,least(state.backfill_until,state.cursor_date+6),interval '1 day'
    ) day
    left join public.projection_dirty_nights d
      on d.restaurant_id=j.restaurant_id and d.business_date=day::date;
  elsif repair then
    select coalesce(jsonb_agg(jsonb_build_object(
      'business_date',business_date,'generation',generation
    ) order by business_date),'[]') into dates
    from (
      select * from public.projection_dirty_nights
      where restaurant_id=j.restaurant_id and requires_source
        and business_date<(timing->>'business_date')::date
      order by attempted_at nulls first,business_date limit 14
    ) affected;
  else
    select jsonb_agg(jsonb_build_object(
      'business_date',x.day,'generation',d.generation
    ) order by x.day) into dates
    from (
      select day::date from generate_series(
        (timing->>'business_date')::date-7,
        (timing->>'business_date')::date-1,
        interval '1 day'
      ) day
      where j.job_kind<>'maintenance'
      union
      select business_date from (
        select business_date from public.projection_dirty_nights
        where restaurant_id=j.restaurant_id and requires_source
          and business_date<(timing->>'business_date')::date
        order by attempted_at nulls first,business_date limit 14
      ) oldest
    ) x
    left join public.projection_dirty_nights d
      on d.restaurant_id=j.restaurant_id and d.business_date=x.day;
  end if;

  select coalesce(jsonb_agg(n||jsonb_build_object(
    'covered',exists(
      select 1 from public.projection_pos_source_windows w
      where w.restaurant_id=j.restaurant_id
        and (w.valid_from is null or w.valid_from<=(n->>'business_date')::date)
        and (w.valid_until is null or w.valid_until>(n->>'business_date')::date)
    )
  ) order by n->>'business_date'),'[]')
  into dates from jsonb_array_elements(coalesce(dates,'[]')) n;

  update public.projection_dirty_nights set attempted_at=clock_timestamp()
    where restaurant_id=j.restaurant_id
      and business_date in (
        select (n->>'business_date')::date from jsonb_array_elements(dates) n
      );

  return jsonb_build_object(
    'dates',dates,'backfill',to_jsonb(state),'timing',timing,
    'calendar_dates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date',business_date,'generation',generation
      ))
      from public.projection_dirty_nights
      where restaurant_id=j.restaurant_id and not requires_source
    ),'[]')
  );
end $f$;

drop function public.projection_checkpoint(uuid,uuid,text,jsonb,timestamptz,jsonb,boolean);

create function public.projection_checkpoint(
  jid uuid,tok uuid,stage_name text,progress jsonb default null,
  retry_at timestamptz default null,problem jsonb default null,
  done boolean default false,work_state jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j public.projection_jobs;
begin
  j:=projection_private.require_lease(jid,tok);

  if progress is not null then
    if j.job_kind<>'backfill' or (progress->>'phase') not in ('observe','verify','complete') then
      raise exception 'Invalid backfill checkpoint';
    end if;

    if progress->>'phase'='complete' and exists(
      select 1 from public.projection_run_state b
      cross join lateral generate_series(
        b.backfill_from,b.backfill_until,interval '1 day'
      ) x(day)
      left join public.projection_ingestion_state i
        on i.restaurant_id=b.restaurant_id and i.business_date=x.day::date
      where b.restaurant_id=j.restaurant_id
        and exists(
          select 1 from public.projection_pos_source_windows w
          where w.restaurant_id=b.restaurant_id
            and (w.valid_from is null or w.valid_from<=x.day::date)
            and (w.valid_until is null or w.valid_until>x.day::date)
        )
        and (
          i.transaction_digest is null or
          i.last_observed_at<i.changed_at+make_interval(
            mins=>(projection_private.run_timing(
              j.restaurant_id,clock_timestamp()
            )->'settings'->>'sync_buffer_minutes')::integer
          )
        )
    ) then raise exception 'PROJECTION_BACKFILL_INCOMPLETE'; end if;

    update public.projection_run_state
      set cursor_date=(progress->>'cursor_date')::date,
          phase=progress->>'phase',
          backfill_complete=progress->>'phase'='complete',
          updated_at=clock_timestamp()
      where restaurant_id=j.restaurant_id;
  end if;

  if work_state is not null and jsonb_typeof(work_state)<>'object' then
    raise exception 'Invalid work checkpoint';
  end if;

  update public.projection_jobs
    set work_state=coalesce(projection_checkpoint.work_state,projection_jobs.work_state),
        stage=stage_name,last_error=problem,
        status=case
          when done then 'succeeded'
          when retry_at is null then 'running'
          when problem is null then 'waiting'
          else 'failed'
        end,
        due_at=coalesce(retry_at,due_at),
        updated_at=clock_timestamp()
    where id=jid;

  if retry_at is not null or done then
    delete from public.projection_job_leases
      where restaurant_id=j.restaurant_id and token=tok;
  else
    update public.projection_job_leases
      set expires_at=clock_timestamp()+interval '7 minutes'
      where restaurant_id=j.restaurant_id and token=tok;
  end if;

  return jsonb_build_object('saved',true);
end $f$;

do $b$ declare d text; begin
  d:=pg_get_functiondef('public.projection_claim(uuid)'::regprocedure);
  d:=replace(
    d,
    '  insert into public.projection_job_leases values(',
    '  update public.projection_jobs set source_exclusions=''{}'' where id=jid; j.source_exclusions:=''{}'';
  insert into public.projection_job_leases values('
  );
  execute d;

  d:=pg_get_functiondef('projection_private.run_inputs(uuid,date,timestamptz)'::regprocedure);
  execute replace(
    d,'FUNCTION projection_private.run_inputs(',
    'FUNCTION projection_private.run_inputs_before_review('
  );
end $b$;

create or replace function projection_private.run_inputs(
  rid uuid,day date,at_time timestamptz
) returns jsonb language plpgsql stable set search_path='' as $f$
declare r jsonb; exclusions date[];
begin
  r:=projection_private.run_inputs_before_review(rid,day,at_time)-'context_digest';

  select j.source_exclusions into exclusions
  from public.projection_job_leases l
  join public.projection_jobs j on j.id=l.job_id
  where l.restaurant_id=rid and l.expires_at>clock_timestamp();

  r:=r||jsonb_build_object('source_exclusions',coalesce(to_jsonb(exclusions),'[]'));

  return r||jsonb_build_object(
    'context_digest',encode(sha256(convert_to(r::text,'UTF8')),'hex')
  );
end $f$;

-- Disablement is separate from a missed deadline. Confidence belongs to each dish.
do $b$ declare d text; begin
  d:=pg_get_functiondef('projection_private.assert_publication(uuid,date,timestamptz,jsonb)'::regprocedure);
  d:=replace(
    d,
    'PROJECTION_PUBLICATION_NOT_ENABLED'' using errcode=''PT410''',
    'PROJECTION_PUBLICATION_NOT_ENABLED'' using errcode=''PT403'''
  );
  execute d;

  d:=pg_get_functiondef('public.projection_publish(uuid,uuid,timestamptz,text,jsonb)'::regprocedure);
  d:=replace(d,'j:=projection_private.require_lease(jid,tok);','j:=projection_private.require_lease(jid,tok);
  if not exists(select 1 from public.projection_restaurant_config c join public.restaurants rest_row on rest_row.id=c.restaurant_id
    where c.restaurant_id=j.restaurant_id and c.enabled and rest_row.deactivated_at is null) then
    update public.projection_jobs set status=''disabled'',stage=''disabled'',last_error='' {"code":"PROJECTION_PUBLICATION_NOT_ENABLED","kind":"disabled"}'' where id=jid;
    delete from public.projection_job_leases where job_id=jid and token=tok;
    return jsonb_build_object(''status'',''disabled'',''code'',''PROJECTION_PUBLICATION_NOT_ENABLED'');
  end if;');

  d:=replace(d,'n->>''confidence'',d->''trace''','d->>''confidence'',d->''trace''');
  d:=replace(d,'exception when sqlstate ''PT410'' then','exception when sqlstate ''PT410'' or sqlstate ''PT403'' then');

  d:=replace(
    d,'set status=''missed'',stage=''deadline'',',
    'set status=case when sqlstate=''PT403'' then ''disabled'' else ''missed'' end,stage=case when sqlstate=''PT403'' then ''disabled'' else ''deadline'' end,'
  );

  d:=replace(
    d,'''kind'',''missed'',''code'',sqlerrm',
    '''kind'',case when sqlstate=''PT403'' then ''disabled'' else ''missed'' end,''code'',sqlerrm'
  );

  d:=replace(
    d,'''status'',''missed'',''code'',sqlerrm',
    '''status'',case when sqlstate=''PT403'' then ''disabled'' else ''missed'' end,''code'',sqlerrm'
  );

  execute d;

  d:=pg_get_functiondef('public.projection_latest(uuid)'::regprocedure);
  execute replace(
    d,'FUNCTION public.projection_latest(',
    'FUNCTION projection_private.latest_before_review('
  );
end $b$;

create or replace function public.projection_latest(rid uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare r jsonb; t jsonb; state text; current_job text;
begin
  r:=projection_private.latest_before_review(rid);

  begin
    t:=projection_private.run_timing(rid,clock_timestamp());
  exception when others then
    t:='{}';
  end;

  select status into current_job from public.projection_jobs
    where restaurant_id=rid and business_date=(t->>'business_date')::date
      and job_kind='forecast';

  state:=case
    when not coalesce((t->>'enabled')::boolean,false) then 'disabled'
    when r->'run'->>'run_date'=t->>'business_date' then 'available'
    when clock_timestamp()<(t->>'deadline_at')::timestamptz
      and coalesce(current_job,'pending') in ('pending','running','waiting') then 'pending'
    else 'stale'
  end;

  return r||jsonb_build_object(
    'status',state,'pending',state='pending',
    'stale',state in ('stale','disabled')
  );
end $f$;

do $b$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('projection_checkpoint','projection_fallback','projection_ack_calendar')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;

  revoke all on function
    projection_private.run_inputs_before_review(uuid,date,timestamptz),
    projection_private.latest_before_review(uuid)
  from public,anon,authenticated;
end $b$;

commit;