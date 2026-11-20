import { shiftProjectionDate } from './businessTime.js';

export async function projectionCalendarRequest(supabase, path, body, method = body ? 'POST' : 'GET') {
  const { data: { session } = {}, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error('Please sign in again.');
  const response = await fetch(path, { method, headers: {
    Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json',
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save optional calendar preferences.');
  return result;
}

export async function saveOptionalProjectionSetup(supabase, data) {
  const current = await projectionCalendarRequest(supabase, '/api/projections/calendar');
  return projectionCalendarRequest(supabase, '/api/projections/calendar', {
    expected_revision: current.revision,
    settings: { concept_type: data.style || current.settings.concept_type || null,
      normally_closed_weekdays: data.normallyClosedWeekdays ?? current.settings.normally_closed_weekdays },
  }, 'PUT');
}

// Strict Mode and two mounted consumers share an in-flight claim. Persistence
// in the database, not this map, enforces once per holiday per year.
const claims = new Map();
export function claimOptionalProjectionHoliday(supabase, key) {
  if (!claims.has(key)) claims.set(key, projectionCalendarRequest(supabase,
    '/api/projections/holiday', { action: 'claim' }).finally(() => claims.delete(key)));
  return claims.get(key);
}

export function projectionHolidayDateLabel(date) {
  shiftProjectionDate(date, 0);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}