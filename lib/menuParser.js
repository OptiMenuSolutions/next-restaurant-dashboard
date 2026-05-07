// lib/menuParser.js
// Shared logic for the two-route menu parser.
// Extracted verbatim from pages/api/menu/parse-menu.js — no logic changes.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { logAiUsage } from './logAiUsage';

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const supabase = createClient(
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

export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES).join(', ');
export const ARCHETYPE_SCHEMA_TEXT = Object.entries(ARCHETYPES)
  .map(([name, components]) => {
    const compList = components
      .map(c => `    - ${c.name}${c.optional ? ' (optional)' : ' (always include)'}`)
      .join('\n');
    return `${name}:\n${compList}`;
  })
  .join('\n\n');

// ─── PDF → base64 images ──────────────────────────────────────────────────────

export async function pdfToImages(filePath) {
  const { fromPath } = await import('pdf2pic');
  const convert = fromPath(filePath, {
    density: 150,
    saveFilename: 'page',
    savePath: '/tmp',
    format: 'png',
    width: 1200,
    height: 1600,
  });
  const images = [];
  for (let i = 1; i <= 6; i++) {
    try {
      const result = await convert(i, { responseType: 'base64' });
      if (result?.base64) images.push(result.base64);
      else break;
    } catch { break; }
  }
  return images;
}

// ─── Single file → imageContents array ───────────────────────────────────────

export async function fileToImageContents(file) {
  const ext = path.extname(file.originalFilename || '').toLowerCase();
  const isPDF = ext === '.pdf' || file.mimetype === 'application/pdf';

  if (isPDF) {
    const base64Pages = await pdfToImages(file.filepath);
    return base64Pages.map(b64 => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    }));
  }

  const data = fs.readFileSync(file.filepath);
  const base64 = data.toString('base64');
  const mediaType =
    ext === '.png'  ? 'image/png'  :
    ext === '.webp' ? 'image/webp' :
    'image/jpeg';
  return [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }];
}

// ─── Safe JSON parser ─────────────────────────────────────────────────────────

export function safeParseJSON(text) {
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
    let i = arrOpen + 1;
    let depth = 0;
    let start = -1;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '{') { if (depth === 0) start = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try { entries.push(JSON.parse(str.slice(start, i + 1))); } catch {}
          start = -1;
        }
      }
      i++;
    }
    return entries;
  }

  const ingredients = extractObjects(cleaned, 'ingredients');
  if (ingredients.length > 0) {
    const dishes = extractObjects(cleaned, 'dishes');
    console.warn('[safeParseJSON] Salvaged ' + ingredients.length + ' ingredients, ' + dishes.length + ' dishes from truncated response');
    return { ingredients, dishes };
  }

  return null;
}

// ─── Pass 1: Ingredient library + dish manifest ───────────────────────────────

