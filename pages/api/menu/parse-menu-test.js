// pages/api/menu/parse-menu-test.js
// Two-pass menu parser using Claude Haiku.
// Pass 1: Extract ingredient library from menu images, matched against global_ingredients table.
// Pass 2: Build recipes for every dish using only the unified ingredient library.
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

// ─── PDF → base64 images ────────────────────────────────────────────────────

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

// ─── Safe JSON parser with partial recovery ──────────────────────────────────

function safeParseJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}

  // Try trimming at last complete object
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

// ─── Pass 1: Extract unified ingredient library ──────────────────────────────

async function pass1_extractIngredients(imageContents, globalIngredients) {
  const globalList = globalIngredients
    .map(i => `${i.name} (${i.unit})`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: `You are a restaurant menu ingredient extraction assistant. Your job is to scan a menu and build a unified ingredient library — one canonical entry per ingredient, consistent across all dishes.`,
      },
      {
        type: 'text',
        text: `Here is the global ingredient library. Match ingredients you find in the menu to this list wherever possible. Use the EXACT name and unit from this list when there is a match.\n\n${globalList}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: [
        ...imageContents,
        {
          type: 'text',
          text: `Scan the entire menu. Identify every ingredient that would be needed across all dishes.

For each ingredient:
- If it matches something in the global library, use that EXACT name and unit
- If it is new (not in the global library), propose a clean canonical name and appropriate unit
- Assign a realistic estimated wholesale unit cost in USD based on typical US restaurant purchasing prices

Rules:
- One entry per ingredient — do not duplicate
- Be consistent: if mozzarella appears on multiple dishes, it gets ONE entry
- Use the same name format as the global library where possible (title case, descriptive)
- Units must be one of: lb, oz, each, bunch, slice, sheet, sprig

Return ONLY a valid JSON object in this exact format, nothing else:

{
  "ingredients": [
    {
      "name": "Mozzarella",
      "unit": "oz",
      "estimated_unit_cost": 0.25,
      "is_new": false
    }
  ]
}`,
        },
      ],
    }],
  });

  const raw = response.content[0]?.text || '{}';
  const parsed = safeParseJSON(raw);
  return parsed?.ingredients || [];
}

// ─── Pass 2: Build recipes using the unified ingredient library ───────────────

async function pass2_buildRecipes(imageContents, ingredientLibrary) {
  // Build a clean reference the model can use
  const libraryRef = ingredientLibrary
    .map((ing, idx) => `${idx + 1}. ${ing.name} | ${ing.unit} | $${ing.estimated_unit_cost}/${ing.unit}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    system: [
      {
        type: 'text',
        text: `You are a restaurant menu recipe builder. Your job is to extract every dish from a menu and build its recipe using ONLY the ingredients from the provided library. Do not invent ingredients or costs outside the library.`,
      },
      {
        type: 'text',
        text: `INGREDIENT LIBRARY — use ONLY these ingredients. Reference them exactly by name.\n\n${libraryRef}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: [
        ...imageContents,
        {
          type: 'text',
          text: `Extract every dish from this menu and build its recipe using ONLY the ingredients in the library above.

Return ONLY a valid JSON array, nothing else. Each item must have exactly these fields:

[
  {
    "name": string,
    "price": number | null,
    "category": string,
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
]

Rules:
- Include EVERY dish visible on the menu
- Use ONLY ingredient names from the library — copy them exactly
- Use the exact unit and estimated_unit_cost from the library for each ingredient
- If a dish needs an ingredient not in the library, use the closest match
- Components should reflect how the dish is plated (e.g. Dough, Sauce, Cheese, Toppings for pizza)
- Aim for 2–4 components per dish, 2–5 ingredients per component
- Return ONLY the JSON array, nothing else`,
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
    // ── Build image content blocks ──────────────────────────────────────────
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

    // ── Fetch global ingredient library from Supabase ───────────────────────
    const { data: globalIngredients, error: dbError } = await supabase
      .from('global_ingredients')
      .select('name, unit')
      .order('name');

    if (dbError) {
      console.error('Failed to fetch global ingredients:', dbError);
      return res.status(500).json({ error: 'Failed to load ingredient library.' });
    }

    console.log(`Loaded ${globalIngredients.length} ingredients from global library`);

    // ── Pass 1: Extract unified ingredient library ──────────────────────────
    console.log('Pass 1: Extracting ingredient library...');
    const ingredientLibrary = await pass1_extractIngredients(imageContents, globalIngredients);

    if (!ingredientLibrary || ingredientLibrary.length === 0) {
      return res.status(500).json({ error: 'Could not extract ingredients from menu. Try a clearer image.' });
    }

    console.log(`Pass 1 complete: ${ingredientLibrary.length} ingredients identified`);

    // ── Pass 2: Build recipes using unified library ─────────────────────────
    console.log('Pass 2: Building recipes...');
    const { dishes: rawDishes, truncated } = await pass2_buildRecipes(imageContents, ingredientLibrary);

    if (!rawDishes || !Array.isArray(rawDishes)) {
      return res.status(500).json({ error: 'Failed to build recipes. The menu may be too large — try one section at a time.' });
    }

    console.log(`Pass 2 complete: ${rawDishes.length} dishes built`);

    // ── Validate & compute costs ────────────────────────────────────────────
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