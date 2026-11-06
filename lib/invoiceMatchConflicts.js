
export function normalizeSupplierProduct(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Group historical invoice purchases by restaurant and normalized
 * original invoice product description, regardless of supplier.
 *
 * Each conflict contains every purchase, including unlinked lines.
 * Only distinct non-null ingredient IDs count toward a conflict.
 *
 * This function does not modify invoice data.
 */
export function groupInvoiceMatchConflicts(purchases = []) {
  const groups = new Map();

  for (const purchase of purchases) {
    const restaurantId = purchase.restaurant_id;
    const supplier = purchase.supplier;
    const description = purchase.item_name;

    const productKey = normalizeSupplierProduct(description);

    if (!restaurantId || !productKey) {
      continue;
    }

    const supplierKey = normalizeSupplierProduct(supplier);

    const key = JSON.stringify([
      restaurantId,
      supplierKey,
      productKey,
    ]);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        restaurant_id: restaurantId,
        supplier: supplier || null,
        supplier_key: supplierKey,
        product_key: productKey,
        product_description: description,
        purchases: [],
        ingredient_ids: new Set(),
      });
    }

    const group = groups.get(key);

    group.purchases.push({
      supplier: supplier || null,
      invoice_id: purchase.invoice_id,
      invoice_item_id: purchase.invoice_item_id,
      invoice_number: purchase.invoice_number,
      invoice_date: purchase.invoice_date,
      product_description: description,
      ingredient_id: purchase.ingredient_id || null,
      matched_ingredient: purchase.matched_ingredient || null,
    });

    if (purchase.ingredient_id) {
      group.ingredient_ids.add(purchase.ingredient_id);
    }
  }

  return [...groups.values()]
    .filter(group => group.ingredient_ids.size > 1)
    .map(group => {
      const purchases = [...group.purchases].sort((a, b) => {
        const dateComparison = String(a.invoice_date || '')
          .localeCompare(String(b.invoice_date || ''));

        if (dateComparison !== 0) return dateComparison;

        return String(a.invoice_number || '')
          .localeCompare(String(b.invoice_number || ''));
      });

      const ingredientMap = new Map();

      for (const purchase of purchases) {
        if (!purchase.ingredient_id) continue;

        const existing = ingredientMap.get(purchase.ingredient_id);

        if (existing) {
          existing.purchase_count += 1;
        } else {
          ingredientMap.set(purchase.ingredient_id, {
            ingredient_id: purchase.ingredient_id,
            ingredient_name: purchase.matched_ingredient,
            purchase_count: 1,
          });
        }
      }

      return {
        key: group.key,
        restaurant_id: group.restaurant_id,
        suppliers: [...new Set(
          purchases.map(purchase => purchase.supplier).filter(Boolean)
        )].sort(),
        product_key: group.product_key,
        product_description: group.product_description,
        status: 'needs_review',
        purchase_count: purchases.length,
        linked_purchase_count: purchases.filter(
          purchase => purchase.ingredient_id
        ).length,
        distinct_ingredient_count: ingredientMap.size,
        ingredients: [...ingredientMap.values()].sort(
          (a, b) => b.purchase_count - a.purchase_count
        ),
        purchases,
      };
    })
    .sort((a, b) =>
      b.purchase_count - a.purchase_count ||
      a.product_key.localeCompare(b.product_key)
    );
}
