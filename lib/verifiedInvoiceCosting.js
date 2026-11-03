
import { parseNumberedCanPack } from './invoicePackageSize.js';
import { calculateInvoiceLineValues } from './invoiceLineCalculations.js';

const VALID_UNITS = new Set([
  'oz', 'lb', 'g', 'kg',
  'fl oz', 'ml', 'l', 'gal',
]);

/**
 * Shared invoice-cost calculation.
 *
 * verifiedConversion must be produced by trusted server-side
 * verification. Never populate it directly from request data.
 */
export function calculateVerifiedInvoiceCost(
  item,
  verifiedConversion = null
) {
  const numberedCan = !item.catch_weight
    ? parseNumberedCanPack(item.pack_size_raw)
    : null;

  const base = calculateInvoiceLineValues(item);

  if (!numberedCan) {
    return {
      ...base,
      pricingStatus: 'calculated',
    };
  }

  const approved =
    verifiedConversion?.conversionApproved === true &&
    verifiedConversion?.verificationStatus === 'verified';

  const conversion = approved
    ? verifiedConversion.conversion
    : null;

  const validConversion =
    conversion?.scope === 'per_container' &&
    conversion?.basis === 'authenticated_supplier_record' &&
    conversion.fromUnit === 'can' &&
    VALID_UNITS.has(conversion.toUnit) &&
    Number.isFinite(conversion.factor) &&
    conversion.factor > 0;

  if (!validConversion) {
    return {
      ...base,
      unit_cost: null,
      pricingStatus: 'needs_package_verification',
    };
  }

  const shipped = Number(
    item.quantity_shipped ?? item.quantity_ordered ?? 1
  );

  const lineTotal = Number(item.line_total);

  if (
    !Number.isFinite(shipped) ||
    shipped <= 0 ||
    !Number.isFinite(lineTotal) ||
    lineTotal <= 0
  ) {
    return {
      ...base,
      unit_cost: null,
      pricingStatus: 'missing_invoice_price',
    };
  }

  const quantity =
    shipped * numberedCan.pack * conversion.factor;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ...base,
      unit_cost: null,
      pricingStatus: 'invalid_verified_quantity',
    };
  }

  return {
    quantity,
    unit: conversion.toUnit,
    unit_cost: lineTotal / quantity,
    pricingStatus: 'verified',
  };
}
