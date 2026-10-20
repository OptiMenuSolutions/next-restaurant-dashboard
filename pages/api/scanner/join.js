// pages/api/scanner/join.js
// GET  ?code=482913  -> { restaurantName, name }  (shown before joining; no sign-in needed)
// POST { code }       -> { key }  Uses up the code and makes this phone's device
//                        key. The phone keeps the key; only a scrambled copy is stored.
import { admin, newScannerKey, hashScannerKey } from '../../../lib/scannerAuth';

const nowIso = () => new Date().toISOString();
const clean = (c) => String(c || '').replace(/\D/g, '').slice(0, 6);

async function openInvite(code) {
  const { data } = await admin
    .from('scanner_invites')
    .select('id, restaurant_id, name, expires_at, restaurants(name, deactivated_at)')
    .eq('code', code)
    .is('used_at', null).is('cancelled_at', null)
    .gt('expires_at', nowIso())
    .maybeSingle();
  if (!data || data.restaurants?.deactivated_at) return null;
  return data;
}

const NOT_FOUND = 'That code did not work. It may have expired or already been used. Ask your manager for a new one.';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const code = clean(req.query.code);
    if (code.length !== 6) return res.status(400).json({ error: 'Enter all 6 digits.' });
    const invite = await openInvite(code);
    if (!invite) return res.status(404).json({ error: NOT_FOUND });
    return res.status(200).json({ restaurantName: invite.restaurants?.name || 'Your restaurant', name: invite.name });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // A key this phone already holds, if it scanned somewhere before.
  const oldKey = String(req.headers['x-scanner-key'] || '');

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const code = clean(body.code);
  const invite = await openInvite(code);
  if (!invite) return res.status(404).json({ error: NOT_FOUND });

  // Claim the code first, so two phones using it at once cannot both join.
  const { data: claimed } = await admin
    .from('scanner_invites')
    .update({ used_at: nowIso() })
    .eq('id', invite.id).is('used_at', null)
    .select('id').maybeSingle();
  if (!claimed) return res.status(404).json({ error: NOT_FOUND });

  // One restaurant per phone: a key this phone already holds stops working.
  if (oldKey.length >= 32) {
    await admin.from('restaurant_scanners')
      .update({ removed_at: nowIso(), removed_by: 'rejoined' })
      .eq('key_hash', hashScannerKey(oldKey)).is('removed_at', null);
  }

  // The phone keeps the key; only its scrambled copy is stored here.
  const key = newScannerKey();
  const { error } = await admin.from('restaurant_scanners').insert({
    restaurant_id: invite.restaurant_id,
    name: invite.name,
    invite_id: invite.id,
    key_hash: hashScannerKey(key),
    last_seen_at: nowIso(),
  });
  if (error) {
    await admin.from('scanner_invites').update({ used_at: null }).eq('id', invite.id);
    return res.status(500).json({ error: 'Could not join right now. Please try again.' });
  }
  return res.status(200).json({ key });
}