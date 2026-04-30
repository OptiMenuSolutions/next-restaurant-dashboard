// pages/api/ai-recommendations.js
// Generates exactly 3 daily menu items for staff to push.
// Selection criteria: margin, POS popularity, and ingredients at risk of food waste.
// Recommendations are cached per restaurant per day in the ai_recommendations table.

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

  // Find most recent delivery per ingredient
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
    const totalValue = info.quantity * info.unitCost;

    // Include anything expiring within 5 days or already expired within 2 days
    if (daysLeft <= 5 && daysLeft >= -2) {
      expiring.push({
        name,
        daysLeft,
        unit: info.unit,
        quantity: info.quantity,
        totalValue,
      });
    }
  });

  return expiring.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ─── Load restaurant context ──────────────────────────────────────────────────
async function loadRestaurantContext(restaurantId) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

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
      .select('item_name, quantity_sold, revenue, sale_date')
      .eq('restaurant_id', restaurantId)
      .gte('sale_date', fourteenDaysAgoStr)
      .order('sale_date', { ascending: false }),

    getExpiringIngredients(restaurantId),
  ]);

  const menuItems = menuResult.data || [];
  const sales = salesResult.data || [];

  // Build a set of expiring ingredient names for fast lookup
  const expiringNames = new Set(expiringIngredients.map(e => e.name.toLowerCase().trim()));

  const menuWithMargins = menuItems.map(item => {
    const price = parseFloat(item.price || 0);
    let cost = parseFloat(item.cost || 0);
    if (item.menu_item_components?.length > 0) {
      const compCost = item.menu_item_components.reduce((s, c) => s + parseFloat(c.cost || 0), 0);
      if (compCost > 0) cost = compCost;
    }
    const margin = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : null;

    // Check if any component ingredient is in the expiring set
    const expiringInThisDish = [];
    (item.menu_item_components || []).forEach(comp => {
      (comp.component_ingredients || []).forEach(ci => {
        const ingName = (ci.ingredients?.name || '').toLowerCase().trim();
        if (!ingName) return;
        // Direct match or partial match against expiring ingredients
        const match = expiringIngredients.find(e =>
          e.name.toLowerCase().trim() === ingName ||
          ingName.includes(e.name.toLowerCase().trim()) ||
          e.name.toLowerCase().trim().includes(ingName)
        );
        if (match) expiringInThisDish.push({ name: match.name, daysLeft: match.daysLeft });
      });
    });

    return {
      id: item.id,
      name: item.name,
      price,
      cost,
      margin,
      category: item.category,
      expiringIngredients: expiringInThisDish,
    };
  }).filter(i => i.margin !== null);

  // Build sales maps
  const salesLast7 = {};
  const salesLast14 = {};
  for (const s of sales) {
    const qty = parseFloat(s.quantity_sold || 0);
    const rev = parseFloat(s.revenue || 0);
    if (s.sale_date >= sevenDaysAgoStr) {
      salesLast7[s.item_name] = salesLast7[s.item_name] || { qty: 0, rev: 0 };
      salesLast7[s.item_name].qty += qty;
      salesLast7[s.item_name].rev += rev;
    }
    salesLast14[s.item_name] = salesLast14[s.item_name] || { qty: 0, rev: 0 };
    salesLast14[s.item_name].qty += qty;
    salesLast14[s.item_name].rev += rev;
  }

  const enriched = menuWithMargins.map(item => {
    const posName = Object.keys(salesLast7).find(
      k => k.toLowerCase().includes(item.name.toLowerCase().split(' ')[0]) ||
           item.name.toLowerCase().includes(k.toLowerCase().split(' ')[0])
    );
    const last7 = posName ? salesLast7[posName] : null;
    const last14 = posName ? salesLast14[posName] : null;

    return {
      name: item.name,
      price: item.price,
      margin: Math.round((item.margin || 0) * 10) / 10,
      category: item.category || 'Other',
      qty_last_7d: last7 ? Math.round(last7.qty) : null,
      qty_last_14d: last14 ? Math.round(last14.qty) : null,
      expiring_ingredients: item.expiringIngredients,
      has_waste_risk: item.expiringIngredients.length > 0,
    };
  });

  return { enriched, expiringIngredients };
}

