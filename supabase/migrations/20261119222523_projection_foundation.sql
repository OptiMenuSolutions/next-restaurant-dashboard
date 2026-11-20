begin;

-- Storage only. No cron, forecast consumer or customer-facing policy is enabled.
create schema projection_private;
revoke all on schema projection_private from public, anon, authenticated;
grant usage on schema projection_private to service_role;

create function projection_private.settings_template() returns jsonb
language sql immutable set search_path = '' as $fn$
  select '{
    "enabled": false,
    "horizon_days": 8,
    "business_day_cutoff_minutes": 240,
    "sync_buffer_minutes": 60,
    "base_window_weeks": 8,
    "volume_half_life_weeks": 4,
    "share_half_life_weeks": 4,
    "volume_recent_weight": 0.5,
    "category_base_weight": 0.5,
    "trend_damping": 0.8,
    "weekly_slope_cap": 0.05,
    "minimum_trend_weeks": 4,
    "minimum_history_weeks": 2,
    "cold_start_weeks": 8,
    "own_seasonality_weeks": 52,
    "year_alignment_days": 364,
    "seasonal_smoothing_weeks": 3,
    "seasonal_ratio_min": 0.75,
    "seasonal_ratio_max": 1.33,
    "minimum_ly_weekday_nights": 4,
    "minimum_weekday_nights": 2,
    "maximum_volume_lookback_weeks": 16,
    "census_strength": 0.5,
    "google_trends_strength": 0.25,
    "share_trend_enabled": false,
    "weekday_mix_enabled": false,
    "weekday_mix_prior_nights": 8,
    "recommendation_treatment": "exclude",
    "assumed_recommendation_lift": 0.25,
    "minimum_clean_dish_nights": 10,
    "maximum_dish_lookback_weeks": 16,
    "new_dish_prior_nights": 7,
    "new_dish_weeks": 8,
    "maximum_new_dish_share": 0.5,
    "launch_index_min": 0.5,
    "launch_index_max": 2,
    "default_launch_index": 1,
    "early_close_factor": 0.6,
    "outlier_ratio_min": 0.65,
    "outlier_ratio_max": 1.35,
    "shift_run_nights": 3,
    "post_run_nights": 3,
    "comparison_decimal_places": 12,
    "range_coverage": 0.8,
    "range_z_override": null,
    "volume_half_width_near": 0.15,
    "volume_half_width_far": 0.25,
    "cold_start_range_multiplier": 1.5,
    "empirical_lookback_weeks": 12,
    "minimum_empirical_weeks": 8,
    "maximum_new_dish_range_multiplier": 2,
    "bias_threshold": 0.1,
    "bias_consecutive_weeks": 4,
    "owner_estimates_enabled": false,
    "public_benchmarks_enabled": true,
    "pooled_benchmarks_enabled": false,
    "minimum_pooled_restaurants": 5
  }'::jsonb;
$fn$;

