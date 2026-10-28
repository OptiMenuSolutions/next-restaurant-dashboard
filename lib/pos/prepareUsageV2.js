import crypto from 'crypto';
import { allRows, interpret, interpretRequests } from './usageServer';
import { mapUsage } from './usageWork';
import { createConversionResolver } from './conversionEstimates';
import {
  normalize,
  requestText,
  requestTexts,
  dishInstructions,
  foodUnits,
  verifyCoverage,
} from './usageMath';
import {
  rawRecipe,
  simplePlan,
  adjustRecipe,
  inventoryPortions,
  combinePieces,
  touchedLines,
} from './usageRecipe';
import { compile } from '../recipes/compile';

const hash = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const checked = (result) => {
  if (result.error) {
    result.error.infrastructure = true;
    throw result.error;
  }

  return result.data;
};

const signature = (instructions) => ({
  requests: instructions.requests?.map(normalize).sort() ?? null,
  modifiers: instructions.modifiers.map((modifier) => ({
    name: normalize(modifier.name),
    quantity: modifier.quantity ?? 1,
    requests: modifier.requests?.map(normalize).sort() ?? null,
  })).sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  ),
});

const recipeIdentity = (recipe) => recipe.map(({
  id,
  quantity,
  unit,
  components,
}) => ({
  id,
  quantity,
  unit,
  components,
})).sort((a, b) =>
  JSON.stringify(a).localeCompare(JSON.stringify(b))
);

function equivalentRecipe(left, right, catalog) {
  try {
    const a = inventoryPortions(left, catalog);
    const b = inventoryPortions(right, catalog);

    return a.length === b.length && a.every((part) => {
      const other = b.find((row) => row.id === part.id);

      return other &&
        other.unit === part.unit &&
        Math.abs(other.quantity - part.quantity) <
          1e-8 * Math.max(1, part.quantity);
    });
  } catch {
    return false;
  }
}

const IGNORED_WORDS = new Set([
  'with', 'side', 'add', 'sub', 'extra', 'the', 'and',
]);

const batchWords = (value) => normalize(value)
  .replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/)
  .filter((word) => word.length >= 3 && !IGNORED_WORDS.has(word))
  .map((word) => word.replace(/s$/, ''));

// "No Gravy" takes a whole part of the plate off: every recipe line in that
// component, so an ingredient used elsewhere in the dish keeps that share.
// Handled here so Claude never has to subtract a sauce by hand.
export function removeComponents(base, instructions) {
  const texts = [
    ...(instructions.requests || []),
    ...instructions.modifiers.flatMap((modifier) => [
      modifier.name,
      ...(modifier.requests || []),
    ]),
  ].filter((text) => normalize(text));

  const handled = new Set();
  const removed = new Set();
  let kept = base;

  for (const text of texts) {
    const match = /^(?:.*?\bno\b\s*:?\s*|without\s+|hold\s+)(.+)$/i
      .exec(String(text).trim());

    if (!match) continue;

    const words = batchWords(match[1]);

    if (!words.length) continue;

    const fits = (component) => {
      const have = batchWords(component.name);
      return words.every((word) => have.includes(word));
    };

    const parts = kept.filter((part) => (part.components || []).some(fits));

    // Skip when nothing matches, when it would empty the dish, or when a
    // line also belongs to another component and cannot be split here.
    if (
      !parts.length ||
      parts.length === kept.length ||
      parts.some((part) => !(part.components || []).every(fits))
    ) {
      continue;
    }

    kept = kept.filter((part) => !parts.includes(part));

    for (const part of parts) {
      for (const component of part.components || []) {
        removed.add(component.name);
      }
    }

    handled.add(text);
  }

  const keep = (text) => !handled.has(text);

  return {
    base: kept,
    removed: [...removed],
    instructions: {
      ...instructions,
      requests: instructions.requests
        ? instructions.requests.filter(keep)
        : instructions.requests,
      modifiers: instructions.modifiers
        .filter((modifier) => keep(modifier.name))
        .map((modifier) => ({
          ...modifier,
          requests: modifier.requests
            ? modifier.requests.filter(keep)
            : modifier.requests,
        })),
    },
  };
}

