
import {
  adminDb as db,
  requireAdmin,
  TOUR_RESTAURANT_ID,
} from '../../../lib/admin/requireAdmin';

import {
  getRestaurantInvoiceMatchingControl,
  getInvoiceMatchingRecipeCompletion,
  activateRestaurantInvoiceMatching,
  INVOICE_MATCHING_STATUS,
} from '../../../lib/invoiceMatchingControls';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST'].includes(req.method)) {
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

    if (req.method === 'GET') {
      const [control, completion] = await Promise.all([
        getRestaurantInvoiceMatchingControl(db, restaurantId),
        getInvoiceMatchingRecipeCompletion(db, restaurantId),
      ]);

      return res.status(200).json({
        control,
        completion,
      });
    }

    const current =
      await getRestaurantInvoiceMatchingControl(
        db,
        restaurantId
      );

    if (current.matching_enabled) {
      return res.status(200).json({
        success: true,
        already_enabled: true,
        control: current,
      });
    }

    if (req.body?.confirm !== true) {
      return res.status(400).json({
        error: 'Explicit admin confirmation required.',
      });
    }

    const control =
      await activateRestaurantInvoiceMatching(
        db,
        restaurantId,
        {
          status: INVOICE_MATCHING_STATUS.ADMIN_ENABLED,
          actorId: admin.user.id,
          reason: 'Explicit administrator authorization',
        }
      );

    return res.status(200).json({
      success: true,
      control,
    });
  } catch (error) {
    console.error(
      '[admin invoice-matching activation]',
      error
    );

    return res.status(500).json({
      error: 'Could not process matching activation.',
    });
  }
}