create function projection_private.check_settings(
  p jsonb,
  partial boolean default false
)
returns boolean language plpgsql immutable set search_path = '' as $fn$
declare
  template jsonb := projection_private.settings_template();
  k text;
  v jsonb;
  n numeric;
  s jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  if partial and p ? 'pooled_benchmarks_enabled' then
    return false;
  end if;

  if not partial and
    (select count(*) from jsonb_object_keys(p)) <>
    (select count(*) from jsonb_object_keys(template))
  then
    return false;
  end if;

  for k, v in select * from jsonb_each(p) loop
    if not template ? k then
      return false;
    end if;

    if k = 'range_z_override' and v = 'null'::jsonb then
      continue;
    end if;

    if k = 'recommendation_treatment' then
      if v not in ('"exclude"'::jsonb, '"adjust"'::jsonb) then
        return false;
      end if;
      continue;
    end if;

    if jsonb_typeof(template->k) = 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then
        return false;
      end if;
      continue;
    end if;

    if jsonb_typeof(v) <> 'number' then
      return false;
    end if;

    n := (v #>> '{}')::numeric;

    if k = any(array[
      'horizon_days','business_day_cutoff_minutes','sync_buffer_minutes',
      'base_window_weeks','year_alignment_days','seasonal_smoothing_weeks',
      'minimum_ly_weekday_nights','minimum_weekday_nights',
      'maximum_volume_lookback_weeks','minimum_clean_dish_nights',
      'maximum_dish_lookback_weeks','shift_run_nights','post_run_nights',
      'comparison_decimal_places','bias_consecutive_weeks',
      'minimum_pooled_restaurants'
    ]) and (n <> trunc(n) or abs(n) > 9007199254740991) then
      return false;
    end if;

    if k = any(array[
      'volume_recent_weight','category_base_weight','trend_damping',
      'maximum_new_dish_share','census_strength','google_trends_strength'
    ]) then
      if n < 0 or n > 1 then return false; end if;
    elsif k = any(array[
      'weekly_slope_cap','assumed_recommendation_lift','bias_threshold',
      'sync_buffer_minutes'
    ]) then
      if n < 0 then return false; end if;
    elsif k = 'business_day_cutoff_minutes' then
      if n < 0 or n >= 1440 then return false; end if;
    elsif k = 'comparison_decimal_places' then
      if n < 0 or n > 15 then return false; end if;
    elsif n <= 0 then
      return false;
    end if;
  end loop;

  if partial then
    return true;
  end if;

  s := p;

  return
    (s->>'seasonal_smoothing_weeks')::integer % 2 = 1
    and (s->>'seasonal_ratio_min')::numeric <= 1
    and (s->>'seasonal_ratio_max')::numeric >= 1
    and (s->>'outlier_ratio_min')::numeric < 1
    and (s->>'outlier_ratio_max')::numeric > 1
    and (s->>'launch_index_min')::numeric
      <= (s->>'default_launch_index')::numeric
    and (s->>'default_launch_index')::numeric
      <= (s->>'launch_index_max')::numeric
    and (s->>'range_coverage')::numeric < 1
    and (s->>'volume_half_width_near')::numeric
      <= (s->>'volume_half_width_far')::numeric
    and (s->>'maximum_volume_lookback_weeks')::numeric
      >= (s->>'base_window_weeks')::numeric
    and (s->>'maximum_dish_lookback_weeks')::numeric
      >= (s->>'base_window_weeks')::numeric
    and (s->>'empirical_lookback_weeks')::numeric
      >= (s->>'minimum_empirical_weeks')::numeric
    and (s->>'minimum_history_weeks')::numeric
      <= (s->>'minimum_trend_weeks')::numeric
    and (s->>'minimum_trend_weeks')::numeric
      <= (s->>'cold_start_weeks')::numeric
    and (s->>'cold_start_weeks')::numeric
      <= (s->>'own_seasonality_weeks')::numeric
    and (s->>'cold_start_range_multiplier')::numeric >= 1
    and (s->>'maximum_new_dish_range_multiplier')::numeric >= 1
    and (s->>'minimum_pooled_restaurants')::numeric >= 5;
end;
$fn$;

create function projection_private.calibration_key(
  major integer,
  s jsonb
) returns text
language sql immutable strict set search_path = '' as $fn$
  select major::text
    || '|a=' || trim_scale((s->>'volume_recent_weight')::numeric)::text
    || '|b=' || trim_scale((s->>'category_base_weight')::numeric)::text
    || '|phi=' || trim_scale((s->>'trend_damping')::numeric)::text
    || '|vh=' || trim_scale((s->>'volume_half_life_weeks')::numeric)::text
    || '|sh=' || trim_scale((s->>'share_half_life_weeks')::numeric)::text;
$fn$;

create table public.projection_model_versions (
  model_major integer primary key check (model_major > 0),
  logic_revision text not null check (length(trim(logic_revision)) > 0),
  settings_template jsonb not null
    check (projection_private.check_settings(settings_template)),
  calibration_key text generated always as (
    projection_private.calibration_key(model_major, settings_template)
  ) stored,
  reference_sha256 text not null
    check (reference_sha256 ~ '^[0-9a-f]{64}$'),
  released_at timestamptz not null default now()
);

insert into public.projection_model_versions
  (model_major, logic_revision, settings_template, reference_sha256)
values (
  4,
  'approved-workbook-v4',
  projection_private.settings_template(),
  '97e91fb3cf46e6b4726cb121f00f8b70f3fcb42eb914059fdf8fa40a6865b882'
);

create table public.projection_setting_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  model_major integer not null references public.projection_model_versions,
  effective_at timestamptz not null,
  settings jsonb not null check (
    projection_private.check_settings(settings, restaurant_id is not null)
  ),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique nulls not distinct (restaurant_id, model_major, effective_at)
);

insert into public.projection_setting_versions
  (model_major, effective_at, settings)
select model_major, released_at, settings_template
from public.projection_model_versions;

create table public.projection_restaurant_config (
  restaurant_id uuid primary key
    references public.restaurants(id) on delete cascade,
  concept_type text check (
    concept_type in ('full_service','bar_pub','quick_service')
  ),
  region_code text,
  first_data_date date,
  normally_closed_weekdays smallint[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (
    normally_closed_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  )
);

comment on table public.projection_restaurant_config is
  'Timezone remains restaurants.operational_timezone. Cutoff and buffer are versioned settings.';

create table public.projection_style_categories (
  code text primary key,
  label text not null,
  search_terms text[] not null default '{}'
);

create table public.projection_dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  style_category text references public.projection_style_categories,
  forecastable boolean not null default false,
  is_new boolean not null default false,
  launch_date date,
  removed_date date,
  is_returning boolean not null default false,
  last_season_category_count integer
    check (last_season_category_count >= 0),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  check (
    removed_date is null
    or launch_date is null
    or removed_date >= launch_date
  )
);

create index projection_dishes_menu_idx
  on public.projection_dishes(menu_item_id);

create index projection_dishes_style_idx
  on public.projection_dishes(style_category);

create table public.projection_pos_item_map (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  pos_system text not null,
  external_item_id text not null,
  dish_id uuid not null,
  valid_from date not null,
  valid_until date,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, dish_id)
    references public.projection_dishes(restaurant_id, id),
  check (valid_until is null or valid_until > valid_from),
  unique (restaurant_id, pos_system, external_item_id, valid_from)
);

