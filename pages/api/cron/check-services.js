import { adminDb } from '../../../lib/admin/requireAdmin';
import { sendCronAlert } from '../../../lib/cronAlert';
import { services } from '../admin/platform/jobs';

const unavailable = (status) => status === 'DOWN' || status === 'NOT SET';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const checkedAt = new Date().toISOString();
    const results = await services();

    const { data: previousRows, error: readError } = await adminDb
      .from('admin_service_monitor_state')
      .select('service, status, consecutive_failures, alerted');

    if (readError) throw new Error(readError.message);

    const previous = new Map((previousRows || []).map((row) => [row.service, row]));
    const newAlerts = [];
    const recoveries = [];

    const updates = results.map((result) => {
      const old = previous.get(result.name);
      const down = unavailable(result.status);
      const wasDown = old && unavailable(old.status);
      const consecutiveFailures = down
        ? wasDown ? Number(old.consecutive_failures || 0) + 1 : 1
        : 0;

      let alerted = Boolean(old?.alerted);

      if (down && consecutiveFailures >= 2 && !alerted) {
        newAlerts.push(`${result.name}: ${result.status} — ${result.error || 'No response'}`);
        alerted = true;
      } else if (!down && alerted) {
        recoveries.push(`${result.name}: responding again (${result.status}${result.error ? ` — ${result.error}` : ''})`);
        alerted = false;
      }

      return {
        service: result.name,
        status: result.status,
        consecutive_failures: consecutiveFailures,
        alerted,
        checked_at: checkedAt,
        response_ms: result.ms,
        error: result.error,
      };
    });

    const { error: writeError } = await adminDb
      .from('admin_service_monitor_state')
      .upsert(updates, { onConflict: 'service' });

    if (writeError) throw new Error(writeError.message);

    if (newAlerts.length) {
      await sendCronAlert(
        'Service health monitor',
        `${newAlerts.length} service(s) were unavailable on two consecutive checks.`,
        newAlerts
      );
    }

    if (recoveries.length) {
      await sendCronAlert(
        'Service health monitor',
        `${recoveries.length} service(s) responded again.`,
        recoveries,
        { notice: true }
      );
    }

    return res.status(200).json({ checkedAt, services: updates });
  } catch (err) {
    console.error('[cron:check-services]', err);
    return res.status(500).json({ error: err.message || 'Service check failed' });
  }
}