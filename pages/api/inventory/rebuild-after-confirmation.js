export const config = { maxDuration: 300 };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function createRebuildAfterConfirmationHandler({ db, verifyOwner,
  rebuild = async (database, restaurantId) => {
    const { rebuildCurrentInventory } = await import('../../../lib/currentInventory');
    return rebuildCurrentInventory(database, restaurantId);
  },
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    try {
      const auth = verifyOwner ? await verifyOwner(req)
        : await import('../../../lib/scannerAuth').then(module => module.requireOwner(req));
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { return res.status(400).json({ error: 'Invalid JSON body.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => key !== 'confirmation_id') ||
        typeof body.confirmation_id !== 'string' || !UUID.test(body.confirmation_id)) {
        return res.status(400).json({ error: 'A valid confirmation ID is required.' });
      }
      const database = db || await import('../../../lib/scannerAuth').then(module => module.admin);
      const { data: confirmation, error } = await database.from('waste_confirmations')
        .select('id,status,confirmed_at').eq('id', body.confirmation_id)
        .eq('restaurant_id', auth.restaurant.id).maybeSingle();
      if (error) throw error;
      if (!confirmation) return res.status(404).json({ error: 'Confirmation not found.' });
      if (!['confirmed_wasted', 'confirmed_used', 'kept', 'not_sure'].includes(confirmation.status)) {
        return res.status(409).json({ error: 'The confirmation has not been answered yet.' });
      }
      await rebuild(database, auth.restaurant.id);
      return res.status(200).json({ ok: true, rebuilt: true });
    } catch (error) {
      console.error('[inventory/rebuild-after-confirmation]', error.message);
      return res.status(500).json({
        error: 'The response was saved, but inventory could not be refreshed. Please try again.',
      });
    }
  };
}

export default createRebuildAfterConfirmationHandler();