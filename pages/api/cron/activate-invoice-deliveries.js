import { activateInvoiceDeliveries } from '../../../lib/admin/activateInvoiceDeliveries.js';

export const config = { maxDuration: 300 };

export function createActivateDeliveriesHandler({
  db,
  run = activateInvoiceDeliveries,
  getSecret = () => process.env.CRON_SECRET,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const secret = getSecret();
    if (!secret || req.headers.authorization !== 'Bearer ' + secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const database = db || (await import('../../../lib/admin/requireAdmin')).adminDb;
      const result = await run(database);

      if (!Array.isArray(result?.failed)) {
        throw new Error('Unexpected activation result.');
      }

      if (result.failed.length) {
        console.error('[delivery-activation]', result.failed);
        return res.status(503).json({
          ...result,
          error: 'Delivery calculations need attention.',
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error('[delivery-activation]', error.message);
      return res.status(500).json({
        error: 'Delivery activation could not be completed.',
      });
    }
  };
}

const handler = createActivateDeliveriesHandler();

export default async function cron(req, res) {
  if (
    req.method !== 'GET' || !process.env.CRON_SECRET ||
    req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET
  ) {
    return handler(req, res);
  }

  const { withJobRun } = await import('../../../lib/admin/jobRun');
  return withJobRun('activate-invoice-deliveries', handler)(req, res);
}