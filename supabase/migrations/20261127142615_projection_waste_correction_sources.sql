begin;

create table projection_private.waste_correction_sources (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  source_key text not null,
  reason text not null check (reason in ('confirmed_disposal','confirmed_closure')),
  actor_id uuid,
  source_at timestamptz,
  batch_id uuid,
  business_date date,
  revision bigint,
  disposition text not null check (
    disposition in ('pending','applied','unauthorized','invalid_source','elapsed','superseded')
  ),
  assessment_id uuid,
  unique (restaurant_id, source_key),
  foreign key (restaurant_id, assessment_id)
    references public.waste_projection_assessments(restaurant_id,id)
);

alter table projection_private.waste_correction_sources enable row level security;
revoke all on projection_private.waste_correction_sources from public, anon, authenticated, service_role;

create index waste_correction_sources_active on projection_private.waste_correction_sources
  (restaurant_id, disposition, reason, business_date, source_at)
  where disposition in ('pending','applied');

create index waste_confirmations_projection_disposal on public.waste_confirmations
  (restaurant_id, confirmed_at desc nulls last, id) where status = 'confirmed_wasted';

create function projection_private.waste_correction_actor(target uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.restaurants r where r.id = target and r.user_id = actor)
    or exists (select 1 from public.profiles p where p.id = actor and p.role = 'admin');
$$;

