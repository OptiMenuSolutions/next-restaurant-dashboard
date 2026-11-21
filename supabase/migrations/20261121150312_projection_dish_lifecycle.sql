begin;

-- Extend the approved settings version without rewriting any stored version.
do $b$
declare definition text;
begin
  definition := pg_get_functiondef('projection_private.settings_template()'::regprocedure);
  definition := replace(definition,'FUNCTION projection_private.settings_template(',
    'FUNCTION projection_private.settings_template_before_lifecycle(');
  execute definition;
  definition := pg_get_functiondef('projection_private.check_settings(jsonb,boolean)'::regprocedure);
  definition := replace(definition,'FUNCTION projection_private.check_settings(',
    'FUNCTION projection_private.check_settings_before_lifecycle(');
  definition := replace(definition,'projection_private.settings_template()',
    'projection_private.settings_template_before_lifecycle()');
  execute definition;
end $b$;
create or replace function projection_private.settings_template() returns jsonb
language sql immutable set search_path='' as $f$
  select projection_private.settings_template_before_lifecycle() || '{"minimum_return_gap_days":28}'::jsonb;
$f$;
create or replace function projection_private.check_settings(p jsonb, partial boolean default false)
returns boolean language plpgsql immutable set search_path='' as $f$
begin
  if p ? 'minimum_return_gap_days' then
    if jsonb_typeof(p->'minimum_return_gap_days') <> 'number' then return false; end if;
    if (p->>'minimum_return_gap_days')::numeric <= 0 or
      (p->>'minimum_return_gap_days')::numeric > 9007199254740991 or
      trunc((p->>'minimum_return_gap_days')::numeric) <> (p->>'minimum_return_gap_days')::numeric then return false; end if;
  end if;
  return projection_private.check_settings_before_lifecycle(p-'minimum_return_gap_days',partial);
end $f$;
revoke all on function projection_private.settings_template_before_lifecycle(),
  projection_private.check_settings_before_lifecycle(jsonb,boolean) from public,anon,authenticated;
grant execute on function projection_private.settings_template_before_lifecycle(),
  projection_private.check_settings_before_lifecycle(jsonb,boolean) to service_role;
insert into public.projection_setting_versions(model_major,effective_at,settings)
select model_major,clock_timestamp(),settings || '{"minimum_return_gap_days":28}'::jsonb
from (select distinct on(model_major) * from public.projection_setting_versions
  where restaurant_id is null and model_major=4 and effective_at<=clock_timestamp()
  order by model_major,effective_at desc) v;

alter table public.projection_dish_availability alter column valid_from drop not null;
alter table public.projection_dish_availability add column is_initial boolean not null default false;
alter table public.projection_dish_availability add column lifecycle_context jsonb not null default '{}';
do $b$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.projection_dish_availability'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%valid_until%valid_from%' loop
    execute format('alter table public.projection_dish_availability drop constraint %I',c.conname);
  end loop;
end $b$;
alter table public.projection_dish_availability add constraint projection_availability_dates
  check(valid_from is null or valid_until is null or valid_until>=valid_from);
create unique index projection_dish_menu_identity on public.projection_dishes(restaurant_id,menu_item_id)
  where menu_item_id is not null;

create table public.projection_menu_events(
  id uuid primary key, restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id uuid not null, observed_at timestamptz not null, operation text not null,
  source_row jsonb not null, timing jsonb not null default '{}', applied boolean not null default false
);
create table public.projection_menu_repairs(
  id uuid primary key, restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id uuid not null, observed_at timestamptz not null, operation text not null,
  source_row jsonb not null, error_code text not null, last_failure_at timestamptz not null default clock_timestamp()
);
create index projection_menu_repair_order on public.projection_menu_repairs(restaurant_id,observed_at,id);
create index projection_menu_events_item on public.projection_menu_events(restaurant_id,menu_item_id,observed_at);
alter table public.projection_menu_events enable row level security;
alter table public.projection_menu_repairs enable row level security;
revoke all on public.projection_menu_events,public.projection_menu_repairs from public,anon,authenticated,service_role;
grant select on public.projection_menu_events,public.projection_menu_repairs to service_role;

