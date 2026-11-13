import { restaurantLocalDate } from './restaurantTime.js';

export function previousCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('A valid calendar date is required.');
  }

  const date = new Date(value + 'T12:00:00Z');
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError('A valid calendar date is required.');
  }

  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function wasteSnapshotDates(timeZone, now = new Date()) {
  const today = restaurantLocalDate(timeZone, now);
  return {
    today,
    snapshotDate: previousCalendarDate(today),
  };
}