create index projection_pos_map_dish_idx
  on public.projection_pos_item_map(restaurant_id, dish_id);

create function projection_private.valid_holiday_keys(keys text[])
returns boolean language sql immutable set search_path = '' as $fn$
  select keys is not null
    and not exists (
      select 1
      from unnest(keys) as t(k)
      where k is null or k !~ '^[a-z][a-z0-9_]*$'
    )
    and keys = array(
      select distinct k collate "C"
      from unnest(keys) as t(k)
      order by k collate "C"
    );
$fn$;

create table public.projection_nightly_flags (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  business_date date not null,
  complete boolean not null default false,
  closed boolean not null default false,
  early_close boolean not null default false,
  holiday_keys text[] not null default '{}'
    check (projection_private.valid_holiday_keys(holiday_keys)),
  recommendation_flags_complete boolean not null default false,
  total_units numeric check (
    total_units > '-Infinity'::numeric
    and total_units < 'Infinity'::numeric
  ),
  outlier_status text not null default 'unchecked',
  source_revision text,
  flags jsonb not null default '{}'
    check (jsonb_typeof(flags) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, business_date),
  check (
    not complete or (total_units is not null and total_units >= 0)
  )
);

create table public.projection_nightly_dish_facts (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  business_date date not null,
  dish_id uuid not null,
  units numeric not null check (
    units > '-Infinity'::numeric and units < 'Infinity'::numeric
  ),
  recommended boolean,
  sold_out boolean,
  source_revision text not null,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, business_date, dish_id),
  foreign key (restaurant_id, dish_id)
    references public.projection_dishes(restaurant_id, id)
);

create index projection_facts_dish_idx
  on public.projection_nightly_dish_facts(
    restaurant_id, dish_id, business_date
  );

create table public.projection_owner_answers (
  restaurant_id uuid primary key
    references public.restaurants(id) on delete cascade,
  holiday_answers jsonb not null default '{}'
    check (jsonb_typeof(holiday_answers) = 'object'),
  weekday_estimates jsonb not null default '{}'
    check (jsonb_typeof(weekday_estimates) = 'object'),
  dish_estimates jsonb not null default '{}'
    check (jsonb_typeof(dish_estimates) = 'object'),
  answered_by uuid,
  updated_at timestamptz not null default now()
);

create table public.projection_change_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  table_name text not null,
  operation text not null check (operation in ('INSERT','UPDATE')),
  previous_row jsonb,
  replacement_row jsonb not null,
  changed_at timestamptz not null default now(),
  actor_id uuid
);

create index projection_change_log_rest_idx
  on public.projection_change_log(restaurant_id, changed_at, id);

create table public.projection_forecast_runs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  run_date date not null,
  model_major integer not null references public.projection_model_versions,
  global_version_id uuid not null
    references public.projection_setting_versions,
  restaurant_version_id uuid
    references public.projection_setting_versions,
  settings_snapshot jsonb not null
    check (projection_private.check_settings(settings_snapshot)),
  settings_digest text not null
    check (settings_digest ~ '^[0-9a-f]{64}$'),
  calibration_key text not null,
  source_through date not null check (source_through < run_date),
  issued_at timestamptz not null default now(),
  supersedes_id uuid unique check (supersedes_id <> id),
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  unique (restaurant_id, id),
  unique (restaurant_id, run_date, model_major, id),
  foreign key (restaurant_id, run_date, model_major, supersedes_id)
    references public.projection_forecast_runs(
      restaurant_id, run_date, model_major, id
    )
);

create unique index projection_run_original_idx
  on public.projection_forecast_runs(
    restaurant_id, run_date, model_major
  )
  where supersedes_id is null;

create index projection_run_global_idx
  on public.projection_forecast_runs(global_version_id);

create index projection_run_override_idx
  on public.projection_forecast_runs(restaurant_version_id);

create index projection_run_model_idx
  on public.projection_forecast_runs(model_major);

create table public.projection_forecast_nights (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  run_id uuid not null,
  target_date date not null,
  days_ahead integer not null check (days_ahead > 0),
  availability text not null check (
    availability in ('available','needs_baseline','closed')
  ),
  expected numeric,
  low numeric,
  high numeric,
  confidence text not null,
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  primary key (restaurant_id, run_id, target_date),
  unique (restaurant_id, run_id, days_ahead),
  foreign key (restaurant_id, run_id)
    references public.projection_forecast_runs(restaurant_id, id)
    on delete cascade,
  check (
    (
      availability = 'needs_baseline'
      and expected is null
      and low is null
      and high is null
    )
    or (
      availability <> 'needs_baseline'
      and low is not null
      and expected is not null
      and high is not null
      and 0 <= low
      and low <= expected
      and expected <= high
      and high < 'Infinity'::numeric
    )
  ),
  check (
    availability <> 'closed'
    or (low = 0 and expected = 0 and high = 0)
  )
);

