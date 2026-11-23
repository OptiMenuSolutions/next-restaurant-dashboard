begin;

alter table public.projection_benchmark_versions
  add column benchmark_settings jsonb,
  add column census_curve jsonb,
  add column census_curve_digest text,
  add constraint projection_national_curve_bundle check (
    (benchmark_settings is null and census_curve is null and census_curve_digest is null)
    or (benchmark_settings is not null and census_curve is not null
      and census_curve_digest is not null and census_curve_digest ~ '^[a-f0-9]{64}$')
  );

create function projection_private.valid_census_settings(s jsonb)
returns boolean language sql immutable set search_path='' as $f$
  select case
    when jsonb_typeof(s) is distinct from 'object'
      or (s-'version'-'curve_method'-'census_weekday_weights')<>'{}'::jsonb
      or jsonb_typeof(s->'version') is distinct from 'number'
      or s->>'curve_method' is distinct from 'national-weekday-v1'
      or jsonb_typeof(s->'census_weekday_weights') is distinct from 'array' then false
    when (s->>'version')::numeric<1 or (s->>'version')::numeric<>trunc((s->>'version')::numeric)
      or jsonb_array_length(s->'census_weekday_weights')<>7 then false
    else coalesce((select bool_and(case when jsonb_typeof(w)='number' then
      (w#>>'{}')::numeric>0 and (w#>>'{}')::numeric<='1.7976931348623157e308'::numeric
      else false end) from jsonb_array_elements(s->'census_weekday_weights') w),false)
      and ((s->>'version')::numeric<>1 or s->'census_weekday_weights'='[1,1,1,1,1,1,1]'::jsonb)
  end;
$f$;

create function projection_private.national_census_metadata(vid uuid)
returns jsonb language sql stable set search_path='' as $f$
  select coalesce((select case when census_curve is null then '{}'::jsonb
    else jsonb_build_object('benchmark_settings',benchmark_settings,
      'national_curve',census_curve,'census_curve_digest',census_curve_digest) end
    from public.projection_benchmark_versions where id=vid),'{}'::jsonb);
$f$;

revoke all on function projection_private.valid_census_settings(jsonb),
  projection_private.national_census_metadata(uuid) from public,anon,authenticated;
grant execute on function projection_private.valid_census_settings(jsonb),
  projection_private.national_census_metadata(uuid) to service_role;

-- Guarded replacements preserve the previously applied functions and privileges.
do $patch$
declare d text; old_text text; new_text text; signature text;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-settings:4',0));
  d:=pg_get_functiondef('public.projection_stage_benchmark(jsonb)'::regprocedure);
  old_text:=$old$  for p in select value from jsonb_array_elements(doc->'pulls') loop$old$;
  new_text:=$new$  if not projection_private.valid_census_settings(doc->'benchmark_settings')
    or jsonb_typeof(doc->'census_curve') is distinct from 'object'
    or doc#>'{census_curve,benchmark_settings}' is distinct from doc->'benchmark_settings'
    or jsonb_typeof(doc#>'{census_curve,points}') is distinct from 'array'
    or coalesce(doc->>'census_curve_digest','') !~ '^[a-f0-9]{64}$'
  then raise exception 'A pinned national Census curve is required'; end if;
  if exists(select 1 from public.projection_benchmark_versions v
    where v.benchmark_settings->'version'=doc#>'{benchmark_settings,version}'
      and v.benchmark_settings is distinct from doc->'benchmark_settings')
  then raise exception 'Changed Census weights require a new benchmark settings version'; end if;

  for p in select value from jsonb_array_elements(doc->'pulls') loop$new$;
  if strpos(d,old_text)=0 then raise exception 'Unexpected benchmark staging preflight'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old$dictionary,dictionary_digest
  ) values($old$;
  new_text:=$new$dictionary,dictionary_digest,benchmark_settings,census_curve,census_curve_digest
  ) values($new$;
  if strpos(d,old_text)=0 then raise exception 'Unexpected benchmark staging columns'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old$sid,cid,doc->'dictionary',doc->>'dictionary_digest'$old$;
  new_text:=$new$sid,cid,doc->'dictionary',doc->>'dictionary_digest',
    doc->'benchmark_settings',doc->'census_curve',doc->>'census_curve_digest'$new$;
  if strpos(d,old_text)=0 then raise exception 'Unexpected benchmark staging values'; end if;
  execute replace(d,old_text,new_text);

  foreach signature in array array[
    'projection_private.benchmark_context(uuid,date,timestamptz)',
    'projection_private.archive_benchmark_context(public.projection_forecast_runs)'
  ] loop
    d:=pg_get_functiondef(signature::regprocedure);
    old_text:='projection_private.cpi_gap_metadata(v.cpi_pull_id)||jsonb_build_object(';
    new_text:='projection_private.national_census_metadata(v.id)||'||old_text;
    if strpos(d,old_text)=0 then raise exception 'Unexpected Census context: %',signature; end if;
    execute replace(d,old_text,new_text);
  end loop;

  d:=pg_get_functiondef('public.projection_approve_benchmark(uuid,text,uuid)'::regprocedure);
  old_text:='  preview:=public.projection_benchmark_preview(vid);';
  new_text:=$new$  if not exists(select 1 from public.projection_benchmark_versions v
    where v.id=vid and projection_private.valid_census_settings(v.benchmark_settings)
      and v.census_curve is not null and v.census_curve_digest is not null)
  then raise exception 'Rebuild this candidate with national Census weights'; end if;

  preview:=public.projection_benchmark_preview(vid);$new$;
  if strpos(d,old_text)=0 then raise exception 'Unexpected benchmark approval'; end if;
  execute replace(d,old_text,new_text);

  -- Listing versions does not need the full pinned monthly curve.
  d:=pg_get_functiondef('public.projection_benchmark_catalog()'::regprocedure);
  old_text:='to_jsonb(v)||jsonb_build_object';
  if strpos(d,old_text)=0 then raise exception 'Unexpected benchmark catalog'; end if;
  execute replace(d,old_text,'(to_jsonb(v)-''census_curve'')||jsonb_build_object');
end;
$patch$;

commit;