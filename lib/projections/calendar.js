import { shiftProjectionDate, projectionInstant } from './businessTime.js';
import { canonicalProjectionHolidayKeys } from './holidayKeys.js';

export const PROJECTION_HOLIDAYS = Object.freeze({
  new_years_day: "New Year's Day",
  super_bowl: 'Super Bowl Sunday',
  valentines_day: "Valentine's Day",
  st_patricks_day: "St. Patrick's Day",
  easter: 'Easter',
  cinco_de_mayo: 'Cinco de Mayo',
  mothers_day: "Mother's Day",
  memorial_day: 'Memorial Day',
  fathers_day: "Father's Day",
  july_4: 'July 4',
  labor_day: 'Labor Day',
  halloween: 'Halloween',
  thanksgiving_eve: 'Thanksgiving Eve',
  thanksgiving_day: 'Thanksgiving Day',
  black_friday: 'Black Friday',
  christmas_eve: 'Christmas Eve',
  christmas_day: 'Christmas Day',
  new_years_eve: "New Year's Eve",
});

export const PROJECTION_OWNER_HOLIDAYS = Object.freeze([
  'thanksgiving_day', 'christmas_eve', 'christmas_day',
  'new_years_day', 'easter', 'july_4',
]);

export function projectionCalendarWeekday(date) {
  shiftProjectionDate(date, 0);
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

function dateOf(year, month, day) {
  return shiftProjectionDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    0
  );
}

function nthWeekday(year, month, weekday, occurrence) {
  const first = dateOf(year, month, 1);
  return shiftProjectionDate(first,
    (weekday - projectionCalendarWeekday(first) + 7) % 7 + 7 * (occurrence - 1));
}

function easter(year) {
  const floor = Math.floor;
  const a = year % 19;
  const b = floor(year / 100);
  const c = year % 100;
  const d = floor(b / 4);
  const e = b % 4;
  const f = floor((b + 8) / 25);
  const g = floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return dateOf(year, floor(n / 31), n % 31 + 1);
}

// Scheduled sports dates are data supplied by the calendar publisher.
// This function makes no permanent assumption about the NFL schedule.
export function projectionHolidayDates(year, scheduled = []) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Array.isArray(scheduled)) {
    throw new TypeError('A valid calendar year and scheduled dates are required.');
  }
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const memorial = dateOf(year, 5, 31);
  const rows = [
    [dateOf(year, 1, 1), 'new_years_day'],
    [dateOf(year, 2, 14), 'valentines_day'],
    [dateOf(year, 3, 17), 'st_patricks_day'],
    [easter(year), 'easter'],
    [dateOf(year, 5, 5), 'cinco_de_mayo'],
    [nthWeekday(year, 5, 7, 2), 'mothers_day'],
    [shiftProjectionDate(memorial, -(projectionCalendarWeekday(memorial) - 1)), 'memorial_day'],
    [nthWeekday(year, 6, 7, 3), 'fathers_day'],
    [dateOf(year, 7, 4), 'july_4'],
    [nthWeekday(year, 9, 1, 1), 'labor_day'],
    [dateOf(year, 10, 31), 'halloween'],
    [shiftProjectionDate(thanksgiving, -1), 'thanksgiving_eve'],
    [thanksgiving, 'thanksgiving_day'],
    [shiftProjectionDate(thanksgiving, 1), 'black_friday'],
    [dateOf(year, 12, 24), 'christmas_eve'],
    [dateOf(year, 12, 25), 'christmas_day'],
    [dateOf(year, 12, 31), 'new_years_eve'],
  ].map(([holiday_date, holiday_key]) => ({ holiday_date, holiday_key }));

  for (const row of scheduled) {
    shiftProjectionDate(row?.holiday_date, 0);
    if (row.holiday_key !== 'super_bowl' || Number(row.holiday_date.slice(0, 4)) !== year) {
      throw new TypeError('A scheduled holiday is outside its year or registry.');
    }
    rows.push({ holiday_date: row.holiday_date, holiday_key: row.holiday_key });
  }
  if (scheduled.length > 1) throw new TypeError('Duplicate scheduled holiday.');
  return Object.freeze(rows.sort((a, b) =>
    a.holiday_date < b.holiday_date ? -1 : a.holiday_date > b.holiday_date ? 1
      : a.holiday_key < b.holiday_key ? -1 : a.holiday_key > b.holiday_key ? 1 : 0
  ).map(Object.freeze));
}

export function normalizeProjectionCalendarAnswers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'concept_type,holiday_answers,normally_closed_weekdays') {
    throw new TypeError('A complete calendar configuration is required.');
  }
  if (!['full_service', 'bar_pub', 'quick_service'].includes(value.concept_type)) {
    throw new TypeError('Choose a supported restaurant concept.');
  }
  const days = value.normally_closed_weekdays;
  if (!Array.isArray(days) || new Set(days).size !== days.length ||
    days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new TypeError('Closed weekdays must be distinct ISO weekday numbers.');
  }
  const answers = value.holiday_answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) ||
    Object.entries(answers).some(([key, answer]) =>
      !PROJECTION_OWNER_HOLIDAYS.includes(key) || !['open', 'closed', 'early_close'].includes(answer))) {
    throw new TypeError('Holiday answers must use the six supported holidays.');
  }
  return Object.freeze({
    concept_type: value.concept_type,
    normally_closed_weekdays: Object.freeze([...days].sort((a, b) => a - b)),
    holiday_answers: Object.freeze(Object.fromEntries(Object.entries(answers).sort())),
  });
}

