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
 */

// ---------------------------------------------------------------------------
// Shelf-life lookup table — values are in days from delivery date.
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
};

// Default used when no match is found — 14 days is a conservative mid-range
// estimate suitable for unrecognised prepared or mixed items.
const DEFAULT_SHELF_LIFE_DAYS = 14;

/**
 * Returns the estimated shelf life in days for a given ingredient name.
 *
 * Resolution order:
 *   1. Exact match (case-insensitive)
 *   2. Substring match: ingredient name contains a known key  e.g. "king crab legs" → "crab"
 *   3. Default fallback: DEFAULT_SHELF_LIFE_DAYS (14)
 *
 * @param {string} name - Ingredient name from invoice or recipe data
 * @returns {number} Shelf life in days
 */
export function getShelfLife(name) {
  if (!name) return DEFAULT_SHELF_LIFE_DAYS;
  const lower = name.toLowerCase().trim();

  // 1. Exact match
  if (SHELF_LIFE[lower] !== undefined) return SHELF_LIFE[lower];

  // 2. Substring match — ingredient name contains a known key.
  //    Iterate longest keys first so "bluefin tuna" beats "tuna".
  const keys = Object.keys(SHELF_LIFE).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return SHELF_LIFE[key];
  }

  // 3. Default fallback
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