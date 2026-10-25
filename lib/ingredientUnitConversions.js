import { convertQuantity } from './computeWasteRisk';
import {
  normalizeUnit,
  getUnitCategory,
} from './standardizedUnits';

const unit = (value) => {
  const normalized = normalizeUnit(value);

  return ({
    slices: 'slice',
    bunches: 'bunch',
    packages: 'package',
  })[normalized] || normalized;
};

const physical = new Set([
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'cup', 'pt', 'qt', 'gal', 'ml', 'l',
  'tsp', 'tbsp', 'each', 'dozen',
]);

function exact(qty, from, to) {
  if (!from || !to) return null;
  if (from === to) return qty;

  if (!physical.has(from) || !physical.has(to)) {
    return null;
  }

  if (getUnitCategory(from) !== getUnitCategory(to)) {
    return null;
  }

  return convertQuantity(qty, from, to, '');
}

export function convertIngredientQuantity(
  qty,
  fromUnit,
  toUnit,
  ingredient
) {
  if (!Number.isFinite(qty) || qty < 0) return null;

  const from = unit(fromUnit);
  const to = unit(toUnit);

  if (!from || !to) return null;

  const direct = exact(qty, from, to);

  if (Number.isFinite(direct)) {
    return {
      quantity: direct,
      estimated: false,
      conversionId: null,
    };
  }

  const matches = [];

  for (
    const row of ingredient?.ingredient_unit_conversions || []
  ) {
    // Never use another ingredient's conversion.
    if (row.ingredient_id !== ingredient.id) continue;

    const factor = Number(row.factor);

    if (!Number.isFinite(factor) || factor <= 0) {
      continue;
    }

    const left = unit(row.from_unit);
    const right = unit(row.to_unit);

    // A saved conversion works in either direction.
    for (const [start, end, multiplier] of [
      [left, right, factor],
      [right, left, 1 / factor],
    ]) {
      const input = exact(qty, from, start);

      if (!Number.isFinite(input)) continue;

      const quantity = exact(
        input * multiplier,
        end,
        to
      );

      if (!Number.isFinite(quantity) || quantity < 0) {
        continue;
      }

      matches.push({
        quantity,
        estimated: row.basis === 'estimated',
        conversionId: row.id,
      });
    }
  }

  // Conflicting saved conversions require review.
  if (matches.length) {
    const first = matches[0].quantity;

    const conflict = matches.some((match) =>
      Math.abs(match.quantity - first) >
      1e-8 * Math.max(1, Math.abs(first))
    );

    if (conflict) return null;

    return {
      ...matches[0],
      estimated: matches.some((match) => match.estimated),
    };
  }

  // Preserve the existing weight/volume density estimate.
  // Never invent a piece, slice, bunch, or package weight.
  if (!physical.has(from) || !physical.has(to)) {
    return null;
  }

  const fromCategory = getUnitCategory(from);
  const toCategory = getUnitCategory(to);

  const densityConversion =
    (fromCategory === 'weight' && toCategory === 'volume') ||
    (fromCategory === 'volume' && toCategory === 'weight');

  if (!densityConversion) return null;

  const quantity = convertQuantity(
    qty,
    from,
    to,
    ingredient?.name || ''
  );

  return Number.isFinite(quantity) && quantity >= 0
    ? {
        quantity,
        estimated: true,
        conversionId: null,
      }
    : null;
}