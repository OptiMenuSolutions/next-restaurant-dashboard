
const DISTINCTIVE_FEATURES = [
  ['fresh', /\b(fresh)\b/i],
  ['frozen', /\b(frozen|frz|iqf)\b/i],
  ['canned', /\b(canned|canned goods)\b/i],
  ['dried', /\b(dried|dehydrated)\b/i],
  ['crowns', /\b(crowns?)\b/i],
  ['florets', /\b(florets?)\b/i],
  ['chopped', /\b(chopped|diced)\b/i],
  ['whole', /\b(whole)\b/i],
  ['shredded', /\b(shredded)\b/i],
  ['sliced', /\b(sliced)\b/i],
  ['boneless', /\b(boneless|bnls)\b/i],
  ['bone-in', /\b(bone[\s-]?in)\b/i],
  ['skinless', /\b(skinless|sknls)\b/i],
  ['skin-on', /\b(skin[\s-]?on)\b/i],
  ['spring-mix', /\b(spring\s+mix)\b/i],
  ['iceberg', /\b(iceberg)\b/i],
  ['romaine', /\b(romaine|rmn)\b/i],

  // Meat and poultry cuts
  ['breast', /\b(breast|brst|breasts)\b/i],
  ['thigh', /\b(thigh|thighs)\b/i],
  ['wing', /\b(wing|wings)\b/i],
  ['tenderloin', /\b(tenderloin|tenderloins)\b/i],

  // Preparation characteristics
  ['raw', /\b(raw|uncooked)\b/i],
  ['cooked', /\b(cooked|fully cooked|precooked)\b/i],
  ['breaded', /\b(breaded|brdd)\b/i],
  ['unbreaded', /\b(unbreaded)\b/i],
];

const CONFLICT_GROUPS = [
  ['fresh', 'frozen', 'canned', 'dried'],
  ['crowns', 'florets'],
  ['chopped', 'whole', 'shredded', 'sliced'],
  ['boneless', 'bone-in'],
  ['skinless', 'skin-on'],
  ['spring-mix', 'iceberg', 'romaine'],
  ['breast', 'thigh', 'wing', 'tenderloin'],
  ['raw', 'cooked'],
  ['breaded', 'unbreaded'],
];

const VERIFIED_DESCRIPTION_EQUIVALENTS = [
  ['Chives', 'Fresh Chives'],
  ['Mushrooms Button Whole', 'Button Mushrooms'],
  ['Coleslaw Fresh Prepared', 'Coleslaw'],
  ['Pico de Gallo Fresh-Cut', 'Pico de Gallo'],
];

function normalizeIdentityName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isVerifiedDescriptionEquivalent(invoiceName, ingredientName) {
  const invoice = normalizeIdentityName(invoiceName);
  const ingredient = normalizeIdentityName(ingredientName);

  return VERIFIED_DESCRIPTION_EQUIVALENTS.some(([a, b]) => {
    const first = normalizeIdentityName(a);
    const second = normalizeIdentityName(b);

    return (
      (invoice === first && ingredient === second) ||
      (invoice === second && ingredient === first)
    );
  });
}

/**
 * Detect explicit product-description contradictions.
 *
 * This is deliberately narrower than ingredientIdentityConflicts().
 *
 * AI-generated matches must continue using the strict checker.
 * Administrator-approved supplier mappings may resolve missing
 * descriptive details, but not explicitly contradictory ones.
 *
 * No restaurant-specific or product-specific equivalencies.
 */
export function ingredientIdentityExplicitlyContradicts(
  invoiceName,
  ingredientName
) {
  const invoice = String(invoiceName || '').trim();
  const ingredient = String(ingredientName || '').trim();

  if (!invoice || !ingredient) return true;

  const features = name => new Set(
    DISTINCTIVE_FEATURES
      .filter(([, pattern]) => pattern.test(name))
      .map(([feature]) => feature)
  );

  const incoming = features(invoice);
  const existing = features(ingredient);

  // Explicitly different characteristics remain incompatible.
  for (const group of CONFLICT_GROUPS) {
    const a = group.filter(feature => incoming.has(feature));
    const b = group.filter(feature => existing.has(feature));

    if (
      a.length > 0 &&
      b.length > 0 &&
      (
        a.length !== b.length ||
        a.some(feature => !b.includes(feature))
      )
    ) {
      return true;
    }
  }

  // Ground-meat ratios remain protected.
  // An explicitly specified ratio cannot be substituted
  // for another ratio or an unspecified ratio.
  const fatRatio = value => {
    const match = value.match(
      /\b(7[0-9]|8[0-9]|9[0-9])\s*[/\-]\s*([0-2][0-9])\b/
    );

    if (!match) return null;

    const lean = Number(match[1]);
    const fat = Number(match[2]);

    return lean + fat === 100
      ? `${lean}/${fat}`
      : null;
  };

  const incomingRatio = fatRatio(invoice);
  const existingRatio = fatRatio(ingredient);

  if (
    (incomingRatio || existingRatio) &&
    incomingRatio !== existingRatio
  ) {
    return true;
  }

  return false;
}

