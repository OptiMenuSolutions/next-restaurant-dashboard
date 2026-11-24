begin;

-- Read projections of immutable JSON, avoiding per-observation TOAST expansion.
alter table public.projection_forecast_dishes
  add column monitor_key bytea generated always as (uuid_send(run_id)||date_send(target_date)) stored,
  add column monitor_category text generated always as (trace->>'style_category') stored,
  add column monitor_status text generated always as (trace->>'status') stored;
alter table public.projection_forecast_nights
  add column monitor_key bytea generated always as (uuid_send(run_id)||date_send(target_date)) stored,
  add column monitor_categories jsonb generated always as
    (jsonb_path_query_array(trace,'$.categories[*] ? (@.status == "ok").style_category')) stored;
create index projection_monitor_run_date on public.projection_forecast_runs(restaurant_id,run_date,model_major,issued_at);
create index projection_monitor_night_date on public.projection_forecast_nights(restaurant_id,target_date,run_id);
create index projection_monitor_dish_date on public.projection_forecast_dishes(restaurant_id,monitor_key,dish_id);
create index projection_monitor_jobs on public.projection_jobs(restaurant_id,business_date desc,updated_at desc);

-- Lossless transport: repeat a constant numeric column once, without rounding.
create function projection_private.monitor_vector(p_values double precision[])
returns json language sql immutable strict parallel safe as $f$
  select to_json(case when cardinality(p_values)>1
    and cardinality(array_remove(p_values,p_values[1]))=0
    then p_values[1:1] else p_values end);
$f$;

create function projection_private.monitor_catalog(rid uuid)
returns table(dish_index integer,dish_id uuid,name text)
language sql stable as $f$
  select (row_number() over(order by d.id)-1)::integer,d.id,
    coalesce(nullif(trim(m.name),''),d.id::text)
  from public.projection_dishes d left join public.menu_items m
    on m.id=d.menu_item_id and m.restaurant_id=rid where d.restaurant_id=rid;
$f$;

create function public.projection_monitor_overview(at_time timestamptz default statement_timestamp())
returns jsonb language sql stable security definer set search_path='' as $f$
  select jsonb_build_object('snapshot_at',at_time,'restaurants',coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'name',coalesce(nullif(trim(r.name),''),'Unnamed restaurant'),'timezone',r.operational_timezone,
    'enabled',coalesce(c.enabled,false),'backfill',to_jsonb(s),'job',to_jsonb(j),
    'latest_run',case when v.id is null then null else jsonb_build_object('id',v.id,'run_date',v.run_date,
      'issued_at',v.issued_at,'source_through',v.source_through,'model_major',v.model_major,
      'calibration_key',v.calibration_key) end,
    'last_complete_date',(select max(business_date) from public.projection_nightly_flags f
      where f.restaurant_id=r.id and f.complete and f.updated_at<=at_time),
    'source_repairs',(select count(*) from public.projection_pos_source_repairs p where p.restaurant_id=r.id),
    'menu_repairs',(select count(*) from public.projection_menu_repairs p where p.restaurant_id=r.id),
    'dirty_nights',(select count(*) from public.projection_dirty_nights p where p.restaurant_id=r.id)
  ) order by r.id),'[]'))
  from public.restaurants r left join public.projection_restaurant_config c on c.restaurant_id=r.id
  left join public.projection_run_state s on s.restaurant_id=r.id
  left join lateral(select * from public.projection_jobs j where j.restaurant_id=r.id and j.created_at<=at_time
      and (j.job_kind='forecast' or j.job_kind like 'force:%')
    order by business_date desc,updated_at desc,id limit 1) j on true
  left join lateral(select * from public.projection_forecast_runs v where v.restaurant_id=r.id and v.issued_at<=at_time
    order by run_date desc,issued_at desc,id limit 1) v on true
  where r.deactivated_at is null and r.id<>'00000000-0000-0000-0000-000000000001';
$f$;

create function public.projection_monitor_read(rid uuid,first_day date,last_day date,
  view_kind text default 'service',at_time timestamptz default statement_timestamp(),
  regular_only boolean default true,selected_dish uuid default null)
