// pages/api/ai-recommendations.js
// On-demand route: called from the dashboard on page load, and from the
// unauthenticated staff briefing page (pages/staff/[token].js).
// Returns cached recs if already generated today, otherwise generates fresh.
//
// The actual generation logic lives in generateForRestaurant() below and is
// shared with /api/cron/generate-recommendations.js.
//
// Two authorization paths:
//   - Authenticated dashboard user: Bearer token + restaurantId, verified
//     against that user's own profile.restaurant_id.
//   - Staff/NFC page: nfcToken instead of a Bearer token — there is no user
//     session on that page at all by design (staff shouldn't need
//     accounts). The nfc_token itself is the authorization, resolved
//     server-side to a restaurant id — a client-supplied restaurantId is
//     never trusted without either a verified session or a valid token.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { logAiUsage } from '../../lib/logAiUsage';
import { getShelfLife, isProtein } from '../../lib/shelfLife';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EXCLUDED_CATEGORY_KEYWORDS = [
  'appetizer', 'starter', 'small plate', 'shareables', 'snack',
  'dessert', 'sweet', 'cake', 'ice cream',
  'drink', 'beverage', 'cocktail', 'beer', 'wine', 'soda', 'juice',
  'side', 'add on', 'add-on', 'extra',
  'soup', 'salad',
  'kids', 'children',
  'menu', 'uncategorized',
];

