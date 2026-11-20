import { projectionCalendarResponse } from '../../../lib/projections/calendarStore.js';
import { shiftProjectionDate } from '../../../lib/projections/businessTime.js';

export function createProjectionHolidayHandler({ db, verifyOwner } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
    try {
      const services = !db || !verifyOwner ? await import('../../../lib/scannerAuth') : null;
      const auth = await (verifyOwner || services.requireOwner)(req);
      if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
      if (!auth.restaurant?.id || !auth.user?.id) return res.status(401).json({ error: 'Please sign in again.' });
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (Object.keys(req.query || {}).length || !body || Array.isArray(body) ||
          !['claim', 'answer', 'dismiss'].includes(body.action)) throw new Error();
        const allowed = body.action === 'claim' ? ['action'] : body.action === 'dismiss'
          ? ['action', 'business_date'] : ['action', 'business_date', 'answer', 'expected_revision'];
        if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error();
        if (body.action !== 'claim') shiftProjectionDate(body.business_date, 0);
        if (body.action === 'answer' && (!['open', 'closed', 'early_close'].includes(body.answer) ||
          !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0)) throw new Error();
      } catch { return res.status(422).json({ error: 'Invalid optional holiday response.' }); }
      const result = projectionCalendarResponse(await (db || services.admin).rpc('projection_holiday_prompt', {
        p_restaurant_id: auth.restaurant.id, p_actor_id: auth.user.id, p_action: body.action,
        p_business_date: body.business_date || null, p_answer: body.answer || null,
        p_expected_revision: body.expected_revision ?? null,
      }));
      if (result.restaurant_id !== auth.restaurant.id) throw new Error('Unexpected restaurant.');
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.code === 'PT409' ? 409 : error.code === '42501' ? 403 : error.code === '22023' ? 422 : 503)
        .json({ error: error.code === 'PT409' ? 'This holiday answer changed. You can dismiss this question.'
          : 'Could not save the optional holiday response. You can dismiss this question.' });
    }
  };
}

export default createProjectionHolidayHandler();