create function public.waste_projection_record_correction_source(
  target uuid, confirmation uuid default null, holiday_day date default null, holiday_revision bigint default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  event projection_private.waste_correction_sources;
begin
  if not exists (
    select 1 from public.projection_restaurant_config c join public.restaurants r on r.id = c.restaurant_id
    where c.restaurant_id = target and c.enabled and r.deactivated_at is null
  ) then return; end if;

  if confirmation is not null and holiday_day is null and holiday_revision is null then
    select w.confirmed_by, w.confirmed_at, w.invoice_item_id
      into event.actor_id, event.source_at, event.batch_id
    from public.waste_confirmations w
    where w.id = confirmation and w.restaurant_id = target and w.status = 'confirmed_wasted';
    if not found then return; end if;
    event.source_key := 'disposal:' || confirmation;
    event.reason := 'confirmed_disposal';
  elsif confirmation is null and holiday_day is not null and holiday_revision is not null then
    select h.actor_id, h.recorded_at into event.actor_id, event.source_at
    from public.projection_holiday_answer_versions h
    where h.restaurant_id = target and h.business_date = holiday_day
      and h.revision = holiday_revision and h.answer = 'closed';
    if not found then return; end if;
    event.source_key := 'closure:' || holiday_day || ':' || holiday_revision;
    event.reason := 'confirmed_closure';
    event.business_date := holiday_day;
    event.revision := holiday_revision;
  else
    raise exception 'Invalid waste correction source identity' using errcode = '22023';
  end if;

  insert into projection_private.waste_correction_sources(
    restaurant_id, source_key, reason, actor_id, source_at, batch_id, business_date, revision, disposition
  ) values (
    target, event.source_key, event.reason, event.actor_id, event.source_at,
    event.batch_id, event.business_date, event.revision,
    case when not projection_private.waste_correction_actor(target, event.actor_id) then 'unauthorized'
      when event.source_at is null or (event.reason = 'confirmed_disposal' and event.batch_id is null)
        then 'invalid_source'
      else 'pending' end
  ) on conflict (restaurant_id, source_key) do nothing;
end;
$$;

create function projection_private.settle_waste_correction_sources(target uuid, day date)
returns void language sql set search_path = '' as $$
  update projection_private.waste_correction_sources e set
    disposition = case
      when e.disposition = 'pending' and not projection_private.waste_correction_actor(target, e.actor_id)
        then 'unauthorized'
      when exists (
        select 1 from public.projection_holiday_answer_versions h
        where h.restaurant_id = target and h.business_date = e.business_date and h.revision > e.revision
      ) then 'superseded'
      else 'elapsed'
    end
  where e.restaurant_id = target and e.disposition in ('pending','applied') and (
    (e.disposition = 'pending' and not projection_private.waste_correction_actor(target, e.actor_id))
    or (e.disposition = 'pending' and e.business_date < day)
    or exists (
      select 1 from public.projection_holiday_answer_versions h
      where h.restaurant_id = target and h.business_date = e.business_date and h.revision > e.revision
    )
  );
$$;

create function public.waste_projection_sweep_correction_sources(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e record;
  day date;
begin
  if not exists (
    select 1 from public.projection_restaurant_config c join public.restaurants r on r.id = c.restaurant_id
    where c.restaurant_id = target and c.enabled and r.deactivated_at is null
  ) then return; end if;

  day := (projection_private.run_timing(target, clock_timestamp())->>'business_date')::date;
  for e in
    select id from public.waste_confirmations w
    where w.restaurant_id = target and w.status = 'confirmed_wasted'
      and not exists (
        select 1 from projection_private.waste_correction_sources s
        where s.restaurant_id = target and s.source_key = 'disposal:' || w.id
      )
    order by w.confirmed_at desc nulls last, w.id limit 25
  loop
    perform public.waste_projection_record_correction_source(target, confirmation => e.id);
  end loop;

  for e in
    select business_date, revision from public.projection_holiday_answer_versions h
    where h.restaurant_id = target and h.answer = 'closed'
      and not exists (
        select 1 from projection_private.waste_correction_sources s
        where s.restaurant_id = target and s.source_key = 'closure:' || h.business_date || ':' || h.revision
      )
    order by h.business_date desc, h.revision desc limit 25
  loop
    perform public.waste_projection_record_correction_source(
      target, holiday_day => e.business_date, holiday_revision => e.revision
    );
  end loop;
  perform projection_private.settle_waste_correction_sources(target, day);
end;
$$;

create function projection_private.waste_daily_correction_context(target uuid, day date, boundary timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare e record;
begin
  -- Use the same lock as the holiday answer writer.
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-ingest:' || target::text,0));
  for e in
    select distinct on (h.business_date) h.business_date, h.revision, h.answer
    from public.projection_holiday_answer_versions h
    where h.restaurant_id = target and h.business_date between day and day + 7
    order by h.business_date, h.revision desc
  loop
    if e.answer = 'closed' then
      perform public.waste_projection_record_correction_source(
        target, holiday_day => e.business_date, holiday_revision => e.revision
      );
    end if;
  end loop;
  perform projection_private.settle_waste_correction_sources(target, day);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', src.id, 'reason', src.reason, 'business_date', src.business_date
    ) order by src.id), '[]'::jsonb)
    from (
      (select s.* from projection_private.waste_correction_sources s
       where s.restaurant_id = target and s.reason = 'confirmed_disposal'
         and s.disposition = 'pending' and s.source_at < boundary
       order by s.source_at desc,s.id limit 25)
      union all
      select s.* from projection_private.waste_correction_sources s
      where s.restaurant_id = target and s.reason = 'confirmed_closure'
        and s.disposition in ('pending','applied') and s.business_date between day and day + 7
        and projection_private.waste_correction_actor(target, s.actor_id)
    ) src
  );
end;
$$;

