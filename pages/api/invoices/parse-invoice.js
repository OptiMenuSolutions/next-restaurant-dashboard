// pages/api/invoices/parse-invoice.js
// Two-pass invoice parser:
//   Pass 1 (Google Vision + deterministic code):
//     - OCR via Google Cloud Vision document:annotate
//     - Deterministic row building from Y-coordinate clustering
//     - Deterministic column assignment from header X-bands
//     - Outputs structured JSON rows (no markdown table)
//   Pass 2 (Claude text-only):
//     - Receives structured rows JSON
//     - Normalizes ingredient names, classifies food/non-food
//     - Parses pack sizes, validates math, derives unit costs
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

// ─── PASS 1A: Google Vision OCR ───────────────────────────────────────────────
// Calls the Vision document:annotate endpoint which returns word-level
// bounding polygons — better than images:annotate for dense invoice layouts.

async function callGoogleVision(fileBuffer, mediaType) {
  const base64Image = fileBuffer.toString('base64');

  const body = {
    requests: [{
      image: { content: base64Image },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
      imageContext: {
        // Hint that this is a document — improves layout preservation
        textDetectionParams: { enableTextDetectionConfidenceScore: true },
      },
    }],
  };

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Vision API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const result = data.responses?.[0];

  if (result?.error) {
    throw new Error(`Google Vision error: ${result.error.message}`);
  }

  return result;
}

// ─── PASS 1B: Extract words with bounding boxes ───────────────────────────────
// Returns flat array of { text, x, y, width, height, confidence }
// x/y are the top-left corner of each word's bounding box.

function extractWords(visionResult) {
  const words = [];

  const pages = visionResult?.fullTextAnnotation?.pages || [];
  for (const page of pages) {
    for (const block of (page.blocks || [])) {
      for (const paragraph of (block.paragraphs || [])) {
        for (const word of (paragraph.words || [])) {
          const text = (word.symbols || []).map(s => s.text).join('');
          if (!text.trim()) continue;

          const verts = word.boundingBox?.vertices || [];
          if (verts.length < 4) continue;

          // Top-left and bottom-right vertices
          const xs = verts.map(v => v.x || 0);
          const ys = verts.map(v => v.y || 0);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          const width = Math.max(...xs) - x;
          const height = Math.max(...ys) - y;

          const confidence = word.confidence ?? 1.0;

          words.push({ text, x, y, width, height, confidence });
        }
      }
    }
  }

  return words;
}

// ─── PASS 1C: Group words into rows by Y-coordinate clustering ────────────────
// Words within (median word height * Y_TOLERANCE_FACTOR) of each other
// vertically are considered the same row.
// Returns array of rows, each row is array of words sorted left-to-right.

const Y_TOLERANCE_FACTOR = 0.6; // fraction of median word height

function groupWordsIntoRows(words) {
  if (!words.length) return [];

  // Use median word height as the baseline for row tolerance
  const heights = words.map(w => w.height).filter(h => h > 0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
  const yTolerance = medianHeight * Y_TOLERANCE_FACTOR;

  // Sort words top-to-bottom first
  const sorted = [...words].sort((a, b) => a.y - b.y);

  const rows = [];
  let currentRow = [sorted[0]];
  let rowBaseY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    if (Math.abs(word.y - rowBaseY) <= yTolerance) {
      currentRow.push(word);
    } else {
      rows.push(currentRow.sort((a, b) => a.x - b.x));
      currentRow = [word];
      rowBaseY = word.y;
    }
  }
  if (currentRow.length) rows.push(currentRow.sort((a, b) => a.x - b.x));

  return rows;
}

// ─── PASS 1D: Detect header row and column bands ──────────────────────────────
// Finds the row containing invoice column headers (qty, price, total, etc.)
// and extracts the X-position of each header word to define column bands.
// Returns { headerRowIndex, columns: [{ name, x, width }] } or null if not found.

const HEADER_KEYWORDS = new Set([
  'description', 'item', 'product', 'qty', 'quantity', 'ordered', 'shipped',
  'pack', 'size', 'unit', 'price', 'cost', 'amount', 'total', 'extended',
  'each', 'case', 'weight', 'wt', 'lb', 'uom', 'um', 'ext', 'net',
]);

function detectHeaderRow(rows) {
  let bestRowIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    const rowText = row.map(w => w.text.toLowerCase()).join(' ');
    let score = 0;
    for (const word of row) {
      if (HEADER_KEYWORDS.has(word.text.toLowerCase())) score++;
    }
    // Bonus if row has multiple header keywords close together
    if (score >= 2) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = i;
    }
  }

  if (bestScore < 2 || bestRowIndex === -1) return null;

  const headerRow = rows[bestRowIndex];
  const columns = headerRow.map(word => ({
    name: word.text.toLowerCase(),
    x: word.x,
    width: word.width || 40,
  }));

  return { headerRowIndex: bestRowIndex, columns };
}