// Published batch preps, in the same shape as menu reference recipes.
// Quantities are for the whole batch; the name carries its yield.
function batchReferences(state, catalog) {
  const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
  const byId = new Map(catalog.map((row) => [row.id, row]));
  const byName = new Map(catalog.map((row) => [normalize(row.name), row]));

  return nodes
    .filter((node) => node.kind === 'prep' && node.published)
    .flatMap((node) => {
      try {
        const recipe = compile(nodes, node.id).map((line) => {
          const ingredient = byId.get(line.ingredient_id) ||
            byName.get(normalize(line.name));

          if (!ingredient) throw new Error('Unlinked batch ingredient');

          return {
            id: ingredient.id,
            name: ingredient.name,
            unit: line.unit,
            quantity: line.quantity,
            components: [{ name: node.name, quantity: line.quantity }],
          };
        });

        return [{
          name: `${node.name} (batch prep; the whole batch makes ` +
            `${node.published.yield_quantity} ${node.published.yield_unit})`,
          match: batchWords(node.name),
          recipe,
          batch: node.name,
          yield_quantity: node.published.yield_quantity,
          yield_unit: node.published.yield_unit,
        }];
      } catch {
        return [];
      }
    });
}

export async function prepareUsage(
  db,
  restaurantId,
  limit = Infinity,
  budgetMs = 45000,
  leaseToken = null
) {
  if (!leaseToken) {
    throw new Error('A POS worker lease is required.');
  }

  const started = Date.now();
  const deadline = started + budgetMs;

  const source = checked(await db.rpc('pos_usage_source', {
    p_restaurant_id: restaurantId,
  }));

  if (!source) return { skipped: true };

  verifyCoverage(source);

  const [
    catalog,
    menus,
    snapshots,
    savedRules,
    checkpoints,
    savedRequests,
  ] = await Promise.all([
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
      .from('menu_items')
      .select(
        'id,name,menu_item_components(name,' +
          'component_ingredients(quantity,unit,ingredients(id)))'
      )
      .eq('restaurant_id', restaurantId)
      .order('id')
    ),
    allRows(() => db
      .from('pos_usage_recipes')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('line_key')
    ),
    allRows(() => db
      .from('pos_usage_rules')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('context_key')
    ),
    allRows(() => db
      .from('pos_usage_adjustments')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('line_key')
    ),
    allRows(() => db
      .from('pos_usage_requests')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('id')
    ),
  ]);
  
  const workspace = checked(await db
    .from('recipe_workspaces')
    .select('state')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  );

  const batches = batchReferences(workspace?.state, catalog);

  // Dishes added from the POS that the owner has not confirmed yet are
  // counted from OptiMenu's draft, marked estimated.
  const draftRecipes = new Map();
  const workspaceNodes = Array.isArray(workspace?.state?.nodes)
    ? workspace.state.nodes
    : [];
  const ingredientById = new Map(catalog.map((row) => [row.id, row]));
  const ingredientByName = new Map(catalog.map((row) => [normalize(row.name), row]));

  for (const node of workspaceNodes) {
    if (
      node.kind !== 'dish' ||
      node.published ||
      !node.pos_draft ||
      !node.draft?.lines?.length
    ) {
      continue;
    }

    try {
      const trial = workspaceNodes.map((other) =>
        other.id === node.id ? { ...other, published: node.draft } : other
      );

      draftRecipes.set(node.id, compile(trial, node.id).map((line) => {
        const ingredient = ingredientById.get(line.ingredient_id) ||
          ingredientByName.get(normalize(line.name));

        if (!ingredient) throw new Error('Unlinked draft ingredient');

        return {
          id: ingredient.id,
          native: true,
          from_draft: true,
          conversion_estimated: true,
          name: ingredient.name,
          quantity: line.quantity,
          unit: line.unit,
          components: [{ name: line.component, quantity: line.quantity }],
        };
      }));
    } catch {
      // An incomplete draft leaves the dish in Needs review.
    }
  }

  const recipeOf = (menu) => {
    const recipe = rawRecipe(menu, catalog);
    return recipe.length ? recipe : draftRecipes.get(menu.id) || recipe;
  };

  const withConversions = await createConversionResolver({
    db,
    restaurantId,
    catalog,
    menus,
    deadline,
  });

  const frozen = new Map(snapshots.map((row) => [
    row.line_key,
    row,
  ]));

  const rules = new Map(savedRules.map((row) => [
    row.context_key,
    row,
  ]));

  const drafts = new Map(checkpoints.map((row) => [
    row.line_key,
    row,
  ]));

  const pending = new Map();
  const report = [];
  const sales = [];
  const recipes = [];
  const failures = [];
  let calls = 0;
  
  // ---- Requests learned one at a time --------------------------------
  // Each request on a dish, preset or typed, is learned once per dish and
  // reused in any combination. Cooking and service instructions that never
  // change ingredients are learned once for every dish.
  const requestRows = new Map(savedRequests.map((row) => [row.id, row]));
  const requestWork = new Map();
  const currentRecipes = new Map();

  const meaning = (row) =>
    row.kind === 'alias' ? requestRows.get(row.same_as) || null : row;

  const currentRecipe = (menuId) => {
    if (!currentRecipes.has(menuId)) {
      const menu = menus.find((row) => row.id === menuId);
      currentRecipes.set(menuId, menu ? recipeOf(menu) : []);
    }

    return currentRecipes.get(menuId);
  };

  const touchedHash = (menuId, operations) =>
    hash(touchedLines(currentRecipe(menuId), operations || []));

  // A learned change whose recipe lines were edited since it was saved.
  const stale = (menuId, row) =>
    row.kind === 'change' &&
    Boolean(row.touched_hash) &&
    row.touched_hash !== touchedHash(menuId, row.operations);

  // Which learned requests cover this ticket's texts. Pairs (a swap) are
  // tried before single requests, and this dish before every dish.
  function cover(texts, menuId) {
    const left = new Set(texts);
    const used = [];
    const rows = [...requestRows.values()]
      .filter((row) =>
        (row.menu_item_id === menuId || row.menu_item_id === null) &&
        row.kind !== 'pending'
      )
      .sort((a, b) =>
        b.texts.length - a.texts.length ||
        (b.menu_item_id ? 1 : 0) - (a.menu_item_id ? 1 : 0)
      );

    for (const row of rows) {
      if (!row.texts.every((value) => left.has(value))) continue;

      const target = meaning(row);

      if (!target || target.kind === 'pending' || stale(menuId, target)) {
        continue;
      }

      used.push({ row, target });
      row.texts.forEach((value) => left.delete(value));
    }

    return { used, unknown: [...left].sort() };
  }

  const saveRequest = async (fields) => {
    const row = checked(await db
      .from('pos_usage_requests')
      .upsert({ restaurant_id: restaurantId, ...fields }, {
        onConflict: 'restaurant_id,menu_key,texts_key',
      })
      .select('*')
      .single()
    );

    requestRows.set(row.id, row);
    return row;
  };

  async function readUnknown({ menuId, texts, unknown, used, trimmed, context }) {
    const now = new Date().toISOString();
    const left = [];

    // A plain No ___ of one recipe ingredient needs no interpretation.
    for (const value of unknown) {
      const plain = simplePlan(
        trimmed.base,
        { requests: [value], modifiers: [] },
        catalog
      );

      if (!plain) {
        left.push(value);
        continue;
      }

      const name = trimmed.base.find((part) =>
        part.id === plain.operations[0]?.ingredient_id
      )?.name;

      await saveRequest({
        menu_item_id: menuId,
        texts: [value],
        texts_key: value,
        kind: plain.operations.length ? 'change' : 'none',
        label: name ? `Take off ${name}` : 'Not in this recipe',
        operations: plain.operations,
        unresolved: [],
        untracked: [],
        touched_hash: touchedHash(menuId, plain.operations),
        status: 'approved',
        origin: 'auto',
        approved_at: now,
      });
    }

    if (!left.length) return;

    if (calls >= limit || Date.now() >= deadline) {
      throw new Error('Preparation budget reached');
    }

    calls++;

    const dishRows = [...requestRows.values()].filter((row) =>
      row.menu_item_id === menuId || row.menu_item_id === null
    );

    const approved = dishRows
      .filter((row) =>
        row.status === 'approved' &&
        ['change', 'none'].includes(row.kind) &&
        !stale(menuId, row)
      )
      .map((row) => ({ id: row.id, texts: row.texts, label: row.label }));

    const notSameAs = {};
    for (const row of dishRows) {
      if (row.rejected_same_as?.length) {
        notSameAs[row.texts_key] = row.rejected_same_as;
      }
    }

    const result = await interpretRequests({
      dish: context.dish,
      recipe: trimmed.base,
      catalog: context.catalog,
      reference_recipes: context.reference_recipes,
      ticket: texts,
      known: used.map(({ row, target }) => ({
        texts: row.texts,
        label: target.label,
      })),
      unknown: left,
      approved,
      not_same_as: notSameAs,
    }, restaurantId, deadline);

    const invalid = () => new Error('Claude returned an invalid plan');
    const ids = new Set(catalog.map((row) => row.id));
    const approvedIds = new Set(approved.map((row) => row.id));
    const strings = (value) => (Array.isArray(value) ? value : [])
      .map((item) => String(item).slice(0, 300))
      .slice(0, 10);

    if (!Array.isArray(result?.items)) throw invalid();

    const covered = new Set();
    const saves = [];

    for (const item of result.items) {
      const itemTexts = [...new Set((item.texts || []).map(requestText))]
        .filter((value) => texts.includes(value))
        .sort();

      if (!itemTexts.some((value) => left.includes(value))) throw invalid();
      itemTexts.forEach((value) => covered.add(value));

      const key = itemTexts.join(' | ');
      const shared = {
        menu_item_id: item.kind === 'none' && item.scope === 'any_dish'
          ? null
          : menuId,
        texts: itemTexts,
        texts_key: key,
        label: String(item.label || '').slice(0, 200),
        status: 'pending',
        origin: 'claude',
        approved_at: null,
      };

      if (item.kind === 'same_as') {
        if (
          !approvedIds.has(item.same_as) ||
          (notSameAs[key] || []).includes(item.same_as)
        ) {
          throw invalid();
        }

        saves.push({
          ...shared,
          kind: 'alias',
          same_as: item.same_as,
          proposed_same_as: item.same_as,
          match_result: null,
          operations: [],
          unresolved: [],
          untracked: [],
          touched_hash: null,
        });
      } else if (item.kind === 'none') {
        saves.push({
          ...shared,
          kind: 'none',
          same_as: null,
          proposed_same_as: null,
          operations: [],
          unresolved: [],
          untracked: [],
          touched_hash: null,
        });
      } else {
        const operations = (item.operations || []).map((op) => {
          if (
            !['remove', 'add', 'replace'].includes(op.action) ||
            !ids.has(op.ingredient_id) ||
            (op.action === 'replace' && !ids.has(op.target_id)) ||
            (
              op.action !== 'remove' &&
              (
                !Number.isFinite(op.quantity) ||
                !String(op.unit || '').trim() ||
                (op.action === 'replace' && op.quantity < 0)
              )
            )
          ) {
            throw invalid();
          }

          return {
            action: op.action,
            ingredient_id: op.ingredient_id,
            target_id: op.action === 'replace' ? op.target_id : null,
            quantity: op.action === 'remove' ? null : op.quantity,
            unit: op.action === 'remove' ? null : op.unit,
            basis: op.basis === 'recipe' ? 'recipe' : 'estimated',
            reason: String(op.reason || '').slice(0, 300),
            part: String(op.part || '').slice(0, 200),
          };
        });

        saves.push({
          ...shared,
          kind: 'change',
          same_as: null,
          proposed_same_as: null,
          operations,
          unresolved: strings(item.unresolved),
          untracked: strings(item.untracked),
          touched_hash: touchedHash(menuId, operations),
        });
      }
    }

    if (left.some((value) => !covered.has(value))) throw invalid();

    for (const fields of saves) await saveRequest(fields);
  }

  async function learnedRule({ menuId, trimmed, context, contextKey, entry }) {
    const texts = requestTexts(trimmed.instructions);
    let { used, unknown } = cover(texts, menuId);

    if (unknown.length) {
      const key = `${menuId}|${texts.join(' | ')}`;

      if (!requestWork.has(key)) {
        requestWork.set(key, readUnknown({
          menuId,
          texts,
          unknown,
          used,
          trimmed,
          context,
        }));
      }

      await requestWork.get(key);
      ({ used, unknown } = cover(texts, menuId));

      if (unknown.length) {
        throw new Error('Claude returned an invalid plan');
      }
    }

    const pieces = used.map(({ row, target }) => ({
      id: row.id,
      texts: row.texts,
      kind: row.kind === 'alias' ? 'same_as' : target.kind,
      label: target.label,
      any_dish: target.menu_item_id === null,
      status:
        row.status === 'approved' && target.status === 'approved'
          ? 'approved'
          : 'pending',
      origin: target.origin,
      same_as: row.kind === 'alias'
        ? { id: target.id, texts: target.texts, label: target.label }
        : null,
      operations: target.kind === 'change' ? target.operations : [],
      unresolved: target.unresolved || [],
      untracked: target.untracked || [],
    }));

    entry.pieces = pieces;

    const combined = combinePieces(pieces);
    const reviewed = pieces.every((piece) => piece.status === 'approved');

    const plan = {
      ...combined,
      // Lines from approved requests never ask again.
      operations: combined.operations.map((op) =>
        pieces.find((piece) => piece.id === op.piece)?.status === 'approved'
          ? { ...op, checked: true }
          : op
      ),
      learned: true,
    };

    // Kept on the same rule row as before, so the review page can show it.
    const old = rules.get(contextKey);

    if (!old || hash(old.plan) !== hash(plan)) {
      checked(await db
        .from('pos_usage_rules')
        .upsert({
          restaurant_id: restaurantId,
          context_key: contextKey,
          context,
          plan,
          origin: 'claude',
        }, {
          onConflict: 'restaurant_id,context_key',
          ignoreDuplicates: true,
        })
      );

      checked(await db
        .from('pos_usage_rules')
        .update({ plan, context })
        .eq('restaurant_id', restaurantId)
        .eq('context_key', contextKey)
        .neq('origin', 'admin')
      );

      rules.set(contextKey, {
        ...(old || {}),
        context_key: contextKey,
        context,
        plan,
        origin: old?.origin || 'claude',
      });
    }

    return { plan, origin: reviewed ? 'admin' : 'claude' };
  }

  const work = source.tickets.flatMap((ticket) =>
    (ticket.raw?.ticketItems || []).map((item) => ({
      ticket,
      item,
    }))
  );

  const identifiers = new Set();

  for (const { ticket, item } of work) {
    const key = `${ticket.external_ticket_id}:${item.posRef}`;

    if (!item.posRef || identifiers.has(key)) {
      throw new Error(
        'POS sync must supply unique ticket line identifiers.'
      );
    }

    identifiers.add(key);
  }

  await mapUsage(work, 8, async ({ ticket, item }) => {
    const lineKey = `${ticket.external_ticket_id}:${item.posRef}`;

    const entry = {
      ticket: ticket.raw?.orderNumber,
      line_key: lineKey,
      item_ref: item.itemRef,
      dish: item.name,
      date: ticket.business_date,
      quantity: item.quantity,
    };

    let units = 1;

    try {
      units = foodUnits(ticket, item);

      if (
        !units ||
        source.dish_map?.[item.itemRef] === '__exclude__'
      ) {
        report.push({
          ...entry,
          status: 'excluded',
          reason: 'No tracked prepared food for this line.',
        });
        return;
      }

      const instructions = dishInstructions(item);

      entry.instructions = instructions;
      entry.typed_requests_available =
        instructions.requests !== null &&
        instructions.modifiers.every((modifier) =>
          modifier.requests !== null
        );

      let snapshot = frozen.get(lineKey);
      const mapped = source.dish_map?.[item.itemRef];

      // A dish counted from OptiMenu's draft is recounted from its real
      // recipe once the owner confirms it.
      const confirmedDraft =
        snapshot?.recipe?.some((part) => part.from_draft) &&
        rawRecipe(
          menus.find((menu) => menu.id === snapshot.menu_item_id) || {},
          catalog
        ).length > 0;

      if (
        !snapshot ||
        confirmedDraft ||
        (mapped && mapped !== snapshot.menu_item_id)
      ) {
        const matches = menus.filter((menu) =>
          mapped
            ? menu.id === mapped
            : normalize(menu.name) === normalize(item.name)
        );

        if (matches.length !== 1) {
          throw new Error('Choose the matching OptiMenu dish');
        }

        snapshot = {
          restaurant_id: restaurantId,
          line_key: lineKey,
          menu_item_id: matches[0].id,
          item_name: item.name,
          recipe: recipeOf(matches[0]),
        };

        checked(await db
          .from('pos_usage_recipes')
          .upsert(snapshot, {
            onConflict: 'restaurant_id,line_key',
          })
        );

        frozen.set(lineKey, snapshot);
      }

      if (
        normalize(snapshot.item_name) !== normalize(item.name)
      ) {
        throw new Error(
          'Confirm the dish mapping for this changed POS line.'
        );
      }

      const legacyBase = snapshot.recipe;

      // Recover original units only when the current recipe reproduces
      // the historical quantities exactly. Otherwise preserve history.
      if (
        legacyBase.length &&
        !legacyBase.every((part) => part.native)
      ) {
        const menu = menus.find((row) =>
          row.id === snapshot.menu_item_id
        );

        const candidate = menu ? rawRecipe(menu, catalog) : [];

        if (
          candidate.length &&
          equivalentRecipe(candidate, legacyBase, catalog)
        ) {
          snapshot = { ...snapshot, recipe: candidate };

          checked(await db
            .from('pos_usage_recipes')
            .update({ recipe: candidate })
            .eq('restaurant_id', restaurantId)
            .eq('line_key', lineKey)
          );
        }
      }

      const base = snapshot.recipe;

      entry.menu_item_id = snapshot.menu_item_id;
      entry.base = base;

      // Whole parts of the plate the customer asked to leave off.
      const trimmed = removeComponents(base, instructions);
      entry.removed_components = trimmed.removed;
      if (trimmed.removed.length) entry.counted_base = trimmed.base;

      const identity = {
        version: 7,
        menu: snapshot.menu_item_id,
        recipe: recipeIdentity(base),
        instructions: signature(instructions),
      };

      const contextKey = hash(identity);
      entry.context_key = contextKey;
      
      const selections = [
        ...instructions.modifiers.map((modifier) =>
          String(modifier.name || '').split(':').pop()
        ),
        ...(instructions.requests || []),
      ].map(batchWords).filter((words) => words.length);

      const context = {
        ...identity,
        dish: item.name,
        recipe: trimmed.base,
        instructions: trimmed.instructions,
        catalog: catalog.map(({ id, name, unit }) => ({
          id,
          name,
          unit,
        })),
        reference_recipes: [
          ...menus
            .filter((menu) =>
              instructions.modifiers.some((modifier) => {
                const selection = normalize(
                  String(modifier.name || '').split(':').pop()
                );

                return selection.length >= 4 &&
                  normalize(menu.name).includes(selection);
              })
            )
            .slice(0, 8)
            .map((menu) => ({
              name: menu.name,
              recipe: rawRecipe(menu, catalog),
            })),
          // Batch preps such as White Pepper Gravy are not menu
          // items, so offer the ones a modifier or request names.
          ...batches
            .filter((batch) => selections.some((words) =>
              words.every((word) => batch.match.includes(word))
            ))
            .slice(0, 4)
            .map(({ name, recipe, batch, yield_quantity, yield_unit }) => ({
              name,
              recipe,
              batch,
              yield_quantity,
              yield_unit,
            })),
        ],
      };

      // Requests are learned one at a time, unless this exact combination
      // was already approved as a whole. A plain dish keeps the old path.
      const useLearned =
        requestTexts(instructions).length > 0 &&
        rules.get(contextKey)?.origin !== 'admin';

      if (!useLearned && !pending.has(contextKey)) {
        pending.set(contextKey, (async () => {
          let saved = rules.get(contextKey);

          if (!saved) {
            // Preserve old explicit admin decisions when their
            // complete recipe and instruction context matches.
            const old = savedRules.filter((row) =>
              row.origin === 'admin' &&
              row.context?.instructions &&
              Array.isArray(row.context?.recipe) &&
              normalize(row.context?.dish) === normalize(item.name) &&
              hash(signature(row.context.instructions)) ===
                hash(signature(instructions)) &&
              [base, legacyBase].some((recipe) =>
                hash(recipeIdentity(row.context.recipe)) ===
                hash(recipeIdentity(recipe))
              )
            );

            const plans = new Set(
              old.map((row) => hash(row.plan))
            );

            const plan = plans.size === 1
              ? old[0].plan
              : {
                  operations: [],
                  unresolved: [],
                  pending: true,
                  explanation: 'Preparation queued',
                };

            checked(await db
              .from('pos_usage_rules')
              .upsert({
                restaurant_id: restaurantId,
                context_key: contextKey,
                context,
                plan,
                origin: plans.size === 1 ? 'admin' : 'claude',
              }, {
                onConflict: 'restaurant_id,context_key',
                ignoreDuplicates: true,
              })
            );

            saved = checked(await db
              .from('pos_usage_rules')
              .select('*')
              .eq('restaurant_id', restaurantId)
              .eq('context_key', contextKey)
              .single()
            );
          }

          // Blocked plans are asked again when the catalog changes, or once
          // under the newer contract that lists untracked items separately.
          const reconsider =
            saved.plan.unresolved?.length && (
              hash(saved.context.catalog) !== hash(context.catalog) ||
              !Array.isArray(saved.plan.untracked)
            );

          if (
            saved.origin !== 'admin' &&
            (saved.plan.pending || reconsider)
          ) {
            let plan = simplePlan(trimmed.base, trimmed.instructions, catalog);

            if (!plan) {
              if (
                calls >= limit ||
                Date.now() >= deadline
              ) {
                throw new Error('Preparation budget reached');
              }

              calls++;

              plan = await interpret(
                context,
                restaurantId,
                deadline
              );
            }

            if (
              !Array.isArray(plan?.operations) ||
              !Array.isArray(plan?.unresolved)
            ) {
              throw new Error('Claude returned an invalid plan');
            }

            checked(await db
              .from('pos_usage_rules')
              .update({ plan, context })
              .eq('restaurant_id', restaurantId)
              .eq('context_key', contextKey)
              .neq('origin', 'admin')
            );

            saved = checked(await db
              .from('pos_usage_rules')
              .select('*')
              .eq('restaurant_id', restaurantId)
              .eq('context_key', contextKey)
              .single()
            );
          }

          rules.set(contextKey, saved);
          return saved;
        })());
      }

      // Failed interpretations still retain an editable saved rule.
      entry.rule_available = true;

      const rule = useLearned
        ? await learnedRule({
            menuId: snapshot.menu_item_id,
            trimmed,
            context,
            contextKey,
            entry,
          })
        : await pending.get(contextKey);
      const plan = rule.plan;

      // Which request each added ingredient belongs to, for the recipe view,
      // and for a batch prep how much of the batch the amounts come to.
      const named = new Set(selections.flat());
      const sameFamily = (quantity, from, to) => {
        const scale = {
          oz: ['w', 1], lb: ['w', 16], g: ['w', 0.035274], kg: ['w', 35.274],
          'fl oz': ['v', 1], cup: ['v', 8], pt: ['v', 16], qt: ['v', 32],
          gal: ['v', 128], ml: ['v', 0.033814], l: ['v', 33.814],
          tsp: ['v', 1 / 6], tbsp: ['v', 0.5],
        };
        if (from === to) return quantity;
        const a = scale[from];
        const b = scale[to];
        return a && b && a[0] === b[0] ? (quantity * a[1]) / b[1] : null;
      };

      entry.plan = {
        ...plan,
        operations: (plan.operations || []).map((op) => {
          if (op.action === 'remove') return op;

          const id = op.action === 'replace' ? op.target_id : op.ingredient_id;

          // Prefer the side or batch prep the ticket actually names.
          const reference = (context.reference_recipes || [])
            .filter((value) => (value.recipe || []).some((part) => part.id === id))
            .map((value) => ({
              value,
              score: batchWords(value.batch || value.name)
                .filter((word) => named.has(word)).length,
            }))
            .sort((a, b) => b.score - a.score)[0]?.value;

          if (!reference) return op;

          const line = reference.recipe.find((part) => part.id === id);
          const lineQuantity = line
            ? sameFamily(Number(line.quantity), line.unit, op.unit)
            : null;
          const fromRecipe = Boolean(
            !reference.batch &&
            lineQuantity != null &&
            Math.abs(lineQuantity - Number(op.quantity)) < 1e-9
          );
          const yieldQuantity = Number(reference.yield_quantity);
          const batchPortion =
            reference.batch &&
            lineQuantity > 0 &&
            yieldQuantity > 0 &&
            Number(op.quantity) > 0
              ? {
                  name: reference.batch,
                  quantity: Number(
                    ((Number(op.quantity) / lineQuantity) * yieldQuantity).toPrecision(3)
                  ),
                  unit: reference.yield_unit,
                }
              : null;

          return {
            ...op,
            part: op.part ||
              reference.batch ||
              reference.name.replace(/\s*\(batch prep.*$/, ''),
            from_recipe: fromRecipe,
            batch_portion: batchPortion,
          };
        }),
      };
      entry.origin = rule.origin;

      if (!base.length && rule.origin !== 'admin') {
        throw new Error(
          'Add the recipe or enter the final ingredient portions.'
        );
      }

      if (
        units > 1 &&
        (
          trimmed.instructions.modifiers.length ||
          trimmed.instructions.requests?.some((value) => value.trim())
        ) &&
        rule.origin !== 'admin'
      ) {
        throw new Error(
          'Confirm per-serving portions for this grouped modified POS line.'
        );
      }

      const adjustmentKey = hash([contextKey, plan, trimmed.removed]);
      const oldDraft = drafts.get(lineKey);

      const adjustedRecipe =
        oldDraft?.adjustment_key === adjustmentKey
          ? oldDraft.recipe
          : adjustRecipe(trimmed.base, plan, catalog);

      if (oldDraft?.adjustment_key !== adjustmentKey) {
        checked(await db
          .from('pos_usage_adjustments')
          .upsert({
            restaurant_id: restaurantId,
            line_key: lineKey,
            adjustment_key: adjustmentKey,
            recipe: adjustedRecipe,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'restaurant_id,line_key',
          })
        );
      }

      // Conversion retries resume here.
      // Modifier interpretation is already saved.
      let adjusted;

      try {
        adjusted = await withConversions(() =>
          inventoryPortions(adjustedRecipe, catalog)
        );
      } catch (error) {
        // A recipe unit with no weight in its inventory unit.
        if (!/^Link the ingredient/.test(error.message || '')) {
          error.review = 'weight';
        }

        throw error;
      }

      const estimated = adjusted.some((part) =>
        part.conversion_estimated
      );

      for (let index = 1; index <= units; index++) {
        // Preserve existing consumption IDs across this engine change.
        const name = `__om_pos__${hash([lineKey, index])}`;

        sales.push({
          id: name,
          item_name: name,
          sale_date: ticket.business_date,
          quantity_sold: 1,
          refunds: 0,
        });

        recipes.push({
          id: name,
          name,
          menu_item_components: [{
            component_ingredients: adjusted.map((part) => ({
              quantity: part.quantity,
              unit: part.unit,
              ingredients: {
                id: part.id,
                name: part.name,
                unit: part.unit,
              },
            })),
          }],
        });

        report.push({
          ...entry,
          unit_index: index,
          status: 'ready',
          adjusted,
          estimated,
        });
      }
    } catch (error) {
      if (
        error.infrastructure ||
        /^(PGRST|[0-9A-Z]{5}$)/.test(error.code || '')
      ) {
        failures.push(error);
        return;
      }

      console.warn('[pos-usage:review]', {
        restaurantId,
        lineKey,
        message: error.message,
      });

      const retryable =
        /budget|timed out|lost connection|HTTP (429|5\d\d)|did not finish|invalid plan/i
          .test(error.message);

      const count =
        Number.isInteger(units) && units > 0 && units <= 100
          ? units
          : 1;

      for (let index = 1; index <= count; index++) {
        report.push({
          ...entry,
          unit_index: index,
          status: 'blocked',
          retryable,
          reason: retryable
            ? 'Queued for automatic retry; completed dishes are unaffected.'
            : error.message,
          review: retryable
            ? 'retry'
            : /matching OptiMenu dish|dish mapping/i.test(error.message)
              ? 'dish'
              : error.review || 'amount',
        });
      }
    }
  });

  if (failures.length) throw failures[0];

  const latest = checked(await db.rpc('pos_usage_source', {
    p_restaurant_id: restaurantId,
  }));

  if (latest?.revision !== source.revision) {
    throw new Error(
      'Source changed during preparation; retrying the saved work.'
    );
  }

  const result = {
    restaurant_id: restaurantId,
    source_revision: source.revision,
    ready: !report.some((row) => row.status === 'blocked'),
    report,
    sales,
    recipes,
    computed_at: new Date().toISOString(),
  };

  checked(await db.rpc('publish_pos_usage', {
    p_restaurant_id: restaurantId,
    p_lease: leaseToken,
    p_result: result,
  }));

  console.info('[pos-usage:prepare]', {
    restaurantId,
    lines: work.length,
    calls,
    elapsed_ms: Date.now() - started,
  });

  return {
    ready: result.ready,
    calls,
    report,
  };
}