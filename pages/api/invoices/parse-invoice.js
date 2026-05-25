// pages/api/invoices/parse-invoice.js
// Two-pass invoice parser:
//   Pass 1 (Mistral OCR):
//     - Sends image/PDF to Mistral OCR API
//     - Returns markdown with HTML tables, handles rotation natively
//     - Simple API key auth, no service accounts needed
//   Pass 2 (Claude text-only):
//     - Receives clean markdown from Mistral
//     - Normalizes ingredient names, classifies food/non-food
//     - Parses pack sizes, validates math, derives unit costs
// Streams newline-delimited JSON events for live UI status updates.

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

// ─── Stream helpers ───────────────────────────────────────────────────────────

function streamEvent(res, event) {
  res.write(JSON.stringify(event) + '\n');
}

function streamStatus(res, message, detail) {
  streamEvent(res, { type: 'status', message, detail: detail || null });
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

// ─── PASS 1: Mistral OCR ──────────────────────────────────────────────────────
// Sends image or PDF to Mistral OCR API.
// Returns markdown text with HTML tables preserved.
// Handles rotation, layout, and skew natively — no coordinate work needed.

async function callMistralOCR(fileBuffer, mimeType) {
  const base64Content = fileBuffer.toString('base64');

  // Mistral OCR accepts either image_url or document types
  // For base64 we use image_url with a data URI for images,
  // or document_url with base64 for PDFs
  const isPDF = mimeType === 'application/pdf';

  const documentPayload = isPDF
    ? {
        type: 'document_url',
        document_url: `data:application/pdf;base64,${base64Content}`,
      }
    : {
        type: 'image_url',
        image_url: `data:${mimeType};base64,${base64Content}`,
      };

  const body = {
    model: 'mistral-ocr-latest',
    document: documentPayload,
    // No table_format — inline markdown is more reliable than referenced HTML files
  };

  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mistral OCR error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // Combine markdown from all pages
  const pages = data.pages || [];
  const fullText = pages.map(p => p.markdown || '').join('\n\n');

  console.log(`[parse-invoice] Mistral OCR: ${pages.length} page(s), ${fullText.length} chars`);
  console.log(`[parse-invoice] OCR full text:\n${fullText.slice(0, 2000)}`);

  return fullText;
}

// ─── PASS 2: Claude text-only parsing ────────────────────────────────────────
// Receives clean markdown from Mistral OCR.
// Claude normalizes names, classifies food/non-food, parses pack sizes,
// validates math, detects catch-weight items.

async function parseWithClaude(ocrText, restaurantId, res) {
  streamStatus(res, 'Extracting line items...', 'Parsing rows and computing unit costs');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `You are an expert at parsing food service supplier invoice data. Mistral OCR has extracted the following text from an invoice image. Parse it into structured JSON.

CRITICAL: Output ONLY raw JSON. No preamble, no explanation, no markdown fences. Start with { and end with }.

════════════════════════════════════════
OCR EXTRACTED TEXT
════════════════════════════════════════
${ocrText}

════════════════════════════════════════
PARSING RULES
════════════════════════════════════════

ROW CLASSIFICATION — classify each row before extracting:
- "line_item": has a product description and at least one price/qty value → extract
- "subtotal": SUBTOTAL / DRY TOTAL / CLR TOTAL / FRZ TOTAL / COOLER → SKIP
- "total": INVOICE TOTAL / AMOUNT DUE / TOTAL INVOICE DUE → extract as total_amount only
- "tax_fee": TAX / FUEL SURCHARGE / HANDLING → extract value only
- "header": column labels → skip
- "blank": empty → skip

CRITICAL — SUBTOTAL CONTAMINATION:
The last line item before a subtotal row has its OWN extended price, not the subtotal.
Validate: line_total ≈ qty × invoice_price (within 5%).
If line_total is dramatically larger than expected, you grabbed the subtotal — reject it.

UNIT PRICE:
The column labeled "unit cost", "unit price", "price", or "each" = price per CASE.
Set invoice_price = that value exactly. Do NOT divide it further.

PACK SIZE PARSING:
"36 1 LB"   → pack=36, size=1, size_unit="lb"
"4 1 GAL"   → pack=4, size=1, size_unit="gal"
"8 6 LB"    → pack=8, size=6, size_unit="lb"
"6 1 DZ"    → pack=6, size=1, size_unit="dz"
"1 50 LB"   → pack=1, size=50, size_unit="lb"
"5/2"       → pack=5, size=2, size_unit="lb"
"12/2.5"    → pack=12, size=2.5, size_unit="lb"
"1/10"      → pack=1, size=10, size_unit="lb"
"12 12 CT"  → pack=12, size=12, size_unit="ct"
"10.350"    → this is a WEIGHT value, not a pack size

CATCH-WEIGHT ITEMS:
If qty_unit is "LB" AND unit_price × qty ≈ line_total → catch_weight=true
Common for seafood, deli meats, some cheeses billed by actual weight.

MATH VALIDATION (within 5%):
  Standard:    qty × invoice_price ≈ line_total
  Per-unit:    qty × pack × size × invoice_price ≈ line_total
  Catch-weight: actual_weight × invoice_price ≈ line_total
Derive missing values from the others. If none work → confidence="low"

IGNORE: handwritten annotations, circled numbers, crossed-out values, watermarks, signatures.

FOOD vs NON-FOOD:
is_food=false: cleaning supplies, paper goods, foil, bags, gloves, equipment, fees, taxes
is_food=true: all food, oils, condiments, beverages, dairy, produce, meat, seafood, spices

INGREDIENT NAME NORMALIZATION:
"CHIX BRS BNLS SKNLS" → "Chicken Breast Boneless Skinless"
"MOZZ WM LF" → "Mozzarella Whole Milk Loaf"
"COUNTRY MA BUTTER SALTED SOLIDS" → "Country Manor Butter Salted Solids"
"21-25 T/ON White India 5/2" → "Shrimp 21-25 Count Tail-On White India Farmed"
"5-8inTubes Only Squid Ocean Tide 12/2.5" → "Squid Tubes 5-8 inch Wild New Zealand"
"SALMON FILLET S/ON 3-4 PREMIUM PC" → "Salmon Fillet Skin-On 3-4 lb Premium Cut"
Remove vendor codes, item numbers, brand names from the normalized name.
Preserve size info (e.g. "7oz", "21-25ct").

CONFIDENCE:
"high"   = all values readable and math checks out
"medium" = one value derived, math checks out
"low"    = math fails or values unreadable

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════

{
  "supplier": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "format_notes": "brief description of format and any issues",
  "columns": [
    { "key": "item_name_normalized", "label": "Item", "editable": true, "type": "text" },
    { "key": "quantity_shipped", "label": "Shipped", "editable": true, "type": "number" },
    { "key": "pack", "label": "Pack", "editable": true, "type": "number" },
    { "key": "size", "label": "Size", "editable": true, "type": "number" },
    { "key": "size_unit", "label": "Unit", "editable": false, "type": "text" },
    { "key": "invoice_price", "label": "Case Price", "editable": true, "type": "number" },
    { "key": "line_total", "label": "Extended", "editable": true, "type": "number" },
    { "key": "unit_cost_derived", "label": "Unit Cost", "editable": false, "type": "number" }
  ],
  "line_items": [
    {
      "item_name_raw": "exact text from OCR",
      "item_name_normalized": "clean chef-readable name",
      "is_food": boolean,
      "quantity_ordered": number or null,
      "quantity_shipped": number or null,
      "quantity_unit": "CS | LB | EA | GA or null",
      "pack_size_raw": "pack size as it appeared",
      "pack": number or null,
      "size": number or null,
      "size_unit": "lb | oz | each | gal | l | ct | fl oz | dz",
      "invoice_price": number or null,
      "line_total": number or null,
      "catch_weight": boolean,
      "actual_weight": number or null,
      "standard_unit": "lb | oz | each | gal | case",
      "confidence": "high | medium | low",
      "confidence_reason": "string if not high, null if high"
    }
  ],
  "confidence": {
    "supplier": "high | medium | low",
    "invoice_number": "high | medium | low",
    "invoice_date": "high | medium | low",
    "total_amount": "high | medium | low"
  }
}`,
    }],
  });

  await logAiUsage({
    feature: 'invoice_parse',
    model: 'claude-sonnet-4-6',
    usage: response.usage,
    restaurantId,
  });

  console.log(`[parse-invoice] Pass 2: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);

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

// ─── Fuzzy match score ────────────────────────────────────────────────────────

function matchScore(invoiceName, dbName) {
  const na = normalizeName(invoiceName);
  const nb = normalizeName(dbName);
  if (na === nb) return 1.0;
  if (nb.includes(na)) return 0.90;

  const tokensA = na.split(' ').filter(t => t.length > 2);
  const tokensB = nb.split(' ').filter(t => t.length > 2);
  const setA = new Set(tokensA);

  if (tokensB.length === 0) return 0;

  const matched = tokensB.filter(t => setA.has(t)).length;
  const dbCoverage = matched / tokensB.length;
  if (dbCoverage === 0) return 0;

  const specificityBonus = Math.min(0.15, tokensB.length * 0.04);
  return Math.min(0.89, dbCoverage * 0.75 + specificityBonus);
}

// ─── Load restaurant ingredients ─────────────────────────────────────────────

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
  for (const c of (components || [])) compToMenuItem[c.id] = c.menu_item_id;

  const menuItemIds = [...new Set(Object.values(compToMenuItem).filter(Boolean))];

  let menuNameMap = {};
  if (menuItemIds.length) {
    const { data: menuItems } = await supabase
      .from('menu_items')
      .select('id, name')
      .in('id', menuItemIds);
    for (const m of (menuItems || [])) menuNameMap[m.id] = m.name;
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

// ─── Match line item against ingredients ──────────────────────────────────────

const AUTO_THRESHOLD      = 0.90;
const AMBIGUOUS_THRESHOLD = 0.45;

function matchLineItem(lineItem, restaurantIngredients) {
  if (!restaurantIngredients.length) return { status: 'new', matches: [] };
  if (!lineItem.is_food) return { status: 'non_food', matches: [] };

  const scored = restaurantIngredients
    .map(ing => ({
      ...ing,
      score: matchScore(lineItem.item_name_normalized || lineItem.item_name_raw, ing.name),
    }))
    .filter(ing => ing.score >= AMBIGUOUS_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { status: 'new', matches: [] };

  const top = scored[0];

  if (top.score >= AUTO_THRESHOLD) {
    const closeCompetitors = scored.filter((s, i) => i > 0 && s.score >= top.score - 0.05);
    if (!closeCompetitors.length) return { status: 'auto', matches: [top] };
  }

  return { status: 'ambiguous', matches: scored.slice(0, 5) };
}

// ─── Invoice number normalization ─────────────────────────────────────────────

function normalizeInvoiceNumber(raw) {
  return (raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[Ss]/g, '5')
    .replace(/[Oo]/g, '0')
    .replace(/[Ii|l]/g, '1')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/[Gg]/g, '6');
}

// ─── Duplicate invoice check ──────────────────────────────────────────────────

async function checkDuplicateInvoice(restaurantId, supplier, invoiceNumber) {
  if (!invoiceNumber) return false;

  const normalizedNumber = normalizeInvoiceNumber(invoiceNumber);

  const { data } = await supabase
    .from('invoices')
    .select('id, date, supplier, number')
    .eq('restaurant_id', restaurantId)
    .eq('number', normalizedNumber)
    .maybeSingle();

  if (data) {
    console.warn(`[parse-invoice] Duplicate detected: ${normalizedNumber} (id: ${data.id})`);
    return {
      duplicate:         true,
      existing_id:       data.id,
      existing_date:     data.date,
      existing_supplier: data.supplier,
      existing_number:   data.number,
    };
  }

  return false;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch {
    streamEvent(res, { type: 'error', error: 'Failed to parse upload' });
    return res.end();
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) {
    streamEvent(res, { type: 'error', error: 'No file provided' });
    return res.end();
  }

  const restaurantId = Array.isArray(fields.restaurant_id)
    ? fields.restaurant_id[0]
    : fields.restaurant_id;

  const fileUrl = Array.isArray(fields.file_url)
    ? fields.file_url[0]
    : fields.file_url;

  if (!restaurantId) {
    streamEvent(res, { type: 'error', error: 'restaurant_id is required' });
    return res.end();
  }

  const ext = path.extname(file.originalFilename || '').toLowerCase();
  const isPDF = ext === '.pdf' || file.mimetype === 'application/pdf';

  const mimeType = isPDF ? 'application/pdf'
    : ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : 'image/jpeg';

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(mimeType)) {
    streamEvent(res, { type: 'error', error: 'Unsupported file type. Upload JPG, PNG, WEBP, or PDF.' });
    return res.end();
  }

  const fileName = file.originalFilename || 'invoice';

  try {
    const fileBuffer = fs.readFileSync(file.filepath);

    // ── Pass 1: Mistral OCR ───────────────────────────────────────────────────
    streamStatus(res, `Reading ${fileName}...`, 'Extracting text with Mistral OCR');

    const t0 = Date.now();
    const ocrText = await callMistralOCR(fileBuffer, mimeType);
    console.log(`[parse-invoice] Mistral OCR done in ${Date.now() - t0}ms`);

    if (!ocrText || ocrText.trim().length < 20) {
      try { fs.unlinkSync(file.filepath); } catch {}
      streamEvent(res, { type: 'error', error: 'Could not read invoice. Try a clearer photo.' });
      return res.end();
    }

    streamStatus(res, 'OCR complete', 'Parsing line items...');

    // ── Pass 2: Claude parsing ────────────────────────────────────────────────
    const t1 = Date.now();
    const extracted = await parseWithClaude(ocrText, restaurantId, res);
    console.log(`[parse-invoice] Pass 2 done in ${Date.now() - t1}ms`);

    if (!extracted) {
      try { fs.unlinkSync(file.filepath); } catch {}
      streamEvent(res, { type: 'error', error: 'Could not parse invoice structure. Try a clearer image.' });
      return res.end();
    }

    const supplier     = extracted.supplier || 'Unknown Supplier';
    const allRaw       = extracted.line_items || [];
    const foodCount    = allRaw.filter(i => i.is_food).length;
    const nonFoodCount = allRaw.filter(i => !i.is_food).length;

    streamStatus(res,
      `Found ${foodCount} food item${foodCount !== 1 ? 's' : ''} from ${supplier}`,
      nonFoodCount > 0 ? `Plus ${nonFoodCount} non-food items filtered out` : 'Checking for duplicates...'
    );

    // ── Duplicate check ───────────────────────────────────────────────────────
    const duplicateCheck = await checkDuplicateInvoice(
      restaurantId, extracted.supplier, extracted.invoice_number
    );

    if (duplicateCheck) {
      streamStatus(res,
        `Invoice #${duplicateCheck.existing_number} already on file`,
        'Will prompt to merge or create new'
      );
    }

    // ── Load ingredients + match ──────────────────────────────────────────────
    streamStatus(res, 'Matching to your ingredient library...', 'Comparing against ingredients you already track');

    const restaurantIngredients = await loadRestaurantIngredients(restaurantId);

    const readableItems = allRaw.filter(item => {
      const hasPrice = item.invoice_price != null;
      const hasPack  = item.pack != null;
      const hasName  = item.item_name_raw &&
        !item.item_name_raw.toLowerCase().includes('not legible');
      return hasPrice || hasPack || hasName;
    });

    const foodItems    = readableItems.filter(i => i.is_food);
    const nonFoodItems = readableItems.filter(i => !i.is_food);

    let autoCount = 0, newCount = 0, ambiguousCount = 0;
    const lineItemsWithMatches = [];

    for (let idx = 0; idx < foodItems.length; idx++) {
      const item = foodItems[idx];
      const matchResult = matchLineItem(item, restaurantIngredients);

      const needsCostInput = !item.invoice_price && !item.catch_weight;
      const needsReview = needsCostInput
        || item.confidence === 'low'
        || matchResult.status === 'ambiguous'
        || matchResult.status === 'new';

      const skipNumberReview = item.confidence === 'high'
        || (item.confidence === 'medium' && !needsCostInput);

      lineItemsWithMatches.push({
        _id: `item_${idx}`,
        ...item,
        match_status:             matchResult.status,
        match_candidates:         matchResult.matches,
        selected_ingredient_id:   matchResult.status === 'auto' ? matchResult.matches[0]?.id   : null,
        selected_ingredient_name: matchResult.status === 'auto' ? matchResult.matches[0]?.name : null,
        needs_cost_input:         needsCostInput,
        needs_review:             needsReview,
        skip_number_review:       skipNumberReview,
      });

      if (matchResult.status === 'auto') {
        autoCount++;
        if (autoCount <= 3 || autoCount % 5 === 0) {
          streamStatus(res,
            `Matched: ${item.item_name_normalized || item.item_name_raw}`,
            `→ ${matchResult.matches[0]?.name} in your library`
          );
        }
      } else if (matchResult.status === 'new') {
        newCount++;
        if (newCount <= 2) {
          streamStatus(res,
            `New ingredient: ${item.item_name_normalized || item.item_name_raw}`,
            'Will add to your library when confirmed'
          );
        }
      } else {
        ambiguousCount++;
      }
    }

    const reviewNeeded = lineItemsWithMatches.filter(i => i.needs_review).length;
    streamStatus(res,
      reviewNeeded > 0
        ? `${reviewNeeded} item${reviewNeeded !== 1 ? 's' : ''} need your review`
        : 'All items matched — ready to confirm',
      `${autoCount} auto-matched · ${newCount} new · ${ambiguousCount} ambiguous`
    );

    const lowConfCount = lineItemsWithMatches.filter(i => i.confidence === 'low').length;
    const noCostCount  = lineItemsWithMatches.filter(i => i.needs_cost_input).length;

    try { fs.unlinkSync(file.filepath); } catch {}

    streamEvent(res, {
      type: 'result',
      data: {
        success:   true,
        file_url:  fileUrl || null,
        duplicate: duplicateCheck || false,
        invoice: {
          supplier:       extracted.supplier,
          invoice_number: normalizeInvoiceNumber(extracted.invoice_number),
          invoice_date:   extracted.invoice_date,
          total_amount:   extracted.total_amount,
          format_notes:   extracted.format_notes || null,
          columns:        extracted.columns || [],
          confidence:     extracted.confidence || {},
        },
        line_items:     lineItemsWithMatches,
        non_food_items: nonFoodItems,
        summary: {
          total_items:           readableItems.length,
          food_items:            foodItems.length,
          non_food_items:        nonFoodItems.length,
          auto_matched:          autoCount,
          needs_review:          ambiguousCount + newCount,
          low_confidence_cost:   lowConfCount,
          needs_cost_input:      noCostCount,
          requires_confirmation: ambiguousCount > 0 || newCount > 0 || lowConfCount > 0 || noCostCount > 0,
        },
      },
    });

    res.end();

  } catch (err) {
    console.error('[parse-invoice] Error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    streamEvent(res, { type: 'error', error: err.message || 'Failed to parse invoice' });
    res.end();
  }
}