// ─── Build the prompt ─────────────────────────────────────────────────────────
function buildPrompt(enriched, expiringIngredients, currentDate, dayOfWeek) {
  const hasPOS = enriched.some(i => i.qty_last_7d !== null);
  const hasWaste = enriched.some(i => i.has_waste_risk);

  // Sort: waste-risk items first, then by margin desc
  const sorted = [...enriched].sort((a, b) => {
    if (a.has_waste_risk && !b.has_waste_risk) return -1;
    if (!a.has_waste_risk && b.has_waste_risk) return 1;
    return b.margin - a.margin;
  }).slice(0, 25);

  const menuLines = sorted.map(item => {
    const parts = [
      `${item.name} (${item.category})`,
      `$${item.price}`,
      `${item.margin}% margin`,
    ];
    if (item.qty_last_7d !== null) parts.push(`sold ${item.qty_last_7d} last 7d`);
    if (item.expiring_ingredients.length > 0) {
      const ingList = item.expiring_ingredients
        .map(e => e.daysLeft <= 0 ? `${e.name} [EXPIRED]` : `${e.name} [${e.daysLeft}d left]`)
        .join(', ');
      parts.push(`⚠ EXPIRING: ${ingList}`);
    }
    return '  - ' + parts.join(' · ');
  }).join('\n');

  // Separate expiring ingredients section for full context
  const expiringLines = expiringIngredients.length > 0
    ? expiringIngredients.slice(0, 15).map(e => {
        const urgency = e.daysLeft <= 0 ? 'EXPIRED' : e.daysLeft === 1 ? 'use TODAY' : `${e.daysLeft} days left`;
        return `  - ${e.name}: ${urgency}${e.quantity > 0 ? `, ${e.quantity} ${e.unit || 'units'} on hand` : ''}`;
      }).join('\n')
    : '  None identified';

  return `You are a restaurant profit optimization AI. Your job is to select exactly 3 menu items for staff to actively push to guests today, ${dayOfWeek} ${currentDate}.

SELECTION CRITERIA (strict priority order):
1. WASTE PREVENTION — dishes that use ingredients expiring within 2 days. These must move or the restaurant loses money.
2. MARGIN OPTIMIZATION — high-margin dishes that are underselling their potential.
3. MOMENTUM — high-margin dishes already trending, easy for staff to push with confidence.

Never recommend the same category twice. Aim for variety (e.g. one appetizer, one main, one pasta).

EXPIRING INGREDIENTS (from actual invoice delivery dates):
${expiringLines}

MENU ITEMS (sorted: waste-risk first, then by margin):
${menuLines}

${!hasPOS ? 'Note: No POS sales data — base recommendations on margin and waste risk only.' : ''}

Return ONLY valid JSON — no explanation, no markdown:
{
  "recommendations": [
    {
      "title": "Exact menu item name",
      "description": "One sentence: WHY push this today — name the specific expiring ingredient or margin figure (max 90 chars)",
      "talking_point": "Natural one-sentence script a server says to a guest — no business jargon, no mention of margins or expiry",
      "type": "inventory|margin|trending",
      "priority": 1
    },
    {
      "title": "...",
      "description": "...",
      "talking_point": "...",
      "type": "...",
      "priority": 2
    },
    {
      "title": "...",
      "description": "...",
      "talking_point": "...",
      "type": "...",
      "priority": 3
    }
  ]
}

type: "inventory" = expiring ingredient, "margin" = high margin underseller, "trending" = high margin + popular
talking_point: what the server actually says — warm, natural, guest-facing (e.g. "The halibut just came in this morning — it's incredible tonight.")`;
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

    let enriched = [];
    let expiringIngredients = [];
    try {
      ({ enriched, expiringIngredients } = await loadRestaurantContext(restaurantId));
    } catch (ctxErr) {
      console.error('[ai-recommendations] Context load error:', ctxErr.message);
    }

    const prompt = buildPrompt(enriched, expiringIngredients, currentDate, dayOfWeek);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
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
        { title: 'Check High Margin Items', description: 'Review your highest margin dishes and ask staff to suggest them today.', talking_point: 'This is one of our absolute favorites right now — I think you\'d love it.', type: 'margin', priority: 1 },
        { title: 'Move Perishables', description: 'Identify ingredients ordered this week and promote dishes that use them.', talking_point: 'We just got this in — it\'s incredibly fresh tonight.', type: 'inventory', priority: 2 },
        { title: 'Upsell Popular Items', description: 'Ask staff to suggest your best sellers as an add-on to every order.', talking_point: 'Guests have been loving this lately — it\'s a great choice tonight.', type: 'trending', priority: 3 },
      ],
      cached: false,
      error: 'Generated fallback recommendations',
    });
  }
}