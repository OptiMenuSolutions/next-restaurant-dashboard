begin;

create function projection_private.cpi_gap_metadata(pid uuid)
returns jsonb language sql stable set search_path='' as $metadata$
  select coalesce((
    select case when p.query_metadata->>'cpi_gap_policy' is null then '{}'::jsonb
      else jsonb_build_object(
        'cpi_gap_policy',p.query_metadata->'cpi_gap_policy',
        'cpi_interpolated',coalesce(p.query_metadata->'cpi_interpolated','[]'::jsonb)
      ) end
    from public.projection_benchmark_pulls p where p.id=pid
  ),'{}'::jsonb);
$metadata$;

create function projection_private.usable_benchmark_preview(p jsonb)
returns boolean language sql immutable set search_path='' as $usable$
  select case
    when p->>'status' is distinct from 'ok'
      or jsonb_typeof(p->'weeks') is distinct from 'array' then false
    when jsonb_array_length(p->'weeks')<>8 then false
    else coalesce((select bool_and(case
      when jsonb_typeof(w->'days') is distinct from 'array' then false
      when jsonb_array_length(w->'days')<>7 then false
      else exists(select 1 from jsonb_array_elements(w->'days') d
        where d->'applies'='true'::jsonb and case
          when jsonb_typeof(d->'ratio')='number' then
            (d->>'ratio')::numeric>0 and
            (d->>'ratio')::numeric<='1.7976931348623157e308'::numeric
          else false end)
      end) from jsonb_array_elements(p->'weeks') w),false)
  end;
$usable$;

revoke all on function projection_private.cpi_gap_metadata(uuid),
  projection_private.usable_benchmark_preview(jsonb) from public,anon,authenticated;
grant execute on function projection_private.cpi_gap_metadata(uuid),
  projection_private.usable_benchmark_preview(jsonb) to service_role;

do $patch$
declare signature text; definition text; old_text text; new_text text;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-settings:4',0));
  for signature in select unnest(array[
    'projection_private.benchmark_context(uuid,date,timestamptz)',
    'projection_private.archive_benchmark_context(public.projection_forecast_runs)'
  ]) loop
    definition:=pg_get_functiondef(signature::regprocedure);
    old_text:=$old$'census',jsonb_build_object($old$;
    new_text:=$new$'census',projection_private.cpi_gap_metadata(v.cpi_pull_id)||jsonb_build_object($new$;
    if strpos(definition,old_text)=0 then
      raise exception 'Unexpected benchmark context definition: %',signature;
    end if;
    execute replace(definition,old_text,new_text);
  end loop;

  definition:=pg_get_functiondef('public.projection_approve_benchmark(uuid,text,uuid)'::regprocedure);
  old_text:=$old$where version_id=vid and jsonb_array_length(result->'weeks')=8$old$;
  new_text:='where version_id=vid and projection_private.usable_benchmark_preview(result)';
  if strpos(definition,old_text)=0 then raise exception 'Unexpected benchmark approval definition'; end if;
  execute replace(definition,old_text,new_text);
end;
$patch$;

commit;