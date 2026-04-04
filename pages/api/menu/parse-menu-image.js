// pages/api/menu/parse-menu-image.js
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
      imageContents = [{
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      }];
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          {
            type: 'text',
            text: `You are analyzing a restaurant menu. Extract every dish or menu item you can find.

Return ONLY a valid JSON array with no markdown, no explanation, no preamble. Each item must have exactly these fields:
- "name": string (dish name, title case)
- "price": number or null (numeric price, no $ symbol, null if not listed)
- "category": string (e.g. "Appetizers", "Entrees", "Desserts", "Drinks", "Sides", "Salads", "Soups", "Pasta", "Sandwiches", "Pizza", "Breakfast", "Lunch", "Dinner", or your best guess based on the item)
- "description": string or null (brief description if shown on menu, otherwise null)

Rules:
- Include every item you can see, even if price is missing
- Do not include section headers, combo deals, or add-ons as separate items
- If the same item appears multiple times at different prices (e.g. small/large), include each as a separate entry with the size in the name
- Return only the JSON array, nothing else

Example format:
[{"name":"Caesar Salad","price":14.99,"category":"Salads","description":"Romaine, parmesan, croutons"},{"name":"Grilled Salmon","price":28,"category":"Entrees","description":null}]`,
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
      .map(d => ({
        name: d.name.trim(),
        price: typeof d.price === 'number' && !isNaN(d.price) ? Math.round(d.price * 100) / 100 : null,
        category: typeof d.category === 'string' ? d.category.trim() : 'Other',
        description: typeof d.description === 'string' ? d.description.trim() : null,
      }));

    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({ dishes: validated, count: validated.length });

  } catch (err) {
    console.error('Menu parse error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(500).json({ error: err.message || 'Failed to parse menu' });
  }
}