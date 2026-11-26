begin;

create table projection_private.pos_sync_leases (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);

alter table projection_private.pos_sync_leases enable row level security;
revoke all on projection_private.pos_sync_leases from public, anon, authenticated, service_role;

-- All callers have a 300-second invocation limit. Allow extra time for an
-- in-flight database request to finish before recovering an abandoned lease.
create function public.pos_sync_acquire(target uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare acquired uuid;
begin
  insert into projection_private.pos_sync_leases as lease(restaurant_id, token, expires_at)
  values (target, gen_random_uuid(), clock_timestamp() + interval '6 minutes')
  on conflict (restaurant_id) do update
    set token = excluded.token, expires_at = clock_timestamp() + interval '6 minutes'
    where lease.expires_at <= clock_timestamp()
  returning token into acquired;

  return acquired;
end;
$$;

create function public.pos_sync_release(target uuid, lease_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from projection_private.pos_sync_leases
  where restaurant_id = target and token = lease_token;
$$;

revoke all on function public.pos_sync_acquire(uuid), public.pos_sync_release(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.pos_sync_acquire(uuid), public.pos_sync_release(uuid, uuid)
  to service_role;

commit;