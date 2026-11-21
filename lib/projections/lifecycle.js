import { projectionInstant, shiftProjectionDate } from './businessTime.js';
import { projectionDayNumber, projectionVolumeEligibility, PROJECTION_UUID } from './eligibility.js';
import { projectionAvailability, availableOn } from './availability.js';
import { validateProjectionSettings, projectionSettingsDigest } from './settings.js';
import { projectionVolumeDigest as digest, projectionDeepFreeze } from './volumeProvenance.js';

const days = (a, b) => projectionDayNumber(a) - projectionDayNumber(b);
const total = (rows, fn) => rows.reduce((n, row) => n + fn(row), 0);
export function lifecycleError(message) {
  const error = new TypeError(message); error.code = 'PROJECTION_LIFECYCLE_INVALID'; throw error;
}

export function buildProjectionLifecycle(input) {
  const { restaurantId, asOf, snapshotAt, resolvedSettings: version, restaurant,
    dishes, history, dishFacts, priorSales = [], launchHistory = [] } = input;
  if (!PROJECTION_UUID.test(restaurantId || '') || restaurant?.id !== restaurantId) lifecycleError('Restaurant context is required.');
  shiftProjectionDate(asOf, 0); const captured = projectionInstant(snapshotAt);
  const s = validateProjectionSettings(version?.settings);
  if (version.restaurant_id !== restaurantId || version.model_major !== 4 || !PROJECTION_UUID.test(version.global_version_id || '') ||
    (version.restaurant_version_id !== null && !PROJECTION_UUID.test(version.restaurant_version_id || '')) || version.settings_digest !== projectionSettingsDigest(s)) {
    lifecycleError('A complete resolved major 4 settings version is required.');
  }
  for (const rows of [dishes, history, dishFacts, priorSales, launchHistory]) if (!Array.isArray(rows)) lifecycleError('Complete lifecycle arrays are required.');
  const owned = row => { if (!row || row.restaurant_id !== restaurantId) lifecycleError('Lifecycle context crosses restaurants.'); return row; };
  const rawLaunches = launchHistory.map(row => structuredClone(owned(row))).sort((a,b) => a.id.localeCompare(b.id));
  const first = restaurant.first_data_date ?? null;
  if (first) { shiftProjectionDate(first, 0); if (first > asOf) lifecycleError('First data date is in the future.'); }
  const completed = restaurant.onboarding_completed_at && projectionInstant(restaurant.onboarding_completed_at) <= captured
    ? projectionInstant(restaurant.onboarding_completed_at) : null;
  const menu = new Map();
  for (const raw of dishes) {
    owned(raw);
    const created = projectionInstant(raw.menu_created_at);
    if (created > captured) continue;
    if (!PROJECTION_UUID.test(raw.id || '') || menu.has(raw.id) || typeof raw.forecastable !== 'boolean') lifecycleError('Invalid or duplicate dish.');
    shiftProjectionDate(raw.added_business_date, 0);
    if (raw.forecastable && (typeof raw.style_category !== 'string' || !raw.style_category)) lifecycleError('Missing style category.');
    menu.set(raw.id, { ...structuredClone(raw), initial: completed === null || created <= completed });
  }
  const windows = projectionAvailability(input.availability, restaurantId, new Set(menu.keys()));
  const nights = new Map();
  for (const row of history) {
    owned(row); shiftProjectionDate(row.business_date, 0);
    if (row.business_date >= asOf) continue;
    if (nights.has(row.business_date)) lifecycleError('Duplicate source night.');
    const eligible = projectionVolumeEligibility(row, { restaurantId, asOf }).eligible && (!first || row.business_date >= first);
    nights.set(row.business_date, { ...structuredClone(row), eligible });
  }
  const facts = new Map();
  for (const row of dishFacts) {
    owned(row); shiftProjectionDate(row.business_date, 0);
    if (row.business_date >= asOf) continue;
    if (!menu.has(row.dish_id) || !Number.isFinite(row.units) || row.units < 0 ||
      ![true, false, null].includes(row.recommended) || ![true, false, null].includes(row.sold_out)) lifecycleError('Invalid dish fact.');
    const key = `${row.business_date}:${row.dish_id}`;
    if (facts.has(key)) lifecycleError('Duplicate dish fact.');
    facts.set(key, structuredClone(row));
  }
  const orderedFacts = [...facts.values()].sort((a,b) => a.business_date.localeCompare(b.business_date) || a.dish_id.localeCompare(b.dish_id));
  const orderedMenu = [...menu.values()].sort((a,b) => a.id.localeCompare(b.id));
  const inferred = new Map();
  for (const row of priorSales) {
    owned(row); shiftProjectionDate(row.business_date, 0);
    const dish = menu.get(row.dish_id);
    if (!dish || row.business_date >= asOf) continue;
    const night = nights.get(row.business_date);
    if (night?.eligible && row.business_date < dish.added_business_date && Number.isFinite(row.units) && row.units > 0 &&
      (!inferred.has(dish.id) || inferred.get(dish.id).business_date > row.business_date ||
        (inferred.get(dish.id).business_date === row.business_date && digest(row) < digest(inferred.get(dish.id))))) inferred.set(dish.id, structuredClone(row));
  }
  const corrections = [];
  for (const dish of orderedMenu) {
    const rows = windows.filter(w => w.dish_id === dish.id);
    const earliest = rows[0], sale = inferred.get(dish.id);
    if (earliest && !dish.initial && sale && (!earliest.valid_from || sale.business_date < earliest.valid_from)) {
      earliest.valid_from = sale.business_date; earliest.is_initial = true;
      earliest.lifecycle_context = { ...earliest.lifecycle_context, inferred_existing_from_prior_sales: true, prior_sale: sale };
      corrections.push({ id: earliest.id, dish_id: dish.id, valid_from: sale.business_date, prior_sale: sale });
    }
  }
  const episodes = new Map();
  for (const dish of orderedMenu) {
    const groups = [];
    for (const row of windows.filter(w => w.dish_id === dish.id)) {
      const previous = groups.at(-1), gap = previous?.last.valid_until && row.valid_from
        ? days(row.valid_from, previous.last.valid_until) : null;
      if (previous && gap !== null && gap < s.minimum_return_gap_days) {
        previous.windows.push(row); previous.last = row;
      } else {
        const baseline = groups.length === 0 && (dish.initial || row.is_initial || row.lifecycle_context.inferred_existing_from_prior_sales === true);
        groups.push({ dish, windows: [row], first: row, last: row,
          launch_date: row.valid_from ?? first, launch: !baseline && completed !== null,
          returning: !baseline && completed !== null && groups.length > 0,
          previous_removed: groups.at(-1)?.last.valid_until ?? null });
      }
    }
    episodes.set(dish.id, groups);
  }
  const stateAt = (dish, date, inclusive = false) => {
    const groups = episodes.get(dish.id);
    const episode = groups.find(g => g.windows.some(w => availableOn(w, date) ||
      (inclusive && w.valid_until === date && (w.valid_from === null || w.valid_from <= date))));
    const active = !!episode;
    return { episode, active, isNew: active && episode.launch && episode.launch_date !== null &&
      days(date, episode.launch_date) < 7 * s.new_dish_weeks };
  };
  const prepared = [...menu.values()].sort((a, b) => a.id.localeCompare(b.id)).map(dish => {
    const groups = episodes.get(dish.id), current = stateAt(dish, asOf);
    const episode = current.episode ?? groups.filter(g => !g.launch_date || g.launch_date <= asOf).at(-1) ?? groups[0];
    if (!episode) lifecycleError('Dish availability is missing.');
    const physical = episode.windows.find(w => availableOn(w, asOf)) ??
      episode.windows.filter(w => !w.valid_from || w.valid_from <= asOf).at(-1) ?? episode.first;
    const last = episode.returning ? episode.previous_removed : null;
    const count = last ? [...menu.values()].filter(d => d.forecastable && d.style_category === dish.style_category && stateAt(d, last, true).active).length : null;
    return { ...dish, launch_date: episode.launch_date, removed_date: physical.valid_until,
      is_new: current.isNew, is_returning: episode.returning, last_season_removed_date: last,
      last_season_category_count: count, lifecycle_trace: { active: current.active,
        origin: episode.launch ? episode.returning ? 'returning' : 'addition' : 'initial_menu',
        inferred_existing_from_prior_sales: inferred.has(dish.id) ||
          episode.first.lifecycle_context.inferred_existing_from_prior_sales === true, availability_ids: episode.windows.map(w => w.id) } };
  });
  const observations = [], pending = [], skipped = [];
  for (const groups of episodes.values()) for (const episode of groups) {
    if (!episode.launch || !episode.launch_date || !episode.dish.forecastable) continue;
    const start = episode.launch_date, end = shiftProjectionDate(start, 27), dish = episode.dish;
    const key = { dish_id: dish.id, launch_date: start, observed_through: end };
    if (corrections.length) { pending.push({ ...key, reason: 'origin_correction_requires_reingestion' }); continue; }
    if (end >= asOf) { pending.push({ ...key, reason: 'first_four_weeks_unfinished' }); continue; }
    if (episode.windows.some(w => w.valid_until && w.valid_until >= start && w.valid_until <= end)) {
      skipped.push({ ...key, reason: 'removed_inside_first_four_weeks' }); continue;
    }
    const used = [], excluded = [], windowSources = []; let waiting = false, impossible = false;
    for (let date = start; date <= end; date = shiftProjectionDate(date, 1)) {
      const night = nights.get(date); windowSources.push(night ?? { business_date: date, missing: true });
      if (!night || (!night.closed && !night.complete)) { waiting = true; excluded.push({ business_date: date, reasons: ['incomplete'] }); continue; }
      if (!night.closed && !night.source_covered) { impossible = true; excluded.push({ business_date: date, reasons: ['not_pos_covered'] }); continue; }
      const reasons = [...projectionVolumeEligibility(night, { restaurantId, asOf }).reasons];
      if (first && date < first) reasons.push('before_first_data');
      const fact = facts.get(`${date}:${dish.id}`);
      if (!reasons.length) {
        const sourceFacts = orderedFacts.filter(f => f.business_date === date);
        const units = total(sourceFacts, f => f.units);
        if (Math.abs(units-night.total_units) > Number.EPSILON*Math.max(1,units,night.total_units)*Math.max(1,sourceFacts.length)) {
          lifecycleError('Complete dish facts do not reconcile to source volume.');
        }
        for (const other of orderedMenu.filter(d => d.forecastable && stateAt(d,date).active)) {
          const source = facts.get(`${date}:${other.id}`);
          if (!source || source.source_revision !== night.source_revision) lifecycleError('A complete available night is missing its dish fact or revision.');
        }
      }
      if (fact?.recommended === true) reasons.push('recommended');
      if (fact?.sold_out === true) reasons.push('sold_out');
      if (reasons.length) { excluded.push({ business_date: date, reasons }); continue; }
      if (fact.source_revision !== night.source_revision) lifecycleError('Dish/source revision mismatch.');
      const categoryFacts = orderedFacts.filter(f => f.business_date === date && menu.get(f.dish_id).forecastable &&
        menu.get(f.dish_id).style_category === dish.style_category && stateAt(menu.get(f.dish_id), date).active);
      used.push({ business_date: date, units: fact.units, category_units: total(categoryFacts, f => f.units),
        facts: categoryFacts, unknown_flags: fact.recommended === null || fact.sold_out === null });
    }
    if (waiting || impossible) {
      (waiting ? pending : skipped).push({ ...key, reason: waiting ? 'incomplete_open_night' : 'uncovered_open_night', excluded }); continue;
    }
    const denominator = total(used, row => row.category_units), numerator = total(used, row => row.units);
    if (denominator <= 0) { skipped.push({ ...key, reason: 'no_clean_category_units', excluded }); continue; }
    const existing = [...menu.values()].filter(d => d.id !== dish.id && d.forecastable && d.style_category === dish.style_category &&
      stateAt(d, start).active && !stateAt(d, start).isNew).map(d => d.id).sort();
    const share = numerator / denominator;
    const traceInput = { ...key, restaurant_id: restaurantId, settings_digest: version.settings_digest,
      style_category: dish.style_category, windows: episode.windows, existing_dishes: existing,
      model_major: 4, global_version_id: version.global_version_id, restaurant_version_id: version.restaurant_version_id,
      sources: windowSources, used, excluded };
    observations.push({ ...key, restaurant_id: restaurantId, style_category: dish.style_category,
      existing_dishes: existing.length, first_four_week_share: share, launch_index: share * (existing.length + 1),
      trace: { inputs_digest: digest(traceInput), model_major: 4, settings_digest: version.settings_digest,
        global_version_id: version.global_version_id, restaurant_version_id: version.restaurant_version_id, dates_used: used.map(r => r.business_date), excluded,
        dish_units: numerator, category_units: denominator, existing_dish_ids: existing,
        unknown_flag_dates: used.filter(r => r.unknown_flags).map(r => r.business_date) } });
  }
  const result = { restaurant_id: restaurantId, as_of: asOf, snapshot_at: snapshotAt,
    source_context_digest: input.context_digest ?? null, dishes: prepared, availability: windows,
    origin_corrections: corrections, observations, pending, skipped, launch_history: rawLaunches };
  result.inputs_digest = digest(result);
  return projectionDeepFreeze(result);
}