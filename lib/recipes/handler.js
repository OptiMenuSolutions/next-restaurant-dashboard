import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { verifyRestaurantAccess } from '../withRestaurantAuth';
import { requireActiveSubscription } from '../requireActiveSubscription';
import { fetchAll } from '../admin/fetchAll';
import { processInvoiceCalculations } from '../admin/processInvoiceCalculations';
import { compile, normalizeUnit } from './compile';
import { recipeAI, readRecipeDocument } from './ai';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const types = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

const checked = result => {
  if (result.error) throw result.error;
  return result.data;
};

const blank = () => ({
  yield_quantity: '',
  yield_unit: 'oz',
  lines: [],
});

const copy = value => JSON.parse(JSON.stringify(value));
const clean = value => String(value || '').trim().slice(0, 500);

function definition(value, ingredients, nodes) {
  if (
    !value ||
    !Array.isArray(value.lines) ||
    value.lines.length > 300
  ) {
    throw new Error('Invalid recipe lines.');
  }

  return {
    yield_quantity: value.yield_quantity ?? '',
    yield_unit: normalizeUnit(clean(value.yield_unit)) || 'oz',
    lines: value.lines.map(line => {
      if (
        line.ingredient_id &&
        !ingredients.some(i => i.id === line.ingredient_id)
      ) {
        throw new Error('Ingredient is not in this restaurant.');
      }

      if (
        line.prep_id &&
        !nodes.some(n => n.id === line.prep_id && n.kind === 'prep')
      ) {
        throw new Error('Batch recipe not found.');
      }

      const ingredient = ingredients.find(
        i => i.id === line.ingredient_id
      );

      return {
        ingredient_id: line.ingredient_id || null,
        prep_id: line.prep_id || null,
        name: ingredient?.name || clean(line.name),
        component: clean(line.component || 'Recipe'),
        quantity: line.quantity ?? '',
        unit: normalizeUnit(clean(line.unit)),
      };
    }),
  };
}

function depends(nodes, node, changed, seen = new Set()) {
  if (changed.has(node.id)) return true;
  if (seen.has(node.id)) return false;

  seen.add(node.id);

  return (node.published?.lines || []).some(line => {
    const prep = nodes.find(n => n.id === line.prep_id);
    return prep && depends(nodes, prep, changed, seen);
  });
}

async function loadWorkspace(rid) {
  const [saved, catalog, ingredients] = await Promise.all([
    db.from('recipe_workspaces')
      .select('*')
      .eq('restaurant_id', rid)
      .maybeSingle()
      .then(checked),

    db.rpc('recipe_setup_catalog', {
      p_restaurant: rid,
    }).then(checked),

    fetchAll(() =>
      db.from('ingredients')
        .select('id,name,unit')
        .eq('restaurant_id', rid)
        .order('id')
    ),
  ]);

  const revision = saved?.revision || 0;
  const state = copy(saved?.state || {
    nodes: [],
    method: null,
    imports: [],
  });

  const activeIds = new Set(catalog.map(dish => dish.id));

  state.nodes = state.nodes.filter(
    node => node.kind === 'prep' || activeIds.has(node.id)
  );

  for (const dish of catalog) {
    if (state.nodes.some(n => n.id === dish.id)) {
      const existing = state.nodes.find(n => n.id === dish.id);
      if (!existing.hash) existing.hash = dish.hash;
      continue;
    }

    const draft = {
      ...blank(),
      lines: dish.lines,
    };

    state.nodes.push({
      ...dish,
      kind: 'dish',
      draft,
      published: dish.lines.length ? copy(draft) : null,
      status: 'existing',
    });
  }

  return { revision, state, catalog, ingredients };
}

// Dishes OptiMenu still needs to draft. Ones it already failed on are left
// for the setup call, so the background pass can't loop on them.
const draftTargets = (state, limit = Infinity) => state.nodes.filter(
  n =>
    n.kind === 'dish' &&
    !n.draft.lines.length &&
    !n.published &&
    !n.assist_failed
).slice(0, limit);

