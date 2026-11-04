
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
  ['romaine', /\b(romaine)\b/i],
];

const CONFLICT_GROUPS = [
  ['fresh', 'frozen', 'canned', 'dried'],
  ['crowns', 'florets'],
  ['chopped', 'whole', 'shredded', 'sliced'],
  ['boneless', 'bone-in'],
  ['skinless', 'skin-on'],
  ['spring-mix', 'iceberg', 'romaine'],
];

export function ingredientIdentityConflicts(invoiceName, ingredientName) {
  const invoice = String(invoiceName || '');
  const ingredient = String(ingredientName || '');

  if (!invoice.trim() || !ingredient.trim()) return true;

  const features = name => new Set(
    DISTINCTIVE_FEATURES
      .filter(([, pattern]) => pattern.test(name))
      .map(([feature]) => feature)
  );

  const incoming = features(invoice);
  const existing = features(ingredient);

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
