import {
  adminDb as db,
  requireAdmin,
} from '../../../../lib/admin/requireAdmin';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    const { data: rejections, error } = await db
      .from('invoice_match_rejections')
      .select(`
        id,
        restaurant_id,
        supplier_key,
        product_key,
        ingredient_id,
        rejected_by,
        reason,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const rows = rejections || [];

    const restaurantIds = [
      ...new Set(rows.map(row => row.restaurant_id)),
    ];

    const ingredientIds = [
      ...new Set(rows.map(row => row.ingredient_id)),
    ];

    const [restaurantResult, ingredientResult] =
      await Promise.all([
        restaurantIds.length
          ? db.from('restaurants')
              .select('id, name')
              .in('id', restaurantIds)
          : Promise.resolve({ data: [], error: null }),

        ingredientIds.length
          ? db.from('ingredients')
              .select('id, name, restaurant_id')
              .in('id', ingredientIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (restaurantResult.error) {
      throw restaurantResult.error;
    }

    if (ingredientResult.error) {
      throw ingredientResult.error;
    }

    const restaurants = new Map(
      (restaurantResult.data || []).map(row => [
        row.id,
        row.name,
      ])
    );

    const ingredients = new Map(
      (ingredientResult.data || []).map(row => [
        row.id,
        row,
      ])
    );

    return res.status(200).json({
      ok: true,
      rejections: rows.map(row => {
        const ingredient = ingredients.get(row.ingredient_id);

        return {
          ...row,
          restaurant_name:
            restaurants.get(row.restaurant_id) ||
            'Unknown restaurant',
          ingredient_name:
            ingredient?.restaurant_id === row.restaurant_id
              ? ingredient.name
              : 'Unknown ingredient',
        };
      }),
    });
  } catch (error) {
    console.error('[admin match rejections]', error);

    return res.status(500).json({
      error: 'Could not load rejected relationships.',
    });
  }
}