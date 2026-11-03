
import { createClient } from '@supabase/supabase-js';
import { convertIngredientQuantity } from './lib/ingredientUnitConversions.js';

const restaurantId = process.argv[2];

if (!restaurantId) {
  throw new Error('Usage: pass a restaurant UUID');
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const rows = [];
const pageSize = 500;

for (let from = 0; ; from += pageSize) {
  const { data, error } = await db
    .from('invoice_items')
    .select(`
      id,
      item_name,
      quantity,
      unit,
      invoices!inner(restaurant_id),
      ingredients(
        id,
        name,
        unit,
        ingredient_unit_conversions(
          id, ingredient_id, from_unit, to_unit,
          factor, basis, evidence
        ),
        ingredient_conversion_default_links(
          ingredient_conversion_defaults(
            id, label, from_unit, to_unit,
            factor, basis, evidence, source_url
          )
        )
      )
    `)
    .eq('invoices.restaurant_id', restaurantId)
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1);

  if (error) throw error;
  rows.push(...data);

  if (data.length < pageSize) break;
}

const gaps = new Map();
let checked = 0;
let resolved = 0;
let unlinked = 0;

for (const line of rows) {
  const ingredient = line.ingredients;

  if (!ingredient) {
    unlinked++;
    continue;
  }

  checked++;

  const result = convertIngredientQuantity(
    Number(line.quantity),
    line.unit,
    ingredient.unit,
    ingredient
  );

  if (result && Number.isFinite(result.quantity)) {
    resolved++;
    continue;
  }

  const key = [
    ingredient.id,
    line.unit,
    ingredient.unit,
  ].join('|');

  const existing = gaps.get(key) || {
    ingredient: ingredient.name,
    invoice_unit: line.unit,
    tracked_unit: ingredient.unit,
    affected_lines: 0,
    example_item: line.item_name,
  };

  existing.affected_lines++;
  gaps.set(key, existing);
}

console.log(JSON.stringify({
  restaurant_id: restaurantId,
  total_invoice_lines: rows.length,
  linked_lines_checked: checked,
  resolved,
  unresolved: checked - resolved,
  unlinked,
  gaps: [...gaps.values()].sort(
    (a, b) => b.affected_lines - a.affected_lines
  ),
}, null, 2));
