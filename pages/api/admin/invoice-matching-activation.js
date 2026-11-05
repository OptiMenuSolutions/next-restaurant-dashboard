
import {
  adminDb as db,
  requireAdmin,
  TOUR_RESTAURANT_ID,
} from '../../../lib/admin/requireAdmin';

import {
  getProgressiveInvoiceMatchingPolicy,
} from '../../../lib/progressiveInvoiceMatching';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const restaurantId =
    req.method === 'GET'
      ? req.query.restaurant_id
      : req.body?.restaurant_id;

  if (
    typeof restaurantId !== 'string' ||
    !UUID.test(restaurantId) ||
    restaurantId === TOUR_RESTAURANT_ID
  ) {
    return res.status(400).json({
      error: 'Invalid restaurant ID.',
    });
  }

  try {
    const { data: restaurant, error: restaurantError } =
      await db
        .from('restaurants')
        .select('id')
        .eq('id', restaurantId)
        .maybeSingle();

    if (restaurantError) throw restaurantError;

    if (!restaurant) {
      return res.status(404).json({
        error: 'Restaurant not found.',
      });
    }

    const policy = await getProgressiveInvoiceMatchingPolicy(
      db,
      restaurantId
    );

    return res.status(200).json({
      mode: policy.mode,
      completion: policy.completion,
      control: policy.control,
      matching_enabled: policy.matching_enabled,
      eligible_ingredient_count:
        policy.eligibleIngredientIds?.size ?? null,
    });
  } catch (error) {
    console.error(
      '[admin invoice matching status]',
      error
    );

    return res.status(500).json({
      error: 'Could not load matching status.',
    });
  }
}
