// pages/api/invoices/parse-invoice.js
// Invoice parser using Claude Vision.
// Extracts invoice header + line items, then fuzzy-matches against existing ingredients.
// Returns structured data for client-side confirmation UI — does NOT write to DB.
// The separate /api/invoices/confirm-invoice route handles all DB writes after user confirms.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { logAiUsage } from '../../../lib/logAiUsage';

export const config = { api: { bodyParser: false } };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── PDF → base64 images ──────────────────────────────────────────────────────

// ─── Claude: extract invoice data ─────────────────────────────────────────────
// Handles both PDFs (as document type) and images natively — no pdf2pic needed.

async function extractInvoiceData(fileContent, mediaType, restaurantId) {
  const contentBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileContent } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: fileContent } };

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        {
          type: 'text',
          text: `You are an expert at reading food service supplier invoices. Extract all data from this invoice.

Return ONLY valid JSON with this exact structure:
{
  "supplier": "string — vendor/supplier company name",
  "invoice_number": "string — invoice or order number",
  "invoice_date": "string — date in YYYY-MM-DD format, or null if not found",
  "total_amount": number — total invoice amount as a number, or null,
  "line_items": [
    {
      "item_name": "string — product/ingredient name as written on invoice",
      "quantity": number — quantity ordered,
      "unit": "string — unit of measure (lb, oz, case, each, bag, etc.)",
      "unit_cost": number — cost per unit,
      "line_total": number — total for this line item,
      "category": "string — best guess category: Produce, Protein, Dairy, Dry Goods, Beverage, Supplies, or Other"
    }
  ],
  "confidence": {
    "supplier": "high|medium|low",
    "invoice_number": "high|medium|low",
    "invoice_date": "high|medium|low",
    "total_amount": "high|medium|low"
  },
  "notes": "any important notes or caveats about the extraction"
}

Rules:
- Extract EVERY line item visible on the invoice, even if partial
- For item_name: use the actual product name, not codes or SKUs
- For unit: normalize to standard units (lb, oz, each, case, bag, box, gal, qt, etc.)
- If a field is genuinely not present, use null
- Do not invent or estimate values not visible in the image
- If multiple pages, combine all line items`,
        },
      ],
    }],
  });

  const raw = response.content[0]?.text || '{}';
  
  if (response.stop_reason === 'max_tokens') {
    console.warn('[parse-invoice] Response truncated — max_tokens too low');
    return res.status(500).json({ error: 'Invoice too large to parse in one pass. Try uploading one page at a time.' });
  }

  console.log('[parse-invoice] Raw Claude response:', raw);

  await logAiUsage({
    feature: 'invoice_parse',
    model: 'claude-haiku-4-5-20251001',
    usage: response.usage,
    restaurantId,
  });

  return safeParseJSON(raw);
}

// ─── Safe JSON parser ─────────────────────────────────────────────────────────

function safeParseJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace > 0) {
    try { return JSON.parse(cleaned.slice(0, lastBrace + 1)); } catch {}
  }
  return null;
}

// ─── Normalize ingredient name for matching ───────────────────────────────────

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Fuzzy match score between two strings ────────────────────────────────────

function matchScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const tokensA = new Set(na.split(' '));
  const tokensB = new Set(nb.split(' '));
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = intersection / union;

  const firstA = na.split(' ')[0];
  const firstB = nb.split(' ')[0];
  const firstBonus = firstA === firstB && firstA.length > 3 ? 0.15 : 0;

  return Math.min(1.0, jaccard + firstBonus);
}

// ─── Load restaurant ingredients with their menu item usage ──────────────────

async function loadRestaurantIngredients(restaurantId) {
  const { data: ingredients, error } = await supabase
    .from('ingredients')
    .select('id, name, unit, last_price, last_ordered_at')
    .eq('restaurant_id', restaurantId)
    .order('name');

  if (error) throw new Error('Failed to load ingredients: ' + error.message);
  if (!ingredients?.length) return [];

  const ingredientIds = ingredients.map(i => i.id);

  const { data: ciData } = await supabase
    .from('component_ingredients')
    .select('ingredient_id, menu_item_id')
    .in('ingredient_id', ingredientIds);

  const menuItemIds = [...new Set((ciData || []).map(r => r.menu_item_id).filter(Boolean))];

  let menuNameMap = {};
  if (menuItemIds.length) {
    const { data: menuItems } = await supabase
      .from('menu_items')
      .select('id, name')
      .in('id', menuItemIds);

    for (const m of (menuItems || [])) {
      menuNameMap[m.id] = m.name;
    }
  }

  const usageMap = {};
  for (const row of (ciData || [])) {
    const name = menuNameMap[row.menu_item_id];
    if (name) {
      if (!usageMap[row.ingredient_id]) usageMap[row.ingredient_id] = new Set();
      usageMap[row.ingredient_id].add(name);
    }
  }

  return ingredients.map(ing => ({
    ...ing,
    used_in: usageMap[ing.id] ? [...usageMap[ing.id]] : [],
  }));
}

