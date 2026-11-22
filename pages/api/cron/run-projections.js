import { withJobRun } from '../../../lib/admin/jobRun.js';
import { projectionRPC } from '../../../lib/projections/nightlyWorker.js';
import { sendProjectionJob } from '../../../lib/projections/nightlyQueue.js';

export const config = { maxDuration: 300 };

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (
    !process.env.CRON_SECRET ||
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { adminDb } = await import('../../../lib/admin/requireAdmin.js');

  try {
    const result = await projectionRPC(adminDb, 'projection_dispatch');
    const deliveries = await Promise.allSettled(
      result.jobs.map(id => sendProjectionJob(id))
    );
    const failed = deliveries.filter(r => r.status === 'rejected').length;

    return res.status(failed || result.errors.length ? 503 : 200).json({
      error: failed || result.errors.length ? 'PROJECTION_DISPATCH_PARTIAL' : undefined,
      jobs: result.jobs.length,
      failed,
      setup_errors: result.errors,
    });
  } catch (e) {
    return res.status(503).json({ error: e.code || 'PROJECTION_DISPATCH_FAILED' });
  }
}

export default withJobRun('run-projections', handler);