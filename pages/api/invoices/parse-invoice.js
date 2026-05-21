// pages/api/invoices/parse-invoice.js
// Invoice parser: Google Vision OCR → Claude Sonnet extraction.
// Extracts invoice header + line items with cost_per_lb derivation.
// Returns structured data for client-side confirmation UI.
// The separate /api/invoices/confirm-invoice route handles all DB writes.

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

// ─── Google Vision OCR ────────────────────────────────────────────────────────

async function extractTextWithVision(fileBuffer, mediaType) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY is not set');

  const base64Image = fileBuffer.toString('base64');

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
  console.log(`[vision] Extracted ${text.length} characters`);
  return text;
}

// ─── Safe JSON parser ─────────────────────────────────────────────────────────

function safeParseJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const stripped = firstBrace !== -1 && lastBrace !== -1
    ? cleaned.slice(firstBrace, lastBrace + 1)
    : cleaned;
  try { return JSON.parse(stripped); } catch {}
  const lastBraceIdx = stripped.lastIndexOf('}');
  if (lastBraceIdx > 0) {
    try { return JSON.parse(stripped.slice(0, lastBraceIdx + 1)); } catch {}
  }
  console.warn('[parse-invoice] safeParseJSON failed. Raw preview:', text?.slice(0, 300));
  return null;
}

// ─── Claude Sonnet: extract invoice data from OCR text ───────────────────────

