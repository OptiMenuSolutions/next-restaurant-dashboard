// Stable identifiers keep JavaScript sorting identical to PostgreSQL COLLATE "C".
const KEY = /^[a-z][a-z0-9_]*$/;

export function canonicalProjectionHolidayKeys(keys) {
  if (!Array.isArray(keys)) {
    throw new TypeError('Holiday keys must be an array.');
  }

  const seen = new Set();

  for (const key of keys) {
    if (typeof key !== 'string' || !KEY.test(key)) {
      throw new TypeError(
        'Holiday keys must be nonblank lowercase ASCII identifiers.'
      );
    }

    if (seen.has(key)) {
      throw new TypeError(`Duplicate holiday key: ${key}`);
    }

    seen.add(key);
  }

  return Object.freeze([...keys].sort());
}