returns json language plpgsql stable security definer set search_path='' set work_mem='64MB' set jit=off as $f$
declare result json; metadata json;
begin
  if first_day is null or last_day is null or last_day<first_day or last_day-first_day>83
    or view_kind not in ('service','accuracy') or (view_kind='service' and first_day<>last_day)
    or at_time>statement_timestamp() then raise exception 'Invalid monitor request' using errcode='22023'; end if;
  select json_build_object('id',r.id,'name',coalesce(nullif(trim(r.name),''),'Unnamed restaurant'),
    'timezone',r.operational_timezone) into metadata from public.restaurants r where r.id=rid;
  if metadata is null then raise exception 'Restaurant not found' using errcode='22023'; end if;
  with catalog as materialized (select * from projection_private.monitor_catalog(rid)),
  heads as materialized (
    select r.id,r.run_date,r.model_major,r.calibration_key,r.issued_at,r.source_through,r.settings_snapshot
    from public.projection_forecast_runs r
    where r.restaurant_id=rid and r.run_date between first_day-7 and last_day and r.issued_at<=at_time
      and not exists(select 1 from public.projection_forecast_runs c
        where c.restaurant_id=rid and c.supersedes_id=r.id and c.issued_at<=at_time)
  ) select json_build_object('format',1,'restaurant',metadata,'snapshot_at',at_time,
    'from',first_day,'until',last_day,'regular_only',regular_only,'selected_dish',selected_dish,
    'catalog',coalesce((select json_agg(json_build_array(dish_id,name) order by dish_index) from catalog),'[]'),
    'categories',array(select code from public.projection_style_categories order by code),
    'actuals',coalesce((select json_agg(json_build_object('business_date',f.business_date,
      'complete',f.complete,'total_units',f.total_units,'source_revision',f.source_revision,
      'closed',f.closed,'early_close',f.early_close,'holiday_keys',f.holiday_keys,'outlier_status',f.outlier_status,'diagnostics',f.flags,
      'source_covered',exists(select 1 from public.projection_pos_source_windows w where w.restaurant_id=rid
        and (w.valid_from is null or w.valid_from<=f.business_date) and (w.valid_until is null or f.business_date<w.valid_until))
        and not exists(select 1 from public.projection_dirty_nights d where d.restaurant_id=rid
          and d.business_date=f.business_date and d.requires_source),
      'source_issue',case
        when exists(select 1 from public.projection_pos_source_repairs p where p.restaurant_id=rid and
          (not exists(select 1 from public.projection_pos_source_windows w where w.restaurant_id=rid and w.connection_id=p.connection_id)
          or exists(select 1 from public.projection_pos_source_windows w where w.restaurant_id=rid and w.connection_id=p.connection_id
            and (w.valid_from is null or w.valid_from<=f.business_date) and (w.valid_until is null or f.business_date<w.valid_until))))
          then 'source_repair_pending' else null end,
      'calendar_pending',exists(select 1 from public.projection_dirty_nights d where d.restaurant_id=rid
        and d.business_date=f.business_date and not d.requires_source)
    ) order by f.business_date) from public.projection_nightly_flags f
      where f.restaurant_id=rid and f.business_date between first_day and last_day and f.updated_at<=at_time),'[]'),
    'facts',coalesce((select json_agg(json_build_array(f.business_date,c.dish_index,f.units::float8,f.recommended,f.sold_out,
      f.source_revision=n.source_revision and f.updated_at<=at_time) order by f.business_date,c.dish_index)
      from public.projection_nightly_dish_facts f join catalog c on c.dish_id=f.dish_id
      left join public.projection_nightly_flags n on n.restaurant_id=rid and n.business_date=f.business_date
      where f.restaurant_id=rid and f.business_date between first_day and last_day),'[]'),
    'nights',coalesce((select json_agg(json_build_array(r.id,r.run_date,n.target_date,n.days_ahead,r.model_major,
      r.calibration_key,r.issued_at,r.source_through,n.expected,n.low,n.high,
      (r.settings_snapshot->>'range_coverage')::float8,n.availability,n.monitor_categories,
      (select json_build_array(
        array_agg(d.dish_index),array_agg(d.category_index),
        projection_private.monitor_vector(array_agg(d.share)),
        projection_private.monitor_vector(array_agg(d.expected)),
        projection_private.monitor_vector(array_agg(d.low)),
        projection_private.monitor_vector(array_agg(d.high)),
        projection_private.monitor_vector(array_agg(d.status::float8)))
        from (select c.dish_index,
          coalesce(to_json(array_position(array(select code from public.projection_style_categories order by code),p.monitor_category)-1),to_json(p.monitor_category)) category_index,
          p.share,p.expected,p.low,p.high,p.status
          from (select d.dish_id,d.monitor_category,d.share::float8 share,d.expected::float8 expected,
            d.low::float8 low,d.high::float8 high,
            case d.monitor_status when 'ok' then 1 when 'inactive' then 0 else -1 end status
            from public.projection_forecast_dishes d where d.restaurant_id=rid and d.monitor_key=n.monitor_key offset 0) p
          join catalog c on c.dish_id=p.dish_id order by c.dish_index offset 0) d))
      order by n.target_date,n.days_ahead,r.model_major,r.id)
      from heads r join public.projection_forecast_nights n on n.restaurant_id=rid and n.run_id=r.id
      where n.target_date between first_day and last_day),'[]'),
    'revisions',coalesce((select json_agg(json_build_object('id',r.id,'run_date',r.run_date,'issued_at',r.issued_at,
      'supersedes_id',r.supersedes_id,'model_major',r.model_major,'calibration_key',r.calibration_key,'source_through',r.source_through)
      order by r.run_date desc,r.issued_at desc,r.id) from public.projection_forecast_runs r
      where r.restaurant_id=rid and r.run_date between first_day-7 and last_day and r.issued_at<=at_time),'[]'),
    'bias',case when view_kind='accuracy' then coalesce((with latest as (
      select distinct on(model_major,calibration_key) id,model_major,calibration_key,run_date,issued_at,source_through
      from public.projection_forecast_runs r where r.restaurant_id=rid and r.issued_at<=at_time
        and r.run_date<=last_day+1
        and not exists(select 1 from public.projection_forecast_runs c where c.restaurant_id=rid and c.supersedes_id=r.id and c.issued_at<=at_time)
        order by model_major,calibration_key,run_date desc,issued_at desc,id
    ) select jsonb_agg(jsonb_build_object('run_id',r.id,'run_date',r.run_date,'issued_at',r.issued_at,
      'model_major',r.model_major,'calibration_key',r.calibration_key,'source_through',r.source_through,
      'nights',coalesce((select jsonb_agg(jsonb_build_object('days_ahead',n.days_ahead,
        'volume',n.trace#>'{range,bias}','dishes',coalesce((select jsonb_agg(jsonb_build_object(
          'dish_id',d.dish_id,'bias',d.trace#>'{range,bias}')) from public.projection_forecast_dishes d
          where d.restaurant_id=rid and d.run_id=r.id and d.target_date=n.target_date),'[]')))
        from public.projection_forecast_nights n where n.restaurant_id=rid and n.run_id=r.id),'[]')))
      from latest r),'[]') else '[]'::jsonb end,
    'last_complete_date',(select max(business_date) from public.projection_nightly_flags
      where restaurant_id=rid and complete and updated_at<=at_time)) into result;
  return result;
