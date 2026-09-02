// pages/api/menu/parse-menu.js
// Production two-pass menu parser.
// Google Vision handles OCR. Claude Haiku handles dish extraction and recipe building.
// Writes to: ingredients, menu_items, menu_item_components, component_ingredients, menu_categories

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { logAiUsage } from '../../../lib/logAiUsage';

export const config = { api: { bodyParser: false }, maxDuration: 300 };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Archetype component schema ───────────────────────────────────────────────

const ARCHETYPES = {
  'Pizza': [
    { name: 'Dough',     optional: false },
    { name: 'Sauce',     optional: false },
    { name: 'Cheese',    optional: false },
    { name: 'Toppings',  optional: true  },
    { name: 'Finishing', optional: true  },
  ],
  'Burger': [
    { name: 'Bun',        optional: false },
    { name: 'Patty',      optional: false },
    { name: 'Cheese',     optional: true  },
    { name: 'Toppings',   optional: true  },
    { name: 'Sauce',      optional: true  },
  ],
  'Sandwich / Sub': [
    { name: 'Bread',      optional: false },
    { name: 'Protein',    optional: false },
    { name: 'Cheese',     optional: true  },
    { name: 'Vegetables', optional: true  },
    { name: 'Sauce',      optional: true  },
  ],
  'Pasta': [
    { name: 'Pasta',      optional: false },
    { name: 'Sauce',      optional: false },
    { name: 'Protein',    optional: true  },
    { name: 'Vegetables', optional: true  },
    { name: 'Finishing',  optional: true  },
  ],
  'Risotto': [
    { name: 'Rice Base',  optional: false },
    { name: 'Protein',    optional: true  },
    { name: 'Vegetables', optional: true  },
    { name: 'Finishing',  optional: false },
  ],
  'Steak / Chop / Fillet': [
    { name: 'Protein',    optional: false },
    { name: 'Sauce',      optional: true  },
    { name: 'Starch',     optional: true  },
    { name: 'Vegetables', optional: true  },
  ],
  'Seafood Entree': [
    { name: 'Protein',    optional: false },
    { name: 'Sauce',      optional: true  },
    { name: 'Starch',     optional: true  },
    { name: 'Vegetables', optional: true  },
  ],
  'Chicken Entree': [
    { name: 'Protein',    optional: false },
    { name: 'Sauce',      optional: true  },
    { name: 'Starch',     optional: true  },
    { name: 'Vegetables', optional: true  },
  ],
  'Salad': [
    { name: 'Greens',     optional: false },
    { name: 'Protein',    optional: true  },
    { name: 'Toppings',   optional: true  },
    { name: 'Dressing',   optional: false },
  ],
  'Soup': [
    { name: 'Base',       optional: false },
    { name: 'Protein',    optional: true  },
    { name: 'Vegetables', optional: true  },
    { name: 'Finishing',  optional: true  },
  ],
  'Appetizer': [
    { name: 'Main Element',  optional: false },
    { name: 'Accompaniment', optional: true  },
    { name: 'Sauce / Dip',   optional: true  },
  ],
  'Dessert': [
    { name: 'Base',    optional: false },
    { name: 'Sauce',   optional: true  },
    { name: 'Garnish', optional: true  },
  ],
  'Beverage': [
    { name: 'Base',     optional: false },
    { name: 'Modifier', optional: true  },
    { name: 'Garnish',  optional: true  },
  ],
  'Small Plate / Other': [
    { name: 'Main Element',    optional: false },
    { name: 'Accompaniment',   optional: true  },
    { name: 'Sauce / Garnish', optional: true  },
  ],
};

const ARCHETYPE_NAMES = Object.keys(ARCHETYPES).join(', ');
const ARCHETYPE_SCHEMA_TEXT = Object.entries(ARCHETYPES)
  .map(([name, components]) => {
    const compList = components
      .map(c => `    - ${c.name}${c.optional ? ' (optional)' : ' (always include)'}`)
      .join('\n');
    return `${name}:\n${compList}`;
  })
  .join('\n\n');

// ─── Archetype compatibility map for recipe matching ─────────────────────────

const ARCHETYPE_COMPAT = {
  'Pizza':                   ['Pizza'],
  'Pasta':                   ['Pasta'],
  'Appetizer':               ['Appetizer', 'Small Plate / Other'],
  'Small Plate / Other':     ['Small Plate / Other', 'Appetizer'],
  'Salad':                   ['Salad'],
  'Burger':                  ['Burger'],
  'Sandwich / Sub':          ['Sandwich / Sub'],
  'Soup':                    ['Soup'],
  'Dessert':                 ['Dessert'],
  'Beverage':                ['Beverage'],
  'Risotto':                 ['Risotto'],
  'Seafood Entree':          ['Seafood Entree', 'Steak / Chop / Fillet', 'Chicken Entree'],
  'Chicken Entree':          ['Chicken Entree', 'Steak / Chop / Fillet', 'Seafood Entree'],
  'Steak / Chop / Fillet':   ['Steak / Chop / Fillet', 'Seafood Entree', 'Chicken Entree'],
};

// ─── Google Vision OCR ────────────────────────────────────────────────────────

