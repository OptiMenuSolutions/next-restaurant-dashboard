// lib/pos/providers/shift4.js
//
// Shift4 / SkyTab POS adapter using the OAuth Token Flow to connect.
// Same interface as Square adapter — emits pos_sales-shaped records.
//
// Connect: merchant signs in to Shift4 (OAuth), picks a location, and we install
//   OptiMenu on it with their Bearer token (/marketplace/v2/lighthouse-token/...).
// Sales: GET /pos/v2/{locationId}/tickets, signed with OptiMenu's own HMAC
//   credentials, so no merchant token is kept after the install.

import { buildHmacHeaders } from '../hmac-auth.js';

const API_BASE = process.env.SHIFT4_API_HOST || 'https://conecto-api.shift4payments.com';
const CLIENT_ID = process.env.SHIFT4_CLIENT_ID;
const CLIENT_SECRET = process.env.SHIFT4_CLIENT_SECRET;
// Host for /oauth2/authorize and /oauth2/token. Different from API_BASE, and
// different again between sandbox and production.
const OAUTH_HOST = process.env.SHIFT4_OAUTH_HOST;

function requireOauthHost() {
  if (!OAUTH_HOST) throw new Error('Missing SHIFT4_OAUTH_HOST in env');
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Missing SHIFT4_CLIENT_ID or SHIFT4_CLIENT_SECRET in env');
  return OAUTH_HOST.replace(/\/$/, '');
}

function bearer(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Shift4 errors come back as { "error": { "status", "message" } }.
function shift4Error(label, res, data) {
  const err = new Error(`${label}: ${data?.error?.message || data?.message || res.status}`);
  err.status = res.status;
  return err;
}

// ─── Connect (OAuth Token Flow) ───────────────────────────────────────────────
// Step 1: where the Connect Shift4 button sends the browser.
function getAuthUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return `${requireOauthHost()}/oauth2/authorize/?${params.toString()}`;
}

// Step 2: swap the ?code from the callback for the merchant access token.
// pendingLocation tells oauth-callback to send the merchant to the location
// picker instead of marking the connection live right away.
async function exchangeCode({ code, redirectUri }) {
  const res = await fetch(`${requireOauthHost()}/oauth2/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw shift4Error('Shift4 token exchange failed', res, data);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    // Left null on purpose: the token is thrown away after the install, and a
    // non-null expires_at would make sync-all-pos try to refresh it.
    expiresAt: null,
    merchantId: null,
    locations: null,
    pendingLocation: true,
  };
}

// Step 3: the merchant's locations, with whether each can be installed.
async function listLocations(accessToken) {
  const res = await fetch(`${API_BASE}/marketplace/v2/lighthouse-token/locations`, {
    headers: bearer(accessToken),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw shift4Error('Shift4 locations fetch failed', res, data);

  return (data.results || []).map((l) => ({
    id: Number(l.id ?? l.location?.id),
    name: l.name || l.location?.name || `Location ${l.id ?? l.location?.id}`,
    isAvailable: !!l.isAvailable,
    reason: l.reason || null,
  }));
}

// Step 4: install OptiMenu on the chosen location. Shift4 returns 204.
async function installLocation(accessToken, locationId) {
  const res = await fetch(`${API_BASE}/marketplace/v2/lighthouse-token/installations`, {
    method: 'POST',
    headers: bearer(accessToken),
    body: JSON.stringify({ locationId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw shift4Error('Shift4 installation failed', res, data);
  }
}

// Partner-initiated uninstall (Disconnect button). A 404 means it is already gone.
async function removeInstallation(locationId) {
  const path = `/marketplace/v2/locations/${locationId}`;
  const headers = buildHmacHeaders({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, method: 'DELETE', path });
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw shift4Error('Shift4 uninstall failed', res, data);
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Fetch sales for a Shift4 location
 * @param {object} connection - { shift4_location_id, ... }
 * @param {object} range - { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * @returns {array} pos_sales-shaped records
 */
async function fetchSales(connection, { from, to }) {
  const locationId = connection.shift4_location_id;
  if (!locationId) throw new Error('Shift4 connection missing shift4_location_id');
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Missing SHIFT4_CLIENT_ID or SHIFT4_CLIENT_SECRET in env');

  // Shift4 expects plain YYYY-MM-DD dates (per their Postman collection).
  // Ask for one extra day so the end date is covered whether dateTimeTo is inclusive or not.
  const toDate = new Date(`${to}T12:00:00Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  const toPlusOne = toDate.toISOString().slice(0, 10);

  const tally = new Map(); // key: `${date}||${lowername}`

  // The tickets endpoint documents no paging params, so this is a single request.
  {
    const qs =
      `filter[dateTimeFrom]=${from}` +
      `&filter[dateTimeTo]=${toPlusOne}`;

    const path = `/pos/v2/${locationId}/tickets`;
    const headers = buildHmacHeaders({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      method: 'GET',
      path,
    });

    const res = await fetch(`${API_BASE}${path}?${qs}`, { headers });
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
          prev.quantity_sold += qty;
          prev.revenue += (Number(li.itemAmount) || 0) / 100;
          prev.comps += (Number(li.discountAmount) || 0) / 100;
        }
        if (prev.category == null && li.departmentName) prev.category = li.departmentName;
        tally.set(key, prev);
      }
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
  authType: 'oauth2', // OAuth to connect; sales syncs use HMAC
  getAuthUrl,
  exchangeCode,
  listLocations,
  installLocation,
  removeInstallation,
  fetchSales,
  // No refresh(): the merchant token is discarded after install, and
  // expires_at stays null, so sync-all-pos never tries to refresh it.
};

export default shift4;