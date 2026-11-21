begin;

alter table public.projection_nightly_flags add constraint projection_outlier_status_check check (
  outlier_status in ('unchecked','normal','kept','active_run','confirmed_shift','excluded',
    'isolated_outlier','short_run','provisional','pending_review','one_off_event'));

create function projection_private.outlier_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $f$
declare h jsonb; result jsonb;
begin
  h:=projection_private.holiday_context(p_restaurant_id,p_as_of,p_snapshot_at);
  result:=jsonb_build_object('restaurant_id',p_restaurant_id,'as_of',p_as_of,'snapshot_at',p_snapshot_at,
    'first_data_date',h->'first_data_date','global_version',h->'global_version','restaurant_version',h->'restaurant_version',
    'model_version',h->'model_version',
    'history',coalesce((select jsonb_agg((v-'updated_at')||jsonb_build_object('outlier_status','unchecked',
      'flags',(v->'flags')-'outliers') order by v->>'business_date') from jsonb_array_elements(h->'history') v),'[]'),
    'archives',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'restaurant_id',r.restaurant_id,'run_date',r.run_date,
      'target_date',n.target_date,'issued_at',r.issued_at,'source_through',r.source_through,'model_major',r.model_major,
      'availability',n.availability,'expected',n.expected,'supersedes_id',r.supersedes_id) order by r.id)
      from public.projection_forecast_runs r join public.projection_forecast_nights n on n.restaurant_id=r.restaurant_id and n.run_id=r.id
      where r.restaurant_id=p_restaurant_id and r.model_major=4 and r.run_date=n.target_date and r.run_date<p_as_of and r.issued_at<=p_snapshot_at),'[]'),
    'decisions',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('member_nights',
      (select jsonb_agg(m.business_date order by m.business_date) from public.projection_run_decision_nights m
        where m.restaurant_id=p_restaurant_id and m.decision_id=d.id)) order by d.id)
      from public.projection_run_decisions d where d.restaurant_id=p_restaurant_id and d.model_major=4
        and d.decided_through<p_as_of and d.created_at<=p_snapshot_at),'[]'));
  -- Own flag/decision writes must not invalidate an identical retry. Locked decisions
  -- are checked again by the writer while holding the same restaurant lock.
  return result||jsonb_build_object('context_digest',encode(sha256(convert_to((result-'decisions')::text,'UTF8')),'hex'));
end $f$;
create function public.projection_outlier_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language sql security definer set search_path='' as $f$
  select projection_private.outlier_context(p_restaurant_id,p_as_of,p_snapshot_at);
$f$;

create function projection_private.guard_outlier_flags()
returns trigger language plpgsql set search_path='' as $f$
begin
  if (new.outlier_status,new.flags->'outliers') is not distinct from (old.outlier_status,old.flags->'outliers') then return new; end if;
  if current_setting('optimenu.projection_outliers_write',true)='on' then return new; end if;
  -- Existing ingestion invalidates derived status when source facts change.
  if new.outlier_status='unchecked' and new.source_revision is distinct from old.source_revision
    and new.flags->'outliers' is not distinct from old.flags->'outliers' then return new; end if;
  raise exception 'Outlier flags require projection_store_outliers';
end $f$;
create trigger projection_outlier_flags_guard before update on public.projection_nightly_flags
for each row execute function projection_private.guard_outlier_flags();

