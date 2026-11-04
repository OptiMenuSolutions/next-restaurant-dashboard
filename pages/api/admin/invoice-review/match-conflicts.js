
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

  if (!restaurantId) {
    return res.status(400).json({
      error: 'restaurant_id is required',
    });
  }

  try {
    const invoiceItems = await fetchAll(() =>
      supabase
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
        .eq('invoices.restaurant_id', restaurantId)
        .eq('invoices.is_sample', false)
        .order('id')
    );

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
        .eq('restaurant_id', restaurantId)
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

    return res.status(200).json({
      restaurant_id: restaurantId,
      total_purchases_scanned: purchases.length,
      conflict_count: conflicts.length,
      conflicts,
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