// ─── Match a line item against restaurant ingredients ─────────────────────────

const HIGH_CONFIDENCE_THRESHOLD = 0.80;
const AMBIGUOUS_THRESHOLD = 0.45;

function matchLineItem(lineItem, restaurantIngredients) {
  if (!restaurantIngredients.length) {
    return { status: 'new', matches: [] };
  }

  const scored = restaurantIngredients
    .map(ing => ({
      ...ing,
      score: matchScore(lineItem.item_name, ing.name),
    }))
    .filter(ing => ing.score >= AMBIGUOUS_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { status: 'new', matches: [] };
  }

  const top = scored[0];

  if (top.score >= HIGH_CONFIDENCE_THRESHOLD) {
    const closeCompetitors = scored.filter(
      (s, i) => i > 0 && s.score >= HIGH_CONFIDENCE_THRESHOLD - 0.15
    );
    if (!closeCompetitors.length) {
      return { status: 'auto', matches: [top] };
    }
  }

  return {
    status: 'ambiguous',
    matches: scored.slice(0, 5),
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch {
    return res.status(400).json({ error: 'Failed to parse upload' });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const restaurantId = Array.isArray(fields.restaurant_id)
    ? fields.restaurant_id[0]
    : fields.restaurant_id;

  const fileUrl = Array.isArray(fields.file_url)
    ? fields.file_url[0]
    : fields.file_url;

  if (!restaurantId) {
    return res.status(400).json({ error: 'restaurant_id is required' });
  }

  const ext = path.extname(file.originalFilename || '').toLowerCase();
  const isPDF = ext === '.pdf' || file.mimetype === 'application/pdf';
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.mimetype) && !isPDF) {
    return res.status(400).json({ error: 'Unsupported file type. Upload JPG, PNG, WEBP, or PDF.' });
  }

  try {
    const fileBuffer = fs.readFileSync(file.filepath);
    const fileBase64 = fileBuffer.toString('base64');

    const mediaType = isPDF ? 'application/pdf'
      : ext === '.png'  ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    console.log('[parse-invoice] File read complete, starting Claude call...');
    const claudeStart = Date.now();
    const extracted = await extractInvoiceData(fileBase64, mediaType, restaurantId);
    console.log(`[parse-invoice] Claude finished in ${Date.now() - claudeStart}ms`);

    if (!extracted) {
      return res.status(500).json({ error: 'Could not parse invoice. Try a clearer image.' });
    }

    console.log(`[parse-invoice] Extracted: supplier=${extracted.supplier}, items=${extracted.line_items?.length}`);

    console.log('[parse-invoice] Loading restaurant ingredients...');
    const restaurantIngredients = await loadRestaurantIngredients(restaurantId);
    console.log(`[parse-invoice] Found ${restaurantIngredients.length} existing ingredients`);

    const lineItemsWithMatches = (extracted.line_items || []).map((item, idx) => {
      const matchResult = matchLineItem(item, restaurantIngredients);
      return {
        _id: `item_${idx}`,
        ...item,
        match_status: matchResult.status,
        match_candidates: matchResult.matches,
        selected_ingredient_id: matchResult.status === 'auto'
          ? matchResult.matches[0]?.id
          : null,
        selected_ingredient_name: matchResult.status === 'auto'
          ? matchResult.matches[0]?.name
          : null,
      };
    });

    const autoCount      = lineItemsWithMatches.filter(i => i.match_status === 'auto').length;
    const ambiguousCount = lineItemsWithMatches.filter(i => i.match_status === 'ambiguous').length;
    const newCount       = lineItemsWithMatches.filter(i => i.match_status === 'new').length;
    const needsReview    = ambiguousCount > 0 || newCount > 0;

    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({
      success: true,
      file_url: fileUrl || null,
      invoice: {
        supplier:       extracted.supplier,
        invoice_number: extracted.invoice_number,
        invoice_date:   extracted.invoice_date,
        total_amount:   extracted.total_amount,
        confidence:     extracted.confidence || {},
        notes:          extracted.notes || null,
      },
      line_items: lineItemsWithMatches,
      summary: {
        total_items:          lineItemsWithMatches.length,
        auto_matched:         autoCount,
        needs_review:         ambiguousCount,
        new_ingredients:      newCount,
        requires_confirmation: needsReview,
      },
    });

  } catch (err) {
    console.error('[parse-invoice] Error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(500).json({ error: err.message || 'Failed to parse invoice' });
  }
}