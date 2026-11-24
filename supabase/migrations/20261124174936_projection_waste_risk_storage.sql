begin;

do $$declare d text; begin
  d:=pg_get_functiondef('projection_private.check_settings(jsonb,boolean)'::regprocedure);
  execute replace(d,'FUNCTION projection_private.check_settings(',
    'FUNCTION projection_private.check_settings_before_waste_risk(');
end$$;
create or replace function projection_private.check_settings(p jsonb,partial boolean default false)
returns boolean language sql immutable set search_path='' as $$
  select projection_private.check_settings_before_waste_risk(p-'waste_recipe_uncovered_share_max',partial)
  and case when not p?'waste_recipe_uncovered_share_max' then true
    when jsonb_typeof(p->'waste_recipe_uncovered_share_max')='number'
    then (p->>'waste_recipe_uncovered_share_max')::numeric between 0 and 1 else false end;
$$;
revoke all on function projection_private.check_settings_before_waste_risk(jsonb,boolean),
  projection_private.check_settings(jsonb,boolean) from public,anon,authenticated,service_role;

do $$begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-settings:4',0));
  insert into public.projection_setting_versions(model_major,effective_at,settings)
  select 4,greatest(clock_timestamp(),effective_at+interval '1 microsecond'),
    settings||'{"waste_recipe_uncovered_share_max":0.10}'::jsonb
  from public.projection_setting_versions where restaurant_id is null and model_major=4
  order by effective_at desc limit 1;
end$$;

create table public.waste_projection_state(
  restaurant_id uuid primary key references public.restaurants(id),
  version bigint not null default 0 check(version>=0),
  inventory_cutoff date,
  latest_assessment_id uuid
);
create table public.waste_projection_corrections(
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id),
  request_id uuid not null,
  actor_id uuid not null,
  authorized_at timestamptz not null default clock_timestamp(),
  reason text not null check(reason in ('invoice_quantity_or_date','physical_count',
    'confirmed_disposal','storage_or_shelf_life','dish_removal','confirmed_closure')),
  record jsonb not null check(jsonb_typeof(record)='object'),
  unique(restaurant_id,request_id),unique(restaurant_id,id)
);
create table public.waste_projection_assessments(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  request_id uuid not null,
  assessment_date date not null,
  inventory_cutoff date not null check(inventory_cutoff<assessment_date),
  state_version bigint not null,
  saved_at timestamptz not null default clock_timestamp(),
  input jsonb not null,
  input_digest text not null check(input_digest~'^[0-9a-f]{64}$'),
  result jsonb not null,
  correction_id uuid,
  unique(restaurant_id,request_id),unique(restaurant_id,id),
  foreign key(restaurant_id,correction_id) references public.waste_projection_corrections(restaurant_id,id)
);
create table public.waste_projection_cases(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  batch_id uuid not null,
  record jsonb not null,
  assessment_id uuid not null,
  supersedes_id uuid unique,
  unique(restaurant_id,batch_id,id),
  foreign key(restaurant_id,assessment_id) references public.waste_projection_assessments(restaurant_id,id),
  foreign key(restaurant_id,batch_id,supersedes_id) references public.waste_projection_cases(restaurant_id,batch_id,id)
);
create unique index waste_projection_case_root on public.waste_projection_cases(restaurant_id,batch_id)
  where supersedes_id is null;
create table public.waste_projection_demands(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  ingredient_id uuid not null,
  business_date date not null,
  record jsonb not null,
  assessment_id uuid not null,
  supersedes_id uuid unique,
  unique(restaurant_id,ingredient_id,business_date,id),
  foreign key(restaurant_id,assessment_id) references public.waste_projection_assessments(restaurant_id,id),
  foreign key(restaurant_id,ingredient_id,business_date,supersedes_id)
    references public.waste_projection_demands(restaurant_id,ingredient_id,business_date,id)
);
create unique index waste_projection_demand_root
  on public.waste_projection_demands(restaurant_id,ingredient_id,business_date) where supersedes_id is null;
create index waste_projection_assessment_recent
  on public.waste_projection_assessments(restaurant_id,assessment_date desc,saved_at desc);