function instantOrder(value) {
  const milliseconds = projectionInstant(value);
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || '';
  return BigInt(milliseconds) * 1000000n + BigInt(fraction.padEnd(9, '0').slice(3));
}

export function classifyProjectionCalendarNight({
  restaurantId, date, configuration, holidays, rules, asOf, earlyCloseFactor,
}) {
  if (typeof restaurantId !== 'string' || !restaurantId ||
    configuration?.restaurant_id !== restaurantId ||
    !Array.isArray(holidays) || !Array.isArray(rules) ||
    !Number.isFinite(earlyCloseFactor) || earlyCloseFactor <= 0 || earlyCloseFactor > 1) {
    throw new TypeError('Complete restaurant calendar context is required.');
  }
  const at = instantOrder(asOf);
  const weekday = projectionCalendarWeekday(date);
  const group = weekday <= 4 ? 'mon_thu' : weekday <= 6 ? 'fri_sat' : 'sun';
  if (configuration.settings?.concept_type == null) {
    const error = new Error('Answer the projection calendar setup questions before forecasting.');
    error.code = 'PROJECTION_CALENDAR_SETUP_REQUIRED';
    throw error;
  }
  const answers = normalizeProjectionCalendarAnswers(configuration.settings);
  const keys = canonicalProjectionHolidayKeys(holidays.filter(row => {
    shiftProjectionDate(row?.holiday_date, 0);
    if (!Object.hasOwn(PROJECTION_HOLIDAYS, row.holiday_key) || row.restaurant_id != null) {
      throw new TypeError('Invalid global holiday row.');
    }
    return row.holiday_date === date;
  }).map(row => row.holiday_key));
  const seenRules = new Set();
  for (const rule of rules) {
    if (rule.restaurant_id != null && rule.restaurant_id !== restaurantId) {
      throw new TypeError('Holiday rule crosses restaurants.');
    }
    const instant = instantOrder(rule.effective_at);
    const key = JSON.stringify([rule.restaurant_id ?? null, rule.concept_type,
      rule.holiday_key, rule.weekday_group, instant.toString()]);
    if (seenRules.has(key)) throw new TypeError('Duplicate effective holiday rule.');
    seenRules.add(key);
  }
  const resolved = keys.map(key => {
    const eligible = rules.filter(row => row.holiday_key === key &&
      row.concept_type === answers.concept_type && ['all', group].includes(row.weekday_group) &&
      instantOrder(row.effective_at) <= at);
    eligible.sort((a, b) =>
      Number(b.restaurant_id != null) - Number(a.restaurant_id != null) ||
      Number(b.weekday_group === group) - Number(a.weekday_group === group) ||
      (instantOrder(a.effective_at) < instantOrder(b.effective_at) ? 1
        : instantOrder(a.effective_at) > instantOrder(b.effective_at) ? -1 : 0));
    const rule = eligible[0];
    if (!rule || typeof rule.id !== 'string' || !Number.isFinite(rule.default_factor) ||
      rule.default_factor <= 0 || !['open', 'closed', 'early_close'].includes(rule.default_answer)) {
      throw new TypeError(`An effective holiday rule is required for ${key}.`);
    }
    return { holiday_key: key, rule_id: rule.id,
      answer: answers.holiday_answers[key] ?? rule.default_answer,
      default_factor: rule.default_factor };
  });
  const closed = answers.normally_closed_weekdays.includes(weekday) || resolved.some(r => r.answer === 'closed');
  const early_close = !closed && resolved.some(r => r.answer === 'early_close');
  const factor = closed ? 0 : early_close ? earlyCloseFactor
    : resolved.reduce((product, row) => product * row.default_factor, 1);
  if (!Number.isFinite(factor)) throw new TypeError('Holiday default factors overflowed.');
  return Object.freeze({ business_date: date, weekday,
    holiday_keys: keys, closed, early_close,
    regular_service: !closed && !early_close && keys.length === 0,
    default_factor: factor,
    resolved_holidays: Object.freeze(resolved.map(Object.freeze)),
  });
}

// Calendar dates stay as literals. POS activity only overrides past closures;
// it never declares an unfinished or incomplete night complete.
export function reconcileProjectionCalendarSales(planned, observed, evidence, today, earlyCloseFactor, thresholdUnits) {
  if (!Number.isFinite(thresholdUnits) || thresholdUnits < 0) throw new TypeError('Invalid closure conflict policy.');
  const wasClosed = planned.closed || observed?.closed === true;
  const conflict = wasClosed && planned.business_date < today && evidence?.total_units > thresholdUnits
    ? Object.freeze({ code: 'PROJECTION_CALENDAR_CLOSURE_CONFLICT',
      business_date: planned.business_date, total_units: evidence.total_units,
      threshold_units: thresholdUnits, planned_closed: planned.closed, recorded_closed: observed?.closed === true,
      message: `Your calendar says closed, but ${planned.business_date} had ${evidence.total_units} dishes sold.` })
    : null;
  const closed = wasClosed && !conflict;
  const early = !closed && (planned.early_close || observed?.early_close === true ||
    planned.resolved_holidays.some(row => row.answer === 'early_close'));
  const openFactor = planned.resolved_holidays.reduce((product, row) => product * row.default_factor, 1);
  if (!Number.isFinite(openFactor)) throw new TypeError('Holiday default factors overflowed.');
  return Object.freeze({ ...planned, closed, early_close: early,
    regular_service: !closed && !early && planned.holiday_keys.length === 0,
    default_factor: closed ? 0 : early ? earlyCloseFactor : openFactor,
    closure_conflict: conflict });
}