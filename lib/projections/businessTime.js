import {
  requireRestaurantTimezone,
  restaurantLocalDate,
} from '../restaurantTime.js';

const DAY = 86400000;

export function projectionInstant(value) {
  const parts = typeof value === 'string' && value.match(
    /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
  );

  if (
    !parts ||
    Number(parts[1]) > 23 ||
    Number(parts[2]) > 59 ||
    Number(parts[3]) > 59
  ) {
    throw new TypeError('An explicit timestamp with an offset is required.');
  }

  calendar(value.slice(0, 10));

  const n = Date.parse(value);

  if (!Number.isFinite(n)) {
    throw new TypeError('Invalid timestamp.');
  }

  return n;
}

function calendar(value) {
  const m = typeof value === 'string' &&
    value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!m || Number(m[1]) < 1) {
    throw new TypeError('A YYYY-MM-DD calendar date is required.');
  }

  const d = new Date(0);
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setUTCHours(0, 0, 0, 0);

  if (d.toISOString().slice(0, 10) !== value) {
    throw new TypeError('Invalid calendar date.');
  }

  return d.getTime();
}

export function shiftProjectionDate(value, days) {
  if (!Number.isSafeInteger(days)) {
    throw new TypeError('An integer day shift is required.');
  }

  const result = new Date(
    calendar(value) + days * DAY
  ).toISOString().slice(0, 10);

  calendar(result);

  return result;
}

function cutoff(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 1440) {
    throw new TypeError('A valid business cutoff is required.');
  }

  return value;
}

function formatter(zone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function wallTime(format, instant) {
  const p = Object.fromEntries(
    format.formatToParts(new Date(instant)).map(x => [x.type, x.value])
  );

  return calendar(`${p.year}-${p.month}-${p.day}`) +
    (
      Number(p.hour) * 3600 +
      Number(p.minute) * 60 +
      Number(p.second)
    ) * 1000;
}

// Repeated cutoff: second occurrence.
// Skipped cutoff: first valid instant after it.
export function projectionBoundary(date, timeZone, cutoffMinutes) {
  const zone = requireRestaurantTimezone(timeZone);
  const nominal = calendar(date) + cutoff(cutoffMinutes) * 60000;
  const f = formatter(zone);
  const offsets = new Set();

  for (let hour = -36; hour <= 36; hour += 6) {
    const probe = nominal + hour * 3600000;
    offsets.add(wallTime(f, probe) - probe);
  }

  const exact = [...offsets]
    .map(offset => nominal - offset)
    .filter(instant => wallTime(f, instant) === nominal);

  if (exact.length) {
    return new Date(Math.max(...exact)).toISOString();
  }

  const candidates = [...offsets]
    .map(offset => nominal - offset)
    .sort((a, b) => a - b);

  let lo = candidates[0];
  let hi = candidates.at(-1);

  if (!(wallTime(f, lo) < nominal && wallTime(f, hi) > nominal)) {
    throw new Error('Could not resolve the restaurant business cutoff.');
  }

  // Find the clock jump itself, rather than shifting the requested time
  // by an hour.
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);

    if (wallTime(f, mid) >= nominal) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return new Date(hi).toISOString();
}

export function projectionBusinessDate(
  timestamp,
  timeZone,
  cutoffMinutes
) {
  const at = projectionInstant(timestamp);
  const zone = requireRestaurantTimezone(timeZone);
  const local = restaurantLocalDate(zone, new Date(at));

  const boundary = projectionInstant(
    projectionBoundary(local, zone, cutoffMinutes)
  );

  return at < boundary ? shiftProjectionDate(local, -1) : local;
}

export function projectionNightWindow(
  date,
  timeZone,
  cutoffMinutes
) {
  calendar(date);

  return Object.freeze({
    from: projectionBoundary(date, timeZone, cutoffMinutes),
    to: projectionBoundary(
      shiftProjectionDate(date, 1),
      timeZone,
      cutoffMinutes
    ),
  });
}