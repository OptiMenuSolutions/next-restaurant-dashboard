
import {
  extractProductSourceRecord,
  validateSourcePackMeasurement,
} from './productSourceVerification.js';

const normalize = (value) =>
  String(value ?? '').trim().toLowerCase()
    .replace(/\s+/g, ' ');

const normalizeSku = (value) =>
  String(value ?? '').trim().toUpperCase()
    .replace(/[\s-]/g, '');

const review = (reason) => ({
  status: 'needs_review',
  reason,
  sourceAuthorityVerified: false,
  productIdentityVerified: false,
  conversionApproved: false,
  conversion: null,
});

function sourceHasExactLabel(text, label, value) {
  const lines = text.split(/\r?\n/);

  const matches = lines.filter((line, index) => {
    const match = line.trim().match(label);
    if (!match) return false;

    const reported = match[1].trim() ||
      lines[index + 1]?.trim() || '';

    return normalize(reported) === normalize(value);
  });

  return matches.length === 1;
}

export function verifyDirectSupplierProduct({
  invoiceProduct,
  evidence,
  sourceDocument,
  trustedSuppliers = [],
} = {}) {
  if (
    !invoiceProduct?.supplier ||
    !invoiceProduct?.sku ||
    !invoiceProduct?.brand
  ) {
    return review('Invoice supplier, SKU, or brand is missing');
  }

  if (
    sourceDocument?.origin !== 'anthropic_web_fetch' ||
    typeof sourceDocument.text !== 'string' ||
    !sourceDocument.text.trim()
  ) {
    return review('Original retrieved source text is missing');
  }

  let hostname;

  try {
    const url = new URL(sourceDocument.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port
    ) {
      return review('Source URL is not eligible');
    }
    hostname = url.hostname.toLowerCase();
  } catch {
    return review('Source URL is invalid');
  }

  if (
    evidence?.source?.url !== sourceDocument.url
  ) {
    return review('Evidence and source URLs differ');
  }

  const trusted = trustedSuppliers.some((entry) =>
    normalize(entry.supplier) ===
      normalize(invoiceProduct.supplier) &&
    typeof entry.hostname === 'string' &&
    hostname === entry.hostname.toLowerCase()
  );

  if (!trusted) {
    return review('Supplier domain is not authenticated');
  }

  if (
    evidence?.package?.matches !== true ||
    !evidence.measurement ||
    evidence.measurement.scope !== 'per_container'
  ) {
    return review('Invoice package or measurement is incomplete');
  }

  if (
    normalizeSku(evidence.identity?.supplierSku) !==
    normalizeSku(invoiceProduct.sku)
  ) {
    return review('Reported supplier SKU does not match invoice');
  }

  const record = extractProductSourceRecord(
    sourceDocument.text,
    invoiceProduct.sku
  );

  if (record.status !== 'record_found') {
    return review(record.reason);
  }

  const text = record.record.text;

  if (!sourceHasExactLabel(
    text,
    /^(?:supplier\s+sku|distributor\s+sku|supplier\s+item)\s*:\s*(.*)$/i,
    invoiceProduct.sku
  )) {
    return review('Exact labeled supplier SKU is missing');
  }

  if (!sourceHasExactLabel(
    text,
    /^brand\s*:\s*(.*)$/i,
    invoiceProduct.brand
  )) {
    return review('Source brand does not match invoice');
  }

  const measurement = validateSourcePackMeasurement(
    evidence.measurement,
    evidence.package.expectedCount,
    record.record.packageSpecification.raw
  );

  if (!measurement.matches) {
    return review(measurement.reason);
  }

  const { quantity, unit } = evidence.measurement;

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    unit === 'each'
  ) {
    return review('Unsupported net measurement');
  }

  return {
    status: 'verified',
    reason: 'Authenticated supplier record matches invoice product and packaging',
    sourceAuthorityVerified: true,
    productIdentityVerified: true,
    conversionApproved: true,
    conversion: {
      fromUnit: invoiceProduct.containerUnit ?? null,
      toUnit: unit,
      factor: quantity,
      scope: 'per_container',
      basis: 'authenticated_supplier_record',
    },
    source: {
      url: sourceDocument.url,
      supplier: invoiceProduct.supplier,
      hostname,
      identifier: invoiceProduct.sku,
      packageSpecification:
        record.record.packageSpecification.raw,
    },
  };
}