async function extractTextWithVision(filePath) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY is not set');

  const imageData = fs.readFileSync(filePath);
  const base64Image = imageData.toString('base64');

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Image },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        }],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Vision API error: ${err}`);
  }

  const data = await response.json();
  const text = data.responses?.[0]?.fullTextAnnotation?.text || '';
  console.log(`[vision] Extracted ${text.length} characters from ${filePath}`);
  return text;
}

// ─── Single file → extracted text string ─────────────────────────────────────

async function fileToText(file) {
  const ext = path.extname(file.originalFilename || '').toLowerCase();
  const isPDF = ext === '.pdf' || file.mimetype === 'application/pdf';

  if (isPDF) {
    const { fromPath } = await import('pdf2pic');
    const convert = fromPath(file.filepath, {
      density: 150,
      saveFilename: 'page',
      savePath: '/tmp',
      format: 'png',
      width: 1200,
      height: 1600,
    });
    const textParts = [];
    for (let i = 1; i <= 6; i++) {
      try {
        const result = await convert(i, { responseType: 'base64' });
        if (!result?.base64) break;
        const tempPath = `/tmp/page_${i}.png`;
        fs.writeFileSync(tempPath, Buffer.from(result.base64, 'base64'));
        const pageText = await extractTextWithVision(tempPath);
        fs.unlinkSync(tempPath);
        if (pageText) textParts.push(pageText);
      } catch { break; }
    }
    return textParts.join('\n\n--- PAGE BREAK ---\n\n');
  }

  return await extractTextWithVision(file.filepath);
}

// ─── OCR text chunker ─────────────────────────────────────────────────────────

const SECTION_WARN_CHARS = 4000;

function chunkMenuText(text) {
  const headerRegex = /^([A-Z][A-Z\s&\/\-]{2,})$/m;

  const splits = [];
  let match;
  const globalRegex = new RegExp(headerRegex.source, 'gm');
  while ((match = globalRegex.exec(text)) !== null) {
    splits.push(match.index);
  }

  if (splits.length === 0) {
    console.log(`[chunkMenuText] No section headers found — processing as single chunk (${text.length} chars)`);
    return [text];
  }

  const chunks = [];

  const preamble = text.slice(0, splits[0]).trim();
  if (preamble.length > 0) chunks.push(preamble);

  for (let i = 0; i < splits.length; i++) {
    const start = splits[i];
    const end = i + 1 < splits.length ? splits[i + 1] : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk.length === 0) continue;

    if (chunk.length > SECTION_WARN_CHARS) {
      console.warn(`[chunkMenuText] Section "${chunk.split('\n')[0]}" is ${chunk.length} chars — large but proceeding`);
    }

    chunks.push(chunk);
  }

  console.log(`[chunkMenuText] Split into ${chunks.length} section chunk(s)`);
  return chunks;
}

// ─── Global recipe matcher ────────────────────────────────────────────────────

async function loadGlobalRecipes() {
  const { data, error } = await supabase
    .from('global_recipes')
    .select('dish_name, aliases, components, archetype')
    .eq('cuisine', 'american');

  if (error) {
    console.warn('[recipes] Failed to load global recipes:', error.message);
    return [];
  }

  console.log(`[recipes] Loaded ${data.length} global recipes`);
  return data;
}

function normalizeDishName(name) {
  return name
    .toLowerCase()
    .replace(/\b(grilled|pan[- ]seared|seared|fried|baked|roasted|broiled|braised|steamed|crispy|blackened|smoked|charcoal[- ]broiled|pan[- ]roasted)\b/g, '')
    .replace(/\b(classic|homemade|fresh|homestyle|traditional|signature|famous|house|jumbo|giant|loaded|double|triple|mini|small|large|whole|half)\b/g, '')
    .replace(/\b(penne|fettuccine|fettucine|linguine|linguini|spaghetti|rigatoni|ziti|tagliatelle|farfalle|orecchiette|angel hair|capellini)\b/g, '')
    .replace(/\b(8oz|10oz|12oz|14oz|16oz|8 oz|10 oz|12 oz|bone[- ]in|boneless)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchRecipe(dishName, dishArchetype, globalRecipes, section = '') {
  const normalized = normalizeDishName(dishName);
  const normalizedWords = normalized.split(' ').filter(w => w.length > 0);
  const qualifiedName = normalizedWords.length === 1 && section
    ? `${normalized} ${section.toLowerCase()}`
    : normalized;

  const archetypeCompatible = (recipeArchetype) => {
    if (!dishArchetype || !recipeArchetype) return true;
    const compatible = ARCHETYPE_COMPAT[dishArchetype] || [];
    return compatible.includes(recipeArchetype);
  };

  for (const recipe of globalRecipes) {
    const nameMatch =
      normalizeDishName(recipe.dish_name) === qualifiedName ||
      (recipe.aliases || []).some(a => normalizeDishName(a) === qualifiedName);

    if (nameMatch) {
      if (!archetypeCompatible(recipe.archetype)) {
        console.log(`[recipes] Rejected match: "${dishName}" (${dishArchetype}) → "${recipe.dish_name}" (${recipe.archetype}) — archetype mismatch`);
        continue;
      }
      return recipe.components;
    }
  }

  if (normalizedWords.length >= 2) {
    for (const recipe of globalRecipes) {
      const recipeNorm = normalizeDishName(recipe.dish_name);
      if (recipeNorm.length < 6) continue;
      const longer = Math.max(qualifiedName.length, recipeNorm.length);
      const shorter = Math.min(qualifiedName.length, recipeNorm.length);
      if (shorter / longer < 0.6) continue;
      if (qualifiedName.includes(recipeNorm) || recipeNorm.includes(qualifiedName)) {
        if (!archetypeCompatible(recipe.archetype)) {
          console.log(`[recipes] Rejected partial match: "${dishName}" (${dishArchetype}) → "${recipe.dish_name}" (${recipe.archetype}) — archetype mismatch`);
          continue;
        }
        console.log(`[recipes] Partial match: "${dishName}" → "${recipe.dish_name}"`);
        return recipe.components;
      }
    }
  }

  return null;
}

// ─── Pre-Pass-2 dish filter ───────────────────────────────────────────────────
// Removes dishes that should never enter the recommendation engine:
//   1. Add-on / upcharge variants (e.g. "Pineapple Stir-Fry - Add Beef")
//   2. Combo pricing tiers (e.g. "Sizzling Fajitas - Combo of Two")
//   3. Sides, kids menu, desserts, and beverages (low/no recommendation value)
//
// Detection is by section/category name and dish name patterns.
// All removals are logged for auditability.

const EXCLUDED_SECTION_PATTERNS = [
  /\bsides?\b/i,
  /\bkids?\b/i,
  /\bchildren\b/i,
  /\bdesserts?\b/i,
  /\bsweets?\b/i,
  /\bbeverages?\b/i,
  /\bdrinks?\b/i,
  /\bcocktails?\b/i,
  /\bwine\b/i,
  /\bbeer\b/i,
  /\bspirits?\b/i,
];

const EXCLUDED_NAME_PATTERNS = [
  /^add\s+/i,           // "Add Beef", "Add Salmon"
  /\s[-–]\s*add\s+/i,   // "Pineapple Stir-Fry - Add Beef"
  /combo\s+of\s+/i,     // "Combo of Two", "Combo of Three"
];

function filterDishManifest(dishes) {
  const kept = [];
  const removed = [];

  for (const dish of dishes) {
    const sectionExcluded = EXCLUDED_SECTION_PATTERNS.some(p =>
      p.test(dish.section || '') || p.test(dish.category || '')
    );
    const nameExcluded = EXCLUDED_NAME_PATTERNS.some(p => p.test(dish.name));

    if (sectionExcluded || nameExcluded) {
      removed.push({
        name: dish.name,
        reason: sectionExcluded ? `section: "${dish.section}"` : 'name pattern',
      });
    } else {
      kept.push(dish);
    }
  }

  if (removed.length > 0) {
    console.log(`[filter] Removed ${removed.length} dishes: ${removed.map(d => `"${d.name}" (${d.reason})`).join(', ')}`);
  }

  return kept;
}

// ─── Extract ingredients from matched recipe components into ingredientMap ────

function mergeRecipeIngredientsIntoMap(components, ingredientMap) {
  for (let i = 0; i < (components || []).length; i++) {
    const comp = components[i];
    for (let j = 0; j < (comp.ingredients || []).length; j++) {
      const ing = comp.ingredients[j];
      const key = ing.name.trim().toLowerCase();
      if (!ingredientMap[key]) {
        ingredientMap[key] = {
          name: ing.name.trim(),
          unit: ing.unit,
          estimated_unit_cost: ing.estimated_unit_cost,
          is_new: true,
          prep_type: 'purchased',
        };
      }
    }
  }
}

// ─── Safe JSON parser ─────────────────────────────────────────────────────────

function safeParseJSON(text) {
  const fenceEnd = text.indexOf('```', text.indexOf('```json') + 7);
  const jsonOnly = fenceEnd !== -1 ? text.slice(0, fenceEnd) : text;
  const cleaned = jsonOnly.replace(/```json|```/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const stripped = firstBrace !== -1 && lastBrace !== -1
    ? cleaned.slice(firstBrace, lastBrace + 1)
    : cleaned;

  try {
    const result = JSON.parse(stripped);
    console.log('[safeParseJSON] Parsed dish: ' + (result?.name || 'unknown'));
    return result;
  } catch {}

  const lastComma = stripped.lastIndexOf('},');
  if (lastComma > 0) {
    try { return JSON.parse(stripped.slice(0, lastComma + 1) + ']'); } catch {}
  }
  const lastBraceIdx = stripped.lastIndexOf('}');
  if (lastBraceIdx > 0) {
    try { return JSON.parse(stripped.slice(0, lastBraceIdx + 1) + ']'); } catch {}
  }

  function extractObjects(str, arrayKey) {
    const keyIdx = str.indexOf(JSON.stringify(arrayKey));
    if (keyIdx === -1) return [];
    const arrOpen = str.indexOf('[', keyIdx);
    if (arrOpen === -1) return [];
    const entries = [];
    let pos = arrOpen + 1;
    let depth = 0;
    let objStart = -1;
    while (pos < str.length) {
      const ch = str[pos];
      if (ch === '{') {
        if (depth === 0) objStart = pos;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          try { entries.push(JSON.parse(str.slice(objStart, pos + 1))); } catch {}
          objStart = -1;
        }
      }
      pos++;
    }
    return entries;
  }

  const ingredients = extractObjects(stripped, 'ingredients');
  if (ingredients.length > 0) {
    const dishes = extractObjects(stripped, 'dishes');
    if (dishes.length === 0) {
      try {
        const nameIdx = stripped.indexOf('"name"');
        const componentsIdx = stripped.indexOf('"components"');
        if (nameIdx !== -1 && componentsIdx !== -1) {
          const parsed = JSON.parse(stripped);
          if (parsed.name && parsed.components) {
            console.log('[safeParseJSON] Parsed dish: ' + parsed.name);
            return parsed;
          }
        }
      } catch {}
    }
    console.warn('[safeParseJSON] Salvaged ' + ingredients.length + ' ingredients, ' + dishes.length + ' dishes from truncated response');
    return { ingredients, dishes };
  }

  console.warn('[safeParseJSON] Could not parse. Raw preview:', text?.slice(0, 300));
  return null;
}

// ─── Pass 1: Ingredient library + dish manifest ───────────────────────────────

async function pass1_extractAndClassify(menuText, globalIngredients, restaurantId) {
  const globalList = globalIngredients.map(i => `${i.name} (${i.unit})`).join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    system: [
      {
        type: 'text',
        text: `You are a restaurant menu analyst. You will receive raw text extracted from a menu page by an OCR system. Your job is to identify every dish and every ingredient needed across all dishes.