function isEntreeCategory(category) {
  if (!category) return false;
  const lower = category.toLowerCase();
  return !EXCLUDED_CATEGORY_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Compute expiring ingredients from invoice_items ──────────────────────────
async function getExpiringIngredients(restaurantId) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromDate = sixMonthsAgo.toISOString().split('T')[0];

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, date')
    .eq('restaurant_id', restaurantId)
    .gte('date', fromDate);

  if (!invoices?.length) return [];

  const { data: invoiceItems } = await supabase
    .from('invoice_items')
    .select('invoice_id, item_name, ingredient_name_normalized, quantity, unit, unit_cost')
    .in('invoice_id', invoices.map(i => i.id));

  const invoiceDateMap = {};
  invoices.forEach(inv => { invoiceDateMap[inv.id] = inv.date; });

  const latestByIngredient = {};
  (invoiceItems || []).forEach(item => {
    const name = (item.ingredient_name_normalized || item.item_name || '').trim();
    if (!name) return;
    const dateStr = invoiceDateMap[item.invoice_id];
    if (!dateStr) return;
    const date = new Date(dateStr);
    if (!latestByIngredient[name] || date > latestByIngredient[name].date) {
      latestByIngredient[name] = {
        date, dateStr,
        quantity: parseFloat(item.quantity || 0),
        unit: item.unit,
        unitCost: parseFloat(item.unit_cost || 0),
      };
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
      expiring.push({
        name,
        daysLeft,
        unit: info.unit,
        quantity: info.quantity,
        totalValue: info.quantity * info.unitCost,
        isProtein: isProtein(name),
      });
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
      .not('price', 'is', null)
      .limit(200),

    supabase
      .from('pos_sales')
      .select('item_name, quantity_sold, sale_date')
      .eq('restaurant_id', restaurantId)
      .gte('sale_date', fourteenDaysAgoStr)
      .order('sale_date', { ascending: false })
      .limit(5000),

    getExpiringIngredients(restaurantId),
  ]);

  const menuItems = menuResult.data || [];
  const sales = salesResult.data || [];

  // Build 7-day sales totals per item — normalize names for matching
  const salesLast7 = {};
  for (const s of sales) {
    if (s.sale_date < sevenDaysAgoStr) continue;
    const key = (s.item_name || '').toLowerCase().trim();
    salesLast7[key] = (salesLast7[key] || 0) + parseFloat(s.quantity_sold || 0);
  }

  const entreeItems = menuItems.filter(item => isEntreeCategory(item.category));
  const enriched = entreeItems.map(item => {
    const price = parseFloat(item.price || 0);
    let cost = parseFloat(item.cost || 0);
    if (item.menu_item_components?.length > 0) {
      const compCost = item.menu_item_components.reduce((s, c) => s + parseFloat(c.cost || 0), 0);
      if (compCost > 0) cost = compCost;
    }
    if (price === 0 || cost === 0) return null;

    const margin = ((price - cost) / price) * 100;
    const marginDollars = price - cost;

    // Find expiring ingredients in this dish
    const expiringInThisDish = [];
    (item.menu_item_components || []).forEach(comp => {
      (comp.component_ingredients || []).forEach(ci => {
        const ingName = (ci.ingredients?.name || '').toLowerCase().trim();
        if (!ingName) return;
        const ingWords = ingName.split(' ');
        const match = expiringIngredients.find(e => {
          const eName = e.name.toLowerCase().trim();
          const eWords = eName.split(' ');
          // Require at least 2 words to match, or full name match
          if (eName === ingName) return true;
          if (ingWords.length >= 2 && eWords.some(w => w.length > 3 && ingName.includes(w))) return true;
          if (eWords.length >= 2 && ingWords.some(w => w.length > 3 && eName.includes(w))) return true;
          return false;
        });
        if (match) expiringInThisDish.push({ name: match.name, daysLeft: match.daysLeft, isProtein: match.isProtein });
      });
    });

    // Tighter POS name matching — require meaningful word overlap, not just first word
    const itemWords = item.name.toLowerCase().trim().split(' ').filter(w => w.length > 3);
    const posKey = Object.keys(salesLast7).find(k => {
      const kWords = k.split(' ').filter(w => w.length > 3);
      const overlap = itemWords.filter(w => kWords.includes(w));
      return overlap.length >= Math.min(2, Math.ceil(itemWords.length * 0.5));
    });
    const qty7d = posKey ? salesLast7[posKey] : null;

    return {
      name: item.name,
      price,
      margin: Math.round(margin * 10) / 10,
      marginDollars: Math.round(marginDollars * 100) / 100,
      category: item.category || 'Other',
      qty7d,
      expiringIngredients: expiringInThisDish,
    };
  }).filter(Boolean);

  return { enriched, expiringIngredients };
}

// ─── Fetch recent recommendation history ──────────────────────────────────────
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

  if (!data?.length) return [];

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
      `$${item.marginDollars} margin/cover`,
    ];
    if (item.qty7d !== null) parts.push(`sold ${item.qty7d} last 7d`);
    else parts.push('no POS data');

    if (item.expiringIngredients.length > 0) {
      const ingList = item.expiringIngredients
        .map(e => {
          const urgency = e.daysLeft <= 0 ? 'EXPIRED' : e.daysLeft === 1 ? 'use TODAY' : `${e.daysLeft}d left`;
          return `${e.name}${e.isProtein ? ' [PROTEIN]' : ''} [${urgency}]`;
        })
        .join(', ');
      parts.push(`⚠ EXPIRING: ${ingList}`);
    }
    return '  - ' + parts.join(' · ');
  }).join('\n');

  const expiringLines = expiringIngredients.length > 0
    ? expiringIngredients.slice(0, 15).map(e => {
        const urgency = e.daysLeft <= 0 ? 'EXPIRED' : e.daysLeft === 1 ? 'use TODAY' : `${e.daysLeft} days left`;
        return `  - ${e.name}${e.isProtein ? ' [PROTEIN]' : ''}: ${urgency}${e.quantity > 0 ? `, ${e.quantity} ${e.unit || 'units'} on hand` : ''}${e.totalValue > 0 ? `, $${e.totalValue.toFixed(0)} at risk` : ''}`;
      }).join('\n')
    : '  None identified';

  const historyLines = history.length > 0
    ? history.map(h => `  - ${h.date}: ${h.title}`).join('\n')
    : '  No recent history';

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

RULE 1 — WASTE PREVENTION (highest priority)
Any dish containing an ingredient marked ⚠ EXPIRING with 2 or fewer days left MUST be selected.
Proteins expiring are the most urgent — a spoiled protein represents both food cost loss and a safety risk.
Exception: if that dish has appeared 3+ consecutive nights, find another dish using the same expiring ingredient.
If no alternative exists, repeat and explain in reason_selected.
Include the dollar value at risk in your reason_selected when available.

RULE 2 — VARIETY
No two selected dishes may share the same category.

RULE 3 — MARGIN VALUE (not just margin %)
After waste slots are filled, remaining picks go to dishes that are underperforming relative to their margin potential.
Use BOTH margin % AND margin per cover ($) when ranking. A dish at $8 margin/cover and 65% margin outranks a dish at $2 margin/cover and 72% margin. Weight dollar margin and % margin equally.
Deprioritize dishes with strong recent sales — they are already moving. Surface dishes with good margin that are being overlooked.

