import { withJobRun } from '../../../lib/admin/jobRun.js';
import { dispatchWasteDailyAssessments } from '../../../lib/wasteDailyRunner.js';

export const config = { maxDuration: 300 };

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { adminDb } = await import('../../../lib/admin/requireAdmin.js');
  return res.status(200).json(await dispatchWasteDailyAssessments(adminDb));
}

export default withJobRun('run-waste-projection-assessments', handler);