export function ingredientIdentityConflicts(invoiceName, ingredientName) {
  const invoice = String(invoiceName || '');
  const ingredient = String(ingredientName || '');

  if (!invoice.trim() || !ingredient.trim()) return true;

  // Explicitly recognized descriptions of the same product.
  // Keep this narrow: never remove meaningful distinctions
  // globally just to reduce review volume.
  if (isVerifiedDescriptionEquivalent(invoice, ingredient)) {
    return false;
  }

  const features = name => new Set(

    DISTINCTIVE_FEATURES
      .filter(([, pattern]) => pattern.test(name))
      .map(([feature]) => feature)
  );

  const incoming = features(invoice);
  const existing = features(ingredient);

  // Ground meat fat/lean ratios are part of product identity.
  // Examples: 80/20, 85/15, 90/10.
  // A missing ratio also requires review when the other
  // description specifies one.
  const fatRatio = value => {
    const match = value.match(
      /\b(7[0-9]|8[0-9]|9[0-9])\s*[/\-]\s*([0-2][0-9])\b/
    );

    if (!match) return null;

    const lean = Number(match[1]);
    const fat = Number(match[2]);

    return lean + fat === 100
      ? `${lean}/${fat}`
      : null;
  };

  const incomingRatio = fatRatio(invoice);
  const existingRatio = fatRatio(ingredient);

  if (
    (incomingRatio || existingRatio) &&
    incomingRatio !== existingRatio
  ) {
    return true;
  }

  // A characteristic present on only one side needs review.
  // A generic library name does not prove that a more specific
  // purchased product is interchangeable.
  for (const group of CONFLICT_GROUPS) {
    const a = group.filter(feature => incoming.has(feature));
    const b = group.filter(feature => existing.has(feature));

    if (a.length || b.length) {
      if (
        a.length !== b.length ||
        a.some(feature => !b.includes(feature))
      ) {
        return true;
      }
    }
  }

  return false;
}

export function safeguardIngredientMatch(itemName, result) {
  if (!result || result.status !== 'auto') return result;

  const candidates = Array.isArray(result.matches)
    ? result.matches
    : [];

  if (candidates.length !== 1 || !candidates[0]?.id) {
    return { status: 'ambiguous', matches: candidates };
  }

  const candidate = candidates[0];

  if (ingredientIdentityConflicts(itemName, candidate.name)) {
    return {
      status: 'ambiguous',
      matches: candidates,
    };
  }

  return result;
}


export function resolveInvoiceIngredientMatches(
  foodItems,
  restaurantIngredients,
  remembered,
  aiResults
) {
  const ingById = new Map(
    restaurantIngredients.map(ingredient => [
      ingredient.id,
      ingredient,
    ])
  );

  let aiIdx = 0;

  return foodItems.map(item => {
    const name = item.item_name_normalized || item.item_name_raw;
    const key = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const rememberedId = remembered.get(key);
    const rememberedIngredient = rememberedId
      ? ingById.get(rememberedId)
      : null;

    const validRememberedIngredient =
      rememberedIngredient &&
      !ingredientIdentityConflicts(
        name,
        rememberedIngredient.name
      )
        ? rememberedIngredient
        : null;

    const result = validRememberedIngredient
      ? {
          status: 'auto',
          matches: [{
            ...validRememberedIngredient,
            score: 1,
          }],
        }
      : (aiResults[aiIdx++] || {
          status: 'new',
          matches: [],
        });

    return safeguardIngredientMatch(name, result);
  });
}
