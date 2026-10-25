// Browser-safe: no credentials, Claude client, or Node imports.

export async function inventoryPosInputs(
  db,
  restaurantId,
  throughDate,
  posSales,
  menuItems
) {
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
    return { posSales, menuItems };
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
    saved.data.source_revision !== source.data?.revision
  ) {
    throw new Error(
      'Inventory preserved while the background worker prepares updated POS data.'
    );
  }

  // Only successfully prepared servings appear in sales/recipes.
  // Blocked servings remain explicitly listed in the review report.
  // Replace the covered aggregate sales; never add both together.

  // Replace covered Shift4 API sales rather than adding another
  // deduction alongside their existing aggregated sales.
  const keep = posSales.filter((sale) => !(
    sale.pos_system === 'shift4' &&
    sale.upload_session_id == null &&
    sale.sale_date >= setting.data.start_date
  ));

  return {
    posSales: [
      ...keep,
      ...saved.data.sales.filter((sale) =>
        sale.sale_date <= throughDate
      ),
    ],
    menuItems: [
      ...menuItems,
      ...saved.data.recipes,
    ],
  };
}