create function public.projection_store_outliers(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz,p_context_digest text,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare fresh jsonb; settings jsonb; item jsonb; n jsonb; meta jsonb; existing public.projection_run_decisions; owner public.projection_run_decisions;
  decision_id uuid; member date; saved integer:=0; changed integer:=0; previous_guard text;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  if p_plan->>'restaurant_id' is distinct from p_restaurant_id::text or p_plan->>'as_of' is distinct from p_as_of::text
    or (p_plan->>'snapshot_at')::timestamptz is distinct from p_snapshot_at or jsonb_typeof(p_plan->'nights') is distinct from 'array'
    or jsonb_typeof(p_plan->'candidates') is distinct from 'array' then raise exception 'Invalid outlier plan'; end if;
  fresh:=projection_private.outlier_context(p_restaurant_id,p_as_of,p_snapshot_at);
  if fresh->>'context_digest' is distinct from p_context_digest then raise exception 'Outlier source changed; reload and retry' using errcode='PT409'; end if;
  settings:=(fresh->'global_version'->'settings')||coalesce(fresh->'restaurant_version'->'settings','{}'::jsonb);
  if p_plan->'settings_snapshot' is distinct from settings then raise exception 'Outlier settings snapshot mismatch'; end if;
  if (p_plan->>'model_major') is not null then raise exception 'Use the registered model_version identity'; end if;
  if p_plan->'model_version' is distinct from fresh->'model_version'
    or p_plan->>'global_version_id' is distinct from fresh->'global_version'->>'id'
    or p_plan->>'restaurant_version_id' is distinct from fresh->'restaurant_version'->>'id'
    or coalesce(p_plan->>'settings_digest','')!~'^[a-f0-9]{64}$'
    or p_plan->>'calibration_key' is distinct from projection_private.calibration_key(4,settings) then raise exception 'Outlier version mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'nights') v group by v->>'business_date' having count(*)>1)
    or jsonb_array_length(p_plan->'nights')<>jsonb_array_length(fresh->'history') then raise exception 'Incomplete or duplicate flag batch'; end if;
  if exists(select 1 from public.projection_nightly_flags where restaurant_id=p_restaurant_id and business_date<p_as_of
    and ((flags->'outliers'->>'as_of')::date>p_as_of or
      ((flags->'outliers'->>'as_of')::date=p_as_of and (flags->'outliers'->>'snapshot_at')::timestamptz>p_snapshot_at))) then
    raise exception 'A newer outlier replay is already saved' using errcode='PT409'; end if;
  for item in select * from jsonb_array_elements(p_plan->'candidates') loop
    if item->>'decision' not in ('one_off_event','confirmed_shift') or (item->>'direction')::integer not in (-1,1)
      or (item->>'decided_through')::date>=p_as_of or jsonb_typeof(item->'member_nights') is distinct from 'array'
      or jsonb_array_length(item->'member_nights')<(settings->>'shift_run_nights')::integer
      or jsonb_typeof(item->'counterfactuals') is distinct from 'array'
      or jsonb_array_length(item->'counterfactuals')<>(settings->>'post_run_nights')::integer
      or (select count(distinct c->>'business_date') from jsonb_array_elements(item->'counterfactuals') c)<>(settings->>'post_run_nights')::integer
      or (select max((c->>'business_date')::date) from jsonb_array_elements(item->'counterfactuals') c) is distinct from (item->>'decided_through')::date
      or coalesce(item->'trace'->>'inputs_digest','')!~'^[a-f0-9]{64}$'
      or item->'trace'->>'restaurant_id' is distinct from p_restaurant_id::text
      or item->'trace'->'model_version' is distinct from p_plan->'model_version'
      or item->'trace'->'settings_snapshot' is distinct from settings
      or item->'trace'->>'calibration_key' is distinct from p_plan->>'calibration_key'
      or item->'trace'->'run'->'members' is distinct from item->'member_nights'
      or item->'trace'->'run'->>'status' is distinct from item->>'decision'
      or item->'trace'->'run'->'counterfactuals' is distinct from item->'counterfactuals' then raise exception 'Invalid final candidate'; end if;
    select * into existing from public.projection_run_decisions d where d.restaurant_id=p_restaurant_id
      and d.trace->>'inputs_digest'=item->'trace'->>'inputs_digest';
    if existing.id is not null then
      if existing.decision is distinct from item->>'decision' or existing.direction is distinct from (item->>'direction')::smallint
        or existing.decided_through is distinct from (item->>'decided_through')::date or existing.counterfactuals is distinct from item->'counterfactuals' then
        raise exception 'A final decision digest cannot change its contents'; end if;
      continue;
    end if;
    if exists(select 1 from public.projection_run_decision_nights m where m.restaurant_id=p_restaurant_id
      and m.business_date in (select value::date from jsonb_array_elements_text(item->'member_nights'))) then
      raise exception 'Final decision membership conflicts; reload saved decisions' using errcode='PT409'; end if;
    if (select count(distinct value) from jsonb_array_elements_text(item->'member_nights'))<>jsonb_array_length(item->'member_nights') then
      raise exception 'Duplicate final member'; end if;
    for n in select * from jsonb_array_elements(item->'counterfactuals') loop
      if jsonb_typeof(n->'forecast') is distinct from 'number' or (n->>'forecast')::numeric<=0
        or jsonb_typeof(n->'ratio') is distinct from 'number' or (n->>'ratio')::numeric<0
        or (n->>'business_date')::date>(item->>'decided_through')::date
        or not exists(select 1 from jsonb_array_elements(fresh->'history') src where src->>'business_date'=n->>'business_date'
          and (src->>'total_units')::numeric=(n->>'actual_units')::numeric and (src->>'complete')::boolean and (src->>'source_covered')::boolean)
        or exists(select 1 from jsonb_array_elements_text(n->'source_dates') d where d::date>=(n->>'business_date')::date
          or d in (select value from jsonb_array_elements_text(item->'member_nights'))) then raise exception 'Invalid run-free evidence'; end if;
    end loop;
    insert into public.projection_run_decisions(restaurant_id,model_major,calibration_key,direction,decision,decided_through,counterfactuals,trace)
      values(p_restaurant_id,4,p_plan->>'calibration_key',(item->>'direction')::smallint,item->>'decision',
        (item->>'decided_through')::date,item->'counterfactuals',item->'trace') returning id into decision_id;
    for member in select value::date from jsonb_array_elements_text(item->'member_nights') loop
      if member>=(item->>'decided_through')::date or not exists(select 1 from jsonb_array_elements(fresh->'history') v
        where v->>'business_date'=member::text and (v->>'complete')::boolean and (v->>'source_covered')::boolean
          and not (v->>'closed')::boolean and not (v->>'early_close')::boolean and jsonb_array_length(v->'holiday_keys')=0) then
        raise exception 'Final member is not a tested source night'; end if;
      insert into public.projection_run_decision_nights values(p_restaurant_id,member,decision_id);
    end loop;
    saved:=saved+1;
  end loop;
  previous_guard:=current_setting('optimenu.projection_outliers_write',true);
  perform set_config('optimenu.projection_outliers_write','on',true);
  for n in select * from jsonb_array_elements(p_plan->'nights') loop
    if n->>'restaurant_id' is distinct from p_restaurant_id::text or not exists(select 1 from jsonb_array_elements(fresh->'history') v
      where v->>'business_date'=n->>'business_date' and v->>'source_revision' is not distinct from n->>'source_revision'
        and v->'total_units' is not distinct from n->'total_units') then raise exception 'Unrelated or stale nightly flag'; end if;
    select d.* into owner from public.projection_run_decision_nights m join public.projection_run_decisions d
      on d.restaurant_id=m.restaurant_id and d.id=m.decision_id where m.restaurant_id=p_restaurant_id and m.business_date=(n->>'business_date')::date;
    if owner.id is not null and n->>'outlier_status' is distinct from owner.decision then raise exception 'Saved decision must retain its status' using errcode='PT409'; end if;
    meta:=jsonb_build_object('as_of',p_as_of,'snapshot_at',p_snapshot_at,'inputs_digest',p_plan->>'inputs_digest',
      'diagnostics',n->'diagnostics','forecast_id',n->'forecast_id','ratio',n->'ratio','saved_reviews',
      coalesce((select jsonb_agg((r-'candidate')||jsonb_build_object('candidate_status',r->'candidate'->'status'))
        from jsonb_array_elements(p_plan->'saved_reviews') r where r->'members' ? (n->>'business_date')),'[]'::jsonb));
    update public.projection_nightly_flags set outlier_status=n->>'outlier_status',flags=jsonb_set(flags,'{outliers}',meta),updated_at=clock_timestamp()
      where restaurant_id=p_restaurant_id and business_date=(n->>'business_date')::date
        and (outlier_status,flags->'outliers') is distinct from (n->>'outlier_status',meta);
    if found then changed:=changed+1; end if;
  end loop;
  perform set_config('optimenu.projection_outliers_write',coalesce(previous_guard,''),true);
  return jsonb_build_object('saved',saved,'flags_changed',changed,'retry',saved=0 and changed=0);
end $f$;

do $b$ begin
  if strpos(pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure),'projection_run_decisions')=0
    or strpos(pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure),'projection_run_decision_nights')=0 then
    raise exception 'Account purge must include decisions and membership'; end if;
end $b$;
revoke all on function projection_private.outlier_context(uuid,date,timestamptz),projection_private.guard_outlier_flags() from public,anon,authenticated,service_role;
revoke all on function public.projection_outlier_context(uuid,date,timestamptz),public.projection_store_outliers(uuid,date,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.projection_outlier_context(uuid,date,timestamptz),public.projection_store_outliers(uuid,date,timestamptz,text,jsonb) to service_role;
revoke insert on public.projection_run_decisions,public.projection_run_decision_nights from service_role;
notify pgrst,'reload schema';
commit;