begin;

alter table projection_private.waste_daily_jobs add column terminal_alert_at timestamptz;
create index waste_daily_jobs_terminal_alert
  on projection_private.waste_daily_jobs(restaurant_id, assessment_date)
  where status in ('skipped','failed') and terminal_alert_at is null;

do $migration$
declare
  definition text;
  hook constant text := '  t := projection_private.run_timing(target, now_at);';
begin
  definition := pg_get_functiondef('public.waste_projection_daily_claim(uuid,date)'::regprocedure);
  if position(hook in definition) = 0 then
    raise exception 'Daily waste assessment clock hook not found';
  end if;

  execute replace(definition, hook, hook || $body$
  assessment_day := coalesce(assessment_day,(t->>'business_date')::date);
  update projection_private.waste_daily_jobs set
    status = 'skipped', last_error = coalesce(last_error,'BUSINESS_DATE_ENDED'),
    receipt = null, envelope = null, envelope_at = null,
    lease_token = null, lease_until = null
  where restaurant_id = target
    and assessment_date < (t->>'business_date')::date
    and status in ('pending','ready')
    and coalesce(lease_until,'-infinity') <= now_at;
$body$);
end;
$migration$;

create function public.waste_projection_daily_take_alert(target uuid)
returns jsonb language sql security definer set search_path = '' as $$
  with candidate as (
    select id from projection_private.waste_daily_jobs
    where restaurant_id = target and status in ('skipped','failed') and terminal_alert_at is null
    order by assessment_date limit 1 for update skip locked
  ), reserved as (
    update projection_private.waste_daily_jobs j set terminal_alert_at = clock_timestamp()
    from candidate c where c.id = j.id
    returning j.assessment_date, j.status, j.last_error
  )
  select jsonb_build_object(
    'assessment_date', assessment_date, 'status', status,
    'stage', case when position(' | ' in last_error) > 0 then split_part(last_error,' | ',1)
      when last_error in ('PT409','POS_USAGE_NOT_APPLIED') or status = 'failed' then 'commit'
      else 'inventory' end,
    'reason', coalesce(last_error,'INVENTORY_DEADLINE_MISSED')
  ) from reserved;
$$;

revoke all on function public.waste_projection_daily_take_alert(uuid) from public, anon, authenticated;
grant execute on function public.waste_projection_daily_take_alert(uuid) to service_role;

-- A case first frozen against a short fallback can fill its uncovered tail
-- when real archived demand becomes available. Existing frozen days stay fixed.
do $migration$
declare
  definition text;
  hook constant text := '      if correction_id is null then';
begin
  definition := pg_get_functiondef(
    'public.waste_projection_commit(uuid,uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure
  );
  if position(hook in definition) = 0 then
    raise exception 'Waste fallback coverage hook not found';
  end if;

  execute replace(definition, hook, hook || $body$
        if table_name = 'cases' and old_record->'fallback_limited' = 'true'::jsonb
          and row_value-array['digest','coverage_through'] = old_record-array['digest','coverage_through']
          and (row_value->>'coverage_through')::date > (old_record->>'coverage_through')::date
          and (row_value->>'coverage_through')::date <= (old_record->>'use_by_date')::date
          and not exists (
            select 1
            from generate_series(
              greatest(cutoff+1,(old_record->>'coverage_through')::date+1)::timestamp,
              (row_value->>'coverage_through')::date::timestamp,
              interval '1 day'
            ) day
            where not exists (
              select 1 from jsonb_array_elements(outcome#>'{frozen,demands}') proposed
              where proposed->>'ingredient_id' = old_record->>'ingredient_id'
                and proposed->>'business_date' = day::date::text
            )
          ) then continue; end if;
$body$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;