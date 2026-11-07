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
  ['COUNT', 'each'],
  ['COUNTS', 'each'],
  ['EA', 'each'],
]);

function normalizePackageUnit(unit) {
  const raw = String(unit || '').trim().toUpperCase();

  return PACKAGE_UNITS.get(raw) ||
    (raw === 'EACH' ? 'each' : null);
}

function parseOrdinaryInvoicePackageDetails(raw) {
  const text = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

  // Compound packages:
  // 6/5 LB, 4 X 1 GAL, 12/12 OZ, 2/5 LB CS
  const compound = text.match(
    /^(\d+(?:\.\d+)?)\s*(?:\/|X)\s*(\d+(?:\.\d+)?)\s*(FL OZ|GALLON|COUNTS|COUNT|LBS|GAL|LB|OZ|KG|ML|CT|EA|G|L)(?:\s+(?:CASE|CS))?$/
  );

  if (compound) {
    const pack = Number(compound[1]);
    const size = Number(compound[2]);
    const size_unit = normalizePackageUnit(compound[3]);

    if (
      !Number.isSafeInteger(pack) ||
      pack <= 0 ||
      !Number.isFinite(size) ||
      size <= 0 ||
      !size_unit
    ) {
      return null;
    }

    return {
      pack,
      size,
      size_unit,
      format: 'compound',
    };
  }

  // Standalone quantities:
  // 12 CT, 5 LB, 6 CT, 10 LB
  //
  // These describe the total quantity inside one
  // purchased package or case.
  const standalone = text.match(
    /^(\d+(?:\.\d+)?)\s*(FL OZ|GALLON|COUNTS|COUNT|LBS|GAL|LB|OZ|KG|ML|CT|EA|G|L)(?:\s+(?:CASE|CS))?$/
  );

  if (!standalone) return null;

  const size = Number(standalone[1]);
  const size_unit = normalizePackageUnit(standalone[2]);

  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    !size_unit
  ) {
    return null;
  }

  return {
    pack: 1,
    size,
    size_unit,
    format: 'standalone',
  };
}

export function parseOrdinaryInvoicePackage(raw) {
  const parsed = parseOrdinaryInvoicePackageDetails(raw);

  if (!parsed) return null;

  return {
    pack: parsed.pack,
    size: parsed.size,
    size_unit: parsed.size_unit,
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

  const parsed = parseOrdinaryInvoicePackageDetails(raw);

  if (!parsed) {
    return {
      item,
      status: 'needs_package_verification',
    };
  }

  if (hasStructuredPack) {
    const extractedPack = Number(item.pack);
    const extractedSize = Number(item.size);
    const extractedUnit = normalizePackageUnit(
      item.size_unit
    );

    const validStructuredValues =
      Number.isSafeInteger(extractedPack) &&
      extractedPack > 0 &&
      Number.isFinite(extractedSize) &&
      extractedSize > 0 &&
      extractedUnit != null;

    if (!validStructuredValues) {
      return {
        item,
        status: 'package_discrepancy',
      };
    }

    const sameUnit =
      extractedUnit === parsed.size_unit;

    let quantitiesAgree = false;

    if (parsed.format === 'compound') {
      // Compound package structure must match exactly.
      quantitiesAgree =
        extractedPack === parsed.pack &&
        extractedSize === parsed.size;
    } else {
      // Standalone package quantities can be represented
      // as either 1 x 12 or 12 x 1.
      //
      // Only the total documented physical quantity
      // is relevant for this format.
      const extractedTotal =
        extractedPack * extractedSize;

      const documentedTotal =
        parsed.pack * parsed.size;

      quantitiesAgree =
        Number.isFinite(extractedTotal) &&
        Math.abs(
          extractedTotal - documentedTotal
        ) <= 1e-9 * Math.max(1, documentedTotal);
    }

    if (!sameUnit || !quantitiesAgree) {
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