const skeletonTargets = state => state.nodes.filter(
  n =>
    n.kind === 'dish' &&
    !n.draft.lines.length &&
    !n.published &&
    !n.skeleton_empty
);

function draftsFor(targets, state, ingredients) {
  return recipeAI('assist', {
    dishes: targets.map(n => ({
      id: n.id,
      name: n.name,
      description: n.description,
      category: n.category,
    })),
    ingredients,
    preps: state.nodes
      .filter(n => n.kind === 'prep' && n.published)
      .map(n => ({
        id: n.id,
        name: n.name,
        yield_quantity: n.published.yield_quantity,
        yield_unit: n.published.yield_unit,
      })),
  });
}

async function assistDishes(state, ingredients, changed) {
  const targets = draftTargets(state, 4);

  if (!targets.length) return 0;

  const items = await draftsFor(targets, state, ingredients);

  for (const target of targets) {
    const item = items.find(value => value.id === target.id);

    if (!item?.draft?.lines?.length) {
      console.error('[recipe-assist] no draft for', target.name, {
        asked: target.id,
        returned: (items || []).map(value => value?.id),
        lines: item?.draft?.lines?.length || 0,
      });
      target.assist_failed = true;
      target.notes = 'OptiMenu could not draft this dish. Cover it on the setup call.';
      continue;
    }

    try {
      target.draft = definition(item.draft, ingredients, state.nodes);
    } catch (error) {
      target.assist_failed = true;
      target.notes = `OptiMenu could not draft this dish. ${error.message}`;
      continue;
    }

    target.notes = clean(item.notes);
    target.status = 'estimated';
    target.published = copy(target.draft);

    try {
      compile(state.nodes, target.id);
      changed.add(target.id);
    } catch (error) {
      target.published = null;
      target.status = 'draft';
      target.notes += ` ${error.message}`;
    }
  }

  return targets.length;
}

async function saveWorkspace(rid, revision, state, changed, actor) {
  const publish = state.nodes
    .filter(
      n =>
        n.kind === 'dish' &&
        n.published &&
        depends(state.nodes, n, changed)
    )
    .map(n => ({
      id: n.id,
      hash: n.hash || null,
      lines: compile(state.nodes, n.id),
    }));

  const result = checked(await db.rpc('save_recipe_workspace', {
    p_restaurant: rid,
    p_revision: revision,
    p_state: state,
    p_publish: publish,
    p_actor: actor,
  }));

  if (publish.length) {
    try {
      waitUntil(
        processInvoiceCalculations(db, rid).catch(error => {
          console.error('[recipe-calculations]', error.message);
        })
      );
    } catch (error) {
      console.error('[recipe-calculations:queued]', error.message);
    }
  }

  return result;
}

// Runs after the owner picks Work with OptiMenu. Drafts 4 dishes at a time
// and saves after each batch, so the owner can move on right away.
async function draftInBackground(rid, actor) {
  for (let round = 0; round < 15; round += 1) {
    const { revision, state, ingredients } = await loadWorkspace(rid);

    if (state.method !== 'assisted') return;

    const changed = new Set();

    if (!(await assistDishes(state, ingredients, changed))) return;

    try {
      await saveWorkspace(rid, revision, state, changed, actor);
    } catch (error) {
      // Someone saved at the same moment. Reload and try the next batch.
      if (!/changed in another window/i.test(error.message || '')) throw error;
    }
  }
}

