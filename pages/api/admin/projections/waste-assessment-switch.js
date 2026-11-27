import { PROJECTION_UUID } from '../../../../lib/projections/eligibility.js';

export function createWasteAssessmentSwitchHandler({ db, verifyAdmin } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET', 'PUT'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PUT');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    try {
      const services = !db || !verifyAdmin ? await import('../../../../lib/admin/requireAdmin') : null;
      const auth = await (verifyAdmin || services.requireAdmin)(req, res);
      if (!auth) return;
      const query = req.query || {};
      const restaurantId = query.restaurantId;
      if (Object.keys(query).some(key => key !== 'restaurantId') ||
          typeof restaurantId !== 'string' || !PROJECTION_UUID.test(restaurantId)) {
        return res.status(422).json({ error: 'Provide a valid restaurant ID.' });
      }
      let desired = null;
      if (req.method === 'PUT') {
        const body = req.body;
        if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
            typeof body.enabled !== 'boolean') {
          return res.status(422).json({ error: 'Provide an enabled boolean.' });
        }
        desired = body.enabled;
      }
      const { data, error } = await (db || services.adminDb).rpc('waste_projection_surface_switch', {
        target: restaurantId, actor: auth.user.id, desired,
      });
      if (error) {
        if (error.code === '42501') return res.status(403).json({ error: 'Admins only.' });
        if (error.code === 'PT404') return res.status(404).json({ error: 'Restaurant unavailable.' });
        throw error;
      }
      if (data?.restaurant_id !== restaurantId.toLowerCase() || typeof data.enabled !== 'boolean') {
        throw new Error('Invalid waste assessment switch response');
      }
      return res.status(200).json(data);
    } catch (error) {
      console.error('[waste-assessment-switch]', error.code || 'SWITCH_FAILED');
      return res.status(503).json({ error: 'Could not read or save the waste assessment switch.' });
    }
  };
}

export default createWasteAssessmentSwitchHandler();