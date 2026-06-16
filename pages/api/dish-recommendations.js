// pages/api/dish-recommendations.js
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { logAiUsage } from '../../lib/logAiUsage';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ message: 'Missing restaurantId' });

    // Verify the calling user owns this restaurant
    const { verifyRestaurantAccess } = await import('../../lib/withRestaurantAuth');
    const { error: authError, status: authStatus } = await verifyRestaurantAccess(req, restaurantId);
    if (authError) return res.status(authStatus).json({ error: authError });

    const now = new Date();
    const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today = estDate.toISOString().split('T')[0];
    const dayOfWeek = estDate.toLocaleDateString('en-US', { weekday: 'long' });

    // Check cache
    const { data: cached } = await supabase
      .from('ai_recommendations')
      .select('recommendations')
      .eq('restaurant_id', restaurantId)
      .eq('generated_date', today)
      .eq('type', 'dish_push')
      .single();

    if (cached?.recommendations) {
      return res.status(200).json({ recommendations: cached.recommendations, cached: true });
    }

    const fourteenDaysAgo = new Date(estDate);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fromDate = fourteenDaysAgo.toISOString().split('T')[0];

    const { data: salesData } = await supabase
      .from('pos_sales')
      .select('item_name, quantity_sold, revenue, sale_date, category')
      .eq('restaurant_id', restaurantId)
      .gte('sale_date', fromDate)
      .order('sale_date', { ascending: false });

    const sevenDaysAgo = new Date(estDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fromDateRecent = sevenDaysAgo.toISOString().split('T')[0];

    const recentSales = (salesData || []).filter(s => s.sale_date >= fromDateRecent);

    const itemMap = {};
    for (const sale of salesData || []) {
      if (!itemMap[sale.item_name]) {
        itemMap[sale.item_name] = { name: sale.item_name, category: sale.category, qty14: 0, rev14: 0, qty7: 0 };
      }
      itemMap[sale.item_name].qty14 += parseFloat(sale.quantity_sold || 0);
      itemMap[sale.item_name].rev14 += parseFloat(sale.revenue || 0);
    }
    for (const sale of recentSales) {
      if (itemMap[sale.item_name]) itemMap[sale.item_name].qty7 += parseFloat(sale.quantity_sold || 0);
    }

    const items = Object.values(itemMap).sort((a, b) => b.qty14 - a.qty14);

    const { data: menuItems } = await supabase
      .from('menu_items')
      .select(`
        id, name, price,
        menu_item_components(
          cost,
          component_ingredients(quantity, ingredients(last_price, name))
        )
      `)
      .eq('restaurant_id', restaurantId);

    const menuMargins = {};
    for (const item of menuItems || []) {
      const cost = (item.menu_item_components || []).reduce((t, c) => t + parseFloat(c.cost || 0), 0);
      const price = parseFloat(item.price || 0);
      const margin = price > 0 ? ((price - cost) / price) * 100 : null;
      menuMargins[item.name.toLowerCase()] = { price, cost, margin };
    }

    const { data: ingredients } = await supabase
      .from('ingredients')
      .select('name, last_price, last_ordered_at, unit')
      .eq('restaurant_id', restaurantId)
      .not('last_ordered_at', 'is', null)
      .order('last_ordered_at', { ascending: false })
      .limit(50);

    const recentlyOrdered = (ingredients || []).filter(ing => {
      if (!ing.last_ordered_at) return false;
      const orderDate = new Date(ing.last_ordered_at);
      return orderDate >= sevenDaysAgo;
    }).map(i => i.name.toLowerCase());

    const topSellers = items.slice(0, 10).map(i => {
      const m = menuMargins[i.name.toLowerCase()];
      return `- ${i.name}: ${i.qty14} sold (14d), ${i.qty7} sold (7d), $${i.rev14.toFixed(0)} revenue${m?.margin ? `, ${m.margin.toFixed(1)}% margin` : ''}`;
    }).join('\n');

    const slowMovers = items.filter(i => i.qty7 < 3 && i.qty14 > 0).slice(0, 8).map(i => {
      const m = menuMargins[i.name.toLowerCase()];
      return `- ${i.name}: only ${i.qty7} sold in last 7 days${m?.margin ? `, ${m.margin.toFixed(1)}% margin` : ''}`;
    }).join('\n');

    const inventoryRisk = recentlyOrdered.slice(0, 10).join(', ');

    const highMarginItems = Object.entries(menuMargins)
      .filter(([, v]) => v.margin && v.margin >= 60)
      .map(([name, v]) => `- ${name}: ${v.margin.toFixed(1)}% margin, $${v.price} price`)
      .slice(0, 8)
      .join('\n');

    const prompt = `You are a restaurant operations AI. Today is ${dayOfWeek}, ${today}.

Recommend exactly 3 dishes for wait staff to actively promote today. Choose based on a balance of:
1. High profit margin (restaurant makes more money)
2. Slow-moving inventory that needs to be sold before spoilage
3. Items already trending (capitalize on momentum)

SALES DATA (last 14 days):
Top sellers:
${topSellers || 'No sales data yet'}

Slow movers (sold less than 3x in last 7 days):
${slowMovers || 'None identified'}

HIGH MARGIN MENU ITEMS (60%+ margin):
${highMarginItems || 'No margin data yet'}

RECENTLY ORDERED INGREDIENTS (likely in stock, at spoilage risk if slow moving):
${inventoryRisk || 'No inventory data'}

Return ONLY valid JSON, no other text:
{
  "recommendations": [
    {
      "dish": "Exact dish name from the menu",
      "reason": "One clear sentence explaining why to push this today",
      "talking_point": "A natural, one-sentence script for wait staff to use when recommending this dish to guests",
      "margin": 72.5,
      "confidence": 85,
      "urgency": "high",
      "type": "inventory"
    },
    {
      "dish": "Exact dish name",
      "reason": "One clear sentence",
      "talking_point": "A natural one-sentence script for wait staff",
      "margin": 65.0,
      "confidence": 78,
      "urgency": "medium",
      "type": "margin"
    },
    {
      "dish": "Exact dish name",
      "reason": "One clear sentence",
      "talking_point": "A natural one-sentence script for wait staff",
      "margin": 58.0,
      "confidence": 70,
      "urgency": "low",
      "type": "trending"
    }
  ]
}

urgency: "high" = spoilage risk, "medium" = strong margin opportunity, "low" = momentum play
type: "inventory" = move stock, "margin" = profit optimization, "trending" = capitalize on sales momentum
margin: actual margin percentage as a number, or null if unknown
confidence: 0-100 score reflecting how strongly the data supports this recommendation
talking_point: natural, conversational language a server would actually say — not robotic, no mention of margins or business metrics`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    await logAiUsage({
      feature: 'dish_recs',
      model: 'claude-sonnet-4-6',
      usage: message.usage,
      restaurantId,
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const aiResponse = JSON.parse(jsonMatch[0]);
    const recommendations = aiResponse.recommendations;

    await supabase
      .from('ai_recommendations')
      .upsert({
        restaurant_id: restaurantId,
        generated_date: today,
        recommendations,
        type: 'dish_push',
      })
      .catch(err => console.error('Cache error:', err));

    return res.status(200).json({ recommendations, cached: false });

  } catch (error) {
    console.error('Dish recommendations error:', error.message);
    return res.status(500).json({ message: 'Error generating recommendations', error: error.message });
  }
}