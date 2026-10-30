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
//   - Tag page (/t/<code>): tagCode, a random code stored in nfc_tags and
//     resolved server-side to a restaurant id.
//   - Older staff links (/staff/<token>): nfcToken, resolved the same way.
//   Neither staff path has a user session, by design. A client-supplied
//   restaurantId is never trusted without a verified session or a valid
//   code or token. Staff paths only get title, description, talking_point.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { logAiUsage } from '../../lib/logAiUsage';
import { getShelfLife, isProtein } from '../../lib/shelfLife';
import { loadCurrentInventory } from '../../lib/currentInventory';
import { calculateStandardizedCost } from '../../lib/standardizedUnits';
import { requireActiveSubscription } from '../../lib/requireActiveSubscription';
import { buildPrompt } from '../../lib/ai/prompts/tonightsDish';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EXCLUDED_CATEGORY_KEYWORDS = [
  'appetizer', 'starter', 'small plate', 'shareables', 'snack',
  'dessert', 'sweet', 'cake', 'ice cream', 'treat', 'pastr',
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

// ─── Expiring ingredients: same source as the dashboard Waste Risk panel ─────
// This used to be its own calculation (latest delivery only, six months of
// invoices, no sales subtracted, no freezer settings), so tickets could cite
// "flour wraps expiring, $67 at risk" while the dashboard showed nothing at
// risk. It now runs computeWasteRisk on the dashboard's exact inputs and only
// passes along what is actually close to expiring and still on hand.
// ─── Expiring ingredients: read from current_inventory ───────────────────────
// Same rows the dashboard Waste Risk panel reads, so tickets only ever cite
// risk the owner can also see on the panel.
async function getExpiringIngredients(restaurantId) {
  const inventory = await loadCurrentInventory(supabase, restaurantId);
  return inventory
    .filter(
      (r) =>
        r.remainingQty > 0 &&
        Number.isFinite(r.daysLeft) &&
        r.daysLeft <= 5 &&
        r.daysLeft >= -2
    )
    .map((r) => ({
      name: r.name,
      daysLeft: r.daysLeft,
      unit: r.unit,
      quantity: Math.round(r.remainingQty * 100) / 100,
      totalValue: r.totalValue,
      isProtein: r.protein,
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
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
            unit,
            ingredients:ingredient_id (
              id, name, unit, last_price, last_ordered_at, is_estimated, price_approved_at
            )
          )
        )
      `)
      .eq('restaurant_id', restaurantId)
      .is('archived_at', null)
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
    if (price === 0) return null;

    // Cost only from prices the restaurant is allowed to see: invoice prices
    // or admin-approved estimates. Stored menu_items.cost / component.cost
    // were computed from the menu parser's AI guesses and must not be used.
    // If any ingredient is an unapproved guess, the margin is unknown — the
    // dish stays eligible for waste / sales / variety picks.
    const lines = (item.menu_item_components || []).flatMap(c => c.component_ingredients || []);
    let cost = null;
    if (lines.length && lines.every(ci => ci.ingredients && (ci.ingredients.is_estimated === false || ci.ingredients.price_approved_at))) {
      cost = lines.reduce((sum, ci) => {
        const g = ci.ingredients;
        const recipeUnit = ci.unit || g.unit || 'each';
        return sum + calculateStandardizedCost(
          parseFloat(ci.quantity || 0), recipeUnit, parseFloat(g.last_price || 0), g.unit || recipeUnit, g.name || ''
        );
      }, 0);
    }
    const margin = cost != null ? ((price - cost) / price) * 100 : null;
    const marginDollars = cost != null ? price - cost : null;

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
      margin: margin != null ? Math.round(margin * 10) / 10 : null,
      marginDollars: marginDollars != null ? Math.round(marginDollars * 100) / 100 : null,
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
    max_tokens: 4000, // 1000 truncated larger menus mid-JSON (Echo Tap failed the cron on several days)
    messages: [{ role: 'user', content: prompt }],
  });

  await logAiUsage({
    feature: 'dish_recs',
    model: 'claude-sonnet-4-6',
    usage: message.usage,
    restaurantId,
  });

  if (message.stop_reason === 'max_tokens') {
    console.warn(`[ai-recommendations] Response hit max_tokens for ${restaurantId}, output truncated`);
  }
  const raw = message.content[0]?.text || '{}';
  const cleaned = raw.replace(/```json|```/g, '').trim();
  let aiResponse;
  try {
    aiResponse = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    aiResponse = match ? JSON.parse(match[0]) : { recommendations: [] };
  }

  // Titles must be exact dish names so the dashboard can find each dish's
  // recipe. Strip anything appended ("Vegan Tacos (South of the Border)")
  // and snap to the real menu name when one matches.
  const exactNames = new Map((enriched || []).map((e) => [String(e.name || '').toLowerCase().trim(), e.name]));
  const recommendations = (aiResponse.recommendations || []).slice(0, 3).map((rec) => {
    const raw = String(rec.title || '').trim();
    const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const title = exactNames.get(raw.toLowerCase()) || exactNames.get(stripped.toLowerCase()) || stripped || raw;
    return { ...rec, title };
  });
  // A talking point that names another selected dish, and not its own, was
  // written for the wrong ticket. Drop it so the ticket uses its description.
  for (const rec of recommendations) {
    const own = rec.title.toLowerCase();
    const others = recommendations.filter((r) => r !== rec).map((r) => r.title.toLowerCase());
    const tp = String(rec.talking_point || '').toLowerCase();
    if (tp && !tp.includes(own) && others.some((o) => o && tp.includes(o))) rec.talking_point = null;
  }

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

// What a staff page is allowed to see from a ticket.
const forStaff = (r) => ({
  title: r?.title ?? null,
  description: r?.description ?? null,
  talking_point: r?.talking_point ?? null,
});

// ─── On-demand handler ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { restaurantId: bodyRestaurantId, nfcToken, tagCode } = req.body;
    // Staff pages only get what the tickets show, never the operator notes.
    const staffView = !!(tagCode || nfcToken);
    let restaurantId = null;

    if (tagCode) {
      // Tag path (/t/<code>). The random code is the authorization and is
      // resolved to a restaurant here, server side.
      const { data: tags } = await supabase
        .from('nfc_tags')
        .select('restaurant_id')
        .eq('code', String(tagCode).toLowerCase())
        .eq('status', 'active')
        .limit(1);
      if (!tags?.length) return res.status(403).json({ error: 'Invalid tag' });
      restaurantId = tags[0].restaurant_id;
    } else if (nfcToken) {
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
      return res.status(200).json({ recommendations: staffView ? cached.recommendations.map(forStaff) : cached.recommendations, cached: true, date: currentDate });
    }

    // Generating costs a Claude call, so only for restaurants that are paid
    // up. Today's cached tickets above are still served either way. This
    // covers both the dashboard and the staff NFC page.
    const sub = await requireActiveSubscription(supabase, restaurantId);
    if (sub.error) return res.status(sub.status).json({ recommendations: [], error: sub.error });

    const recommendations = await generateForRestaurant(restaurantId, currentDate, dayOfWeek);
    return res.status(200).json({ recommendations: staffView ? recommendations.map(forStaff) : recommendations, cached: false, date: currentDate });

  } catch (err) {
    console.error('[ai-recommendations] Error:', err);
    return res.status(200).json({ recommendations: [], cached: false, error: err.message });
  }
}
