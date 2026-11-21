import { projectionInstant, shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID } from './eligibility.js';
import { canonicalProjectionHolidayKeys } from './holidayKeys.js';
import { PROJECTION_HOLIDAYS, projectionCalendarWeekday } from './calendar.js';
import { validateProjectionSettings, projectionSettingsDigest } from './settings.js';
import { projectionCanonicalJSON, projectionVolumeDigest, projectionDeepFreeze } from './volumeProvenance.js';

export function holidayError(message) {
  const error = new TypeError(message); error.code = 'PROJECTION_HOLIDAY_INVALID'; throw error;
}
export function holidayInstant(value) {
  const ms = projectionInstant(value), fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || '';
  return BigInt(ms) * 1000000n + BigInt(fraction.padEnd(9,'0').slice(3));
}
export function holidayKeys(value) {
  const keys = [...canonicalProjectionHolidayKeys(value)];
  if (keys.some(k => !Object.hasOwn(PROJECTION_HOLIDAYS,k) && k !== 'early_close') ||
    (keys.includes('early_close') && keys.length !== 1)) holidayError('Unsupported holiday observation keys.');
  return keys;
}
export function holidayVersion(version, restaurantId) {
  const settings = validateProjectionSettings(version?.settings);
  if (version.restaurant_id !== restaurantId || version.model_major !== 4 || !PROJECTION_UUID.test(version.global_version_id || '') ||
    (version.restaurant_version_id !== null && !PROJECTION_UUID.test(version.restaurant_version_id || '')) ||
    version.settings_digest !== projectionSettingsDigest(settings)) holidayError('Verified major 4 settings are required.');
  return settings;
}
export function currentHolidayVersions(rows, restaurantId, asOf, snapshotAt) {
  shiftProjectionDate(asOf,0); const captured = holidayInstant(snapshotAt);
  if (!Array.isArray(rows)) holidayError('Complete holiday observation history is required.');
  const eligible = new Map();
  for (const row of rows) {
    if (row?.restaurant_id !== restaurantId) holidayError('Holiday observations cross restaurants.');
    shiftProjectionDate(row.business_date,0);
    if (row.business_date >= asOf || holidayInstant(row.created_at) > captured) continue;
    if (!PROJECTION_UUID.test(row.id || '') || eligible.has(row.id) || !Number.isFinite(row.observed_ratio) || row.observed_ratio < 0) holidayError('Invalid holiday observation.');
    const keys=holidayKeys(row.holiday_keys);if(!keys.length)holidayError('Empty holiday observation key.');
    eligible.set(row.id,{...structuredClone(row),holiday_keys:keys});
  }
  const children = new Set(), originals = new Set();
  for (const row of eligible.values()) {
    if (!row.supersedes_id) {
      if (originals.has(row.business_date)) holidayError('Duplicate original holiday observation.');
      originals.add(row.business_date); continue;
    }
    const parent = eligible.get(row.supersedes_id);
    if (!parent || parent.id === row.id || parent.business_date !== row.business_date || children.has(parent.id) ||
      holidayInstant(parent.created_at) > holidayInstant(row.created_at)) holidayError('Incomplete or branching holiday history.');
    children.add(parent.id);
  }
  for (const row of eligible.values()) {
    const seen = new Set(); let cursor = row;
    while (cursor) {
      if (seen.has(cursor.id)) holidayError('Cyclic holiday history.');
      seen.add(cursor.id); cursor = eligible.get(cursor.supersedes_id);
    }
  }
  return [...eligible.values()].filter(row => !children.has(row.id)).sort((a,b) => a.business_date.localeCompare(b.business_date) || a.id.localeCompare(b.id));
}
const blend = (prior,rows) => (prior + rows.reduce((sum,row) => sum + row.observed_ratio,0)) / (1 + rows.length);
const matching = (rows,keys) => rows.filter(row => projectionCanonicalJSON(row.holiday_keys) === projectionCanonicalJSON(keys));

