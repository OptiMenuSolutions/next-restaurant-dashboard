import { projectionCalendarResponse } from '../../../lib/projections/calendarStore.js';
import { PROJECTION_OWNER_HOLIDAYS } from '../../../lib/projections/calendar.js';
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
        const allowed = body.action === 'answer' ? ['action', 'responses'] : ['action'];
        if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error();
        if (body.action === 'answer') {
          if (!Array.isArray(body.responses) || !body.responses.length || body.responses.length > 6 ||
            new Set(body.responses.map(row => row?.business_date)).size !== body.responses.length) throw new Error();
          for (const row of body.responses) {
            if (!row || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'answer,business_date,expected_revision' ||
              !['open', 'closed', 'early_close'].includes(row.answer) ||
              !Number.isSafeInteger(row.expected_revision) || row.expected_revision < 0) throw new Error();
            shiftProjectionDate(row.business_date, 0);
          }
        }
      } catch { return res.status(422).json({ error: 'Invalid optional holiday response.' }); }
      const result = projectionCalendarResponse(await (db || services.admin).rpc('projection_holiday_prompt', {
        p_restaurant_id: auth.restaurant.id, p_actor_id: auth.user.id, p_action: body.action,
        p_responses: body.responses || [],
      }));
      if (result.restaurant_id !== auth.restaurant.id) throw new Error('Unexpected restaurant.');
      if (body.action === 'claim' && result.prompt !== null) {
        const rows = result.prompt?.holidays;
        if (!Array.isArray(rows) || !rows.length || rows.length > 6 ||
          new Set(rows.map(row => row?.business_date)).size !== rows.length) throw new Error('Invalid holiday group.');
        for (const row of rows) {
          shiftProjectionDate(row.business_date, 0);
          if (!PROJECTION_OWNER_HOLIDAYS.includes(row.holiday_key) || !Number.isSafeInteger(row.revision) || row.revision < 0)
            throw new Error('Invalid holiday group.');
        }
      }
      if (body.action === 'answer' && (typeof result.changed !== 'boolean' || !Array.isArray(result.responses) ||
        result.responses.length !== body.responses.length || new Set(result.responses.map(row => row?.business_date)).size !== result.responses.length ||
        result.responses.some(row => !body.responses.some(sent => sent.business_date === row?.business_date) ||
          !Number.isSafeInteger(row.revision) || row.revision < 1))) throw new Error('Invalid answer receipt.');
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.code === 'PT409' ? 409 : error.code === '42501' ? 403 : error.code === '22023' ? 422 : 503)
        .json({ error: error.code === 'PT409' ? 'This holiday answer changed. You can dismiss this question.'
          : 'Could not save the optional holiday response. You can dismiss this question.' });
    }
  };
}

export default createProjectionHolidayHandler();