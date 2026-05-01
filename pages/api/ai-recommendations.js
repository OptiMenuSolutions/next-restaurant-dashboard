// pages/api/ai-recommendations.js
// Generates exactly 3 daily menu items for staff to push.
//
// HOW SELECTION WORKS (explainable to any client):
// Claude selects dishes using three inputs in strict priority order:
//   1. WASTE PREVENTION — dishes using ingredients expiring within 2 days must appear
//      unless the same dish has already been pushed 3+ nights in a row, in which case
//      Claude finds an alternative dish that also uses the expiring ingredient, or notes
//      that rotation forced a different waste-risk dish in.
//   2. VARIETY — no two picks can share the same category (e.g. two pastas, two apps).
//   3. MARGIN + ROTATION — after waste is handled, remaining slots go to dishes
//      Claude judges as underselling their margin potential, informed by 7-day sales.
//      High-margin dishes that already appear frequently are deprioritized.
//
// Claude must output a plain-English `reason_selected` per dish. This is the
// client-facing explanation for why that dish is on the ticket tonight.
//
// Rotation: the last 5 nights of recommendations are pulled from cache and passed
// to Claude so it can explicitly avoid repeating dishes unless forced to by waste.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { logAiUsage } from '../../lib/logAiUsage';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Shelf life knowledge (mirrors dashboard) ─────────────────────────────────
const SHELF_LIFE = {
  fish: 2, salmon: 2, tuna: 2, halibut: 2, cod: 2, tilapia: 2, mahi: 2,
  shrimp: 2, scallop: 2, lobster: 1, crab: 2, oyster: 3, clam: 3,
  swordfish: 2, bass: 2, snapper: 2, flounder: 2, trout: 2,
  chicken: 3, beef: 4, pork: 4, lamb: 4, veal: 3, duck: 3, turkey: 3,
  steak: 4, 'ground beef': 3, 'ground pork': 3, bacon: 7, sausage: 4,
  'filet mignon': 4, 'new york strip': 4, ribeye: 4, 'short rib': 4,
  milk: 7, cream: 7, butter: 14, cheese: 14, 'heavy cream': 7,
  mozzarella: 7, parmesan: 30,
  lettuce: 7, spinach: 5, arugula: 5, kale: 7, herbs: 5,
  basil: 5, parsley: 7, cilantro: 5, mushroom: 7,
  tomato: 7, strawberry: 5, raspberry: 3, blueberry: 7,
  avocado: 4, asparagus: 5,
  carrot: 21, onion: 30, garlic: 30, potato: 21,
  lemon: 21, lime: 14, pepper: 10,
  sauce: 30, oil: 180, flour: 180, pasta: 365, rice: 365,
};

function getShelfLife(name) {
  if (!name) return 14;
  const lower = name.toLowerCase();
  if (SHELF_LIFE[lower]) return SHELF_LIFE[lower];
  for (const [key, days] of Object.entries(SHELF_LIFE)) {
    if (lower.includes(key)) return days;
  }
  return 14;
}

