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
// Splits menu OCR text on section headers (ALL CAPS lines) only.
// Never cuts mid-dish. If no headers found, returns the full text as one chunk.
// Logs a warning if any single section exceeds SECTION_WARN_CHARS.

const SECTION_WARN_CHARS = 4000;

function chunkMenuText(text) {
  // Match lines that are ALL CAPS (section headers like "ENTREES", "SALADS & SOUPS")
  // Must be on their own line, at least 3 chars, no price digits
  const headerRegex = /^([A-Z][A-Z\s&\/\-]{2,})$/m;

  // Find all header positions
  const splits = [];
  let match;
  const globalRegex = new RegExp(headerRegex.source, 'gm');
  while ((match = globalRegex.exec(text)) !== null) {
    splits.push(match.index);
  }

  // No headers found — return full text as single chunk
  if (splits.length === 0) {
    console.log(`[chunkMenuText] No section headers found — processing as single chunk (${text.length} chars)`);
    return [text];
  }

  // Build chunks: everything before first header is chunk 0 (preamble/restaurant info)
  // then one chunk per section starting at each header
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
    .select('dish_name, aliases, components')
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

function matchRecipe(dishName, globalRecipes, section = '') {
  const normalized = normalizeDishName(dishName);
  const normalizedWords = normalized.split(' ').filter(w => w.length > 0);
  const qualifiedName = normalizedWords.length === 1 && section
    ? `${normalized} ${section.toLowerCase()}`
    : normalized;

  for (const recipe of globalRecipes) {
    if (normalizeDishName(recipe.dish_name) === qualifiedName) {
      return recipe.components;
    }
    for (const alias of recipe.aliases || []) {
      if (normalizeDishName(alias) === qualifiedName) {
        return recipe.components;
      }
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
        console.log(`[recipes] Partial match: "${dishName}" → "${recipe.dish_name}"`);
        return recipe.components;
      }
    }
  }

  return null;
}

