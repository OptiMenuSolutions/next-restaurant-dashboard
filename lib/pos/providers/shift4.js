// lib/pos/providers/shift4.js
//
// Shift4 / SkyTab adapter, implemented against the Shift4 "Conecto" (Lighthouse
// Marketplace) API. Same interface as the Square adapter — emits pos_sales-shaped
// records, so nothing downstream changes.
//
// Auth: OAuth2 (Lighthouse token flow). Access tokens expire in 24h; refresh
// tokens are long-lived and the same refresh token is returned each refresh.
// Sales: GET /pos/v2/{locationId}/tickets?filter[dateTimeFrom]&filter[dateTimeTo]
//        returns Ticket objects; ticketItems[] carry name, quantity, unitPrice,
//        itemAmount (US cents), departmentName (category), and a per-item type.
//
// Docs: Shift4 Conecto API (conecto-api.shift4payments.com), OAuth Authorization
//       + POS Ticket sections.
//
// HOSTS: confirm these against the credentials package from Shift4 (Anita). The
// OAuth host and the API host differ, and sandbox hosts will differ again — all
// are env-overridable below.

const AUTH_BASE = process.env.SHIFT4_AUTH_BASE || 'https://lighthouse-api.harbortouch.com';
const API_BASE  = process.env.SHIFT4_API_BASE  || 'https://conecto-api.shift4payments.com';

// Shift4 access tokens live 24h. Stamp expiry so sync.js refreshes proactively.
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function bearer(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── OAuth ────────────────────────────────────────────────────────────────────
function getAuthUrl({ state, redirectUri }) {
  // Shift4's authorize endpoint documents client_id, redirect_uri, response_type.
  // state is standard OAuth2 and passed through for CSRF + restaurant binding.
  const params = new URLSearchParams({
    client_id: process.env.SHIFT4_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return `${AUTH_BASE}/oauth2/authorize/?${params.toString()}`;
}

async function fetchLocations(accessToken) {
  const res = await fetch(`${API_BASE}/marketplace/v2/locations`, { headers: bearer(accessToken) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Shift4 locations fetch failed: ${data.message || res.status}`);
  return data.results || [];
}

async function exchangeCode({ code, redirectUri }) {
  const res = await fetch(`${AUTH_BASE}/oauth2/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.SHIFT4_CLIENT_ID,
      client_secret: process.env.SHIFT4_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Shift4 token exchange failed: ${data.message || res.status}`);

  const locations = await fetchLocations(data.access_token);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    merchantId: locations[0]?.merchantId || null,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
    locations: locations.map(l => l.id),   // Shift4 location ids are integers
  };
}

async function refresh(connection) {
  const res = await fetch(`${AUTH_BASE}/oauth2/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      client_id: process.env.SHIFT4_CLIENT_ID,
      client_secret: process.env.SHIFT4_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Shift4 token refresh failed: ${data.message || res.status}`);
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
  };
}

// ─── Sales ────────────────────────────────────────────────────────────────────
// Pull tickets per location for [from, to], then aggregate ticketItems per
// (item, business date). Money is US cents → /100.
//
// Item-type handling (per Shift4's ticket model):
//   sale            → counts positively
//   refund/overring → carry NEGATIVE quantity/amount; summing nets them out
//   void            → excluded from sale totals (tallied separately into `voids`)
//   isNonSalesRevenue (gift cards, etc.) → skipped (not a dish)
// Whole "open" tickets (not yet closed) are skipped.
async function fetchSales(connection, { from, to }) {
  const locationIds = connection.locations || [];
  if (!locationIds.length) throw new Error('Shift4 connection has no location ids');

  const fromIso = `${from}T00:00:00Z`;
  const toIso = `${to}T23:59:59Z`;
  const LIMIT = 200;

  const tally = new Map(); // key: `${date}||${lowername}`

  for (const locationId of locationIds) {
    let offset = 0;
    // bounded pagination; stop when a short page comes back
    for (let page = 0; page < 100; page++) {
      const qs =
        `filter[dateTimeFrom]=${encodeURIComponent(fromIso)}` +
        `&filter[dateTimeTo]=${encodeURIComponent(toIso)}` +
        `&offset=${offset}&limit=${LIMIT}`;
      const res = await fetch(`${API_BASE}/pos/v2/${locationId}/tickets?${qs}`, {
        headers: bearer(connection.access_token),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Shift4 tickets fetch failed: ${data.message || res.status}`);

      const tickets = data.results || [];
      for (const ticket of tickets) {
        if (ticket.type === 'open') continue;
        const ts = ticket.closedAt || ticket.openedAt;
        const saleDate = ts ? ts.slice(0, 10) : null;
        if (!saleDate) continue;

        for (const li of (ticket.ticketItems || [])) {
          if (li.isNonSalesRevenue) continue;
          const name = (li.name || '').trim();
          if (!name) continue;

          const qty = Number(li.quantity) || 0;
          const key = `${saleDate}||${name.toLowerCase()}`;
          const prev = tally.get(key) || {
            sale_date: saleDate,
            item_name: name,
            category: li.departmentName || null,
            quantity_sold: 0,
            revenue: 0,
            unit_price: li.unitPrice != null ? Number(li.unitPrice) / 100 : null,
            voids: 0,
            comps: 0,
          };

          if (li.type === 'void') {
            prev.voids += Math.round(qty);
          } else {
            prev.quantity_sold += qty;                        // sale +, refund/overring −
            prev.revenue += (Number(li.itemAmount) || 0) / 100;
            prev.comps += (Number(li.discountAmount) || 0) / 100;
          }
          if (prev.category == null && li.departmentName) prev.category = li.departmentName;
          tally.set(key, prev);
        }
      }

      if (tickets.length < LIMIT) break;
      offset += LIMIT;
    }
  }

  return [...tally.values()].map(r => ({
    sale_date: r.sale_date,
    item_name: r.item_name,
    category: r.category,
    quantity_sold: Math.round(r.quantity_sold * 100) / 100,
    revenue: Math.round(r.revenue * 100) / 100,
    unit_price: r.unit_price,
    hour_of_day: null,
    day_of_week: DAY_NAMES[new Date(r.sale_date + 'T12:00:00').getDay()],
    voids: r.voids,
    comps: Math.round(r.comps * 100) / 100,
  }));
}

const shift4 = {
  id: 'shift4',
  label: 'Shift4 / SkyTab',
  authType: 'oauth2',
  getAuthUrl,
  exchangeCode,
  refresh,
  fetchSales,
};

export default shift4;