begin;

-- Learning and forecast-factor contexts share one consistent source snapshot.
create function projection_private.holiday_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language plpgsql stable set search_path='' set timezone='UTC' as $f$
declare ctx jsonb; result jsonb; first_day date; g public.projection_setting_versions; o public.projection_setting_versions;
begin
  if p_as_of is null or p_snapshot_at is null then raise exception 'Explicit holiday date and snapshot time are required'; end if;
  select first_data_date into first_day from public.projection_restaurant_config where restaurant_id=p_restaurant_id;
  ctx:=projection_private.calendar_context(p_restaurant_id,p_as_of,null,p_snapshot_at);
  ctx:=projection_private.calendar_context(p_restaurant_id,coalesce(first_day,(select min(business_date) from public.projection_nightly_flags
    where restaurant_id=p_restaurant_id),p_as_of),p_as_of+(ctx->'settings'->>'horizon_days')::integer-1,p_snapshot_at);
  if (ctx->>'model_major')::integer<>4 then raise exception 'Holiday learning supports model major 4'; end if;
  select * into strict g from public.projection_setting_versions where id=(ctx->>'global_version_id')::uuid;
  select * into o from public.projection_setting_versions where id=(ctx->>'restaurant_version_id')::uuid;
  ctx:=ctx||jsonb_build_object('today',p_as_of,
    'history',coalesce((select jsonb_agg(v order by v->>'business_date') from jsonb_array_elements(ctx->'history') v
      where (v->>'business_date')::date<p_as_of),'[]'),
    'versions',coalesce((select jsonb_agg(v order by (v->>'revision')::bigint) from jsonb_array_elements(ctx->'versions') v
      where v->>'recorded_at' is null or (v->>'recorded_at')::timestamptz<=p_snapshot_at),'[]'));
  result:=jsonb_build_object('restaurant_id',p_restaurant_id,'as_of',p_as_of,'snapshot_at',p_snapshot_at,
    'first_data_date',first_day,'calendar_context',ctx,
    'global_version',to_jsonb(g),'restaurant_version',case when o.id is null then null else to_jsonb(o) end,
    'model_version',(select to_jsonb(m) from public.projection_model_versions m where model_major=4),
    'history',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object(
      'closed',n.complete and n.total_units<=(ctx->>'closure_conflict_threshold_units')::numeric,'early_close',false,
      'holiday_keys',coalesce((select jsonb_agg(h.holiday_key order by h.holiday_key collate "C")
        from public.projection_holiday_calendar h where h.holiday_date=n.business_date),'[]'),
      'source_covered',exists(select 1 from public.projection_pos_source_windows w where w.restaurant_id=p_restaurant_id
        and (w.valid_from is null or w.valid_from<=n.business_date) and (w.valid_until is null or n.business_date<w.valid_until))) order by n.business_date)
      from public.projection_nightly_flags n where n.restaurant_id=p_restaurant_id and n.business_date<p_as_of),'[]'),
    'archives',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'restaurant_id',r.restaurant_id,'run_date',r.run_date,
      'target_date',n.target_date,'issued_at',r.issued_at,'supersedes_id',r.supersedes_id,'source_through',r.source_through,
      'availability',n.availability,'volume',n.trace->'volume','settings_snapshot',r.settings_snapshot,'settings_digest',r.settings_digest,
      'global_version_id',r.global_version_id,'restaurant_version_id',r.restaurant_version_id,'model_version',to_jsonb(m)) order by r.id)
      from public.projection_forecast_runs r join public.projection_forecast_nights n on n.restaurant_id=r.restaurant_id and n.run_id=r.id
      join public.projection_model_versions m on m.model_major=r.model_major
      where r.restaurant_id=p_restaurant_id and r.model_major=4 and r.run_date=n.target_date
        and r.run_date<p_as_of and r.issued_at<=p_snapshot_at),'[]'),
    'observations',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.projection_holiday_observations h
      where h.restaurant_id=p_restaurant_id),'[]'));
  return result||jsonb_build_object('context_digest',encode(sha256(convert_to((result-'observations')::text,'UTF8')),'hex'));
end $f$;
create function public.projection_holiday_context(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz)
returns jsonb language sql security definer set search_path='' as $f$
  select projection_private.holiday_context(p_restaurant_id,p_as_of,p_snapshot_at);
$f$;