async function extractInvoiceData(ocrText, restaurantId) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `You are an expert at reading food service supplier invoices. You have been given raw text extracted by OCR from a supplier invoice. Your job is to extract every line item and determine the cost per standard unit for each food ingredient.

Here is the raw OCR text from the invoice:

---
${ocrText}
---

════════════════════════════════════════
STEP 1 — IDENTIFY THE INVOICE STRUCTURE
════════════════════════════════════════

First, identify the supplier and understand the invoice format:
- What does the PRICE or UNIT COST column represent? ($/lb, $/case, $/each, $/gallon, etc.)
- Is there a separate WEIGHT or LBS column showing total weight delivered?
- Is there a PACK SIZE column? What format does it use?
- Is there an AMOUNT or EXTENDED column showing the line total?

Different suppliers use different formats. Common patterns:
- Some suppliers price by lb directly (PRICE = $/lb, LBS column = total weight)
- Some suppliers price by case (UNIT PRICE = $/case, PACK SIZE tells you what's in the case)
- Some suppliers price by each, gallon, or other units

════════════════════════════════════════
STEP 2 — EXTRACT EACH LINE ITEM
════════════════════════════════════════

For each line item, extract all available data and derive cost_per_lb or cost_per_each.

COST DERIVATION HIERARCHY — use the first method that applies:

METHOD 1 (most reliable): Direct weight pricing
If the invoice has a weight/LBS column AND a price column that is clearly $/lb:
  cost_per_lb = price_column_value
  confidence = "high"

METHOD 2 (reliable when weight column exists): Total cost ÷ total weight
If you have both line_total AND total_weight_lbs from a weight column:
  cost_per_lb = line_total ÷ total_weight_lbs
  confidence = "high"

METHOD 3 (requires pack size interpretation): Unit price ÷ lbs per unit
If you have unit_price and must derive from pack size:
  - Use your food service knowledge to interpret the pack size
  - "4/10 LB" = 4 units × 10 lb each = 40 lb/case → cost_per_lb = unit_price ÷ 40
  - "6/" with no weight = ambiguous, use common sense for this product type
  - Validate by checking: does the derived cost_per_lb make sense for this ingredient?
    (Chicken breast $3-6/lb, beef $5-15/lb, produce $0.50-5/lb, seafood $5-30/lb, etc.)
  - If derived price seems wrong, try the other interpretation
  confidence = "medium" if you're confident in interpretation, "low" if guessing

METHOD 4: Count-based items (eggs, lobster tails, avocados, etc.)
If the item is naturally counted rather than weighed:
  cost_per_each = unit_price ÷ count_per_case (if applicable)
  Set cost_per_lb = null, standard_unit = "each"
  confidence = "high" if count is clear

METHOD 5: Cannot determine
If you genuinely cannot derive cost_per_lb or cost_per_each with reasonable confidence:
  Set cost_per_lb = null, cost_per_each = null
  confidence = "low"
  Explain in confidence_reason

FOOD vs NON-FOOD CLASSIFICATION:
Mark is_food = false for:
- Cleaning supplies (bleach, sanitizer, soap, degreasers, glass cleaner)
- Paper products (napkins, toilet paper, paper towels, to-go containers, cups)
- Kitchen equipment or supplies (scrubbers, brushes, gloves)
- Fuel surcharges, delivery fees, taxes, adjustments
- Decorative items, toothpicks, bamboo skewers used as decorations
Mark is_food = true for:
- All food ingredients, even if processed (frozen fries, pre-made sauces, spice blends)
- Cooking oils, vinegars, condiments
- Food packaging that is part of the product (sausage casings, etc.)
When in doubt, mark is_food = true

INGREDIENT NAME NORMALIZATION:
Convert supplier abbreviations to standard chef-readable names:
- "CHIX BRS BNLS SKNLS" → "Chicken Breast Boneless Skinless"
- "2OZ SLIDER SUPER THICK" → "Beef Slider Patty 2oz"
- "SALMON FILLET S/ON 3-4 PREMIUM PC" → "Salmon Fillet Skin-On 3-4oz"
- "21-25 T/ON White India 5/2" → "Shrimp 21-25ct Tail-On White"
- "BABY BACK RIBS IBP" → "Baby Back Ribs"
- Preserve size/count information that is useful (e.g. "7oz", "21-25ct")
- Remove supplier codes, brand names, and origin unless relevant

════════════════════════════════════════
STEP 3 — OUTPUT FORMAT
════════════════════════════════════════

Return ONLY valid JSON with this exact structure:

{
  "supplier": "string — supplier company name",
  "invoice_number": "string — invoice or order number",
  "invoice_date": "string — YYYY-MM-DD format, or null",
  "total_amount": number or null,
  "format_notes": "brief description of the invoice format you identified — e.g. 'Price column is $/lb, LBS column is total weight delivered'",
  "line_items": [
    {
      "item_name_raw": "string — exact text from invoice",
      "item_name_normalized": "string — clean chef-readable name",
      "is_food": boolean,
      "quantity_ordered": number or null,
      "quantity_unit": "string — CS, LB, PC, EA, GA, etc. or null",
      "pack_size_raw": "string — pack size as written, or null if not present",
      "total_weight_lbs": number or null,
      "unit_price": number or null,
      "line_total": number or null,
      "cost_per_lb": number or null,
      "cost_per_each": number or null,
      "standard_unit": "lb | oz | each | gal | case",
      "confidence": "high | medium | low",
      "confidence_reason": "string explaining uncertainty, or null if high confidence"
    }
  ],
  "confidence": {
    "supplier": "high | medium | low",
    "invoice_number": "high | medium | low",
    "invoice_date": "high | medium | low",
    "total_amount": "high | medium | low"
  }
}

IMPORTANT RULES:
- Extract EVERY line item, including non-food items (mark them is_food: false)
- Never invent or estimate values not present or derivable from the invoice
- Never output a cost_per_lb that you are not at least medium confidence about
- If OCR text is garbled or a field is truly unreadable, use null
- Do not include outstanding balance lines, previous invoice references, or payment history as line items`,
      }],
    }],
  });

  await logAiUsage({
    feature: 'invoice_parse',
    model: 'claude-sonnet-4-6',
    usage: response.usage,
    restaurantId,
  });

  console.log(`[parse-invoice] Sonnet stop_reason: ${response.stop_reason} | input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);

  if (response.stop_reason === 'max_tokens') {
    throw new Error('Invoice too large to parse in one pass. Try uploading one page at a time.');
  }

  const raw = response.content[0]?.text || '{}';
  return safeParseJSON(raw);
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

// ─── Load restaurant ingredients with menu item usage ────────────────────────

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
    .select('ingredient_id, component_id')
    .in('ingredient_id', ingredientIds);

  if (!ciData?.length) return ingredients.map(ing => ({ ...ing, used_in: [] }));

  const componentIds = [...new Set(ciData.map(r => r.component_id).filter(Boolean))];

  const { data: components } = await supabase
    .from('menu_item_components')
    .select('id, menu_item_id')
    .in('id', componentIds);

  const compToMenuItem = {};
  for (const c of (components || [])) {
    compToMenuItem[c.id] = c.menu_item_id;
  }

  const menuItemIds = [...new Set(Object.values(compToMenuItem).filter(Boolean))];

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
  for (const row of ciData) {
    const menuItemId = compToMenuItem[row.component_id];
    const dishName = menuNameMap[menuItemId];
    if (dishName) {
      if (!usageMap[row.ingredient_id]) usageMap[row.ingredient_id] = new Set();
      usageMap[row.ingredient_id].add(dishName);
    }
  }

  return ingredients.map(ing => ({
    ...ing,
    used_in: usageMap[ing.id] ? [...usageMap[ing.id]] : [],
  }));
}

// ─── Match a line item against restaurant ingredients ─────────────────────────
// Higher auto-confirm threshold (0.90) since wrong ingredient matches
// corrupt cost calculations silently.

const AUTO_THRESHOLD      = 0.90;
const AMBIGUOUS_THRESHOLD = 0.45;

function matchLineItem(lineItem, restaurantIngredients) {
  if (!restaurantIngredients.length) {
    return { status: 'new', matches: [] };
  }

  // Only match food items
  if (!lineItem.is_food) {
    return { status: 'non_food', matches: [] };
  }

  const scored = restaurantIngredients
    .map(ing => ({
      ...ing,
      score: matchScore(lineItem.item_name_normalized || lineItem.item_name_raw, ing.name),
    }))
    .filter(ing => ing.score >= AMBIGUOUS_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { status: 'new', matches: [] };
  }

  const top = scored[0];

  if (top.score >= AUTO_THRESHOLD) {
    const closeCompetitors = scored.filter(
      (s, i) => i > 0 && s.score >= AUTO_THRESHOLD - 0.10
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

// ─── Duplicate invoice check ──────────────────────────────────────────────────

async function checkDuplicateInvoice(restaurantId, supplier, invoiceNumber) {
  if (!invoiceNumber) return false;

  const { data } = await supabase
    .from('invoices')
    .select('id, date')
    .eq('restaurant_id', restaurantId)
    .eq('number', invoiceNumber)
    .maybeSingle();

  if (data) {
    console.warn(`[parse-invoice] Duplicate invoice detected: ${invoiceNumber} (id: ${data.id})`);
    return { duplicate: true, existing_id: data.id, existing_date: data.date };
  }

  return false;
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

    const mediaType = isPDF ? 'application/pdf'
      : ext === '.png'  ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    // ── Step 1: OCR ──────────────────────────────────────────────────────────
    console.log('[parse-invoice] Running Vision OCR...');
    const t0 = Date.now();
    const ocrText = await extractTextWithVision(fileBuffer, mediaType);
    console.log(`[parse-invoice] OCR done in ${Date.now() - t0}ms`);

    if (!ocrText || ocrText.length < 50) {
      try { fs.unlinkSync(file.filepath); } catch {}
      return res.status(400).json({ error: 'Could not extract text from image. Try a clearer photo.' });
    }

    // ── Step 2: Claude Sonnet extraction ─────────────────────────────────────
    console.log('[parse-invoice] Running Sonnet extraction...');
    const t1 = Date.now();
    const extracted = await extractInvoiceData(ocrText, restaurantId);
    console.log(`[parse-invoice] Sonnet extraction done in ${Date.now() - t1}ms`);

    if (!extracted) {
      try { fs.unlinkSync(file.filepath); } catch {}
      return res.status(500).json({ error: 'Could not parse invoice structure. Try a clearer image.' });
    }

    // ── Step 3: Duplicate check ───────────────────────────────────────────────
    const duplicateCheck = await checkDuplicateInvoice(
      restaurantId,
      extracted.supplier,
      extracted.invoice_number
    );

    // ── Step 4: Load restaurant ingredients + match ───────────────────────────
    const restaurantIngredients = await loadRestaurantIngredients(restaurantId);

    // Only process food items — filter non-food before matching
    const allLineItems = extracted.line_items || [];
    const foodItems = allLineItems.filter(i => i.is_food);
    const nonFoodItems = allLineItems.filter(i => !i.is_food);

    console.log(`[parse-invoice] ${allLineItems.length} total items: ${foodItems.length} food, ${nonFoodItems.length} non-food`);

    const lineItemsWithMatches = foodItems.map((item, idx) => {
      const matchResult = matchLineItem(item, restaurantIngredients);

      // Flag items that need review:
      // - No cost_per_lb and no cost_per_each (chef must enter manually)
      // - Low confidence on cost derivation
      // - Ambiguous ingredient match
      const needsCostInput = !item.cost_per_lb && !item.cost_per_each;
      const needsReview = needsCostInput
        || item.confidence === 'low'
        || matchResult.status === 'ambiguous'
        || matchResult.status === 'new';

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
        needs_cost_input: needsCostInput,
        needs_review: needsReview,
      };
    });

    // ── Step 5: Summary ───────────────────────────────────────────────────────
    const autoCount       = lineItemsWithMatches.filter(i => i.match_status === 'auto' && !i.needs_review).length;
    const ambiguousCount  = lineItemsWithMatches.filter(i => i.match_status === 'ambiguous').length;
    const newCount        = lineItemsWithMatches.filter(i => i.match_status === 'new').length;
    const lowConfCount    = lineItemsWithMatches.filter(i => i.confidence === 'low').length;
    const noCostCount     = lineItemsWithMatches.filter(i => i.needs_cost_input).length;

    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({
      success: true,
      file_url: fileUrl || null,
      duplicate: duplicateCheck || false,
      invoice: {
        supplier:       extracted.supplier,
        invoice_number: extracted.invoice_number,
        invoice_date:   extracted.invoice_date,
        total_amount:   extracted.total_amount,
        format_notes:   extracted.format_notes || null,
        confidence:     extracted.confidence || {},
      },
      line_items: lineItemsWithMatches,
      non_food_items: nonFoodItems,
      ocr_text: ocrText, // include raw OCR so confirm modal can display it if needed
      summary: {
        total_items:          allLineItems.length,
        food_items:           foodItems.length,
        non_food_items:       nonFoodItems.length,
        auto_matched:         autoCount,
        needs_review:         ambiguousCount + newCount,
        low_confidence_cost:  lowConfCount,
        needs_cost_input:     noCostCount,
        requires_confirmation: ambiguousCount > 0 || newCount > 0 || lowConfCount > 0 || noCostCount > 0,
      },
    });

  } catch (err) {
    console.error('[parse-invoice] Error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(500).json({ error: err.message || 'Failed to parse invoice' });
  }
}