
import {
  adminDb,
  requireAdmin,
} from '../../../../lib/admin/requireAdmin';

import {
  getRestaurantInvoiceMatchingControl,
} from '../../../../lib/invoiceMatchingControls';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const restaurantId = req.query.restaurant_id;

  if (
    typeof restaurantId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      restaurantId
    )
  ) {
    return res.status(400).json({
      error: 'Valid restaurant_id is required',
    });
  }

  try {
    const { data: restaurant, error: restaurantError } =
      await adminDb
        .from('restaurants')
        .select('id, name')
        .eq('id', restaurantId)
        .maybeSingle();

    if (restaurantError) {
      throw new Error(restaurantError.message);
    }

    if (!restaurant) {
      return res.status(404).json({
        error: 'Restaurant not found',
      });
    }

    const control =
      await getRestaurantInvoiceMatchingControl(
        adminDb,
        restaurantId
      );

    return res.status(200).json({
      ok: true,
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
      },
      control,
    });
  } catch (error) {
    console.error(
      '[admin/invoice-matching/status]',
      error
    );

    return res.status(500).json({
      error: 'Could not load invoice matching status',
    });
  }
}
