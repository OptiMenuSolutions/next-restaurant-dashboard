// pages/api/admin/shift4-menu.js
//
// TEMPORARY development route: pulls the raw POS Menu v2 response for a Shift4
// location so we can see Shift4's real field names before designing the
// POS menu tables. Protected by CRON_SECRET. Remove (or fold into the Shift4
// provider) once POS Menu v2 is built.
//
// Usage (PowerShell):
//   curl.exe -H "Authorization: Bearer YOUR_CRON_SECRET" "https://opti-menu.com/api/admin/shift4-menu?locationId=20803" -o shift4-menu.json

import { buildHmacHeaders } from '../../../lib/pos/hmac-auth.js';

const API_BASE = process.env.SHIFT4_API_HOST || 'https://conecto-api.shift4payments.com';
const CLIENT_ID = process.env.SHIFT4_CLIENT_ID;
const CLIENT_SECRET = process.env.SHIFT4_CLIENT_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Missing SHIFT4_CLIENT_ID or SHIFT4_CLIENT_SECRET' });
  }

  const locationId = String(req.query.locationId || '').trim();
  if (!/^\d+$/.test(locationId)) {
    return res.status(400).json({ error: 'locationId query parameter is required, for example ?locationId=20803' });
  }

  const path = `/pos/v2/${locationId}/menu`;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: buildHmacHeaders({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, method: 'GET', path }),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { nonJsonBody: text.slice(0, 2000) };
    }

    // Top-level keys and counts help map the structure without reading it all.
    const summary = {};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [key, value] of Object.entries(data)) {
        summary[key] = Array.isArray(value) ? `array(${value.length})` : typeof value;
      }
    }

    console.log(`[admin/shift4-menu] location ${locationId}: HTTP ${response.status}`, JSON.stringify(summary));
    return res.status(200).json({ shift4Status: response.status, locationId, summary, data });
  } catch (err) {
    console.error('[admin/shift4-menu] request failed:', err.message);
    return res.status(502).json({ error: err.message });
  }
}