create table public.projection_forecast_dishes (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  run_id uuid not null,
  target_date date not null,
  dish_id uuid not null,
  share numeric check (share >= 0 and share <= 1),
  expected numeric,
  low numeric,
  high numeric,
  confidence text not null,
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  primary key (restaurant_id, run_id, target_date, dish_id),
  foreign key (restaurant_id, run_id, target_date)
    references public.projection_forecast_nights on delete cascade,
  foreign key (restaurant_id, dish_id)
    references public.projection_dishes(restaurant_id, id),
  check (
    (expected is null and low is null and high is null)
    or (
      expected is not null
      and low is not null
      and high is not null
      and 0 <= low
      and low <= expected
      and expected <= high
      and high < 'Infinity'::numeric
    )
  )
);

create index projection_forecast_dish_idx
  on public.projection_forecast_dishes(
    restaurant_id, dish_id, target_date
  );

create table public.projection_run_decisions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  model_major integer not null references public.projection_model_versions,
  calibration_key text not null,
  direction smallint not null check (direction in (-1,1)),
  decision text not null check (
    decision in ('one_off_event','confirmed_shift')
  ),
  decided_through date not null,
  counterfactuals jsonb not null check (
    jsonb_typeof(counterfactuals) = 'array'
    and jsonb_array_length(counterfactuals) > 0
  ),
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  created_at timestamptz not null default now(),
  unique (restaurant_id, id)
);

create index projection_decision_model_idx
  on public.projection_run_decisions(model_major);

create table public.projection_run_decision_nights (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  business_date date not null,
  decision_id uuid not null,
  primary key (restaurant_id, business_date),
  foreign key (restaurant_id, decision_id)
    references public.projection_run_decisions(restaurant_id, id)
    on delete cascade
);

create index projection_decision_members_idx
  on public.projection_run_decision_nights(
    restaurant_id, decision_id
  );

create table public.projection_holiday_calendar (
  holiday_date date not null,
  holiday_key text not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  primary key (holiday_date, holiday_key)
);

create table public.projection_holiday_rule_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  concept_type text not null check (
    concept_type in ('full_service','bar_pub','quick_service')
  ),
  holiday_key text not null,
  weekday_group text not null default 'all'
    check (weekday_group in ('all','mon_thu','fri_sat','sun')),
  effective_at timestamptz not null,
  default_factor numeric not null check (
    default_factor > 0 and default_factor < 'Infinity'::numeric
  ),
  default_answer text not null check (
    default_answer in ('open','closed','early_close')
  ),
  unique nulls not distinct (
    restaurant_id,
    concept_type,
    holiday_key,
    weekday_group,
    effective_at
  )
);

create table public.projection_holiday_observations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  business_date date not null,
  holiday_keys text[] not null check (
    cardinality(holiday_keys) > 0
    and projection_private.valid_holiday_keys(holiday_keys)
  ),
  observed_ratio numeric not null check (
    observed_ratio >= 0 and observed_ratio < 'Infinity'::numeric
  ),
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  supersedes_id uuid check (supersedes_id <> id),
  created_at timestamptz not null default now(),
  unique (restaurant_id, business_date, id),
  foreign key (restaurant_id, business_date, supersedes_id)
    references public.projection_holiday_observations(
      restaurant_id, business_date, id
    )
);

create index projection_holiday_observation_idx
  on public.projection_holiday_observations(
    restaurant_id, business_date, id
  );

create unique index projection_holiday_supersedes_idx
  on public.projection_holiday_observations(
    restaurant_id, supersedes_id
  )
  where supersedes_id is not null;

create unique index projection_holiday_original_idx
  on public.projection_holiday_observations(
    restaurant_id, business_date
  )
  where supersedes_id is null;

create table public.projection_launch_history (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  dish_id uuid not null,
  style_category text not null references public.projection_style_categories,
  launch_date date not null,
  observed_through date not null,
  existing_dishes integer not null check (existing_dishes >= 0),
  first_four_week_share numeric not null check (
    first_four_week_share >= 0 and first_four_week_share <= 1
  ),
  launch_index numeric not null check (
    launch_index >= 0 and launch_index < 'Infinity'::numeric
  ),
  trace jsonb not null check (jsonb_typeof(trace) = 'object'),
  supersedes_id uuid check (supersedes_id <> id),
  created_at timestamptz not null default now(),
  unique (restaurant_id, dish_id, launch_date, id),
  foreign key (restaurant_id, dish_id)
    references public.projection_dishes(restaurant_id, id),
  foreign key (restaurant_id, dish_id, launch_date, supersedes_id)
    references public.projection_launch_history(
      restaurant_id, dish_id, launch_date, id
    ),
  check (observed_through >= launch_date)
);

create index projection_launch_dish_idx
  on public.projection_launch_history(
    restaurant_id, dish_id, launch_date
  );

create index projection_launch_style_idx
  on public.projection_launch_history(style_category);

create unique index projection_launch_supersedes_idx
  on public.projection_launch_history(restaurant_id, supersedes_id)
  where supersedes_id is not null;

create unique index projection_launch_original_idx
  on public.projection_launch_history(
    restaurant_id, dish_id, launch_date
  )
  where supersedes_id is null;

