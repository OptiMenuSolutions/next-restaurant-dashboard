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
import path from 'path';
import { logAiUsage } from '../../../lib/logAiUsage';

// Vercel's serverless functions have a hard 4.5MB request body limit,
// enforced at the platform level — not configurable via formidable's own
// maxFileSize or any Next.js config. This used to receive the raw file
// directly via multipart upload, which meant any real phone photo of an
// invoice could trivially exceed that limit and fail with a plain-text 413
// the client couldn't even parse as an error. Now the client uploads to
// Supabase Storage first (as it already did for record-keeping) and sends
// only the small file_url here — this function fetches the actual file
// content itself, server-to-server, which has no such limit.
export const config = {
  api: {
    responseLimit: false,
  },
  maxDuration: 300,
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Same retry/backoff as parse-menu.js — none of the three Claude calls this
// makes (parseWithClaude, sanityCheckCosts, matchWithClaude) were wrapped
// before. With multiple files now parsing at once (see the batch changes
// in lib/uploadInvoice.js), this is more exposed to rate limits than it
// was running one file at a time.
async function withRetry(fn, label, maxAttempts = 5) {
  let delay = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      const retryable = status === 429 || status === 529 || (status >= 500 && status < 600);
      if (!retryable || attempt === maxAttempts) throw err;
      const retryAfter = Number(err?.headers?.['retry-after'] ?? err?.response?.headers?.['retry-after']);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay;
      console.warn(`[retry] ${label} got ${status}, attempt ${attempt}/${maxAttempts}, waiting ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      delay = Math.min(delay * 2, 16000);
    }
  }
}

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

async function callMistralOCR(fileBuffer, mimeType) {
  const base64Content = fileBuffer.toString('base64');
  const isPDF = mimeType === 'application/pdf';

  const documentPayload = isPDF
    ? { type: 'document_url', document_url: `data:application/pdf;base64,${base64Content}` }
    : { type: 'image_url', image_url: `data:${mimeType};base64,${base64Content}` };

  const body = {
    model: 'mistral-ocr-latest',
    document: documentPayload,
    table_format: 'html',
  };

  const response = await withRetry(async () => {
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Mistral OCR error ${res.status}: ${errText}`);
      err.status = res.status; // withRetry needs this to detect 429/529/5xx
      throw err;
    }
    return res;
  }, 'mistral-ocr');

  const data = await response.json();
  const pages = data.pages || [];
  const fullText = pages.map(p => {
    let markdown = p.markdown || '';
    if (p.tables && p.tables.length > 0) {
      for (const table of p.tables) {
        const tableId = table.id || '';
        const placeholder = `[${tableId}](${tableId})`;
        if (tableId && markdown.includes(placeholder)) {
          markdown = markdown.replace(placeholder, table.content || '');
        }
      }
    }
    return markdown;
  }).join('\n\n');

  console.log(`[parse-invoice] Mistral OCR: ${pages.length} page(s), ${fullText.length} chars`);
  console.log(`[parse-invoice] OCR full text:\n${fullText.slice(0, 2000)}`);

  return fullText;
}

// ─── PASS 2: Claude text-only parsing ────────────────────────────────────────

