import {
  getRestaurantInvoiceMatchingControl,
  getInvoiceMatchingRecipeCompletion,
  INVOICE_MATCHING_STATUS,
} from './invoiceMatchingControls';

const PACKAGE_WORDS = new Set([
  'case', 'cs', 'ctn', 'carton', 'box',
  'bx', 'bag', 'bags', 'pkg', 'package',
  'pack', 'pk', 'lb', 'lbs', 'pound',
  'pounds', 'oz', 'ounce', 'ounces',
  'kg', 'g', 'gal', 'gallon', 'gallons',
  'each', 'ea', 'count', 'ct',
]);

const WORD_ALIASES = {
  mozz: 'mozzarella',
  stk: 'stick',
  stks: 'stick',
  sticks: 'stick',
  frz: 'frozen',
  iqf: 'frozen',
  fried: 'fried',
  bnls: 'boneless',
  sknls: 'skinless',
  chkn: 'chicken',
  chk: 'chicken',
  brst: 'breast',
  breasts: 'breast',
  hearts: 'heart',
  tomatoes: 'tomato',
  potatoes: 'potato',

  // Common foodservice supplier abbreviations
  shrd: 'shredded',
  shred: 'shredded',
  slcd: 'sliced',
  whl: 'whole',
  dcd: 'diced',
  rmn: 'romaine',
  tenders: 'tender',
  brdd: 'breaded',
  ckd: 'cooked',
  unc: 'raw',
};

const IMPORTANT_ATTRIBUTES = [
  ['fresh', 'frozen', 'canned', 'dried'],
  ['fried', 'raw'],
  ['breaded', 'unbreaded'],
  ['shredded', 'sliced', 'whole', 'diced'],
  ['boneless', 'bonein'],
  ['skinless', 'skinon'],
  ['romaine', 'iceberg', 'spring'],
  ['breast', 'thigh', 'wing', 'tenderloin'],
  ['cooked', 'raw'],
];

function normalizeWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/bone[\s-]+in/g, 'bonein')
    .replace(/skin[\s-]+on/g, 'skinon')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => WORD_ALIASES[word] || word);
}

function identityTokens(value) {
  return normalizeWords(value)
    .filter(word => !PACKAGE_WORDS.has(word))
    .filter(word => !/^\d+(?:\.\d+)?$/.test(word));
}

export function isStrictDirectMatch(
  invoiceDescription,
  ingredientName
) {
  const invoice = identityTokens(invoiceDescription);
  const ingredient = identityTokens(ingredientName);

  if (!invoice.length || !ingredient.length) {
    return false;
  }

  const invoiceSet = new Set(invoice);
  const ingredientSet = new Set(ingredient);

  for (const group of IMPORTANT_ATTRIBUTES) {
    const invoiceAttributes =
      group.filter(attribute => invoiceSet.has(attribute));

    const ingredientAttributes =
      group.filter(attribute => ingredientSet.has(attribute));

    if (
      invoiceAttributes.length &&
      ingredientAttributes.length &&
      invoiceAttributes.some(
        attribute => !ingredientAttributes.includes(attribute)
      )
    ) {
      return false;
    }
  }

  // Every meaningful word in the confirmed ingredient's
  // identity must appear in the purchased product description.
  //
  // Additional invoice words are tolerated only when they
  // do not contradict the identity above.
  return ingredient.every(word => invoiceSet.has(word));
}

export function findStrictDirectMatch(
  invoiceDescription,
  eligibleIngredients
) {
  const matches = eligibleIngredients.filter(ingredient =>
    isStrictDirectMatch(
      invoiceDescription,
      ingredient.name
    )
  );

  // Do not choose between multiple plausible identities.
  if (matches.length !== 1) {
    return {
      status: matches.length > 1 ? 'ambiguous' : 'new',
      matches: [],
    };
  }

  return {
    status: 'auto',
    matches: [{
      ...matches[0],
      score: 1,
    }],
  };
}

function collectIngredientIds(node, byId, ids, visiting) {
  if (
    !node?.published ||
    !Array.isArray(node.published.lines) ||
    !node.published.lines.length ||
    visiting.has(node.id)
  ) {
    return false;
  }

  const next = new Set(visiting);
  next.add(node.id);

  for (const line of node.published.lines) {
    if (
      !Number.isFinite(Number(line.quantity)) ||
      Number(line.quantity) <= 0
    ) {
      return false;
    }

    if (line.prep_id) {
      const prep = byId.get(line.prep_id);

      if (
        prep?.kind !== 'prep' ||
        !collectIngredientIds(prep, byId, ids, next)
      ) {
        return false;
      }
    } else {
      if (!line.ingredient_id) {
        return false;
      }

      ids.add(line.ingredient_id);
    }
  }

  return true;
}

export async function getProgressiveInvoiceMatchingPolicy(
  db,
  restaurantId
) {
  const [control, completion] = await Promise.all([
    getRestaurantInvoiceMatchingControl(db, restaurantId),
    getInvoiceMatchingRecipeCompletion(db, restaurantId),
  ]);

  // Existing live restaurants retain normal matching.
  if (
    control.status ===
    INVOICE_MATCHING_STATUS.LEGACY_ENABLED
  ) {
    return {
      mode: 'normal',
      matching_enabled: true,
      completion,
      control,
      eligibleIngredientIds: null,
    };
  }

  // Full completion authorizes normal matching, including
  // when the persistent activation update is still pending.
  if (completion.complete) {
    return {
      mode: 'normal',
      matching_enabled: true,
      completion,
      control,
      eligibleIngredientIds: null,
    };
  }

  if (
    completion.required === 0 ||
    completion.completed === 0
  ) {
    return {
      mode: 'locked',
      matching_enabled: false,
      completion,
      control,
      eligibleIngredientIds: new Set(),
    };
  }

  const { data, error } = await db
    .from('recipe_workspaces')
    .select('state')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) throw error;

  const { data: catalog, error: catalogError } =
    await db.rpc('recipe_setup_catalog', {
      p_restaurant: restaurantId,
    });

  if (catalogError) throw catalogError;

  const nodes = data?.state?.nodes || [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const eligibleIngredientIds = new Set();

  for (const dish of catalog || []) {
    const node = byId.get(dish.id);

    if (
      node?.kind !== 'dish' ||
      node.no_recipe_required === true
    ) {
      continue;
    }

    const candidateIds = new Set();

    if (
      collectIngredientIds(
        node,
        byId,
        candidateIds,
        new Set()
      )
    ) {
      for (const id of candidateIds) {
        eligibleIngredientIds.add(id);
      }
    }
  }

  return {
    mode: eligibleIngredientIds.size
      ? 'strict'
      : 'locked',
    matching_enabled: eligibleIngredientIds.size > 0,
    completion,
    control,
    eligibleIngredientIds,
  };
}