// pages/api/invoices/parse-invoice.js
// Two-pass invoice parser:
//   Pass 1 (Google Vision + deterministic code):
//     - OCR via Google Cloud Vision document:annotate
//     - Rotation detection and coordinate correction
//     - Deterministic row building from Y-coordinate clustering
//     - Continuation line merging (multi-line items)
//     - Deterministic column assignment from header X-bands
//     - Outputs structured JSON rows (no markdown table)
//   Pass 2 (Claude text-only):
//     - Receives structured rows JSON
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

// ─── PASS 1A: Google Vision OCR ───────────────────────────────────────────────

async function callGoogleVision(fileBuffer) {
  const base64Image = fileBuffer.toString('base64');

  const body = {
    requests: [{
      image: { content: base64Image },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
      imageContext: {
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
  if (result?.error) throw new Error(`Google Vision error: ${result.error.message}`);
  return result;
}

// ─── PASS 1B: Rotation detection and coordinate correction ───────────────────
// Invoices photographed sideways (e.g. MQF) arrive as portrait images with
// landscape text. We detect this by comparing the image aspect ratio against
// the bounding box aspect ratio of all detected words.
// If image is portrait but word bbox is landscape → rotate coords 90°.

function correctRotation(words, imageWidth, imageHeight) {
  if (!words.length) return words;

  const isPortraitImage = imageHeight > imageWidth * 1.2;
  if (!isPortraitImage) return words; // landscape image, no correction needed

  // Compute bounding box of all words
  const minX = Math.min(...words.map(w => w.x));
  const maxX = Math.max(...words.map(w => w.x + w.width));
  const minY = Math.min(...words.map(w => w.y));
  const maxY = Math.max(...words.map(w => w.y + w.height));
  const wordBboxWidth = maxX - minX;
  const wordBboxHeight = maxY - minY;

  const isLandscapeText = wordBboxWidth > wordBboxHeight * 1.2;
  if (!isLandscapeText) return words; // text is also portrait, no correction needed

  // Text is rotated 90° clockwise relative to the image.
  // Transform: newX = imageHeight - y - height, newY = x
  // This maps rotated portrait coords → correct landscape coords.
  console.log(`[parse-invoice] Detected rotated image (${imageWidth}x${imageHeight}), correcting coordinates`);

  return words.map(w => ({
    ...w,
    x: imageHeight - w.y - w.height,
    y: w.x,
    width: w.height,
    height: w.width,
  }));
}

// ─── PASS 1C: Extract words with bounding boxes ───────────────────────────────

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

          const xs = verts.map(v => v.x || 0);
          const ys = verts.map(v => v.y || 0);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          const width = Math.max(...xs) - x;
          const height = Math.max(...ys) - y;

          words.push({ text, x, y, width, height, confidence: word.confidence ?? 1.0 });
        }
      }
    }
  }

  return words;
}

// ─── PASS 1D: Group words into rows by Y-coordinate clustering ────────────────
// Words within (median word height * Y_TOLERANCE_FACTOR) of each other
// vertically are the same row.

const Y_TOLERANCE_FACTOR = 0.6;

