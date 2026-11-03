
import {
  extractProductSourceRecord,
} from './productSourceVerification.js';

const normalize = (value) =>
  String(value ?? '').trim().toLowerCase()
    .replace(/\s+/g, ' ');

function hostnameOf(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port
    ) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function exactLabel(text, pattern, value) {
  const lines = text.split(/\r?\n/);

  return lines.some((line, index) => {
    const match = line.trim().match(pattern);
    if (!match) return false;

    const found = match[1].trim() ||
      lines[index + 1]?.trim() || '';

    return normalize(found) === normalize(value);
  });
}

export function evaluateProductSourceConsensus({
  invoiceProduct,
  sources = [],
  trustedSuppliers = [],
} = {}) {
  const review = (reason, details = []) => ({
    status: 'needs_review',
    reason,
    conversionApproved: false,
    conversion: null,
    sourceDetails: details,
  });

  const details = [];
  const specifications = new Set();
  const approved = [];

  for (const item of sources) {
    const hostname = hostnameOf(item.url);

    const trusted = trustedSuppliers.some((entry) =>
      normalize(entry.supplier) ===
        normalize(invoiceProduct?.supplier) &&
      normalize(entry.hostname) === hostname
    );

    if (!trusted) {
      details.push({
        url: item.url,
        status: 'untrusted',
      });
      continue;
    }

    const document = item.retrieval?.sourceDocument;

    if (
      item.retrieval?.status !== 'retrieved' ||
      document?.origin !== 'anthropic_web_fetch' ||
      document.url !== item.url ||
      typeof document.text !== 'string'
    ) {
      details.push({
        url: item.url,
        status: 'unavailable',
      });
      continue;
    }

    const record = extractProductSourceRecord(
      document.text,
      invoiceProduct.sku
    );

    if (record.status !== 'record_found') {
      details.push({
        url: item.url,
        status: 'incomplete',
        reason: record.reason,
      });
      continue;
    }

    const text = record.record.text;

    const skuMatches = exactLabel(
      text,
      /^(?:supplier\s+sku|distributor\s+sku|supplier\s+item)\s*:\s*(.*)$/i,
      invoiceProduct.sku
    );

    const brandMatches = exactLabel(
      text,
      /^brand\s*:\s*(.*)$/i,
      invoiceProduct.brand
    );

    if (!skuMatches || !brandMatches) {
      details.push({
        url: item.url,
        status: 'identity_mismatch',
      });
      continue;
    }

    const spec = record.record.packageSpecification.parsed;

    const key = JSON.stringify([
      spec.packageCount,
      spec.netQuantity,
      spec.netUnit,
      spec.measurementScope,
    ]);

    specifications.add(key);

    details.push({
      url: item.url,
      status: 'matched_product',
      specification: spec,
    });

    if (item.directSupplierDecision?.conversionApproved) {
      approved.push(item);
    }
  }

  if (specifications.size > 1) {
    return review(
      'Authenticated supplier sources contain conflicting package specifications',
      details
    );
  }

  if (details.some((item) =>
    item.status === 'unavailable' ||
    item.status === 'incomplete' ||
    item.status === 'identity_mismatch'
  )) {
    return review(
      'An authenticated supplier source requires further review',
      details
    );
  }

  if (approved.length === 0) {
    return review(
      'No authenticated source supports an approved conversion',
      details
    );
  }

  const winner = approved[0];

  return {
    status: 'verified',
    reason: 'Authenticated supplier evidence is consistent',
    conversionApproved: true,
    conversion: winner.directSupplierDecision.conversion,
    approvedSourceUrl: winner.url,
    sourceDetails: details,
  };
}
