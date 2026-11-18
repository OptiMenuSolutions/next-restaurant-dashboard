import { calculateVerifiedIngredientCost } from './verifiedIngredientCost.js';

const numeric = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function dashboardDishFinancials(item, { sample = false,
  restaurantId = item?.restaurant_id } = {}) {
  const price = numeric(item?.price);
  const unavailable = { price, cost: null, contribution: null,
    foodCostPct: null, marginPct: null, estimated: false };
  let total = 0;
  let estimated = sample;
  if (sample) {
    total = numeric(item?.cost);
    if (total == null || total < 0) return unavailable;
  } else {
    if (typeof restaurantId !== 'string' || !restaurantId || item?.restaurant_id !== restaurantId) return unavailable;
    const components = item.menu_item_components || [];
    if (!Array.isArray(components) || components.some(component =>
      !Array.isArray(component?.component_ingredients))) return unavailable;
    const lines = components.length
      ? components.flatMap(component => component.component_ingredients || [])
      : item.menu_item_ingredients || [];
    if (!Array.isArray(lines) || !lines.length) return unavailable;
    for (const line of lines) {
      const ingredient = line?.ingredients;
      const quantity = numeric(line?.quantity);
      if (!ingredient?.id || ingredient.restaurant_id !== restaurantId ||
        quantity == null || quantity < 0) return unavailable;
      // An explicitly zero recipe quantity contributes no cost.
      if (quantity === 0) continue;
      if (typeof ingredient.unit !== 'string' || !ingredient.unit.trim()) return unavailable;
      const unitPrice = numeric(ingredient.last_price);
      const approved = typeof ingredient.price_approved_at === 'string' &&
        Number.isFinite(Date.parse(ingredient.price_approved_at));
      if (ingredient.price_status === 'needs_review' || unitPrice == null || unitPrice < 0 ||
        !(ingredient.is_estimated === false || approved)) return unavailable;
      const unit = typeof line.unit === 'string' && line.unit.trim()
        ? line.unit : ingredient.unit;
      const cost = calculateVerifiedIngredientCost(quantity, unit, ingredient);
      if (cost == null || !Number.isFinite(cost) || cost < 0) return unavailable;
      total += cost;
      estimated ||= ingredient.is_estimated !== false;
    }
  }
  if (!Number.isFinite(total)) return unavailable;
  // Match the canonical dish calculation: round the complete plate once.
  const cost = Math.round((total + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(cost)) return unavailable;
  const validPrice = price != null && price > 0;
  const contribution = validPrice ? price - cost : null;
  const foodCostPct = validPrice ? cost / price * 100 : null;
  const marginPct = validPrice ? (price - cost) / price * 100 : null;
  if (validPrice && ![contribution, foodCostPct, marginPct].every(Number.isFinite)) {
    return { ...unavailable, cost, estimated };
  }
  return { price, cost, estimated, contribution, foodCostPct, marginPct };
}

export function dashboardMarginStats(items, options = {}) {
  const financials = items.map(item => dashboardDishFinancials(item, options))
    .filter(item => item.marginPct != null);
  const margins = financials.map(item => item.marginPct);
  const count = margins.length;
  return {
    avgMargin: count ? margins.reduce((sum, margin) => sum + margin / count, 0) : null,
    lowMargin: margins.filter(margin => margin < 50).length,
    pctAbove50: count ? margins.filter(margin => margin >= 50).length / count : 0,
    pctBelow25: count ? margins.filter(margin => margin < 25).length / count : 0,
    pricedCount: count,
    totalCount: items.length,
    unpricedCount: items.length - count,
    estimatedCount: financials.filter(item => item.estimated).length,
  };
}

const ingredientFields = `id,name,restaurant_id,unit,last_price,is_estimated,price_status,price_approved_at,
  ingredient_unit_conversions(id,ingredient_id,from_unit,to_unit,factor,basis,evidence),
  ingredient_conversion_default_links(
    ingredient_conversion_defaults(id,label,from_unit,to_unit,factor,basis,evidence,source_url)
  )`;

export async function loadDashboardMenuItems(db, restaurantId) {
  if (typeof restaurantId !== 'string' || !restaurantId) {
    throw new Error('A restaurant ID is required for dashboard pricing.');
  }
  const rows = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from('menu_items').select(`
      id,restaurant_id,name,price,cost,category,
      menu_item_components(id,name,component_ingredients(quantity,unit,ingredients(${ingredientFields}))),
      menu_item_ingredients(quantity,ingredients(${ingredientFields}))
    `).eq('restaurant_id', restaurantId).is('archived_at', null)
      .order('id', { ascending: true }).range(from, from + 499);
    if (error) throw new Error('Could not load dashboard recipes: ' + error.message);
    if (!Array.isArray(data) || data.some(row => row?.restaurant_id !== restaurantId)) {
      throw new Error('Invalid dashboard recipe response.');
    }
    if (!data.length) return rows;
    rows.push(...data);
    from += data.length;
  }
}