import { createClient } from '@supabase/supabase-js';
import { prepareUsage } from '../../../lib/pos/prepareUsageV2';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';
import { withJobRun } from '../../../lib/admin/jobRun';

export const config = { maxDuration: 300 };

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  if (
    !process.env.CRON_SECRET ||
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const started = Date.now();
  const results = [];

  try {
    // Limit one invocation; remaining restaurants stay durably queued.
    for (
      let index = 0;
      index < 3 && Date.now() - started < 210000;
      index++
    ) {
      const [job] = checked(
        await db.rpc('claim_pos_usage')
      ) || [];

      if (!job) break;

      let failure = null;
      let applied = false;
      let usage;

      try {
        usage = await prepareUsage(
          db,
          job.restaurant_id,
          Infinity,
          50000,
          job.lease_token
        );

        const settings = checked(
          await db
            .from('pos_usage_settings')
            .select('enabled')
            .eq('restaurant_id', job.restaurant_id)
            .single()
        );

        if (settings.enabled && !usage.skipped) {
          // Successful servings count even when others need review.
          await rebuildCurrentInventory(
            db,
            job.restaurant_id
          );

          applied = true;
        }
      } catch (error) {
        failure = error.message || String(error);

        console.error(
          '[pos-usage:worker]',
          job.restaurant_id,
          failure
        );
      }

      checked(await db.rpc('finish_pos_usage', {
        p_restaurant_id: job.restaurant_id,
        p_lease: job.lease_token,
        p_error: failure,
        p_applied: applied,
      }));

      results.push({
        restaurantId: job.restaurant_id,
        applied,
        prepared: usage?.report?.filter(
          (row) => row.status === 'ready'
        ).length || 0,
        unresolved: usage?.report?.filter(
          (row) => row.status === 'blocked'
        ).length || 0,
        error: failure,
      });
    }

    const failed = results.filter(
      (row) => row.error
    ).length;

    return res.status(failed ? 500 : 200).json({
      results,
      failed,
      ...(failed
        ? {
            error:
              `${failed} POS usage job(s) will retry automatically`,
          }
        : {}),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      results,
    });
  }
}

export default withJobRun('prepare-pos-usage', handler);