import { normalizeProjectionCalendarAnswers } from '../../../lib/projections/calendar.js';
import { projectionCalendarResponse } from '../../../lib/projections/calendarStore.js';
import { shiftProjectionDate } from '../../../lib/projections/businessTime.js';

export function createProjectionCalendarHandler({ db, verifyOwner, adminMode = false } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET', 'PUT'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PUT');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    try {
      const services = !db || !verifyOwner ? await (adminMode
        ? import('../../../lib/admin/requireAdmin') : import('../../../lib/scannerAuth')) : null;
      const database = db || (adminMode ? services.adminDb : services.admin);
      const auth = await (verifyOwner || (adminMode ? services.requireAdmin : services.requireOwner))(req, res);
      if (!auth) return;
      if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
      if (!auth.user?.id) return res.status(401).json({ error: 'Please sign in again.' });
      const query = req.query || {};
      const restaurantId = adminMode ? query.restaurantId : auth.restaurant?.id;
      if ((adminMode && (Object.keys(query).some(key => key !== 'restaurantId') ||
        typeof restaurantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(restaurantId))) ||
        (!adminMode && Object.keys(query).length) || !restaurantId) {
        return res.status(422).json({ error: 'Unexpected calendar query fields.' });
      }
      if (req.method === 'GET') {
        const context = projectionCalendarResponse(await database.rpc('projection_calendar_setup', {
          p_restaurant_id: restaurantId, p_actor_id: auth.user.id,
        }));
        if (context.restaurant_id !== restaurantId || !Number.isSafeInteger(context.revision) || context.revision < 0) {
          throw new Error('Invalid calendar setup response.');
        }
        const settings = normalizeProjectionCalendarAnswers(context.settings);
        return res.status(200).json({ restaurant_id: restaurantId, revision: context.revision,
          settings, effective_from: context.effective_from, setup_required: settings.concept_type == null });
      }
      let body;
      let settings;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !['settings', 'expected_revision', 'effective_from'].includes(key)) ||
          !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) {
          throw new TypeError('Invalid calendar update.');
        }
        settings = normalizeProjectionCalendarAnswers(body.settings);
        if (body.effective_from !== undefined) shiftProjectionDate(body.effective_from, 0);
      } catch {
        return res.status(422).json({ error: 'Provide valid calendar answers, an expected revision and an optional effective date.' });
      }
      const saved = projectionCalendarResponse(await database.rpc('projection_save_calendar_answers', {
        p_restaurant_id: restaurantId, p_actor_id: auth.user.id,
        p_expected_revision: body.expected_revision, p_settings: settings,
        p_effective_from: body.effective_from ?? null,
      }));
      if (saved.restaurant_id !== restaurantId || !Number.isSafeInteger(saved.revision) ||
        saved.revision < 0 || typeof saved.changed !== 'boolean') throw new Error('Invalid calendar save receipt.');
      return res.status(200).json(saved);
    } catch (error) {
      const status = error.code === 'PT409' ? 409 : error.code === '42501' ? 403
        : ['22023', 'RESTAURANT_TIMEZONE_REQUIRED', 'RESTAURANT_TIMEZONE_INVALID'].includes(error.code) ? 422 : 503;
      return res.status(status).json({ code: error.code || 'PROJECTION_CALENDAR_UNAVAILABLE',
        error: status === 409 ? 'Calendar answers changed. Reload before saving again.'
          : status === 422 ? 'Check the calendar configuration, time zone and effective date.'
          : status === 403 ? 'This restaurant calendar is unavailable.'
          : 'Could not load or save the calendar. Please retry.' });
    }
  };
}

export default createProjectionCalendarHandler();