import { PROJECTION_UUID } from '../../../../lib/projections/eligibility.js';
import { readWasteAssessment, selectWasteAssessmentForDish } from '../../../../lib/wasteAssessmentReader.js';

async function readStatus(db, target, actor) {
  const { data, error } = await db.rpc('waste_projection_admin_surface_status', { target, actor });
  if (error) throw error;
  if (data?.restaurant_id !== target || typeof data.enabled !== 'boolean' ||
      typeof data.projections_enabled !== 'boolean' || typeof data.has_compact_assessment !== 'boolean') {
    throw new Error('Invalid waste assessment status response');
  }
  return data;
}

function summarize(view) {
  return view.mode === 'assessment'
    ? { mode: view.mode, assessment_date: view.assessment_date, stale: view.stale }
    : { mode: view.mode, reason: view.reason };
}

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
      const client = db || services.adminDb;
      const target = restaurantId.toLowerCase();
      const actor = auth.user.id;

      if (req.method === 'GET') {
        const status = await readStatus(client, target, actor);
        try {
          const view = await readWasteAssessment(client, target);
          return res.status(200).json({
            ...status, owner_card: summarize(view), tonight_dish: summarize(selectWasteAssessmentForDish(view)),
          });
        } catch (error) {
          console.error('[waste-assessment-switch] Reader status unavailable', error.code || 'READ_FAILED');
          return res.status(200).json({ ...status, owner_card: null, tonight_dish: null });
        }
      }

      const body = req.body;
      if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
          typeof body.enabled !== 'boolean') {
        return res.status(422).json({ error: 'Provide an enabled boolean.' });
      }
      if (body.enabled) {
        const status = await readStatus(client, target, actor);
        if (!status.projections_enabled || !status.has_compact_assessment) {
          return res.status(409).json({
            error: !status.projections_enabled
              ? 'Projections are disabled.'
              : 'No completed compact assessment is available.',
          });
        }
      }
      const { data, error } = await client.rpc('waste_projection_surface_switch', {
        target, actor, desired: body.enabled,
      });
      if (error) throw error;
      if (data?.restaurant_id !== target || typeof data.enabled !== 'boolean') {
        throw new Error('Invalid waste assessment switch response');
      }
      return res.status(200).json(data);
    } catch (error) {
      if (error.code === '42501') return res.status(403).json({ error: 'Admins only.' });
      if (error.code === 'PT404') return res.status(404).json({ error: 'Restaurant unavailable.' });
      console.error('[waste-assessment-switch]', error.code || 'SWITCH_FAILED');
      return res.status(503).json({ error: 'Could not read or save the waste assessment switch.' });
    }
  };
}

export default createWasteAssessmentSwitchHandler();