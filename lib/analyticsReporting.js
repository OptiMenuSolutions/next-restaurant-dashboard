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
