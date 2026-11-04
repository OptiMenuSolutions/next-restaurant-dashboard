
import { adminDb as db, requireAdmin } from '../../../../lib/admin/requireAdmin';
import { fetchAll } from '../../../../lib/admin/fetchAll';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  const restaurantId = req.query.restaurant_id;

  if (
    typeof restaurantId !== 'string' ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    return res.status(400).json({
      error: 'A valid restaurant ID is required.',
    });
  }

  try {
    const { data: restaurant, error: restaurantError } = await db
      .from('restaurants')
      .select('id, name')
      .eq('id', restaurantId)
      .maybeSingle();

    if (restaurantError) throw restaurantError;

    if (!restaurant) {
      return res.status(404).json({
        error: 'Restaurant not found.',
      });
    }

    const ingredients = await fetchAll(() =>
      db
        .from('ingredients')
        .select('id, name, unit')
        .eq('restaurant_id', restaurantId)
        .order('id')
    );

    ingredients.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return res.status(200).json({
      ok: true,
      restaurant_id: restaurantId,
      restaurant_name: restaurant.name,
      ingredient_count: ingredients.length,
      ingredients,
    });
  } catch (error) {
    console.error('[admin conflict ingredients]', error);

    return res.status(500).json({
      error: 'Failed to load restaurant ingredients.',
    });
  }
}
