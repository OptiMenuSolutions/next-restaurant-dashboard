import { calculateInventoryAsOf } from './inventoryAsOf.js';
import { projectionBoundary, projectionInstant, shiftProjectionDate } from './projections/businessTime.js';
import { requireRestaurantTimezone, restaurantLocalDate } from './restaurantTime.js';

// The shared POS sync replaces complete calendar dates. The as-of build
// applies the strict close-time cutoff to determine inventory consumption.
export async function prepareWasteDailyInventory(db, job, {
  sync,
  calculate = calculateInventoryAsOf,
  now = () => new Date().toISOString(),
} = {}) {
  const { restaurant_id: restaurantId, assessment_date: day, timing } = job;
  const { data: connection, error } = await db.from('pos_connections')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('provider', 'shift4')
    .eq('status', 'connected')
    .maybeSingle();

  if (error) throw error;
  if (!connection) {
    throw Object.assign(new Error('No connected Shift4 source.'), { code: 'POS_CONNECTION_REQUIRED' });
  }

  const zone = requireRestaurantTimezone(timing.timezone);
  if (requireRestaurantTimezone(connection.shift4_timezone) !== zone) {
    throw Object.assign(new Error('Shift4 and restaurant time zones differ.'), { code: 'POS_TIMEZONE_MISMATCH' });
  }

  const boundary = projectionInstant(timing.starts_at);
  const previousBoundary = projectionInstant(projectionBoundary(
    shiftProjectionDate(day, -1), zone, timing.cutoff_minutes
  ));
  const range = {
    from: restaurantLocalDate(zone, new Date(previousBoundary)),
    to: restaurantLocalDate(zone, new Date(boundary - 1)),
  };

  const attemptAt = projectionInstant(now());
  if (attemptAt < projectionInstant(job.sync_not_before) || attemptAt >= projectionInstant(timing.deadline_at)) {
    throw Object.assign(new Error('Outside the daily POS sync window.'), { code: 'POS_SYNC_OUTSIDE_WINDOW' });
  }

  const syncConnection = sync ?? (await import('./pos/syncConnection.js')).syncPosConnection;
  const receipt = await syncConnection(db, connection, range, { alertOnFailure: false });

  if (!receipt.rawTicketsSaved || receipt.usage?.error || receipt.usage?.retryPending) {
    throw Object.assign(new Error('POS raw tickets or ingredient usage are incomplete.'), { code: 'POS_SYNC_INCOMPLETE' });
  }

  const inventoryStartedAt = now();
  if (projectionInstant(inventoryStartedAt) >= projectionInstant(timing.deadline_at)) {
    throw Object.assign(new Error('Daily inventory readiness deadline passed.'), { code: 'INVENTORY_DEADLINE_MISSED' });
  }

  const inventory = await calculate(db, restaurantId, timing.starts_at, zone);

  return {
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt,
    rawTicketsSaved: receipt.rawTicketsSaved,
    syncRevision: receipt.syncRevision,
    inventoryStartedAt,
    rows: inventory.rows,
    usageJob: inventory.usageJob,
  };
}