CRITICAL: You are working from OCR text — trust it completely. Do not add dishes that are not in the text. Do not invent dishes based on restaurant type or cuisine.`,
      },
      {
        type: 'text',
        text: `GLOBAL INGREDIENT LIBRARY — match against this wherever possible. Use EXACT name and unit.\n\n${globalList}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Here is the raw OCR text extracted from a menu page:

---
${menuText}
---

Return a JSON object with exactly two keys: "ingredients" and "dishes".

════════════════════════════════════════
PART A — DISH LIST
════════════════════════════════════════

Include a dish ONLY if:
✓ Its name appears verbatim in the OCR text
✓ A price (a number like 16.95) appears next to or near the name

Do NOT include:
✗ Section headers — lines with no price (e.g. "Entrees", "Burgers", "Salads")
✗ Add-on lines (e.g. "Add: Beef 10.95") — these modify another dish, not standalone dishes
✗ Combo pricing tiers listed inline (e.g. "Beef 30.95 · Chicken 27.95 · Shrimp 30.95") — treat the parent as ONE dish, not multiple
✗ Items marked "inquire for today's selection" or "ask your server" — omit entirely
✗ Dietary tags like (GF), (V), (VG) — not dish names
✗ Gift certificates, daily specials placeholders, or non-food items

VARIANT SPLITTING RULES:
Variants occur when a customer must CHOOSE ONE option from a list. Split into separate dishes when:
- Protein alternatives separated by commas or "OR" (e.g. "Tacos - chicken, steak, OR shrimp 17.95" → three dishes)
- Style alternatives where the style fundamentally changes the dish (e.g. "Traditional or Boneless Wings 15.95" → two dishes)
- Named sauce or flavor variants listed in a sidebar or callout box at the same price point — each named sauce or flavor becomes its own dish variant

Use the format "[Shortest Clean Parent Name] - [Variant]":
✓ "Wings - Buffalo", "Wings - Korean BBQ" (NOT "Traditional or Boneless Wings - Buffalo")
✓ "Gourmet Tacos - Steak", "Gourmet Tacos - Chicken"
All variants of the same parent share the same price.

Do NOT split when multiple items are combined in the same recipe:
✗ "Penne with Chicken & Shrimp" → ONE dish containing both proteins
✗ "Surf & Turf" → ONE dish

VARIANT CONSISTENCY RULE:
When you split a dish into protein or flavor variants, all variants share the same base accompaniments unless the menu text explicitly says otherwise.
If one variant comes with rice and beans, all variants of that parent dish also come with rice and beans.
Capture this in the description field of each variant.

ARCHETYPE ASSIGNMENT:
Assign the most specific matching archetype from this list: ${ARCHETYPE_NAMES}

The section header a dish appears under is the strongest signal for its archetype — use it as the tiebreaker when the dish name alone is ambiguous:
- A dish in a Pizza section → archetype "Pizza" regardless of its name
- A dish in a Starters or Appetizers section → archetype "Appetizer" regardless of its name
- A dish in a Salads section → archetype "Salad"
- Flatbreads are archetype "Pizza" unless they are clearly open-faced sandwiches
- Milkshakes, smoothies, juices → "Beverage"
- Kids menu items → use the most specific archetype that fits the actual dish (pizza → "Pizza", pasta → "Pasta", burger → "Burger")
- Never assign an archetype based solely on the dish name if the section context contradicts it

The archetype you assign here is used in Pass 2 to select the component structure. A wrong archetype produces a wrong recipe.

DISH NAMES:
- Strip dietary tags: "(GF) Salmon" → "Salmon"
- Title case: "GRILLED CHICKEN" → "Grilled Chicken"
- Preserve acronyms: BLT, BBQ, GF, NYC
- Keep the menu's own name — do not rename or standardize

DISH NAME INTEGRITY:
The dish name must match the menu exactly as printed — never incorporate description text.
✗ "Penne Vodka with Grilled Chicken & Shrimp" (description appended)
✓ "Penne Vodka" (name as printed)
✗ "Sizzling Fajitas - Beef 30.95" (price appended)
✓ "Sizzling Fajitas - Beef"
Strip everything after the first price or description separator.

════════════════════════════════════════
PART B — INGREDIENT LIBRARY
════════════════════════════════════════

List every ingredient needed across all dishes on this menu page.

NAMING RULES:
- Use the most specific, standardized name for every ingredient
- The same physical ingredient must use the SAME name every time across all dishes — pick one canonical name and never vary it
- Match the global library name EXACTLY when a match exists — use it character-for-character
- Never create two entries for what is clearly the same ingredient

MISSING INGREDIENTS:
If an ingredient appears in a dish description but has no match in the global library, ADD IT ANYWAY:
- Set is_new: true and assign a realistic US restaurant wholesale unit cost
- NEVER substitute a different ingredient because the correct one is not in the library
- The correct ingredient name from the menu description is always preferred over a library approximation
- The library will be expanded over time — missing ingredients are expected and should be captured accurately

NO FINISHED GOODS — this is a strict rule:
Never use a pre-made, plated, or composite dish as an ingredient. Always decompose into raw components.

The pattern to avoid: if you find yourself writing a dish name (or any named menu item) as one of its own ingredients, stop and decompose it into its raw parts.

