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

// Every location currently installed for OptiMenu, with its time zone. Used by
// the daily reconciliation cron (one call per day for all restaurants).
async function listInstalledLocations() {
  const path = '/marketplace/v2/locations';
  const res = await withRetry(() => fetch(`${API_BASE}${path}`, {
    headers: buildHmacHeaders({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, method: 'GET', path }),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw shift4Error('Shift4 installed locations fetch failed', res, data);
  return (data.results || []).map((l) => ({
    id: Number(l.id),
    name: l.name || null,
    timeZone: l.timeZone || null,
  }));
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

// Used until the daily reconciliation has stored the location's own time zone.
const DEFAULT_TIME_ZONE = 'America/New_York';

// YYYY-MM-DD of a timestamp in the given time zone (en-CA formats as YYYY-MM-DD).
function localDate(isoTimestamp, timeZone) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  try {
    return fmt(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return fmt(DEFAULT_TIME_ZONE); // unknown zone name
  }
}

function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Retries a Shift4 call on 429 (rate limited) or 5xx, waiting 1s then 2s, or
// what Retry-After asks for (capped at 10s). makeRequest builds a fresh request
// each try, because HMAC signatures expire after about 10 seconds.
async function withRetry(makeRequest, attempts = 3) {
  for (let i = 0; ; i++) {
    const res = await makeRequest();
    if (res.status !== 429 && res.status < 500) return res;
    if (i >= attempts - 1) return res;
    const retryAfter = Number(res.headers?.get?.('retry-after'));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** i;
    console.warn(`[shift4] ${res.status} from Shift4, retrying in ${Math.min(waitMs, 10000)}ms`);
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 10000)));
  }
}

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

  const timeZone = connection.shift4_timezone || DEFAULT_TIME_ZONE;

  // Shift4 expects plain YYYY-MM-DD dates (per their Postman collection), in UTC.
  // Ask for a day either side so every local day in [from, to] is fully covered
  // whatever the restaurant's time zone; tickets outside it are dropped below.
  const fromMinusOne = shiftDate(from, -1);
  const toPlusOne = shiftDate(to, 1);

  const tally = new Map(); // key: `${date}||${lowername}`

  // The tickets endpoint documents no paging params, so this is a single request.
  {
    const qs =
      `filter[dateTimeFrom]=${fromMinusOne}` +
      `&filter[dateTimeTo]=${toPlusOne}`;

    const path = `/pos/v2/${locationId}/tickets`;
    const res = await withRetry(() => fetch(`${API_BASE}${path}?${qs}`, {
      headers: buildHmacHeaders({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, method: 'GET', path }),
    }));
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw shift4Error('Shift4 tickets fetch failed', res, data);

    const tickets = data.results || [];
    for (const ticket of tickets) {
      if (ticket.type === 'open') continue;
      const ts = ticket.closedAt || ticket.openedAt;
      // Date the sale in the restaurant's own time zone, not UTC: a 9 PM
      // Eastern check closes after midnight UTC and would land on the next day.
      // Days outside [from, to] are skipped: the sync only replaces that range.
      const saleDate = ts ? localDate(ts, timeZone) : null;
      if (!saleDate || saleDate < from || saleDate > to) continue;

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
  listInstalledLocations,
  fetchSales,
  // No refresh(): the merchant token is discarded after install, and
  // expires_at stays null, so sync-all-pos never tries to refresh it.
};

export default shift4;