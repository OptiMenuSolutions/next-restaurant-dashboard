function timezoneError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function requireRestaurantTimezone(value) {
  if (value == null) {
    throw timezoneError(
      'Configure the restaurant time zone before running date-based calculations.',
      'RESTAURANT_TIMEZONE_REQUIRED'
    );
  }

  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    (value !== 'UTC' && !value.includes('/')) ||
    /^(posix|right)\//.test(value)
  ) {
    throw timezoneError(
      'The restaurant time zone is invalid.',
      'RESTAURANT_TIMEZONE_INVALID'
    );
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    throw timezoneError(
      'The restaurant time zone is invalid.',
      'RESTAURANT_TIMEZONE_INVALID'
    );
  }
}

// Convert an instant to the restaurant's calendar date.
// Printed invoice and delivery dates are already calendar dates;
// do not pass them through this timestamp conversion.
export function restaurantLocalDate(timeZone, now = new Date()) {
  const validatedZone = requireRestaurantTimezone(timeZone);

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('A valid timestamp is required.');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validatedZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const value = type =>
    parts.find(part => part.type === type).value;

  return [value('year'), value('month'), value('day')].join('-');
}

export async function loadRestaurantTimezone(db, restaurantId) {
  if (typeof restaurantId !== 'string' || !restaurantId) {
    throw new TypeError('A restaurant ID is required.');
  }

  const { data, error } = await db
    .from('restaurants')
    .select('id, operational_timezone')
    .eq('id', restaurantId)
    .maybeSingle();

  if (error) {
    throw timezoneError(
      'Could not load the restaurant time zone: ' + error.message,
      'RESTAURANT_TIMEZONE_LOAD_FAILED'
    );
  }

  if (!data || data.id !== restaurantId) {
    throw timezoneError(
      'Restaurant not found or inaccessible.',
      'RESTAURANT_NOT_FOUND'
    );
  }

  return requireRestaurantTimezone(data.operational_timezone);
}