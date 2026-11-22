import { QueueClient } from '@vercel/queue';

export const PROJECTION_TOPIC = 'projection-nightly';
export const projectionQueue = new QueueClient({ region: 'iad1' });

export const projectionRetry = (error, metadata) =>
  metadata.deliveryCount >= 5
    ? { acknowledge: true }
    : { afterSeconds: 600 };

export async function sendProjectionJob(jobId, result = {}) {
  return projectionQueue.send(PROJECTION_TOPIC, { job_id: jobId }, {
    idempotencyKey: `${jobId}:${result.attempt ?? Math.floor(Date.now() / 900000)}`,
    delaySeconds: Math.max(
      0,
      Math.ceil((Date.parse(result.retry_at ?? new Date().toISOString()) - Date.now()) / 1000)
    ),
  });
}