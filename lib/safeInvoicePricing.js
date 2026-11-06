import {
  convertToStandardUnit,
  getUnitCategory,
} from './standardizedUnits.js';

// Units with established physical conversion factors.
// Package descriptions are intentionally excluded.
const VERIFIED_PHYSICAL_UNITS = new Set([
  'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds',
  'g', 'gram', 'grams',
  'kg', 'kilogram', 'kilograms',

  'fl oz', 'floz', 'fluid ounce', 'fluid ounces',
  'ml', 'milliliter', 'milliliters',
  'l', 'liter', 'liters', 'litre', 'litres',
  'tsp', 'teaspoon', 'teaspoons',
  'tbsp', 'tablespoon', 'tablespoons',
  'cup', 'cups',
  'pt', 'pts', 'pint', 'pints',
  'qt', 'qts', 'quart', 'quarts',
  'gal', 'gallon', 'gallons',

  'each', 'piece', 'pieces',
  'item', 'items', 'whole',
  'ct', 'count',
  'dz', 'doz', 'dozen', 'dozens',
]);

export function safeInvoiceStandardPrice(
  unitCost,
  invoiceUnit
) {
  const price = Number(unitCost);

  const unit = String(invoiceUnit || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !VERIFIED_PHYSICAL_UNITS.has(unit)
  ) {
    return null;
  }

  const category = getUnitCategory(unit);

  if (
    category !== 'weight' &&
    category !== 'volume' &&
    category !== 'count'
  ) {
    return null;
  }

  // No ingredient-name density estimates are permitted.
  const converted = convertToStandardUnit(
    1,
    unit,
    ''
  );

  if (
    !converted.success ||
    !Number.isFinite(converted.quantity) ||
    converted.quantity <= 0 ||
    getUnitCategory(converted.unit) !== category
  ) {
    return null;
  }

  const standardPrice = price / converted.quantity;

  if (
    !Number.isFinite(standardPrice) ||
    standardPrice <= 0
  ) {
    return null;
  }

  return {
    price: standardPrice,
    unit: converted.unit,
  };
}