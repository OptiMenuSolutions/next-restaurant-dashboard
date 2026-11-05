
export const INVOICE_MATCHING_STATUS = Object.freeze({
  LOCKED: 'locked',
  LEGACY_ENABLED: 'legacy_enabled',
  AUTO_ENABLED: 'auto_enabled',
  ADMIN_ENABLED: 'admin_enabled',
});

const VALID_STATUSES = new Set(
  Object.values(INVOICE_MATCHING_STATUS)
);

export function isInvoiceMatchingEnabled(status) {
  return (
    status === INVOICE_MATCHING_STATUS.LEGACY_ENABLED ||
    status === INVOICE_MATCHING_STATUS.AUTO_ENABLED ||
    status === INVOICE_MATCHING_STATUS.ADMIN_ENABLED
  );
}

export function isValidInvoiceMatchingStatus(status) {
  return VALID_STATUSES.has(status);
}

export async function getRestaurantInvoiceMatchingControl(
  db,
  restaurantId
) {
  if (!restaurantId) {
    throw new Error('Restaurant ID is required');
  }

  const { data, error } = await db
    .from('restaurant_invoice_matching_controls')
    .select(
      'restaurant_id, status, activated_at, ' +
      'activated_by, activation_reason, ' +
      'created_at, updated_at'
    )
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load invoice matching control: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      `Missing invoice matching control for restaurant ${restaurantId}`
    );
  }

  if (!isValidInvoiceMatchingStatus(data.status)) {
    throw new Error(
      `Invalid invoice matching status: ${data.status}`
    );
  }

  return {
    ...data,
    matching_enabled: isInvoiceMatchingEnabled(data.status),
    is_locked: data.status === INVOICE_MATCHING_STATUS.LOCKED,
  };
}
