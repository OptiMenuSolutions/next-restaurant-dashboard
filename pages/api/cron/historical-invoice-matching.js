// Copy to pages/api/cron/historical-invoice-matching.js
import { adminDb } from '../../../lib/admin/requireAdmin';
import { runHistoricalInvoiceMatching } from '../../../lib/historicalInvoiceMatching';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { data: jobs, error } = await adminDb.from('historical_invoice_match_jobs')
    .select('restaurant_id,generation,completed_generation,lease_until')
    .order('updated_at', { ascending: true }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  const pending = (jobs || []).filter(job =>
    Number(job.generation) > Number(job.completed_generation) &&
    (!job.lease_until || new Date(job.lease_until).getTime() < Date.now())
  );
  const results = [];
  // Bounded work per invocation; later runs pick up additional jobs.
  for (const job of pending.slice(0, 3)) {
    try {
      results.push({ restaurant_id: job.restaurant_id,
        result: await runHistoricalInvoiceMatching(adminDb, job.restaurant_id) });
    } catch (e) {
      console.error('[historical-invoice-matching:cron]', job.restaurant_id, e);
      results.push({ restaurant_id: job.restaurant_id, error: e.message });
    }
  }
  return res.status(200).json({ processed: results.length, results });
}