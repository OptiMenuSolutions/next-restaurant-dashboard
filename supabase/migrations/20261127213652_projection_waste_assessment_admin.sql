begin;

create function projection_private.waste_projection_admin_surface_status(actor uuid, target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = actor and p.role = 'admin') then
    raise exception 'Waste assessment status requires an administrator' using errcode = '42501';
  end if;

  if target is null then
    return (
      select coalesce(jsonb_object_agg(s.restaurant_id, s.enabled), '{}'::jsonb)
      from projection_private.waste_assessment_surface_switches s
      join public.restaurants r on r.id = s.restaurant_id and r.deactivated_at is null
    );
  end if;

  select jsonb_build_object(
    'restaurant_id', r.id,
    'restaurant_name', coalesce(nullif(btrim(r.name), ''), 'Unnamed restaurant'),
    'enabled', coalesce(s.enabled, false),
    'projections_enabled', coalesce(c.enabled, false),
    'latest_completed', latest.assessment,
    'has_compact_assessment', exists (
      select 1 from projection_private.waste_daily_jobs j
      join public.waste_projection_assessments a on a.id = j.assessment_id
        and a.restaurant_id = j.restaurant_id and a.assessment_date = j.assessment_date
      where j.restaurant_id = r.id and j.status = 'completed'
        and a.result->'result_schema_version' = '2'::jsonb
    ),
    'updated_by', s.updated_by,
    'updated_by_email', p.email,
    'updated_at', s.updated_at
  ) into result
  from public.restaurants r
  left join public.projection_restaurant_config c on c.restaurant_id = r.id
  left join projection_private.waste_assessment_surface_switches s on s.restaurant_id = r.id
  left join public.profiles p on p.id = s.updated_by
  left join lateral (
    select jsonb_build_object(
      'assessment_date', j.assessment_date,
      'compact', coalesce(a.result->'result_schema_version' = '2'::jsonb, false)
    ) as assessment
    from projection_private.waste_daily_jobs j
    join public.waste_projection_assessments a on a.id = j.assessment_id
      and a.restaurant_id = j.restaurant_id and a.assessment_date = j.assessment_date
    where j.restaurant_id = r.id and j.status = 'completed'
    order by j.assessment_date desc
    limit 1
  ) latest on true
  where r.id = target and r.deactivated_at is null;

  if not found then
    raise exception 'Restaurant unavailable' using errcode = 'PT404';
  end if;

  return result;
end;
$$;

create function public.waste_projection_admin_surface_status(actor uuid, target uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select projection_private.waste_projection_admin_surface_status(actor, target);
$$;

revoke all on function projection_private.waste_projection_admin_surface_status(uuid, uuid),
  public.waste_projection_admin_surface_status(uuid, uuid) from public, anon, authenticated;
grant execute on function projection_private.waste_projection_admin_surface_status(uuid, uuid),
  public.waste_projection_admin_surface_status(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;