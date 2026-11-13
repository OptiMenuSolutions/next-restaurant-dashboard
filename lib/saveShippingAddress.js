const FIELDS = [
  'shipping_address_line1', 'shipping_city', 'shipping_state', 'shipping_zip',
];

export async function saveShippingAddress(database, restaurantId, address, {
  completeOnboarding = false,
  expected,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!restaurantId) throw new Error('Your restaurant is still loading. Please try again.');
  const { data: { session } = {}, error } = await database.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error('Please sign in again before saving your shipping address.');
  }
  const response = await fetchImpl('/api/account/save-shipping-address', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.access_token,
    },
    body: JSON.stringify({
      restaurant_id: restaurantId,
      address: Object.fromEntries(FIELDS.map(key => [key, address?.[key]])),
      complete_onboarding: completeOnboarding,
      ...(expected === undefined ? {} : { expected }),
    }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The address save response could not be read. Please try again.');
  }
  if (!response.ok) {
    throw Object.assign(new Error(result?.error || 'The shipping address could not be saved.'), {
      status: response.status,
    });
  }
  if (
    result?.success !== true || result.restaurant?.id !== restaurantId ||
    typeof result.restaurant.operational_timezone !== 'string' ||
    !result.restaurant.operational_timezone.trim() ||
    FIELDS.some(key => typeof result.restaurant[key] !== 'string' || !result.restaurant[key].trim()) ||
    (completeOnboarding && (
      typeof result.restaurant.onboarding_completed_at !== 'string' ||
      !Number.isFinite(Date.parse(result.restaurant.onboarding_completed_at))
    ))
  ) {
    throw new Error('Unexpected address save result. Reload before retrying.');
  }
  return result;
}