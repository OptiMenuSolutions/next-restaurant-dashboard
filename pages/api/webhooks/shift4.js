// OAuth Marketplace lifecycle receiver. Installation Request provisioning is
// outside OptiMenu's selected OAuth flow and must not create accounts here.
import { createClient } from '@supabase/supabase-js';
import shift4 from '../../../lib/pos/providers/shift4';
import { verifyWebhook } from '../../../lib/pos/hmac-auth';
import { disconnectedShift4State, updateShift4Connection } from '../../../lib/pos/shift4-state';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WEBHOOK_PATH = '/api/webhooks/shift4';
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    length += bytes.length;
    if (length > 1024 * 1024) throw Object.assign(new Error('Webhook body too large'), { status: 413 });
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const raw = await readRawBody(req);
    if (req.headers['x-access-key'] !== process.env.SHIFT4_CLIENT_ID || !verifyWebhook({
      clientId: process.env.SHIFT4_CLIENT_ID, clientSecret: process.env.SHIFT4_CLIENT_SECRET,
      signature: req.headers['x-signature'], timestamp: Number(req.headers['x-timestamp']),
      path: WEBHOOK_PATH, body: raw,
    })) return res.status(401).json({ error: 'Invalid webhook authentication' });

    let body;
    try { body = JSON.parse(raw); }
    catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid webhook body' });
    if (body.event?.name !== 'marketplace.Location.deleted') return res.status(200).json({ ok: true });

    const locationId = Number(body.payload?.locationId);
    if (!Number.isSafeInteger(locationId) || locationId <= 0) return res.status(400).json({ error: 'Invalid locationId' });
    const { data: connections, error } = await db.from('pos_connections').select('*')
      .eq('provider', 'shift4').eq('shift4_location_id', locationId);
    if (error) throw new Error(error.message);
    if (!connections?.length) return res.status(200).json({ ok: true }); // Repeat delivery.

    // Delivery can be delayed until after a merchant reinstalls. Confirm the
    // current Shift4 state before applying a destructive old notification.
    const installed = await shift4.listInstalledLocations();
    if (installed.some((l) => l.id === locationId)) return res.status(200).json({ ok: true, ignored: 'Location is currently installed' });
    let disconnected = 0;
    let changed = false;
    for (const connection of connections) {
      if (await updateShift4Connection(db, connection,
        disconnectedShift4State('Uninstalled from the Shift4 Marketplace'))) disconnected++;
      else changed = true;
    }
    if (changed) throw new Error('Connection changed during uninstall handling; retry against current state');
    console.log('[shift4-webhook] location removed', { locationId, disconnected });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[shift4-webhook] Processing failed:', error.message);
    // Failed reads or writes must be retried rather than acknowledged as done.
    return res.status(error.status === 413 ? 413 : 500).json({ error: 'Webhook could not be processed' });
  }
}
