import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { allRows } from '../../../lib/pos/usageServer';
import { runUsage } from '../../../lib/pos/runUsage';
import { convertIngredientQuantity } from '../../../lib/ingredientUnitConversions';
import { normalizeUnit } from '../../../lib/standardizedUnits';

export const config = { maxDuration: 300 };

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const check = (result) => {
  if (result.error) throw result.error;
  return result.data;
};

const unitName = (value) => {
  const normalized = normalizeUnit(value);
  return ({
    slices: 'slice',
    bunches: 'bunch',
    packages: 'package',
  })[normalized] || normalized;
};

const ORDER = {
  missing: 0,
  ai: 1,
  shared: 1,
  density: 1,
  package_label: 2,
  confirmed: 2,
  set: 2,
};

// Every recipe unit that does not match its ingredient's inventory unit,
// with the number currently used and where that number came from.
async function conversionRows(restaurantId) {
  const [ingredients, aiRows, menus, rules, result] = await Promise.all([
    allRows(() => db
      .from('ingredients')
      .select(
        'id,name,unit,' +
        'ingredient_unit_conversions(' +
          'id,ingredient_id,from_unit,to_unit,factor,basis,evidence' +
        '),' +
        'ingredient_conversion_default_links(' +
          'ingredient_conversion_defaults(' +
            'id,label,from_unit,to_unit,factor,basis,evidence,source_url' +
          ')' +
        ')'
      )
      .eq('restaurant_id', restaurantId)
      .order('id')
    ),
    allRows(() => db
      .from('ingredient_ai_unit_conversions')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('id')
    ),
    allRows(() => db
      .from('menu_items')
      .select(
        'id,name,menu_item_components(name,' +
        'component_ingredients(quantity,unit,ingredients(id)))'
      )
      .eq('restaurant_id', restaurantId)
      .order('id')
    ),
    allRows(() => db
      .from('pos_usage_rules')
      .select('context_key,plan,dish:context->>dish')
      .eq('restaurant_id', restaurantId)
      .order('context_key')
    ),
    db
      .from('pos_usage_results')
      .select('report')
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),
  ]);

  const byId = new Map(ingredients.map((row) => [row.id, row]));
  const byName = new Map(ingredients.map((row) => [
    String(row.name || '').trim().toLowerCase(),
    row,
  ]));

  for (const ingredient of ingredients) {
    ingredient.ai_unit_conversions = aiRows.filter((row) =>
      row.ingredient_id === ingredient.id
    );
  }

  const locals = new Map(ingredients.flatMap((ingredient) =>
    (ingredient.ingredient_unit_conversions || []).map((row) => [row.id, row])
  ));
  const ais = new Map(aiRows.map((row) => [row.id, row]));
  const report = check(result)?.report || [];
  const pairs = new Map();

  const add = (ingredient, units, dish) => {
    if (!ingredient) return null;

    const to = unitName(ingredient.unit);
    const from = units.map(unitName).find((value) => value && value !== to);

    if (!from || !to) return null;

    const key = `${ingredient.id}:${from}`;

    if (!pairs.has(key)) {
      pairs.set(key, { ingredient, from, to, dishes: new Set(), waiting: 0 });
    }

    if (dish) pairs.get(key).dishes.add(dish);

    return pairs.get(key);
  };

  for (const menu of menus) {
    for (const component of menu.menu_item_components || []) {
      for (const part of component.component_ingredients || []) {
        if (part.unit) add(byId.get(part.ingredients?.id), [part.unit], menu.name);
      }
    }
  }

  for (const rule of rules) {
    for (const op of rule.plan?.operations || []) {
      if (['set', 'replace'].includes(op.action) && op.unit) {
        add(
          byId.get(op.action === 'replace' ? op.target_id : op.ingredient_id),
          [op.unit],
          rule.dish
        );
      }
    }
  }

  // Blocked dishes name the exact conversion they are waiting for.
  for (const row of report) {
    if (row.status !== 'blocked') continue;

    const reason = String(row.reason || '');
    const match =
      /^Missing conversion for (.+): \S+ (.+?) -> (.+)$/.exec(reason) ||
      /^Conversion needs information for (.+?) \((.+?) -> (.+?)\):/.exec(reason);

    if (!match) continue;

    const pair = add(
      byName.get(match[1].trim().toLowerCase()),
      [match[2], match[3]],
      row.dish
    );

    if (pair) pair.waiting++;
  }

  return [...pairs.values()]
    .flatMap(({ ingredient, from, to, dishes, waiting }) => {
      const converted = convertIngredientQuantity(1, from, to, ingredient);

      // Plain unit math (lb to oz and so on): nothing to set.
      if (converted && !converted.estimated && !converted.conversionId) {
        return [];
      }

      let source = 'missing';
      let note = null;

      if (converted) {
        const id = converted.conversionId;
        const local = id ? locals.get(id) : null;
        const ai = id ? ais.get(id) : null;

        if (local) {
          source = local.basis === 'package_label'
            ? 'package_label'
            : /^Admin confirmed/.test(local.evidence || '') ? 'confirmed' : 'set';
          note = local.evidence || null;
        } else if (String(id || '').startsWith('shared:')) {
          source = 'shared';
        } else if (ai) {
          source = 'ai';
          note = ai.unit_definition || ai.assumptions || null;
        } else {
          source = 'density';
        }
      }

      const names = [...dishes].sort();

      return [{
        ingredient_id: ingredient.id,
        name: ingredient.name,
        from,
        to,
        factor: converted ? Number(converted.quantity.toPrecision(4)) : null,
        source,
        note,
        dishes: names.slice(0, 6),
        dish_count: names.length,
        waiting,
      }];
    })
    .sort((a, b) =>
      ORDER[a.source] - ORDER[b.source] || a.name.localeCompare(b.name)
    );
}

export default withAdminAuth(async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).end();
  }

  try {
    const restaurantId = req.method === 'GET'
      ? req.query.restaurantId
      : req.body?.restaurantId;

    if (!restaurantId && req.method === 'GET') {
      const restaurants = await allRows(() => db
        .from('restaurants')
        .select('id,name')
        .order('id')
      );

      return res.json({ restaurants });
    }

    if (
      typeof restaurantId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(restaurantId)
    ) {
      throw new Error('Choose a restaurant');
    }

    if (req.method === 'GET') {
      return res.json({ rows: await conversionRows(restaurantId) });
    }

    const factor = Number(req.body.factor);

    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error('Enter a number above zero');
    }

    check(await db.rpc('save_pos_conversion', {
      p_restaurant_id: restaurantId,
      p_ingredient_id: req.body.ingredientId,
      p_from: unitName(req.body.fromUnit),
      p_to: unitName(req.body.toUnit),
      p_factor: factor,
      p_basis: 'measured',
      p_evidence: req.body.confirm
        ? 'Admin confirmed AI estimate on the Conversions page'
        : 'Set by admin on the Conversions page',
    }));

    let usage = null;

    try {
      usage = await runUsage(db, restaurantId);
    } catch (error) {
      usage = { error: error.message };
    }

    return res.json({ ok: true, usage });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});