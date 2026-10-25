import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { allRows } from '../../../lib/pos/usageServer';
import { runUsage } from '../../../lib/pos/runUsage';
import { applyPlan } from '../../../lib/pos/usageMath';
import { convertQuantity } from '../../../lib/computeWasteRisk';
import {
  rebuildCurrentInventory,
} from '../../../lib/currentInventory';

export const config = { maxDuration: 300 };

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const check = (result) => {
  if (result.error) throw result.error;
  return result.data;
};

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
      const [settings, result, menus, ingredients, job] =
        await Promise.all([
          db
            .from('pos_usage_settings')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .maybeSingle(),
          db
            .from('pos_usage_results')
            .select('ready,usable,report,computed_at,publication_id')
            .eq('restaurant_id', restaurantId)
            .maybeSingle(),
          allRows(() => db
            .from('menu_items')
            .select('id,name')
            .eq('restaurant_id', restaurantId)
            .order('id')
          ),
          allRows(() => db
            .from('ingredients')
            .select('id,name,unit')
            .eq('restaurant_id', restaurantId)
            .order('id')
          ),
          db
            .from('pos_usage_jobs')
            .select(
              'next_run,lease_until,last_error,' +
              'last_finished_at,applied_publication_id'
            )
            .eq('restaurant_id', restaurantId)
            .maybeSingle(),
        ]);

      return res.json({
        settings: check(settings),
        result: check(result),
        job: check(job),
        menus,
        ingredients,
      });
    }

    const action = req.body.action;

    if (action === 'setup') {
      const date = req.body.startDate;

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
        !Number.isFinite(Date.parse(date))
      ) {
        throw new Error('Choose a start date');
      }

      check(await db
        .from('pos_usage_settings')
        .insert({
          restaurant_id: restaurantId,
          start_date: date,
        })
      );
    } else if (action === 'prepare') {
      check(await db.rpc('enqueue_pos_usage', {
        p_restaurant_id: restaurantId,
      }));

      // Continue below and process this restaurant in the same request.
    } else if (action === 'map') {
      const menu = req.body.menuId === '__exclude__'
        ? { id: '__exclude__' }
        : check(await db
            .from('menu_items')
            .select('id')
            .eq('restaurant_id', restaurantId)
            .eq('id', req.body.menuId)
            .single()
          );

      const setting = check(await db
        .from('pos_usage_settings')
        .select('dish_map')
        .eq('restaurant_id', restaurantId)
        .single()
      );

      if (
        !req.body.itemRef ||
        typeof req.body.itemRef !== 'string'
      ) {
        throw new Error('Missing POS item reference');
      }

      check(await db
        .from('pos_usage_settings')
        .update({
          dish_map: {
            ...setting.dish_map,
            [req.body.itemRef]: menu.id,
          },
        })
        .eq('restaurant_id', restaurantId)
      );
    } else if (action === 'rule') {
      const rule = check(await db
        .from('pos_usage_rules')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('context_key', req.body.contextKey)
        .single()
      );

      const catalog = await allRows(() => db
        .from('ingredients')
        .select('id,name,unit')
        .eq('restaurant_id', restaurantId)
        .order('id')
      );

      if (!Array.isArray(req.body.portions)) {
        throw new Error('Missing portions');
      }

      const portions = new Map();

      for (const portion of req.body.portions) {
        const ingredient = catalog.find((candidate) =>
          candidate.id === portion.id
        );

        if (
          !ingredient ||
          portions.has(portion.id) ||
          !Number.isFinite(portion.quantity) ||
          portion.quantity < 0
        ) {
          throw new Error('Invalid portion');
        }

        portions.set(portion.id, {
          ...portion,
          unit: ingredient.unit,
        });
      }

      const operations = rule.context.recipe
        .filter((part) => !portions.has(part.id))
        .map((part) => ({
          action: 'remove',
          ingredient_id: part.id,
        }));

      for (const portion of portions.values()) {
        operations.push({
          action: 'set',
          ingredient_id: portion.id,
          quantity: portion.quantity,
          unit: portion.unit,
          basis: 'configured',
          reason: 'Admin configured portion',
        });
      }

      const plan = {
        operations,
        unresolved: [],
        explanation: 'Admin configured per-dish quantities',
      };

      applyPlan(
        rule.context.recipe,
        plan,
        catalog,
        convertQuantity
      );

      check(await db
        .from('pos_usage_rules')
        .update({ plan, origin: 'admin' })
        .eq('restaurant_id', restaurantId)
        .eq('context_key', req.body.contextKey)
      );

    } else if (action === 'enable') {
      check(await db
        .from('pos_usage_settings')
        .update({ enabled: true })
        .eq('restaurant_id', restaurantId)
      );

      // The worker prepares and applies valid servings automatically.
    } else if (action === 'disable') {
      check(await db
        .from('pos_usage_settings')
        .update({ enabled: false })
        .eq('restaurant_id', restaurantId)
      );

      await rebuildCurrentInventory(db, restaurantId);
    } else {
      throw new Error('Unknown action');
    }

    let usage = null;

    if (action !== 'disable') {
      try {
        usage = await runUsage(db, restaurantId);
      } catch (error) {
        // The correction is already saved.
        // Do not tell the user to save it again.
        usage = { error: error.message };
      }
    }

    return res.json({ ok: true, usage });
  } catch (error) {
    return res.status(400).json({
      error: error.message,
    });
  }
});