import { readAllInventoryRows } from './currentInventory.js';
import { shiftProjectionDate as shift } from './projections/businessTime.js';

const quantity = value => value === null || value === undefined ? null : Number(value);

export async function readWasteDailyInput(db, job, assessedAt) {
  const { restaurant_id: restaurantId, assessment_date: assessmentDate, forecast_run_id: runId } = job;
  if (!job.forecast_pinned || !Array.isArray(job.receipt?.rows)) {
    throw new Error('A pinned forecast choice and saved inventory are required.');
  }

  const read = (table, columns, filter = query => query, key = 'id') =>
    readAllInventoryRows(() => filter(db.from(table).select(columns)
      .eq('restaurant_id', restaurantId)).order(key, { ascending: true }), table);

  const ingredientsRead = read('ingredients', `id,restaurant_id,name,unit,
    ingredient_unit_conversions(id,ingredient_id,from_unit,to_unit,factor,basis,evidence),
    ingredient_conversion_default_links(
      ingredient_conversion_defaults(id,label,from_unit,to_unit,factor,basis,evidence,source_url)
    )`);
  const [ingredients, runs, nights, shares, dishes, menu] = await Promise.all([
    ingredientsRead,
    runId ? read('projection_forecast_runs',
      'id,restaurant_id,run_date,issued_at,source_through,model_major,calibration_key',
      query => query.eq('id', runId)) : [],
    runId ? read('projection_forecast_nights', 'target_date,availability,low',
      query => query.eq('run_id', runId), 'target_date') : [],
    runId ? read('projection_forecast_dishes', 'target_date,dish_id,share,trace',
      query => query.eq('run_id', runId).order('target_date'), 'dish_id') : [],
    runId ? read('projection_dishes', 'id,menu_item_id') : [],
    runId ? read('menu_items', 'id,menu_item_components(component_ingredients(ingredient_id,quantity,unit))') : [],
  ]);

  if (runId && (
    runs.length !== 1 || runs[0].run_date !== (job.fallback ? shift(assessmentDate, -1) : assessmentDate)
  )) {
    throw new Error('Pinned forecast run does not match the assessment date.');
  }

  const catalog = new Set(ingredients.map(row => row.id));
  const menuById = new Map(menu.map(row => [row.id, row]));
  const projectionToMenu = new Map(dishes.map(row => [row.id, row.menu_item_id]));
  const recipes = [];
  const sharesByDate = new Map();

  for (const row of shares) {
    const active = row.trace?.active;
    if (typeof active !== 'boolean') throw new Error('Archived dish activity is missing.');
    const dish = {
      dish_id: row.dish_id,
      active,
      status: row.trace.status === 'closed' ? 'ok' : row.trace.status,
      share: quantity(row.share),
    };
    const group = sharesByDate.get(row.target_date) ?? [];
    group.push(dish);
    sharesByDate.set(row.target_date, group);

    if (!active) continue;
    const source = menuById.get(projectionToMenu.get(row.dish_id));
    const components = source?.menu_item_components ?? [];
    const portions = components.flatMap(component =>
      (component.component_ingredients ?? []).map(part => ({
        ingredient_id: catalog.has(part.ingredient_id) ? part.ingredient_id : null,
        quantity: quantity(part.quantity),
        unit: part.unit || null,
      }))
    );
    recipes.push({
      restaurant_id: restaurantId,
      business_date: row.target_date,
      dish_id: row.dish_id,
      active: true,
      complete: components.length > 0 && components.every(component => component.component_ingredients?.length > 0)
        && portions.every(part => part.ingredient_id && part.quantity !== null && part.unit),
      portions,
    });
  }

  return {
    restaurantId,
    assessmentDate,
    assessedAt,
    inventoryCutoff: shift(assessmentDate, -1),
    timeZone: job.timing.timezone,
    cutoffMinutes: job.timing.cutoff_minutes,
    inventoryComplete: true,
    forecastFallback: job.fallback,
    ingredients,
    batches: job.receipt.rows.map(row => {
      if (row.restaurant_id !== restaurantId) throw new Error('As-of inventory crosses restaurants.');
      const received = row.delivery_date ?? null;
      return {
        restaurant_id: restaurantId,
        id: row.stock_source === 'count' ? row.count_line_id : row.invoice_item_id,
        ingredient_id: catalog.has(row.ingredient_id) ? row.ingredient_id : null,
        received_date: received,
        use_by_date: received && Number.isInteger(row.shelf_life) ? shift(received, row.shelf_life) : null,
        remaining_qty: quantity(row.remaining_qty),
        unit: row.unit || null,
        unit_cost: quantity(row.unit_cost),
      };
    }),
    forecast: runId ? {
      ...runs[0],
      nights: nights.map(row => ({
        business_date: row.target_date,
        availability: row.availability,
        low: quantity(row.low),
        dishes: sharesByDate.get(row.target_date) ?? [],
      })),
    } : null,
    recipes,
  };
}