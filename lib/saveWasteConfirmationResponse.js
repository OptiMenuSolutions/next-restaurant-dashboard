const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RESPONSES = new Set(['confirmed_wasted', 'confirmed_used', 'kept', 'not_sure']);

export async function saveWasteConfirmationResponse(db, restaurantId, confirmationId, status) {
  if (!UUID.test(restaurantId || '') || !UUID.test(confirmationId || '') || !RESPONSES.has(status)) {
    throw new Error('A valid confirmation and final response are required.');
  }
  const fields = 'id,restaurant_id,status';
  const result = await db.from('waste_confirmations').update({ status })
    .eq('id', confirmationId).eq('restaurant_id', restaurantId)
    .in('status', ['pending', 'expired_unconfirmed']).select(fields).maybeSingle();
  if (result.error) throw result.error;
  let saved = result.data;
  if (!saved) {
    const existing = await db.from('waste_confirmations').select(fields)
      .eq('id', confirmationId).eq('restaurant_id', restaurantId).maybeSingle();
    if (existing.error) throw existing.error;
    saved = existing.data;
  }
  if (!saved || saved.id !== confirmationId || saved.restaurant_id !== restaurantId) {
    throw new Error('Confirmation not found or access denied. Reload before responding.');
  }
  if (saved.status !== status) {
    throw new Error('This confirmation already has a different response. Reload before responding.');
  }
  return { ...saved, already_saved: !result.data };
}