end;
$f$;

create function public.projection_monitor_run(rid uuid,run uuid,day date default null,item uuid default null)
returns jsonb language sql stable security definer set search_path='' as $f$
  select jsonb_build_object('restaurant',jsonb_build_object('id',rid,'timezone',
    (select operational_timezone from public.restaurants where id=rid),
    'dish_names',(select jsonb_object_agg(dish_id::text,name) from projection_private.monitor_catalog(rid))),
    'run',to_jsonb(r),'nights',coalesce((select jsonb_agg(jsonb_build_object(
      'target_date',n.target_date,'days_ahead',n.days_ahead,'availability',n.availability,
      'expected',n.expected,'low',n.low,'high',n.high,'confidence',n.confidence,
      'trace',case when n.target_date=day then n.trace else null end,
      'dishes',case when n.target_date=day then coalesce((select jsonb_agg(jsonb_build_object(
        'dish_id',d.dish_id,'share',d.share,'expected',d.expected,'low',d.low,'high',d.high,
        'category',d.monitor_category,'confidence',d.confidence) order by d.dish_id)
        from public.projection_forecast_dishes d where d.restaurant_id=rid and d.run_id=r.id and d.target_date=n.target_date),'[]') else '[]' end,
      'selected_dish',case when n.target_date=day then (select to_jsonb(d)-'monitor_key'-'monitor_category'-'monitor_status'
        from public.projection_forecast_dishes d where d.restaurant_id=rid and d.run_id=r.id
          and d.target_date=day and d.dish_id=item) else null end
    ) order by n.target_date) from public.projection_forecast_nights n where n.restaurant_id=rid and n.run_id=r.id),'[]'))
  from public.projection_forecast_runs r where r.restaurant_id=rid and r.id=run;
$f$;

revoke all on function projection_private.monitor_vector(double precision[]),
  projection_private.monitor_catalog(uuid),
  public.projection_monitor_overview(timestamptz),public.projection_monitor_read(uuid,date,date,text,timestamptz,boolean,uuid),
  public.projection_monitor_run(uuid,uuid,date,uuid) from public,anon,authenticated;
grant execute on function projection_private.monitor_vector(double precision[]),
  projection_private.monitor_catalog(uuid),
  public.projection_monitor_overview(timestamptz),public.projection_monitor_read(uuid,date,date,text,timestamptz,boolean,uuid),
  public.projection_monitor_run(uuid,uuid,date,uuid) to service_role;

commit;