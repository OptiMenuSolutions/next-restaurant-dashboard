begin;

do $fix$
declare
  definition text;
  old_text text;
  new_text text;
  constraint_name text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-settings:4', 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('optimenu:projection-calendar', 0)
  );

  definition := pg_get_functiondef(
    'public.projection_benchmark_catalog()'::regprocedure
  );
  old_text := $old$'name',r.name,$old$;
  new_text := $new$'name',coalesce(nullif(btrim(r.name),''),'Unnamed restaurant'),$new$;
  if strpos(definition, old_text) = 0 then
    raise exception 'Unexpected benchmark catalog definition';
  end if;
  execute replace(definition, old_text, new_text);

  definition := pg_get_functiondef(
    'public.projection_stage_benchmark(jsonb)'::regprocedure
  );
  old_text := $old$vid,r.id,r.name,upper(to_jsonb(r)->>'shipping_state'),cfg.concept_type,$old$;
  new_text := $new$vid,r.id,coalesce(nullif(btrim(r.name),''),'Unnamed restaurant'),upper(to_jsonb(r)->>'shipping_state'),cfg.concept_type,$new$;
  if strpos(definition, old_text) = 0 then
    raise exception 'Unexpected benchmark staging definition';
  end if;
  execute replace(definition, old_text, new_text);

  select conname into strict constraint_name
  from pg_constraint
  where conrelid = 'public.projection_benchmark_versions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%vintage%'
    and pg_get_constraintdef(oid) like '%created_at%';

  execute format(
    'alter table public.projection_benchmark_versions drop constraint %I',
    constraint_name
  );
  alter table public.projection_benchmark_versions
    add constraint projection_benchmark_vintage_utc
    check (vintage <= (created_at at time zone 'UTC')::date);
end;
$fix$;

commit;