async function parseWithClaude(ocrText, restaurantId, res) {
  streamStatus(res, 'Extracting line items...', 'Parsing rows and computing unit costs');

  const response = await withRetry(() => anthropic.messages.create({
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
- "subtotal": SUBTOTAL / DRY TOTAL / CLR TOTAL / FRZ TOTAL / COOLER → SKIP entirely
- "total": INVOICE TOTAL / AMOUNT DUE / TOTAL INVOICE DUE → extract as total_amount only
- "tax_fee": TAX / FUEL SURCHARGE / HANDLING → extract value only
- "header": column labels → skip
- "blank": empty → skip

CRITICAL — SUBTOTAL CONTAMINATION (quantity AND price):
Subtotal rows accumulate values from multiple line items above them.
NEVER use a subtotal row's quantity or price for any line item.
The last line item before a subtotal row has its OWN values — validate both:
  - line_total ≈ qty × invoice_price (within 5%) — if not, you grabbed the subtotal price
  - quantity_shipped should be a small number (cases ordered) — if it's hundreds or thousands, you grabbed a subtotal quantity
If either the quantity or price looks like an accumulation of prior rows, reject it and mark confidence="low".

QUANTITY_SHIPPED — CRITICAL DEFINITION:
quantity_shipped = the number printed in the SHP or ORD column for that row.
This is ALWAYS the number of cases, units, or catch-weight items actually shipped.
It is NEVER a derived total. Do NOT multiply quantity_shipped by pack or size.
Correct examples:
  - SHP=2, pack=6, size=5 lb → quantity_shipped=2 (2 cases shipped)
  - SHP=4, pack=1, size=40 lb → quantity_shipped=4 (4 cases shipped)
  - SHP=1, catch-weight=50.61 lb → quantity_shipped=1 (1 unit shipped)
Wrong: quantity_shipped=60 when SHP=2, pack=6, size=5 lb (that's 2×6×5=60 lb total, not the shipped qty)
Wrong: quantity_shipped=360 when SHP=2, pack=6, size=30 lb (that's total lbs, not cases)

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
"6 #10"     → pack=6, size=1, size_unit="can"
"1 6 #10"   → pack=1, size=6, size_unit="can"
"#10 CAN"   → pack=1, size=1, size_unit="can"

UNIT DISAMBIGUATION — PURCHASE UNIT ALWAYS WINS:
The purchase unit is whatever appears in the QTY UNIT or UOM column (CS, LB, EA, GAL, etc.).
The product name may contain a portion size (e.g. "7oz burger", "2oz slider", "5oz portion",
"12oz steak"). These describe the individual item size, NOT the purchase unit.
ALWAYS use the purchase unit column, never the product name size.
Examples:
  - "Angus Burger 7oz" with QTY_UNIT=LB → size_unit="lb", NOT "oz"
  - "Slider 2oz Super Thick" with QTY_UNIT=LB → size_unit="lb", NOT "oz"
  - "Chicken Breast 5oz Portion" with QTY_UNIT=LB → size_unit="lb", NOT "oz"
  - "Salmon Fillet 8oz" with QTY_UNIT=LB → size_unit="lb", NOT "oz"
If no QTY_UNIT column exists, default to "lb" for meat/poultry/seafood, "each" for portioned items.

CATCH-WEIGHT ITEMS:
Catch-weight means the item is priced by actual weight, not by case.
Indicators: a non-empty WEIGHT column, or qty_unit="LB" where price×weight≈line_total.

When catch_weight=true:
  - actual_weight = the value in the WEIGHT column exactly as printed
  - quantity_shipped = the SHP column value (cases shipped, typically 1–5)
  - invoice_price = the UNIT COST column value (price per lb)
  - VALIDATION (mandatory): actual_weight × invoice_price must ≈ line_total (within 5%)
  - If that fails, try: (actual_weight / quantity_shipped) × invoice_price ≈ line_total
    → if that works, you were double-counting; set actual_weight = actual_weight / quantity_shipped
  - If neither validates → confidence="low", explain in confidence_reason

Correct catch-weight example:
  CHEESE MOZZARELLA WM LOAF — SHP=1, WEIGHT=50.610, UNIT COST=2.177, EXTENDED=110.18
  → catch_weight=true, quantity_shipped=1, actual_weight=50.610, invoice_price=2.177
  → Validate: 50.610 × 2.177 = 110.18 ✓

Wrong catch-weight example:
  BABY BACK RIBS — SHP=6, WEIGHT=148 lb total, UNIT COST=3.10, EXTENDED=458.80
  If you set actual_weight=888 (6×148), then 888×3.10=2752.80 ≠ 458.80 → WRONG
  Correct: actual_weight=148, quantity_shipped=6, 148×3.10=458.80 ✓

Common catch-weight items: all whole-muscle beef cuts, pork ribs, brisket, whole fish fillets,
loaf cheeses (mozzarella, cheddar, jack, pepper jack, gruyere), deli meats, bacon slabs.

MATH VALIDATION (within 5%):
  Standard:      quantity_shipped × invoice_price ≈ line_total
  Per-unit:      quantity_shipped × pack × size × invoice_price ≈ line_total
  Catch-weight:  actual_weight × invoice_price ≈ line_total
Try all three. Use the one that works to set confidence.
If none work within 5% → confidence="low", describe which values seem wrong.

CONFIDENCE DEFINITION:
"high"   = all values clearly readable from the invoice AND math validates within 5%
"medium" = math validates but one value was derived or OCR required interpretation
"low"    = math fails for all three formulas, OR a value is unreadable

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
"ANGUS BURGER 7OZ" → "Angus Burger 7oz" (preserve portion size in name, but use LB as unit)
Remove vendor codes, item numbers, brand names from the normalized name.
Preserve size info (e.g. "7oz", "21-25ct") in the name only — do not use it as the purchase unit.

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
      "size_unit": "lb | oz | each | gal | l | ct | fl oz | dz | can",
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
  }), 'parseWithClaude');

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

// ─── Pass 2.5: Claude Haiku cost sanity check ─────────────────────────────────

async function sanityCheckCosts(foodItems, restaurantId) {
  if (!foodItems.length) return [];

  const itemList = foodItems.map((item, idx) => {
    const pack = item.pack ?? '?';
    const size = item.size ?? '?';
    const sizeUnit = item.size_unit ?? '?';
    const price = item.invoice_price ?? '?';
    const lineTotal = item.line_total ?? '?';
    const qty = item.quantity_shipped ?? item.quantity_ordered ?? '?';
    const catchWeight = item.catch_weight ? `catch-weight: ${item.actual_weight ?? '?'} lb` : null;

    return `${idx}: "${item.item_name_normalized || item.item_name_raw}" | qty=${qty} | pack=${pack} | size=${size} ${sizeUnit} | case_price=$${price} | line_total=$${lineTotal}${catchWeight ? ` | ${catchWeight}` : ''}`;
  }).join('\n');

  const response = await withRetry(() => anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a food service cost expert reviewing parsed invoice line items for errors.
Be AGGRESSIVE — when in doubt, flag it. A false positive that goes to human review
is far better than a wrong value that gets saved silently.

For each item, run ALL of these checks:

1. MATH: Does qty × case_price ≈ line_total (within 10%)?
   For catch-weight: actual_weight × case_price ≈ line_total?
   FLAG if math fails.

2. QUANTITY SANITY: Is this a plausible order quantity for a single restaurant?
   quantity_shipped should always be a small number of cases (typically 1–20).
   FLAG if quantity_shipped is suspiciously large (>50) for a case-bought item.
   FLAG if qty seems like total weight rather than cases:
   - Shredded cheese: 1-6 cases, not 80-360 (those are total lbs)
   - Butter: 1-4 cases, not 36-72 (those are total lbs)
   - Pasta: 1-4 cases, not 20-40 (those are total lbs)
   FLAG if qty × pack × size produces a total weight that seems unreasonable for one delivery.

3. UNIT COST PLAUSIBILITY: Does the implied cost-per-lb/each make sense?
   Use these rough benchmarks:
   - Ground beef / chopmeat: $3-6/lb
   - Chicken breast: $1.50-4/lb
   - Chicken wings: $2-5/lb
   - Shrimp 21-25ct: $5-10/lb
   - Lobster tail: $15-35/lb
   - Salmon fillet: $8-18/lb
   - Mozzarella shredded: $2-4/lb
   - Butter: $2-5/lb
   - Cooking oil: $0.50-2/lb
   - Pasta dry: $0.80-2/lb
   - French fries: $1-3/lb
   FLAG if implied unit cost is outside 3x the expected range.

4. UNIT SANITY: Does the unit make sense for this ingredient?
   FLAG if: gal for meat/poultry/seafood, oz where lb expected for bulk items,
   lb where each expected for portioned items, ct where lb expected for bulk.
   FLAG if unit is "oz" for a bulk meat/cheese item that should be in lb.

5. PACK SIZE SANITY: Does the pack × size make sense for this product?
   - Chicken wings: typically 1 case × 40 lb
   - Canned goods: typically 6 #10 cans per case
   - Cooking oil: typically 35 lb jugs or 1 gal containers
   FLAG if pack/size combination is implausible for the ingredient type.

6. IMPLIED TOTAL WEIGHT: qty × pack × size should be a reasonable purchase amount.
   FLAG if the total implied weight/volume is more than 5x what a typical
   restaurant would order in one delivery for that ingredient.

ITEMS TO CHECK:
${itemList}

Return ONLY raw JSON. No markdown, no explanation.
Flag ALL items that fail ANY check above. Be liberal with flagging.

{
  "flags": [
    {
      "index": 0,
      "reason": "brief description of which check failed and why"
    }
  ]
}`,
    }],
  }), 'sanityCheckCosts');

  await logAiUsage({
    feature: 'invoice_sanity',
    model: 'claude-haiku-4-5-20251001',
    usage: response.usage,
    restaurantId,
  });

  console.log(`[parse-invoice] Pass 2.5 sanity: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);

  const raw = response.content[0]?.text || '{}';
  const parsed = safeParseJSON(raw);
  return parsed?.flags || [];
}

// ─── Normalize ingredient name for matching ───────────────────────────────────

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Pass 3: Claude-powered ingredient matching ───────────────────────────────

async function matchWithClaude(foodItems, restaurantIngredients, restaurantId) {
  if (!restaurantIngredients.length) {
    return foodItems.map(item => ({ status: 'new', matches: [] }));
  }

  const libraryList = restaurantIngredients
    .map(ing => `- id:${ing.id} | "${ing.name}" | unit:${ing.unit}`)
    .join('\n');

  const itemList = foodItems
    .map((item, idx) => `${idx}: "${item.item_name_normalized || item.item_name_raw}"`)
    .join('\n');

  const response = await withRetry(() => anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are matching invoice line items to a restaurant's ingredient library.

INGREDIENT LIBRARY:
${libraryList}

INVOICE ITEMS TO MATCH (index: name):
${itemList}

For each invoice item, decide:
- "auto": clearly the same ingredient (same thing, just different phrasing, abbreviation, or brand noise). Pick exactly 1 match.
- "ambiguous": plausibly matches 2–5 library ingredients but you're not certain. List up to 5 candidates by confidence order.
- "new": no reasonable match exists in the library.

RULES:
- Be liberal with "auto" — "Chicken Breast BNLS SKNLS" → "Chicken Breast" is auto.
- Synonyms count: "Canola Oil" → "Frying Oil" is ambiguous, not new.
- Size/pack noise is irrelevant: "Mozzarella 5lb" → "Mozzarella" is auto.
- Only use ingredient IDs from the library above.
- Return ONLY raw JSON. No markdown, no explanation.

OUTPUT FORMAT:
{
  "matches": [
    {
      "index": 0,
      "status": "auto" | "ambiguous" | "new",
      "candidates": [
        { "id": "<ingredient_id>", "name": "<ingredient_name>", "score": 0.0–1.0 }
      ]
    }
  ]
}`,
    }],
  }), 'matchWithClaude');

  await logAiUsage({
    feature: 'invoice_match',
    model: 'claude-haiku-4-5-20251001',
    usage: response.usage,
    restaurantId,
  });

  console.log(`[parse-invoice] Pass 3 match: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);

  const raw = response.content[0]?.text || '{}';
  const parsed = safeParseJSON(raw);
  const matchResults = parsed?.matches || [];

  return foodItems.map((_, idx) => {
    const result = matchResults.find(m => m.index === idx);
    if (!result) return { status: 'new', matches: [] };

    const enriched = (result.candidates || []).map(c => {
      const libIng = restaurantIngredients.find(i => i.id === c.id);
      return libIng ? { ...libIng, score: c.score } : null;
    }).filter(Boolean);

    return { status: result.status, matches: enriched };
  });
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

  const { restaurant_id: restaurantId, file_url: fileUrl, file_name: fileNameInput } = req.body || {};

  if (!restaurantId) {
    streamEvent(res, { type: 'error', error: 'restaurant_id is required' });
    return res.end();
  }
  if (!fileUrl) {
    streamEvent(res, { type: 'error', error: 'file_url is required' });
    return res.end();
  }

  const fileName = fileNameInput || 'invoice';
  const ext = path.extname(fileName).toLowerCase();
  const isPDF = ext === '.pdf';

  const mimeType = isPDF ? 'application/pdf'
    : ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : 'image/jpeg';

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(mimeType)) {
    streamEvent(res, { type: 'error', error: 'Unsupported file type. Upload JPG, PNG, WEBP, or PDF.' });
    return res.end();
  }

  try {
    streamStatus(res, `Downloading ${fileName}...`, null);
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      streamEvent(res, { type: 'error', error: `Could not download the uploaded file (${fileRes.status}).` });
      return res.end();
    }
    const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

    // ── Pass 1: Mistral OCR ───────────────────────────────────────────────────
    streamStatus(res, `Reading ${fileName}...`, 'Extracting text with Mistral OCR');

    const t0 = Date.now();
    const ocrText = await callMistralOCR(fileBuffer, mimeType);
    console.log(`[parse-invoice] Mistral OCR done in ${Date.now() - t0}ms`);

    if (!ocrText || ocrText.trim().length < 20) {
      streamEvent(res, { type: 'error', error: 'Could not read invoice. Try a clearer photo.' });
      return res.end();
    }

    streamStatus(res, 'OCR complete', 'Parsing line items...');

    // ── Pass 2: Claude parsing ────────────────────────────────────────────────
    const t1 = Date.now();
    const extracted = await parseWithClaude(ocrText, restaurantId, res);
    console.log(`[parse-invoice] Pass 2 done in ${Date.now() - t1}ms`);

    if (!extracted) {
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

    // ── Pass 3: Claude ingredient matching (batched) ──────────────────────────
    streamStatus(res, 'Matching to your ingredient library...', `Checking ${foodItems.length} items against ${restaurantIngredients.length} ingredients`);

    const matchResults = await matchWithClaude(foodItems, restaurantIngredients, restaurantId);

    const sanityFlags    = await sanityCheckCosts(foodItems, restaurantId);
    const flaggedIndexes = new Set(sanityFlags.map(f => f.index));
    const sanityReasonMap = Object.fromEntries(sanityFlags.map(f => [f.index, f.reason]));

    let autoCount = 0, newCount = 0, ambiguousCount = 0;
    const lineItemsWithMatches = [];

    for (let idx = 0; idx < foodItems.length; idx++) {
      const item = foodItems[idx];
      const matchResult = matchResults[idx] || { status: 'new', matches: [] };

      const needsCostInput  = !item.invoice_price && !item.catch_weight;
      const isSanityFlagged = flaggedIndexes.has(idx);
      const needsReview     = needsCostInput
        || item.confidence === 'low'
        || isSanityFlagged
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
        sanity_flagged:           isSanityFlagged,
        sanity_reason:            sanityReasonMap[idx] || null,
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

    streamEvent(res, {
      type: 'result',
      data: {
        success:   true,
        file_url:  fileUrl || null,
        ocr_text:  ocrText || null,
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
    streamEvent(res, { type: 'error', error: err.message || 'Failed to parse invoice' });
    res.end();
  }
}