// ─── Extract ingredients from matched recipe components into ingredientMap ────
// Ensures every ingredient in a global recipe hit gets an entry in ingredientMap
// so saveToSupabase can resolve ingredient IDs for matched dishes.

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
  const cleaned = text.replace(/```json|```/g, '').trim();

  try { return JSON.parse(cleaned); } catch {}

  const lastComma = cleaned.lastIndexOf('},');
  if (lastComma > 0) {
    try { return JSON.parse(cleaned.slice(0, lastComma + 1) + ']'); } catch {}
  }
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace > 0) {
    try { return JSON.parse(cleaned.slice(0, lastBrace + 1) + ']'); } catch {}
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

  const ingredients = extractObjects(cleaned, 'ingredients');
  if (ingredients.length > 0) {
    const dishes = extractObjects(cleaned, 'dishes');
    // Try to salvage a single dish object from Pass 2 response
    if (dishes.length === 0) {
      try {
        const nameIdx = cleaned.indexOf('"name"');
        const componentsIdx = cleaned.indexOf('"components"');
        if (nameIdx !== -1 && componentsIdx !== -1) {
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            const candidate = cleaned.slice(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(candidate);
            if (parsed.name && parsed.components) {
              console.log('[safeParseJSON] Parsed dish: ' + parsed.name);
              return parsed;
            }
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

Return a JSON object with two keys: "ingredients" and "dishes".

PART A — DISH LIST
Include a dish only if:
✓ Its name appears in the text
✓ A price (number like 16.95) appears next to or near the name

Do NOT include:
✗ Section headers — lines with no price (e.g. "Entrees", "Burgers", "Salads")
✗ Add-on lines (e.g. "Add: Beef 10.95") — these modify another dish
✗ Sauce/flavor variant lists under a dish — these are ingredients
✗ Items marked "inquire for today's selection" or "ask your server"
✗ Combo pricing tiers (e.g. "Beef 30.95 · Chicken 27.95") — one dish, not multiple
✗ Dietary tags like (GF), (V), (VG) — not dish names

SPECIAL CASES:
- If a dish lists multiple protein or filling options as ALTERNATIVES — separated by commas or "OR" where the customer chooses one (e.g. "Tacos - chicken, steak, OR shrimp 17.95", or "Traditional or Boneless Wings 15.95") — create one separate dish per option using the format "[Parent Name] - [Variant]". When the parent name itself contains the variant words (e.g. "Traditional or Boneless Wings"), use the shortest clean parent name (e.g. "Wings") not the full option string. All variants share the same price.
- Do NOT split dishes where multiple proteins are combined in the same recipe, indicated by "&", "and", or "with" (e.g. "Penne Vodka with Grilled Chicken & Shrimp" is one dish containing both proteins, not two variants).
- Strip dietary tags from dish names: "(GF) Salmon" → "Salmon"
- Title case all dish names: "GRILLED CHICKEN" → "Grilled Chicken"
- Preserve acronyms: BLT, BBQ, GF, NYC

PART B — INGREDIENT LIBRARY

NAMING RULES — follow these exactly:
- Use the most specific, standardized name for every ingredient
- Be consistent: the same physical ingredient must use the SAME name every time it appears across all dishes
- Choose ONE canonical name and use it everywhere:
  ✓ "Pork Ribs" not "Baby Back Ribs" in one dish and "Pork Ribs" in another — pick one
  ✓ "New York Strip" not "NY Steak" in one dish and "New York Strip" in another — pick one
  ✓ "Mashed Potatoes" not "Mashed Potato" sometimes and "Mashed Potatoes" other times
  ✓ "Skirt Steak" not "Beef Skirt Steak" and "Skirt Steak" interchangeably — pick one
  ✓ "Littleneck Clams" not "Clams", "Fresh Clams", and "Littleneck Clams" all for the same item
- Prefer the global library name when a match exists — use it exactly
- Never create two ingredient entries for what is clearly the same ingredient

NO FINISHED GOODS RULE:
- Never use a pre-made, plated, or composite dish as an ingredient (e.g. "Fried Rice", "Caesar Salad", "French Onion Soup")
- Always decompose into raw components:
  ✗ "Fried Rice" → ✓ "Jasmine Rice" + "Eggs" + "Scallions" + "Soy Sauce"
  ✗ "Mashed Potatoes" as a finished good → ✓ "Yukon Gold Potatoes" + "Butter" + "Heavy Cream" (mark prep_type "ask")
  ✗ "House Salad" → ✓ "Mixed Greens" + "Cherry Tomatoes" + etc.
  ✗ "Mac & Cheese" as a purchased item → ✓ "Elbow Macaroni" + "Cheddar Cheese" + "Heavy Cream" + "Butter"

For every dish, list all ingredients needed:
- Match global library ingredients by exact name and unit
- For new ingredients, propose canonical name and unit
- Assign realistic US restaurant wholesale unit cost
- One entry per ingredient — no duplicates
- Units: lb, oz, each, bunch, slice, sheet, sprig only
- Include every ingredient mentioned in dish descriptions
- Break proprietary sauces into likely base components
- Never omit an ingredient — estimate cost if uncertain

Available archetypes: ${ARCHETYPE_NAMES}

PREP TYPE — classify every ingredient with one of three values:
- "purchased": raw commodities, produce, dairy, pre-processed proteins (wings, shrimp, calamari),
  bread products, condiments, oils, spices, and anything that clearly arrives ready to use
- "scratch": nothing — do not assume any prepared item is made from scratch
- "ask": compound preparations that restaurants commonly either make in-house OR buy pre-made:
  sauces (alfredo, marinara, vodka sauce, chimichurri, hollandaise, etc.)
  dressings, stocks, bases, doughs, batters, spice blends, rubs,
  specialty preparations (mashed potatoes, risotto base, guacamole, etc.)

When in doubt between "purchased" and "ask", use "ask".

Return ONLY valid JSON:
{
  "ingredients": [
    { "name": "Mozzarella", "unit": "oz", "estimated_unit_cost": 0.25, "is_new": false, "prep_type": "purchased" },
    { "name": "Alfredo Sauce", "unit": "oz", "estimated_unit_cost": 1.00, "is_new": true, "prep_type": "ask" }
  ],
  "dishes": [
    { "name": "Grilled Chicken Sandwich", "archetype": "Sandwich / Sub", "price": 16.95, "category": "Sandwiches", "description": "Grilled chicken, lettuce, tomato, mayo on a brioche bun" }
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

  console.log(`[pass2] libraryRef: ${ingredientLibrary.length} ingredients, ${libraryRef.length} chars`);

  const systemPrompt = [
    {
      type: 'text',
      text: `You are a restaurant recipe builder. Build complete recipes using only the provided ingredient library and archetype component schemas. Never invent ingredients or costs outside the library.`,
    },
    {
      type: 'text',
      text: `INGREDIENT LIBRARY — copy name, unit, and cost exactly:\n\n${libraryRef}\n\n${'━'.repeat(48)}\nARCHETYPE COMPONENT SCHEMAS\n${'━'.repeat(48)}\n\n${ARCHETYPE_SCHEMA_TEXT}`,
    },
  ];

  const buildDish = async (dish) => {
    const spoonacularRef = spoonacularData[dish.name.toLowerCase()];
    const spoonacularBlock = spoonacularRef
      ? `\nSPOONACULAR REFERENCE INGREDIENTS (use as strong guidance for what belongs in this dish):\n${spoonacularRef.map(i => `- ${i.name}: ${i.amount} ${i.unit}`).join('\n')}`
      : '';

    const dishLine = `"${dish.name}" | section: ${dish.section || 'unknown'} | archetype: ${dish.archetype} | price: ${dish.price ?? 'unknown'} | category: ${dish.category || 'unknown'} | description: ${dish.description || 'none'}${spoonacularBlock}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `Build a complete recipe for this dish. Use archetype schema for components.

DISH: ${dishLine}

RULES:
- Use ONLY ingredients from the library — copy name, unit, estimated_unit_cost exactly
- The ingredient name in your output MUST match the library name character-for-character — no synonyms, no abbreviations, no alternate spellings
- Include all required components; omit optional ones only if clearly not applicable
- Estimate realistic per-serving quantities
- Every ingredient mentioned in the dish description MUST appear in the recipe
- Every component marked "always include" MUST have at least one ingredient
- If a described ingredient has no exact library match, use the closest match by name

NO FINISHED GOODS:
- Never use a pre-made or composite preparation as an ingredient
- If the library contains a finished good like "Fried Rice" or "House Salad" or "Mac & Cheese", decompose it into its raw components instead
- Always build from raw ingredients

COST GUARDRAIL:
After building the recipe, calculate total estimated cost by summing all (quantity × estimated_unit_cost) across all components.
If total cost exceeds 50% of the dish price (${dish.price ?? 'unknown'}), your quantities are too high.
Scale ingredient quantities down proportionally until total cost is at or below 50% of menu price.
Never output a recipe where estimated cost exceeds menu price.

Return ONLY a valid JSON object (not an array):
{
  "name": string,
  "price": number | null,
  "category": string,
  "archetype": string,
  "components": [
    {
      "name": string,
      "ingredients": [
        { "name": string, "unit": string, "quantity": number, "estimated_unit_cost": number }
      ]
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

// ─── Validate and shape raw dishes from pass 2 ───────────────────────────────

function validateDishes(rawDishes) {
  return rawDishes
    .filter(d => d.name && typeof d.name === 'string' && d.name.trim())
    .map(d => {
      const components = (d.components || []).map(c => {
        const ingredients = (c.ingredients || []).map(i => {
          const qty = typeof i.quantity === 'number' ? i.quantity : 0;
          const cost = typeof i.estimated_unit_cost === 'number' ? i.estimated_unit_cost : 0;
          return {
            name: i.name || 'Unknown',
            unit: i.unit || 'each',
            quantity: qty,
            estimated_unit_cost: cost,
            estimated_total_cost: Math.round(qty * cost * 10000) / 10000,
          };
        });
        const componentCost = ingredients.reduce((s, i) => s + i.estimated_total_cost, 0);
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
      const estimatedMargin = price && totalEstimatedCost > 0
        ? Math.round(((price - totalEstimatedCost) / price) * 1000) / 10
        : null;

      return {
        name: d.name.trim(),
        price,
        category: typeof d.category === 'string' ? d.category.trim() : 'Other',
        archetype: typeof d.archetype === 'string' ? d.archetype.trim() : 'Small Plate / Other',
        description: typeof d.description === 'string' ? d.description.trim() : null,
        components,
        total_estimated_cost: Math.round(totalEstimatedCost * 100) / 100,
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

      // ── Chunk large menus so Pass 1 never sees more than ~15 dishes at once ──
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
        const stampedDishManifest = chunkDishManifest.map(dish => Object.assign({}, dish, { section: sectionName }));

        if (!stampedDishManifest?.length) {
          console.warn(`[parse-menu] ${fileLabel}${chunkLabel} No dishes found, skipping`);
          continue;
        }

        // Merge ingredients — later chunks win on price if same name seen before
        for (const ing of chunkIngredients) {
          const key = ing.name.trim().toLowerCase();
          if (!ingredientMap[key]) ingredientMap[key] = ing;
        }

        // ── Match against global recipe library — skip Pass 2 for hits ──
        const matchedDishes = [];
        const unmatchedDishes = [];

        for (const dish of stampedDishManifest) {
          const components = matchRecipe(dish.name, globalRecipes, dish.section || '');
          if (components) {
            console.log(`[recipes] Hit: "${dish.name}"`);
            // Ensure all ingredients in this matched recipe are in ingredientMap
            // so saveToSupabase can resolve their IDs
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
          console.log(`[pass2] ingredient library sample:`, JSON.stringify(chunkIngredients.slice(0, 3)));
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

    const mergedIngredientLibrary = Object.values(ingredientMap);

    console.log(`[parse-menu] Total: ${allDishes.length} dishes, ${mergedIngredientLibrary.length} unique ingredients`);
    const reviewMode = req.query.review === 'true';
    const withMargin = allDishes.filter(d => d.estimated_margin !== null);

    // Review mode: skip Supabase write, return raw dishes for human review
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