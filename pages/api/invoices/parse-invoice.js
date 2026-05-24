// pages/api/invoices/parse-invoice.js
// Invoice parser: Claude Sonnet vision → structured extraction.
// Sends invoice images directly to Claude — no intermediate OCR step.
// Returns structured data for client-side confirmation UI.
// The separate /api/invoices/confirm-invoice route handles all DB writes.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { logAiUsage } from '../../../lib/logAiUsage';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
  maxDuration: 300,
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// ─── Claude Sonnet vision: extract invoice data directly from image ────────────

async function extractInvoiceData(fileBuffer, mediaType, restaurantId) {
  const base64Image = fileBuffer.toString('base64');

  const response = await anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 20000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Image,
          },
        },
        {
          type: 'text',
          text: `You are an expert at reading food service supplier invoices. You are looking directly at an invoice image. Your job is to read every line item exactly as printed and extract structured data.

CRITICAL: Output ONLY raw JSON. No preamble, no explanation, no markdown fences. Start your response with { and end with }.

════════════════════════════════════════
STEP 1 — READ THE INVOICE STRUCTURE
════════════════════════════════════════

Look at the column headers on this invoice and identify:
1. What does the UNIT COST column represent? (per case, per lb, per each, per gallon?)
2. Is there a WEIGHT column showing actual delivered weight in lbs?
3. What does the PACK SIZE column look like? (e.g. "36 1 LB" = 36 units × 1 lb each)
4. Is there an EXTENDED or AMOUNT column showing the line total?

MAXIMUM QUALITY FOODS invoices (common format you will see):
- UNIT COST = price per CASE (not per lb)
- PACK SIZE encodes "pack × size unit" e.g. "36 1 LB" means 36 units, 1 lb each
- WEIGHT column = actual delivered lbs for catch-weight items (block cheeses, deli meats)
- EXTENDED = line total = quantity shipped × unit cost per case
- Columns: LOC | ORD | SHP | ITEM# | PACK SIZE | BRAND | DESCRIPTION | VEN ITEM# | WEIGHT | UNIT COST | EXTENDED

════════════════════════════════════════
STEP 2 — EXTRACT EACH LINE ITEM
════════════════════════════════════════

For EVERY line item, read the values DIRECTLY from the image. Do not estimate or infer pack/size — read them exactly as printed.

PACK SIZE PARSING — read carefully:
"4 1 GAL"    → pack=4, size=1, size_unit="gal"
"36 1 LB"    → pack=36, size=1, size_unit="lb"
"8 6 LB"     → pack=8, size=6, size_unit="lb"
"6 5 LB"     → pack=6, size=5, size_unit="lb"
"12 12 CT"   → pack=12, size=12, size_unit="ct"
"6 #10 CAN"  → pack=6, size=1, size_unit="each" (standard #10 can)
"1 50 LBS"   → pack=1, size=50, size_unit="lb"
"20 200 CT"  → pack=20, size=200, size_unit="ct"
"2 10 LB"    → pack=2, size=10, size_unit="lb"
"6 2 LTR"    → pack=6, size=2, size_unit="l"
"4 4 GAL"    → pack=4, size=4, size_unit="gal"
"1 2000 CT"  → pack=1, size=2000, size_unit="ct"

UNIT COST on this invoice format = price per CASE. invoice_price = the UNIT COST column value.

CATCH-WEIGHT ITEMS:
Some items (block cheeses, deli meats) have a WEIGHT column with the actual delivered lbs.
For these items:
  catch_weight = true
  actual_weight = the value in the WEIGHT column
  invoice_price = the UNIT COST column value (which is $/lb for these items)
  pack = null, size = null

How to identify catch-weight: the WEIGHT column has a value AND the unit cost is clearly a per-lb price (typically $2-15/lb range for cheese/meat). If UNIT COST is clearly a per-case price ($20-200), it is NOT catch-weight even if a weight column value exists.

MANDATORY MATH VALIDATION — do this for EVERY item before outputting:

For standard (non-catch-weight) items:
  expected_total = quantity_shipped × invoice_price
  Does expected_total ≈ line_total? (within $0.10)
  → YES: confidence = "high", proceed
  → NO: You have a reading error. Try these in order:
      1. Re-read invoice_price — did you grab a number from the wrong column or wrong row?
      2. Re-read quantity_shipped — is it different from quantity_ordered?
      3. Re-read line_total — is it actually from this row or the row above/below?
      After correction, if expected_total still doesn't match, set confidence = "low" and explain.

For catch-weight items:
  expected_total = actual_weight × invoice_price
  Does expected_total ≈ line_total? (within $0.10)
  → YES: confidence = "high", proceed
  → NO: Re-read actual_weight and invoice_price. If still wrong, set confidence = "low".

NEVER output an item where the math is wrong and confidence is "high". A math mismatch ALWAYS means at least "medium" confidence, and requires a re-read attempt first.

ROW ISOLATION — read one row at a time:
Each line item's numbers (pack size, unit cost, extended) ONLY come from that item's own row.
Never use a number from an adjacent row. If you are unsure which row a number belongs to, 
trace it horizontally across the full row before assigning it.

FOOD vs NON-FOOD:
is_food = false for: cleaning supplies, paper products, plastic wrap, foil, garbage bags, gloves, equipment, fuel surcharges, delivery fees, taxes
is_food = true for: all food ingredients, cooking oils, condiments, beverages, spices, dairy, produce, meat, seafood, frozen foods, baking ingredients

INGREDIENT NAME NORMALIZATION:
Convert supplier abbreviations to clean chef-readable names:
"CHIX BRS BNLS SKNLS" → "Chicken Breast Boneless Skinless"
"CHDR LF YLW" → "Cheddar Cheese Yellow Loaf"
"MOZZ WM LF" → "Mozzarella Whole Milk Loaf"
"CLR 18 X 2000" → skip — this is plastic film wrap (non-food)
"COSMO'S HOT CHERRY SLICED PEPPER" → "Cherry Peppers Sliced Hot"
Preserve size/count info useful for a chef (e.g. "7oz", "21-25ct", "#10 Can")
Remove vendor codes, item numbers from the name

════════════════════════════════════════
STEP 3 — OUTPUT FORMAT
════════════════════════════════════════

{
  "supplier": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "format_notes": "brief description of what UNIT COST represents on this invoice",
  "columns": [
    {
      "key": "string",
      "label": "string",
      "editable": boolean,
      "type": "number | text"
    }
  ],
  "line_items": [
    {
      "item_name_raw": "exact text from invoice",
      "item_name_normalized": "clean chef-readable name",
      "is_food": boolean,
      "quantity_ordered": number or null,
      "quantity_shipped": number or null,
      "quantity_unit": "CS | LB | EA | GA or null",
      "pack_size_raw": "pack size as printed, e.g. '36 1 LB'",
      "pack": number or null,
      "size": number or null,
      "size_unit": "lb | oz | each | gal | l | ct | fl oz",
      "invoice_price": number or null,
      "line_total": number or null,
      "catch_weight": boolean,
      "actual_weight": number or null,
      "standard_unit": "lb | oz | each | gal | case",
      "confidence": "high | medium | low",
      "confidence_reason": "string if not high, otherwise null"
    }
  ],
  "confidence": {
    "supplier": "high | medium | low",
    "invoice_number": "high | medium | low",
    "invoice_date": "high | medium | low",
    "total_amount": "high | medium | low"
  }
}

COLUMNS to include for a Maximum Quality Foods invoice:
[
  { "key": "item_name_normalized", "label": "Item", "editable": true, "type": "text" },
  { "key": "quantity_shipped", "label": "Shipped", "editable": true, "type": "number" },
  { "key": "pack", "label": "Pack", "editable": true, "type": "number" },
  { "key": "size", "label": "Size", "editable": true, "type": "number" },
  { "key": "size_unit", "label": "Unit", "editable": false, "type": "text" },
  { "key": "invoice_price", "label": "Case Price", "editable": true, "type": "number" },
  { "key": "line_total", "label": "Extended", "editable": true, "type": "number" },
  { "key": "unit_cost_derived", "label": "Unit Cost", "editable": false, "type": "number" }
]

RULES:
- confidence = "high" when you can read the value clearly from the image with no ambiguity
- confidence = "medium" when a value is slightly unclear but you are reasonably sure
- confidence = "low" only when genuinely unreadable — set that field to null
- Do NOT include subtotals, tax lines, fuel surcharges, or payment summary rows as line items
- Read quantity_shipped from the SHP column (not ORD)`,
        },
      ],
    }],
  });

  const finalResponse = await response.finalMessage();

  await logAiUsage({
    feature: 'invoice_parse',
    model: 'claude-sonnet-4-6',
    usage: finalResponse.usage,
    restaurantId,
  });

  console.log(`[parse-invoice] Sonnet stop_reason: ${finalResponse.stop_reason} | input=${finalResponse.usage?.input_tokens} output=${finalResponse.usage?.output_tokens}`);

  if (finalResponse.stop_reason === 'max_tokens') {
    console.warn('[parse-invoice] max_tokens hit — attempting partial parse');
  }

  const raw = finalResponse.content[0]?.text || '{}';
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