// ─── Compute expiring ingredients from invoice_items ─────────────────────────
async function getExpiringIngredients(restaurantId) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromDate = sixMonthsAgo.toISOString().split('T')[0];

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, date')
    .eq('restaurant_id', restaurantId)
    .gte('date', fromDate);

  const { data: invoiceItems } = await supabase
    .from('invoice_items')
    .select('invoice_id, item_name, ingredient_name_normalized, quantity, unit, unit_cost')
    .in('invoice_id', (invoices || []).map(i => i.id));

  const invoiceDateMap = {};
  (invoices || []).forEach(inv => { invoiceDateMap[inv.id] = inv.date; });

  const latestByIngredient = {};
  (invoiceItems || []).forEach(item => {
    const name = (item.ingredient_name_normalized || item.item_name || '').trim();
    if (!name) return;
    const dateStr = invoiceDateMap[item.invoice_id];
    if (!dateStr) return;
    const date = new Date(dateStr);
    if (!latestByIngredient[name] || date > latestByIngredient[name].date) {
      latestByIngredient[name] = { date, dateStr, quantity: parseFloat(item.quantity || 0), unit: item.unit, unitCost: parseFloat(item.unit_cost || 0) };
    }
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiring = [];
  Object.entries(latestByIngredient).forEach(([name, info]) => {
    const shelfLife = getShelfLife(name);
    const delivery = new Date(info.date);
    delivery.setHours(0, 0, 0, 0);
    const daysSince = Math.floor((today - delivery) / 86400000);
    const daysLeft = shelfLife - daysSince;
    if (daysLeft <= 5 && daysLeft >= -2) {
      expiring.push({ name, daysLeft, unit: info.unit, quantity: info.quantity, totalValue: info.quantity * info.unitCost });
    }
  });

  return expiring.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ─── Load restaurant context ──────────────────────────────────────────────────
async function loadRestaurantContext(restaurantId) {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  const [menuResult, salesResult, expiringIngredients] = await Promise.all([
    supabase
      .from('menu_items')
      .select(`
        id, name, price, cost, category,
        menu_item_components (
          cost,
          component_ingredients (
            quantity,
            ingredients:ingredient_id (
              id, name, last_price, last_ordered_at
            )
          )
        )
      `)
      .eq('restaurant_id', restaurantId)
      .not('price', 'is', null),

    supabase
      .from('pos_sales')
      .select('item_name, quantity_sold, sale_date')
      .eq('restaurant_id', restaurantId)
      .gte('sale_date', fourteenDaysAgoStr)
      .order('sale_date', { ascending: false }),

    getExpiringIngredients(restaurantId),
  ]);

  const menuItems = menuResult.data || [];
  const sales = salesResult.data || [];

  // Build 7-day sales totals per item name
  const salesLast7 = {};
  for (const s of sales) {
    if (s.sale_date < sevenDaysAgoStr) continue;
    const key = (s.item_name || '').toLowerCase().trim();
    salesLast7[key] = (salesLast7[key] || 0) + parseFloat(s.quantity_sold || 0);
  }

  const enriched = menuItems.map(item => {
    const price = parseFloat(item.price || 0);
    let cost = parseFloat(item.cost || 0);
    if (item.menu_item_components?.length > 0) {
      const compCost = item.menu_item_components.reduce((s, c) => s + parseFloat(c.cost || 0), 0);
      if (compCost > 0) cost = compCost;
    }
    if (price === 0 || cost === 0) return null;
    const margin = ((price - cost) / price) * 100;

    // Find expiring ingredients in this dish
    const expiringInThisDish = [];
    (item.menu_item_components || []).forEach(comp => {
      (comp.component_ingredients || []).forEach(ci => {
        const ingName = (ci.ingredients?.name || '').toLowerCase().trim();
        if (!ingName) return;
        const match = expiringIngredients.find(e =>
          e.name.toLowerCase().trim() === ingName ||
          ingName.includes(e.name.toLowerCase().trim()) ||
          e.name.toLowerCase().trim().includes(ingName)
        );
        if (match) expiringInThisDish.push({ name: match.name, daysLeft: match.daysLeft });
      });
    });

    // Match POS sales by fuzzy name
    const itemLower = item.name.toLowerCase().trim();
    const posKey = Object.keys(salesLast7).find(k =>
      k.includes(itemLower.split(' ')[0]) || itemLower.includes(k.split(' ')[0])
    );
    const qty7d = posKey ? salesLast7[posKey] : null;

    return {
      name: item.name,
      price,
      margin: Math.round(margin * 10) / 10,
      category: item.category || 'Other',
      qty7d,
      expiringIngredients: expiringInThisDish,
    };
  }).filter(Boolean);

  return { enriched, expiringIngredients };
}

// ─── Fetch recent recommendation history for rotation awareness ───────────────
async function getRecentHistory(restaurantId, currentDate) {
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const fromDate = fiveDaysAgo.toISOString().split('T')[0];

  const { data } = await supabase
    .from('ai_recommendations')
    .select('generated_date, recommendations')
    .eq('restaurant_id', restaurantId)
    .gte('generated_date', fromDate)
    .neq('generated_date', currentDate)
    .order('generated_date', { ascending: false });

  if (!data || data.length === 0) return [];

  const history = [];
  for (const row of data) {
    for (const rec of (row.recommendations || [])) {
      if (rec.title) history.push({ date: row.generated_date, title: rec.title });
    }
  }
  return history;
}

// ─── Build the prompt ─────────────────────────────────────────────────────────
function buildPrompt(enriched, expiringIngredients, history, dayOfWeek, currentDate) {
  const hasPOS = enriched.some(i => i.qty7d !== null);

  const menuLines = enriched.map(item => {
    const parts = [
      `${item.name} (${item.category})`,
      `$${item.price}`,
      `${item.margin}% margin`,
    ];
    if (item.qty7d !== null) parts.push(`sold ${item.qty7d} last 7d`);
    else parts.push('no POS data');

    if (item.expiringIngredients.length > 0) {
      const ingList = item.expiringIngredients
        .map(e => e.daysLeft <= 0 ? `${e.name} [EXPIRED]` : `${e.name} [${e.daysLeft}d left]`)
        .join(', ');
      parts.push(`⚠ EXPIRING: ${ingList}`);
    }
    return '  - ' + parts.join(' · ');
  }).join('\n');

  const expiringLines = expiringIngredients.length > 0
    ? expiringIngredients.slice(0, 15).map(e => {
        const urgency = e.daysLeft <= 0 ? 'EXPIRED' : e.daysLeft === 1 ? 'use TODAY' : `${e.daysLeft} days left`;
        return `  - ${e.name}: ${urgency}${e.quantity > 0 ? `, ${e.quantity} ${e.unit || 'units'} on hand` : ''}`;
      }).join('\n')
    : '  None identified';

  const historyLines = history.length > 0
    ? history.map(h => `  - ${h.date}: ${h.title}`).join('\n')
    : '  No recent history';

  // Flag any dish recommended 2+ nights in a row
  const consecutiveCounts = {};
  for (const h of history) {
    consecutiveCounts[h.title] = (consecutiveCounts[h.title] || 0) + 1;
  }
  const streakWarnings = Object.entries(consecutiveCounts)
    .filter(([, count]) => count >= 2)
    .map(([title, count]) => `  - "${title}" has appeared ${count} nights in a row — avoid unless forced by waste`)
    .join('\n');

  return `You are a restaurant profit optimization AI. Select exactly 3 menu items for staff to push tonight, ${dayOfWeek} ${currentDate}.

━━━ SELECTION RULES (follow in strict order) ━━━

RULE 1 — WASTE PREVENTION
Any dish containing an ingredient expiring within 2 days MUST be selected, with one exception: if that same dish has appeared on the recommendation list for 3 or more consecutive nights, you must instead find another dish on the menu that also uses the expiring ingredient. If no alternative exists, repeat the dish and explain why in reason_selected. Pushing the same dish every night to cover one expiring ingredient will eventually create waste in other ingredients that stop moving.

RULE 2 — VARIETY
No two selected dishes may share the same category. Spread the picks across the menu.

RULE 3 — UNDERSELLING MARGIN (not just high margin)
After waste slots are filled, remaining picks go to dishes that are leaving money on the table — good margin but low recent sales relative to what they should be doing. Do not simply pick the highest-margin dish every night. If a strong-margin dish has appeared recently, give a different one a turn. The operator already knows their top margin dish. Surface something they might be overlooking.

RULE 4 — ROTATION
Treat any dish appearing in the last 3 nights as ineligible, unless forced by Rule 1. If you must repeat, say so in reason_selected.

━━━ RECENT RECOMMENDATION HISTORY (last 5 nights) ━━━
${historyLines}
${streakWarnings ? `\n⚠ STREAK ALERTS:\n${streakWarnings}` : ''}

━━━ EXPIRING INGREDIENTS ━━━
${expiringLines}

━━━ MENU ━━━
${menuLines}

${!hasPOS ? 'Note: No POS data available — judge popularity from margin and waste context only.' : ''}

━━━ RESPONSE FORMAT ━━━
Return ONLY valid JSON, no markdown:
{
  "recommendations": [
    {
      "title": "Exact dish name as listed above",
      "reason_selected": "Specific plain-English explanation for the operator — name the expiring ingredient and days left, or explain the margin/rotation logic. This is your audit trail. Be specific.",
      "description": "One sentence for the staff ticket — same idea as reason_selected, max 90 chars",
      "talking_point": "What a server says to a guest — warm and natural, no jargon, no mention of margins or expiry, max 120 chars",
      "type": "inventory | margin | trending",
      "priority": 1
    },
    { "title": "...", "reason_selected": "...", "description": "...", "talking_point": "...", "type": "...", "priority": 2 },
    { "title": "...", "reason_selected": "...", "description": "...", "talking_point": "...", "type": "...", "priority": 3 }
  ]
}

type: "inventory" = expiring ingredient drove selection · "margin" = underselling margin · "trending" = strong sales + good margin
reason_selected example: "Grilled Salmon selected — halibut expires tomorrow (1d left), dish hasn't appeared since Tuesday, moving it tonight prevents a $47 loss."`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

    const now = new Date();
    const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentDate = estDate.toISOString().split('T')[0];
    const dayOfWeek = estDate.toLocaleDateString('en-US', { weekday: 'long' });

    // Check cache
    const { data: cached, error: cacheError } = await supabase
      .from('ai_recommendations')
      .select('recommendations')
      .eq('restaurant_id', restaurantId)
      .eq('generated_date', currentDate)
      .single();

    if (!cacheError && cached?.recommendations) {
      return res.status(200).json({ recommendations: cached.recommendations, cached: true, date: currentDate });
    }

    // Load context and history in parallel
    let enriched = [];
    let expiringIngredients = [];
    let history = [];
    try {
      [{ enriched, expiringIngredients }, history] = await Promise.all([
        loadRestaurantContext(restaurantId),
        getRecentHistory(restaurantId, currentDate),
      ]);
    } catch (ctxErr) {
      console.error('[ai-recommendations] Context load error:', ctxErr.message);
    }

    const prompt = buildPrompt(enriched, expiringIngredients, history, dayOfWeek, currentDate);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    await logAiUsage({
      feature: 'dish_recs',
      model: 'claude-sonnet-4-20250514',
      usage: message.usage,
      restaurantId,
    });

    const raw = message.content[0]?.text || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    let aiResponse;
    try {
      aiResponse = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      aiResponse = match ? JSON.parse(match[0]) : { recommendations: [] };
    }

    const recommendations = (aiResponse.recommendations || []).slice(0, 3);

    // Cache the result
    try {
      await supabase
        .from('ai_recommendations')
        .upsert({ restaurant_id: restaurantId, generated_date: currentDate, recommendations });
    } catch (cacheWriteErr) {
      console.error('[ai-recommendations] Cache write error:', cacheWriteErr.message);
    }

    return res.status(200).json({ recommendations, cached: false, date: currentDate });

  } catch (err) {
    console.error('[ai-recommendations] Error:', err);
    return res.status(200).json({
      recommendations: [
        { title: 'Check High Margin Items', description: 'Review your highest margin dishes and ask staff to suggest them today.', talking_point: "This is one of our absolute favorites right now — I think you'd love it.", type: 'margin', priority: 1 },
        { title: 'Move Perishables', description: 'Identify ingredients ordered this week and promote dishes that use them.', talking_point: "We just got this in — it's incredibly fresh tonight.", type: 'inventory', priority: 2 },
        { title: 'Upsell Popular Items', description: 'Ask staff to suggest your best sellers as an add-on to every order.', talking_point: "Guests have been loving this lately — it's a great choice tonight.", type: 'trending', priority: 3 },
      ],
      cached: false,
      error: 'Generated fallback recommendations',
    });
  }
}