import { requireAdmin, adminDb } from '../../../../lib/admin/requireAdmin.js';
import { projectionRPC } from '../../../../lib/projections/nightlyWorker.js';
import { PROJECTION_UUID } from '../../../../lib/projections/eligibility.js';
import { shiftProjectionDate as shift } from '../../../../lib/projections/businessTime.js';
import { prepareMonitor } from '../../../../lib/projections/monitor.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const started = performance.now();
  try {
    const view = req.query.view || 'overview';
    if (!['overview', 'service', 'accuracy', 'run'].includes(view)) throw Error('Invalid view');
    let result;
    if (view === 'overview') {
      result = prepareMonitor(await projectionRPC(adminDb, 'projection_monitor_overview'), view);
    } else {
      const rid = req.query.restaurant;
      if (typeof rid !== 'string' || !PROJECTION_UUID.test(rid)) throw Error('Invalid restaurant');
      if (view === 'run') {
        if (typeof req.query.run !== 'string' || !PROJECTION_UUID.test(req.query.run)) throw Error('Invalid run');
        if (req.query.date) shift(req.query.date, 0);
        if (req.query.dish && (typeof req.query.dish !== 'string' || !PROJECTION_UUID.test(req.query.dish))) throw Error('Invalid dish');
        const response = await adminDb.rpc('projection_monitor_run', {
          rid, run: req.query.run, day: req.query.date || null, item: req.query.dish || null,
        });
        if (!response || response.error) throw response?.error || Error('Monitor read failed');
        if (response.data === null) return res.status(404).json({ error: 'Run not found' });
        if (!response.data?.run || !Array.isArray(response.data.nights)) throw Error('Monitor response unavailable');
        result = response.data;
      } else {
        const until = req.query.date;
        shift(until, 0);
        const weeks = req.query.weeks || '12';
        if (!['4', '8', '12'].includes(weeks)) throw Error('Invalid weeks');
        if (req.query.regular && !['true', 'false'].includes(req.query.regular)) throw Error('Invalid filter');
        if (req.query.dish && (typeof req.query.dish !== 'string' || !PROJECTION_UUID.test(req.query.dish))) throw Error('Invalid dish');
        result = prepareMonitor(await projectionRPC(adminDb, 'projection_monitor_read', {
          rid, first_day: view === 'service' ? until : shift(until, 1 - Number(weeks) * 7),
          last_day: until, view_kind: view, regular_only: req.query.regular !== 'false',
          selected_dish: req.query.dish || null,
        }), view);
      }
    }
    return res.json({ ...result, read_ms: performance.now() - started });
  } catch (error) {
    const invalid = !error.code && (error instanceof TypeError || /^Invalid /.test(error.message || ''));
    console.error('[projection-monitor]', error.code || 'READ_FAILED');
    return res.status(invalid ? 400 : 503).json({ error: invalid ? 'Invalid monitor request' : 'Projection monitor unavailable. Try again.' });
  }
}