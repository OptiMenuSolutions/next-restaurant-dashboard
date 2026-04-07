// pages/api/menu/parse-menu-test.js
// Two-pass menu parser using Claude Haiku:
//   Pass 1 — Scan menu images → build unified ingredient library + classify every dish into an archetype
//   Pass 2 — Use ingredient library + dish manifest → build recipes using archetype component templates
// NO Supabase writes — dry run only.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Archetype component schema ───────────────────────────────────────────────
// Defines the standard component structure for each dish type.
// optional: true  → omit if the dish clearly does not include that element
// optional: false → always include

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
      .map(c => `    - ${c.name}${c.optional ? ' (optional — omit if clearly not applicable)' : ' (always include)'}`)
      .join('\n');
    return `${name}:\n${compList}`;
  })
  .join('\n\n');

// ─── PDF → base64 images ─────────────────────────────────────────────────────

async function pdfToImages(filePath) {
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

// ─── Safe JSON parser with partial recovery ───────────────────────────────────

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
  return null;
}

// ─── Pass 1: Ingredient library + dish manifest ───────────────────────────────

async function pass1_extractAndClassify(imageContents, globalIngredients) {
  const globalList = globalIngredients
    .map(i => `${i.name} (${i.unit})`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 6000,
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART A — INGREDIENT LIBRARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Identify every ingredient needed across ALL dishes.

CULINARY INFERENCE — critical:
Menus never list everything. Reason about what a chef actually needs.

- Any pizza → MUST include All-Purpose Flour, Olive Oil, Active Dry Yeast, Kosher Salt
- Any burger → MUST include the protein patty AND a bun
- "Filet Mignon with asparagus and peppercorn sauce" → MUST include the filet itself
- Any pasta → MUST include the pasta
- Any sandwich → MUST include the bread
- Any steak/chop/fillet → MUST include that protein cut
- Any salad → MUST include the greens base
- Any risotto → MUST include Arborio Rice, Butter, White Wine, stock, Parmesan
- Any soup → MUST include appropriate stock, aromatics (onion, garlic, butter)

For each ingredient:
- Match to global library if possible — use EXACT name and unit
- If new, propose a canonical name and appropriate unit
- Assign a realistic US restaurant wholesale unit cost
- One entry per ingredient — no duplicates
- Units: lb, oz, each, bunch, slice, sheet, sprig only

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART B — DISH MANIFEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

List every dish with its archetype, price, category, and description.

Available archetypes: ${ARCHETYPE_NAMES}

Classification rules:
- Read dish name first, then description
- "Margherita" on a pizza menu → Pizza
- "Grilled Salmon" → Seafood Entree
- "Chicken Parm" → Chicken Entree
- "Filet Mignon" → Steak / Chop / Fillet
- Wings, bruschetta, calamari → Appetizer
- Tiramisu, cheesecake → Dessert
- Cocktails, sodas, wine → Beverage
- Anything unclear → Small Plate / Other

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RETURN FORMAT — JSON only, nothing else
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "ingredients": [
    {
      "name": "Mozzarella",
      "unit": "oz",
      "estimated_unit_cost": 0.25,
      "is_new": false
    }
  ],
  "dishes": [
    {
      "name": "Red Pizza",
      "archetype": "Pizza",
      "price": 22.00,
      "category": "Pizza",
      "description": "Marinara, fresh mozzarella, fresh basil, grana padano"
    }
  ]
}`,
        },
      ],
    }],
  });

  const raw = response.content[0]?.text || '{}';
  const parsed = safeParseJSON(raw);
  return {
    ingredients: parsed?.ingredients || [],
    dishes: parsed?.dishes || [],
  };
}

// ─── Pass 2: Build recipes from archetype templates ───────────────────────────

async function pass2_buildRecipes(dishManifest, ingredientLibrary) {
  const libraryRef = ingredientLibrary
    .map((ing, idx) => `${idx + 1}. ${ing.name} | ${ing.unit} | $${ing.estimated_unit_cost}/${ing.unit}`)
    .join('\n');

  const dishList = dishManifest
    .map((d, idx) =>
      `${idx + 1}. "${d.name}" | archetype: ${d.archetype} | price: ${d.price ?? 'unknown'} | category: ${d.category || 'unknown'} | description: ${d.description || 'none'}`
    )
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    system: [
      {
        type: 'text',
        text: `You are a restaurant recipe builder. You build complete recipes for every dish using a fixed ingredient library and predefined component schemas per dish archetype. You never invent ingredients or costs outside the library.`,
      },
      {
        type: 'text',
        text: `INGREDIENT LIBRARY — copy name, unit, and cost exactly. Do not alter them.\n\n${libraryRef}\n\n${'━'.repeat(48)}\nARCHETYPE COMPONENT SCHEMAS\n${'━'.repeat(48)}\n\nFor each archetype, build components in the order listed. Omit optional ones only if the dish clearly does not include that element.\n\n${ARCHETYPE_SCHEMA_TEXT}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Build a complete recipe for every dish below. Use the archetype schema to determine components.

DISHES:
${dishList}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each dish:
1. Look up its archetype in the schema
2. Create components in schema order
3. Include all required (non-optional) components always
4. Omit optional components only if the dish clearly lacks that element
5. Fill each component with ingredients from the library

CULINARY INFERENCE — always apply:
- Pizza Dough → All-Purpose Flour, Olive Oil, Active Dry Yeast, Kosher Salt
- Burger Patty → ground protein; Bun → Brioche Bun or Burger Bun
- Steak/Chop/Fillet Protein → must be the named cut as first ingredient
- Risotto Rice Base → Arborio Rice, Butter, White Wine, stock
- Salad Greens → must include the actual greens even if only toppings are described
- Soup Base → appropriate stock, Yellow Onion, Garlic, Butter

INGREDIENT RULES:
- Use ONLY ingredients from the library
- Copy name, unit, and estimated_unit_cost exactly — do not change them
- Use the closest library match if an exact ingredient is not present
- Estimate realistic per-serving quantities

Return ONLY a valid JSON array, nothing else:

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
          {
            "name": string,
            "unit": string,
            "quantity": number,
            "estimated_unit_cost": number
          }
        ]
      }
    ]
  }
]`,
        },
      ],
    }],
  });

  const raw = response.content[0]?.text || '[]';
  return {
    dishes: safeParseJSON(raw),
    truncated: response.stop_reason === 'max_tokens',
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
  let files;
  try {
    [, files] = await form.parse(req);
  } catch {
    return res.status(400).json({ error: 'Failed to parse upload' });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const ext = path.extname(file.originalFilename || '').toLowerCase();
  const isPDF = ext === '.pdf' || file.mimetype === 'application/pdf';
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.mimetype) && !isPDF) {
    return res.status(400).json({ error: 'Unsupported file type. Please upload a JPG, PNG, WEBP, or PDF.' });
  }

  try {
    // ── Build image content blocks ────────────────────────────────────────────
    let imageContents = [];

    if (isPDF) {
      const base64Pages = await pdfToImages(file.filepath);
      if (base64Pages.length === 0) {
        return res.status(500).json({ error: 'Could not extract pages from PDF. Try a different file.' });
      }
      imageContents = base64Pages.map(b64 => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: b64 },
      }));
    } else {
      const data = fs.readFileSync(file.filepath);
      const base64 = data.toString('base64');
      const mediaType =
        ext === '.png'  ? 'image/png'  :
        ext === '.webp' ? 'image/webp' :
        'image/jpeg';
      imageContents = [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }];
    }

    // ── Fetch global ingredient library ───────────────────────────────────────
    const { data: globalIngredients, error: dbError } = await supabase
      .from('global_ingredients')
      .select('name, unit')
      .order('name');

    if (dbError) {
      console.error('Failed to fetch global ingredients:', dbError);
      return res.status(500).json({ error: 'Failed to load ingredient library.' });
    }

    console.log(`Loaded ${globalIngredients.length} ingredients from global library`);

    // ── Pass 1 ────────────────────────────────────────────────────────────────
    console.log('Pass 1: Extracting ingredients and classifying dishes...');
    const { ingredients: ingredientLibrary, dishes: dishManifest } =
      await pass1_extractAndClassify(imageContents, globalIngredients);

    if (!ingredientLibrary || ingredientLibrary.length === 0) {
      return res.status(500).json({ error: 'Could not extract ingredients. Try a clearer image.' });
    }
    if (!dishManifest || dishManifest.length === 0) {
      return res.status(500).json({ error: 'Could not identify dishes. Try a clearer image.' });
    }

    console.log(`Pass 1 complete: ${ingredientLibrary.length} ingredients, ${dishManifest.length} dishes`);

    // ── Pass 2 ────────────────────────────────────────────────────────────────
    console.log('Pass 2: Building recipes from archetype templates...');
    const { dishes: rawDishes, truncated } = await pass2_buildRecipes(dishManifest, ingredientLibrary);

    if (!rawDishes || !Array.isArray(rawDishes)) {
      return res.status(500).json({ error: 'Failed to build recipes. Try uploading one section at a time.' });
    }

    console.log(`Pass 2 complete: ${rawDishes.length} dishes built`);

    // ── Validate & compute costs ──────────────────────────────────────────────
    const validated = rawDishes
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
        const price =
          typeof d.price === 'number' && !isNaN(d.price)
            ? Math.round(d.price * 100) / 100
            : null;
        const estimatedMargin =
          price && totalEstimatedCost > 0
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

    try { fs.unlinkSync(file.filepath); } catch {}

    const withMargin = validated.filter(d => d.estimated_margin !== null);
    const newIngredients = ingredientLibrary.filter(i => i.is_new);

    return res.status(200).json({
      dishes: validated,
      count: validated.length,
      truncated,
      ingredient_library: ingredientLibrary,
      new_ingredients_count: newIngredients.length,
      summary: {
        total_items: validated.length,
        categories: [...new Set(validated.map(d => d.category))].sort(),
        archetypes_used: [...new Set(validated.map(d => d.archetype))].sort(),
        avg_estimated_cost:
          validated.length > 0
            ? Math.round(validated.reduce((s, d) => s + d.total_estimated_cost, 0) / validated.length * 100) / 100
            : 0,
        avg_estimated_margin:
          withMargin.length > 0
            ? Math.round(withMargin.reduce((s, d) => s + d.estimated_margin, 0) / withMargin.length * 10) / 10
            : null,
      },
    });

  } catch (err) {
    console.error('Menu parse error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(500).json({ error: err.message || 'Failed to parse menu' });
  }
}