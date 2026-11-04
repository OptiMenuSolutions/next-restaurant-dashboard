
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import {
  groupInvoiceMatchConflicts,
} from '../../../../lib/invoiceMatchConflicts';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PAGE_SIZE = 500;

async function fetchAll(queryFactory) {
  const rows = [];

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await queryFactory()
      .range(start, start + PAGE_SIZE - 1);

    if (error) throw error;

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  const restaurantId = String(
    req.query.restaurant_id || ''
  ).trim();

  // No restaurant_id means all restaurants.
  // Supplying one limits the results to that restaurant.

  try {
    const invoiceItems = await fetchAll(() => {
      let query = supabase
        .from('invoice_items')
        .select(`
          id,
          invoice_id,
          item_name,
          ingredient_name_normalized,
          ingredient_id,
          invoices!inner (
            id,
            restaurant_id,
            supplier,
            number,
            date,
            is_sample
          )
        `)
        .eq('invoices.is_sample', false)
        .order('id');

      if (restaurantId) {
        query = query.eq('invoices.restaurant_id', restaurantId);
      }

      return query;
    });

    const ingredientIds = [
      ...new Set(
        invoiceItems
          .map(item => item.ingredient_id)
          .filter(Boolean)
      ),
    ];

    const ingredientNames = new Map();

    for (let start = 0; start < ingredientIds.length; start += PAGE_SIZE) {
      const batch = ingredientIds.slice(start, start + PAGE_SIZE);

      const { data, error } = await supabase
        .from('ingredients')
        .select('id, name')
        .in('id', batch);

      if (error) throw error;

      for (const ingredient of data || []) {
        ingredientNames.set(ingredient.id, ingredient.name);
      }
    }

    const purchases = invoiceItems.map(item => ({
      restaurant_id: item.invoices.restaurant_id,
      supplier: item.invoices.supplier,
      item_name: item.item_name,
      ingredient_name_normalized:
        item.ingredient_name_normalized,
      invoice_id: item.invoice_id,
      invoice_item_id: item.id,
      invoice_number: item.invoices.number,
      invoice_date: item.invoices.date,
      ingredient_id: item.ingredient_id,
      matched_ingredient: item.ingredient_id
        ? ingredientNames.get(item.ingredient_id) || null
        : null,
    }));

    const conflicts = groupInvoiceMatchConflicts(purchases);

    const restaurantIds = [
      ...new Set(conflicts.map(group => group.restaurant_id)),
    ];

    const restaurantNames = new Map();

    for (let start = 0; start < restaurantIds.length; start += PAGE_SIZE) {
      const batch = restaurantIds.slice(start, start + PAGE_SIZE);

      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name')
        .in('id', batch);

      if (error) throw error;

      for (const restaurant of data || []) {
        restaurantNames.set(restaurant.id, restaurant.name);
      }
    }

    const namedConflicts = conflicts.map(group => ({
      ...group,
      restaurant_name:
        restaurantNames.get(group.restaurant_id) || 'Unknown restaurant',
    }));

    return res.status(200).json({
      restaurant_id: restaurantId || null,
      total_purchases_scanned: purchases.length,
      conflict_count: namedConflicts.length,
      conflicts: namedConflicts,
    });
  } catch (error) {
    console.error(
      '[admin match-conflicts]',
      error
    );

    return res.status(500).json({
      error: 'Failed to load ingredient match conflicts',
    });
  }
});