export async function pass1_extractAndClassify(imageContents, globalIngredients, restaurantId) {
  const globalList = globalIngredients.map(i => `${i.name} (${i.unit})`).join('\n');

  const stream = anthropic.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64000,
    system: [
      {
        type: 'text',
        text: `You are a restaurant menu analyst. In one pass you do two things:
1. Build a unified ingredient library covering everything needed across all dishes
2. Classify every dish into a named archetype and record its basic details

You reason about what is actually on each plate — not just what is written in descriptions.`,
      },
      {
        type: 'text',
        text: `GLOBAL INGREDIENT LIBRARY — match against this wherever possible. Use EXACT name and unit.\n\n${globalList}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: [
        ...imageContents,
        {
          type: 'text',
          text: `Scan the entire menu. Return a JSON object with two keys: "ingredients" and "dishes".

PART A — INGREDIENT LIBRARY
Identify every ingredient needed across ALL dishes. For each:
- Match to global library if possible — use EXACT name and unit
- If new, propose a canonical name and appropriate unit
- Assign a realistic US restaurant wholesale unit cost
- One entry per ingredient — no duplicates
- Units: lb, oz, each, bunch, slice, sheet, sprig only

CULINARY INFERENCE — you must infer ingredients not explicitly listed:
- Any pizza → include All-Purpose Flour, Olive Oil, Active Dry Yeast, Kosher Salt
- Any burger → include the protein patty AND a bun
- Any pasta → include the pasta itself
- Any sandwich → include the bread
- Any steak/chop/fillet → include that protein cut
- Any salad → include the greens base
- Any risotto → include Arborio Rice, Butter, White Wine, stock, Parmesan
- Any soup → include appropriate stock, aromatics (onion, garlic, butter)

CRITICAL RULES FOR INGREDIENTS:
- You MUST include every ingredient mentioned in the dish description, no exceptions
- You MUST include every inferred ingredient based on the dish type above
- For house-made or proprietary sauces (e.g. "echo bbq sauce", "addams sauce"), break them down into their likely base ingredients — do not skip them
- For vague descriptors (e.g. "light pink sauce"), infer the most likely components (e.g. tomato sauce, heavy cream) and include those
- If you are uncertain about a cost, still include the ingredient with your best estimate — never omit an ingredient due to uncertainty
- Every ingredient must have a non-null estimated_unit_cost, even if it is a rough guess

PART B — DISH MANIFEST
CRITICAL RULES — read before listing any dish:
- List ONLY dishes explicitly printed on the menu images. Do NOT invent, infer, or hallucinate any dish not literally visible on the menu.
- Do NOT list section headers, category titles, or labels (e.g. "Signature Starters", "Entrees", "South of the Border", "Burgers", "Salads") — these are organizational headings, not dishes.
- Do NOT list sauce options, add-ons, or modifiers listed under a dish (e.g. wing sauce flavors, burger add-on prices, dressing choices) — these are ingredients on the parent dish, not separate dishes.
- Do NOT add dishes based on your knowledge of similar restaurants. If it is not on this menu, it does not exist.
- If you cannot clearly read a dish name, skip it rather than guess.
Available archetypes: ${ARCHETYPE_NAMES}

DISH NAME FORMATTING — apply to every dish name:
- Use title case: capitalize the first letter of each word, lowercase the rest
- Exception: preserve all-caps sequences that are clearly acronyms or initialisms (e.g. BLT, BBQ, NYC, PEI, BLTA)
- If the menu uses ALL CAPS or all lowercase for a name, reformat it — do not copy the raw casing
- Examples: "GRILLED CHICKEN SANDWICH" → "Grilled Chicken Sandwich", "b.l.t. club" → "BLT Club", "NYC strip steak" → "NYC Strip Steak"

Return ONLY valid JSON:
{
  "ingredients": [
    { "name": "Mozzarella", "unit": "oz", "estimated_unit_cost": 0.25, "is_new": false }
  ],
  "dishes": [
    { "name": "Red Pizza", "archetype": "Pizza", "price": 22.00, "category": "Pizza", "description": "Marinara, fresh mozzarella, fresh basil" }
  ]
}`,
        },
      ],
    }],
  });
  const response = await stream.finalMessage();

  await logAiUsage({
    feature: 'menu_import',
    model: 'claude-haiku-4-5-20251001',
    usage: response.usage,
    restaurantId,
  });

  const raw = response.content[0]?.text || '{}';

  console.log(`[pass1] stop_reason: ${response.stop_reason}`);
  console.log(`[pass1] usage: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);

  if (response.stop_reason === 'max_tokens') {
    console.warn('[pass1] WARNING: response was truncated — JSON may be incomplete');
  }

  const parsed = safeParseJSON(raw);

  if (!parsed) {
    console.error('[pass1] safeParseJSON returned null. Full raw response:', raw);
  } else {
    console.log(`[pass1] parsed: ${parsed.ingredients?.length ?? 0} ingredients, ${parsed.dishes?.length ?? 0} dishes`);
  }

  return {
    ingredients: parsed?.ingredients || [],
    dishes: parsed?.dishes || [],
  };
}

// ─── Pass 2: Build recipes ────────────────────────────────────────────────────

export async function pass2_buildRecipes(dishManifest, ingredientLibrary, restaurantId) {
  const libraryRef = ingredientLibrary
    .map((ing, idx) => `${idx + 1}. ${ing.name} | ${ing.unit} | $${ing.estimated_unit_cost}/${ing.unit}`)
    .join('\n');

  const dishList = dishManifest
    .map((d, idx) =>
      `${idx + 1}. "${d.name}" | archetype: ${d.archetype} | price: ${d.price ?? 'unknown'} | category: ${d.category || 'unknown'} | description: ${d.description || 'none'}`
    )
    .join('\n');

  const stream = anthropic.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64000,
    system: [
      {
        type: 'text',
        text: `You are a restaurant recipe builder. Build complete recipes using only the provided ingredient library and archetype component schemas. Never invent ingredients or costs outside the library.`,
      },
      {
        type: 'text',
        text: `INGREDIENT LIBRARY — copy name, unit, and cost exactly:\n\n${libraryRef}\n\n${'━'.repeat(48)}\nARCHETYPE COMPONENT SCHEMAS\n${'━'.repeat(48)}\n\n${ARCHETYPE_SCHEMA_TEXT}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Build a complete recipe for every dish. Use archetype schema for components.

DISHES:
${dishList}

RULES:
- Use ONLY ingredients from the library — copy name, unit, estimated_unit_cost exactly
- Include all required components; omit optional ones only if clearly not applicable
- Estimate realistic per-serving quantities
- CRITICAL: Every ingredient mentioned in the dish description MUST appear somewhere in that dish's components — do not drop any described ingredient
- CRITICAL: Every component marked "always include" in the archetype schema MUST have at least one ingredient
- If a dish description mentions an ingredient that is not in the library, flag it by using the closest library match and noting the discrepancy in a comment field — do not silently omit it

Return ONLY a valid JSON array:
[
  {
    "name": string,
    "price": number | null,
    "category": string,
    "archetype": string,
    "description": string | null,
    "components": [
      {
        "name": string,
        "ingredients": [
          { "name": string, "unit": string, "quantity": number, "estimated_unit_cost": number }
        ]
      }
    ]
  }
]`,
      }],
    }],
  });
  const response = await stream.finalMessage();

  await logAiUsage({
    feature: 'menu_import',
    model: 'claude-haiku-4-5-20251001',
    usage: response.usage,
    restaurantId,
  });

  const raw = response.content[0]?.text || '[]';
  return {
    dishes: safeParseJSON(raw),
    truncated: response.stop_reason === 'max_tokens',
  };
}

// ─── Validate and shape raw dishes from pass 2 ───────────────────────────────

export function validateDishes(rawDishes) {
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

export async function saveToSupabase(restaurantId, parsedDishes, ingredientLibrary) {
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