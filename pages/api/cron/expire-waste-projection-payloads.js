import { createClient } from '@supabase/supabase-js';
import { withJobRun } from '../../../lib/admin/jobRun';

export const config = { maxDuration: 60 };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 100;
const MAX_BATCHES = 4;

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await supabase.rpc('waste_projection_expire_payloads');

    if (error || !Number.isInteger(data) || data < 0 || data > BATCH_SIZE) {
      console.error('[expire-waste-projection-payloads]', error?.message || 'Invalid batch count');
      return res.status(503).json({ error: 'WASTE_PAYLOAD_EXPIRATION_FAILED', deleted });
    }

    deleted += data;
    if (data < BATCH_SIZE) {
      return res.status(200).json({ deleted, batch_limit_reached: false });
    }
  }

  return res.status(200).json({ deleted, batch_limit_reached: true });
}

export default withJobRun('expire-waste-projection-payloads', handler);