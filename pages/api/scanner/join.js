// pages/api/scanner/join.js
// GET  ?code=482913  -> { restaurantName, name }  (shown before joining; no sign-in needed)
// POST { code }       -> { ok }  with the phone's new email-less login as Bearer.
//                        Uses up the code and links this login to the restaurant.
import { admin } from '../../../lib/scannerAuth';

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

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: null };
  const user = auth?.user;
  // Only an email-less login can join. An owner signed in on this phone
  // would otherwise turn their own account into a scanner.
  if (!user || !user.is_anonymous) return res.status(401).json({ error: 'Please start again from the code screen.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const code = clean(body.code);
  const invite = await openInvite(code);
  if (!invite) return res.status(404).json({ error: NOT_FOUND });

  // Claim the code first, so two phones using it at once cannot both join.
  const { data: claimed } = await admin
    .from('scanner_invites')
    .update({ used_at: nowIso(), used_by: user.id })
    .eq('id', invite.id).is('used_at', null)
    .select('id').maybeSingle();
  if (!claimed) return res.status(404).json({ error: NOT_FOUND });

  // One restaurant per phone: an earlier membership on this login ends.
  await admin.from('restaurant_scanners')
    .update({ removed_at: nowIso(), removed_by: 'rejoined' })
    .eq('user_id', user.id).is('removed_at', null);

  const { error } = await admin.from('restaurant_scanners').insert({
    restaurant_id: invite.restaurant_id,
    user_id: user.id,
    name: invite.name,
    invite_id: invite.id,
  });
  if (error) {
    await admin.from('scanner_invites').update({ used_at: null, used_by: null }).eq('id', invite.id);
    return res.status(500).json({ error: 'Could not join right now. Please try again.' });
  }
  return res.status(200).json({ ok: true });
}