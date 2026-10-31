
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { getRestaurantDataReadiness } from '../../../lib/admin/dataReadiness';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { restaurantId } = req.query;

    if (restaurantId !== undefined) {
      if (typeof restaurantId !== 'string' || !UUID.test(restaurantId)) {
        return res.status(400).json({
          error: 'Valid restaurantId is required',
        });
      }

      const readiness = await getRestaurantDataReadiness(
        supabase,
        restaurantId
      );

      return res.status(200).json({ readiness });
    }

    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) throw error;

    const readiness = [];

    // Keep concurrency bounded to avoid overwhelming Supabase.
    for (let i = 0; i < (restaurants || []).length; i += 5) {
      const batch = restaurants.slice(i, i + 5);

      const results = await Promise.allSettled(
        batch.map(async restaurant => ({
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          ...(await getRestaurantDataReadiness(
            supabase,
            restaurant.id
          )),
        }))
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          readiness.push(result.value);
        } else {
          console.error(
            '[data-readiness] Assessment failed:',
            batch[index].id,
            result.reason
          );

          readiness.push({
            restaurantId: batch[index].id,
            restaurantName: batch[index].name,
            score: null,
            status: 'unavailable',
            error: 'Assessment unavailable',
          });
        }
      });
    }

    return res.status(200).json({ readiness });
  } catch (error) {
    console.error('[data-readiness] Error:', error);
    return res.status(500).json({
      error: 'Failed to calculate data readiness',
    });
  }
});