create function projection_private.apply_menu_event(p_id uuid) returns void
language plpgsql set search_path='' as $f$
declare e public.projection_menu_events; d public.projection_dishes; w public.projection_dish_availability;
  row_value jsonb; event_timing jsonb; day date; start_day date; end_day date; first_day date; initial_menu boolean; done_at timestamptz;
begin
  select * into strict e from public.projection_menu_events where id=p_id for update;
  if e.applied then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||e.restaurant_id::text,0));
  row_value:=e.source_row;
  if (row_value->>'restaurant_id')::uuid<>e.restaurant_id or (row_value->>'id')::uuid<>e.menu_item_id then
    raise exception 'Menu event crosses restaurants'; end if;
  select onboarding_completed_at into done_at from public.restaurants where id=e.restaurant_id;
  initial_menu:=done_at is null or (row_value->>'created_at')::timestamptz<=done_at;
  select first_data_date into first_day from public.projection_restaurant_config where restaurant_id=e.restaurant_id;
  event_timing:=projection_private.pos_source_clock(e.restaurant_id,null,e.observed_at);
  day:=(event_timing->>'business_date')::date;
  select * into d from public.projection_dishes where restaurant_id=e.restaurant_id and menu_item_id=e.menu_item_id;
  if d.id is null then
    insert into public.projection_dishes(id,restaurant_id,menu_item_id)
      values(e.menu_item_id,e.restaurant_id,e.menu_item_id) returning * into d;
  end if;
  select * into w from public.projection_dish_availability where restaurant_id=e.restaurant_id and dish_id=d.id
    order by valid_from desc nulls last,id limit 1 for update;
  if e.operation='backfill' and initial_menu and w.id is not null and
    (select count(*) from public.projection_dish_availability where restaurant_id=e.restaurant_id and dish_id=d.id)=1 then
    start_day:=first_day;
    if w.valid_until is not null and start_day>w.valid_until then start_day:=null; end if;
    if w.valid_from is distinct from start_day then
      delete from public.projection_dish_availability where id=w.id;
      insert into public.projection_dish_availability(id,restaurant_id,dish_id,valid_from,valid_until,is_initial,lifecycle_context)
        values(w.id,w.restaurant_id,w.dish_id,start_day,w.valid_until,true,event_timing||jsonb_build_object('operation','initial_menu_backfill'));
      select * into w from public.projection_dish_availability where id=w.id;
    end if;
  end if;
  if w.id is null then
    start_day:=case when initial_menu then first_day else
      (projection_private.pos_source_clock(e.restaurant_id,null,(row_value->>'created_at')::timestamptz)->>'business_date')::date end;
    end_day:=case when row_value->>'archived_at' is not null then
      (projection_private.pos_source_clock(e.restaurant_id,null,(row_value->>'archived_at')::timestamptz)->>'business_date')::date end;
    if initial_menu and end_day is not null and start_day>end_day then start_day:=null; end if;
    insert into public.projection_dish_availability(restaurant_id,dish_id,valid_from,valid_until,is_initial,lifecycle_context)
      values(e.restaurant_id,d.id,start_day,end_day,initial_menu,event_timing||jsonb_build_object('operation',e.operation,'event_id',e.id));
  elsif e.operation='archive' then
    if w.valid_from is not null and day<w.valid_from then raise exception 'Archive precedes availability'; end if;
    update public.projection_dish_availability set valid_until=day,lifecycle_context=w.lifecycle_context||event_timing||jsonb_build_object('event_id',e.id)
      where id=w.id;
  elsif e.operation='unarchive' and w.valid_until is not null then
    if w.valid_from=day or w.valid_until>=day then
      update public.projection_dish_availability set valid_until=null,lifecycle_context=w.lifecycle_context||event_timing||jsonb_build_object('event_id',e.id) where id=w.id;
    else
      insert into public.projection_dish_availability(restaurant_id,dish_id,valid_from,is_initial,lifecycle_context)
        values(e.restaurant_id,d.id,day,false,event_timing||jsonb_build_object('event_id',e.id));
    end if;
  end if;
  update public.projection_menu_events set timing=event_timing,applied=true where id=e.id;
