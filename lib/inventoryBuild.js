export async function inventoryBuild(
  db,
  restaurantId,
  calculate,
  submission = null
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: token, error: beginError } = await db.rpc(
      'begin_inventory_build',
      { p_restaurant_id: restaurantId }
    );

    if (beginError) throw beginError;

    const throughDate = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    });

    const { rows } = await calculate(
      db,
      restaurantId,
      throughDate,
      submission
    );

    const { data, error } = await db.rpc(
      'commit_inventory_build',
      {
        p_restaurant_id: restaurantId,
        p_token: token,
        p_rows: rows,
        p_submission: submission,
      }
    );

    if (!error) return submission ? data : data.rows;

    if (error.message?.includes('INVENTORY_BUILD_CHANGED')) {
      continue;
    }

    throw new Error(
      error.message || 'Inventory could not be saved.'
    );
  }

  throw new Error(
    'Inventory changed during submission. Please try again.'
  );
}