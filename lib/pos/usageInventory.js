// Browser-safe: no credentials, Claude client, or Node imports.

import { projectionInstant } from '../projections/businessTime.js';

export function missingPosCloseTimestamp() {
  return Object.assign(
    new Error('POS ticket close timestamps are required for as-of inventory.'),
    { code: 'POS_CLOSE_TIMESTAMP_REQUIRED' }
  );
}

export function posUsageNotApplied() {
  return Object.assign(
    new Error('POS usage has not been applied to the current sales revision.'),
    { code: 'POS_USAGE_NOT_APPLIED' }
  );
}

export function posCloseInstant(value) {
  try {
    return projectionInstant(value);
  } catch {
    throw missingPosCloseTimestamp();
  }
}

export async function inventoryPosInputs(
  db,
  restaurantId,
  throughDate,
  posSales,
  menuItems,
  boundary = null
) {
  // Keep the existing sales order and replay rules. For an as-of build,
  // the reader replaces aggregate quantities with timestamp-bounded quantities.
  const baseSales = boundary
    ? await boundary.readSales(posSales)
    : posSales;

  const setting = await db
    .from('pos_usage_settings')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (setting.error) throw setting.error;

  if (
    !setting.data?.enabled ||
    throughDate < setting.data.start_date
  ) {
    return { posSales: baseSales, menuItems };
  }

  const source = await db.rpc(
    'pos_usage_source',
    { p_restaurant_id: restaurantId }
  );

  if (source.error) throw source.error;

  const saved = await db
    .from('pos_usage_results')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (saved.error) throw saved.error;

  if (
    !saved.data?.usable ||
    saved.data.source_revision !== source.data?.revision ||
    (boundary && (
      !boundary.appliedUsagePublicationId ||
      saved.data.publication_id !== boundary.appliedUsagePublicationId
    ))
  ) {
    if (boundary) throw posUsageNotApplied();

    throw new Error(
      'Inventory preserved while the background worker prepares updated POS data.'
    );
  }

  // Only successfully prepared servings appear in sales/recipes.
  // Blocked servings remain explicitly listed in the review report.
  // Replace the covered aggregate sales; never add both together.

  // Replace covered Shift4 API sales rather than adding another
  // deduction alongside their existing aggregated sales.
  const keep = baseSales.filter((sale) => !(
    sale.pos_system === 'shift4' &&
    sale.upload_session_id == null &&
    sale.sale_date >= setting.data.start_date
  ));

  const preparedSales = saved.data.sales.filter((sale) => {
    if (sale.sale_date > throughDate) return false;
    return !boundary || posCloseInstant(sale.closed_at) < boundary.instant;
  });

  return {
    posSales: [...keep, ...preparedSales],
    menuItems: [...menuItems, ...saved.data.recipes],
  };
}