// ─── PASS 1E: Assign row words to columns ─────────────────────────────────────
// For each data row, assigns each word to the nearest column band by X position.
// Returns array of { colName, text, x, confidence } per row.

function assignWordsToColumns(row, columns) {
  if (!columns || !columns.length) {
    // No column info — just return words in order with positional index as col name
    return row.map((word, i) => ({
      colName: `col_${i}`,
      text: word.text,
      x: word.x,
      confidence: word.confidence,
    }));
  }

  return row.map(word => {
    // Find nearest column by center-to-center X distance
    let bestCol = columns[0];
    let bestDist = Infinity;
    for (const col of columns) {
      const colCenter = col.x + (col.width / 2);
      const wordCenter = word.x + (word.width / 2);
      const dist = Math.abs(wordCenter - colCenter);
      if (dist < bestDist) {
        bestDist = dist;
        bestCol = col;
      }
    }
    return {
      colName: bestCol.name,
      text: word.text,
      x: word.x,
      confidence: word.confidence,
    };
  });
}

// ─── PASS 1F: Build structured rows for Claude ───────────────────────────────
// Combines word groups into row objects with merged cell text per column.
// Skips header row. Merges adjacent words in same column within same row.

function buildStructuredRows(rows, headerInfo) {
  const startIndex = headerInfo ? headerInfo.headerRowIndex + 1 : 0;
  const columns = headerInfo?.columns || null;

  const structuredRows = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length) continue;

    const assigned = assignWordsToColumns(row, columns);

    // Merge words that share the same colName
    const cellMap = {};
    for (const cell of assigned) {
      if (!cellMap[cell.colName]) {
        cellMap[cell.colName] = { text: cell.text, x: cell.x, confidence: cell.confidence };
      } else {
        // Append with space — preserve order by X
        cellMap[cell.colName].text += ' ' + cell.text;
        // Keep minimum confidence
        cellMap[cell.colName].confidence = Math.min(
          cellMap[cell.colName].confidence,
          cell.confidence
        );
      }
    }

    const cells = Object.entries(cellMap).map(([colName, cell]) => ({
      col: colName,
      text: cell.text.trim(),
      x: cell.x,
      confidence: Math.round(cell.confidence * 100) / 100,
    })).sort((a, b) => a.x - b.x);

    if (cells.length > 0) {
      structuredRows.push({ cells });
    }
  }

  return structuredRows;
}

// ─── PASS 1: Full Vision OCR pipeline ────────────────────────────────────────

async function runVisionOCR(fileBuffer, mediaType, res, fileName) {
  streamStatus(res,
    `Reading ${fileName || 'invoice'} layout...`,
    'Running OCR via Google Vision'
  );

  const visionResult = await callGoogleVision(fileBuffer, mediaType);

  // Image quality check — Vision returns an empty fullTextAnnotation if it can't read the image
  if (!visionResult?.fullTextAnnotation?.text) {
    throw new Error('Could not read text from image. Try a clearer, straighter photo.');
  }

  streamStatus(res, 'Detecting layout...', 'Grouping words into rows and columns');

  const words = extractWords(visionResult);
  console.log(`[parse-invoice] Vision extracted ${words.length} words`);

  if (words.length < 5) {
    throw new Error('Very little text detected. Try a higher resolution photo.');
  }

  const rows = groupWordsIntoRows(words);
  console.log(`[parse-invoice] Grouped into ${rows.length} rows`);

  const headerInfo = detectHeaderRow(rows);
  console.log(`[parse-invoice] Header row: ${headerInfo ? `row ${headerInfo.headerRowIndex} with columns: ${headerInfo.columns.map(c => c.name).join(', ')}` : 'not detected'}`);

  const structuredRows = buildStructuredRows(rows, headerInfo);
  console.log(`[parse-invoice] Built ${structuredRows.length} structured data rows`);

  // Also extract the full raw text for header info (supplier, invoice number, date)
  const rawText = visionResult.fullTextAnnotation.text;

  return {
    structuredRows,
    headerInfo,
    rawText,
    wordCount: words.length,
    rowCount: rows.length,
  };
}

// ─── PASS 2: Claude text-only parsing ────────────────────────────────────────
// Receives structured rows from Vision OCR — no image involved.
// Claude's job: normalize names, classify food/non-food, parse pack sizes,
// validate math, classify row types, derive unit costs.

