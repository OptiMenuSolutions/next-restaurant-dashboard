import { shiftProjectionDate, projectionInstant, projectionBusinessDate } from './businessTime.js';
import { validateProjectionSettings } from './settings.js';
import { requireRestaurantTimezone } from '../restaurantTime.js';
import { classifyProjectionCalendarNight } from './calendar.js';

function fail(message, code = 'PROJECTION_CALENDAR_CONTEXT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function projectionCalendarResponse(reply) {
  if (reply?.error) {
    const error = new Error(reply.error.message);
    error.code = reply.error.code;
    throw error;
  }
  if (!reply?.data || typeof reply.data !== 'object' || Array.isArray(reply.data)) {
    fail('Invalid calendar database response.');
  }
  return reply.data;
}

export function selectProjectionCalendarVersion(versions, restaurantId, date) {
  shiftProjectionDate(date, 0);
  if (!Array.isArray(versions)) fail('Missing calendar version history.');
  const seen = new Set();
  for (const row of versions) {
    if (row.restaurant_id !== restaurantId || !Number.isSafeInteger(row.revision) || row.revision < 0 || seen.has(row.revision)) {
      fail('Invalid or foreign calendar version.');
    }
    seen.add(row.revision);
    if (row.effective_from != null) shiftProjectionDate(row.effective_from, 0);
  }
  const eligible = versions.filter(row => row.effective_from == null || row.effective_from <= date);
  eligible.sort((a, b) => {
    const aa = a.effective_from || '';
    const bb = b.effective_from || '';
    return aa < bb ? 1 : aa > bb ? -1 : b.revision - a.revision;
  });
  if (!eligible[0]) fail('Calendar configuration is unavailable for this date.');
  return eligible[0];
}

export async function readProjectionCalendar(db, { restaurantId, from, until }) {
  shiftProjectionDate(from, 0);
  shiftProjectionDate(until, 0);
  if (until < from) fail('Invalid calendar range.');
  const prepared = await db.rpc('projection_prepare_calendar', { p_from: from, p_until: until });
  if (!prepared || !Object.hasOwn(prepared, 'data') || prepared.error) {
    fail(prepared?.error?.message || 'Calendar preparation failed.');
  }
  const context = projectionCalendarResponse(await db.rpc('projection_calendar_context', {
    p_restaurant_id: restaurantId, p_from: from, p_until: until,
  }));
  if (context.restaurant_id !== restaurantId || context.from !== from || context.until !== until ||
    !/^[a-f0-9]{64}$/.test(context.context_digest || '') || !Array.isArray(context.scheduled_years) || !Array.isArray(context.observed_closures)) {
    fail('Unexpected calendar context.');
  }
  requireRestaurantTimezone(context.timezone);
  validateProjectionSettings(context.settings);
  projectionInstant(context.as_of);
  shiftProjectionDate(context.today, 0);
  if (projectionBusinessDate(context.as_of, context.timezone,
    context.settings.business_day_cutoff_minutes) !== context.today) fail('Inconsistent restaurant business date.');
  const closureDates = new Set();
  for (const row of context.observed_closures) {
    shiftProjectionDate(row.business_date, 0);
    if (closureDates.has(row.business_date) || row.business_date < from || row.business_date > until ||
      typeof row.closed !== 'boolean' || typeof row.early_close !== 'boolean' || row.restaurant_id != null) {
      fail('Invalid observed closure.');
    }
    closureDates.add(row.business_date);
  }
  for (let year = Number(from.slice(0, 4)); year <= Number(until.slice(0, 4)); year++) {
    if (!context.scheduled_years.includes(year)) {
      fail(`The Super Bowl date for ${year} needs a published calendar entry.`, 'PROJECTION_CALENDAR_INCOMPLETE');
    }
  }
  const nights = [];
  for (let date = from; ; date = shiftProjectionDate(date, 1)) {
    const configuration = selectProjectionCalendarVersion(context.versions, restaurantId, date);
    const planned = classifyProjectionCalendarNight({ restaurantId, date, configuration,
      holidays: context.holidays, rules: context.rules, asOf: context.as_of,
      earlyCloseFactor: context.settings.early_close_factor });
    const observed = context.observed_closures.find(row => row.business_date === date);
    const closed = planned.closed || observed?.closed === true;
    const early = !closed && (planned.early_close || observed?.early_close === true);
    nights.push(Object.freeze({ ...planned, closed, early_close: early,
      regular_service: !closed && !early && planned.holiday_keys.length === 0,
      default_factor: closed ? 0 : early ? context.settings.early_close_factor : planned.default_factor,
      configuration_revision: configuration.revision,
    }));
    if (date === until) break;
  }
  return { context, nights: Object.freeze(nights) };
}

export async function applyProjectionCalendarFlags(db, { context, nights }) {
  const result = projectionCalendarResponse(await db.rpc('projection_apply_calendar_flags', {
    p_restaurant_id: context.restaurant_id, p_from: context.from, p_until: context.until,
    p_context_digest: context.context_digest,
    p_nights: nights.filter(night => night.business_date <= context.today),
  }));
  if (result.restaurant_id !== context.restaurant_id || !Number.isSafeInteger(result.changed_nights) || result.changed_nights < 0) {
    fail('Invalid calendar flag commit response.');
  }
  return result;
}