import { withJobRun } from '../../../lib/admin/jobRun.js';
import { refreshProjectionBenchmarks } from '../../../lib/projections/benchmarkRefresh.js';

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
    return res.status(200).json(
      await refreshProjectionBenchmarks(adminDb, {
        snapshotAt: new Date().toISOString(),
        apiKey: process.env.FRED_API_KEY,
      })
    );
  } catch {
    await adminDb.from('projection_benchmark_status').upsert({
      provider: 'census',
      last_attempt_at: new Date().toISOString(),
      stale: true,
      failure_code: 'BENCHMARK_REFRESH_FAILED',
    });

    return res.status(503).json({ error: 'BENCHMARK_REFRESH_FAILED' });
  }
}

export default withJobRun('refresh-projection-benchmarks', handler);