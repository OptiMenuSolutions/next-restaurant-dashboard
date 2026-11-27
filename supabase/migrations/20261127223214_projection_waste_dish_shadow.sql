begin;

-- Keep one assessment query. The existing private entry point retains
-- the admin check for the interactive preview.
do $migration$
declare
  definition text := pg_get_functiondef(
    'projection_private.waste_projection_read_surface(uuid,timestamptz,uuid)'::regprocedure
  );
  signature constant text := 'FUNCTION projection_private.waste_projection_read_surface(target uuid, observed_at timestamp with time zone, preview_actor uuid)';
  actor_check constant text := $check$  if preview_actor is not null and not exists (
    select 1 from public.profiles p where p.id = preview_actor and p.role = 'admin'
  ) then
    raise exception 'Waste assessment preview requires an administrator' using errcode = '42501';
  end if;
$check$;
  switch_check constant text := 'if preview_actor is null and not exists (';
begin
  if position(signature in definition) = 0 or position(actor_check in definition) = 0
      or position(switch_check in definition) = 0 then
    raise exception 'Waste surface reader extraction hooks are missing';
  end if;
  execute replace(replace(replace(definition, signature,
    'FUNCTION projection_private.read_waste_surface(target uuid, observed_at timestamptz, ignore_switch boolean)'),
    actor_check, ''), switch_check, 'if not ignore_switch and not exists (');
end;
$migration$;

create or replace function projection_private.waste_projection_read_surface(
  target uuid, observed_at timestamptz, preview_actor uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if preview_actor is not null and not exists (
    select 1 from public.profiles p where p.id = preview_actor and p.role = 'admin'
  ) then
    raise exception 'Waste assessment preview requires an administrator' using errcode = '42501';
  end if;
  return projection_private.read_waste_surface(target, observed_at, preview_actor is not null);
end;
$$;

create function public.waste_projection_shadow_surface(target uuid, observed_at timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select projection_private.read_waste_surface(target, observed_at, true);
$$;

revoke all on function projection_private.read_waste_surface(uuid,timestamptz,boolean),
  public.waste_projection_shadow_surface(uuid,timestamptz) from public, anon, authenticated;
grant execute on function projection_private.read_waste_surface(uuid,timestamptz,boolean),
  public.waste_projection_shadow_surface(uuid,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;