end $f$;

create function projection_private.capture_menu_event() returns trigger
language plpgsql security definer set search_path='' as $f$
declare event_id uuid:=gen_random_uuid(); moment timestamptz; operation text; payload jsonb; failure text;
begin
  if tg_op='UPDATE' and new.archived_at is not distinct from old.archived_at then return new; end if;
  operation:=case when tg_op='INSERT' then 'insert' when new.archived_at is null then 'unarchive' else 'archive' end;
  moment:=case when operation='archive' then new.archived_at when operation='insert' then new.created_at else clock_timestamp() end;
  payload:=jsonb_build_object('id',new.id,'restaurant_id',new.restaurant_id,'created_at',new.created_at,'archived_at',new.archived_at);
  begin
    insert into public.projection_menu_events values(event_id,new.restaurant_id,new.id,moment,operation,payload,'{}',false);
    if exists(select 1 from public.projection_menu_repairs where restaurant_id=new.restaurant_id and menu_item_id=new.id) then
      raise exception 'Earlier menu event needs repair'; end if;
    perform projection_private.apply_menu_event(event_id);
  exception when others then
    failure:=sqlstate;
    begin
      insert into public.projection_menu_repairs(id,restaurant_id,menu_item_id,observed_at,operation,source_row,error_code)
        values(event_id,new.restaurant_id,new.id,moment,operation,payload,failure);
    exception when others then raise warning 'Projection menu repair could not be recorded (%)',sqlstate; end;
    raise warning 'Projection menu event deferred (%)',failure;
  end;
  return new;
end $f$;

