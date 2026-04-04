// pages/api/menu/parse-menu-test.js
// Extended prompt returning components + ingredients with estimated costs.
// NO Supabase writes — dry run only.

import Anthropic from '@anthropic-ai/sdk';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  // Try pages 1–6, stop when conversion fails or returns nothing
  const images = [];
  for (let i = 1; i <= 6; i++) {
    try {
      const result = await convert(i, { responseType: 'base64' });
      if (result?.base64) {
        images.push(result.base64);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return images;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
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

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          {
            type: 'text',
            text: `You are analyzing a restaurant menu for a food cost management system.

Your job is to:
1. Extract every dish from the menu
2. For each dish, estimate its recipe broken into logical components (e.g. "Protein", "Sauce", "Sides"), and within each component list the key ingredients with realistic estimated costs based on typical US restaurant purchasing prices.

Return ONLY a valid JSON array. No markdown, no explanation, no preamble.

Each item in the array must have exactly these fields:

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

Estimation guidelines for ingredients:
- Ground beef: ~$4.50/lb wholesale
- Chicken breast: ~$3.00/lb
- Salmon fillet: ~$9.00/lb
- Shrimp (16/20): ~$8.00/lb
- Bacon: ~$4.00/lb
- Cheddar cheese: ~$4.50/lb
- Mozzarella: ~$4.00/lb
- Brioche bun: ~$0.45/each
- Burger bun: ~$0.30/each
- Romaine lettuce: ~$1.80/lb
- Tomato: ~$1.20/lb
- Onion: ~$0.60/lb
- Potato (fries portion): ~$0.40/lb
- Pasta (dry): ~$1.20/lb
- Heavy cream: ~$3.50/quart
- Butter: ~$3.50/lb
- Olive oil: ~$8.00/liter
- Flour: ~$0.50/lb
- Eggs: ~$0.25/each
- Mixed greens: ~$4.00/lb
- Avocado: ~$0.80/each
- Lemon: ~$0.40/each
- Garlic: ~$3.00/lb
- For anything not listed, estimate based on typical US restaurant wholesale pricing

Rules:
- Include every item visible on the menu
- Do not include section headers, combos, or add-ons as separate items
- If the same item appears at multiple sizes/prices, include each as a separate entry with size in the name
- Components should reflect how the dish is actually plated (protein + sauce + side for entrees; bread + protein + toppings for sandwiches; etc.)
- Aim for 2–4 components per dish, 2–5 ingredients per component
- Be realistic — a Caesar salad should not have 12 components
- Return ONLY the JSON array, nothing else`,
          },
        ],
      }],
    });

    const rawText = response.content[0]?.text || '[]';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let dishes;
    try {
      dishes = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response as JSON', raw: rawText });
    }

    if (!Array.isArray(dishes)) {
      return res.status(500).json({ error: 'Unexpected response format' });
    }

    const validated = dishes
      .filter(d => d.name && typeof d.name === 'string' && d.name.trim())
      .map(d => {
        const components = (d.components || []).map(c => {
          const ingredients = (c.ingredients || []).map(i => ({
            name: i.name || 'Unknown',
            unit: i.unit || 'each',
            quantity: typeof i.quantity === 'number' ? i.quantity : 0,
            estimated_unit_cost: typeof i.estimated_unit_cost === 'number' ? i.estimated_unit_cost : 0,
            estimated_total_cost:
              typeof i.quantity === 'number' && typeof i.estimated_unit_cost === 'number'
                ? Math.round(i.quantity * i.estimated_unit_cost * 10000) / 10000
                : 0,
          }));
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

    return res.status(200).json({
      dishes: validated,
      count: validated.length,
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
    console.error('Menu parse test error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(500).json({ error: err.message || 'Failed to parse menu' });
  }
}