begin;

create function projection_private.waste_rollout_read(target uuid, day date, actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare response jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = actor and p.role = 'admin') then
    raise exception 'Waste rollout requires an administrator' using errcode = '42501';
  end if;
  if day is null or not isfinite(day) then
    raise exception 'Invalid assessment date' using errcode = '22023';
  end if;

  with jobs as materialized (
    select j.assessment_date, j.status, j.last_error, j.forecast_run_id, j.fallback,
      (j.timing->>'starts_at')::timestamptz as boundary, a.saved_at
    from projection_private.waste_daily_jobs j
    left join public.waste_projection_assessments a on a.id = j.assessment_id
      and a.restaurant_id = j.restaurant_id and a.assessment_date = j.assessment_date
    where j.restaurant_id = target and j.assessment_date between day - 13 and day
  ), selected as (
    select a.id, a.inventory_cutoff, a.saved_at, a.result,
      (j.timing->>'starts_at')::timestamptz as boundary
    from projection_private.waste_daily_jobs j
    join public.waste_projection_assessments a on a.id = j.assessment_id
      and a.restaurant_id = j.restaurant_id and a.assessment_date = j.assessment_date
    where j.restaurant_id = target and j.assessment_date = day and j.status = 'completed'
      and a.result->'result_schema_version' = '2'::jsonb
  ), latest as (
    select (j.timing->>'starts_at')::timestamptz as boundary
    from projection_private.waste_daily_jobs j
    where j.restaurant_id = target and j.status = 'completed'
    order by j.assessment_date desc limit 1
  )
  select jsonb_build_object(
    'name', coalesce(nullif(btrim(r.name), ''), 'Unnamed restaurant'),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(j) order by j.assessment_date desc), '[]'::jsonb) from jobs j),
    'assessment', (select jsonb_build_object(
      'id', a.id, 'inventory_cutoff', a.inventory_cutoff, 'boundary', a.boundary, 'saved_at', a.saved_at,
      'items', a.result->'items', 'needs_review', a.result->'needs_review',
      'omitted', a.result->'omitted_by_status',
      'compact_bytes', octet_length(a.result::text),
      'payload_bytes', octet_length(p.input::text) + octet_length(p.result::text),
      'pending_batch_ids', (select coalesce(jsonb_agg(distinct w.invoice_item_id), '[]'::jsonb)
        from public.waste_confirmations w where w.restaurant_id = target
          and w.status = 'confirmed_wasted' and w.invoice_item_id is not null
          and w.confirmed_at >= a.boundary and w.confirmed_at <= a.saved_at)
    ) from selected a left join public.waste_projection_assessment_payloads p
      on p.assessment_id = a.id and p.restaurant_id = target and p.expires_at > statement_timestamp()),
    'disposals', (select jsonb_build_object(
      'count', count(*), 'oldest_at', min(w.confirmed_at),
      'past_cutoff', count(*) filter (where w.confirmed_at < b.boundary)
    ) from public.waste_confirmations w
      left join projection_private.waste_correction_sources s on s.restaurant_id = target
        and s.source_key = 'disposal:' || w.id
      left join latest b on true
      where w.restaurant_id = target and w.status = 'confirmed_wasted' and w.confirmed_at is not null
        and (s.disposition = 'pending' or (s.id is null and w.confirmed_at >= b.boundary))),
    'correction_review', (select coalesce(jsonb_object_agg(disposition, total), '{}'::jsonb) from (
      select s.disposition, count(*) as total
      from projection_private.waste_correction_sources s
      where s.restaurant_id = target and s.disposition in ('unauthorized','invalid_source','elapsed')
      group by s.disposition
    ) counts)
  ) into response
  from public.restaurants r where r.id = target and r.deactivated_at is null;
  if not found then
    raise exception 'Restaurant unavailable' using errcode = 'PT404';
  end if;
  return response;
end;
$$;

create function public.waste_rollout_read(target uuid, day date, actor uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select projection_private.waste_rollout_read(target, day, actor);
$$;

revoke all on function projection_private.waste_rollout_read(uuid,date,uuid),
  public.waste_rollout_read(uuid,date,uuid) from public, anon, authenticated;
grant execute on function projection_private.waste_rollout_read(uuid,date,uuid),
  public.waste_rollout_read(uuid,date,uuid) to service_role;
notify pgrst, 'reload schema';
commit;