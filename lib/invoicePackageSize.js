
/**
 * Interpret numbered-can packaging without confusing the
 * container designation (#10) with its quantity.
 *
 * Returns null for formats this function does not handle.
 */
export function parseNumberedCanPack(raw) {
  const value = String(raw || '').trim().toUpperCase();

  // Examples: "3/#10 CAN", "6 #10", "3 / # 10 CANS"
  const match = value.match(
    /^(\d+)\s*\/?\s*#\s*(\d+)\s*(?:CANS?)?$/
  );

  if (!match) return null;

  const cansPerCase = Number(match[1]);
  const canDesignation = Number(match[2]);

  if (
    !Number.isSafeInteger(cansPerCase) ||
    cansPerCase <= 0 ||
    !Number.isSafeInteger(canDesignation) ||
    canDesignation <= 0
  ) {
    return null;
  }

  return {
    pack: cansPerCase,
    size: 1,
    size_unit: 'can',
    can_designation: canDesignation,
  };
}