create function public.projection_store_holidays(p_restaurant_id uuid,p_as_of date,p_snapshot_at timestamptz,p_context_digest text,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare fresh jsonb; item jsonb; source jsonb; previous public.projection_holiday_observations; keys text[]; expected_keys text[];
  saved integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:'||p_restaurant_id::text,0));
  if p_plan->>'restaurant_id' is distinct from p_restaurant_id::text or p_plan->>'as_of' is distinct from p_as_of::text or
    (p_plan->>'snapshot_at')::timestamptz is distinct from p_snapshot_at or jsonb_typeof(p_plan->'observations') is distinct from 'array' then
    raise exception 'Invalid holiday learning plan'; end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'observations') v group by v->>'business_date' having count(*)>1) then
    raise exception 'Duplicate holiday date in batch'; end if;
  fresh:=projection_private.holiday_context(p_restaurant_id,p_as_of,p_snapshot_at);
  if fresh->>'context_digest' is distinct from p_context_digest then raise exception 'Holiday context changed; reload and retry' using errcode='PT409'; end if;
  for item in select * from jsonb_array_elements(p_plan->'observations') loop
    select v into source from jsonb_array_elements(fresh->'history') v where v->>'business_date'=item->>'business_date';
    if item->>'restaurant_id' is distinct from p_restaurant_id::text or source is null or (source->>'business_date')::date>=p_as_of
      or not (source->>'complete')::boolean or not (source->>'source_covered')::boolean or (source->>'closed')::boolean then
      raise exception 'Holiday observation requires a scoped complete open source night'; end if;
    select array_agg(v order by ordinality) into keys from jsonb_array_elements_text(item->'holiday_keys') with ordinality as x(v,ordinality);
    if exists(select 1 from jsonb_array_elements(fresh->'calendar_context'->'holiday_answers') a
      where a->>'business_date'=item->>'business_date' and a->>'answer'='early_close') then expected_keys:=array['early_close'];
    else select array_agg(v order by v collate "C") into expected_keys from jsonb_array_elements_text(source->'holiday_keys') as x(v); end if;
    if jsonb_typeof(item->'observed_ratio') is distinct from 'number' or keys is null or keys is distinct from expected_keys or coalesce(item->'trace'->>'inputs_digest','')!~'^[a-f0-9]{64}$'
      or (item->'trace'->>'actual_units')::numeric is distinct from (source->>'total_units')::numeric
      or coalesce(item->'trace'->>'L_source','') not in ('archived','reconstructed')
      or jsonb_typeof(item->'trace'->'normal_L') is distinct from 'number'
      or (item->'trace'->>'normal_L')::numeric<=0 or (item->'trace'->>'model_major')::integer is distinct from 4
      or (item->'trace'->>'ratio')::numeric is distinct from (item->>'observed_ratio')::numeric then
      raise exception 'Invalid holiday observation identity or trace'; end if;
    if item->'trace'->>'L_source'='archived' then
      if not exists(select 1 from jsonb_array_elements(fresh->'archives') a where a->>'id'=item->'trace'->>'archive_id'
        and a->>'run_date'=item->>'business_date' and a->>'availability'<>'needs_baseline'
        and not exists(select 1 from jsonb_array_elements(fresh->'archives') child where child->>'supersedes_id'=a->>'id')
        and (a->'volume'->'recent'->>'L')::numeric=(item->'trace'->>'normal_L')::numeric
        and a->>'global_version_id'=item->'trace'->'baseline_provenance'->>'global_version_id') then
        raise exception 'Archived normal L provenance does not match'; end if;
    elsif exists(select 1 from jsonb_array_elements(fresh->'archives') a where a->>'run_date'=item->>'business_date') then
      raise exception 'An archived day-of normal L must take precedence';
    end if;
    select * into previous from public.projection_current_holiday_observations where restaurant_id=p_restaurant_id
      and business_date=(item->>'business_date')::date;
    if previous.id is not null and previous.trace->>'inputs_digest'=item->'trace'->>'inputs_digest' then continue; end if;
    insert into public.projection_holiday_observations(restaurant_id,business_date,holiday_keys,observed_ratio,trace,supersedes_id,created_at)
      values(p_restaurant_id,(item->>'business_date')::date,keys,(item->>'observed_ratio')::numeric,item->'trace',previous.id,clock_timestamp());
    saved:=saved+1;
  end loop;
  return jsonb_build_object('saved',saved,'retry',saved=0);
end $f$;

do $b$
begin
  if strpos(pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure),'projection_holiday_observations')=0 then
    raise exception 'Account purge must include holiday observations'; end if;
  if exists(select 1 from public.projection_holiday_rule_versions where restaurant_id is null
    and holiday_key in ('thanksgiving_day','christmas_day') and default_factor<>1) then
    raise exception 'Reopened closed-default holidays must retain their neutral 1.0 default'; end if;
end $b$;
revoke all on function projection_private.holiday_context(uuid,date,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.projection_holiday_context(uuid,date,timestamptz),public.projection_store_holidays(uuid,date,timestamptz,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.projection_holiday_context(uuid,date,timestamptz),public.projection_store_holidays(uuid,date,timestamptz,text,jsonb) to service_role;
revoke insert on public.projection_holiday_observations from service_role;
notify pgrst,'reload schema';
commit;