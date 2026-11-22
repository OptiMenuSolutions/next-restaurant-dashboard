import {
  requireAdmin,
  adminDb,
} from '../../../../lib/admin/requireAdmin.js';
import { projectionRPC } from '../../../../lib/projections/nightlyWorker.js';
import { refreshProjectionBenchmarks } from '../../../../lib/projections/benchmarkRefresh.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      if (req.query.id) {
        return res.json(
          await projectionRPC(adminDb, 'projection_benchmark_preview', {
            vid: req.query.id,
          })
        );
      }

      return res.json(
        await projectionRPC(adminDb, 'projection_benchmark_catalog')
      );
    }

    if (req.method === 'POST' && req.body?.action === 'refresh') {
      return res.json(
        await refreshProjectionBenchmarks(adminDb, {
          snapshotAt: new Date().toISOString(),
          apiKey: process.env.FRED_API_KEY,
          force: true,
        })
      );
    }

    if (req.method === 'POST' && req.body?.action === 'approve') {
      return res.json(
        await projectionRPC(adminDb, 'projection_approve_benchmark', {
          vid: req.body.id,
          expected_digest: req.body.digest,
          actor: admin.user.id,
        })
      );
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(503).json({ error: 'BENCHMARK_REVIEW_FAILED' });
  }
}