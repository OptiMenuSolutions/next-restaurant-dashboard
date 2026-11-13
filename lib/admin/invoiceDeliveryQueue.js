import { QueueClient } from '@vercel/queue';

export const DELIVERY_TOPIC = 'invoice-delivery-calculations';
export const deliveryQueue = new QueueClient({ region: 'iad1' });

export function deliveryRetry(error, metadata) {
  if (metadata.deliveryCount >= 5) {
    console.error('[delivery-calculations:exhausted]', {
      messageId: metadata.messageId,
      error: error?.message || String(error),
    });
    return { acknowledge: true };
  }

  // Allow the database's seven-minute worker lease to expire after a crash.
  return { afterSeconds: 600 };
}