create view public.projection_current_holiday_observations
with (security_invoker = true) as
select o.*
from public.projection_holiday_observations o
where not exists (
  select 1
  from public.projection_holiday_observations c
  where c.restaurant_id = o.restaurant_id
    and c.supersedes_id = o.id
);

create view public.projection_current_launch_history
with (security_invoker = true) as
select o.*
from public.projection_launch_history o
where not exists (
  select 1
  from public.projection_launch_history c
  where c.restaurant_id = o.restaurant_id
    and c.supersedes_id = o.id
);

create table public.projection_benchmark_pulls (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (
    provider in ('fred_census','fred_cpi','google_trends')
  ),
  fetched_at timestamptz not null default now(),
  query_metadata jsonb not null
    check (jsonb_typeof(query_metadata) = 'object'),
  payload jsonb not null,
  payload_sha256 text not null
    check (payload_sha256 ~ '^[0-9a-f]{64}$')
);

create table public.projection_pool_permissions (
  restaurant_id uuid primary key
    references public.restaurants(id) on delete cascade,
  agreement_permits boolean not null default false,
  enabled boolean not null default false,
  agreement_version text,
  authorized_by uuid,
  updated_at timestamptz not null default now(),
  check (
    not enabled
    or (
      agreement_permits
      and nullif(trim(agreement_version), '') is not null
    )
  )
);

create table public.projection_pool_cohorts (
  cohort_key text primary key,
  concept_type text not null,
  region_code text not null,
  style_category text references public.projection_style_categories
);

create index projection_cohort_style_idx
  on public.projection_pool_cohorts(style_category);

create table public.projection_pool_memberships (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  cohort_key text not null references public.projection_pool_cohorts,
  eligible boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, cohort_key)
);

create index projection_membership_cohort_idx
  on public.projection_pool_memberships(
    cohort_key, restaurant_id
  );

create table public.projection_pooled_totals (
  id uuid primary key default gen_random_uuid(),
  cohort_key text not null references public.projection_pool_cohorts,
  metric text not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  participant_count integer not null check (participant_count >= 5),
  statistics jsonb not null
    check (jsonb_typeof(statistics) = 'object'),
  computed_at timestamptz not null default now(),
  unique (
    cohort_key,
    metric,
    period_start,
    period_end
  )
);

comment on column public.projection_pooled_totals.statistics is
  'Aggregate totals only. Never identifiers, participant lists, menus or per-restaurant values.';

create function projection_private.validate_pooled_period() returns trigger
language plpgsql set search_path = '' as $fn$
declare
  major integer;
  base jsonb;
  s jsonb;
  r record;
  participants integer := 0;
  closes_at timestamptz;
begin
  new.computed_at := clock_timestamp();

  select model_major into major
  from public.projection_model_versions
  where released_at <= new.computed_at
  order by released_at desc, model_major desc
  limit 1;

  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-settings:' || major::text, 0
  ));

  new.computed_at := clock_timestamp();

  select settings into base
  from public.projection_setting_versions
  where restaurant_id is null
    and model_major = major
    and effective_at <= new.computed_at
  order by effective_at desc
  limit 1;

  if base is null
    or not (base->>'pooled_benchmarks_enabled')::boolean
  then
    raise exception 'Pooled benchmarks are globally disabled'
      using errcode = '23514';
  end if;

  for r in
    select m.restaurant_id, a.operational_timezone
    from public.projection_pool_memberships m
    join public.projection_pool_permissions p using (restaurant_id)
    join public.restaurants a on a.id = m.restaurant_id
    where m.cohort_key = new.cohort_key
      and m.eligible
      and p.enabled
      and p.agreement_permits
      and a.deactivated_at is null
    order by m.restaurant_id
  loop
    participants := participants + 1;

    if r.operational_timezone is null
      or not exists (
        select 1
        from pg_timezone_names
        where name = r.operational_timezone
      )
    then
      raise exception
        'Valid operational timezone required for pooled participant %',
        r.restaurant_id
        using errcode = '23514';
    end if;

    select base || coalesce((
      select settings
      from public.projection_setting_versions
      where restaurant_id = r.restaurant_id
        and model_major = major
        and effective_at <= new.computed_at
      order by effective_at desc
      limit 1
    ), '{}'::jsonb) into s;

    closes_at := (
      (new.period_end + 1)::timestamp
      + make_interval(mins =>
        (s->>'business_day_cutoff_minutes')::integer
        + (s->>'sync_buffer_minutes')::integer
      )
    ) at time zone r.operational_timezone;

    if new.computed_at < closes_at then
      raise exception
        'Pooled period is not closed for restaurant %',
        r.restaurant_id
        using errcode = '23514';
    end if;
  end loop;

  if participants < 5 then
    raise exception
      'Pooled totals require at least 5 eligible restaurants'
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

create trigger projection_pool_period_validate
before insert on public.projection_pooled_totals
for each row execute function projection_private.validate_pooled_period();

