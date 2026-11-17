// Background work must never overwrite a newer disconnect or authorization.
// Tokens stay server-side; comparison is performed by Postgres/PostgREST.
export async function updateShift4Connection(db, connection, changes) {
  const { restaurant_id, provider, ...mutable } = changes;
  // Expected credentials go in the POST body, never URL query filters where
  // access logs could retain them. The RPC locks and compares the row.
  const { data, error } = await db.rpc('update_shift4_connection', {
    p_connection_id: connection.id, p_status: connection.status,
    p_location_id: connection.shift4_location_id ?? null,
    p_access_token: connection.access_token ?? null,
    p_refresh_token: connection.refresh_token ?? null,
    p_changes: mutable,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'boolean') throw new Error('Shift4 connection update returned an invalid result');
  return data;
}

export function disconnectedShift4State(reason = null) {
  return {
    status: 'disconnected', shift4_location_id: null, shift4_timezone: null,
    access_token: null, refresh_token: null, expires_at: null,
    token_refreshed_at: null, token_error: null, last_error: reason,
    updated_at: new Date().toISOString(),
  };
}

export async function saveShift4Sync(db, connection, range, result, startedAt) {
  const { data, error } = await db.rpc('save_shift4_sync', {
    p_connection_id: connection.id,
    p_restaurant_id: connection.restaurant_id,
    p_location_id: connection.shift4_location_id,
    p_access_token: connection.access_token ?? null,
    p_from: range.from, p_to: range.to, p_started_at: startedAt,
    p_sales: result.sales, p_tickets: result.tickets,
  });
  if (error) throw new Error(`Shift4 sync could not be saved: ${error.message}`);
  if (!data || typeof data.saved !== 'boolean') {
    throw new Error('Shift4 sync returned an invalid save result');
  }
  return data;
}