// Arithmetic layer also supports the workbook's static summary tables.
export function holidayFactorArithmetic({ closed, early_close, components, observations, earlyCloseFactor }) {
  if (typeof closed !== 'boolean' || typeof early_close !== 'boolean' || !Array.isArray(components) || !Array.isArray(observations) ||
    !Number.isFinite(earlyCloseFactor) || earlyCloseFactor <= 0) holidayError('Invalid holiday factor arithmetic.');
  if (components.some(row => !Number.isFinite(row.default_factor) || row.default_factor <= 0 || holidayKeys([row.holiday_key])[0] === 'early_close') ||
    observations.some(row => !Number.isFinite(row.observed_ratio) || row.observed_ratio < 0 || !holidayKeys(row.holiday_keys).length)) holidayError('Invalid holiday arithmetic evidence.');
  const early = matching(observations,['early_close']), earlyFactor = blend(earlyCloseFactor,early);
  const singles = components.map(component => {
    const rows = matching(observations,[component.holiday_key]);
    const factor = blend(component.default_factor,rows);
    return { ...component, learned_factor:factor, observation_ids:rows.map(r => r.id), n:rows.length,
      calendar_factor:component.answer === 'closed' ? 0 : component.answer === 'early_close' ? earlyFactor : factor };
  });
  const keys = singles.map(row => row.holiday_key).sort(), combo = keys.length > 1 ? matching(observations,keys) : [];
  const prior = singles.reduce((product,row) => product * row.learned_factor,1);
  const product = singles.reduce((value,row) => value * row.calendar_factor,1);
  const source = closed ? 'CLOSED' : early_close ? 'EARLY CLOSE ONLY' : keys.length > 1
    ? combo.length ? 'COMBINATION LEARNED' : 'PRODUCT OF ALL HOLIDAYS' : keys.length ? 'SINGLE HOLIDAY' : 'REGULAR NIGHT';
  const factor = closed ? 0 : early_close ? earlyFactor : keys.length > 1 ? blend(prior,combo) : prior;
  if (![prior,product,factor,earlyFactor].every(Number.isFinite)) holidayError('Holiday factor overflow.');
  return { factor, source, components:singles, component_product:product, combination_prior:prior,
    combination_n:combo.length, combination_ratio_sum:combo.reduce((n,r) => n+r.observed_ratio,0),
    combination_observation_ids:combo.map(r => r.id), early_close_default_factor:earlyCloseFactor, early_close_factor:earlyFactor,
    early_close_n:early.length, early_close_observation_ids:early.map(r => r.id),
    observation_ids:closed ? [] : early_close ? early.map(r => r.id) : [...singles.flatMap(r => r.observation_ids),...combo.map(r => r.id)],
    n:closed ? 0 : early_close ? early.length : keys.length > 1 ? combo.length : singles[0]?.n ?? 0 };
}
function ruleFor(rules, restaurantId, date, key, concept, captured) {
  const weekday = projectionCalendarWeekday(date), group = weekday <= 4 ? 'mon_thu' : weekday <= 6 ? 'fri_sat' : 'sun';
  const eligible = rules.filter(r => r.holiday_key === key && r.concept_type === concept && ['all',group].includes(r.weekday_group) && holidayInstant(r.effective_at) <= captured);
  eligible.sort((a,b) => Number(b.restaurant_id != null)-Number(a.restaurant_id != null) ||
    Number(b.weekday_group === group)-Number(a.weekday_group === group) ||
    (holidayInstant(a.effective_at) === holidayInstant(b.effective_at) ? 0 : holidayInstant(a.effective_at) < holidayInstant(b.effective_at) ? 1 : -1));
  if (!eligible[0]) holidayError(`Missing effective holiday rule: ${key}`);
  return eligible[0];
}
export function buildHolidayFactors(input) {
  const { restaurantId,asOf,snapshotAt,resolvedSettings,calendar,rules,observations,excludedDates=[] } = input;
  if (!PROJECTION_UUID.test(restaurantId || '')) holidayError('Restaurant context is required.');
  const s = holidayVersion(resolvedSettings,restaurantId), captured = holidayInstant(snapshotAt);
  shiftProjectionDate(asOf,0);
  if (!Array.isArray(calendar) || calendar.length !== s.horizon_days || !Array.isArray(rules)) holidayError('A complete holiday horizon and rule history are required.');
  if(!Array.isArray(excludedDates)||new Set(excludedDates).size!==excludedDates.length)holidayError('Invalid excluded observation dates.');
  excludedDates.forEach(date=>shiftProjectionDate(date,0));
  const current = currentHolidayVersions(observations,restaurantId,asOf,snapshotAt).filter(row=>!excludedDates.includes(row.business_date)), ruleIds = new Set(), effectiveKeys = new Set();
  for (const rule of rules) {
    if (!rule || (rule.restaurant_id != null && rule.restaurant_id !== restaurantId) || !PROJECTION_UUID.test(rule.id || '') || ruleIds.has(rule.id) ||
      !Number.isFinite(rule.default_factor) || rule.default_factor <= 0 || !['open','closed','early_close'].includes(rule.default_answer)) holidayError('Invalid or foreign holiday rule.');
    ruleIds.add(rule.id);
    const identity = JSON.stringify([rule.restaurant_id ?? null,rule.concept_type,rule.holiday_key,rule.weekday_group,holidayInstant(rule.effective_at).toString()]);
    if (effectiveKeys.has(identity)) holidayError('Duplicate effective holiday rule.'); effectiveKeys.add(identity);
  }
  const ordered = [...calendar].sort((a,b) => a.business_date.localeCompare(b.business_date));
  const nights = ordered.map((night,i) => {
    if (night.restaurant_id !== restaurantId || night.business_date !== shiftProjectionDate(asOf,i) ||
      typeof night.closed !== 'boolean' || typeof night.early_close !== 'boolean' || typeof night.concept_fallback !== 'boolean' ||
      !['full_service','bar_pub','quick_service'].includes(night.concept_type) ||
      (night.concept_fallback && night.concept_type!=='full_service') ||
      !Number.isSafeInteger(night.configuration_revision) || !/^[a-f0-9]{64}$/.test(night.context_digest || '')) holidayError('Invalid holiday calendar context.');
    const keys = holidayKeys(night.holiday_keys);
    if (keys.includes('early_close') || (night.closed && night.early_close)) holidayError('Invalid calendar holiday flags.');
    const components = keys.map(key => {
      const rule = ruleFor(rules,restaurantId,night.business_date,key,night.concept_type,captured);
      const resolved = night.resolved_holidays?.find(row => row.holiday_key === key);
      if (!resolved || resolved.rule_id !== rule.id || resolved.default_factor !== rule.default_factor ||
        !['open','closed','early_close'].includes(resolved.answer)) holidayError('Calendar holiday rule provenance does not match.');
      return { holiday_key:key,rule_id:rule.id,default_factor:rule.default_factor,answer:resolved.answer };
    });
    const defaultFactor = night.closed ? 0 : night.early_close ? s.early_close_factor : components.reduce((n,row) => n*row.default_factor,1);
    if (defaultFactor !== night.default_factor) holidayError('Calendar default factor does not match its rules.');
    return { business_date:night.business_date,calendar_default_factor:defaultFactor,
      concept_type:night.concept_type,concept_fallback:night.concept_fallback,
      ...holidayFactorArithmetic({closed:night.closed,early_close:night.early_close,components,observations:current,earlyCloseFactor:s.early_close_factor}) };
  });
  const source = structuredClone(input);source.calendar = structuredClone(ordered);
  source.rules=source.rules.filter(row=>holidayInstant(row.effective_at)<=captured).sort((a,b)=>a.id.localeCompare(b.id));
  source.observations=source.observations.filter(row=>row.business_date<asOf&&holidayInstant(row.created_at)<=captured).sort((a,b)=>a.id.localeCompare(b.id));
  const result = { inputs:source,nights };
  result.inputs_digest = projectionVolumeDigest(source);
  return projectionDeepFreeze(result);
}
export function verifyHolidayFactors(snapshot,{restaurantId,asOf,resolvedSettings,calendar}) {
  const checked = buildHolidayFactors(snapshot?.inputs || {});
  if (projectionCanonicalJSON(checked) !== projectionCanonicalJSON(snapshot) || snapshot.inputs.restaurantId !== restaurantId ||
    snapshot.inputs.asOf !== asOf || projectionCanonicalJSON(snapshot.inputs.resolvedSettings) !== projectionCanonicalJSON(resolvedSettings)) holidayError('Holiday factor snapshot verification failed.');
  const select = row => ({restaurant_id:row.restaurant_id,business_date:row.business_date,closed:row.closed,early_close:row.early_close,
    holiday_keys:holidayKeys(row.holiday_keys),default_factor:row.default_factor,configuration_revision:row.configuration_revision,context_digest:row.context_digest});
  if (projectionCanonicalJSON([...calendar].sort((a,b)=>a.business_date.localeCompare(b.business_date)).map(select)) !==
    projectionCanonicalJSON([...snapshot.inputs.calendar].sort((a,b)=>a.business_date.localeCompare(b.business_date)).map(select))) holidayError('Holiday snapshot belongs to a different calendar.');
  return checked;
}