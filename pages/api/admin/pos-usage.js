import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { recipeAI } from '../../../lib/recipes/ai';
import { compile, normalizeUnit, UNITS } from '../../../lib/recipes/compile';
import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { allRows } from '../../../lib/pos/usageServer';
import { runUsage } from '../../../lib/pos/runUsage';
import { adjustRecipe, inventoryPortions } from '../../../lib/pos/usageRecipe';
import { transferPlan } from '../../../lib/pos/transferPlan';
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

// Recipe lines from Claude or the admin, checked against this restaurant.
// strict: every line must be one of its ingredients or batch preps, with
// an amount and a unit.
function draftLines(input, state, catalog, strict) {
  if (!Array.isArray(input) || input.length > 60) {
    throw new Error('Invalid recipe lines');
  }

  const byName = new Map(catalog.map((row) => [
    String(row.name || '').trim().toLowerCase(),
    row,
  ]));
  const preps = (state.nodes || []).filter((node) =>
    node.kind === 'prep' && node.published
  );

  return input.map((raw) => {
    const prep = preps.find((node) => node.id === raw.prep_id);
    const ingredient = prep
      ? null
      : catalog.find((row) => row.id === raw.ingredient_id) ||
        byName.get(String(raw.name || '').trim().toLowerCase());
    const unit = normalizeUnit(raw.unit);
    const quantity = Number(raw.quantity);
    const label = prep?.name || ingredient?.name || raw.name || 'a line';

    if (strict) {
      if (!prep && !ingredient) {
        throw new Error(`Pick one of your ingredients for ${label}`);
      }
      if (!(quantity > 0)) throw new Error(`Enter an amount for ${label}`);
      if (!UNITS.includes(unit)) throw new Error(`Choose a unit for ${label}`);
    }

    return {
      ingredient_id: ingredient?.id || null,
      prep_id: prep?.id || null,
      name: prep?.name || ingredient?.name ||
        String(raw.name || '').trim().slice(0, 200),
      component: String(raw.component || 'Recipe').trim().slice(0, 200) || 'Recipe',
      quantity: quantity > 0 ? quantity : '',
      unit: UNITS.includes(unit) ? unit : '',
    };
  });
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
      const [settings, result, menus, ingredients, job, buttons, workspace] =
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
          allRows(() => db
            .from('pos_menu_items')
            .select('id,external_id,name,price,category_name,first_seen_at')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .is('removed_at', null)
            .is('menu_item_id', null)
            .order('id')
          ),
          db
            .from('recipe_workspaces')
            .select('state')
            .eq('restaurant_id', restaurantId)
            .maybeSingle(),
        ]);

      const dishMap = check(settings)?.dish_map || {};
      const sold = new Set(
        (check(result)?.report || []).map((row) => String(row.item_ref))
      );
      const names = new Set(
        menus.map((menu) => String(menu.name || '').trim().toLowerCase())
      );

      // POS buttons with no dish that have not sold yet. Sold ones already
      // show as Which dish is this.
      const newButtons = buttons.filter((button) =>
        button.name &&
        !dishMap[button.external_id] &&
        !sold.has(String(button.external_id)) &&
        !names.has(button.name.trim().toLowerCase())
      );

      const preps = (check(workspace)?.state?.nodes || [])
        .filter((node) => node.kind === 'prep' && node.published)
        .map((node) => ({
          id: node.id,
          name: node.name,
          yield_unit: node.published.yield_unit,
        }));

      return res.json({
        settings: check(settings),
        result: check(result),
        job: check(job),
        menus,
        ingredients,
        newButtons,
        preps,
      });
    }

    const action = req.body.action;
    let savedPlan = null;

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
    } else if (action === 'conversion') {
      check(await db.rpc('save_pos_conversion', {
        p_restaurant_id: restaurantId,
        p_ingredient_id: req.body.ingredientId,
        p_from: String(req.body.fromUnit || '').trim().toLowerCase(),
        p_to: String(req.body.toUnit || '').trim().toLowerCase(),
        p_factor: req.body.factor,
        p_basis: req.body.basis,
        p_evidence: req.body.evidence,
      }));
    } else if (action === 'conversions') {
      const list = req.body.conversions;

      if (!Array.isArray(list) || !list.length || list.length > 25) {
        throw new Error('Add at least one conversion');
      }

      // Saved one by one; usage recalculates once below.
      for (const item of list) {
        check(await db.rpc('save_pos_conversion', {
          p_restaurant_id: restaurantId,
          p_ingredient_id: item.ingredientId,
          p_from: String(item.fromUnit || '').trim().toLowerCase(),
          p_to: String(item.toUnit || '').trim().toLowerCase(),
          p_factor: item.factor,
          p_basis: item.basis,
          p_evidence: item.evidence,
        }));
      }
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
        replace_all: true,
        operations: operations.filter((operation) =>
          operation.action === 'set'
        ),
        unresolved: [],
        explanation: 'Admin confirmed complete per-dish quantities',
      };

      inventoryPortions(adjustRecipe([], plan, catalog), catalog);

      check(await db
        .from('pos_usage_rules')
        .update({ plan, origin: 'admin' })
        .eq('restaurant_id', restaurantId)
        .eq('context_key', req.body.contextKey)
      );

      savedPlan = plan;

    } else if (action === 'confirm') {
      const rule = check(await db
        .from('pos_usage_rules')
        .select('plan')
        .eq('restaurant_id', restaurantId)
        .eq('context_key', req.body.contextKey)
        .single()
      );

      if (
        rule.plan?.pending ||
        !Array.isArray(rule.plan?.operations) ||
        rule.plan?.unresolved?.length
      ) {
        throw new Error('This dish still needs portions entered');
      }

      // Same plan, now owned by the admin: never asked again or overwritten.
      check(await db
        .from('pos_usage_rules')
        .update({ origin: 'admin' })
        .eq('restaurant_id', restaurantId)
        .eq('context_key', req.body.contextKey)
      );

      check(await db.rpc('enqueue_pos_usage', {
        p_restaurant_id: restaurantId,
      }));

      savedPlan = rule.plan;
    } else if (action === 'apply') {
      const keys = req.body.targetKeys;

      if (!Array.isArray(keys) || !keys.length || keys.length > 25) {
        throw new Error('Choose at least one dish');
      }

      const source = check(await db
        .from('pos_usage_rules')
        .select('plan,context,origin')
        .eq('restaurant_id', restaurantId)
        .eq('context_key', req.body.sourceKey)
        .single()
      );

      if (source.origin !== 'admin') {
        throw new Error('Save this dish first');
      }

      const catalog = await allRows(() => db
        .from('ingredients')
        .select('id,name,unit')
        .eq('restaurant_id', restaurantId)
        .order('id')
      );

      // Check every dish before saving any, so nothing is half applied.
      const updates = [];

      for (const key of keys) {
        const target = check(await db
          .from('pos_usage_rules')
          .select('context')
          .eq('restaurant_id', restaurantId)
          .eq('context_key', key)
          .single()
        );

        const recipe = target.context?.recipe || [];
        const plan = transferPlan(
          source.plan,
          source.context?.recipe || [],
          recipe
        );

        if (!plan) {
          throw new Error(
            `This change does not fit ${target.context?.dish || 'one of the dishes'}`
          );
        }

        adjustRecipe(recipe, plan, catalog);
        updates.push({ key, plan });
      }

      for (const { key, plan } of updates) {
        check(await db
          .from('pos_usage_rules')
          .update({ plan, origin: 'admin' })
          .eq('restaurant_id', restaurantId)
          .eq('context_key', key)
        );
      }

      check(await db.rpc('enqueue_pos_usage', {
        p_restaurant_id: restaurantId,
      }));
    } else if (action === 'draft-dish') {
      const name = String(req.body.name || '').trim().slice(0, 200);

      if (!name) throw new Error('Give the dish a name');

      const [workspace, catalog] = await Promise.all([
        db
          .from('recipe_workspaces')
          .select('state')
          .eq('restaurant_id', restaurantId)
          .maybeSingle()
          .then(check),
        allRows(() => db
          .from('ingredients')
          .select('id,name,unit')
          .eq('restaurant_id', restaurantId)
          .order('id')
        ),
      ]);

      const state = workspace?.state || { nodes: [] };
      const items = await recipeAI('assist', {
        dishes: [{
          id: 'new-dish',
          name,
          description: '',
          category: String(req.body.category || ''),
        }],
        ingredients: catalog,
        preps: (state.nodes || [])
          .filter((node) => node.kind === 'prep' && node.published)
          .map((node) => ({
            id: node.id,
            name: node.name,
            yield_quantity: node.published.yield_quantity,
            yield_unit: node.published.yield_unit,
          })),
      });

      const item = items.find((value) => value?.draft?.lines?.length) || items[0];

      // A draft only: nothing is saved until the admin approves it.
      return res.json({
        lines: draftLines(item?.draft?.lines || [], state, catalog, false),
        notes: String(item?.notes || '').slice(0, 500),
      });
    } else if (action === 'add-dish') {
      const name = String(req.body.name || '').trim().slice(0, 200);
      const itemRef = String(req.body.itemRef || '');

      if (!name) throw new Error('Give the dish a name');
      if (!itemRef) throw new Error('Missing POS item reference');

      const [workspace, catalog] = await Promise.all([
        db
          .from('recipe_workspaces')
          .select('revision,state')
          .eq('restaurant_id', restaurantId)
          .maybeSingle()
          .then(check),
        allRows(() => db
          .from('ingredients')
          .select('id,name,unit')
          .eq('restaurant_id', restaurantId)
          .order('id')
        ),
      ]);

      const state = workspace?.state || { nodes: [], method: null, imports: [] };
      if (!Array.isArray(state.nodes)) state.nodes = [];

      const lines = draftLines(req.body.lines, state, catalog, true);

      if (!lines.length) throw new Error('Add at least one ingredient');

      const price = req.body.price === null || req.body.price === '' ||
        !Number.isFinite(Number(req.body.price))
        ? null
        : Number(req.body.price);

      const id = randomUUID();
      const node = {
        id,
        kind: 'dish',
        name,
        price,
        category: String(req.body.category || '').trim().slice(0, 200),
        section: '',
        description: '',
        draft: { yield_quantity: '', yield_unit: 'oz', lines },
        published: null,
        // Same as any OptiMenu estimate: off costs until confirmed.
        status: 'estimated',
        source: 'optimenu',
        pos_draft: true,
        pos_item_ref: itemRef,
        notes: String(req.body.notes || '').trim().slice(0, 500) ||
          'Drafted by OptiMenu from a new POS button. Check the amounts, then confirm.',
      };

      // The draft must work exactly as it will once confirmed.
      compile([...state.nodes, { ...node, published: node.draft }], id);
      state.nodes.push(node);

      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const who = token ? (await db.auth.getUser(token)).data : null;

      check(await db.rpc('save_recipe_workspace', {
        p_restaurant: restaurantId,
        p_revision: workspace?.revision || 0,
        p_state: state,
        p_publish: [],
        p_actor: who?.user?.id || null,
      }));

      const setting = check(await db
        .from('pos_usage_settings')
        .select('dish_map')
        .eq('restaurant_id', restaurantId)
        .single()
      );

      check(await db
        .from('pos_usage_settings')
        .update({ dish_map: { ...setting.dish_map, [itemRef]: id } })
        .eq('restaurant_id', restaurantId)
      );

      await db
        .from('pos_menu_items')
        .update({ menu_item_id: id })
        .eq('restaurant_id', restaurantId)
        .eq('external_id', itemRef)
        .is('menu_item_id', null);

      // Tell the owner, the same way other owner notifications reach them.
      const owners = check(await db
        .from('profiles')
        .select('id,role')
        .eq('restaurant_id', restaurantId)
      ).filter((profile) => profile.role !== 'admin');

      if (owners.length) {
        check(await db.from('notifications').insert(owners.map((owner) => ({
          user_id: owner.id,
          restaurant_id: restaurantId,
          kind: 'recipe_review',
          title: 'Check a new dish recipe',
          body: `${name} is new on your POS, so OptiMenu drafted its recipe. ` +
            'Check the amounts and confirm it to put it in use.',
          href: `/client/recipes?recipe=${id}`,
          event_key: `recipe-review:${id}:${owner.id}`,
        }))));
      }

      check(await db.rpc('enqueue_pos_usage', {
        p_restaurant_id: restaurantId,
      }));
    } else if (action === 'note') {
      const text = String(req.body.note || '').trim().slice(0, 1000);

      if (!text) throw new Error('Write a note first');

      const restaurant = check(await db
        .from('restaurants')
        .select('name')
        .eq('id', restaurantId)
        .single()
      );

      check(await db.from('admin_tickets').insert({
        kind: 'NOTE',
        title: `POS button · ${String(req.body.name || 'Unknown').slice(0, 120)} · ` +
          (restaurant?.name || 'Restaurant'),
        meta: text,
        status: 'open',
        source_at: new Date().toISOString(),
        restaurant_id: restaurantId,
        href: `/admin/pos-usage?restaurant=${restaurantId}`,
        action: 'Review',
      }));

      return res.json({ ok: true, usage: null, plan: null });
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

    return res.json({ ok: true, usage, plan: savedPlan });
  } catch (error) {
    return res.status(400).json({
      error: error.message,
    });
  }
});