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
Use this decision tree for every item that has a WEIGHT column value:

  Step A: Try catch-weight math first: actual_weight × unit_cost_column ≈ line_total?
    → YES: catch_weight = true, invoice_price = unit_cost_column value, actual_weight = weight column value, pack = null, size = null
    → NO: Try standard math: quantity_shipped × unit_cost_column ≈ line_total?
      → YES: catch_weight = false, invoice_price = unit_cost_column value (weight column is informational only)
      → NO: You have a reading error — re-read all three values

The weight column value appearing in a row does NOT automatically mean catch_weight=true.
Test the math. If actual_weight × unit_cost = line_total, it IS catch-weight.
If qty_shipped × unit_cost = line_total, it is NOT catch-weight.

X/Y FORMAT IN DESCRIPTIONS — always parse this as pack/size:
When a product description contains a fraction-style notation like "5/2", "12/2.5", "1/10",
this is ALWAYS pack/size — meaning X packs of Y lbs each per case.
  pack = X (the number before the slash)
  size = Y (the number after the slash)
  size_unit = "lb" (default for seafood unless otherwise stated)

After reading pack/size from the X/Y notation, ALWAYS validate with this math:
  total_lbs = quantity_shipped × pack × size
  If total_lbs × invoice_price ≈ line_total → invoice_price is per lb (correct interpretation)
  If quantity_shipped × invoice_price ≈ line_total → invoice_price is per case

Example — Ocean Seafood Depot format:
  "4 CS  21-25 T/ON White India 5/2  UNIT PRICE: 6.50  AMOUNT: 260.00"
  → pack=5, size=2, size_unit="lb"
  → total_lbs = 4 × 5 × 2 = 40 lb
  → 40 × $6.50 = $260.00 ✓ → invoice_price is per lb
  → catch_weight = true, actual_weight = 40, invoice_price = 6.50

  "3 CS  31-40 T/OFF White Ecuador 5/2  UNIT PRICE: 5.95  AMOUNT: 178.50"
  → total_lbs = 3 × 5 × 2 = 30 lb
  → 30 × $5.95 = $178.50 ✓ → invoice_price is per lb
  → catch_weight = true, actual_weight = 30, invoice_price = 5.95

  "40.4 LB  SALMON FILLET S/ON 3-4  UNIT PRICE: 9.99  AMOUNT: 403.60"
  → quantity_unit = LB, no pack/size needed
  → 40.4 × $9.99 = $403.60 ✓ → catch_weight = true, actual_weight = 40.4, invoice_price = 9.99

  "1 CS  Squid Tubes 12/2.5  UNIT PRICE: 195.00  AMOUNT: 195.00"
  → pack=12, size=2.5 → total_lbs = 1 × 12 × 2.5 = 30 lb → 30 × 195 ≠ 195
  → test per-case: 1 × 195 = 195 ✓ → invoice_price IS per case here
  → catch_weight = false, invoice_price = 195.00

MANDATORY MATH VALIDATION AND DERIVATION — do this for EVERY item before outputting:

Every row has 5 numbers: qty_shipped, pack, size, invoice_price, line_total.
They satisfy one of these two equations:
  Standard:      qty_shipped × invoice_price = line_total  (invoice_price = price per case)
  Per-lb:        qty_shipped × pack × size × invoice_price = line_total  (invoice_price = price per lb)

These numbers are mathematically locked. If you can read 4 of them clearly, derive the 5th.
Never output a row as uncertain just because one number was hard to read — solve for it.

DERIVATION RULES — use whichever applies:

If you have qty, pack, size, invoice_price but line_total is unclear:
  line_total = qty × pack × size × invoice_price  (per-lb)
  OR line_total = qty × invoice_price  (per-case)
  Test both; whichever gives a plausible dollar amount is correct.

If you have qty, pack, size, line_total but invoice_price is unclear:
  invoice_price = line_total / (qty × pack × size)  (per-lb) — verify it's a plausible $/lb
  OR invoice_price = line_total / qty  (per-case) — verify it's a plausible $/case

If you have pack, size, invoice_price, line_total but qty is unclear:
  qty = line_total / (pack × size × invoice_price)  (per-lb)
  OR qty = line_total / invoice_price  (per-case)
  Round to nearest whole number; if not close to a whole number, try the other formula.

If you have qty, invoice_price, line_total but pack/size are unclear:
  Verify: qty × invoice_price ≈ line_total? → per-case pricing, pack/size are informational only
  OR: total_lbs = line_total / invoice_price; average_lbs_per_case = total_lbs / qty

CONFIDENCE RULES after derivation:
  All 5 values consistent (read or derived) → confidence = "high"
  4 values read cleanly, 1 derived and plausible → confidence = "high"
  3 values read, 2 derived but math checks out → confidence = "medium"
  Cannot make math work with any combination → confidence = "low", explain what you tried

