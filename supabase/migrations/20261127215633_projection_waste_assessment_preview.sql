begin;

create function projection_private.waste_projection_read_surface(
  target uuid, observed_at timestamptz, preview_actor uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  timing jsonb;
  selected public.waste_projection_assessments;
  boundary timestamptz;
  boundary_zone text;
  current_day date;
  pending jsonb;
begin
  if observed_at is null or not isfinite(observed_at) then
    raise exception 'Invalid waste assessment read timestamp' using errcode = '22023';
  end if;
  observed_at := least(observed_at, statement_timestamp());
  if preview_actor is not null and not exists (
    select 1 from public.profiles p where p.id = preview_actor and p.role = 'admin'
  ) then
    raise exception 'Waste assessment preview requires an administrator' using errcode = '42501';
  end if;
  if preview_actor is null and not exists (
    select 1 from projection_private.waste_assessment_surface_switches s
    where s.restaurant_id = target and s.enabled
  ) then return jsonb_build_object('mode','legacy','reason','switch_off'); end if;
  if not exists (
    select 1 from public.projection_restaurant_config c join public.restaurants r on r.id = c.restaurant_id
    where c.restaurant_id = target and c.enabled and r.deactivated_at is null
  ) then return jsonb_build_object('mode','legacy','reason','projections_disabled'); end if;

  timing := projection_private.run_timing(target, observed_at);
  current_day := (timing->>'business_date')::date;
  select a.* into selected
  from public.waste_projection_assessments a
  join projection_private.waste_daily_jobs j
    on j.restaurant_id = a.restaurant_id and j.assessment_date = a.assessment_date
    and j.assessment_id = a.id and j.status = 'completed'
  where a.restaurant_id = target and a.assessment_date <= current_day and a.saved_at <= observed_at
    and a.result->'result_schema_version' = '2'::jsonb
  order by a.assessment_date desc, a.saved_at desc, a.id desc
  limit 1;

  if not found then return jsonb_build_object('mode','legacy','reason','no_compact_assessment'); end if;
  select (j.timing->>'starts_at')::timestamptz, j.timing->>'timezone' into boundary, boundary_zone
  from projection_private.waste_daily_jobs j
  where j.restaurant_id = target and j.assessment_date = selected.assessment_date
    and j.assessment_id = selected.id;
  if boundary is null or not isfinite(boundary) then
    raise exception 'Completed waste assessment has no inventory boundary';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'batch_id', w.invoice_item_id,
    'confirmation_id', w.id,
    'confirmed_at', w.confirmed_at,
    'ingredient_name', w.ingredient_name,
    'last_known_use_by_date', historic.use_by_date
  ) order by w.confirmed_at desc, w.id), '[]'::jsonb)
  into pending
  from public.waste_confirmations w
  left join lateral (
    select c.record->>'use_by_date' as use_by_date
    from public.waste_projection_cases c join public.waste_projection_assessments a
      on a.restaurant_id = c.restaurant_id and a.id = c.assessment_id
    where c.restaurant_id = target and c.batch_id = w.invoice_item_id
      and a.state_version <= selected.state_version
    order by a.state_version desc
    limit 1
  ) historic on true
  where w.restaurant_id = target and w.status = 'confirmed_wasted' and w.invoice_item_id is not null
    and w.confirmed_at >= boundary and w.confirmed_at <= observed_at;

  return jsonb_build_object(
    'mode','assessment','restaurant_id',target,'assessment_id',selected.id,
    'assessment_date',selected.assessment_date,'inventory_cutoff',selected.inventory_cutoff,
    'inventory_boundary',boundary,'inventory_timezone',coalesce(boundary_zone,timing->>'timezone'),
    'business_date',current_day,'timezone',timing->>'timezone',
    'result',selected.result,'pending_disposals',pending
  );
end;
$$;

create or replace function public.waste_projection_read_surface(target uuid, observed_at timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select projection_private.waste_projection_read_surface(target, observed_at, null::uuid);
$$;

create function public.waste_projection_preview_surface(target uuid, observed_at timestamptz, actor uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select projection_private.waste_projection_read_surface(target, observed_at, actor);
$$;

revoke all on function projection_private.waste_projection_read_surface(uuid,timestamptz,uuid),
  public.waste_projection_read_surface(uuid,timestamptz),
  public.waste_projection_preview_surface(uuid,timestamptz,uuid) from public, anon, authenticated;
grant execute on function projection_private.waste_projection_read_surface(uuid,timestamptz,uuid),
  public.waste_projection_read_surface(uuid,timestamptz),
  public.waste_projection_preview_surface(uuid,timestamptz,uuid) to service_role;

notify pgrst, 'reload schema';
commit;