import {
  parseOrdinaryInvoicePackage,
} from './invoiceOrdinaryPackage.js';

const PURCHASE_UNITS = {
  CS: 'case',
  CASE: 'case',
  EA: 'each',
  EACH: 'each',
  CT: 'each',
  LB: 'lb',
  LBS: 'lb',
  OZ: 'oz',
  GAL: 'gal',
  GA: 'gal',
  QT: 'qt',
  PT: 'pt',
  KG: 'kg',
  G: 'g',
  L: 'l',
  ML: 'ml',
};

function positiveNumber(value) {
  if (value == null || value === '') return null;

  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function normalizePurchaseUnit(value) {
  const key = String(value || '')
    .trim()
    .toUpperCase();

  return PURCHASE_UNITS[key] || null;
}

function moneyAgrees(actual, expected) {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <= 0.01
  );
}

export function buildInvoicePurchasePricing(
  item,
  calculatedCost
) {
  const purchaseQuantity = positiveNumber(
    item.quantity_shipped ?? item.quantity_ordered
  );

  const purchaseUnit = normalizePurchaseUnit(
    item.quantity_unit
  );

  const invoicePrice = positiveNumber(
    item.invoice_price
  );

  const lineTotal = positiveNumber(
    item.line_total
  );

  const rawPackage =
    String(item.pack_size_raw || '').trim() || null;

  const packageStatus =
    calculatedCost?.pricingStatus || null;

  const parsedPackage =
    rawPackage && !item.catch_weight
      ? parseOrdinaryInvoicePackage(rawPackage)
      : null;

  const supportedPackage =
    packageStatus === 'invoice_document_consistent' &&
    parsedPackage != null;

  // A line priced by weight must not be represented
  // as though its unit price were a case price.
  const purchasePriceSupported =
    !item.catch_weight &&
    purchaseQuantity != null &&
    invoicePrice != null &&
    lineTotal != null &&
    moneyAgrees(
      purchaseQuantity * invoicePrice,
      lineTotal
    );

  return {
    purchase_quantity: purchaseQuantity,
    purchase_unit: purchaseUnit,

    purchase_unit_price: purchasePriceSupported
      ? invoicePrice
      : null,

    package_quantity: supportedPackage
      ? parsedPackage.pack * parsedPackage.size
      : null,

    package_unit: supportedPackage
      ? parsedPackage.size_unit
      : null,

    package_description: rawPackage,

    package_validation_status: packageStatus,
  };
}