do $$declare t text; begin
  foreach t in array array['waste_projection_state','waste_projection_corrections',
    'waste_projection_assessments','waste_projection_cases','waste_projection_demands'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    if t<>'waste_projection_state' then
      execute format('create trigger %I before update or delete on public.%I for each row execute function projection_private.immutable_row()',t||'_immutable',t);
    end if;
  end loop;
end$$;

create function public.waste_projection_read(target uuid,cutoff date,batch_ids uuid[],at_time timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',coalesce(s.version,0),'inventory_cutoff',s.inventory_cutoff,
    'globalVersion',(select to_jsonb(v) from public.projection_setting_versions v
      where v.restaurant_id is null and v.model_major=4 and v.effective_at<=at_time
      order by v.effective_at desc limit 1),
    'restaurantVersion',(select to_jsonb(v) from public.projection_setting_versions v
      where v.restaurant_id=target and v.model_major=4 and v.effective_at<=at_time
      order by v.effective_at desc limit 1),
    'frozen',jsonb_build_object('demands',coalesce((select jsonb_agg(d.record order by d.ingredient_id,d.business_date)
      from public.waste_projection_demands d where d.restaurant_id=target and d.business_date>cutoff
      and not exists(select 1 from public.waste_projection_demands n where n.supersedes_id=d.id)),'[]'::jsonb),
      'cases',coalesce((select jsonb_agg(c.record order by c.batch_id)
      from public.waste_projection_cases c where c.restaurant_id=target
      and ((c.record->>'coverage_through')::date>cutoff or (c.record->>'use_by_date')::date>cutoff or c.batch_id=any(batch_ids))
      and not exists(select 1 from public.waste_projection_cases n where n.supersedes_id=c.id)),'[]'::jsonb)))
  from public.restaurants r left join public.waste_projection_state s on s.restaurant_id=r.id where r.id=target;
$$;

-- Trusted server snapshots only. The later inventory/archive reader owns input
-- normalization. This RPC authorizes immutable state, provenance and corrections;
-- it does not recalculate physical inventory or the projection model in SQL.
create function public.waste_projection_commit(target uuid,request_id uuid,expected_version bigint,
  snapshot jsonb,outcome jsonb,correction jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved public.waste_projection_assessments;
  g public.projection_setting_versions; o public.projection_setting_versions;
  current_state jsonb; old_record jsonb; row_value jsonb; part jsonb; before_basis jsonb;
  prior_id uuid; assessment_id uuid:=gen_random_uuid(); correction_id uuid;
  ids uuid[]; actor uuid; kind text; table_name text;
  input_copy jsonb:=snapshot-'frozen'; result_copy jsonb:=outcome-'frozen';
  cutoff date:=(snapshot->>'inventoryCutoff')::date;
  assessed_at timestamptz:=(snapshot->>'assessedAt')::timestamptz;
  weighted double precision;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:waste-projection:'||target::text,0));
  select * into saved from public.waste_projection_assessments a
    where a.restaurant_id=target and a.request_id=waste_projection_commit.request_id;
  if found then
    if saved.input is distinct from input_copy or
      saved.correction_id is distinct from (correction->>'id')::uuid or
      (select c.record from public.waste_projection_corrections c where c.id=saved.correction_id) is distinct from correction then
      raise exception 'Waste assessment request changed' using errcode='PT409';
    end if;
    return jsonb_build_object('assessment_id',saved.id,'version',saved.state_version,'duplicate',true);
  end if;
  if snapshot->>'restaurantId' is distinct from target::text or
    outcome->>'restaurant_id' is distinct from target::text or
    outcome->>'inventory_cutoff' is distinct from snapshot->>'inventoryCutoff' or
    outcome->>'assessment_date' is distinct from snapshot->>'assessmentDate' or
    outcome->>'assessed_at' is distinct from snapshot->>'assessedAt' or
    snapshot->'inventoryComplete' is distinct from 'true'::jsonb or
    cutoff>=(snapshot->>'assessmentDate')::date or assessed_at>clock_timestamp() then
    raise exception 'Invalid waste assessment scope' using errcode='23514';
  end if;
  perform 1 from public.projection_restaurant_config where restaurant_id=target and enabled;
  if not found then raise exception 'Waste projections disabled' using errcode='PT410'; end if;
  select array_agg((b->>'id')::uuid) into ids from jsonb_array_elements(snapshot->'batches') b;
  current_state:=public.waste_projection_read(target,cutoff,coalesce(ids,'{}'),assessed_at);
  if current_state is null or (current_state->>'version')::bigint<>expected_version or
    (current_state->>'inventory_cutoff')::date>cutoff then
    raise exception 'Waste state changed; reload and calculate again' using errcode='PT409';
  end if;
  g:=jsonb_populate_record(null::public.projection_setting_versions,current_state->'globalVersion');
  o:=jsonb_populate_record(null::public.projection_setting_versions,nullif(current_state->'restaurantVersion','null'::jsonb));
  if g.id is null or not g.settings?'waste_recipe_uncovered_share_max' or
    snapshot#>>'{resolvedSettings,global_version_id}' is distinct from g.id::text or
    snapshot#>>'{resolvedSettings,restaurant_version_id}' is distinct from o.id::text or
    snapshot#>'{resolvedSettings,settings}' is distinct from g.settings||coalesce(o.settings,'{}') or
    snapshot#>>'{resolvedSettings,restaurant_id}' is distinct from target::text then
    raise exception 'Stored waste settings required' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements(snapshot->'ingredients') x where x->>'restaurant_id' is distinct from target::text)
    or exists(select 1 from jsonb_array_elements(snapshot->'batches') x where x->>'restaurant_id' is distinct from target::text)
    or exists(select 1 from jsonb_array_elements(snapshot->'recipes') x where x->>'restaurant_id' is distinct from target::text) then
    raise exception 'Foreign waste input' using errcode='42501';
  end if;
  if correction is not null then
    correction_id:=(correction->>'id')::uuid; actor:=(correction->>'actor_id')::uuid; kind:=correction->>'reason';
    if correction->>'restaurant_id' is distinct from target::text or correction_id is null or
      nullif(btrim(correction->>'source_event_id'),'') is null or
      not (exists(select 1 from public.profiles where id=actor and role='admin') or
        exists(select 1 from public.restaurants where id=target and user_id=actor)) or
      exists(select 1 from jsonb_array_elements_text(correction->'batch_ids') b where not exists(
        select 1 from jsonb_array_elements(snapshot->'batches') x where x->>'id'=b)) or
      exists(select 1 from jsonb_array_elements_text(correction->'ingredient_ids') i where not exists(
        select 1 from jsonb_array_elements(snapshot->'ingredients') x where x->>'id'=i)) or
      exists(select 1 from jsonb_array_elements_text(correction->'dish_ids') d where not exists(
        select 1 from public.projection_dishes pd where pd.restaurant_id=target and pd.id=d::uuid)) or
      exists(select 1 from jsonb_array_elements_text(correction->'business_dates') d where d::date<=cutoff) then
      raise exception 'Unauthorized waste reassessment' using errcode='42501';
    end if;
    insert into public.waste_projection_corrections(id,restaurant_id,request_id,actor_id,reason,record)
      values(correction_id,target,request_id,actor,kind,correction);
  end if;
  -- Every loaded record must survive, unchanged unless an explicitly scoped
  -- correction authorizes its replacement. Omission is not a reset operation.
  foreach table_name in array array['cases','demands'] loop
    for old_record in select value from jsonb_array_elements(current_state#>array['frozen',table_name]) loop
      select x into row_value from jsonb_array_elements(outcome#>array['frozen',table_name]) x
      where case when table_name='cases' then x->>'batch_id'=old_record->>'batch_id'
        else x->>'ingredient_id'=old_record->>'ingredient_id' and x->>'business_date'=old_record->>'business_date' end;
      if row_value is null then raise exception 'Frozen state omitted' using errcode='23514'; end if;
      if row_value=old_record then continue; end if;
      if correction_id is null then
        if table_name='cases' and
          row_value-array['digest','coverage_through']=old_record-array['digest','coverage_through'] and
          (row_value->>'coverage_through')::date between (old_record->>'coverage_through')::date and (old_record->>'use_by_date')::date and
          exists(select 1 from public.waste_projection_corrections c where c.restaurant_id=target
            and c.id=(old_record->>'last_correction_id')::uuid and c.reason in ('invoice_quantity_or_date','storage_or_shelf_life')
            and c.record->'batch_ids' ? (old_record->>'batch_id')) then continue;
        end if;
        raise exception 'Frozen state is immutable' using errcode='42501';
      end if;
      if table_name='cases' then
        if not correction->'batch_ids' ? (row_value->>'batch_id') or
          row_value-array['digest','received_date','use_by_date','coverage_through','baseline_at','last_correction_id']
          is distinct from old_record-array['digest','received_date','use_by_date','coverage_through','baseline_at','last_correction_id'] or
          ((row_value->>'received_date' is distinct from old_record->>'received_date' or
            row_value->>'use_by_date' is distinct from old_record->>'use_by_date') and
            kind not in ('invoice_quantity_or_date','storage_or_shelf_life')) or
          (row_value->>'coverage_through')::date<(old_record->>'coverage_through')::date or
          (row_value->>'coverage_through')::date>greatest((old_record->>'coverage_through')::date,(row_value->>'use_by_date')::date) then
          raise exception 'Correction exceeds batch scope' using errcode='42501';
        end if;
      else
        if kind not in ('confirmed_closure','dish_removal') or
          not correction->'ingredient_ids' ? (row_value->>'ingredient_id') or
          not correction->'business_dates' ? (row_value->>'business_date') or
          row_value-array['digest','basis','quantity','last_correction_id','reassessed_at']
          is distinct from old_record-array['digest','basis','quantity','last_correction_id','reassessed_at'] then
          raise exception 'Correction exceeds demand scope' using errcode='42501';
        end if;
        before_basis:=old_record->'basis';
        if kind='confirmed_closure' then before_basis:=jsonb_set(before_basis,'{night_low}','0');
        else
          before_basis:=jsonb_set(before_basis,'{contributions}',coalesce((select jsonb_agg(c order by ord)
            from jsonb_array_elements(before_basis->'contributions') with ordinality t(c,ord)
            where not correction->'dish_ids' ? (c->>'dish_id')),'[]'));
          before_basis:=jsonb_set(before_basis,'{uncovered_dishes}',coalesce((select jsonb_agg(c order by ord)
            from jsonb_array_elements(before_basis->'uncovered_dishes') with ordinality t(c,ord)
            where not correction->'dish_ids' ? (c->>'dish_id')),'[]'));
          weighted:=0;
          for part in select value from jsonb_array_elements(before_basis->'contributions') loop
            weighted:=weighted+(part->>'share')::float8*(part->>'portion')::float8;
          end loop;
          before_basis:=jsonb_set(before_basis,'{weighted_portion}',to_jsonb(weighted));
          weighted:=0;
          for part in select value from jsonb_array_elements(before_basis->'uncovered_dishes') loop
            weighted:=weighted+(part->>'share')::float8;
          end loop;
          before_basis:=jsonb_set(before_basis,'{uncovered_share}',to_jsonb(weighted));
          before_basis:=jsonb_set(before_basis,'{may_be_overstated}',to_jsonb(weighted>0));
        end if;
        if row_value->'basis' is distinct from before_basis or
          (row_value->>'quantity')::float8 is distinct from
          (before_basis->>'night_low')::float8*(before_basis->>'weighted_portion')::float8 then
          raise exception 'Correction cannot replace the archived forecast' using errcode='42501';
        end if;
      end if;
    end loop;
  end loop;
  insert into public.waste_projection_assessments(id,restaurant_id,request_id,assessment_date,inventory_cutoff,
    state_version,input,input_digest,result,correction_id) values(assessment_id,target,request_id,(snapshot->>'assessmentDate')::date,
    cutoff,expected_version+1,input_copy,encode(sha256(convert_to(input_copy::text,'UTF8')),'hex'),result_copy,correction_id);
  for row_value in select value from jsonb_array_elements(outcome#>'{frozen,cases}') loop
    if row_value->>'restaurant_id' is distinct from target::text then
      raise exception 'Foreign frozen case' using errcode='42501'; end if;
    select id,record into prior_id,old_record from public.waste_projection_cases c where c.restaurant_id=target
      and c.batch_id=(row_value->>'batch_id')::uuid and not exists(select 1 from public.waste_projection_cases n where n.supersedes_id=c.id);
    if old_record=row_value then continue; end if;
    if prior_id is not null and not exists(select 1 from jsonb_array_elements(current_state#>'{frozen,cases}') c
      where c->>'batch_id'=row_value->>'batch_id') then
      raise exception 'Frozen case outside loaded scope' using errcode='42501'; end if;
    if prior_id is null and not exists(select 1 from jsonb_array_elements(snapshot->'batches') b
      where b->>'id'=row_value->>'batch_id' and b->>'ingredient_id'=row_value->>'ingredient_id'
      and b->>'received_date'=row_value->>'received_date' and b->>'use_by_date'=row_value->>'use_by_date') then
      raise exception 'New case batch mismatch' using errcode='23514'; end if;
    insert into public.waste_projection_cases(restaurant_id,batch_id,record,assessment_id,supersedes_id)
      values(target,(row_value->>'batch_id')::uuid,row_value,assessment_id,prior_id);
  end loop;
  for row_value in select value from jsonb_array_elements(outcome#>'{frozen,demands}') loop
    if row_value->>'restaurant_id' is distinct from target::text or (row_value->>'business_date')::date<=cutoff or
      (row_value->>'quantity')::float8 is distinct from (row_value#>>'{basis,night_low}')::float8*(row_value#>>'{basis,weighted_portion}')::float8 then
      raise exception 'Invalid frozen demand' using errcode='23514'; end if;
    select id,record into prior_id,old_record from public.waste_projection_demands d where d.restaurant_id=target
      and d.ingredient_id=(row_value->>'ingredient_id')::uuid and d.business_date=(row_value->>'business_date')::date
      and not exists(select 1 from public.waste_projection_demands n where n.supersedes_id=d.id);
    if old_record=row_value then continue; end if;
    if prior_id is not null and correction_id is null then
      raise exception 'Frozen state is immutable' using errcode='42501'; end if;
    if not exists(select 1 from public.waste_projection_cases c where c.restaurant_id=target
      and c.batch_id=(row_value->>'frozen_by_batch_id')::uuid
      and c.record->>'ingredient_id'=row_value->>'ingredient_id') then
      raise exception 'Frozen demand owner mismatch' using errcode='23514'; end if;
    if prior_id is null then
      perform 1 from public.projection_forecast_runs r join public.projection_forecast_nights n
        on n.restaurant_id=r.restaurant_id and n.run_id=r.id where r.restaurant_id=target
        and r.id=(row_value#>>'{basis,run_id}')::uuid and n.target_date=(row_value->>'business_date')::date
        and r.run_date=(row_value#>>'{basis,run_date}')::date
        and r.model_major=(row_value#>>'{basis,model_major}')::int and r.calibration_key=row_value#>>'{basis,calibration_key}'
        and r.issued_at<=(row_value->>'frozen_at')::timestamptz
        and r.issued_at=(row_value#>>'{basis,issued_at}')::timestamptz and r.source_through=(row_value#>>'{basis,source_through}')::date
        and n.low::float8=(row_value#>>'{basis,night_low}')::float8;
      if not found then raise exception 'Frozen archive provenance mismatch' using errcode='23514'; end if;
      for part in select value from jsonb_array_elements(row_value#>'{basis,contributions}') loop
        perform 1 from public.projection_forecast_dishes d where d.restaurant_id=target
          and d.run_id=(row_value#>>'{basis,run_id}')::uuid and d.target_date=(row_value->>'business_date')::date
          and d.dish_id=(part->>'dish_id')::uuid and d.share::float8=(part->>'share')::float8;
        if not found then raise exception 'Frozen dish share mismatch' using errcode='23514'; end if;
      end loop;
    end if;
    insert into public.waste_projection_demands(restaurant_id,ingredient_id,business_date,record,assessment_id,supersedes_id)
      values(target,(row_value->>'ingredient_id')::uuid,(row_value->>'business_date')::date,row_value,assessment_id,prior_id);
  end loop;
  insert into public.waste_projection_state(restaurant_id,version,inventory_cutoff,latest_assessment_id)
    values(target,expected_version+1,cutoff,assessment_id)
    on conflict(restaurant_id) do update set version=excluded.version,inventory_cutoff=excluded.inventory_cutoff,
      latest_assessment_id=excluded.latest_assessment_id;
  return jsonb_build_object('assessment_id',assessment_id,'version',expected_version+1,'duplicate',false);
end$$;

revoke all on function public.waste_projection_read(uuid,date,uuid[],timestamptz),
  public.waste_projection_commit(uuid,uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.waste_projection_read(uuid,date,uuid[],timestamptz),
  public.waste_projection_commit(uuid,uuid,bigint,jsonb,jsonb,jsonb) to service_role;

do $$declare d text; begin
  d:=pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure);
  if position('foreach t in array array[' in d)=0 then raise exception 'Purge hook not found'; end if;
  d:=replace(d,'foreach t in array array[',$hook$foreach t in array array[
    'waste_projection_demands','waste_projection_cases','waste_projection_assessments',
    'waste_projection_corrections','waste_projection_state',$hook$);
  execute d;
end$$;

commit;