create function public.projection_repair_menu(p_restaurant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare r public.projection_menu_repairs; fixed integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  for r in select * from public.projection_menu_repairs where restaurant_id=p_restaurant_id order by observed_at,id for update loop
    begin
      insert into public.projection_menu_events values(r.id,r.restaurant_id,r.menu_item_id,r.observed_at,r.operation,r.source_row,'{}',false)
        on conflict(id) do nothing;
      perform projection_private.apply_menu_event(r.id);
      delete from public.projection_menu_repairs where id=r.id;
      fixed:=fixed+1;
    exception when others then
      update public.projection_menu_repairs set error_code=sqlstate,last_failure_at=clock_timestamp() where id=r.id;
      exit;
    end;
  end loop;
  return jsonb_build_object('repaired',fixed,'pending',(select count(*) from public.projection_menu_repairs where restaurant_id=p_restaurant_id));
end $f$;

-- Freeze a known style once sales or launch observations rely on that assignment.
create function projection_private.guard_lifecycle_category() returns trigger
language plpgsql set search_path='' as $f$
begin
  if old.style_category is not null and new.style_category is distinct from old.style_category and
    (exists(select 1 from public.projection_launch_history where restaurant_id=old.restaurant_id and dish_id=old.id) or
     exists(select 1 from public.projection_nightly_dish_facts where restaurant_id=old.restaurant_id and dish_id=old.id)) then
    raise exception 'Historical dish category cannot be changed in place' using errcode='23514'; end if;
  return new;
end $f$;
create trigger projection_lifecycle_category before update of style_category on public.projection_dishes
  for each row execute function projection_private.guard_lifecycle_category();

-- Backfill under the same lock discipline; never infer onboarding launches from created_at.
lock table public.menu_items in share row exclusive mode;
do $b$
declare r record; e uuid; payload jsonb;
begin
  for r in select * from public.menu_items order by restaurant_id,id loop
    e:=gen_random_uuid(); payload:=jsonb_build_object('id',r.id,'restaurant_id',r.restaurant_id,'created_at',r.created_at,'archived_at',r.archived_at);
    begin
      insert into public.projection_menu_events values(e,r.restaurant_id,r.id,r.created_at,'backfill',payload,'{}',false);
      perform projection_private.apply_menu_event(e);
    exception when others then
      insert into public.projection_menu_repairs(id,restaurant_id,menu_item_id,observed_at,operation,source_row,error_code)
        values(e,r.restaurant_id,r.id,r.created_at,'backfill',payload,sqlstate);
    end;
  end loop;
end $b$;
create trigger projection_menu_lifecycle after insert or update of archived_at on public.menu_items
  for each row execute function projection_private.capture_menu_event();

create function projection_private.lifecycle_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language plpgsql stable set search_path='' set timezone='UTC' as $f$
declare result jsonb; settings jsonb; g public.projection_setting_versions; o public.projection_setting_versions;
  r public.restaurants; first_day date; model public.projection_model_versions;
begin
  select * into strict r from public.restaurants where id=p_restaurant_id;
  if p_as_of is null or p_snapshot_at is null then raise exception 'Explicit date and snapshot time are required'; end if;
  if r.operational_timezone is null or not exists(select 1 from pg_timezone_names where name=r.operational_timezone) then
    raise exception 'Configure a valid operational timezone'; end if;
  if exists(select 1 from public.projection_menu_repairs where restaurant_id=p_restaurant_id) then raise exception 'Menu availability repairs are pending'; end if;
  select * into strict model from public.projection_model_versions where model_major=4;
  select * into strict g from public.projection_setting_versions where restaurant_id is null and model_major=4
    and effective_at<=p_snapshot_at order by effective_at desc limit 1;
  select * into o from public.projection_setting_versions where restaurant_id=p_restaurant_id and model_major=4
    and effective_at<=p_snapshot_at order by effective_at desc limit 1;
  settings:=g.settings||coalesce(o.settings,'{}');
  if not settings ? 'minimum_return_gap_days' or not projection_private.check_settings(settings) then
    raise exception 'Lifecycle needs an approved complete settings version'; end if;
  select first_data_date into first_day from public.projection_restaurant_config where restaurant_id=p_restaurant_id;
  result:=jsonb_build_object('restaurant_id',p_restaurant_id,'as_of',p_as_of,'snapshot_at',p_snapshot_at,
    'restaurant',jsonb_build_object('id',r.id,'onboarding_completed_at',r.onboarding_completed_at,'first_data_date',first_day),
    'global_version',jsonb_build_object('id',g.id,'restaurant_id',null,'model_major',g.model_major,'effective_at',g.effective_at,'settings',g.settings),
    'restaurant_version',case when o.id is null then null else jsonb_build_object('id',o.id,'restaurant_id',o.restaurant_id,'model_major',o.model_major,'effective_at',o.effective_at,'settings',o.settings) end,
    'dishes',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('menu_created_at',m.created_at,'added_business_date',
      (projection_private.pos_source_clock(p_restaurant_id,null,m.created_at)->>'business_date')::date) order by d.id)
      from public.projection_dishes d join public.menu_items m on m.id=d.menu_item_id and m.restaurant_id=d.restaurant_id
      where d.restaurant_id=p_restaurant_id and m.created_at<=p_snapshot_at),'[]'),
    'availability',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.projection_dish_availability a
      join public.projection_dishes d on d.id=a.dish_id and d.restaurant_id=a.restaurant_id
      join public.menu_items m on m.id=d.menu_item_id and m.restaurant_id=d.restaurant_id
      where a.restaurant_id=p_restaurant_id and m.created_at<=p_snapshot_at),'[]'),
    'history',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('source_covered',exists(
      select 1 from public.projection_pos_source_windows w where w.restaurant_id=n.restaurant_id
        and (w.valid_from is null or w.valid_from<=n.business_date) and (w.valid_until is null or n.business_date<w.valid_until))) order by n.business_date)
      from public.projection_nightly_flags n where n.restaurant_id=p_restaurant_id and n.business_date<p_as_of),'[]'),
    'dish_facts',coalesce((select jsonb_agg(to_jsonb(f) order by f.business_date,f.dish_id) from public.projection_nightly_dish_facts f
      where f.restaurant_id=p_restaurant_id and f.business_date<p_as_of),'[]'),
    'launch_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.projection_launch_history h where h.restaurant_id=p_restaurant_id),'[]'),
    'prior_sales',coalesce((select jsonb_agg(v order by v->>'business_date',v->>'dish_id') from (
      select distinct jsonb_build_object('restaurant_id',p_restaurant_id,'dish_id',m.dish_id,'business_date',h.business_date,
        'units',l.quantity,'external_item_id',m.external_item_id) v
      from public.projection_pos_item_map m join public.pos_tickets t on t.restaurant_id=m.restaurant_id and t.pos_system=m.pos_system
      join public.pos_ticket_lines l on l.ticket_id=t.id and l.restaurant_id=m.restaurant_id and l.item_ref=m.external_item_id
      cross join lateral(select (projection_private.pos_source_clock(p_restaurant_id,null,coalesce(l.added_at,t.closed_at,t.opened_at))->>'business_date')::date business_date) h
      where m.restaurant_id=p_restaurant_id and m.dish_id is not null and l.quantity>0
        and coalesce(l.line_type,'sale') in ('sale','comp') and coalesce(t.ticket_type,'closed')<>'void'
        and not coalesce(l.is_non_sales_revenue,false) and h.business_date<p_as_of
        and m.valid_from<=h.business_date and (m.valid_until is null or h.business_date<m.valid_until)
    ) values_read),'[]'));
  return result||jsonb_build_object('context_digest',encode(sha256(convert_to((result-'launch_history')::text,'UTF8')),'hex'));