Examples of the pattern (illustrative, not exhaustive):
✗ Any dish using its own name as an ingredient
✗ "Fried Rice" as an ingredient → ✓ Jasmine Rice + Eggs + Scallions + Soy Sauce + Sesame Oil
✗ "Mashed Potatoes" as a finished good → ✓ Yukon Gold Potato + Butter + Heavy Cream + Garlic
✗ "Coleslaw" as a purchased item → ✓ Green Cabbage + Carrot + Mayonnaise + Apple Cider Vinegar
✗ "Guacamole" as a purchased item → ✓ Avocado + Red Onion + Jalapeño + Lime Juice + Cilantro
✗ Any named sauce listed as a single purchased ingredient when it can reasonably be decomposed

DRESSING INFERENCE RULE:
When a dish's name or description implies a specific dressing, add that dressing by name — even if it is not in the global library. Set is_new: true.
The pattern: dish name or description implies a dressing → use that specific dressing, not a generic substitute.
Common examples (not exhaustive): Caesar → "Caesar Dressing", Greek → "Greek Vinaigrette", Ranch → "Ranch Dressing", Honey Mustard → "Honey Mustard Dressing", Balsamic → "Balsamic Vinaigrette".
Never default to a generic "House Dressing" unless the menu explicitly says "house dressing."

UNITS — use only: lb, oz, each, bunch, slice, sheet, sprig
"Each" is appropriate for ingredients that kitchen staff would literally count out as whole units: eggs, whole lemons or limes, whole avocados, buns, rolls, tortillas, pitas.
"Each" is NOT appropriate for fractional toppings or portioned produce — use oz or lb instead.

PREP TYPE — classify every ingredient:
- "purchased": raw commodities, produce, dairy, proteins, bread, condiments, oils, spices — anything that arrives ready to use
- "scratch": do not use
- "ask": compound preparations that restaurants commonly either make in-house OR buy pre-made: sauces, dressings, stocks, doughs, batters, spice blends. When uncertain between "purchased" and "ask", use "ask".

Return ONLY valid JSON — no prose, no markdown outside the JSON block:
{
  "ingredients": [
    { "name": "Fresh Mozzarella", "unit": "oz", "estimated_unit_cost": 0.75, "is_new": false, "prep_type": "purchased" },
    { "name": "Caesar Dressing", "unit": "oz", "estimated_unit_cost": 0.50, "is_new": true, "prep_type": "ask" },
    { "name": "Fresh Cilantro", "unit": "oz", "estimated_unit_cost": 1.50, "is_new": true, "prep_type": "purchased" }
  ],
  "dishes": [
    {
      "name": "Grilled Chicken Caesar",
      "archetype": "Salad",
      "price": 16.95,
      "category": "Salads",
      "description": "Chopped romaine, grilled chicken breast, parmesan, croutons, caesar dressing"
    }
  ]
}`,
      }],
    }],
  });

  await logAiUsage({
    feature: 'menu_import',
    model: 'claude-haiku-4-5-20251001',
    usage: response.usage,
    restaurantId,
  });

  const raw = response.content[0]?.text || '{}';
  console.log(`[pass1] stop_reason: ${response.stop_reason} | input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);
  if (response.stop_reason === 'max_tokens') console.warn('[pass1] WARNING: response truncated');

  const parsed = safeParseJSON(raw);
  if (!parsed) console.error('[pass1] safeParseJSON returned null. Raw:', raw.slice(0, 500));
  else console.log(`[pass1] ${parsed.ingredients?.length ?? 0} ingredients, ${parsed.dishes?.length ?? 0} dishes`);

  return {
    ingredients: parsed?.ingredients || [],
    dishes: parsed?.dishes || [],
  };
}

// ─── Spoonacular recipe lookup ────────────────────────────────────────────────

