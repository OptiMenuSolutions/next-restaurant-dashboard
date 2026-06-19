// lib/pos/providers/square.js
//
// Square adapter. Implements the shared POS provider interface:
//   - getAuthUrl({ state, redirectUri })            -> string   (OAuth start)
//   - exchangeCode({ code, redirectUri })           -> connection fields  (OAuth callback)
//   - refresh(connection)                           -> { accessToken, expiresAt } | null
//   - fetchSales(connection, { from, to })          -> [ pos_sales-shaped record, ... ]
//
// fetchSales output keys match the pos_sales table columns EXCEPT restaurant_id,
// pos_system, and upload_session_id, which the sync route stamps on. This is the
// same shape lib/parsePOScsv.js -> normalizeRows() produces, so the rec engine
// (ai-recommendations.js) consumes it without any changes.
//
// Docs: https://developer.squareup.com/docs/orders-api/what-it-does
//       https://developer.squareup.com/reference/square/orders-api/search-orders
//       https://developer.squareup.com/docs/oauth-api/overview

const ENV = process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox';
const BASE = ENV === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

// Square pins behavior to a dated API version. Bump via env when you adopt a
// newer one from the Square dashboard.
const VERSION = process.env.SQUARE_VERSION || '2025-05-21';

const SCOPES = ['ORDERS_READ', 'MERCHANT_PROFILE_READ'];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sqHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': VERSION,
  };
}

function sqError(data, status) {
  return data?.errors?.[0]?.detail || `Square API error (${status})`;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────
function getAuthUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: process.env.SQUARE_CLIENT_ID,
    scope: SCOPES.join(' '),
    session: 'false',
    state,
  });
  if (redirectUri) params.set('redirect_uri', redirectUri);
  return `${BASE}/oauth2/authorize?${params.toString()}`;
}

async function fetchLocationIds(accessToken) {
  const res = await fetch(`${BASE}/v2/locations`, { headers: sqHeaders(accessToken) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Square locations fetch failed: ${sqError(data, res.status)}`);
  return (data.locations || [])
    .filter(l => l.status === 'ACTIVE')
    .map(l => l.id);
}

async function exchangeCode({ code, redirectUri }) {
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Square-Version': VERSION },
    body: JSON.stringify({
      client_id: process.env.SQUARE_CLIENT_ID,
      client_secret: process.env.SQUARE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Square token exchange failed: ${sqError(data, res.status)}`);

  const locations = await fetchLocationIds(data.access_token);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    merchantId: data.merchant_id,
    expiresAt: data.expires_at, // RFC3339 string -> timestamptz
    locations,
  };
}

async function refresh(connection) {
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Square-Version': VERSION },
    body: JSON.stringify({
      client_id: process.env.SQUARE_CLIENT_ID,
      client_secret: process.env.SQUARE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Square token refresh failed: ${sqError(data, res.status)}`);
  return { accessToken: data.access_token, expiresAt: data.expires_at };
}

// ─── Sales ──────────────────────────────────────────────────────────────────--
// Pull completed orders in [from, to], then aggregate line items per (item, date)
// into pos_sales rows. Square money amounts are in the smallest currency unit
// (cents), so we divide by 100.
async function fetchSales(connection, { from, to }) {
  const locationIds = connection.locations || [];
  if (!locationIds.length) throw new Error('Square connection has no location ids');

  const startAt = `${from}T00:00:00Z`;
  const endAt = `${to}T23:59:59Z`;

  const tally = new Map(); // key: `${date}||${lowername}`
  let cursor;

  do {
    const body = {
      location_ids: locationIds,
      query: {
        filter: {
          state_filter: { states: ['COMPLETED'] },
          date_time_filter: { closed_at: { start_at: startAt, end_at: endAt } },
        },
        sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;

    const res = await fetch(`${BASE}/v2/orders/search`, {
      method: 'POST',
      headers: sqHeaders(connection.access_token),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Square SearchOrders failed: ${sqError(data, res.status)}`);

    for (const order of (data.orders || [])) {
      const ts = order.closed_at || order.created_at;
      const saleDate = ts ? ts.slice(0, 10) : null;
      if (!saleDate) continue;

      for (const li of (order.line_items || [])) {
        const name = (li.name || '').trim();
        if (!name) continue;

        const qty = parseFloat(li.quantity || '0') || 0;
        const revenueCents = li.gross_sales_money?.amount ?? li.total_money?.amount ?? 0;
        const unitCents = li.base_price_money?.amount;

        const key = `${saleDate}||${name.toLowerCase()}`;
        const prev = tally.get(key) || {
          sale_date: saleDate,
          item_name: name,
          quantity_sold: 0,
          revenue: 0,
          unit_price: unitCents != null ? unitCents / 100 : null,
        };
        prev.quantity_sold += qty;
        prev.revenue += Number(revenueCents) / 100;
        tally.set(key, prev);
      }
    }

    cursor = data.cursor;
  } while (cursor);

  return [...tally.values()].map(r => ({
    sale_date: r.sale_date,
    item_name: r.item_name,
    category: null,                                   // category needs a Catalog lookup; left null for v1
    quantity_sold: Math.round(r.quantity_sold * 100) / 100,
    revenue: Math.round(r.revenue * 100) / 100,
    unit_price: r.unit_price,
    hour_of_day: null,                                // tz-correct hour needs the location timezone; null for v1
    day_of_week: DAY_NAMES[new Date(r.sale_date + 'T12:00:00').getDay()],
    voids: 0,                                         // Square models refunds/returns separately; 0 for v1
    comps: 0,                                         // discounts available on the order; 0 for v1
  }));
}

const square = {
  id: 'square',
  label: 'Square',
  authType: 'oauth2',
  getAuthUrl,
  exchangeCode,
  refresh,
  fetchSales,
};

export default square;