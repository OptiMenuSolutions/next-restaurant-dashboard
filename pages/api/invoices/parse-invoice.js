// pages/api/invoices/parse-invoice.js
// Two-pass invoice parser:
//   Pass 1 (Google Document AI Invoice Parser):
//     - Sends image to Document AI which handles OCR, layout, rotation natively
//     - Returns structured entities: line items, supplier, dates, totals
//     - Converts entities into clean structured rows for Pass 2
//   Pass 2 (Claude text-only):
//     - Receives structured rows from Document AI
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

// ─── PASS 1: Google Document AI ───────────────────────────────────────────────
// Sends image to Document AI Invoice Parser.
// Returns structured entities with confidence scores.
// Handles rotation, layout, and table detection natively.

async function callDocumentAI(fileBuffer, mimeType) {
  const base64Content = fileBuffer.toString('base64');

  const requestBody = {
    rawDocument: {
      content: base64Content,
      mimeType,
    },
  };

  const endpoint = process.env.GOOGLE_DOCUMENT_AI_ENDPOINT;
  const apiKey = process.env.GOOGLE_VISION_API_KEY;

  const response = await fetch(`${endpoint}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Document AI error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.document;
}

// ─── PASS 1: Extract structured data from Document AI response ────────────────
// Document AI returns entities with types like:
//   supplier_name, invoice_id, invoice_date, total_amount
//   line_item (with properties: description, quantity, unit_price, amount)
// We extract these into a clean structure for Pass 2.

function extractFromDocumentAI(document) {
  const entities = document.entities || [];

  // Extract top-level fields
  let supplier = null;
  let invoiceNumber = null;
  let invoiceDate = null;
  let totalAmount = null;
  const lineItems = [];

  // Helper to get entity text value
  function entityText(entity) {
    return entity.normalizedValue?.text || entity.mentionText || null;
  }

  for (const entity of entities) {
    const type = entity.type;
    const text = entityText(entity);
    const confidence = entity.confidence || 0;

    switch (type) {
      case 'supplier_name':
        if (!supplier || confidence > 0.5) supplier = text;
        break;
      case 'invoice_id':
        if (!invoiceNumber || confidence > 0.5) invoiceNumber = text;
        break;
      case 'invoice_date':
        // Prefer normalizedValue for ISO date
        invoiceDate = entity.normalizedValue?.dateValue
          ? `${entity.normalizedValue.dateValue.year}-${String(entity.normalizedValue.dateValue.month).padStart(2,'0')}-${String(entity.normalizedValue.dateValue.day).padStart(2,'0')}`
          : text;
        break;
      case 'total_amount':
        totalAmount = parseFloat(
          (entity.normalizedValue?.moneyValue?.units || text || '0')
            .toString()
            .replace(/[^0-9.]/g, '')
        ) || null;
        break;
      case 'line_item': {
        // Line items have nested properties
        const props = {};
        for (const prop of (entity.properties || [])) {
          const propText = entityText(prop);
          props[prop.type] = propText;
        }

        const rawDescription = props['line_item/description'] || null;
        const rawQty = props['line_item/quantity'] || null;
        const rawUnitPrice = props['line_item/unit_price'] || null;
        const rawAmount = props['line_item/amount'] || null;

        // Parse numeric values
        const qty = rawQty
          ? parseFloat(rawQty.replace(/[^0-9.]/g, '')) || null
          : null;
        const unitPrice = rawUnitPrice
          ? parseFloat(rawUnitPrice.replace(/[^0-9.]/g, '')) || null
          : null;
        const amount = rawAmount
          ? parseFloat(rawAmount.replace(/[^0-9.]/g, '')) || null
          : null;

        if (rawDescription || unitPrice || amount) {
          lineItems.push({
            description: rawDescription,
            quantity_raw: rawQty,
            quantity: qty,
            unit_price_raw: rawUnitPrice,
            unit_price: unitPrice,
            amount_raw: rawAmount,
            amount,
            confidence: entity.confidence || 0,
          });
        }
        break;
      }
    }
  }

  // Also grab full text for context
  const fullText = document.text || '';

  console.log(`[parse-invoice] Document AI extracted: supplier="${supplier}" invoice="${invoiceNumber}" date="${invoiceDate}" total=${totalAmount} lineItems=${lineItems.length}`);

  return { supplier, invoiceNumber, invoiceDate, totalAmount, lineItems, fullText };
}

// ─── PASS 2: Claude text-only parsing ────────────────────────────────────────
// Receives structured data from Document AI.
// Claude's job: normalize names, classify food/non-food, parse pack sizes,
// validate math, detect catch-weight items.

async function parseWithClaude(docAIResult, restaurantId, res) {
  streamStatus(res, 'Extracting line items...', 'Normalizing and classifying items');

  const { supplier, invoiceNumber, invoiceDate, totalAmount, lineItems, fullText } = docAIResult;

  // Format line items for Claude
  const itemsText = lineItems.map((item, i) => {
    const parts = [
      `Item ${i + 1}:`,
      item.description ? `  description: "${item.description}"` : null,
      item.quantity_raw ? `  quantity: "${item.quantity_raw}"` : null,
      item.unit_price_raw ? `  unit_price: "${item.unit_price_raw}"` : null,
      item.amount_raw ? `  amount: "${item.amount_raw}"` : null,
      item.confidence ? `  confidence: ${(item.confidence * 100).toFixed(0)}%` : null,
    ].filter(Boolean);
    return parts.join('\n');
  }).join('\n\n');

  // Include first 800 chars of full text for context Document AI may have missed
  const contextText = fullText.slice(0, 800);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `You are an expert at parsing food service supplier invoice data. Google Document AI has already extracted the following structured data from an invoice. Your job is to normalize, classify, and validate this data.

CRITICAL: Output ONLY raw JSON. No preamble, no explanation, no markdown fences. Start with { and end with }.

════════════════════════════════════════
DOCUMENT AI EXTRACTED HEADER
════════════════════════════════════════
Supplier: ${supplier || 'unknown'}
Invoice Number: ${invoiceNumber || 'unknown'}
Invoice Date: ${invoiceDate || 'unknown'}
Total Amount: ${totalAmount || 'unknown'}

════════════════════════════════════════
DOCUMENT AI EXTRACTED LINE ITEMS
════════════════════════════════════════
${itemsText || 'No line items extracted'}

════════════════════════════════════════
FULL TEXT CONTEXT (first 800 chars)
════════════════════════════════════════
${contextText}

════════════════════════════════════════
YOUR TASKS
════════════════════════════════════════

For each line item:

1. NORMALIZE the description to a clean chef-readable ingredient name:
   "CHIX BRS BNLS SKNLS" → "Chicken Breast Boneless Skinless"
   "MOZZ WM LF" → "Mozzarella Whole Milk Loaf"
   "COUNTRY MA BUTTER SALTED SOLIDS" → "Country Manor Butter Salted Solids"
   "21-25 T/ON White India 5/2" → "Shrimp 21-25 Count Tail-On White India Farmed"
   "5-8inTubes Only Squid Ocean Tide 12/2.5" → "Squid Tubes 5-8 inch Wild New Zealand"
   "SALMON FILLET S/ON 3-4 PREMIUM PC" → "Salmon Fillet Skin-On 3-4 lb Premium Cut"
   Remove vendor codes, item numbers, brand names. Preserve size info.

2. CLASSIFY food vs non-food:
   is_food=false: cleaning supplies, paper goods, foil, bags, gloves, equipment, fees, taxes
   is_food=true: all food ingredients, oils, condiments, beverages, dairy, produce, meat, seafood, spices

3. PARSE pack size from the description or quantity field:
   "36 1 LB" → pack=36, size=1, size_unit="lb"
   "4 1 GAL" → pack=4, size=1, size_unit="gal"
   "8 6 LB" → pack=8, size=6, size_unit="lb"
   "6 1 DZ" → pack=6, size=1, size_unit="dz"
   "5/2" → pack=5, size=2, size_unit="lb"
   "12/2.5" → pack=12, size=2.5, size_unit="lb"
   "1/10" → pack=1, size=10, size_unit="lb"
   "12 12 CT" → pack=12, size=12, size_unit="ct"

4. DETERMINE invoice_price (price per case):
   The unit_price from Document AI is the price per CASE. Use it directly as invoice_price.

5. DETECT catch-weight items:
   If qty_unit is "LB" AND unit_price × quantity ≈ amount → catch_weight=true
   Common for seafood (salmon, tuna), deli meats, some cheeses

6. VALIDATE math (within 5%):
   Standard: quantity × invoice_price ≈ amount
   Per-unit: quantity × pack × size × invoice_price ≈ amount
   Catch-weight: actual_weight × invoice_price ≈ amount
   If math fails, set confidence="low"

7. SKIP subtotal/total rows — Document AI sometimes includes section subtotals as line items.
   Signs: description contains "SUBTOTAL", "TOTAL", "DRY TOTAL", "CLR TOTAL", "FRZ TOTAL",
   or amount is much larger than any individual item.

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════

{
  "supplier": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "format_notes": "brief description of any parsing issues",
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
      "item_name_raw": "exact description from Document AI",
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

  // Document AI supports PDF natively — no longer rejecting PDFs
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

    // ── Pass 1: Document AI ───────────────────────────────────────────────────
    streamStatus(res, `Reading ${fileName}...`, 'Extracting with Google Document AI');

    const t0 = Date.now();
    const document = await callDocumentAI(fileBuffer, mimeType);
    const docAIResult = extractFromDocumentAI(document);
    console.log(`[parse-invoice] Document AI done in ${Date.now() - t0}ms — ${docAIResult.lineItems.length} raw line items`);

    if (!docAIResult.lineItems.length && !docAIResult.fullText) {
      try { fs.unlinkSync(file.filepath); } catch {}
      streamEvent(res, { type: 'error', error: 'Could not read invoice. Try a clearer photo.' });
      return res.end();
    }

    streamStatus(res, 'Normalizing items...', `${docAIResult.lineItems.length} items found`);

    // ── Pass 2: Claude normalization ──────────────────────────────────────────
    const t1 = Date.now();
    const extracted = await parseWithClaude(docAIResult, restaurantId, res);
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