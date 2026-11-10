
/**
 * Build the complete invoice item collection for V2
 * evidence signing.
 *
 * Food items may be filtered and renumbered before
 * being returned to the confirmation screen.
 *
 * Preserve their original positions in the complete
 * invoice while using the exact objects returned to
 * the client.
 *
 * No proofs are issued here.
 */
export function buildInvoiceEvidenceSigningCollection({
  allRaw,
  foodItems,
  lineItemsWithMatches,
} = {}) {
  if (
    !Array.isArray(allRaw) ||
    !Array.isArray(foodItems) ||
    !Array.isArray(lineItemsWithMatches) ||
    foodItems.length !== lineItemsWithMatches.length
  ) {
    throw new Error(
      'Invalid invoice signing collection.'
    );
  }

  const originalIndexes = new Map();

  for (let index = 0; index < allRaw.length; index++) {
    const item = allRaw[index];

    if (
      !item ||
      typeof item !== 'object' ||
      originalIndexes.has(item)
    ) {
      throw new Error(
        'Invalid original invoice item identity.'
      );
    }

    originalIndexes.set(item, index);
  }

  const collection = allRaw.map((item, index) => ({
    ...item,
    _id: `source_${index}`,
  }));

  const usedIndexes = new Set();
  const usedIds = new Set();

  for (let index = 0; index < foodItems.length; index++) {
    const original = foodItems[index];
    const returned = lineItemsWithMatches[index];

    const sourceIndex = originalIndexes.get(original);

    if (
      sourceIndex === undefined ||
      usedIndexes.has(sourceIndex) ||
      !returned ||
      typeof returned._id !== 'string' ||
      returned._id !== `item_${index}` ||
      usedIds.has(returned._id)
    ) {
      throw new Error(
        'Invoice item identity could not be preserved.'
      );
    }

    // The final returned item must retain the original
    // invoice pricing and source evidence.
    // Matching metadata may change, but the authenticated
    // charge must not change during this transformation.
    const pricingFields = [
      'item_name_raw',
      'quantity_shipped',
      'quantity_unit',
      'pack_size_raw',
      'pack',
      'size',
      'size_unit',
      'invoice_price',
      'line_total',
      'catch_weight',
      'actual_weight',
      'source_evidence',
    ];

    for (const field of pricingFields) {
      if (
        JSON.stringify(returned[field] ?? null) !==
        JSON.stringify(original[field] ?? null)
      ) {
        throw new Error(
          'Invoice pricing changed during matching.'
        );
      }
    }

    usedIndexes.add(sourceIndex);
    usedIds.add(returned._id);

    // Reuse the exact object that will be returned
    // to the invoice confirmation screen.
    collection[sourceIndex] = returned;
  }

  return collection;
}