create table public.projection_benchmark_ratios (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (
    provider in ('census','google_trends','pooled')
  ),
  series_key text not null,
  week_start date not null,
  ratio numeric not null check (
    ratio > 0 and ratio < 'Infinity'::numeric
  ),
  pull_id uuid references public.projection_benchmark_pulls,
  cpi_pull_id uuid references public.projection_benchmark_pulls,
  pooled_total_id uuid references public.projection_pooled_totals,
  updated_at timestamptz not null default now(),
  unique (provider, series_key, week_start),
  check (
    (
      provider = 'pooled'
      and pooled_total_id is not null
      and pull_id is null
      and cpi_pull_id is null
    )
    or (
      provider = 'census'
      and pooled_total_id is null
      and pull_id is not null
      and cpi_pull_id is not null
    )
    or (
      provider = 'google_trends'
      and pooled_total_id is null
      and pull_id is not null
      and cpi_pull_id is null
    )
  )
);

create index projection_ratio_pull_idx
  on public.projection_benchmark_ratios(pull_id);

create index projection_ratio_cpi_idx
  on public.projection_benchmark_ratios(cpi_pull_id);

create index projection_ratio_pool_idx
  on public.projection_benchmark_ratios(pooled_total_id);

create table public.projection_benchmark_status (
  provider text primary key,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  stale boolean not null default true,
  failure_code text
);

create view public.projection_available_pooled_totals
with (security_invoker = true) as
select p.*
from public.projection_pooled_totals p
join (
  select m.cohort_key
  from public.projection_pool_memberships m
  join public.projection_pool_permissions a using (restaurant_id)
  join public.restaurants r on r.id = m.restaurant_id
  where m.eligible
    and a.enabled
    and a.agreement_permits
    and r.deactivated_at is null
  group by m.cohort_key
  having count(*) >= 5
) c using (cohort_key);

create view public.projection_available_benchmark_ratios
with (security_invoker = true) as
select r.*
from public.projection_benchmark_ratios r
where r.provider <> 'pooled'
  or exists (
    select 1
    from public.projection_available_pooled_totals p
    where p.id = r.pooled_total_id
  );

create table public.projection_account_purge_log (
  id uuid primary key default gen_random_uuid(),
  account_hash text not null
    check (account_hash ~ '^[0-9a-f]{64}$'),
  purged_at timestamptz not null default now(),
  authorized_role text not null,
  authorized_actor uuid,
  deleted_rows jsonb not null
    check (jsonb_typeof(deleted_rows) = 'object')
);

create table projection_private.purge_salt (
  singleton boolean primary key default true check (singleton),
  value text not null
);

insert into projection_private.purge_salt(value)
values (gen_random_uuid()::text || gen_random_uuid()::text);

revoke all on projection_private.purge_salt
  from public, anon, authenticated, service_role;

-- A protected transaction capability, not a caller-spoofable session variable.
create table projection_private.purge_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  target uuid not null,
  primary key (backend_pid, transaction_id)
);

revoke all on projection_private.purge_context
  from public, anon, authenticated, service_role;

create function projection_private.is_account_purge(
  restaurant uuid
) returns boolean
language sql security definer set search_path = '' as $fn$
  select exists (
    select 1
    from projection_private.purge_context c
    where c.backend_pid = pg_backend_pid()
      and c.transaction_id = txid_current()
      and c.target = restaurant
  );
$fn$;

create function projection_private.immutable_row() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    if projection_private.is_account_purge(
      (to_jsonb(old)->>'restaurant_id')::uuid
    ) then
      return old;
    end if;
  end if;

  raise exception 'Projection history is append-only'
    using errcode = '42501';
end;
$fn$;

create function projection_private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if projection_private.is_account_purge(new.restaurant_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;

  insert into public.projection_change_log
    (
      restaurant_id,
      table_name,
      operation,
      previous_row,
      replacement_row,
      actor_id
    )
  values (
    new.restaurant_id,
    tg_table_name,
    tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new),
    auth.uid()
  );

  return new;
end;
$fn$;

