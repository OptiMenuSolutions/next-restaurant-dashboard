// pages/api/scanner/index.js
// The scanner's own side. A scanner only ever sees their own name, their own
// counts and their own scans: nothing else from the restaurant.
//
// GET  ?since=<ISO, start of their day>  -> { name, restaurantName, joinedAt, monthScans, pricesUpdated, today: [...] }
// POST { action: "start", pages, retake_of? } -> { scanId, uploads: [{ path, token }] }
//        Makes the scan and one signed upload slot per page. The phone uploads
//        each photo, then calls /api/scanner/process with the scanId.
// POST { action: "leave" }                    -> { ok }  (this phone's key stops working)
// Every call carries the phone's device key in the X-Scanner-Key header.
import { admin, requireScanner } from '../../../lib/scannerAuth';

const nowIso = () => new Date().toISOString();

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export default async function handler(req, res) {
  const auth = await requireScanner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error, removed: !!auth.removed });
  const { scanner, restaurant } = auth;

  if (req.method === 'GET') {
    const sinceRaw = Date.parse(String(req.query.since || ''));
    const since = Number.isFinite(sinceRaw) ? new Date(sinceRaw).toISOString() : new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [{ data: month }, { data: today }] = await Promise.all([
      admin.from('scanner_scans')
        .select('status, prices_updated')
        .eq('scanner_id', scanner.id).eq('status', 'read')
        .gte('created_at', monthStartIso())
        .limit(5000),
      admin.from('scanner_scans')
        .select('id, status, pages, error, created_at')
        .eq('scanner_id', scanner.id)
        .neq('status', 'replaced')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    return res.status(200).json({
      name: scanner.name,
      restaurantName: restaurant.name || '',
      joinedAt: scanner.joined_at,
      monthScans: (month || []).length,
      pricesUpdated: (month || []).reduce((a, s) => a + (s.prices_updated || 0), 0),
      // A scan still sending after 10 minutes never finished (the phone lost
      // signal mid-upload): show it as not sent so it can be tried again.
      today: (today || []).map((s) => {
        const stuck = s.status === 'sending' && Date.now() - Date.parse(s.created_at) > 10 * 60 * 1000;
        return { id: s.id, status: stuck ? 'failed' : s.status, pages: s.pages, error: stuck ? 'Did not send. Try again.' : s.error, at: s.created_at };
      }),
    });
  }

  if (req.method !== 'POST') return res.status(405).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  if (body.action === 'start') {
    const pages = Math.max(1, Math.min(10, parseInt(body.pages, 10) || 1));
    const stamp = Date.now();
    const paths = Array.from({ length: pages }, (_, i) =>
      `${restaurant.id}/scan-${scanner.id}-${stamp}-${Math.random().toString(36).slice(2, 8)}-p${i + 1}.jpg`);

    const uploads = [];
    for (const path of paths) {
      const { data, error } = await admin.storage.from('invoices').createSignedUploadUrl(path);
      if (error) return res.status(500).json({ error: 'Could not start the upload. Please try again.' });
      uploads.push({ path: data.path || path, token: data.token });
    }

    const { data: scan, error } = await admin.from('scanner_scans')
      .insert({ restaurant_id: restaurant.id, scanner_id: scanner.id, status: 'sending', pages, paths })
      .select('id').single();
    if (error) return res.status(500).json({ error: 'Could not start the scan. Please try again.' });

    // A retake replaces the scan that could not be read.
    if (body.retake_of) {
      await admin.from('scanner_scans')
        .update({ status: 'replaced' })
        .eq('id', body.retake_of).eq('scanner_id', scanner.id).in('status', ['retake', 'failed', 'sending']);
    }
    return res.status(200).json({ scanId: scan.id, uploads });
  }

  if (body.action === 'leave') {
    // Removing the row is what stops this phone's key working.
    await admin.from('restaurant_scanners')
      .update({ removed_at: nowIso(), removed_by: 'self', key_hash: null })
      .eq('id', scanner.id);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action.' });
}