async function lookupSpoonacularRecipes(dishes) {
  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) {
    console.warn('[spoonacular] No API key set, skipping lookup');
    return {};
  }

  const recipeMap = {};

  await Promise.all(dishes.map(async (dish) => {
    try {
      const query = encodeURIComponent(dish.name);
      const res = await fetch(
        `https://api.spoonacular.com/recipes/complexSearch?query=${query}&number=1&addRecipeInformation=false&fillIngredients=true&apiKey=${apiKey}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const result = data.results?.[0];
      if (!result?.missedIngredients && !result?.usedIngredients) return;

      const ingredients = [
        ...(result.usedIngredients || []),
        ...(result.missedIngredients || []),
      ].map(i => ({
        name: i.name,
        amount: i.amount,
        unit: i.unit || 'each',
      }));

      if (ingredients.length > 0) {
        recipeMap[dish.name.toLowerCase()] = ingredients;
        console.log(`[spoonacular] "${dish.name}" → ${ingredients.length} ingredients`);
      }
    } catch (err) {
      console.warn(`[spoonacular] Failed for "${dish.name}":`, err.message);
    }
  }));

  console.log(`[spoonacular] Matched ${Object.keys(recipeMap).length}/${dishes.length} dishes`);
  return recipeMap;
}

// ─── Pass 2: Build recipes (batched parallel, 5 dishes at a time) ─────────────

async function pass2_buildRecipes(dishManifest, ingredientLibrary, restaurantId, spoonacularData = {}) {
  const libraryRef = ingredientLibrary
    .filter(ing => ing.name && ing.unit)
    .map((ing, idx) => {
      const cost = typeof ing.estimated_unit_cost === 'number'
        ? ing.estimated_unit_cost
        : 0;
      return `${idx + 1}. ${ing.name} | ${ing.unit} | $${cost}/${ing.unit}`;
    })
    .join('\n');

  console.log(`[pass2] ingredient library sample:`, JSON.stringify(ingredientLibrary.slice(0, 3)));
  console.log(`[pass2] libraryRef: ${ingredientLibrary.length} ingredients, ${libraryRef.length} chars`);

  // Build a lightweight index of all dishes in this chunk for sibling context
  const chunkDishIndex = dishManifest
    .map(d => `- ${d.name} (${d.archetype}, $${d.price ?? '?'})`)
    .join('\n');

  const systemPrompt = [
    {
      type: 'text',
      text: `You are a restaurant recipe builder. Your job is to produce accurate, cost-realistic recipes for restaurant dishes using only the provided ingredient library.

You must follow every rule below exactly. A recipe that violates any rule is wrong even if it looks reasonable.`,
    },
    {
      type: 'text',
      text: `INGREDIENT LIBRARY — copy name, unit, and cost exactly:\n\n${libraryRef}\n\n${'━'.repeat(48)}\nARCHETYPE COMPONENT SCHEMAS\n${'━'.repeat(48)}\n\n${ARCHETYPE_SCHEMA_TEXT}`,
    },
  ];

  const buildDish = async (dish) => {
    const archetypeSchema = ARCHETYPES[dish.archetype]
      ? ARCHETYPES[dish.archetype]
          .map(c => `  - ${c.name}${c.optional ? ' (optional)' : ' (always include)'}`)
          .join('\n')
      : ARCHETYPE_SCHEMA_TEXT;

    const spoonacularRef = spoonacularData[dish.name.toLowerCase()];
    const spoonacularBlock = spoonacularRef
      ? `\nSPOONACULAR REFERENCE INGREDIENTS (use as strong guidance for what belongs in this dish):\n${spoonacularRef.map(i => `- ${i.name}: ${i.amount} ${i.unit}`).join('\n')}`
      : '';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `Build a complete recipe for this dish.

DISH: "${dish.name}"
Section: ${dish.section || 'unknown'}
Archetype: ${dish.archetype}
Menu price: $${dish.price ?? 'unknown'}
Category: ${dish.category || 'unknown'}
Description: ${dish.description || 'none'}
${spoonacularBlock}

OTHER DISHES IN THIS SECTION (for context only — do not build recipes for these):
${chunkDishIndex}
If this dish appears to be a variant of another dish in the list above (same parent name, different protein or flavor), ensure your base components are consistent with what those siblings would logically include. Do not omit sides, starches, or accompaniments that the sibling variants would share.

ARCHETYPE COMPONENT SCHEMA FOR "${dish.archetype}":
${archetypeSchema}

════════════════════════════════════════
RULES
════════════════════════════════════════

LIBRARY FIDELITY:
- Use ONLY ingredients from the library above
- Copy name, unit, and estimated_unit_cost exactly — no synonyms, abbreviations, or alternate spellings
- The ingredient name in your output must match the library name character-for-character
- If an ingredient from the dish description has no exact library match, use the closest match and add a "substitution_note" field on that ingredient explaining what was substituted and why
- Never invent a cost — use the library cost exactly

COMPONENT STRUCTURE:
- Follow the archetype schema above exactly
- Every component marked "always include" must appear with at least one ingredient
- Omit optional components only if they clearly do not apply to this dish
- Do not add components that are not in the schema

COMPONENT LABEL INTEGRITY:
- Only place ingredients in components where they logically belong
- "Cheese" components must contain dairy cheese ingredients only — never beans, produce, proteins, or sauces
- "Protein" components must contain the primary protein only
- "Sauce" components contain liquid or semi-liquid preparations — not solid toppings
- "Toppings" components contain solid add-ons — not sauces or dressings
- If you find yourself placing a non-cheese item in a Cheese component, stop and reconsider the component assignment

NO FINISHED GOODS — this is an absolute rule:
- Never use a composite or pre-plated dish as an ingredient
- If the library contains an entry that is itself a finished dish, do NOT use it — decompose into raw components instead
- A dish's own name should never appear as one of its ingredients
- The pattern to avoid: any named menu item appearing as its own ingredient, or any item that is clearly a complete dish being used as a sub-ingredient
- This applies regardless of whether the finished good appears in the library

VARIANT CONSISTENCY:
- If this dish is a variant (its name contains " - " suggesting a parent and variant), it shares base components with its sibling variants listed in the section index above
- Do not omit base accompaniments (rice, beans, tortillas, sides, starches) that sibling variants would logically include unless the description explicitly excludes them

BEVERAGE RULE:
- If this dish's archetype is "Beverage", always decompose into actual base ingredients
- Never use a single finished-good ingredient at a high per-oz cost as the only ingredient in a beverage recipe
- Build from raw components: a milkshake from whole milk + ice cream + flavoring, a smoothie from fruit + juice + yogurt, etc.

DRESSING RULE:
- If this is a salad and the dish name or description implies a specific dressing, use that dressing by name
- Never substitute a generic "House Dressing" for a named dressing unless the menu explicitly says "house dressing"
- If the correct dressing is not in the library, use the closest available match and add a substitution_note

QUANTITY REALISM:
- Use realistic per-serving kitchen quantities proportional to the dish's menu price and category
- Higher priced entrees warrant larger protein portions than lower priced items
- Use the dish description as the primary guide for quantities when specific amounts or sizes are mentioned
- Garnishes, finishing herbs, and spices should always be small: 0.1–0.5 oz
- Sauces and dressings: 1–3 oz typical
- When no description is available, estimate conservatively — the cost guardrail below will catch quantities that are too large

COST GUARDRAIL — mandatory:
After building the recipe, calculate total estimated cost = sum of all (quantity × estimated_unit_cost) across every component and ingredient.
If total cost exceeds 50% of menu price ($${dish.price ?? 'unknown'}), your quantities are too high.
Scale ALL ingredient quantities down proportionally until total cost is at or below 50% of menu price.
Never output a recipe where total estimated cost exceeds the menu price.
If the guardrail cannot be satisfied without quantities becoming unrealistically small, flag it with ⚠️ after the JSON and note which ingredient is the likely culprit.

Show your cost check after the JSON in this format:
**Cost Check:** [ingredient]: [qty] × $[cost] = $[line total] | ... | **Total: $X.XX | 50% cap: $Y.YY | ✅ or ⚠️**

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════

Return a valid JSON object first, then the cost check. No other prose.

{
  "name": string,
  "price": number | null,
  "category": string,
  "archetype": string,
  "components": [
    {
      "name": string,
      "ingredients": [
        {
          "name": string,
          "unit": string,
          "quantity": number,
          "estimated_unit_cost": number,
          "substitution_note": string | null
        }
      ]
    }
  ]
}`,
        }],
      }],
    });

    await logAiUsage({
      feature: 'menu_import',
      model: 'claude-sonnet-4-6',
      usage: response.usage,
      restaurantId,
    });

    console.log(`[pass2] "${dish.name}" stop_reason: ${response.stop_reason} | input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);
    const raw = response.content[0]?.text || '{}';
    console.log(`[pass2] "${dish.name}" content[0] type: ${response.content[0]?.type} | raw length: ${raw.length}`);

    const parsed = safeParseJSON(raw);
    if (!parsed) console.warn(`[pass2] Failed to parse dish: ${dish.name}`);
    return parsed;
  };

  const allResults = [];
  const batchSize = 5;

  for (let i = 0; i < dishManifest.length; i += batchSize) {
    const batch = dishManifest.slice(i, i + batchSize);
    console.log(`[pass2] Batch ${Math.floor(i / batchSize) + 1}: dishes ${i + 1}–${Math.min(i + batchSize, dishManifest.length)}`);
    const batchResults = await Promise.all(batch.map(buildDish));
    allResults.push(...batchResults);
  }

  const dishes = allResults.filter(Boolean);
  console.log(`[pass2] ${dishes.length}/${dishManifest.length} dishes built`);

  return {
    dishes,
    truncated: false,
  };
}

// ─── Ingredient canonicalization ─────────────────────────────────────────────
// Runs after all chunks complete, before saveToSupabase.
// Groups ingredients whose names are highly similar, picks one canonical name
// per group, then rewrites all dish component references to use it.
//
// Similarity rules (in order):
//   1. Substring containment — "Clams" is contained in "Littleneck Clams" → same group
//   2. Token overlap ≥ 0.6 — "NY Strip" and "New York Strip" share enough tokens
//
// Canonical name selection:
//   - Longest name in the group (most specific)
//   - Ties broken by: global library entry preferred, then lowest estimated cost
//     (library costs are more trustworthy than Pass 1 estimates)

function canonicalizeIngredients(ingredientMap, allDishes) {
  // Build a set of dish names so we can exclude them from ingredient merging.
  // Dish names sometimes leak into ingredientMap when the finished-goods rule
  // isn't followed perfectly — they should never be treated as ingredients.
  const dishNameKeys = new Set(allDishes.map(d => d.name.trim().toLowerCase()));

  // Filter out any ingredientMap entries that are actually dish names
  const filteredKeys = Object.keys(ingredientMap).filter(k => !dishNameKeys.has(k));
  const removedDishNames = Object.keys(ingredientMap).length - filteredKeys.length;
  if (removedDishNames > 0) {
    const removed = Object.keys(ingredientMap)
      .filter(k => dishNameKeys.has(k))
      .map(k => ingredientMap[k].name);
    console.log(`[canonicalize] Removed ${removedDishNames} dish names from ingredient map: ${removed.join(', ')}`);
  }

  const keys = filteredKeys;
  const merged = new Set();
  const renameMap = {}; // oldKey → canonicalKey

  function tokenize(name) {
    return name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  }

  function tokenOverlap(a, b) {
    const ta = new Set(tokenize(a));
    const tb = new Set(tokenize(b));
    const intersection = [...ta].filter(t => tb.has(t)).length;
    const union = new Set([...ta, ...tb]).size;
    return union === 0 ? 0 : intersection / union;
  }

  // Two ingredients are similar only if they share enough tokens AND
  // neither name is a strict prefix/suffix qualifier of a completely different thing.
  // We use token overlap >= 0.75 (tight) — this catches:
  //   "Clams" / "Littleneck Clams" (0.5 overlap — below threshold, intentionally NOT merged)
  //   "NY Strip" / "New York Strip" (no token overlap — NOT merged)
  //   "Jasmine Rice" / "White Rice" (0.5 — NOT merged)
  //   "Chipotle Mayo" / "Chipotle in Adobo" (0.33 — NOT merged)
  //   "Hot Sauce" / "Hot Cherry Pepper" (0.33 — NOT merged)
  // And correctly merges only near-identical names:
  //   "Yukon Gold Potato" / "Yukon Gold Potatoes" (0.8 — merged ✓)
  //   "Chicken Breast" / "Chicken Breasts" (0.67 — merged ✓)
  //   "Yellow Onion" / "Yellow Onions" (0.67 — merged ✓)
  //   "Pico de Gallo" / "Pico De Gallo" (1.0 — merged ✓)
  const OVERLAP_THRESHOLD = 0.75;

  function areSimilar(keyA, keyB) {
    return tokenOverlap(keyA, keyB) >= OVERLAP_THRESHOLD;
  }

  function pickCanonical(groupKeys) {
    return groupKeys.sort((a, b) => {
      const ingA = ingredientMap[a];
      const ingB = ingredientMap[b];
      // Longest name first (most specific)
      const lenDiff = ingB.name.length - ingA.name.length;
      if (lenDiff !== 0) return lenDiff;
      // Global library entry preferred (is_new: false beats is_new: true)
      const newDiff = (ingA.is_new ? 1 : 0) - (ingB.is_new ? 1 : 0);
      if (newDiff !== 0) return newDiff;
      return 0;
    })[0];
  }

  const groups = [];

  for (const key of keys) {
    if (merged.has(key)) continue;

    const group = new Set([key]);

    for (const other of keys) {
      if (other === key || merged.has(other)) continue;
      if (areSimilar(key, other)) {
        group.add(other);
        merged.add(other);
      }
    }

    merged.add(key);
    groups.push(group);
  }

  const canonicalMap = {};

  for (const group of groups) {
    const groupKeys = [...group];
    const canonicalKey = pickCanonical(groupKeys);
    const canonical = { ...ingredientMap[canonicalKey] };

    if (groupKeys.length > 1) {
      const aliases = groupKeys
        .filter(k => k !== canonicalKey)
        .map(k => ingredientMap[k].name);
      console.log(`[canonicalize] "${canonical.name}" absorbs: ${aliases.join(', ')}`);

      for (const k of groupKeys) {
        if (k !== canonicalKey) renameMap[k] = canonicalKey;
      }
    }

    canonicalMap[canonicalKey] = canonical;
  }

  // Rewrite dish component ingredient names to use canonical
  let rewriteCount = 0;
  for (const dish of allDishes) {
    for (const comp of dish.components || []) {
      for (const ing of comp.ingredients || []) {
        const ingKey = ing.name.trim().toLowerCase();
        const canonicalKey = renameMap[ingKey];
        if (canonicalKey) {
          const canonicalEntry = canonicalMap[canonicalKey];
          ing.name = canonicalEntry.name;
          ing.estimated_unit_cost = canonicalEntry.estimated_unit_cost;
          ing.unit = canonicalEntry.unit;
          rewriteCount++;
        }
      }
    }
  }

  console.log(`[canonicalize] ${groups.length} canonical ingredients from ${keys.length} raw | ${rewriteCount} dish references rewritten`);

  return canonicalMap;
}

// ─── Validate and shape raw dishes from pass 2 ───────────────────────────────

// Heuristic cheese keyword list — catches obvious component misclassifications
const CHEESE_KEYWORDS = [
  'mozzarella', 'cheddar', 'brie', 'gruyere', 'gouda', 'feta', 'parmesan',
  'pecorino', 'provolone', 'ricotta', 'gorgonzola', 'blue cheese', 'american cheese',
  'pepper jack', 'burrata', 'cotija', 'queso', 'halloumi', 'manchego', 'fontina',
  'havarti', 'muenster', 'colby', 'swiss', 'bocconcini',
];

function validateDishes(rawDishes) {
  return rawDishes
    .filter(d => d.name && typeof d.name === 'string' && d.name.trim())
    .map(d => {
      const components = (d.components || []).map(c => {
      const ingredients = (c.ingredients || [])
        .filter(i => (typeof i.quantity === 'number' ? i.quantity : 0) > 0)
        .map(i => {
          const qty = i.quantity;
          const cost = typeof i.estimated_unit_cost === 'number' ? i.estimated_unit_cost : 0;
          return {
            name: i.name || 'Unknown',
            unit: i.unit || 'each',
            quantity: qty,
            estimated_unit_cost: cost,
            estimated_total_cost: Math.round(qty * cost * 10000) / 10000,
            substitution_note: i.substitution_note || null,
          };
        });
        const componentCost = ingredients.reduce((s, i) => s + i.estimated_total_cost, 0);

        // Heuristic: warn if a non-cheese ingredient lands in a Cheese component
        if (c.name === 'Cheese') {
          for (const ing of ingredients) {
            const ingLower = ing.name.toLowerCase();
            const isActuallyCheese = CHEESE_KEYWORDS.some(k => ingLower.includes(k));
            if (!isActuallyCheese) {
              console.warn(`[validate] Possible misclassified ingredient: "${ing.name}" in Cheese component of "${d.name}"`);
            }
          }
        }

        // Heuristic: warn if protein component ingredient doesn't match dish name variant
        // Only applies to variant dishes (name contains " - ")
        if (d.name.includes(' - ')) {
          const variant = d.name.split(' - ').pop().toLowerCase();
          const proteinComp = (d.components || []).find(c => c.name === 'Protein' || c.name === 'Main Element');
          if (proteinComp) {
            const proteinNames = proteinComp.ingredients.map(i => i.name.toLowerCase()).join(' ');
            const variantWords = variant.split(/\s+/).filter(w => w.length > 3);
            const hasMatch = variantWords.some(w => proteinNames.includes(w));
            if (!hasMatch) {
              console.warn(`[validate] Possible protein mismatch: "${d.name}" — variant "${variant}" not found in protein ingredients: ${proteinNames}`);
            }
          }
        }

        return {
          name: c.name || 'Component',
          ingredients,
          component_cost: Math.round(componentCost * 10000) / 10000,
        };
      });

      const totalEstimatedCost = components.reduce((s, c) => s + c.component_cost, 0);
      const price = typeof d.price === 'number' && !isNaN(d.price)
        ? Math.round(d.price * 100) / 100
        : null;

      // Auto-scale if cost exceeds 50% of menu price
      let scaledComponents = components;
      let scaledCost = totalEstimatedCost;

      if (price && totalEstimatedCost > price * 0.50) {
        const scaleFactor = (price * 0.50) / totalEstimatedCost;
        console.warn(`[validate] Cost guardrail triggered for "${d.name}": $${totalEstimatedCost.toFixed(2)} > 50% of $${price} — scaling by ${scaleFactor.toFixed(3)}`);
        
        scaledComponents = components.map(comp => {
          const scaledIngredients = comp.ingredients.map(ing => {
            const newQty = Math.round(ing.quantity * scaleFactor * 10000) / 10000;
            return {
              ...ing,
              quantity: newQty,
              estimated_total_cost: Math.round(newQty * ing.estimated_unit_cost * 10000) / 10000,
            };
          });
          const newCompCost = scaledIngredients.reduce((s, i) => s + i.estimated_total_cost, 0);
          return {
            ...comp,
            ingredients: scaledIngredients,
            component_cost: Math.round(newCompCost * 10000) / 10000,
          };
        });

        scaledCost = scaledComponents.reduce((s, c) => s + c.component_cost, 0);
      }

      const estimatedMargin = price && scaledCost > 0
        ? Math.round(((price - scaledCost) / price) * 1000) / 10
        : null;

      if (estimatedMargin !== null && estimatedMargin < 45) {
        console.warn(`[validate] Low margin warning: "${d.name}" estimated margin ${estimatedMargin}% after scaling`);
      }

      return {
        name: d.name.trim(),
        price,
        category: typeof d.category === 'string' ? d.category.trim() : 'Other',
        archetype: typeof d.archetype === 'string' ? d.archetype.trim() : 'Small Plate / Other',
        description: typeof d.description === 'string' ? d.description.trim() : null,
        components: scaledComponents,
        total_estimated_cost: Math.round(scaledCost * 100) / 100,
        estimated_margin: estimatedMargin,
      };
    });
}

// ─── Supabase writes ──────────────────────────────────────────────────────────

async function saveToSupabase(restaurantId, parsedDishes, ingredientLibrary) {
  const results = {
    menu_items_created: 0,
    ingredients_created: 0,
    ingredients_reused: 0,
    components_created: 0,
    errors: [],
  };

  const ingredientIdMap = {};

  for (const ing of ingredientLibrary) {
    const normalizedName = ing.name.trim().toLowerCase();

    const { data: existing } = await supabase
      .from('ingredients')
      .select('id, last_price')
      .eq('restaurant_id', restaurantId)
      .ilike('name', ing.name.trim())
      .maybeSingle();

    if (existing) {
      ingredientIdMap[normalizedName] = existing.id;
      results.ingredients_reused++;
    } else {
      const { data: created, error } = await supabase
        .from('ingredients')
        .insert({
          restaurant_id: restaurantId,
          name: ing.name.trim(),
          unit: ing.unit,
          standard_unit: ing.unit,
          original_unit: ing.unit,
          last_price: ing.estimated_unit_cost ?? null,
          ingredient_category: 'weight',
          is_sample: false,
          is_estimated: true,
        })
        .select('id')
        .single();

      if (error) {
        results.errors.push(`Ingredient "${ing.name}": ${error.message}`);
        continue;
      }

      ingredientIdMap[normalizedName] = created.id;
      results.ingredients_created++;
    }
  }

  const categoryIdMap = {};
  const uniqueCategories = [...new Set(parsedDishes.map(d => d.category).filter(Boolean))];

  for (const catName of uniqueCategories) {
    const { data: existingCat } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .ilike('name', catName)
      .maybeSingle();

    if (existingCat) {
      categoryIdMap[catName] = existingCat.id;
    } else {
      const { data: newCat, error } = await supabase
        .from('menu_categories')
        .insert({ restaurant_id: restaurantId, name: catName })
        .select('id')
        .single();

      if (error) {
        results.errors.push(`Category "${catName}": ${error.message}`);
      } else {
        categoryIdMap[catName] = newCat.id;
      }
    }
  }

  for (const dish of parsedDishes) {
    const totalCost = (dish.components || []).reduce((sum, comp) => {
      const compCost = (comp.ingredients || []).reduce((s, i) => {
        return s + (i.quantity ?? 0) * (i.estimated_unit_cost ?? 0);
      }, 0);
      return sum + compCost;
    }, 0);

    const { data: menuItem, error: menuError } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id: restaurantId,
        name: dish.name,
        price: dish.price ?? null,
        cost: Math.round(totalCost * 100) / 100,
        category: dish.category || 'uncategorized',
        category_id: categoryIdMap[dish.category] ?? null,
        description: dish.description ?? null,
        is_sample: false,
      })
      .select('id')
      .single();

    if (menuError) {
      results.errors.push(`Menu item "${dish.name}": ${menuError.message}`);
      continue;
    }

    results.menu_items_created++;

    for (const comp of dish.components || []) {
      const compCost = (comp.ingredients || []).reduce((s, i) => {
        return s + (i.quantity ?? 0) * (i.estimated_unit_cost ?? 0);
      }, 0);

      const { data: component, error: compError } = await supabase
        .from('menu_item_components')
        .insert({
          menu_item_id: menuItem.id,
          name: comp.name,
          cost: Math.round(compCost * 10000) / 10000,
        })
        .select('id')
        .single();

      if (compError) {
        results.errors.push(`Component "${comp.name}" on "${dish.name}": ${compError.message}`);
        continue;
      }

      results.components_created++;

      for (const ing of comp.ingredients || []) {
        const normalizedName = ing.name.trim().toLowerCase();
        const ingredientId = ingredientIdMap[normalizedName];

        if (!ingredientId) {
          results.errors.push(`Could not find ingredient ID for "${ing.name}" on component "${comp.name}"`);
          continue;
        }

        const { error: ciError } = await supabase
          .from('component_ingredients')
          .insert({
            component_id: component.id,
            ingredient_id: ingredientId,
            quantity: ing.quantity ?? 0,
            unit: ing.unit || 'each',
          });

        if (ciError) {
          results.errors.push(`component_ingredient "${ing.name}": ${ciError.message}`);
        }
      }
    }
  }

  return results;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = formidable({ maxFileSize: 20 * 1024 * 1024, multiples: true });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch {
    return res.status(400).json({ error: 'Failed to parse upload' });
  }

  const rawFiles = files.file;
  const fileList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
  if (fileList.length === 0) return res.status(400).json({ error: 'No files provided' });

  const restaurantId = Array.isArray(fields.restaurant_id)
    ? fields.restaurant_id[0]
    : fields.restaurant_id;

  if (!restaurantId) {
    return res.status(400).json({ error: 'restaurant_id is required' });
  }

  // Every other endpoint in this app verifies the caller owns the
  // restaurant before doing anything — this one didn't. Even in review
  // mode (no DB write), this triggers real Claude API calls per request;
  // without this check, anyone who knew or guessed a restaurant_id could
  // run up real API costs against someone else's account with no login at
  // all. Matches the same pattern already used in commit-reviewed-menu.js
  // and everywhere else (confirm-invoice.js, the Stripe routes, etc.).
  const { error: authError, status: authStatus } = await import('../../../lib/withRestaurantAuth')
    .then(m => m.verifyRestaurantAccess(req, restaurantId));
  if (authError) return res.status(authStatus).json({ error: authError });

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  for (const file of fileList) {
    const ext = path.extname(file.originalFilename || '').toLowerCase();
    const isPDF = ext === '.pdf' || file.mimetype === 'application/pdf';
    if (!allowed.includes(file.mimetype) && !isPDF) {
      return res.status(400).json({
        error: `"${file.originalFilename}" is an unsupported type. Please upload JPG, PNG, WEBP, or PDF files.`,
      });
    }
  }

  try {
    const { data: globalIngredients, error: dbError } = await supabase
      .from('global_ingredients')
      .select('name, unit')
      .order('name');

    if (dbError) {
      return res.status(500).json({ error: 'Failed to load ingredient library.' });
    }

    console.log(`[parse-menu] Restaurant: ${restaurantId} | Files: ${fileList.length} | Vision key: ${process.env.GOOGLE_VISION_API_KEY ? 'SET' : 'MISSING'}`);
    console.log(`[parse-menu] Global ingredients loaded: ${globalIngredients.length}`);
    const globalRecipes = await loadGlobalRecipes();

    const allDishes = [];
    const ingredientMap = {};
    let anyTruncated = false;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const fileLabel = `[file ${i + 1}/${fileList.length}: ${file.originalFilename}]`;

      console.log(`[parse-menu] ${fileLabel} Running OCR...`);
      const t0 = Date.now();
      const menuText = await fileToText(file);
      console.log(`[parse-menu] ${fileLabel} OCR done in ${Date.now() - t0}ms`);

      if (!menuText) {
        console.warn(`[parse-menu] ${fileLabel} No text extracted, skipping`);
        continue;
      }

      const chunks = chunkMenuText(menuText);
      console.log(`[parse-menu] ${fileLabel} ${chunks.length} chunk(s) to process`);

      for (let c = 0; c < chunks.length; c++) {
        const chunkLabel = chunks.length > 1 ? ` chunk ${c + 1}/${chunks.length}` : '';
        const sectionName = chunks[c].split('\n')[0].trim();

        console.log(`[parse-menu] ${fileLabel}${chunkLabel} Pass 1...`);
        const t1 = Date.now();
        const { ingredients: chunkIngredients, dishes: chunkDishManifest } =
          await pass1_extractAndClassify(chunks[c], globalIngredients, restaurantId);
        console.log(`[parse-menu] ${fileLabel}${chunkLabel} Pass 1 done in ${Date.now() - t1}ms`);

        if (!chunkIngredients?.length) {
          console.warn(`[parse-menu] ${fileLabel}${chunkLabel} No ingredients extracted, skipping`);
          continue;
        }
        console.log(`[parse-menu] ${fileLabel}${chunkLabel} Pass 1 complete: ${chunkIngredients.length} ingredients, ${chunkDishManifest.length} dishes`);

        const stampedDishManifest = chunkDishManifest.map(dish =>
          Object.assign({}, dish, { section: sectionName })
        );

        // Filter out add-ons, combo tiers, sides, kids, desserts, beverages
        const filteredDishManifest = filterDishManifest(stampedDishManifest);

        if (!filteredDishManifest?.length) {
          console.warn(`[parse-menu] ${fileLabel}${chunkLabel} No dishes remaining after filter, skipping`);
          continue;
        }

        for (const ing of chunkIngredients) {
          const key = ing.name.trim().toLowerCase();
          if (!ingredientMap[key]) ingredientMap[key] = ing;
        }

        // Match against global recipe library — pass archetype for compatibility check
        const matchedDishes = [];
        const unmatchedDishes = [];

        for (const dish of filteredDishManifest) {
          const components = matchRecipe(dish.name, dish.archetype, globalRecipes, dish.section || '');
          if (components) {
            console.log(`[recipes] Hit: "${dish.name}"`);
            mergeRecipeIngredientsIntoMap(components, ingredientMap);
            matchedDishes.push({
              name: dish.name,
              price: dish.price ?? null,
              category: dish.category || 'Other',
              archetype: dish.archetype || 'Small Plate / Other',
              description: dish.description ?? null,
              components,
            });
          } else {
            unmatchedDishes.push(dish);
          }
        }

        console.log(`[recipes] ${matchedDishes.length} matched, ${unmatchedDishes.length} going to Pass 2`);
        allDishes.push(...validateDishes(matchedDishes));

        if (unmatchedDishes.length > 0) {
          console.log(`[parse-menu] ${fileLabel}${chunkLabel} Pass 2...`);
          const t2 = Date.now();
          const { dishes: rawDishes, truncated } =
            await pass2_buildRecipes(unmatchedDishes, chunkIngredients, restaurantId, {});
          console.log(`[parse-menu] ${fileLabel}${chunkLabel} Pass 2 done in ${Date.now() - t2}ms`);

          if (truncated) anyTruncated = true;

          if (rawDishes && Array.isArray(rawDishes)) {
            console.log(`[parse-menu] ${fileLabel}${chunkLabel} Pass 2 complete: ${rawDishes.length} dishes`);
            allDishes.push(...validateDishes(rawDishes));
          } else {
            console.warn(`[parse-menu] ${fileLabel}${chunkLabel} Pass 2 returned no dishes`);
          }
        }
      }
    }

    for (const file of fileList) {
      try { fs.unlinkSync(file.filepath); } catch {}
    }

    if (allDishes.length === 0) {
      return res.status(500).json({ error: 'No menu items found across all uploaded files. Try clearer images.' });
    }

    const rawIngredientLibrary = Object.values(ingredientMap);

    // Canonicalize ingredient names across all chunks before saving.
    // Returns a cleaned map and rewrites dish component references in-place.
    const canonicalMap = canonicalizeIngredients(ingredientMap, allDishes);
    const mergedIngredientLibrary = Object.values(canonicalMap);

    console.log(`[parse-menu] Total: ${allDishes.length} dishes, ${mergedIngredientLibrary.length} unique ingredients (${rawIngredientLibrary.length} raw)`);
    const reviewMode = req.query.review === 'true';
    const withMargin = allDishes.filter(d => d.estimated_margin !== null);

    if (reviewMode) {
      console.log(`[parse-menu] Review mode — skipping Supabase write`);
      return res.status(200).json({
        success: true,
        review: true,
        dishes: allDishes,
        ingredient_library: mergedIngredientLibrary,
        count: allDishes.length,
        truncated: anyTruncated,
        files_processed: fileList.length,
        summary: {
          total_items: allDishes.length,
          categories: [...new Set(allDishes.map(d => d.category))].sort(),
          archetypes_used: [...new Set(allDishes.map(d => d.archetype))].sort(),
          avg_estimated_cost:
            allDishes.length > 0
              ? Math.round(allDishes.reduce((s, d) => s + d.total_estimated_cost, 0) / allDishes.length * 100) / 100
              : 0,
          avg_estimated_margin:
            withMargin.length > 0
              ? Math.round(withMargin.reduce((s, d) => s + d.estimated_margin, 0) / withMargin.length * 10) / 10
              : null,
        },
      });
    }

    console.log(`[parse-menu] Writing to Supabase...`);

    const saveResults = await saveToSupabase(restaurantId, allDishes, mergedIngredientLibrary);
    console.log('[parse-menu] Save complete:', saveResults);

    return res.status(200).json({
      success: true,
      dishes: allDishes,
      count: allDishes.length,
      truncated: anyTruncated,
      files_processed: fileList.length,
      save_results: saveResults,
      summary: {
        total_items: allDishes.length,
        categories: [...new Set(allDishes.map(d => d.category))].sort(),
        archetypes_used: [...new Set(allDishes.map(d => d.archetype))].sort(),
        avg_estimated_cost:
          allDishes.length > 0
            ? Math.round(allDishes.reduce((s, d) => s + d.total_estimated_cost, 0) / allDishes.length * 100) / 100
            : 0,
        avg_estimated_margin:
          withMargin.length > 0
            ? Math.round(withMargin.reduce((s, d) => s + d.estimated_margin, 0) / withMargin.length * 10) / 10
            : null,
      },
    });

  } catch (err) {
    console.error('[parse-menu] Error:', err);
    for (const file of fileList) {
      try { fs.unlinkSync(file.filepath); } catch {}
    }
    return res.status(500).json({ error: err.message || 'Failed to parse menu' });
  }
}