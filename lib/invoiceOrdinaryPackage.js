const PACKAGE_UNITS = new Map([
  ['LB', 'lb'],
  ['LBS', 'lb'],
  ['OZ', 'oz'],
  ['G', 'g'],
  ['KG', 'kg'],
  ['GAL', 'gal'],
  ['GALLON', 'gal'],
  ['FL OZ', 'fl oz'],
  ['ML', 'ml'],
  ['L', 'l'],
  ['CT', 'each'],
  ['EA', 'each'],
]);

export function parseOrdinaryInvoicePackage(raw) {
  const text = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

  // Supported examples:
  // 6/5 LB, 4 X 1 GAL, 12/12 OZ, 2/5 LB CS
  const match = text.match(
    /^(\d+(?:\.\d+)?)\s*(?:\/|X)\s*(\d+(?:\.\d+)?)\s*(FL OZ|GALLON|LBS|GAL|LB|OZ|KG|ML|CT|EA|G|L)(?:\s+(?:CASE|CS))?$/
  );

  if (!match) return null;

  const pack = Number(match[1]);
  const size = Number(match[2]);
  const unit = PACKAGE_UNITS.get(match[3]);

  if (
    !Number.isSafeInteger(pack) ||
    pack <= 0 ||
    !Number.isFinite(size) ||
    size <= 0 ||
    !unit
  ) {
    return null;
  }

  return {
    pack,
    size,
    size_unit: unit,
  };
}

export function resolveOrdinaryInvoicePackage(item) {
  if (item.catch_weight) {
    return {
      item,
      status: 'catch_weight',
    };
  }

  const raw = String(item.pack_size_raw || '').trim();

  const hasStructuredPack =
    item.pack != null &&
    item.size != null &&
    item.size_unit != null;

  // A structured pack without its source description
  // cannot establish a verified physical quantity.
  if (!raw) {
    return {
      item,
      status: hasStructuredPack
        ? 'needs_package_verification'
        : 'no_package_claim',
    };
  }

  const parsed = parseOrdinaryInvoicePackage(raw);

  if (!parsed) {
    return {
      item,
      status: 'needs_package_verification',
    };
  }

  if (hasStructuredPack) {
    const extractedPack = Number(item.pack);
    const extractedSize = Number(item.size);

    const extractedUnit = String(item.size_unit)
      .trim()
      .toLowerCase();

    if (
      extractedPack !== parsed.pack ||
      extractedSize !== parsed.size ||
      extractedUnit !== parsed.size_unit
    ) {
      return {
        item,
        status: 'package_discrepancy',
      };
    }
  }

  return {
    item: {
      ...item,
      pack: parsed.pack,
      size: parsed.size,
      size_unit: parsed.size_unit,
    },
    status: 'invoice_document_consistent',
  };
}