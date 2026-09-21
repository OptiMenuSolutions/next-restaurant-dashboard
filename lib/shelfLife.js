/**
 * lib/shelfLife.js
 *
 * Shelf-life reference data and protein classification utilities.
 * Used by the waste-risk engine and any page that needs expiry estimates.
 *
 * Default shelf life: 14 days (conservative mid-range for unrecognised items).
 * Fuzzy matching uses substring-only (lower.includes(key)) — the reverse direction
 * (key.includes(firstWord)) was intentionally removed to prevent false positives
 * such as "crab apple" matching "crab".
 *
 * Freeze-aware categories: beef, poultry, pork, seafood, and bakery each
 * have a FROZEN_SHELF_LIFE counterpart, selected instead of the fresh table
 * when the restaurant's own freezes_* setting is true for that category
 * (see getShelfLife's freezeSettings param). Every other ingredient
 * (dairy, produce, pantry) has no frozen variant — freezing either doesn't
 * meaningfully extend usable shelf life for them (already long, e.g. flour)
 * or actively degrades them (fresh produce, soft dairy), so they always use
 * the fresh table regardless of freezeSettings.
 */

// ---------------------------------------------------------------------------
// Fresh shelf-life lookup table — values are in days from delivery date.
// ---------------------------------------------------------------------------
export const SHELF_LIFE = {
  // ── Seafood ──────────────────────────────────────────────────────────────
  fish: 2, salmon: 2, tuna: 2, halibut: 2, cod: 2, tilapia: 2, mahi: 2,
  shrimp: 2, scallop: 2, lobster: 1, crab: 2, oyster: 3, clam: 3,
  swordfish: 2, bass: 2, snapper: 2, flounder: 2, trout: 2,
  albacore: 2, yellowtail: 2, toro: 1,
  "bluefin tuna": 2, "seared toro": 2,
  "torched albacore": 2, "tempura lobster": 1,
  "spicy lobster": 1, "spicy tuna": 2, "spicy lobster salad": 1,
  "shrimp tempura": 2,

  // ── Meat & Poultry ───────────────────────────────────────────────────────
  chicken: 3, beef: 4, pork: 4, lamb: 4, veal: 3, duck: 3, turkey: 3,
  steak: 4, "ground beef": 3, "ground pork": 3,
  bacon: 7, sausage: 4,
  "filet mignon": 4, "new york strip": 4, ribeye: 4, "short rib": 4,

  // ── Dairy ────────────────────────────────────────────────────────────────
  milk: 7, cream: 7, butter: 14, cheese: 14,
  "heavy cream": 7, "sour cream": 14, yogurt: 14,
  mozzarella: 7, parmesan: 30, ricotta: 14,

  // ── Fresh Herbs & Greens ─────────────────────────────────────────────────
  lettuce: 7, spinach: 5, arugula: 5, kale: 7,
  herbs: 5, basil: 5, parsley: 7, cilantro: 5, mint: 7, chives: 7,

  // ── Fresh Produce ────────────────────────────────────────────────────────
  tomato: 7, strawberry: 5, raspberry: 3, blueberry: 7,
  mushroom: 7, avocado: 4, asparagus: 5, corn: 4, pea: 5,
  carrot: 21, onion: 30, garlic: 30, potato: 21,
  apple: 21, lemon: 21, lime: 14, orange: 14,
  beet: 21, celery: 14, broccoli: 7, cauliflower: 7,
  zucchini: 7, pepper: 10, romanesco: 7,

  // ── Pantry / Condiments ──────────────────────────────────────────────────
  olive: 60, oil: 180, flour: 180, sugar: 365, salt: 365,
  pasta: 365, rice: 365, vinegar: 365, sauce: 30,
  "ponzu sauce": 30, "romesco sauce": 30, "mango sauce": 14,
  wasabi: 14,

  // ── Grains ───────────────────────────────────────────────────────────────
  "sushi rice": 365, "arborio rice": 365,

  // ── Beverages ────────────────────────────────────────────────────────────
  "white wine": 365,

  // ── Bakery / Bread ───────────────────────────────────────────────────────
  // Previously missing entirely — bread/buns fell into the generic 14-day
  // default, well above a real fresh loaf's actual shelf life.
  bread: 5, bun: 5, buns: 5, roll: 5, rolls: 5, bagel: 5,
  baguette: 3, brioche: 5,
};

// Default used when no match is found — 14 days is a conservative mid-range
// estimate suitable for unrecognised prepared or mixed items.
const DEFAULT_SHELF_LIFE_DAYS = 14;

// ---------------------------------------------------------------------------
// Frozen shelf-life lookup table — same key structure as SHELF_LIFE, but
// only for the 5 categories a restaurant can flag as frozen. Values are
// realistic USDA-guideline-based estimates for freezer storage.
// ---------------------------------------------------------------------------
export const FROZEN_SHELF_LIFE = {
  // Beef (and veal/lamb, grouped under the same "beef" freeze toggle as red meat)
  beef: 270, steak: 270, veal: 270, lamb: 270,
  "ground beef": 100, "filet mignon": 270, "new york strip": 270,
  ribeye: 270, "short rib": 270,

  // Poultry
  chicken: 270, turkey: 270, duck: 270,

  // Pork (cured items gain less from freezing than raw meat)
  pork: 150, "ground pork": 90, bacon: 30, sausage: 60,

  // Seafood
  fish: 180, salmon: 120, tuna: 120, halibut: 180, cod: 180, tilapia: 180,
  mahi: 180, shrimp: 150, scallop: 150, lobster: 150, crab: 150, oyster: 90,
  clam: 90, swordfish: 150, bass: 180, snapper: 180, flounder: 180, trout: 150,
  albacore: 120, yellowtail: 120, toro: 90,
  "bluefin tuna": 120, "seared toro": 90, "torched albacore": 120,
  "tempura lobster": 90, "spicy lobster": 90, "spicy tuna": 90,
  "spicy lobster salad": 90, "shrimp tempura": 90,

  // Bakery / bread
  bread: 90, bun: 90, buns: 90, roll: 90, rolls: 90, bagel: 90, baguette: 60, brioche: 90,
};