export async function recipeSetupHandler(req, res, admin = null) {
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rid = req.method === 'GET'
    ? req.query.restaurant_id
    : req.body?.restaurant_id;

  if (!uuid.test(String(rid || ''))) {
    return res.status(400).json({ error: 'Choose a restaurant.' });
  }

  const auth = admin || await verifyRestaurantAccess(req, rid);

  if (auth.error) {
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    const { revision, state, catalog, ingredients } = await loadWorkspace(rid);

    const response = result => ({
      ...result,
      ingredients,
      remaining: result.state.nodes.filter(
        n =>
          n.kind === 'dish' &&
          !n.draft.lines.length &&
          !n.published
      ).length,
      draftLeft: draftTargets(result.state).length,
      skeletonLeft: skeletonTargets(result.state).length,
    });

    if (req.method === 'GET') {
      return res.json(response({ state, revision }));
    }

    const b = req.body;

    if (Number(b.revision) !== Number(revision)) {
      throw new Error(
        'Recipes changed in another window. Reload before saving.'
      );
    }

    const changed = new Set();
    let startDrafting = false;

    if (
      ['sign', 'import', 'assist', 'skeleton'].includes(b.action) ||
      (b.action === 'method' && b.method === 'assisted')
    ) {
      const subscription = await requireActiveSubscription(db, rid);

      if (subscription.error) {
        return res.status(subscription.status).json({
          error: subscription.error,
        });
      }
    }

    if (b.action === 'sign') {
      if (
        !types[b.mime] ||
        !(Number(b.size) > 0 && Number(b.size) <= 20971520)
      ) {
        throw new Error(
          'Use PDF, JPG, PNG, WEBP, TXT or CSV, up to 20 MB.'
        );
      }

      const path = `${rid}/${randomUUID()}.${types[b.mime]}`;
      const signed = checked(
        await db.storage.from('recipe-books').createSignedUploadUrl(path)
      );

      state.imports.push({
        path,
        name: clean(b.name),
        items: [],
        parsed: false,
      });

      const result = checked(await db.rpc('save_recipe_workspace', {
        p_restaurant: rid,
        p_revision: revision,
        p_state: state,
        p_publish: [],
        p_actor: auth.user.id,
      }));

      return res.json({
        ...response(result),
        path,
        token: signed.token,
      });
    } else if (b.action === 'method') {
      if (!['upload', 'assisted', 'manual'].includes(b.method)) {
        throw new Error('Choose a recipe setup method.');
      }

      state.method = b.method;

      if (b.method === 'assisted') {
        state.assistance = 'requested';
        startDrafting = true;
      }

      if (b.method === 'manual' && ['skeleton', 'blank'].includes(b.build)) {
        state.build = b.build;
      }
    } else if (b.action === 'catalog') {
      if (!Array.isArray(b.items) || b.items.length > 1000) {
        throw new Error('Invalid menu.');
      }

      for (const item of b.items) {
        if (!clean(item.name)) {
          throw new Error('A menu item has no name.');
        }

        const key = [
          item.name,
          item.section,
          item.category,
          item.description,
          item.price,
        ].map(clean).join('|').toLowerCase();

        if (state.nodes.some(n => n.catalog_key === key)) continue;

        const price = item.price == null ? null : Number(item.price);

        if (
          price !== null &&
          (!Number.isFinite(price) || price < 0)
        ) {
          throw new Error('Invalid menu price.');
        }

        state.nodes.push({
          id: randomUUID(),
          kind: 'dish',
          name: clean(item.name),
          price,
          category: clean(item.category),
          section: clean(item.section),
          description: clean(item.description),
          catalog_key: key,
          draft: blank(),
          published: null,
          status: 'draft',
        });
      }
    } else if (b.action === 'save' || b.action === 'confirm') {
      let node = state.nodes.find(n => n.id === b.node?.id);

      if (!node) {
        if (b.node?.kind !== 'prep') {
          throw new Error('Dish not found. Reload the menu.');
        }

        node = {
          id: randomUUID(),
          kind: 'prep',
          published: null,
        };

        state.nodes.push(node);
      }

      node.name = clean(b.node.name);

      if (!node.name) {
        throw new Error('Give this recipe a name.');
      }

      node.notes = clean(b.node.notes);
      node.draft = definition(b.node.draft, ingredients, state.nodes);
      node.status = 'draft';

      if (b.action === 'confirm') {
        node.published = copy(node.draft);
        compile(state.nodes, node.id);
        node.status = 'confirmed';
        changed.add(node.id);
      }
    } else if (b.action === 'refresh') {
      const node = state.nodes.find(n => n.id === b.id);
      const current = catalog.find(n => n.id === b.id);

      if (!node || !current) {
        throw new Error('Current dish recipe not found.');
      }

      Object.assign(node, {
        hash: current.hash,
        draft: { ...blank(), lines: current.lines },
        published: current.lines.length
          ? { ...blank(), lines: current.lines }
          : null,
        status: 'existing',
      });
    } else if (b.action === 'import') {
      if (
        !String(b.path).startsWith(`${rid}/`) ||
        !/^[-a-z0-9/]+\.(pdf|jpg|png|webp|txt|csv)$/i.test(b.path)
      ) {
        throw new Error('Invalid upload path.');
      }

      if (
        state.imports.some(entry => entry.path === b.path && entry.parsed)
      ) {
        return res.json(response({ state, revision }));
      }

      const file = checked(
        await db.storage.from('recipe-books').download(b.path)
      );

      if (file.size > 20971520) {
        throw new Error('Document exceeds 20 MB.');
      }

      const mime = Object.keys(types).find(
        type => types[type] === b.path.split('.').pop()
      );

      const text = await readRecipeDocument(
        Buffer.from(await file.arrayBuffer()),
        mime
      );

      if (text.length > 120000) {
        throw new Error(
          'Please split this recipe book into smaller files.'
        );
      }

      const items = await recipeAI('import', {
        text,
        preps: state.nodes
          .filter(n => n.kind === 'prep')
          .map(n => ({ id: n.id, name: n.name })),
      });

      const entry = state.imports.find(file => file.path === b.path);

      if (!entry) {
        throw new Error('Upload was not registered in this workspace.');
      }

      entry.items = items.map(item => ({
        ...item,
        id: randomUUID(),
      }));
      entry.parsed = true;

      // Save anything that matches by exact name. Batch preps go first so
      // dish lines can link to them. Confirmed recipes are never replaced.
      const norm = value => clean(value).toLowerCase().replace(/\s+/g, ' ');
      const adopted = [];
      const created = new Set();
      let linked = 0;

      for (const item of entry.items.filter(i => i.kind === 'prep')) {
        let node = state.nodes.find(
          n => n.kind === 'prep' && norm(n.name) === norm(item.name)
        );

        if (node && (node.status === 'confirmed' || node.draft.lines.length)) {
          continue;
        }

        if (!node) {
          node = {
            id: randomUUID(),
            kind: 'prep',
            name: clean(item.name),
            published: null,
            draft: blank(),
          };
          state.nodes.push(node);
          created.add(node.id);
        }

        adopted.push([item, node]);
      }

      for (const item of entry.items.filter(i => i.kind !== 'prep')) {
        const matches = state.nodes.filter(
          n => n.kind === 'dish' && norm(n.name) === norm(item.name)
        );

        if (matches.length !== 1) continue;

        const node = matches[0];

        if (node.status === 'confirmed' || node.draft.lines.length) continue;

        adopted.push([item, node]);
      }

      for (const [item, node] of adopted) {
        const lines = (item.draft?.lines || []).map(raw => {
          // The reader sometimes invents ids. Keep only ones that exist here,
          // and match everything else by name.
          const line = {
            ...raw,
            prep_id: state.nodes.some(n => n.id === raw.prep_id && n.kind === 'prep') ? raw.prep_id : null,
            ingredient_id: ingredients.some(i => i.id === raw.ingredient_id) ? raw.ingredient_id : null,
          };

          if (line.prep_id || line.ingredient_id) return line;

          const prep = state.nodes.find(
            n =>
              n.kind === 'prep' &&
              n.id !== node.id &&
              norm(n.name) === norm(line.name)
          );

          if (!prep) return line;

          linked += 1;
          return { ...line, prep_id: prep.id, component: line.component || prep.name };
        });

        try {
          node.draft = definition({ ...blank(), ...item.draft, lines }, ingredients, state.nodes);
        } catch (error) {
          item.error = error.message;
          console.error('[recipe-import] could not save', item.name, error.message);
          if (created.has(node.id)) {
            state.nodes = state.nodes.filter(n => n.id !== node.id);
          }
          continue;
        }

        node.status = 'draft';
        node.notes = clean(item.notes);
        item.adopted = node.id;

        // Put it to use right away so costs and the dashboard use it while
        // OptiMenu checks it. Anything incomplete, like a batch with no
        // yield, stays a draft.
        node.published = copy(node.draft);

        try {
          compile(state.nodes, node.id);
          node.status = 'imported';
          changed.add(node.id);
        } catch {
          node.published = null;
        }
      }

      const saved = adopted.filter(([item]) => item.adopted);

      entry.summary = {
        preps: saved.filter(([, node]) => node.kind === 'prep').length,
        dishes: saved.filter(([, node]) => node.kind === 'dish').length,
        linked,
        review: saved.filter(([, node]) =>
          (node.kind === 'prep' && !(Number(node.draft.yield_quantity) > 0)) ||
          node.draft.lines.some(line => !(Number(line.quantity) > 0))
        ).length,
      };

      // OptiMenu checks every owner upload, so open the setup ticket.
      if (!admin) state.assistance = 'requested';
    } else if (b.action === 'adopt') {
      const entry = state.imports.find(file => file.path === b.path);

      const item = entry?.items.find(
        value => value.id === b.item_id && !value.adopted
      );

      if (!item) {
        throw new Error(
          'This imported recipe was already saved or was not found.'
        );
      }

      let node = state.nodes.find(n => n.id === b.target);

      if (b.target === 'new-prep') {
        node = {
          id: randomUUID(),
          kind: 'prep',
          name: clean(item.name),
          published: null,
          draft: blank(),
        };
        state.nodes.push(node);
      }

      if (!node) {
        throw new Error('Choose the dish or batch for this recipe.');
      }

      if (node.draft.lines.length && !b.replace) {
        throw new Error(
          'This recipe already has a draft. Confirm replacement first.'
        );
      }

      node.draft = definition(item.draft, ingredients, state.nodes);
      node.status = 'draft';
      node.notes = clean(item.notes);
      item.adopted = node.id;
    } else if (b.action === 'assist') {
      if (state.method !== 'assisted' && !admin) {
        throw new Error('Choose kitchen assistance first.');
      }

      if (!(await assistDishes(state, ingredients, changed))) {
        return res.json(response({ state, revision }));
      }
    } else if (b.action === 'skeleton') {
      const targets = skeletonTargets(state).slice(0, 6);

      if (!targets.length) {
        return res.json(response({ state, revision }));
      }

      const items = await draftsFor(targets, state, ingredients);

      for (const target of targets) {
        const item = items.find(value => value.id === target.id);
        const lines = (item?.draft?.lines || []).map(line => ({
          ...line,
          quantity: '',
        }));

        if (!lines.length) {
          target.skeleton_empty = true;
          continue;
        }

        try {
          target.draft = definition({ ...blank(), lines }, ingredients, state.nodes);
        } catch {
          target.skeleton_empty = true;
          continue;
        }

        target.status = 'skeleton';
        target.notes = 'Built from your menu. Add every amount, then confirm.';
      }
    } else if (b.action === 'complete' && admin) {
      state.assistance = 'complete';
    } else {
      throw new Error('Unknown recipe action.');
    }

    const result = await saveWorkspace(rid, revision, state, changed, auth.user.id);

    if (startDrafting) {
      try {
        waitUntil(
          draftInBackground(rid, auth.user.id).catch(error => {
            console.error('[recipe-drafting]', error.message);
          })
        );
      } catch (error) {
        console.error('[recipe-drafting:queued]', error.message);
      }
    }

    return res.json(response(result));
  } catch (error) {
    console.error('[recipe-setup]', error.message);

    return res.status(400).json({
      error:
        error.message ||
        'Could not save the recipe. Your edits remain on screen.',
    });
  }
}