import { adminDb, requireAdmin } from '../../../lib/admin/requireAdmin.js';
import { projectionRPC } from '../../../lib/projections/nightlyWorker.js';
import { sendProjectionJob } from '../../../lib/projections/nightlyQueue.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const rid = req.method === 'GET'
    ? req.query.restaurant_id
    : req.body?.restaurant_id;

  if (typeof rid !== 'string' || !/^[0-9a-f-]{36}$/i.test(rid)) {
    return res.status(400).json({ error: 'Restaurant ID required' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await projectionRPC(adminDb, 'projection_latest', { rid }));
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (req.body.action === 'enable' || req.body.action === 'disable') {
      return res.status(200).json(await projectionRPC(adminDb, 'projection_enable', {
        rid,
        actor: admin.user.id,
        turn_on: req.body.action === 'enable',
        history_from: req.body.first_data_date ?? null,
        deadline: req.body.publish_deadline_minutes ?? null,
      }));
    }

    if (
      req.body.action === 'force' &&
      /^[0-9a-f-]{36}$/i.test(req.body.request_id || '')
    ) {
      const result = await projectionRPC(adminDb, 'projection_force', {
        rid,
        request_id: req.body.request_id,
        actor: admin.user.id,
      });

      await sendProjectionJob(result.job_id);
      return res.status(202).json(result);
    }

    return res.status(400).json({
      error: 'Unknown projection action or missing request ID',
    });
  } catch (e) {
    return res.status(/DEADLINE|CONFLICT/.test(e.code || '') ? 409 : 400).json({
      error: e.code || 'PROJECTION_REQUEST_FAILED',
      message: e.message,
    });
  }
}