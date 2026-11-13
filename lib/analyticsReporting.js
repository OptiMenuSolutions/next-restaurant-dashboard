import { getInvoiceEffectiveDate } from './invoiceRepricing.js';

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function analyticsRevenue(sale, menuPrice) {
  return sale.revenue != null
    ? number(sale.revenue)
    : number(sale.quantity_sold) * number(sale.unit_price ?? menuPrice);
}

export function analyticsDishMetrics(dish) {
  const qty = Number(dish.qty);
  const revenue = Number(dish.rev);
  const cogs = Number(dish.cogs);
  const known = dish.costMissing !== true &&
    dish.cost != null && Number.isFinite(Number(dish.cost)) &&
    Number(dish.cost) >= 0 &&
    Number.isFinite(revenue) && Number.isFinite(cogs);
  const total = known ? revenue - cogs : null;
  return {
    ...dish,
    price: Number.isFinite(qty) && qty > 0 ? revenue / qty : dish.price,
    contribPer: total != null && qty > 0 ? total / qty : null,
    contribTotal: total,
    foodCostPct: known && revenue > 0 ? (cogs / revenue) * 100 : null,
  };
}

export function eligibleAnalyticsSales(rows, today) {
  if (typeof today !== 'string' || getInvoiceEffectiveDate({ date: today }) !== today) {
    throw new TypeError('A valid restaurant-local date is required.');
  }
  return rows.filter((row) => {
    const date = getInvoiceEffectiveDate({ date: row.sale_date });
    return date != null && date <= today;
  });
}

export async function loadAnalyticsSales(db, restaurantId, today) {
  eligibleAnalyticsSales([], today);
  if (typeof restaurantId !== 'string' || !restaurantId) {
    throw new TypeError('A restaurant ID is required.');
  }
  const rows = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from('pos_sales')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .lte('sale_date', today)
      .order('sale_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + 499);
    if (error) throw new Error('Could not load POS sales: ' + error.message);
    if (!Array.isArray(data)) throw new Error('Invalid POS sales response.');
    if (!data.length) return eligibleAnalyticsSales(rows, today);
    rows.push(...data);
    from += data.length;
  }
}