end $f$;
create function public.projection_lifecycle_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language sql security definer set search_path='' as $f$
  select projection_private.lifecycle_context(p_restaurant_id,p_as_of,p_snapshot_at);
$f$;

create function public.projection_store_launches(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz,p_context_digest text,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare fresh jsonb; row_value jsonb; previous public.projection_launch_history; v_availability public.projection_dish_availability;
  saved integer:=0; origins integer:=0; same boolean:=true;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  if p_plan->>'restaurant_id' is distinct from p_restaurant_id::text or p_plan->>'as_of' is distinct from p_as_of::text or
    (p_plan->>'snapshot_at')::timestamptz is distinct from p_snapshot_at or
    jsonb_typeof(p_plan->'observations') is distinct from 'array' or jsonb_typeof(p_plan->'origin_corrections') is distinct from 'array' then raise exception 'Invalid lifecycle plan'; end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'observations') v group by v->>'dish_id',v->>'launch_date' having count(*)>1) then
    raise exception 'Duplicate launch observation in batch'; end if;
  fresh:=projection_private.lifecycle_context(p_restaurant_id,p_as_of,p_snapshot_at);
  if fresh->>'context_digest' is distinct from p_context_digest then
    same:=jsonb_array_length(p_plan->'observations')=0;
    for row_value in select * from jsonb_array_elements(p_plan->'origin_corrections') loop
      if not exists(select 1 from public.projection_dish_availability a where a.restaurant_id=p_restaurant_id
        and a.id=(row_value->>'id')::uuid and a.dish_id=(row_value->>'dish_id')::uuid
        and a.valid_from=(row_value->>'valid_from')::date and a.is_initial) then same:=false; end if;
    end loop;
    if same and jsonb_array_length(p_plan->'observations')+jsonb_array_length(p_plan->'origin_corrections')>0 then
      return jsonb_build_object('saved',0,'origin_corrections',0,'retry',true); end if;
    raise exception 'Lifecycle context changed; reload and retry' using errcode='PT409';
  end if;
  for row_value in select * from jsonb_array_elements(p_plan->'origin_corrections') loop
    select * into strict v_availability from public.projection_dish_availability where restaurant_id=p_restaurant_id
      and id=(row_value->>'id')::uuid and dish_id=(row_value->>'dish_id')::uuid for update;
    if not exists(select 1 from jsonb_array_elements(fresh->'prior_sales') p where p->>'dish_id'=row_value->>'dish_id'
      and p->>'business_date'=row_value->>'valid_from') then raise exception 'Missing prior-sales evidence'; end if;
    delete from public.projection_dish_availability where id=v_availability.id;
    insert into public.projection_dish_availability(id,restaurant_id,dish_id,valid_from,valid_until,is_initial,lifecycle_context)
      values(v_availability.id,v_availability.restaurant_id,v_availability.dish_id,(row_value->>'valid_from')::date,v_availability.valid_until,true,
        v_availability.lifecycle_context||jsonb_build_object('inferred_existing_from_prior_sales',true,'prior_sale',row_value->'prior_sale'));
    origins:=origins+1;
  end loop;
  for row_value in select * from jsonb_array_elements(p_plan->'observations') loop
    if row_value->>'restaurant_id' is distinct from p_restaurant_id::text or
      (row_value->>'observed_through')::date>=p_as_of or
      (row_value->>'observed_through')::date<>(row_value->>'launch_date')::date+27 or
      coalesce(row_value->'trace'->>'inputs_digest','')!~'^[a-f0-9]{64}$' then raise exception 'Invalid launch observation'; end if;
    if not exists(select 1 from public.projection_dishes d join public.projection_dish_availability a
      on a.restaurant_id=d.restaurant_id and a.dish_id=d.id where d.restaurant_id=p_restaurant_id
      and d.id=(row_value->>'dish_id')::uuid and d.forecastable and d.style_category=row_value->>'style_category'
      and a.valid_from=(row_value->>'launch_date')::date and (a.valid_until is null or a.valid_until>(row_value->>'observed_through')::date)) then
      raise exception 'Launch observation does not match scoped availability'; end if;
    select * into previous from public.projection_current_launch_history where restaurant_id=p_restaurant_id
      and dish_id=(row_value->>'dish_id')::uuid and launch_date=(row_value->>'launch_date')::date;
    if previous.id is not null and previous.trace->>'inputs_digest'=row_value->'trace'->>'inputs_digest' then continue; end if;
    insert into public.projection_launch_history(restaurant_id,dish_id,style_category,launch_date,observed_through,
      existing_dishes,first_four_week_share,launch_index,trace,supersedes_id,created_at)
    values(p_restaurant_id,(row_value->>'dish_id')::uuid,row_value->>'style_category',(row_value->>'launch_date')::date,
      (row_value->>'observed_through')::date,(row_value->>'existing_dishes')::integer,
      (row_value->>'first_four_week_share')::numeric,(row_value->>'launch_index')::numeric,row_value->'trace',previous.id,clock_timestamp());
    saved:=saved+1;
  end loop;
  return jsonb_build_object('saved',saved,'origin_corrections',origins,'retry',saved=0 and origins=0);
end $f$;

-- Extend the current purge, preserving calendar tables and the anonymous purge log.
do $b$
declare definition text;
begin
  definition:=pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure);
  if strpos(definition,'''projection_dish_availability'',')=0 then raise exception 'Unexpected purge definition'; end if;
  definition:=replace(definition,'''projection_dish_availability'',',
    '''projection_menu_repairs'',''projection_menu_events'',''projection_dish_availability'',');
  execute definition;
end $b$;
revoke all on function projection_private.apply_menu_event(uuid),projection_private.capture_menu_event(),
  projection_private.guard_lifecycle_category(),projection_private.lifecycle_context(uuid,date,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.projection_repair_menu(uuid),public.projection_lifecycle_context(uuid,date,timestamptz),
  public.projection_store_launches(uuid,date,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.projection_repair_menu(uuid),public.projection_lifecycle_context(uuid,date,timestamptz),
  public.projection_store_launches(uuid,date,timestamptz,text,jsonb) to service_role;
revoke insert on public.projection_launch_history from service_role;
notify pgrst,'reload schema';
commit;