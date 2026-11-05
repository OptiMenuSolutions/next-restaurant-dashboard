import {
  getRestaurantInvoiceMatchingControl,
} from './invoiceMatchingControls';

export async function requireInvoiceMatching(
  db,
  restaurantId
) {
  const control = await getRestaurantInvoiceMatchingControl(
    db,
    restaurantId
  );

  if (!control.matching_enabled) {
    const error = new Error(
      'Invoice ingredient matching is not enabled for this restaurant.'
    );
    error.status = 403;
    throw error;
  }

  return control;
}