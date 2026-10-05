// lib/pos/providers/shift4.js
//
// Shift4 Dine POS adapter. Fetches sales (tickets) from Shift4 Conecto API.
// Auth: HMAC-SHA256 signed requests (app-level credentials).
//
// Sales: GET /pos/v2/{locationId}/tickets?filter[dateTimeFrom]=...&filter[dateTimeTo]=...
//        Returns Ticket objects; ticketItems[] carry name, quantity, unitPrice,
//        itemAmount (cents), departmentName (category), type, and isNonSalesRevenue flag.
//
// Item handling:
//   sale            → counts positively
//   refund/overring → carry NEGATIVE quantity/amount; summing nets them out
//   void            → excluded from sale totals (tallied separately into `voids`)
//   isNonSalesRevenue (gift cards, etc.) → skipped

import { buildHmacHeaders } from '../hmac-auth.js';

const API_BASE = process.env.SHIFT4_API_HOST || 'https://conecto-api-sandbox.shift4payments.com';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Fetch sales from Shift4 for a restaurant location over a date range.
 * @param {object} connection - { locationId, accessToken, refreshToken } (refreshToken not used here; HMAC uses CLIENT_ID/SECRET from env)
 * @param {object} opts - { from, to } (date strings: YYYY-MM-DD)
 * @returns {array} pos_sales-shaped records
 */
async function fetchSales(connection, { from, to }) {
  const locationId = connection.locationId || process.env.SHIFT4_LOCATION_ID;
  if (!locationId) throw new Error('Shift4 connection has no locationId and SHIFT4_LOCATION_ID not set');

  const clientId = process.env.SHIFT4_CLIENT_ID;
  const clientSecret = process.env.SHIFT4_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SHIFT4_CLIENT_ID and SHIFT4_CLIENT_SECRET must be set');
  }

  const fromIso = `${from}T00:00:00Z`;
  const toIso = `${to}T23:59:59Z`;
  const LIMIT = 200;

  const tally = new Map(); // key: `${date}||${lowername}`

  let offset = 0;
  // bounded pagination; stop when a short page comes back
  for (let page = 0; page < 100; page++) {
    const qs =
      `filter[dateTimeFrom]=${encodeURIComponent(fromIso)}` +
      `&filter[dateTimeTo]=${encodeURIComponent(toIso)}` +
      `&offset=${offset}&limit=${LIMIT}`;
    const path = `/pos/v2/${locationId}/tickets?${qs}`;

    const headers = buildHmacHeaders({
      clientId,
      clientSecret,
      method: 'GET',
      path: `/pos/v2/${locationId}/tickets`, // path for signature does NOT include query params
      // no body for GET
    });

    const res = await fetch(`${API_BASE}${path}`, { headers });
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
  label: 'Shift4 / Dine',
  fetchSales,
};

export default shift4;