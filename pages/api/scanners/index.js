// pages/api/scanners/index.js
// The owner's side of invoice scanners. The restaurant always comes from the
// signed-in owner's own profile, never from the request.
//
// GET  -> { restaurantName, scanners: [...], invites: [...] }
// POST { action: "invite", name }            -> { invite }
// POST { action: "resend", invite_id }       -> { invite }  (new code, new 7 days)
// POST { action: "cancel", invite_id }       -> { ok }
// POST { action: "remove", scanner_id }      -> { ok }      (their phone is signed out)
// POST { action: "review", invoice_id }      -> { ok }      (Mark reviewed on Invoices)
import { admin, requireOwner, endScannerLogin, newCode, SCANNER_CAP, INVITE_DAYS } from '../../../lib/scannerAuth';

const nowIso = () => new Date().toISOString();

function monthStartIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function inviteOut(row) {
  return { id: row.id, name: row.name, code: row.code, createdAt: row.created_at, expiresAt: row.expires_at };
}

/* Opens a fresh code for an invite row (new or resent). Retries on the rare
   clash with another restaurant's open code. */
async function withFreshCode(write) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    // A code left open by an expired invite is freed first.
    await admin.from('scanner_invites')
      .update({ cancelled_at: nowIso() })
      .eq('code', code).is('used_at', null).is('cancelled_at', null).lt('expires_at', nowIso());
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await write(code, expiresAt);
    if (!error) return { data };
    if (error.code !== '23505') return { error }; // anything but a duplicate code
  }
  return { error: { message: 'Could not make a code. Please try again.' } };
}

async function openInvites(restaurantId) {
  const { data } = await admin
    .from('scanner_invites')
    .select('id, name, code, created_at, expires_at')
    .eq('restaurant_id', restaurantId)
    .is('used_at', null).is('cancelled_at', null)
    .gt('expires_at', nowIso())
    .order('created_at', { ascending: false });
  return data || [];
}

async function activeScanners(restaurantId) {
  const { data } = await admin
    .from('restaurant_scanners')
    .select('id, name, joined_at, user_id')
    .eq('restaurant_id', restaurantId)
    .is('removed_at', null)
    .order('joined_at', { ascending: true });
  return data || [];
}

export default async function handler(req, res) {
  const auth = await requireOwner(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const restaurantId = auth.restaurant.id;

  if (req.method === 'GET') {
    const [scanners, invites, { data: scans }] = await Promise.all([
      activeScanners(restaurantId),
      openInvites(restaurantId),
      admin.from('scanner_scans')
        .select('scanner_id, status')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', monthStartIso())
        .limit(5000),
    ]);
    const counts = {};
    for (const s of scans || []) {
      const c = counts[s.scanner_id] || { scans: 0, retake: 0 };
      if (s.status === 'read') c.scans += 1;
      if (s.status === 'retake') c.retake += 1;
      counts[s.scanner_id] = c;
    }
    return res.status(200).json({
      restaurantName: auth.restaurant.name || '',
      scanners: scanners.map((s) => ({
        id: s.id,
        name: s.name,
        joinedAt: s.joined_at,
        monthScans: counts[s.id]?.scans || 0,
        needsRetake: counts[s.id]?.retake || 0,
      })),
      invites: invites.map(inviteOut),
    });
  }

  if (req.method !== 'POST') return res.status(405).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { action } = body;

  if (action === 'invite') {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Add their name first.' });
    const [scanners, invites] = await Promise.all([activeScanners(restaurantId), openInvites(restaurantId)]);
    if (scanners.length + invites.length >= SCANNER_CAP) {
      return res.status(400).json({ error: 'You have added all the scanners your plan includes. Remove one to add another.' });
    }
    const { data, error } = await withFreshCode((code, expiresAt) =>
      admin.from('scanner_invites')
        .insert({ restaurant_id: restaurantId, name, code, expires_at: expiresAt })
        .select('id, name, code, created_at, expires_at').single()
    );
    if (error) return res.status(500).json({ error: error.message || 'Could not create the invite.' });
    return res.status(200).json({ invite: inviteOut(data) });
  }

  if (action === 'resend') {
    const { data: inv } = await admin.from('scanner_invites')
      .select('id').eq('id', body.invite_id).eq('restaurant_id', restaurantId)
      .is('used_at', null).is('cancelled_at', null).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'That invite is no longer open.' });
    // The old code stops working the moment the new one is made.
    const { data, error } = await withFreshCode((code, expiresAt) =>
      admin.from('scanner_invites')
        .update({ code, expires_at: expiresAt, created_at: nowIso() })
        .eq('id', inv.id)
        .select('id, name, code, created_at, expires_at').single()
    );
    if (error) return res.status(500).json({ error: error.message || 'Could not make a new code.' });
    return res.status(200).json({ invite: inviteOut(data) });
  }

  if (action === 'cancel') {
    const { error } = await admin.from('scanner_invites')
      .update({ cancelled_at: nowIso() })
      .eq('id', body.invite_id).eq('restaurant_id', restaurantId).is('used_at', null);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'remove') {
    const { data: sc } = await admin.from('restaurant_scanners')
      .select('id, user_id').eq('id', body.scanner_id).eq('restaurant_id', restaurantId)
      .is('removed_at', null).maybeSingle();
    if (!sc) return res.status(404).json({ error: 'That scanner was already removed.' });
    const { error } = await admin.from('restaurant_scanners')
      .update({ removed_at: nowIso(), removed_by: 'owner' }).eq('id', sc.id);
    if (error) return res.status(500).json({ error: error.message });
    // Their next upload is already refused (no active membership); this also
    // signs the phone out.
    await endScannerLogin(sc.user_id);
    return res.status(200).json({ ok: true });
  }

  if (action === 'review') {
    const { error } = await admin.from('invoices')
      .update({ scan_reviewed_at: nowIso() })
      .eq('id', body.invoice_id).eq('restaurant_id', restaurantId)
      .not('scanned_by_name', 'is', null);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action.' });
}