function groupWordsIntoRows(words) {
  if (!words.length) return [];

  const heights = words.map(w => w.height).filter(h => h > 0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
  const yTolerance = medianHeight * Y_TOLERANCE_FACTOR;

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

// ─── PASS 1E: Detect header row and column X-bands ───────────────────────────

const HEADER_KEYWORDS = new Set([
  'description', 'item', 'product', 'qty', 'quantity', 'ordered', 'shipped',
  'pack', 'size', 'unit', 'price', 'cost', 'amount', 'total', 'extended',
  'each', 'case', 'weight', 'wt', 'lb', 'uom', 'um', 'ext', 'net',
]);

function detectHeaderRow(rows) {
  let bestRowIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i];
    let score = 0;
    for (const word of row) {
      if (HEADER_KEYWORDS.has(word.text.toLowerCase())) score++;
    }
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

// ─── PASS 1F: Assign row words to columns ─────────────────────────────────────

function assignWordsToColumns(row, columns) {
  if (!columns || !columns.length) {
    return row.map((word, i) => ({
      colName: `col_${i}`,
      text: word.text,
      x: word.x,
      confidence: word.confidence,
    }));
  }

  return row.map(word => {
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

// ─── PASS 1G: Detect continuation lines and merge into parent item ────────────
// A row is a continuation of the previous item if:
//   - It contains no numeric values (pure descriptive text)
//   - It does not match any header keywords
//   - It immediately follows a data row (not a subtotal/total row)
// Continuation text is appended to the description cell of the parent row.

const NUMERIC_RE = /^\d+([.,]\d+)?$/;
const SUBTOTAL_RE = /\b(subtotal|sub.?total|dly\.?total|dry\.?total|clr\.?total|frz\.?total|total|amount.?due|invoice.?total)\b/i;

function hasContinuationSignal(rowText) {
  // Typical continuation words on Ocean Seafood invoices
  const continuationWords = ['wild', 'farmed', 'fresh', 'frozen'];
  const lowerText = rowText.toLowerCase();
  return continuationWords.some(w => lowerText.includes(w));
}

function mergeMultiLineItems(structuredRows) {
  const merged = [];

  for (let i = 0; i < structuredRows.length; i++) {
    const row = structuredRows[i];
    const rowText = row.cells.map(c => c.text).join(' ');

    // Check if this row is a subtotal/total — never merge these
    if (SUBTOTAL_RE.test(rowText)) {
      merged.push({ ...row, _rowType: 'subtotal' });
      continue;
    }

    // Check if this is a pure-text continuation row (no numeric cells)
    const numericCells = row.cells.filter(c => NUMERIC_RE.test(c.text.replace(/,/g, '')));
    const isContinuation = numericCells.length === 0 && merged.length > 0;

    if (isContinuation) {
      // Append text to the last merged row's description
      const lastRow = merged[merged.length - 1];
      if (lastRow._rowType !== 'subtotal') {
        // Find the description/product cell (the one with the most text)
        const descCell = lastRow.cells.reduce((best, c) =>
          c.text.length > best.text.length ? c : best, lastRow.cells[0]);
        if (descCell) {
          descCell.text = descCell.text + ' ' + rowText.trim();
        }
        continue; // don't add as its own row
      }
    }

    merged.push(row);
  }

  return merged;
}

// ─── PASS 1H: Build structured rows for Claude ───────────────────────────────

function buildStructuredRows(rows, headerInfo) {
  const startIndex = headerInfo ? headerInfo.headerRowIndex + 1 : 0;
  const columns = headerInfo?.columns || null;

  const structuredRows = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length) continue;

    const assigned = assignWordsToColumns(row, columns);

    const cellMap = {};
    for (const cell of assigned) {
      if (!cellMap[cell.colName]) {
        cellMap[cell.colName] = { text: cell.text, x: cell.x, confidence: cell.confidence };
      } else {
        cellMap[cell.colName].text += ' ' + cell.text;
        cellMap[cell.colName].confidence = Math.min(cellMap[cell.colName].confidence, cell.confidence);
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

  return mergeMultiLineItems(structuredRows);
}

// ─── PASS 1: Full Vision OCR pipeline ────────────────────────────────────────

async function runVisionOCR(fileBuffer, res, fileName) {
  streamStatus(res, `Reading ${fileName || 'invoice'} layout...`, 'Running OCR via Google Vision');

  const visionResult = await callGoogleVision(fileBuffer);

  if (!visionResult?.fullTextAnnotation?.text) {
    throw new Error('Could not read text from image. Try a clearer, straighter photo.');
  }

  streamStatus(res, 'Detecting layout...', 'Grouping words into rows and columns');

  const page = visionResult.fullTextAnnotation.pages?.[0];
  const imageWidth = page?.width || 0;
  const imageHeight = page?.height || 0;

  let words = extractWords(visionResult);
  console.log(`[parse-invoice] Vision extracted ${words.length} words (image: ${imageWidth}x${imageHeight})`);

  if (words.length < 5) {
    throw new Error('Very little text detected. Try a higher resolution photo.');
  }

  // Correct for sideways photos (e.g. MQF invoices photographed in landscape)
  words = correctRotation(words, imageWidth, imageHeight);

  const rows = groupWordsIntoRows(words);
  console.log(`[parse-invoice] Grouped into ${rows.length} rows`);

  const headerInfo = detectHeaderRow(rows);
  console.log(`[parse-invoice] Header: ${headerInfo
    ? `row ${headerInfo.headerRowIndex} — ${headerInfo.columns.map(c => c.name).join(', ')}`
    : 'not detected'}`);

  const structuredRows = buildStructuredRows(rows, headerInfo);
  console.log(`[parse-invoice] Built ${structuredRows.length} structured rows (after merging continuations)`);

  const rawText = visionResult.fullTextAnnotation.text;

  return { structuredRows, headerInfo, rawText, wordCount: words.length, rowCount: rows.length };
}

// ─── PASS 2: Claude text-only parsing ────────────────────────────────────────

async function parseStructuredRows(ocrResult, restaurantId, res) {
  streamStatus(res, 'Extracting line items...', 'Parsing rows and computing unit costs');

  const { structuredRows, headerInfo, rawText } = ocrResult;

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
      content: `You are an expert at parsing food service supplier invoice data. You have been given structured rows extracted by OCR from an invoice image. Each row shows cells with their detected column names. Parse this into structured JSON.

CRITICAL: Output ONLY raw JSON. No preamble, no explanation, no markdown fences. Start with { and end with }.

════════════════════════════════════════
INVOICE HEADER (raw OCR text, first 1000 chars)
════════════════════════════════════════
${rawText.slice(0, 1000)}

════════════════════════════════════════
STRUCTURED ROWS FROM OCR
════════════════════════════════════════
${headerContext}

${rowsText}

════════════════════════════════════════
PARSING RULES
════════════════════════════════════════

ROW CLASSIFICATION — classify each row before extracting values:
- "line_item": has a product description and at least one price/qty value → extract
- "subtotal": SUBTOTAL / DRY TOTAL / CLR TOTAL / FRZ TOTAL / section total → SKIP entirely
- "total": INVOICE TOTAL / AMOUNT DUE / TOTAL INVOICE DUE → extract as total_amount only
- "tax_fee": TAX / FUEL SURCHARGE / HANDLING → extract value only, not a line item
- "header": column labels → skip
- "blank": empty → skip

CRITICAL — SUBTOTAL CONTAMINATION:
The LAST line item before a subtotal row has its OWN extended price, not the subtotal.
Always validate: line_total ≈ qty × invoice_price (within 5%).
If line_total is 5–10x larger than expected for that item, you grabbed the subtotal — reject it and re-examine.

UNIT PRICE INTERPRETATION:
The column labeled "unit cost", "unit price", "price", or "each" is always the price per CASE.
Set invoice_price = that column value exactly.
Do NOT divide it further — unit_cost_derived in the UI handles per-unit math.

PACK SIZE PARSING — extract from the pack/size column or description:
"36 1 LB"   → pack=36, size=1, size_unit="lb"
"4 1 GAL"   → pack=4, size=1, size_unit="gal"
"8 6 LB"    → pack=8, size=6, size_unit="lb"
"1 50 LBS"  → pack=1, size=50, size_unit="lb"
"6 2 LTR"   → pack=6, size=2, size_unit="l"
"12 1 DZ"   → pack=12, size=1, size_unit="dz"
"5/2"       → pack=5, size=2, size_unit="lb"   (seafood X/Y format)
"12/2.5"    → pack=12, size=2.5, size_unit="lb"
"1/10"      → pack=1, size=10, size_unit="lb"
"10.350"    → this is a WEIGHT value in lbs, not a pack size

CATCH-WEIGHT (lb-priced seafood):
If qty_unit is "LB" (not CS) AND unit_price × qty ≈ line_total:
  catch_weight=true, actual_weight=qty, invoice_price=unit_price

MATH VALIDATION — for every line item, one of these must hold (within 5%):
  (A) qty × invoice_price ≈ line_total              [case pricing]
  (B) qty × pack × size × invoice_price ≈ line_total [per-unit pricing — rare]
  (C) actual_weight × invoice_price ≈ line_total     [catch-weight]
If you can read 4 of the 5 values, derive the 5th.
If none work, set confidence="low" and explain why.

IGNORE: handwritten annotations, circled numbers, crossed-out values, watermarks, stamps, signatures.

FOOD vs NON-FOOD:
is_food=false: cleaning supplies, paper goods, foil, bags, gloves, equipment, fees, taxes
is_food=true: all food, oils, condiments, beverages, dairy, produce, meat, seafood, spices

INGREDIENT NAME NORMALIZATION:
"CHIX BRS BNLS SKNLS" → "Chicken Breast Boneless Skinless"
"MOZZ WM LF" → "Mozzarella Whole Milk Loaf"
"CHDR LF YLW" → "Cheddar Cheese Yellow Loaf"
"COUNTRY MA BUTTER SALTED SOLIDS" → "Country Manor Butter Salted Solids"
"21-25 T/ON White India 5/2" → "Shrimp 21-25 Count Tail-On White India Farmed"
"5-8inTubes Only Squid Ocean Tide 12/2.5" → "Squid Tubes 5-8 inch Wild New Zealand"
"SALMON FILLET S/ON 3-4 PREMIUM PC" → "Salmon Fillet Skin-On 3-4 lb Premium Cut"
Remove vendor codes, item numbers, and brand names. Preserve size info (e.g. "7oz", "21-25ct").

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
      "item_name_raw": "exact text from OCR row",
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

    // ── Pass 1: Google Vision OCR + deterministic layout analysis ─────────────
    const t0 = Date.now();
    const ocrResult = await runVisionOCR(fileBuffer, res, fileName);
    console.log(`[parse-invoice] Pass 1 done in ${Date.now() - t0}ms — ${ocrResult.wordCount} words, ${ocrResult.structuredRows.length} data rows`);

    // Log first 5 structured rows for debugging
    console.log('[parse-invoice] Structured rows (first 5):\n',
      JSON.stringify(ocrResult.structuredRows.slice(0, 5), null, 2));

    if (!ocrResult.structuredRows.length) {
      try { fs.unlinkSync(file.filepath); } catch {}
      streamEvent(res, { type: 'error', error: 'Could not extract rows from invoice. Try a clearer photo.' });
      return res.end();
    }

    streamStatus(res, 'OCR complete', `${ocrResult.structuredRows.length} rows extracted`);

    // ── Pass 2: Claude text-only parsing ──────────────────────────────────────
    const t1 = Date.now();
    const extracted = await parseStructuredRows(ocrResult, restaurantId, res);
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