create function projection_private.validate_version() returns trigger
language plpgsql set search_path = '' as $fn$
declare
  template jsonb;
  k text;
  bad record;
  problem text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-settings:' || new.model_major::text, 0
  ));

  if not projection_private.check_settings(
    new.settings,
    new.restaurant_id is not null
  ) then
    raise exception 'Projection settings violate check constraint'
      using errcode = '23514';
  end if;

  select settings_template into strict template
  from public.projection_model_versions
  where model_major = new.model_major;

  if new.restaurant_id is null then
    foreach k in array array[
      'volume_recent_weight',
      'category_base_weight',
      'trend_damping',
      'volume_half_life_weeks',
      'share_half_life_weeks'
    ] loop
      if new.settings->k is distinct from template->k then
        raise exception
          'Changed global major defaults require a new model version';
      end if;
    end loop;
  elsif not exists (
    select 1
    from public.projection_setting_versions
    where restaurant_id is null
      and model_major = new.model_major
      and effective_at <= new.effective_at
  ) then
    raise exception
      'Restaurant override has no valid effective global context';
  end if;

  -- Validate every affected overlap, including scheduled future versions.
  -- A latest override replaces its predecessor only from its effective date.
  with versions as (
    select id, restaurant_id, effective_at, settings
    from public.projection_setting_versions
    where model_major = new.model_major

    union all

    select new.id, new.restaurant_id, new.effective_at, new.settings
  ), globals as (
    select *,
      lead(effective_at, 1, 'infinity'::timestamptz)
        over (order by effective_at) as until_at
    from versions
    where restaurant_id is null
  ), overrides as (
    select *,
      lead(effective_at, 1, 'infinity'::timestamptz)
        over (
          partition by restaurant_id
          order by effective_at
        ) as until_at
    from versions
    where restaurant_id is not null
  )
  select
    o.restaurant_id,
    g.settings || o.settings as merged
  into bad
  from globals g
  join overrides o
    on g.effective_at < o.until_at
    and o.effective_at < g.until_at
  where (g.id = new.id or o.id = new.id)
    and not projection_private.check_settings(g.settings || o.settings)
  order by
    o.restaurant_id,
    greatest(g.effective_at, o.effective_at)
  limit 1;

  if found then
    problem := case
      when (bad.merged->>'volume_half_width_near')::numeric >
        (bad.merged->>'volume_half_width_far')::numeric
      then 'volume_half_width_near exceeds volume_half_width_far'
      else 'combined values violate projection settings constraints'
    end;

    raise exception
      'Invalid merged settings for restaurant %: %',
      bad.restaurant_id,
      problem
      using errcode = '23514', detail = bad.merged::text;
  end if;

  return new;
end;
$fn$;

create trigger projection_setting_validate
before insert on public.projection_setting_versions
for each row execute function projection_private.validate_version();

create function projection_private.validate_archive() returns trigger
language plpgsql set search_path = '' as $fn$
declare
  g public.projection_setting_versions;
  o public.projection_setting_versions;
  s jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'optimenu:projection-settings:' || new.model_major::text, 0
  ));

  -- Issuance is the actual database save time, after any settings writer.
  new.issued_at := clock_timestamp();

  select * into g
  from public.projection_setting_versions
  where restaurant_id is null
    and model_major = new.model_major
    and effective_at <= new.issued_at
  order by effective_at desc
  limit 1;

  if g.id is null or new.global_version_id is distinct from g.id then
    raise exception 'Archive global settings context is invalid: latest effective version required'
      using errcode = '23514';
  end if;

  select * into o
  from public.projection_setting_versions
  where restaurant_id = new.restaurant_id
    and model_major = new.model_major
    and effective_at <= new.issued_at
  order by effective_at desc
  limit 1;

  if new.restaurant_version_id is distinct from o.id then
    raise exception 'Archive override context is invalid: latest effective override required'
      using errcode = '23514';
  end if;

  s := g.settings || coalesce(o.settings, '{}'::jsonb);

  if s <> new.settings_snapshot then
    raise exception 'Archive settings snapshot does not match its versions';
  end if;

  if new.calibration_key <>
    projection_private.calibration_key(new.model_major, s)
  then
    raise exception 'Archive calibration key is invalid';
  end if;

  return new;
end;
$fn$;

create trigger projection_archive_validate
before insert on public.projection_forecast_runs
for each row execute function projection_private.validate_archive();

create function projection_private.validate_target() returns trigger
language plpgsql set search_path = '' as $fn$
declare
  r public.projection_forecast_runs;
begin
  select * into strict r
  from public.projection_forecast_runs
  where restaurant_id = new.restaurant_id
    and id = new.run_id;

  if new.days_ahead > (r.settings_snapshot->>'horizon_days')::integer
    or new.target_date <> r.run_date + new.days_ahead - 1
  then
    raise exception 'Forecast target is outside its run horizon';
  end if;

  return new;
end;
$fn$;

create trigger projection_target_validate
before insert on public.projection_forecast_nights
for each row execute function projection_private.validate_target();

create function projection_private.validate_dish() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if new.menu_item_id is not null
    and not exists (
      select 1
      from public.menu_items
      where id = new.menu_item_id
        and restaurant_id = new.restaurant_id
    )
  then
    raise exception 'Menu item belongs to another restaurant'
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

create trigger projection_dish_validate
before insert or update on public.projection_dishes
for each row execute function projection_private.validate_dish();

create function projection_private.validate_mapping() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE'
    and (
      new.restaurant_id,
      new.pos_system,
      new.external_item_id,
      new.valid_from,
      new.dish_id
    ) is distinct from (
      old.restaurant_id,
      old.pos_system,
      old.external_item_id,
      old.valid_from,
      old.dish_id
    )
  then
    raise exception
      'Close the old mapping and insert a new version';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.restaurant_id::text
      || ':' || new.pos_system
      || ':' || new.external_item_id,
    0
  ));

  if exists (
    select 1
    from public.projection_pos_item_map m
    where m.restaurant_id = new.restaurant_id
      and m.pos_system = new.pos_system
      and m.external_item_id = new.external_item_id
      and m.id <> new.id
      and daterange(m.valid_from, m.valid_until, '[)')
        && daterange(new.valid_from, new.valid_until, '[)')
  ) then
    raise exception 'POS mapping date ranges overlap'
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

