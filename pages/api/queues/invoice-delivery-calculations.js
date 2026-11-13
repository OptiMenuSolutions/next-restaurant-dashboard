import {
  DELIVERY_TOPIC,
  deliveryQueue,
  deliveryRetry,
} from '../../../lib/admin/invoiceDeliveryQueue.js';

import { processDeliveryCalculation } from '../../../lib/admin/processDeliveryCalculation.js';

export const config = { maxDuration: 300 };

export default deliveryQueue.handleNodeCallback(async (message, metadata) => {
  if (metadata.topicName !== DELIVERY_TOPIC) {
    throw new Error('Unexpected delivery calculation topic.');
  }

  const { adminDb } = await import('../../../lib/admin/requireAdmin');
  const outcome = await processDeliveryCalculation(adminDb, message);

  console.info('[delivery-calculations]', {
    messageId: metadata.messageId,
    restaurantId: message.restaurant_id,
    generation: message.generation,
    ...outcome,
  });
}, {
  visibilityTimeoutSeconds: 600,
  retry: deliveryRetry,
});