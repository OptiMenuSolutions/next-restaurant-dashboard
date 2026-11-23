begin;

create table projection_private.timezone_names (
  name text primary key
);

insert into projection_private.timezone_names(name)
select distinct name from pg_catalog.pg_timezone_names;

alter table projection_private.timezone_names enable row level security;
revoke all on projection_private.timezone_names from public,anon,authenticated,service_role;
grant select on projection_private.timezone_names to service_role;

comment on table projection_private.timezone_names is
  'Exact pg_timezone_names membership at installation. Refresh through a new migration after timezone-data upgrades; never infer or normalize names.';

analyze projection_private.timezone_names;

do $patch$
declare signature text; definition text; occurrences integer; expected integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('optimenu:projection-settings:4',0));
  foreach signature in array array[
    'projection_private.pos_source_clock(uuid,text,timestamptz)',
    'projection_private.run_timing(uuid,timestamptz)',
    'projection_private.ingestion_context(uuid,date,timestamptz)',
    'projection_private.calendar_context_before_nightly(uuid,date,date,timestamptz)',
    'projection_private.lifecycle_context_before_nightly(uuid,date,timestamptz)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    occurrences:=(length(definition)-length(replace(definition,'pg_timezone_names','')))
      /length('pg_timezone_names');
    expected:=case when signature like '%pos_source_clock%' then 2 else 1 end;
    if occurrences<>expected or strpos(definition,'pg_catalog.pg_timezone_names')>0 then
      raise exception 'Unexpected timezone validation in %: % references',signature,occurrences;
    end if;
    execute replace(definition,'pg_timezone_names','projection_private.timezone_names');
  end loop;
end;
$patch$;

commit;