create trigger projection_map_validate
before insert or update on public.projection_pos_item_map
for each row execute function projection_private.validate_mapping();

-- Preserve the existing purge implementation behind the authorized wrapper.
alter function public.purge_restaurant(uuid)
  rename to purge_restaurant_before_projections;

revoke all on function public.purge_restaurant_before_projections(uuid)
  from public, anon, authenticated, service_role;

create function projection_private.purge_account(
  target uuid
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  t text;
  n bigint;
  counts jsonb := '{}';
  salt text;
  caller text := coalesce(
    nullif(current_setting('role', true), 'none'),
    session_user
  );
  actor uuid := auth.uid();
begin
  if target = '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Refusing to purge the tour sample restaurant';
  end if;

  perform 1
  from public.restaurants
  where id = target
  for update;

  if not found then
    raise exception 'Restaurant does not exist';
  end if;

  insert into projection_private.purge_context
  values (pg_backend_pid(), txid_current(), target);

  foreach t in array array[
    'projection_forecast_dishes',
    'projection_forecast_nights',
    'projection_forecast_runs',
    'projection_run_decision_nights',
    'projection_run_decisions',
    'projection_holiday_observations',
    'projection_launch_history',
    'projection_nightly_dish_facts',
    'projection_pos_item_map',
    'projection_dishes',
    'projection_nightly_flags',
    'projection_holiday_rule_versions',
    'projection_owner_answers',
    'projection_restaurant_config',
    'projection_pool_memberships',
    'projection_pool_permissions',
    'projection_setting_versions',
    'projection_change_log'
  ] loop
    execute format(
      'delete from public.%I where restaurant_id = $1',
      t
    ) using target;

    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  perform public.purge_restaurant_before_projections(target);

  select value into strict salt
  from projection_private.purge_salt
  where singleton;

  insert into public.projection_account_purge_log
    (
      account_hash,
      authorized_role,
      authorized_actor,
      deleted_rows
    )
  values (
    encode(
      sha256(convert_to(salt || target::text, 'UTF8')),
      'hex'
    ),
    caller,
    actor,
    counts
  );

  delete from projection_private.purge_context
  where backend_pid = pg_backend_pid()
    and transaction_id = txid_current();
end;
$fn$;

create function public.purge_restaurant(
  target uuid
) returns void
language sql security invoker set search_path = '' as $fn$
  select projection_private.purge_account(target);
$fn$;

revoke all on function public.purge_restaurant(uuid)
  from public, anon, authenticated;

grant execute on function public.purge_restaurant(uuid)
  to service_role;

do $block$
declare
  t text;
  immutable boolean;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and starts_with(tablename, 'projection_')
  loop
    immutable := t = any(array[
      'projection_model_versions',
      'projection_setting_versions',
      'projection_change_log',
      'projection_forecast_runs',
      'projection_forecast_nights',
      'projection_forecast_dishes',
      'projection_run_decisions',
      'projection_run_decision_nights',
      'projection_holiday_rule_versions',
      'projection_holiday_observations',
      'projection_launch_history',
      'projection_benchmark_pulls',
      'projection_pooled_totals',
      'projection_account_purge_log'
    ]);

    execute format(
      'alter table public.%I enable row level security',
      t
    );

    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role',
      t
    );

    execute format(
      'grant select, insert on public.%I to service_role',
      t
    );

    if immutable then
      execute format(
        'create trigger projection_immutable
         before update or delete on public.%I
         for each row execute function projection_private.immutable_row()',
        t
      );

      execute format(
        'create trigger projection_no_truncate
         before truncate on public.%I
         for each statement execute function projection_private.immutable_row()',
        t
      );
    else
      execute format(
        'grant update on public.%I to service_role',
        t
      );
    end if;
  end loop;

  foreach t in array array[
    'projection_restaurant_config',
    'projection_dishes',
    'projection_pos_item_map',
    'projection_nightly_flags',
    'projection_nightly_dish_facts',
    'projection_owner_answers',
    'projection_pool_permissions',
    'projection_pool_memberships'
  ] loop
    execute format(
      'create trigger projection_audit
       after insert or update on public.%I
       for each row execute function projection_private.log_change()',
      t
    );
  end loop;
end;
$block$;

revoke insert on public.projection_account_purge_log
  from service_role;

revoke all on all functions in schema projection_private
  from public, anon, authenticated, service_role;

grant execute on function
  projection_private.settings_template(),
  projection_private.valid_holiday_keys(text[]),
  projection_private.check_settings(jsonb, boolean),
  projection_private.is_account_purge(uuid),
  projection_private.calibration_key(integer, jsonb),
  projection_private.purge_account(uuid)
to service_role;

revoke all on
  public.projection_available_pooled_totals,
  public.projection_available_benchmark_ratios,
  public.projection_current_holiday_observations,
  public.projection_current_launch_history
from public, anon, authenticated;

grant select on
  public.projection_available_pooled_totals,
  public.projection_available_benchmark_ratios,
  public.projection_current_holiday_observations,
  public.projection_current_launch_history
to service_role;

notify pgrst, 'reload schema';

commit;