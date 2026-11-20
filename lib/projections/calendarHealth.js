import { restaurantLocalDate } from '../restaurantTime.js';
import { projectionCalendarWeekday } from './calendar.js';

// This joins the existing admin service monitor and its persisted alert/recovery
// state. No separate schedule or email sender is introduced.
export async function projectionCalendarScheduleStatus(db, at = new Date()) {
  const started = Date.now();
  const base = { name: 'Projection holiday calendar', use: 'Published Super Bowl date for projections' };
  try {
    const today = restaurantLocalDate('America/New_York', at);
    const month = Number(today.slice(5, 7));
    const year = Number(today.slice(0, 4)) + (month >= 11 ? 1 : 0);
    if (month > 2 && month < 11) return { ...base, status: 'UP', ms: Date.now() - started, error: null };
    const reply = await db.from('projection_holiday_calendar').select('holiday_date, holiday_key')
      .eq('holiday_key', 'super_bowl').gte('holiday_date', `${year}-02-01`)
      .lt('holiday_date', `${year}-03-01`).abortSignal(AbortSignal.timeout(6000)).maybeSingle();
    if (!reply || reply.error || !Object.hasOwn(reply, 'data')) {
      throw new Error('Could not verify the published sports calendar.');
    }
    if (reply.data == null) return { ...base, status: 'NOT SET', ms: Date.now() - started,
      error: `Publish and verify the ${year} Super Bowl date before February projection runs.` };
    if (reply.data.holiday_key !== 'super_bowl' || !reply.data.holiday_date?.startsWith(`${year}-02-`) ||
      projectionCalendarWeekday(reply.data.holiday_date) !== 7) {
      throw new Error('The published Super Bowl calendar entry is invalid.');
    }
    return { ...base, status: 'UP', ms: Date.now() - started, error: null };
  } catch (error) {
    return { ...base, status: 'DOWN', ms: Date.now() - started, error: error.message };
  }
}

// Optional defaults remain usable; this is an administrator-only follow-up.
export async function projectionCalendarConceptStatus(db) {
  const started = Date.now();
  const base = { name: 'Projection concept defaults', use: 'Restaurants using the full service fallback' };
  try {
    const { data, error } = await db.rpc('projection_calendar_missing_concepts');
    if (error || !data || !Number.isSafeInteger(data.count) || data.count < 0 || !Array.isArray(data.names)) {
      throw new Error('Could not check projection concept defaults.');
    }
    return { ...base, status: data.count ? 'NOT SET' : 'UP', ms: Date.now() - started,
      error: data.count ? `${data.count} restaurant(s) use full service by default: ${data.names.slice(0, 10).join(', ')}. Forecasts continue.` : null };
  } catch (error) { return { ...base, status: 'DOWN', ms: Date.now() - started, error: error.message }; }
}