
import { parseNumberedCanPack } from './invoicePackageSize';

export function normalizeInvoicePackage(item) {
  const parsed = parseNumberedCanPack(item.pack_size_raw);

  if (!parsed || item.catch_weight) return item;

  return {
    ...item,
    pack: parsed.pack,
    size: parsed.size,
    size_unit: parsed.size_unit,
  };
}

export function calculateInvoiceLineValues(rawItem) {
  const item = normalizeInvoicePackage(rawItem);

  const shipped = Number(
    item.quantity_shipped ?? item.quantity_ordered ?? 1
  );

  const pack = Number(item.pack);
  const size = Number(item.size);
  const lineTotal = Number(item.line_total);

  if (item.catch_weight && Number(item.actual_weight) > 0) {
    const quantity = Number(item.actual_weight);

    return {
      quantity,
      unit: 'lb',
      unit_cost: lineTotal > 0
        ? Math.round((lineTotal / quantity) * 1e6) / 1e6
        : item.invoice_price ?? null,
    };
  }

  if (
    Number.isFinite(shipped) &&
    shipped > 0 &&
    Number.isFinite(pack) &&
    pack > 0 &&
    Number.isFinite(size) &&
    size > 0 &&
    item.size_unit
  ) {
    const quantity = shipped * pack * size;

    return {
      quantity,
      unit: item.size_unit,
      unit_cost: lineTotal > 0
        ? lineTotal / quantity
        : Number(item.invoice_price) / (pack * size) || null,
    };
  }

  return {
    quantity: item.quantity_shipped ?? item.quantity_ordered ?? null,
    unit: item.size_unit || item.standard_unit || 'each',
    unit_cost: item.invoice_price ?? null,
  };
}