NEVER output confidence = "low" when the math is solvable. Low confidence is only for rows
where you genuinely cannot read enough values to derive the rest.

ROW ISOLATION — this is the most important rule:
Before extracting ANY numbers for a line item, first read the complete horizontal text
of that single row from left edge to right edge and put it in the "raw_row_text" field.
Only numbers that appear in that raw_row_text may be used for that item's invoice_price,
line_total, pack, or size. If a number is not in raw_row_text, it cannot be used.

This prevents row bleeding — where a number from the row above or below gets misassigned.
If an item description contains words from two different products (e.g. "FOIL ROLL" mixed
with "RANCH DRESSING"), you have fused two rows — split them into separate items.

LOC COLUMN WARNING:
The first column (LOC) contains location codes: DRY, FRZ, CLR, or a number.
These are NOT part of the pack size. Never put "DRY", "FRZ", "CLR" in pack_size_raw.

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
      "raw_row_text": "complete text read horizontally across this single row, verbatim",
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

function matchScore(invoiceName, dbName) {
  const na = normalizeName(invoiceName); // invoice (longer, more descriptive)
  const nb = normalizeName(dbName);      // db ingredient name (often a short label)
  if (na === nb) return 1.0;
  if (nb.includes(na)) return 0.90; // invoice name fully contained in db name (rare)

  // Token overlap: what fraction of db name tokens appear in the invoice name?
  const tokensA = na.split(' ').filter(t => t.length > 2);
  const tokensB = nb.split(' ').filter(t => t.length > 2);
  const setA = new Set(tokensA);

  if (tokensB.length === 0) return 0;

  const matched = tokensB.filter(t => setA.has(t)).length;
  const dbCoverage = matched / tokensB.length; // fraction of db tokens found in invoice

  if (dbCoverage === 0) return 0;

  // Specificity bonus: longer db names that match are more trustworthy.
  // "Extra Virgin Olive Oil" matching is more meaningful than "Butter" matching.
  // Cap at 0.89 so only exact matches (1.0) and full-string containment (0.90) auto-confirm.
  const specificityBonus = Math.min(0.15, tokensB.length * 0.04);

  return Math.min(0.89, dbCoverage * 0.75 + specificityBonus);
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

  // Normalize: strip whitespace so '24319 55' and '2431955' are treated as the same
  const normalizedNumber = String(invoiceNumber).replace(/\s+/g, '');

  const { data } = await supabase
    .from('invoices')
    .select('id, date')
    .eq('restaurant_id', restaurantId)
    .eq('number', normalizedNumber)
    .maybeSingle();

  if (data) {
    console.warn(`[parse-invoice] Duplicate invoice detected: ${normalizedNumber} (id: ${data.id})`);
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

    // Filter out placeholder items Claude returns when a page is unreadable
    // (summary/totals pages, sideways photos, etc.) — identified by having no
    // invoice_price, no pack, and a null or generic item name.
    const readableItems = allLineItems.filter(item => {
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

    const skippedCount = allLineItems.length - readableItems.length;
    if (skippedCount > 0) console.log(`[parse-invoice] Skipped ${skippedCount} unreadable/placeholder items`);
    console.log(`[parse-invoice] ${readableItems.length} readable items: ${foodItems.length} food, ${nonFoodItems.length} non-food`);

    const lineItemsWithMatches = foodItems.map((item, idx) => {
      const matchResult = matchLineItem(item, restaurantIngredients);

      const needsCostInput = !item.invoice_price && !item.catch_weight;
      // needs_review: user must look at this item in the review UI
      // skip_number_review: numbers are confirmed good — only show ingredient matching UI
      const needsReview = needsCostInput
        || item.confidence === 'low'
        || matchResult.status === 'ambiguous'
        || matchResult.status === 'new';

      // Numbers are trustworthy when confidence is high or medium-with-derived-math.
      // New ingredients still need review for name confirmation, but not number checking.
      const skipNumberReview = item.confidence === 'high'
        || (item.confidence === 'medium' && !needsCostInput);

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
        skip_number_review: skipNumberReview,
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
        invoice_number: extracted.invoice_number
          ? String(extracted.invoice_number)
              .trim()
              .replace(/\s+/g, '')
              .replace(/[Ss]/g, '5')
              .replace(/[Oo]/g, '0')
              .replace(/[Ii|l]/g, '1')
              .replace(/[Bb]/g, '8')
              .replace(/[Zz]/g, '2')
              .replace(/[Gg]/g, '6')
          : null,
        invoice_date:   extracted.invoice_date,
        total_amount:   extracted.total_amount,
        format_notes:   extracted.format_notes || null,
        columns:        extracted.columns || [],
        confidence:     extracted.confidence || {},
      },
      line_items: lineItemsWithMatches,
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
    });

  } catch (err) {
    console.error('[parse-invoice] Error:', err);
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(500).json({ error: err.message || 'Failed to parse invoice' });
  }
}