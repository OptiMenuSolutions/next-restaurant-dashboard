begin;

-- Retain the latest token after release so a later sync can invalidate
-- an assessment, including where prepared POS usage is disabled.
create or replace function public.pos_sync_acquire(target uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare acquired uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('pos-sync:' || target::text, 0));
  insert into projection_private.pos_sync_leases as lease(restaurant_id, token, expires_at)
  values (target, gen_random_uuid(), clock_timestamp() + interval '6 minutes')
  on conflict (restaurant_id) do update
    set token = excluded.token, expires_at = clock_timestamp() + interval '6 minutes'
    where lease.expires_at <= clock_timestamp()
  returning token into acquired;
  return acquired;
end;
$$;

create or replace function public.pos_sync_release(target uuid, lease_token uuid)
returns void language sql security definer set search_path = '' as $$
  update projection_private.pos_sync_leases set expires_at = '-infinity'
  where restaurant_id = target and token = lease_token;
$$;

create table projection_private.waste_daily_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  assessment_date date not null,
  timing jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','ready','completed','skipped','failed')),
  lease_token uuid,
  lease_until timestamptz,
  ready_at timestamptz,
  receipt jsonb,
  forecast_pinned boolean not null default false,
  forecast_run_id uuid,
  fallback boolean not null default false,
  envelope jsonb,
  envelope_at timestamptz,
  recalculations integer not null default 0 check (recalculations between 0 and 3),
  assessment_id uuid,
  last_error text,
  unique (restaurant_id, assessment_date)
);

alter table projection_private.waste_daily_jobs enable row level security;
revoke all on projection_private.waste_daily_jobs from public, anon, authenticated, service_role;

create index waste_daily_jobs_payload_expiry
  on projection_private.waste_daily_jobs (coalesce(envelope_at, ready_at), id)
  where receipt is not null;

create function projection_private.waste_daily_require_lease(jid uuid, tok uuid)
returns projection_private.waste_daily_jobs
language plpgsql set search_path = '' as $$
declare j projection_private.waste_daily_jobs;
begin
  select * into j from projection_private.waste_daily_jobs where id = jid for update;
  if not found or tok is null or j.lease_token is distinct from tok
    or j.lease_until <= clock_timestamp()
    or j.status not in ('pending','ready') then
    raise exception 'Waste assessment lease expired or superseded' using errcode = 'PT412';
  end if;
  return j;
end;
$$;

