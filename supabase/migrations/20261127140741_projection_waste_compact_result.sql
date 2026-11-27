begin;

create function projection_private.compact_waste_assessment_result(
  full_result jsonb, assessment_day date, batches jsonb
)
returns jsonb language sql immutable set search_path = '' as $$
  with classified as (
    select item, ord, case
      when item->>'status' = 'unavailable' then 'review'
      when item->>'status' = 'ok' or (
        item->>'status' = 'overdue' and (item->>'use_by_date')::date >= assessment_day - 7
      ) then 'item'
      else 'summary'
    end as destination
    from jsonb_array_elements(full_result->'items') with ordinality as entries(item, ord)
  ), omitted as (
    select item->>'status' as status, jsonb_build_object(
      'count', count(*),
      'risk_value', sum((item->>'risk_value')::numeric),
      'unvalued_count', count(*) filter (where item->>'risk_value' is null)
    ) as totals
    from classified where destination = 'summary'
    group by item->>'status'
  )
  select (full_result - array['items','visible_items','needs_review','demand_trace','new_demands','new_cases'])
    || jsonb_build_object(
      'result_schema_version', 2,
      'items', coalesce((
        select jsonb_agg(item-'allocations' order by ord)
        from classified where destination = 'item'
      ), '[]'::jsonb),
      'needs_review', coalesce((
        select jsonb_agg((review.item-'allocations') || jsonb_build_object(
          'stock_remaining_qty', batch.value->'remaining_qty',
          'stock_unit', batch.value->'unit'
        ) order by review.ord)
        from classified review
        left join jsonb_array_elements(batches) batch(value)
          on batch.value->>'id' = review.item->>'batch_id'
        where review.destination = 'review'
      ), '[]'::jsonb),
      'omitted_by_status', coalesce((select jsonb_object_agg(status, totals) from omitted), '{}'::jsonb)
    );
$$;

revoke all on function projection_private.compact_waste_assessment_result(jsonb,date,jsonb)
  from public, anon, authenticated, service_role;

do $migration$
declare
  definition text;
  hook constant text := $hook$(result_copy-array['items','demand_trace','new_demands','new_cases','visible_items','needs_review'])
      ||jsonb_build_object('items',coalesce((select jsonb_agg(value-'allocations' order by ord)
        from jsonb_array_elements(result_copy->'items') with ordinality t(value,ord)),'[]'::jsonb))$hook$;
begin
  definition := pg_get_functiondef(
    'public.waste_projection_commit(uuid,uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure
  );
  if position(hook in definition) = 0 then
    raise exception 'Waste assessment result storage hook not found';
  end if;

  execute replace(definition, hook,
    'projection_private.compact_waste_assessment_result(result_copy,(snapshot->>''assessmentDate'')::date,snapshot->''batches'')');
end;
$migration$;

commit;