// Maps each freeze-toggleable category to the ingredient-name keywords that
// belong to it, for both classification (getFreezeCategory) and lookup
// resolution order in getShelfLife.
const FREEZE_CATEGORY_KEYS = {
  beef: ["beef", "steak", "veal", "lamb", "ground beef", "filet mignon", "new york strip", "ribeye", "short rib"],
  poultry: ["chicken", "turkey", "duck"],
  pork: ["pork", "ground pork", "bacon", "sausage"],
  seafood: [
    "fish", "salmon", "tuna", "halibut", "cod", "tilapia", "mahi", "shrimp", "scallop",
    "lobster", "crab", "oyster", "clam", "swordfish", "bass", "snapper", "flounder", "trout",
    "albacore", "yellowtail", "toro", "bluefin tuna", "seared toro", "torched albacore",
    "tempura lobster", "spicy lobster", "spicy tuna", "spicy lobster salad", "shrimp tempura",
  ],
  bakery: ["bread", "bun", "buns", "roll", "rolls", "bagel", "baguette", "brioche"],
};

/**
 * Returns which freeze-toggleable category (if any) an ingredient belongs
 * to: "beef" | "poultry" | "pork" | "seafood" | "bakery" | null.
 * Longest keys checked first, same false-positive protection as getShelfLife.
 *
 * @param {string} name
 * @returns {string|null}
 */
export function getFreezeCategory(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  const allEntries = Object.entries(FREEZE_CATEGORY_KEYS)
    .flatMap(([category, keys]) => keys.map((key) => [key, category]))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [key, category] of allEntries) {
    if (lower === key || lower.includes(key)) return category;
  }
  return null;
}

/**
 * Returns the estimated shelf life in days for a given ingredient name.
 *
 * @param {string} name - Ingredient name from invoice or recipe data
 * @param {object} [freezeSettings] - The restaurant's freezes_* flags, e.g.
 *   { beef: true, poultry: false, pork: false, seafood: true, bakery: false }.
 *   When the ingredient's category is flagged true here, FROZEN_SHELF_LIFE
 *   is used instead of the fresh table. Omit entirely (or pass {}) for the
 *   old fresh-only behavior — fully backward compatible.
 * @returns {number} Shelf life in days
 */
export function getShelfLife(name, freezeSettings = {}) {
  if (!name) return DEFAULT_SHELF_LIFE_DAYS;
  const lower = name.toLowerCase().trim();

  const category = getFreezeCategory(name);
  const isFrozen = category && freezeSettings && freezeSettings[category] === true;
  const table = isFrozen ? FROZEN_SHELF_LIFE : SHELF_LIFE;

  // 1. Exact match
  if (table[lower] !== undefined) return table[lower];

  // 2. Substring match — ingredient name contains a known key.
  //    Iterate longest keys first so "bluefin tuna" beats "tuna".
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return table[key];
  }

  // 3. If this ingredient IS a frozen-flagged category but somehow has no
  //    frozen-table entry (shouldn't normally happen — every category key
  //    above has a frozen counterpart), fall back to a generic frozen
  //    default rather than silently returning the much-shorter fresh
  //    default, which would understate a genuinely frozen item's shelf life.
  if (isFrozen) return 90;

  // 4. Default fallback
  return DEFAULT_SHELF_LIFE_DAYS;
}

// ---------------------------------------------------------------------------
// Protein classification
// ---------------------------------------------------------------------------

/**
 * Set of canonical protein keywords.
 * Defined at module scope so it is created once, not on every render.
 */
export const PROTEIN_KEYS = new Set([
  "fish", "salmon", "tuna", "halibut", "cod", "tilapia", "mahi",
  "shrimp", "scallop", "lobster", "crab", "oyster", "clam",
  "swordfish", "bass", "snapper", "flounder", "trout",
  "bluefin tuna", "seared toro",
  "chicken", "beef", "pork", "lamb", "veal", "duck", "turkey",
  "steak", "ground beef", "ground pork", "bacon", "sausage",
  "filet mignon", "new york strip", "ribeye", "short rib",
]);

/**
 * Returns true if the ingredient name is or contains a known protein.
 * Uses substring matching only — the reverse direction was removed to
 * prevent false positives (e.g. "crab apple" should not match "crab").
 *
 * @param {string} name - Ingredient name
 * @returns {boolean}
 */
export function isProtein(name) {
  if (!name) return false;
  const lower = name.toLowerCase().trim();
  if (PROTEIN_KEYS.has(lower)) return true;
  for (const key of PROTEIN_KEYS) {
    if (lower.includes(key)) return true;
  }
  return false;
}