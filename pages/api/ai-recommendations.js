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

// ─── Load all context needed for good recommendations ─────────────────────────

async function loadRestaurantContext(restaurantId) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  const [menuResult, salesResult, ingredientResult] = await Promise.all([
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

    supabase
      .from('ingredients')
      .select('id, name, unit, last_ordered_at, last_price')
      .eq('restaurant_id', restaurantId)
      .gte('last_ordered_at', thirtyDaysAgoStr)
      .not('last_ordered_at', 'is', null),
  ]);

  const menuItems = menuResult.data || [];
  const sales = salesResult.data || [];
  const recentIngredients = ingredientResult.data || [];

  const menuWithMargins = menuItems.map(item => {
    const price = parseFloat(item.price || 0);
    let cost = parseFloat(item.cost || 0);

    if (item.menu_item_components?.length > 0) {
      const compCost = item.menu_item_components.reduce((s, c) => s + parseFloat(c.cost || 0), 0);
      if (compCost > 0) cost = compCost;
    }

    const margin = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : null;

    const ingredientIds = new Set();
    (item.menu_item_components || []).forEach(c =>
      (c.component_ingredients || []).forEach(ci => {
        if (ci.ingredients?.id) ingredientIds.add(ci.ingredients.id);
      })
    );

    return {
      id: item.id,
      name: item.name,
      price,
      cost,
      margin,
      category: item.category,
      ingredient_ids: [...ingredientIds],
    };
  }).filter(i => i.margin !== null);

  const salesLast7 = {};
  const salesLast14 = {};
  for (const s of sales) {
    const qty = parseFloat(s.quantity_sold || 0);
    const rev = parseFloat(s.revenue || 0);
    if (s.sale_date >= sevenDaysAgoStr) {
      salesLast7[s.item_name] = (salesLast7[s.item_name] || { qty: 0, rev: 0 });
      salesLast7[s.item_name].qty += qty;
      salesLast7[s.item_name].rev += rev;
    }
    salesLast14[s.item_name] = (salesLast14[s.item_name] || { qty: 0, rev: 0 });
    salesLast14[s.item_name].qty += qty;
    salesLast14[s.item_name].rev += rev;
  }

  const slowItemNames = new Set(
    Object.entries(salesLast7)
      .filter(([, v]) => v.qty < 5)
      .map(([name]) => name.toLowerCase())
  );

  const atRiskIngredientIds = new Set(
    recentIngredients
      .filter(ing => {
        const ingLower = ing.name.toLowerCase().split(' ')[0];
        return [...slowItemNames].some(item => item.includes(ingLower) || ingLower.includes(item.split(' ')[0]));
      })
      .map(ing => ing.id)
  );

  const enriched = menuWithMargins.map(item => {
    const posName = Object.keys(salesLast7).find(
      k => k.toLowerCase().includes(item.name.toLowerCase().split(' ')[0]) ||
           item.name.toLowerCase().includes(k.toLowerCase().split(' ')[0])
    );

    const last7 = posName ? salesLast7[posName] : null;
    const last14 = posName ? salesLast14[posName] : null;
    const hasWasteRisk = item.ingredient_ids.some(id => atRiskIngredientIds.has(id));

    return {
      name: item.name,
      price: item.price,
      margin: Math.round(item.margin * 10) / 10,
      category: item.category || 'Other',
      qty_last_7d: last7 ? Math.round(last7.qty) : null,
      qty_last_14d: last14 ? Math.round(last14.qty) : null,
      has_waste_risk: hasWasteRisk,
      has_pos_data: !!last7,
    };
  });

  return enriched;
}

// ─── Build the prompt ─────────────────────────────────────────────────────────

function buildPrompt(menuData, currentDate, dayOfWeek) {
  const hasPOS = menuData.some(i => i.has_pos_data);
  const hasWaste = menuData.some(i => i.has_waste_risk);

  const menuLines = menuData
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 20)
    .map(item => {
      const parts = [
        `${item.name} (${item.category})`,
        `$${item.price}`,
        `${item.margin}% margin`,
      ];
      if (item.qty_last_7d !== null) parts.push(`sold ${item.qty_last_7d} last 7d`);
      if (item.has_waste_risk) parts.push('⚠ ingredient waste risk');
      return '  - ' + parts.join(' · ');
    })
    .join('\n');

  return `You are a restaurant profit optimization AI. Your job is to select exactly 3 menu items for staff to actively push to guests today, ${dayOfWeek} ${currentDate}.

SELECTION CRITERIA (in priority order):
1. Items with ingredients at waste risk — these must move today to avoid spoilage loss
2. High-margin items that are underselling relative to their potential
3. High-margin items that are already popular (staff momentum is easier to build)

Never recommend the same type of item twice. Aim for variety across categories.

MENU DATA:
${menuLines}

${!hasPOS ? 'Note: No POS sales data available — base recommendations on margin and category variety only.' : ''}
${hasWaste ? 'Note: Items marked with ⚠ have ingredients that were recently ordered and need to move.' : ''}

Return ONLY valid JSON — no explanation, no markdown:
{
  "recommendations": [
    {
      "title": "Item name (max 30 chars)",
      "description": "One sentence explaining WHY staff should push this today — be specific about margin or waste risk (max 80 chars)",
      "type": "inventory|margin|trending",
      "priority": 1
    },
    {
      "title": "...",
      "description": "...",
      "type": "...",
      "priority": 2
    },
    {
      "title": "...",
      "description": "...",
      "type": "...",
      "priority": 3
    }
  ]
}

type must be one of:
- "inventory" — ingredient waste risk, needs to move today
- "margin" — high margin, underselling
- "trending" — high margin AND already popular`;
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

    // Check cache first — skip Anthropic call if we already generated today
    const { data: cached, error: cacheError } = await supabase
      .from('ai_recommendations')
      .select('recommendations')
      .eq('restaurant_id', restaurantId)
      .eq('generated_date', currentDate)
      .single();

    if (!cacheError && cached?.recommendations) {
      return res.status(200).json({
        recommendations: cached.recommendations,
        cached: true,
        date: currentDate,
      });
    }

    let menuData = [];
    try {
      menuData = await loadRestaurantContext(restaurantId);
    } catch (ctxErr) {
      console.error('[ai-recommendations] Context load error:', ctxErr.message);
    }

    const prompt = buildPrompt(menuData, currentDate, dayOfWeek);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
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
        .upsert({
          restaurant_id: restaurantId,
          generated_date: currentDate,
          recommendations,
        });
    } catch (cacheWriteErr) {
      console.error('[ai-recommendations] Cache write error:', cacheWriteErr.message);
    }

    return res.status(200).json({
      recommendations,
      cached: false,
      date: currentDate,
    });

  } catch (err) {
    console.error('[ai-recommendations] Error:', err);

    return res.status(200).json({
      recommendations: [
        { title: 'Check High Margin Items', description: 'Review your highest margin dishes and ask staff to suggest them today.', type: 'margin', priority: 1 },
        { title: 'Move Perishables', description: 'Identify ingredients ordered this week and promote dishes that use them.', type: 'inventory', priority: 2 },
        { title: 'Upsell Popular Items', description: 'Ask staff to suggest your best sellers as an add-on to every order.', type: 'trending', priority: 3 },
      ],
      cached: false,
      error: 'Generated fallback recommendations',
    });
  }
}