// pages/api/invoices/parse-invoice.js
// Two-pass invoice parser:
//   Pass 1 (vision): Transcribe invoice image into a markdown table — no interpretation
//   Pass 2 (text):  Parse the markdown table into structured JSON
// Streams newline-delimited JSON events for live UI status updates.
// Event shapes:
//   { type: 'status', message: string, detail?: string }
//   { type: 'result', data: { success, file_url, duplicate, invoice, line_items, non_food_items, summary } }
//   { type: 'error',  error: string }

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

// ─── PASS 1: Transcribe invoice image to markdown table ───────────────────────
// No interpretation — just read what's on the page, cell by cell, row by row.

async function transcribeInvoiceImage(fileBuffer, mediaType, restaurantId, res, fileName) {
  const base64Image = fileBuffer.toString('base64');

  streamStatus(res,
    `Reading ${fileName || 'invoice'} layout...`,
    'Transcribing rows and columns from image'
  );

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Image },
        },
        {
          type: 'text',
          text: `You are a precise invoice transcription tool. Your ONLY job is to read this invoice image and reproduce its table content as a markdown table, exactly as it appears on the page.

TRANSCRIPTION RULES:
1. Read EVERY row — including header rows, line item rows, subtotal rows, and total rows
2. Read EVERY column — reproduce the exact column structure of the invoice
3. Copy values EXACTLY as printed — do not interpret, calculate, or normalize anything
4. Each row in the image = exactly one row in your markdown table
5. If a cell is blank, leave it blank in the table (just | |)
6. If text spans multiple printed lines for one item, combine into one table row
7. Subtotal rows, total rows, and section header rows get their own table rows
8. Never merge two separate rows into one
9. Never split one row into two

ALSO extract this header information as plain text BEFORE the table:
- Supplier name
- Invoice number  
- Invoice date
- Any total/subtotal amounts shown

Format:
HEADER:
Supplier: [value]
Invoice Number: [value]
Invoice Date: [value]
Subtotal: [value if shown]
Tax: [value if shown]
Total: [value if shown]

TABLE:
[markdown table with ALL rows from the invoice]

Do not add any explanation or commentary. Just the HEADER block and the TABLE.`,
        },
      ],
    }],
  });

  await logAiUsage({
    feature: 'invoice_transcribe',
    model: 'claude-sonnet-4-6',
    usage: response.usage,
    restaurantId,
  });

  console.log(`[parse-invoice] Pass 1 transcription: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);
  return response.content[0]?.text || '';
}

// ─── PASS 2: Parse markdown table into structured JSON ────────────────────────
// Text-only — no image. Much more reliable than reading numbers from an image.

async function parseMarkdownTable(transcription, restaurantId, res) {
  streamStatus(res,
    'Extracting line items...',
    'Parsing rows and computing unit costs'
  );

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `You are an expert at parsing food service supplier invoice data. You have been given a markdown table transcribed directly from an invoice image. Parse it into structured JSON.

CRITICAL: Output ONLY raw JSON. No preamble, no explanation, no markdown fences. Start with { and end with }.

Here is the transcribed invoice:

${transcription}

════════════════════════════════════════
PARSING RULES
════════════════════════════════════════

IDENTIFYING ROW TYPES:
- Line item rows: have a product description and at least one number (price or quantity)
- Subtotal rows: labeled "SUBTOTAL", "DRY TOTAL", "FRZ TOTAL", "CLR TOTAL", section totals — SKIP THESE
- Total rows: labeled "TOTAL", "INVOICE TOTAL", "AMOUNT DUE" — extract as total_amount, do NOT make into line items
- Tax/fee rows: "TAX", "FUEL SURCHARGE", "HANDLING" — extract value, do NOT make into line items
- Header rows: column labels — use to identify columns, do NOT make into line items

CRITICAL — SUBTOTAL CONFUSION:
The last line item before a subtotal row must use its OWN extended price, not the subtotal.
If a subtotal row immediately follows a line item, the large number belongs to the subtotal row, 
not to the line item above it. Always check: does line_total make sense for this item given 
its quantity and unit price? If line_total seems 10x too large, you probably grabbed the subtotal.

PACK SIZE PARSING:
"4 1 GAL"   → pack=4, size=1, size_unit="gal"
"36 1 LB"   → pack=36, size=1, size_unit="lb"
"8 6 LB"    → pack=8, size=6, size_unit="lb"
"30 100 CT" → pack=30, size=100, size_unit="ct"
"12 12 CT"  → pack=12, size=12, size_unit="ct"
"1 50 LBS"  → pack=1, size=50, size_unit="lb"
"6 2 LTR"   → pack=6, size=2, size_unit="l"
"5/2"       → pack=5, size=2, size_unit="lb" (seafood X/Y format)
"12/2.5"    → pack=12, size=2.5, size_unit="lb"
"1/10"      → pack=1, size=10, size_unit="lb"

UNIT COST INTERPRETATION:
On Maximum Quality Foods invoices, the UNIT COST column = price per CASE.
invoice_price = the value in the UNIT COST column.

MANDATORY MATH VALIDATION — for every line item:
Every row satisfies one of:
  Standard:  qty_shipped × invoice_price = line_total
  Per-lb:    qty_shipped × pack × size × invoice_price = line_total

If you can read 4 of the 5 values, derive the 5th.
If the math doesn't work and you cannot fix it, set confidence = "low".

CATCH-WEIGHT ITEMS:
If a WEIGHT column has a value, test: weight × unit_cost ≈ line_total?
  YES → catch_weight=true, actual_weight=weight column value, invoice_price=unit_cost column value
  NO  → catch_weight=false (weight column is informational only)

X/Y SEAFOOD FORMAT:
If description contains "5/2", "12/2.5" etc AND qty_shipped × pack × size × invoice_price ≈ line_total:
  catch_weight=true, actual_weight = qty_shipped × pack × size, invoice_price = per-lb price

FOOD vs NON-FOOD:
is_food=false: cleaning supplies, paper products, plastic wrap, foil, garbage bags, gloves, 
               equipment, fuel surcharges, delivery fees, taxes, bamboo skewers (decorative)
is_food=true: all food ingredients, cooking oils, condiments, beverages, dairy, produce, 
              meat, seafood, frozen foods, baking ingredients, spices

INGREDIENT NAME NORMALIZATION:
Convert abbreviations to clean chef-readable names:
"CHIX BRS BNLS SKNLS" → "Chicken Breast Boneless Skinless"
"MOZZ WM LF" → "Mozzarella Whole Milk Loaf"  
"CHDR LF YLW" → "Cheddar Cheese Yellow Loaf"
"NABISCO OREO COOKIE PIECES MEDIUM" → "Oreo Cookie Pieces Medium"
Remove vendor codes and item numbers. Preserve size info (e.g. "7oz", "21-25ct").

CONFIDENCE:
"high"   = all values clearly readable and math checks out
"medium" = one value derived from others, math checks out  
"low"    = math doesn't work or values genuinely unreadable

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════

{
  "supplier": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "format_notes": "brief description of invoice format",
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
      "item_name_raw": "exact text from table",
      "item_name_normalized": "clean chef-readable name",
      "is_food": boolean,
      "quantity_ordered": number or null,
      "quantity_shipped": number or null,
      "quantity_unit": "CS | LB | EA | GA or null",
      "pack_size_raw": "pack size as printed",
      "pack": number or null,
      "size": number or null,
      "size_unit": "lb | oz | each | gal | l | ct | fl oz",
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

  console.log(`[parse-invoice] Pass 2 parse: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);

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
      duplicate:          true,
      existing_id:        data.id,
      existing_date:      data.date,
      existing_supplier:  data.supplier,
      existing_number:    data.number,
    };
  }

  return false;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Streaming response
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
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  if (!allowed.includes(file.mimetype) && !isPDF) {
    streamEvent(res, { type: 'error', error: 'Unsupported file type. Upload JPG, PNG, WEBP, or PDF.' });
    return res.end();
  }

  if (isPDF) {
    streamEvent(res, { type: 'error', error: 'PDF upload: please upload individual page images (JPG or PNG) for best results.' });
    return res.end();
  }

  const fileName = file.originalFilename || 'invoice';

  try {
    const fileBuffer = fs.readFileSync(file.filepath);
    const mediaType = ext === '.png' ? 'image/png'
                    : ext === '.webp' ? 'image/webp'
                    : 'image/jpeg';

    // ── Pass 1: Transcribe image to markdown table ────────────────────────────
    const t0 = Date.now();
    const transcription = await transcribeInvoiceImage(
      fileBuffer, mediaType, restaurantId, res, fileName
    );
    console.log(`[parse-invoice] Pass 1 done in ${Date.now() - t0}ms`);

    if (!transcription || transcription.length < 50) {
      try { fs.unlinkSync(file.filepath); } catch {}
      streamEvent(res, { type: 'error', error: 'Could not read invoice image. Try a clearer photo.' });
      return res.end();
    }

    // Log the transcription for debugging
    console.log('[parse-invoice] Full transcription:\n', transcription);
    streamStatus(res, 'Transcription complete', `${transcription.split('\n').length} rows read`);

    // ── Pass 2: Parse markdown table to JSON ──────────────────────────────────
    const t1 = Date.now();
    const extracted = await parseMarkdownTable(transcription, restaurantId, res);
    console.log(`[parse-invoice] Pass 2 done in ${Date.now() - t1}ms`);

    if (!extracted) {
      try { fs.unlinkSync(file.filepath); } catch {}
      streamEvent(res, { type: 'error', error: 'Could not parse invoice structure. Try a clearer image.' });
      return res.end();
    }

    const supplier   = extracted.supplier || 'Unknown Supplier';
    const allRaw     = extracted.line_items || [];
    const foodCount  = allRaw.filter(i => i.is_food).length;
    const nonFoodCount = allRaw.filter(i => !i.is_food).length;

    streamStatus(res,
      `Found ${foodCount} food item${foodCount !== 1 ? 's' : ''} from ${supplier}`,
      nonFoodCount > 0 ? `Plus ${nonFoodCount} non-food items filtered out` : 'Checking for duplicates...'
    );

    // ── Duplicate check ───────────────────────────────────────────────────────
    const duplicateCheck = await checkDuplicateInvoice(
      restaurantId,
      extracted.supplier,
      extracted.invoice_number
    );

    if (duplicateCheck) {
      streamStatus(res,
        `Invoice #${duplicateCheck.existing_number} already on file`,
        'Will prompt to merge or create new'
      );
    }

    // ── Load ingredients + match ──────────────────────────────────────────────
    streamStatus(res,
      'Matching to your ingredient library...',
      'Comparing against ingredients you already track'
    );

    const restaurantIngredients = await loadRestaurantIngredients(restaurantId);

    // Filter placeholder/unreadable items
    const readableItems = allRaw.filter(item => {
      const hasPrice = item.invoice_price != null;
      const hasPack  = item.pack != null;
      const hasName  = item.item_name_raw &&
        !item.item_name_raw.toLowerCase().includes('not legible') &&
        !item.item_name_raw.toLowerCase().includes('detail') &&
        !item.item_name_raw.toLowerCase().includes('frozen (');
      return hasPrice || hasPack || hasName;
    });

    const foodItems    = readableItems.filter(i => i.is_food);
    const nonFoodItems = readableItems.filter(i => !i.is_food);

    const skippedCount = allRaw.length - readableItems.length;
    if (skippedCount > 0) {
      console.log(`[parse-invoice] Skipped ${skippedCount} unreadable/placeholder items`);
    }

    // Match and build result
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
        match_status:            matchResult.status,
        match_candidates:        matchResult.matches,
        selected_ingredient_id:  matchResult.status === 'auto' ? matchResult.matches[0]?.id   : null,
        selected_ingredient_name: matchResult.status === 'auto' ? matchResult.matches[0]?.name : null,
        needs_cost_input:        needsCostInput,
        needs_review:            needsReview,
        skip_number_review:      skipNumberReview,
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
        success:    true,
        file_url:   fileUrl || null,
        duplicate:  duplicateCheck || false,
        invoice: {
          supplier:       extracted.supplier,
          invoice_number: normalizeInvoiceNumber(extracted.invoice_number),
          invoice_date:   extracted.invoice_date,
          total_amount:   extracted.total_amount,
          format_notes:   extracted.format_notes || null,
          transcription:  transcription,
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