RULE 4 — ROTATION
Any dish appearing in the last 3 nights is ineligible unless forced by Rule 1. If forced, explain in reason_selected.

━━━ RECENT RECOMMENDATION HISTORY (last 5 nights) ━━━
${historyLines}
${streakWarnings ? `\n⚠ STREAK ALERTS:\n${streakWarnings}` : ''}

━━━ EXPIRING INGREDIENTS ━━━
${expiringLines}

━━━ MENU ━━━
${menuLines}

${!hasPOS ? 'Note: No POS data available — base popularity judgment on margin value and waste context only.' : ''}

━━━ RESPONSE FORMAT ━━━
Return ONLY valid JSON, no markdown, no commentary:
{
  "recommendations": [
    {
      "title": "Exact dish name as listed above",
      "reason_selected": "Specific plain-English explanation for the operator — name the expiring ingredient and days left, dollar value at risk, or explain the margin/rotation logic. Be specific.",
      "description": "One sentence for the staff ticket — what makes this dish worth pushing tonight, max 90 chars",
      "talking_point": "What a server says to a guest — warm and natural, no jargon, no mention of margins or expiry, max 120 chars",
      "type": "inventory | margin | trending",
      "priority": 1
    },
    { "title": "...", "reason_selected": "...", "description": "...", "talking_point": "...", "type": "...", "priority": 2 },
    { "title": "...", "reason_selected": "...", "description": "...", "talking_point": "...", "type": "...", "priority": 3 }
  ]
}

type: "inventory" = expiring ingredient drove selection · "margin" = underselling margin · "trending" = strong sales momentum`;
}

// ─── Core generation logic (shared with cron) ─────────────────────────────────
export async function generateForRestaurant(restaurantId, currentDate, dayOfWeek) {
  let enriched = [];
  let expiringIngredients = [];
  let history = [];

  try {
    [{ enriched, expiringIngredients }, history] = await Promise.all([
      loadRestaurantContext(restaurantId),
      getRecentHistory(restaurantId, currentDate),
    ]);
  } catch (ctxErr) {
    console.error(`[ai-recommendations] Context load error for ${restaurantId}:`, ctxErr.message);
  }

  const prompt = buildPrompt(enriched, expiringIngredients, history, dayOfWeek, currentDate);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  await logAiUsage({
    feature: 'dish_recs',
    model: 'claude-sonnet-4-6',
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
      .upsert({
        restaurant_id: restaurantId,
        generated_date: currentDate,
        recommendations,
        type: 'general',
      });
  } catch (cacheWriteErr) {
    console.error(`[ai-recommendations] Cache write error for ${restaurantId}:`, cacheWriteErr.message);
  }

  return recommendations;
}

// ─── On-demand handler ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { restaurantId: bodyRestaurantId, nfcToken } = req.body;
    let restaurantId = null;

    if (nfcToken) {
      // Staff/NFC path — no user session exists here at all, by design.
      // The token itself is the authorization; never trust a client-
      // supplied restaurantId without either this or a verified session.
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('nfc_token', nfcToken)
        .single();
      if (!restaurant) return res.status(403).json({ error: 'Invalid token' });
      restaurantId = restaurant.id;
    } else {
      // Existing authenticated-dashboard-user path.
      if (!bodyRestaurantId) return res.status(400).json({ error: 'restaurantId is required' });
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

      const { data: profile } = await supabase
        .from('profiles')
        .select('restaurant_id')
        .eq('id', user.id)
        .single();

      if (!profile || profile.restaurant_id !== bodyRestaurantId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      restaurantId = bodyRestaurantId;
    }

    const now = new Date();
    const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentDate = estDate.toISOString().split('T')[0];
    const dayOfWeek = estDate.toLocaleDateString('en-US', { weekday: 'long' });

    // Return cached recs if already generated today
    const { data: cached, error: cacheError } = await supabase
      .from('ai_recommendations')
      .select('recommendations')
      .eq('restaurant_id', restaurantId)
      .eq('generated_date', currentDate)
      .single();

    if (!cacheError && cached?.recommendations) {
      return res.status(200).json({ recommendations: cached.recommendations, cached: true, date: currentDate });
    }

    const recommendations = await generateForRestaurant(restaurantId, currentDate, dayOfWeek);
    return res.status(200).json({ recommendations, cached: false, date: currentDate });

  } catch (err) {
    console.error('[ai-recommendations] Error:', err);
    return res.status(200).json({ recommendations: [], cached: false, error: err.message });
  }
}
