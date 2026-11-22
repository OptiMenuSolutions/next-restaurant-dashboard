import shift4, { createShift4ProjectionReader } from '../../../lib/pos/providers/shift4.js';
import { createProjectionSourceReader } from '../../../lib/projections/nightlySource.js';
import { processProjectionJob } from '../../../lib/projections/nightlyWorker.js';
import {
  PROJECTION_TOPIC,
  projectionQueue,
  projectionRetry,
  sendProjectionJob,
} from '../../../lib/projections/nightlyQueue.js';

export const config = { maxDuration: 300 };

export default projectionQueue.handleNodeCallback(async (message, metadata) => {
  if (metadata.topicName !== PROJECTION_TOPIC) {
    throw new Error('Unexpected projection topic.');
  }

  const { adminDb } = await import('../../../lib/admin/requireAdmin.js');

  const readSource = createProjectionSourceReader(adminDb, {
    provider: shift4,
    fetchTickets: createShift4ProjectionReader(),
  });

  const result = await processProjectionJob(adminDb, message, readSource);

  console.info('[projections]', {
    job_id: message.job_id,
    status: result.status,
    stage: result.stage,
    error: result.error,
  });

  if (result.again) await sendProjectionJob(message.job_id, result);
}, {
  visibilityTimeoutSeconds: 600,
  retry: projectionRetry,
});