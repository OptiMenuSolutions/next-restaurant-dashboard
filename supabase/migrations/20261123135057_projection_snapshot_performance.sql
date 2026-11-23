begin;

create function projection_private.menu_source_dates(rid uuid, snapshot_at timestamptz)
returns table(menu_item_id uuid, added_business_date date)
language sql stable set search_path='' set timezone='UTC' as $dates$
  with menu_rows as materialized (
    select id,created_at from public.menu_items
    where restaurant_id=rid and created_at<=snapshot_at
  ), bounds as (
    select min(created_at) first_at from menu_rows
  ), changes as (
    select first_at change_at from bounds where first_at is not null
    union
    select released_at from public.projection_model_versions,bounds
      where released_at>first_at and released_at<=snapshot_at
    union
    select effective_at from public.projection_setting_versions,bounds
      where (restaurant_id is null or restaurant_id=rid)
        and effective_at>first_at and effective_at<=snapshot_at
  ), segments as materialized (
    select change_at,lead(change_at) over(order by change_at) until_at
    from changes
  ), used_segments as materialized (
    select s.* from segments s where exists (
      select 1 from menu_rows m where m.created_at>=s.change_at
        and (s.until_at is null or m.created_at<s.until_at)
    )
  ), clocks as materialized (
    select s.*,projection_private.pos_source_clock(rid,null,s.change_at) timing
    from used_segments s
  ), prepared as materialized (
    select m.id,m.created_at,c.timing->>'timezone' zone,
      (c.timing->>'cutoff_minutes')::integer cutoff,
      (m.created_at at time zone (c.timing->>'timezone'))::date local_day
    from menu_rows m join clocks c on m.created_at>=c.change_at
      and (c.until_at is null or m.created_at<c.until_at)
  ), days as materialized (
    select distinct local_day,zone,cutoff from prepared
  ), boundaries as materialized (
    select d.*,projection_private.business_boundary(local_day,zone,cutoff) starts_at
    from days d
  )
  select p.id,
    case when p.created_at<b.starts_at then p.local_day-1 else p.local_day end
  from prepared p join boundaries b
    on b.local_day=p.local_day and b.zone=p.zone and b.cutoff=p.cutoff;
$dates$;

revoke all on function projection_private.menu_source_dates(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function projection_private.menu_source_dates(uuid,timestamptz)
  to service_role;

do $patch$
declare definition text; old_text text; new_text text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-settings:4',0)
  );

  definition:=pg_get_functiondef(
    'projection_private.lifecycle_context_before_nightly(uuid,date,timestamptz)'::regprocedure
  );
  old_text:=$old$(projection_private.pos_source_clock(p_restaurant_id,null,m.created_at)->>'business_date')::date$old$;
  if strpos(definition,old_text)=0 then
    raise exception 'Unexpected lifecycle menu clock definition';
  end if;
  definition:=replace(definition,old_text,'menu_dates.added_business_date');
  old_text:=$old$from public.menu_items m left join public.projection_dishes d on m.id=d.menu_item_id and m.restaurant_id=d.restaurant_id$old$;
  new_text:=old_text||' join projection_private.menu_source_dates(p_restaurant_id,p_snapshot_at) menu_dates on menu_dates.menu_item_id=m.id';
  if strpos(definition,old_text)=0 then
    raise exception 'Unexpected lifecycle menu join';
  end if;
  execute replace(definition,old_text,new_text);

  definition:=pg_get_functiondef(
    'projection_private.lifecycle_prior_sales(uuid,date,timestamptz)'::regprocedure
  );
  old_text:=$old$(projection_private.pos_source_clock(p_restaurant_id,null,m.created_at)->>'business_date')::date$old$;
  if strpos(definition,old_text)=0 then
    raise exception 'Unexpected prior-sales menu clock definition';
  end if;
  definition:=replace(definition,old_text,'menu_dates.added_business_date');
  old_text:='join public.restaurants r on r.id=d.restaurant_id';
  new_text:=old_text||' join projection_private.menu_source_dates(p_restaurant_id,p_snapshot_at) menu_dates on menu_dates.menu_item_id=m.id';
  if strpos(definition,old_text)=0 then
    raise exception 'Unexpected prior-sales restaurant join';
  end if;
  execute replace(definition,old_text,new_text);
end;
$patch$;

create or replace function public.projection_benchmark_inputs(rid uuid,at_time timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $inputs$
declare t jsonb;
begin
  if at_time>clock_timestamp() then raise exception 'Future benchmark snapshot'; end if;
  t:=projection_private.run_timing(rid,at_time);

  if not exists (
    select 1 from public.projection_run_state s
    where s.restaurant_id=rid and s.backfill_complete
  ) then
    return jsonb_build_object(
      'restaurant_id',rid,'as_of',t->>'business_date','snapshot_at',at_time,
      'backfill',jsonb_build_object('complete',false)
    );
  end if;

  return projection_private.run_inputs(rid,(t->>'business_date')::date,at_time);
end;
$inputs$;

revoke all on function public.projection_benchmark_inputs(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.projection_benchmark_inputs(uuid,timestamptz)
  to service_role;

commit;