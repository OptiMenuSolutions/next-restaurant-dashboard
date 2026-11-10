
/**
 * Fail-closed activation control for authenticated
 * invoice-supported ingredient repricing.
 *
 * Both the global feature flag and the exact restaurant
 * allowlist must match before activation.
 */
export function isInvoiceSupportedRepricingEnabled(
  restaurantId
) {
  const allowedRestaurantId = (
    process.env
      .INVOICE_SUPPORTED_REPRICING_RESTAURANT_ID || ''
  ).trim();

  return (
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED ===
      'true' &&
    typeof restaurantId === 'string' &&
    allowedRestaurantId.length > 0 &&
    restaurantId === allowedRestaurantId
  );
}