const AUTO_THRESHOLD      = 0.90;
const AMBIGUOUS_THRESHOLD = 0.45;

function matchLineItem(lineItem, restaurantIngredients) {
  if (!restaurantIngredients.length) {
    return { status: 'new', matches: [] };
  }

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
    // Only block auto-confirm if a competitor is within 0.05 of the top score.
    // A score-1.0 match is never blocked by a 0.85 competitor.
    const closeCompetitors = scored.filter(
      (s, i) => i > 0 && s.score >= top.score - 0.05
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

  // Claude vision supports JPEG, PNG, WEBP, GIF — not PDF natively in the messages API.
  // For PDFs, we reject with a helpful message for now.
  if (isPDF) {
    return res.status(400).json({ 
      error: 'PDF upload: please upload individual page images (JPG or PNG) for best results. PDF support coming soon.' 
    });
  }

  try {
    const fileBuffer = fs.readFileSync(file.filepath);

    const mediaType = ext === '.png'  ? 'image/png'
                    : ext === '.webp' ? 'image/webp'
                    : 'image/jpeg';

    // ── Step 1: Claude Sonnet vision extraction ───────────────────────────────
    console.log('[parse-invoice] Running Sonnet vision extraction...');
    const t0 = Date.now();
    const extracted = await extractInvoiceData(fileBuffer, mediaType, restaurantId);
    console.log(`[parse-invoice] Sonnet vision done in ${Date.now() - t0}ms`);
    console.log('[parse-invoice] format_notes:', extracted?.format_notes);

    if (!extracted) {
      try { fs.unlinkSync(file.filepath); } catch {}
      return res.status(500).json({ error: 'Could not parse invoice structure. Try a clearer image.' });
    }

    // ── Step 2: Duplicate check ───────────────────────────────────────────────
    const duplicateCheck = await checkDuplicateInvoice(
      restaurantId,
      extracted.supplier,
      extracted.invoice_number
    );

    // ── Step 3: Load restaurant ingredients + match ───────────────────────────
    const restaurantIngredients = await loadRestaurantIngredients(restaurantId);

    const allLineItems = extracted.line_items || [];
    const foodItems = allLineItems.filter(i => i.is_food);
    const nonFoodItems = allLineItems.filter(i => !i.is_food);

    console.log(`[parse-invoice] ${allLineItems.length} total items: ${foodItems.length} food, ${nonFoodItems.length} non-food`);

    const lineItemsWithMatches = foodItems.map((item, idx) => {
      const matchResult = matchLineItem(item, restaurantIngredients);

      const needsCostInput = !item.invoice_price && !item.catch_weight;
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
        skip_number_review: item.confidence === 'high',
      };
    });

    // ── Step 4: Summary ───────────────────────────────────────────────────────
    const autoCount      = lineItemsWithMatches.filter(i => i.match_status === 'auto' && !i.needs_review).length;
    const ambiguousCount = lineItemsWithMatches.filter(i => i.match_status === 'ambiguous').length;
    const newCount       = lineItemsWithMatches.filter(i => i.match_status === 'new').length;
    const lowConfCount   = lineItemsWithMatches.filter(i => i.confidence === 'low').length;
    const noCostCount    = lineItemsWithMatches.filter(i => i.needs_cost_input).length;

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
        columns:        extracted.columns || [],
        confidence:     extracted.confidence || {},
      },
      line_items: lineItemsWithMatches,
      non_food_items: nonFoodItems,
      summary: {
        total_items:           allLineItems.length,
        food_items:            foodItems.length,
        non_food_items:        nonFoodItems.length,
        auto_matched:          autoCount,
        needs_review:          ambiguousCount + newCount,
        low_confidence_cost:   lowConfCount,
        needs_cost_input:      noCostCount,
        requires_confirmation: ambiguousCount > 0 || newCount > 0 || lowConfCount > 0 || noCostCount > 0,
      },
    });

  } catch (err) {
    console.error('[parse-invoice] Error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(500).json({ error: err.message || 'Failed to parse invoice' });
  }
}