create function projection_private.waste_daily_sync_current(target uuid, evidence jsonb)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pos-sync:' || target::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('current_inventory:' || target::text, 0));
  return exists (
    select 1 from projection_private.pos_sync_leases p
    left join public.pos_usage_jobs u on u.restaurant_id = p.restaurant_id
    left join public.pos_usage_settings s on s.restaurant_id = p.restaurant_id
    where p.restaurant_id = target and p.token = (evidence->>'syncRevision')::uuid
      and p.expires_at = '-infinity'::timestamptz
      and to_jsonb(u.generation) is not distinct from nullif(evidence#>'{usageJob,generation}', 'null'::jsonb)
      and u.applied_publication_id is not distinct from (evidence#>>'{usageJob,applied_publication_id}')::uuid
      and (not coalesce(s.enabled, false) or u.applied_publication_id is not null)
  );
end;
$$;

create function public.waste_projection_daily_claim(target uuid, assessment_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t jsonb;
  j projection_private.waste_daily_jobs;
  now_at timestamptz := clock_timestamp();
  sync_at timestamptz;
  deadline timestamptz;
  run_id uuid;
begin
  if not exists (
    select 1 from public.projection_restaurant_config c
    join public.restaurants r on r.id = c.restaurant_id
    where c.restaurant_id = target and c.enabled and r.deactivated_at is null
  ) then return jsonb_build_object('status','disabled'); end if;

  t := projection_private.run_timing(target, now_at);
  if (t->>'business_date')::date is distinct from assessment_day then
    update projection_private.waste_daily_jobs set
      status = 'skipped', last_error = 'BUSINESS_DATE_ENDED', receipt = null, envelope = null,
      lease_until = null, lease_token = null, envelope_at = null
    where restaurant_id = target and assessment_date = assessment_day
      and assessment_day < (t->>'business_date')::date and status in ('pending','ready')
      and coalesce(lease_until,'-infinity') <= now_at;
    return jsonb_build_object('status','outside_business_date');
  end if;

  insert into projection_private.waste_daily_jobs (restaurant_id, assessment_date, timing)
    values (target, assessment_day, t - array['settings','global_version','restaurant_version']
      || jsonb_build_object(
        'cutoff_minutes',(t#>>'{settings,business_day_cutoff_minutes}')::integer,
        'sync_buffer_minutes',(t#>>'{settings,sync_buffer_minutes}')::integer
      ))
    on conflict (restaurant_id, assessment_date) do nothing;

  select * into strict j from projection_private.waste_daily_jobs
    where restaurant_id = target and assessment_date = assessment_day for update;
  now_at := clock_timestamp();

  if j.status in ('completed','skipped','failed') then
    return jsonb_build_object('status',j.status,'assessment_id',j.assessment_id);
  end if;
  if j.lease_until > now_at then return jsonb_build_object('status','busy'); end if;

  deadline := (j.timing->>'deadline_at')::timestamptz;
  sync_at := greatest((j.timing->>'ready_at')::timestamptz, (
    select i.changed_at + make_interval(mins => (j.timing->>'sync_buffer_minutes')::integer)
    from public.projection_ingestion_state i
    where i.restaurant_id = target and i.business_date = assessment_day - 1
  ));

  if j.status = 'pending' then
    if now_at >= deadline then
      update projection_private.waste_daily_jobs set status = 'skipped',
        last_error = coalesce(last_error,'INVENTORY_DEADLINE_MISSED'), lease_token = null, lease_until = null
        where id = j.id;
      return jsonb_build_object('status','skipped');
    end if;
    if now_at < sync_at then
      return jsonb_build_object('status','wait','retry_at',least(sync_at,deadline));
    end if;
  elsif not j.forecast_pinned then
    select r.id into run_id from public.projection_forecast_runs r
      where r.restaurant_id = target and r.run_date = assessment_day and r.model_major = 4
        and r.issued_at < deadline
      order by r.issued_at desc,r.id desc limit 1;
    if run_id is null and now_at < deadline then
      return jsonb_build_object('status','wait','retry_at',deadline);
    end if;
    j.fallback := run_id is null;
    if j.fallback then
      select r.id into run_id from public.projection_forecast_runs r
        where r.restaurant_id = target and r.run_date = assessment_day - 1 and r.model_major = 4
          and r.issued_at < deadline
        order by r.issued_at desc,r.id desc limit 1;
    end if;
    j.forecast_pinned := true;
    j.forecast_run_id := run_id;
  end if;

  update projection_private.waste_daily_jobs set
    lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '6 minutes',
    forecast_pinned = j.forecast_pinned, forecast_run_id = j.forecast_run_id, fallback = j.fallback
    where id = j.id returning * into j;
  return to_jsonb(j) || jsonb_build_object('sync_not_before',sync_at);
end;
$$;

create function public.waste_projection_daily_checkpoint(
  jid uuid, tok uuid, evidence jsonb, failure text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j projection_private.waste_daily_jobs := projection_private.waste_daily_require_lease(jid,tok);
  now_at timestamptz;
  deadline timestamptz := (j.timing->>'deadline_at')::timestamptz;
  sync_at timestamptz;
begin
  if evidence is not null then
    if j.status <> 'pending' or jsonb_typeof(evidence->'rows') is distinct from 'array'
      or evidence->'rawTicketsSaved' is distinct from 'true'::jsonb
      or not projection_private.waste_daily_sync_current(j.restaurant_id,evidence) then
      raise exception 'Waste inventory source is stale or incomplete' using errcode = 'PT412';
    end if;

    select greatest((j.timing->>'ready_at')::timestamptz, i.changed_at +
      make_interval(mins => (j.timing->>'sync_buffer_minutes')::integer))
      into sync_at from public.projection_ingestion_state i
      where i.restaurant_id = j.restaurant_id and i.business_date = j.assessment_date - 1;
    sync_at := coalesce(sync_at,(j.timing->>'ready_at')::timestamptz);
    if ((evidence->>'startedAt')::timestamptz >= sync_at
      and (evidence->>'finishedAt')::timestamptz >= (evidence->>'startedAt')::timestamptz
      and (evidence->>'inventoryStartedAt')::timestamptz >= (evidence->>'finishedAt')::timestamptz
      and (evidence->>'inventoryStartedAt')::timestamptz <= clock_timestamp()) is distinct from true then
      raise exception 'Waste inventory timing is invalid' using errcode = 'PT412';
    end if;
  end if;

  now_at := clock_timestamp();
  if j.lease_until <= now_at then
    raise exception 'Waste assessment lease expired' using errcode = 'PT412';
  end if;
  if j.status = 'pending' and now_at >= deadline then
    j.status := 'skipped';
    failure := coalesce(failure,'INVENTORY_DEADLINE_MISSED');
  elsif evidence is not null then
    j.status := 'ready';
    j.ready_at := now_at;
    j.receipt := evidence;
  end if;

  update projection_private.waste_daily_jobs set status = j.status, ready_at = j.ready_at,
    receipt = j.receipt, last_error = left(failure,1000), lease_token = null, lease_until = null
    where id = j.id;
  return jsonb_build_object('status',j.status);
end;
$$;

create function public.waste_projection_daily_save(jid uuid, tok uuid, prepared jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare j projection_private.waste_daily_jobs := projection_private.waste_daily_require_lease(jid,tok);
begin
  if j.status <> 'ready' or not j.forecast_pinned
    or prepared->>'target' is distinct from j.restaurant_id::text
    or prepared->>'request_id' is null
    or prepared#>>'{snapshot,assessmentDate}' is distinct from j.assessment_date::text
    or prepared#>>'{snapshot,inventoryCutoff}' is distinct from (j.assessment_date-1)::text
    or prepared#>>'{snapshot,forecast,id}' is distinct from j.forecast_run_id::text
    or prepared#>'{outcome,forecast_fallback}' is distinct from to_jsonb(j.fallback)
    or (j.envelope is not null and j.envelope is distinct from prepared) then
    raise exception 'Invalid or changed daily assessment envelope' using errcode = 'PT409';
  end if;
  if j.envelope is null then
    update projection_private.waste_daily_jobs set envelope = prepared, envelope_at = clock_timestamp()
      where id = j.id;
  end if;
end;
$$;

create function public.waste_projection_daily_commit(jid uuid, tok uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j projection_private.waste_daily_jobs := projection_private.waste_daily_require_lease(jid,tok);
  out jsonb;
begin
  if j.status <> 'ready' or j.envelope is null then
    raise exception 'Daily assessment has no prepared envelope' using errcode = 'PT412';
  end if;

  if not projection_private.waste_daily_sync_current(j.restaurant_id,j.receipt) then
    j.status := case when clock_timestamp() < (j.timing->>'deadline_at')::timestamptz
      then 'pending' else 'skipped' end;
    update projection_private.waste_daily_jobs set status = j.status, ready_at = null, receipt = null,
      envelope = null, envelope_at = null, lease_token = null, lease_until = null,
      last_error = 'POS_USAGE_NOT_APPLIED' where id = j.id;
    return jsonb_build_object('status',j.status,'error','POS_USAGE_NOT_APPLIED');
  end if;

  if j.lease_until <= clock_timestamp() then
    raise exception 'Waste assessment lease expired' using errcode = 'PT412';
  end if;

  begin
    out := public.waste_projection_commit(
      j.restaurant_id,(j.envelope->>'request_id')::uuid,
      (j.envelope->>'expected_version')::bigint,j.envelope->'snapshot',j.envelope->'outcome',
      nullif(j.envelope->'correction','null'::jsonb)
    );
  exception when sqlstate 'PT409' then
    if j.recalculations = 3 then j.status := 'failed';
    else j.recalculations := j.recalculations + 1; end if;
    update projection_private.waste_daily_jobs set status = j.status, recalculations = j.recalculations,
      envelope = null, envelope_at = null, lease_token = null, lease_until = null,
      last_error = 'PT409' where id = j.id;
    return jsonb_build_object('status',j.status,'error','PT409','recalculations',j.recalculations);
  end;

  if j.lease_until <= clock_timestamp() then
    raise exception 'Waste assessment lease expired' using errcode = 'PT412';
  end if;
  update projection_private.waste_daily_jobs set status = 'completed',
    assessment_id = (out->>'assessment_id')::uuid, envelope = null, envelope_at = null,
    receipt = null, lease_token = null, lease_until = null, last_error = null where id = j.id;
  return out || jsonb_build_object('status','completed');
end;
$$;

-- Keep the existing cron's limit of 100 total records per RPC call.
create or replace function public.waste_projection_expire_payloads()
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer; cleared integer;
begin
  with expired as (
    select p.assessment_id from public.waste_projection_assessment_payloads p
    where p.expires_at <= statement_timestamp()
    order by p.expires_at,p.assessment_id limit 100 for update skip locked
  )
  delete from public.waste_projection_assessment_payloads p using expired
    where p.assessment_id = expired.assessment_id;
  get diagnostics removed = row_count;

  with expired as (
    select j.id from projection_private.waste_daily_jobs j
    where j.receipt is not null
      and coalesce(j.envelope_at,j.ready_at) <= statement_timestamp() - interval '720 hours'
      and coalesce(j.lease_until,'-infinity') <= statement_timestamp()
    order by coalesce(j.envelope_at,j.ready_at),j.id limit (100 - removed) for update skip locked
  )
  update projection_private.waste_daily_jobs j set receipt = null, envelope = null, envelope_at = null,
    lease_token = null, lease_until = null,
    status = case when j.status = 'ready' then 'skipped' else j.status end
    from expired where j.id = expired.id;
  get diagnostics cleared = row_count;
  return removed + cleared;
end;
$$;

revoke all on function
  projection_private.waste_daily_require_lease(uuid,uuid),
  projection_private.waste_daily_sync_current(uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.waste_projection_daily_claim(uuid,date),
  public.waste_projection_daily_checkpoint(uuid,uuid,jsonb,text),
  public.waste_projection_daily_save(uuid,uuid,jsonb),
  public.waste_projection_daily_commit(uuid,uuid)
  from public, anon, authenticated;
grant execute on function
  public.waste_projection_daily_claim(uuid,date),
  public.waste_projection_daily_checkpoint(uuid,uuid,jsonb,text),
  public.waste_projection_daily_save(uuid,uuid,jsonb),
  public.waste_projection_daily_commit(uuid,uuid)
  to service_role;

do $migration$
declare
  definition text;
  hook constant text := 'perform public.purge_restaurant_before_projections(target);';
begin
  definition := pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure);
  if position(hook in definition) = 0 then
    raise exception 'Waste daily jobs purge hook not found';
  end if;

  execute replace(definition, hook, $purge$
    delete from projection_private.waste_daily_jobs where restaurant_id = target;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object('waste_daily_jobs', n);

    delete from projection_private.pos_sync_leases where restaurant_id = target;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object('pos_sync_leases', n);

    perform public.purge_restaurant_before_projections(target);
  $purge$);
end;
$migration$;

commit;