async function parseStructuredRows(ocrResult, restaurantId, res) {
  streamStatus(res,
    'Extracting line items...',
    'Parsing rows and computing unit costs'
  );

  const { structuredRows, headerInfo, rawText } = ocrResult;

  // Format structured rows as a readable table for Claude
  const rowsText = structuredRows.map((row, i) => {
    const cells = row.cells.map(c => `${c.col}="${c.text}"`).join('  ');
    return `Row ${i + 1}: ${cells}`;
  }).join('\n');

  const headerContext = headerInfo
    ? `Detected column headers: ${headerInfo.columns.map(c => c.name).join(', ')}`
    : 'No column headers detected — infer columns from context.';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `You are an expert at parsing food service supplier invoice data. You have been given structured rows extracted by OCR from an invoice. Each row contains cells assigned to column names. Parse this into structured JSON.

CRITICAL: Output ONLY raw JSON. No preamble, no explanation, no markdown fences. Start with { and end with }.

════════════════════════════════════════
INVOICE HEADER (raw text extract)
════════════════════════════════════════
${rawText.slice(0, 800)}

════════════════════════════════════════
STRUCTURED ROWS FROM OCR
════════════════════════════════════════
${headerContext}

${rowsText}

════════════════════════════════════════
PARSING RULES
════════════════════════════════════════

ROW CLASSIFICATION — classify each row before parsing:
- "line_item": has a product description and at least one numeric value
- "subtotal": labeled SUBTOTAL, DRY TOTAL, FRZ TOTAL, CLR TOTAL, section total — SKIP
- "total": TOTAL, INVOICE TOTAL, AMOUNT DUE — extract as total_amount only, NOT a line item
- "tax_fee": TAX, FUEL SURCHARGE, HANDLING FEE — extract value, NOT a line item
- "header": column labels — already handled, skip
- "blank": empty or whitespace only — skip

CRITICAL — SUBTOTAL CONTAMINATION:
The last line item before a subtotal row has its OWN extended price, NOT the subtotal value.
If a number is dramatically larger than expected for that item (given qty × unit_price), 
it belongs to the subtotal row below, not the line item above.
Always validate: does line_total ≈ qty × unit_price? If not, something is wrong.

PACK SIZE PARSING:
"4 1 GAL"   → pack=4, size=1, size_unit="gal"
"36 1 LB"   → pack=36, size=1, size_unit="lb"
"8 6 LB"    → pack=8, size=6, size_unit="lb"
"30 100 CT" → pack=30, size=100, size_unit="ct"
"1 50 LBS"  → pack=1, size=50, size_unit="lb"
"6 2 LTR"   → pack=6, size=2, size_unit="l"
"5/2"       → pack=5, size=2, size_unit="lb"
"12/2.5"    → pack=12, size=2.5, size_unit="lb"
"1/10"      → pack=1, size=10, size_unit="lb"

UNIT COST COLUMN:
The column labeled "price", "unit price", "cost", or "each" is typically the price per CASE.
Set invoice_price = that value.

MANDATORY MATH VALIDATION — for every line item:
Test: qty_shipped × invoice_price ≈ line_total (standard)
  OR: qty_shipped × pack × size × invoice_price ≈ line_total (per-unit priced)
If you can read 4 of the 5 values, derive the 5th.
If math fails and you cannot fix it, set confidence = "low".

CATCH-WEIGHT ITEMS:
If a weight column has a value, test: weight × unit_cost ≈ line_total
  YES → catch_weight=true, actual_weight=weight value, invoice_price=unit_cost value
  NO  → catch_weight=false

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
Remove vendor codes and item numbers. Preserve size info (e.g. "7oz", "21-25ct").

CONFIDENCE:
"high"   = all values clearly readable and math checks out
"medium" = one value derived from others, math checks out
"low"    = math fails or values unreadable

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════

{
  "supplier": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "format_notes": "brief description of invoice format and any parsing issues",
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

    // ── Pass 1: Google Vision OCR + deterministic row/column building ─────────
    const t0 = Date.now();
    const ocrResult = await runVisionOCR(fileBuffer, mediaType, res, fileName);
    console.log(`[parse-invoice] Pass 1 done in ${Date.now() - t0}ms — ${ocrResult.wordCount} words, ${ocrResult.rowCount} rows, ${ocrResult.structuredRows.length} data rows`);

    if (!ocrResult.structuredRows.length) {
      try { fs.unlinkSync(file.filepath); } catch {}
      streamEvent(res, { type: 'error', error: 'Could not extract rows from invoice. Try a clearer photo.' });
      return res.end();
    }

    // Log structured rows for debugging
    console.log('[parse-invoice] Structured rows sample (first 5):\n',
      JSON.stringify(ocrResult.structuredRows.slice(0, 5), null, 2));

    streamStatus(res, 'OCR complete', `${ocrResult.structuredRows.length} rows extracted`);

    // ── Pass 2: Claude text-only parsing ─────────────────────────────────────
    const t1 = Date.now();
    const extracted = await parseStructuredRows(ocrResult, restaurantId, res);
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
          // transcription field removed — replaced by structured OCR
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