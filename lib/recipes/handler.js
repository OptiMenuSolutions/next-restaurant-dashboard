import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { verifyRestaurantAccess } from '../withRestaurantAuth';
import { requireActiveSubscription } from '../requireActiveSubscription';
import { fetchAll } from '../admin/fetchAll';
import { processInvoiceCalculations } from '../admin/processInvoiceCalculations';
import { compile, normalizeUnit } from './compile';
import { recipeAI, readRecipeDocument } from './ai';
import { matchLines } from './match';

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

// OptiMenu's recipe template, one row per ingredient line.
const TEMPLATE_HEADERS = [
  'recipe type', 'recipe name', 'batch yield', 'yield unit', 'part of plate',
  'ingredient or batch prep', 'quantity', 'unit', 'notes',
];

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter(r => r.some(value => value.trim()));
}

// Recipes from the template, in the same shape the AI reader returns.
// Returns null when the file is not in the template, so it falls back.
function templateRecipes(buffer) {
  const rows = csvRows(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  const header = (rows.shift() || []).map(value => value.trim().toLowerCase());

  if (TEMPLATE_HEADERS.some((name, i) => header[i] !== name)) return null;

  const recipes = new Map();

  for (const cells of rows) {
    const [type, name, yieldQty, yieldUnit, part, ingredient, qty, unit, notes] =
      TEMPLATE_HEADERS.map((_, i) => String(cells[i] || '').trim());

    if (!name || !ingredient) continue;

    const kind = /batch|prep/i.test(type) ? 'prep' : 'dish';
    const key = `${kind}|${name.toLowerCase()}`;

    if (!recipes.has(key)) {
      recipes.set(key, {
        kind,
        name,
        notes: '',
        draft: {
          yield_quantity: kind === 'prep' && Number(yieldQty) > 0 ? Number(yieldQty) : '',
          yield_unit: kind === 'prep' ? yieldUnit || 'oz' : 'oz',
          lines: [],
        },
      });
    }

    const recipe = recipes.get(key);

    recipe.draft.lines.push({
      name: ingredient,
      component: part || (kind === 'prep' ? name : 'Recipe'),
      quantity: Number(qty) > 0 ? Number(qty) : '',
      unit,
    });

    if (notes && !/^batch prep:/i.test(notes)) {
      recipe.notes = [recipe.notes, notes].filter(Boolean).join(' ');
    }
  }

  return recipes.size ? [...recipes.values()] : null;
}

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

  // Recipes saved before sources were tracked: uploads are the nodes an
  // import adopted, and estimates came from OptiMenu.
  for (const entry of state.imports || []) {
    for (const item of entry.items || []) {
      const node = item.adopted && state.nodes.find(n => n.id === item.adopted);
      if (node && !node.source) node.source = 'upload';
    }
  }

  for (const node of state.nodes) {
    if (!node.source && node.status === 'estimated') node.source = 'optimenu';
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

// Find the drafted recipe for a dish: by id, or by name if the id came back different.
const matchDraft = (items, target) =>
  items.find(value => value.id === target.id) ||
  items.find(value =>
    String(value.name || '').trim().toLowerCase() ===
    String(target.name || '').trim().toLowerCase()
  );

// Drop ids that don't exist in this restaurant, so the line is matched by name instead.
const realIds = (line, state, ingredients) => ({
  ...line,
  prep_id: state.nodes.some(n => n.id === line.prep_id && n.kind === 'prep') ? line.prep_id : null,
  ingredient_id: ingredients.some(i => i.id === line.ingredient_id) ? line.ingredient_id : null,
});

function draftsFor(targets, state, ingredients, task = 'assist') {
  return recipeAI(task, {
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

// Owner uploads go into use as soon as nothing is holding them. Repeats so
// a batch going into use also releases the dishes that use it. Returns the
// names it released.
function releaseUploads(state, changed) {
  const names = [];
  let progress = true;

  while (progress) {
    progress = false;

    for (const node of state.nodes) {
      if (node.source !== 'upload' || node.published || !node.draft?.lines?.length) continue;

      node.published = copy(node.draft);

      try {
        compile(state.nodes, node.id);
        node.status = 'imported';
        changed.add(node.id);
        names.push(node.name);
        progress = true;
      } catch {
        node.published = null;
      }
    }
  }

  return names;
}

// Why each owner upload isn't in use yet, for the admin approve queue.
function uploadHolds(state) {
  const nodes = copy(state.nodes);
  const holds = {};

  for (const node of nodes) {
    if (node.source !== 'upload' || node.published || !node.draft?.lines?.length) continue;

    node.published = copy(node.draft);

    try {
      compile(nodes, node.id);
    } catch (error) {
      holds[node.id] = error.message;
    }

    node.published = null;
  }

  return holds;
}

// What confirming a node would put into use: the node itself plus every
// owner upload that was only waiting on it. Works on a copy.
function releaseSet(state, node, ingredients) {
  const trial = copy(state.nodes);
  let target = trial.find(n => n.id === node?.id);

  if (!target) {
    target = { ...copy(node || {}), id: '__new', kind: node?.kind || 'prep' };
    trial.push(target);
  }

  target.name = clean(node?.name) || target.name;
  target.draft = definition(node?.draft, ingredients, trial);
  target.published = copy(target.draft);

  const before = new Set(trial.filter(n => n.published).map(n => n.id));
  releaseUploads({ nodes: trial }, new Set());

  return [target, ...trial.filter(n => n !== target && n.published && !before.has(n.id))];
}

// Saves the links an admin approved in Match ingredients. Returns the line
// names that now point at another ingredient, for cleanup.
function applyLinks(state, node, links, ingredients) {
  const known = new Set(ingredients.map(i => i.id));
  const replaced = [];

  for (const link of links) {
    const target = link.node_id === node.id || link.node_id === '__new'
      ? node
      : state.nodes.find(n => n.id === link.node_id);
    const line = target?.draft?.lines?.[link.index];

    if (!line || line.prep_id) continue;

    if (link.ingredient_id && !known.has(link.ingredient_id)) {
      throw new Error('Ingredient is not in this restaurant.');
    }

    target.draft.lines[link.index] = { ...line, ingredient_id: link.ingredient_id || null };
    if (link.ingredient_id) replaced.push(line.name);
  }

  return replaced;
}

// Owners and uploads: link only the sure matches, no review.
async function autoLink(rid, nodes) {
  const lines = nodes.flatMap(n =>
    (n.draft?.lines || [])
      .map((line, index) => ({ n, index, line }))
      .filter(x => !x.line.prep_id && !x.line.ingredient_id)
  );

  if (!lines.length) return [];

  const { results } = await matchLines(db, rid, lines.map(x => x.line));
  const replaced = [];

  results.forEach((r, i) => {
    if (r.status !== 'auto' || !r.ingredient) return;
    const { n, index, line } = lines[i];
    n.draft.lines[index] = { ...line, ingredient_id: r.ingredient.id };
    replaced.push(line.name);
  });

  return replaced;
}

// Unpriced ingredients a recipe created by name and nothing uses anymore,
// like "Flour tortillas, 6 in" once it points at Flour Tortilla.
async function removeOrphans(rid, names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return;

  const { data } = await db
    .from('ingredients')
    .select('id')
    .eq('restaurant_id', rid)
    .in('name', unique)
    .is('last_price', null);

  for (const { id } of data || []) {
    const uses = await Promise.all(
      ['component_ingredients', 'menu_item_ingredients', 'invoice_items'].map(table =>
        db.from(table).select('ingredient_id', { count: 'exact', head: true }).eq('ingredient_id', id)
      )
    );

    if (uses.some(r => r.error || r.count)) continue;

    const { error } = await db.from('ingredients').delete().eq('id', id).eq('restaurant_id', rid);
    if (error) console.error('[recipe-match] kept unused ingredient', id, error.message);
  }
}

async function assistDishes(state, ingredients, changed) {
  const targets = draftTargets(state, 4);

  if (!targets.length) return 0;

  const items = await draftsFor(targets, state, ingredients);

  for (const target of targets) {
    const item = matchDraft(items, target);

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
      target.draft = definition(
        { ...item.draft, lines: item.draft.lines.map(line => realIds(line, state, ingredients)) },
        ingredients,
        state.nodes
      );
    } catch (error) {
      target.assist_failed = true;
      target.notes = `OptiMenu could not draft this dish. ${error.message}`;
      continue;
    }

    // OptiMenu's estimates stay out of costs and the menu until an admin
    // confirms them with the kitchen.
    target.notes = clean(item.notes);
    target.status = 'estimated';
    target.source = 'optimenu';
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
      holds: uploadHolds(result.state),
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
    let released = [];
    let replaced = [];

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
    } else if (b.action === 'match') {
      // Read only: what each line would link to if this were confirmed,
      // including uploads that would go into use with it.
      const set = releaseSet(state, b.node, ingredients);
      const lines = set.flatMap(n =>
        n.draft.lines
          .map((line, index) => ({ node_id: n.id, node_name: n.name, kind: n.kind, index, line }))
          .filter(x => !x.line.prep_id)
      );
      const { results, library } = await matchLines(db, rid, lines.map(x => x.line));

      return res.json({
        ...response({ state, revision }),
        library,
        matches: lines.map((x, i) => ({
          node_id: x.node_id,
          node_name: x.node_name,
          kind: x.kind,
          index: x.index,
          name: x.line.name,
          quantity: x.line.quantity,
          unit: x.line.unit,
          ...results[i],
        })),
      });
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
      if (!node.source) node.source = admin ? 'optimenu' : 'owner';

      if (b.action === 'confirm') {
        // Link each line to an ingredient the restaurant buys, so prices come
        // through. Admin sends the links it approved; owners get the sure ones.
        replaced = Array.isArray(b.links)
          ? applyLinks(state, node, b.links, ingredients)
          : await autoLink(rid, [node, ...state.nodes.filter(n => n !== node && n.source === 'upload' && !n.published)]);

        node.published = copy(node.draft);
        compile(state.nodes, node.id);
        node.status = 'confirmed';
        changed.add(node.id);

        // Anything uploaded that was only waiting on this goes into use now.
        released = releaseUploads(state, changed);
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

      const buffer = Buffer.from(await file.arrayBuffer());

      // OptiMenu's own recipe template is read directly: exact amounts, and
      // seconds instead of minutes. Any other file goes through the reader.
      let items = mime === 'text/csv' ? templateRecipes(buffer) : null;

      if (!items) {
        const text = await readRecipeDocument(buffer, mime);

        if (text.length > 120000) {
          throw new Error(
            'Please split this recipe book into smaller files.'
          );
        }

        items = await recipeAI('import', {
          text,
          preps: state.nodes
            .filter(n => n.kind === 'prep')
            .map(n => ({ id: n.id, name: n.name })),
        });
      }

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
        node.source = 'upload';
        item.adopted = node.id;
      }

      // Link lines to ingredients the restaurant already buys, then put every
      // complete upload into use right away, batches first. Anything held
      // (no yield, a line with no amount) waits for an admin.
      replaced = await autoLink(rid, adopted.filter(([item]) => item.adopted).map(([, node]) => node));
      released = releaseUploads(state, changed);

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
      node.source = 'upload';
      item.adopted = node.id;
      released = releaseUploads(state, changed);
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

      const items = await draftsFor(targets, state, ingredients, 'skeleton');

      for (const target of targets) {
        const item = matchDraft(items, target);
        const lines = (item?.draft?.lines || []).map(line => ({
          ...realIds(line, state, ingredients),
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
        target.source = 'owner';
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

    if (replaced.length) {
      try {
        await removeOrphans(rid, replaced);
      } catch (error) {
        console.error('[recipe-match] cleanup failed', error.message);
      }
    }

    return res.json({ ...response(result), released });
  } catch (error) {
    console.error('[recipe-setup]', error.message);

    return res.status(400).json({
      error:
        error.message ||
        'Could not save the recipe. Your edits remain on screen.',
    });
  }
}