create function public.waste_projection_daily_correction_sources(jid uuid,tok uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j projection_private.waste_daily_jobs := projection_private.waste_daily_require_lease(jid,tok);
begin
  if j.status <> 'ready' or not j.forecast_pinned then
    raise exception 'Daily correction sources require pinned inputs' using errcode = 'PT412';
  end if;
  return projection_private.waste_daily_correction_context(
    j.restaurant_id,j.assessment_date,(j.timing->>'starts_at')::timestamptz
  );
end;
$$;

revoke all on function projection_private.waste_correction_actor(uuid,uuid),
  projection_private.settle_waste_correction_sources(uuid,date),
  projection_private.waste_daily_correction_context(uuid,date,timestamptz)
  from public, anon, authenticated, service_role;

revoke all on function public.waste_projection_record_correction_source(uuid,uuid,date,bigint),
  public.waste_projection_sweep_correction_sources(uuid), public.waste_projection_daily_correction_sources(uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.waste_projection_record_correction_source(uuid,uuid,date,bigint),
  public.waste_projection_sweep_correction_sources(uuid), public.waste_projection_daily_correction_sources(uuid,uuid)
  to service_role;

-- Keep the deployed RPC signatures and the original null and single-correction paths.
do $migration$
declare
  definition text;
  patch record;
begin
  definition := pg_get_functiondef(
    'public.waste_projection_commit(uuid,uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure
  );
  for patch in select * from (values
    ($old$  weighted double precision;$old$, $new$  weighted double precision;
  source_batch boolean := coalesce(jsonb_typeof(correction) = 'array', false);
  source_closures jsonb := '{}';
  source_closure text;
  boundary timestamptz;
  applied_id uuid;$new$),
    ($old$      saved.correction_id is distinct from (correction->>'id')::uuid or
      (select c.record from public.waste_projection_corrections c where c.id=saved.correction_id) is distinct from correction then$old$,
     $new$      (case when source_batch then saved.correction_id is not null
        or correction is distinct from snapshot->'correctionSources'
      else snapshot ? 'correctionSources'
        or saved.correction_id is distinct from (correction->>'id')::uuid
        or (select c.record from public.waste_projection_corrections c where c.id=saved.correction_id)
          is distinct from correction end) then$new$),
    ($old$  if correction is not null then$old$, $new$  if source_batch then
    select (j.timing->>'starts_at')::timestamptz into boundary
    from projection_private.waste_daily_jobs j
    where j.restaurant_id = target and j.assessment_date = (snapshot->>'assessmentDate')::date
      and j.status = 'ready' and j.lease_until > clock_timestamp()
      and (j.envelope->>'request_id')::uuid = waste_projection_commit.request_id
      and j.envelope->'snapshot' = snapshot and j.envelope->'correction' = correction;
    if boundary is null or correction is distinct from snapshot->'correctionSources'
      or correction is distinct from projection_private.waste_daily_correction_context(
        target,(snapshot->>'assessmentDate')::date,boundary
      ) then
      raise exception 'Waste correction sources changed; reload and calculate again' using errcode='PT409';
    end if;
    select coalesce(jsonb_object_agg(s->>'business_date',s->>'id'),'{}'::jsonb)
      into source_closures from jsonb_array_elements(correction) s
      where s->>'reason' = 'confirmed_closure';
  elsif snapshot ? 'correctionSources' then
    raise exception 'Missing daily correction source list' using errcode='PT409';
  elsif correction is not null then$new$),
    ($old$      if row_value=old_record then continue; end if;$old$, $new$      if table_name='demands' then
        source_closure := source_closures->>(old_record->>'business_date');
        if source_closure is not null then
          if row_value=old_record and old_record#>>'{basis,closure_id}'=source_closure then
            continue;
          end if;
          before_basis := (old_record->'basis') || jsonb_build_object(
            'night_low',0,
            'archived_night_low',coalesce(old_record#>'{basis,archived_night_low}',old_record#>'{basis,night_low}'),
            'closure_id',source_closure
          );
          if row_value->'basis' is distinct from before_basis
            or (row_value->>'quantity')::float8 is distinct from 0::float8
            or row_value->>'last_correction_id' is distinct from source_closure
            or (row_value->>'reassessed_at')::timestamptz is distinct from assessed_at
            or row_value-array['digest','basis','quantity','last_correction_id','reassessed_at']
              is distinct from old_record-array['digest','basis','quantity','last_correction_id','reassessed_at'] then
            raise exception 'Verified closure exceeds demand scope' using errcode='42501';
          end if;
          continue;
        end if;
      end if;
      if row_value=old_record then continue; end if;$new$),
    ($old$  insert into public.waste_projection_assessment_payloads(assessment_id,restaurant_id,expires_at,input,result)$old$,
     $new$  if source_batch then
    applied_id := assessment_id;
    insert into public.waste_projection_corrections(id,restaurant_id,request_id,actor_id,reason,record)
      select e.id,target,e.id,e.actor_id,e.reason,jsonb_build_object(
        'id',e.id,'restaurant_id',target,'actor_id',e.actor_id,'reason',e.reason,
        'source_event_id',e.source_key,'source_at',e.source_at,
        'assessment_id',applied_id,'answer_revision',e.revision,
        'batch_ids',case when e.batch_id is null then '[]'::jsonb else jsonb_build_array(e.batch_id) end,
        'business_dates',case when e.business_date is null then '[]'::jsonb else jsonb_build_array(e.business_date) end
      )
      from projection_private.waste_correction_sources e
      join jsonb_array_elements(correction) s on e.id=(s->>'id')::uuid
      where e.restaurant_id=target and e.disposition='pending';
    update projection_private.waste_correction_sources e set
      disposition='applied',assessment_id=applied_id
      from jsonb_array_elements(correction) s
      where e.restaurant_id=target and e.id=(s->>'id')::uuid and e.disposition='pending';
  end if;
  insert into public.waste_projection_assessment_payloads(assessment_id,restaurant_id,expires_at,input,result)$new$),
    ($old$    if prior_id is not null and correction_id is null then$old$, $new$    source_closure := source_closures->>(row_value->>'business_date');
    if prior_id is not null and correction_id is null and source_closure is null then$new$),
    ($old$    if prior_id is null then
      perform 1 from public.projection_forecast_runs r join public.projection_forecast_nights n$old$,
     $new$    if prior_id is null then
      if row_value#>>'{basis,closure_id}' is distinct from source_closure
        or (source_closure is not null and (
          (row_value#>>'{basis,night_low}')::float8 is distinct from 0::float8
          or (row_value#>>'{basis,weighted_portion}')::float8 is distinct from 0::float8
          or row_value#>'{basis,contributions}' is distinct from '[]'::jsonb
          or row_value#>'{basis,uncovered_dishes}' is distinct from '[]'::jsonb
          or row_value#>'{basis,archived_night_low}' is null
          or row_value#>>'{basis,run_id}' is distinct from snapshot#>>'{forecast,id}'
          or row_value->>'last_correction_id' is distinct from source_closure
        )) then
        raise exception 'New freeze needs verified closure evidence' using errcode='42501';
      end if;
      perform 1 from public.projection_forecast_runs r join public.projection_forecast_nights n$new$),
    ($old$        and n.low::float8=(row_value#>>'{basis,night_low}')::float8;$old$,
     $new$        and (case when source_closure is null then n.low::float8=(row_value#>>'{basis,night_low}')::float8
          else n.low::float8 is not distinct from (row_value#>>'{basis,archived_night_low}')::float8 end);$new$)
  ) as hooks(old_text,new_text)
  loop
    if position(patch.old_text in definition) = 0
      or position(patch.old_text in substring(definition from position(patch.old_text in definition)
        + length(patch.old_text))) > 0 then
      raise exception 'Waste correction storage hook missing or ambiguous';
    end if;
    definition := replace(definition,patch.old_text,patch.new_text);
  end loop;
  execute definition;
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('public.waste_projection_daily_commit(uuid,uuid)'::regprocedure);
  hook constant text := '    out := public.waste_projection_commit(';
begin
  if position(hook in definition) = 0 then raise exception 'Waste daily correction commit hook missing'; end if;
  execute replace(definition,hook,$hook$
    if (j.envelope->'snapshot') ? 'correctionSources'
      and jsonb_typeof(j.envelope->'correction') is distinct from 'array' then
      raise exception 'Missing daily correction source list' using errcode='PT409';
    end if;
    out := public.waste_projection_commit($hook$);
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('projection_private.purge_account(uuid)'::regprocedure);
  hook constant text := $hook$foreach t in array array[
    'waste_projection_demands'$hook$;
begin
  if position(hook in definition) = 0 then raise exception 'Waste correction purge hook missing'; end if;
  execute replace(definition,hook,$hook$
    delete from projection_private.waste_correction_sources where restaurant_id = target;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object('waste_correction_sources',n);

    foreach t in array array[
    'waste_projection_demands'$hook$);
end;
$migration$;

notify pgrst, 'reload schema';

commit;