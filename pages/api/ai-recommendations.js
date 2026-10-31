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
import { calculateVerifiedIngredientCost } from '../../lib/verifiedIngredientCost';
import { requireActiveSubscription } from '../../lib/requireActiveSubscription';
import { buildPrompt } from '../../lib/ai/prompts/tonightsDish';
import {
  scoreRecommendationCandidates,
  validateRecommendationConfig,
} from '../../lib/ai/recommendationScoring';

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
      ingredientId: r.ingredientId,
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
        id, name, description, price, cost, category,
        menu_item_components (
          cost,
          component_ingredients (
            quantity,
            unit,
            ingredients:ingredient_id (
              id, name, unit, last_price, last_ordered_at, is_estimated, price_approved_at,
              ingredient_unit_conversions (
                id, ingredient_id, from_unit, to_unit, factor, basis, evidence
              ),
              ingredient_conversion_default_links (
                ingredient_conversion_defaults (
                  id, label, from_unit, to_unit, factor, basis, evidence, source_url
                )
              )
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
    const lines = (item.menu_item_components || []).flatMap(
      c => c.component_ingredients || []
    );

    let cost = null;

    if (lines.length) {
      let total = 0;
      let fullyCosted = true;

      for (const line of lines) {
        const ingredient = line.ingredients;

        const approved =
          ingredient &&
          (ingredient.is_estimated === false || !!ingredient.price_approved_at);

        if (!approved) {
          fullyCosted = false;
          break;
        }

        const lineCost = calculateVerifiedIngredientCost(
          line.quantity,
          line.unit,
          ingredient
        );

        if (lineCost == null) {
          fullyCosted = false;
          break;
        }

        total += lineCost;
      }

      if (fullyCosted) cost = total;
    }
    const margin = cost != null ? ((price - cost) / price) * 100 : null;
    const marginDollars = cost != null ? price - cost : null;

    // Match expiring inventory to recipe ingredients by database ID.
    // Similar ingredient names alone are not evidence of a match.
    const recipeIngredientIds = new Set(
      lines
        .map(line => line.ingredients?.id)
        .filter(Boolean)
        .map(String)
    );

    const expiringInThisDish = expiringIngredients
      .filter(ingredient =>
        ingredient.ingredientId != null &&
        recipeIngredientIds.has(String(ingredient.ingredientId))
      )
      .map(ingredient => ({
        ingredientId: ingredient.ingredientId,
        name: ingredient.name,
        daysLeft: ingredient.daysLeft,
        isProtein: ingredient.isProtein,
      }));

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
      description: String(item.description || '').trim(),
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
export async function generateForRestaurant(
  restaurantId,
  currentDate,
  dayOfWeek,
  { dryRun = false, diagnostics = null, scoringConfig = null } = {}
) {
  const recordDiagnostic = (stage, outcome, reason, dish = null) => {
    if (!diagnostics) return;

    diagnostics.events.push({
      stage,
      outcome,
      reason,
      ...(dish ? { dish } : {}),
    });
  };

  if (diagnostics) {
    diagnostics.events = [];
    diagnostics.usage = null;
    diagnostics.context = null;
    diagnostics.generation = null;
  }

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

  // Only ingredients with remaining usable shelf life can drive
  // waste-prevention recommendations.
  const usableExpiringIngredients = expiringIngredients.filter(
    ingredient =>
      Number.isFinite(ingredient.daysLeft) &&
      ingredient.daysLeft > 0
  );

  // Keep dish-level inventory context consistent with the filtered list.
  const safeEnriched = enriched.map(item => ({
    ...item,
    expiringIngredients: (item.expiringIngredients || []).filter(
      ingredient =>
        Number.isFinite(ingredient.daysLeft) &&
        ingredient.daysLeft > 0
    ),
  }));

    // Preview weighted scoring during Recommendation Lab dry runs.
  // Production selection remains unchanged at this checkpoint.
  if (dryRun && diagnostics) {
    const config = validateRecommendationConfig(scoringConfig || {});

    const scoring = scoreRecommendationCandidates(
      safeEnriched,
      config
    );

    diagnostics.scoring = {
      config: scoring.config,
      totalCandidates: scoring.candidates.length,
      shortlist: scoring.shortlist.map(item => ({
        name: item.name,
        category: item.category,
        scores: item.recommendationScoring.scores,
        effectiveWeights: item.recommendationScoring.effectiveWeights,
        contributions: item.recommendationScoring.contributions,
        totalScore: item.recommendationScoring.totalScore,
        mode: item.recommendationScoring.mode,
        expiringIngredientIds:
          item.recommendationScoring.expiringIngredientIds,
      })),
    };
  }
  
  const verifiedMarginItems = safeEnriched
    .filter(item =>
      Number.isFinite(item.margin) &&
      Number.isFinite(item.marginDollars)
    );

  if (diagnostics) {
    diagnostics.context = {
      eligibleMenuItems: safeEnriched.length,
      verifiedMarginItems: verifiedMarginItems.length,
      expiringIngredients: usableExpiringIngredients.length,
      dishesWithExpiringIngredients: safeEnriched.filter(item =>
        item.expiringIngredients.length > 0
      ).length,
      dishesWithMatchedSales: safeEnriched.filter(item =>
        Number.isFinite(item.qty7d) && item.qty7d > 0
      ).length,
      recentRecommendations: history.length,
    };
  }

  const rankBy = (field) =>
    [...verifiedMarginItems].sort(
      (a, b) =>
        b[field] - a[field] ||
        a.name.localeCompare(b.name)
    );

  const percentageRankings = rankBy('margin');
  const dollarRankings = rankBy('marginDollars');

  const verifiedMarginContext = `
━━━ SERVER-VERIFIED MARGIN RANKINGS ━━━

Only dishes with fully verified ingredient costs are included.

GROSS MARGIN PERCENTAGE:
${percentageRankings.map((item, index) =>
  `${index + 1}. ${item.name}: ${item.margin}%`
).join('\n') || 'No verified margins available'}

GROSS PROFIT PER COVER:
${dollarRankings.map((item, index) =>
  `${index + 1}. ${item.name}: $${item.marginDollars.toFixed(2)}`
).join('\n') || 'No verified margins available'}

These rankings are calculated by the server using verified costs.
Use the appropriate ranking when making financial comparisons.
Never confuse percentage rankings with dollar-profit rankings.
Never invent financial rankings or figures.
`;

  const prompt = buildPrompt(
    safeEnriched,
    usableExpiringIngredients,
    history,
    dayOfWeek,
    currentDate
  ) + verifiedMarginContext;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalClaudeCalls = 0;

  const trackGenerationUsage = (usage) => {
    totalClaudeCalls += 1;
    totalInputTokens += usage?.input_tokens || 0;
    totalOutputTokens += usage?.output_tokens || 0;
  };

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000, // 1000 truncated larger menus mid-JSON (Echo Tap failed the cron on several days)
    messages: [{ role: 'user', content: prompt }],
  });

  trackGenerationUsage(message.usage);

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

    if (match) {
      try {
        aiResponse = JSON.parse(match[0]);
      } catch {
        console.warn(
          `[ai-recommendations] Could not parse Claude response for ${restaurantId}`
        );
        aiResponse = { recommendations: [] };
      }
    } else {
      aiResponse = { recommendations: [] };
    }
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

  // Reject recommendations that reference expired inventory.
  // An expired inventory estimate does not automatically disqualify
  // a dish, but it must never justify recommending that dish.
  const expiredNames = expiringIngredients
    .filter(ingredient => ingredient.daysLeft <= 0)
    .map(ingredient => ingredient.name.toLowerCase().trim())
    .filter(Boolean);

  const menuByName = new Map(
    safeEnriched.map(item => [item.name.toLowerCase().trim(), item])
  );

  // Verify financial claims against the calculated, approved menu data.

  const normalizeDishFamily = (name) => {
    const normalized = String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[–—]/g, '-');

    // "Stir-Fry - Chicken" and "Stir-Fry - Vegetarian"
    // are variants of the same dish family.
    if (normalized.includes(' - ')) {
      return normalized.split(' - ')[0].trim();
    }

    // Recognize other common protein variants of a shared dish.
    return normalized
      .replace(/\b(chicken|shrimp|vegetarian|veggie|beef|pork|tofu)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  };

  const ingredientNamesFor = (item) =>
    new Set(
      (item?.expiringIngredients || [])
        .filter(ingredient => ingredient.daysLeft > 0)
        .map(ingredient => ingredient.name.toLowerCase().trim())
    );

  const daysSince = (dateString) => {
    const current = Date.parse(`${currentDate}T00:00:00Z`);
    const previous = Date.parse(`${dateString}T00:00:00Z`);

    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      return Infinity;
    }

    return Math.round((current - previous) / 86400000);
  };

  const buildVerifiedReason = (rec, menuItem) => {
    const title = menuItem.name.toLowerCase().trim();

    const recentAppearance = history.find(entry =>
      String(entry.title || '').toLowerCase().trim() === title &&
      daysSince(entry.date) >= 1 &&
      daysSince(entry.date) <= 3
    );

    const ingredients = (menuItem.expiringIngredients || [])
      .filter(ingredient =>
        Number.isFinite(ingredient.daysLeft) &&
        ingredient.daysLeft > 0 &&
        ingredient.daysLeft <= 5
      )
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const urgentIngredients = ingredients.filter(
      ingredient => ingredient.daysLeft <= 3
    );

    const sentences = [];

    const displayedIngredients =
      rec.verifiedFallbackIngredientIds?.length
        ? ingredients.filter(ingredient =>
            rec.verifiedFallbackIngredientIds.includes(
              String(ingredient.ingredientId)
            )
          )
        : ingredients;

    if (rec.type === 'inventory' && displayedIngredients.length > 0) {
      const details = displayedIngredients.slice(0, 2).map(ingredient =>
        `${ingredient.name}: ${ingredient.daysLeft} day${
          ingredient.daysLeft === 1 ? '' : 's'
        } remaining`
      );

      sentences.push(
        `Expiring recipe ingredients — ${details.join('; ')}.`
      );
    }

    if (
      rec.type === 'margin' &&
      Number.isFinite(menuItem.margin) &&
      Number.isFinite(menuItem.marginDollars)
    ) {
      const dollarRank = dollarRankings.findIndex(
        item => item.name.toLowerCase().trim() === title
      ) + 1;

      const percentageRank = percentageRankings.findIndex(
        item => item.name.toLowerCase().trim() === title
      ) + 1;

      sentences.push(
        `Gross profit per cover: $${menuItem.marginDollars.toFixed(2)} ` +
        `(${dollarRank} of ${dollarRankings.length} verified dishes); ` +
        `gross margin: ${menuItem.margin.toFixed(1)}% ` +
        `(${percentageRank} of ${percentageRankings.length}).`
      );
    }

    if (rec.type === 'trending' && Number.isFinite(menuItem.qty7d)) {
      sentences.push(
        `Matched POS sales over the last 7 days: ${menuItem.qty7d} units.`
      );
    }

    if (recentAppearance && urgentIngredients.length > 0) {
      const urgentNames = [
        ...new Set(urgentIngredients.map(ingredient => ingredient.name))
      ].slice(0, 2).join(' and ');

      sentences.push(
        `Repeat exception: last recommended ${recentAppearance.date}; ` +
        `${urgentNames} ${
          urgentIngredients.length === 1 ? 'has' : 'have'
        } 3 days or less remaining.`
      );
    }

    return sentences.join(' ').trim();
  };

  const cleanRecommendation = (rec) => {
    const title = String(rec?.title || '').toLowerCase().trim();
    const menuItem = menuByName.get(title);

    if (!menuItem) return rec;

    // Ignore Claude's operational explanation entirely.
    // Inventory, financial, POS and rotation facts come from the server.
    rec.reason_selected = buildVerifiedReason(rec, menuItem);

    // Staff-facing language may be written by Claude, but must not
    // contain unsupported popularity or internal financial claims.
    const unsupportedStaffClaims =
      /\b(?:most popular|really popular|very popular|popular|best[- ]selling|customer favorite|guest favorite|fan favorite|crowd favorite|house favorite|crowd-pleasing|top seller|bestseller|best seller|gross margin|profit margin|profit per cover|food cost|verified margin|margin ranking|inventory at risk|waste risk|returns? per plate|returns? per dish|strongest returns?|most profitable|highest[- ]margin|best value|great value|excellent value|value plates?|strongest value)\b/i;

    const description = String(rec.description || '').trim();
    const talkingPoint = String(rec.talking_point || '').trim();

    rec.description =
      !description || unsupportedStaffClaims.test(description)
        ? menuItem.name
        : description;

    rec.talking_point =
      !talkingPoint || unsupportedStaffClaims.test(talkingPoint)
        ? `I'd recommend the ${menuItem.name} tonight.`
        : talkingPoint;

    return rec;
  };

  const isValidRecommendation = (rec, selected = []) => {
    const title = String(rec?.title || '').toLowerCase().trim();
    const menuItem = menuByName.get(title);

    const reject = (reason) => {
      recordDiagnostic('validation', 'rejected', reason, rec?.title);
      return false;
    };

    if (!menuItem) {
      console.warn(
        `[ai-recommendations] Rejected unknown menu item: ${rec?.title}`
      );
      return reject('Dish not found in the eligible menu');
    }

        // A recommendation's type must have a verifiable basis.
    if (rec.type === 'inventory') {
      const hasUsableExpiringIngredient =
        (menuItem.expiringIngredients || []).some(
          ingredient => ingredient.daysLeft > 0 && ingredient.daysLeft <= 5
        );

      if (!hasUsableExpiringIngredient) {
        console.warn(
          `[ai-recommendations] Rejected inventory recommendation without verified expiring ingredients: ${rec.title}`
        );
        return reject('No verified ingredient expiring within five days');
      }
    }

    if (
      rec.type === 'margin' &&
      (!Number.isFinite(menuItem.margin) ||
       !Number.isFinite(menuItem.marginDollars))
    ) {
      console.warn(
        `[ai-recommendations] Rejected margin recommendation without verified profitability: ${rec.title}`
      );
      return reject('Verified profitability data is unavailable');
    }

    if (
      rec.type === 'trending' &&
      (!Number.isFinite(menuItem.qty7d) || menuItem.qty7d <= 0)
    ) {
      console.warn(
        `[ai-recommendations] Rejected trending recommendation without matched POS sales: ${rec.title}`
      );
      return reject('No matched recent POS sales for this dish');
    }

    if (!['inventory', 'margin', 'trending'].includes(rec.type)) {
      console.warn(
        `[ai-recommendations] Rejected unknown recommendation type: ${rec.title}`
      );
      return reject('Unsupported recommendation type');
    }

    const reason = String(rec.reason_selected || '');
    const description = String(rec.description || '');
    const talkingPoint = String(rec.talking_point || '');
    const combinedText = `${reason} ${rec.description || ''} ${rec.talking_point || ''}`.toLowerCase();

        // Reject inventory claims involving ingredients that are not
    // linked to this dish's recipe by ingredient ID.
    const verifiedRecipeIngredientIds = new Set(
      (menuItem.expiringIngredients || [])
        .filter(ingredient => ingredient.ingredientId != null)
        .map(ingredient => String(ingredient.ingredientId))
    );

    const unsupportedInventoryClaims = usableExpiringIngredients.some(ingredient => {
      if (ingredient.ingredientId == null) return false;

      const ingredientId = String(ingredient.ingredientId);

      if (verifiedRecipeIngredientIds.has(ingredientId)) return false;

      const escapedName = String(ingredient.name || '')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (!escapedName) return false;

      const mentionsIngredient = new RegExp(
        `(^|[^a-z])${escapedName}(?=$|[^a-z])`,
        'i'
      ).test(reason);

      return mentionsIngredient;
    });

    if (unsupportedInventoryClaims) {
      console.warn(
        `[ai-recommendations] Rejected unsupported ingredient claim: ${rec.title}`
      );
      return false;
    }

    const referencesExpiredInventory = expiredNames.some(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z])${escaped}(?=$|[^a-z])`, 'i')
        .test(combinedText);
    });

    if (referencesExpiredInventory) {
      console.warn(
        `[ai-recommendations] Rejected expired-inventory reference: ${rec.title}`
      );
      return false;
    }

    const claimsMargin =
      rec.type === 'margin' ||
      /\b(margin|profit|profitable|food cost)\b/i.test(reason) ||
      /\b(margin|profit|profitable|food cost)\b/i.test(
        `${rec.description || ''} ${rec.talking_point || ''}`
      );

    if (menuItem.margin == null && claimsMargin) {
      console.warn(
        `[ai-recommendations] Rejected unverified margin claim: ${rec.title}`
      );
      return false;
    }

        // Validate explicit financial rankings against server-calculated data.
    const financialRankingClaims = [
      {
        pattern: /\b(?:ranks?\s+)?(\d+)(?:st|nd|rd|th)\s+(?:in|for)\s+gross\s+margin\b/gi,
        rankings: percentageRankings,
        label: 'gross margin percentage',
      },
      {
        pattern: /\b(?:ranks?\s+)?(\d+)(?:st|nd|rd|th)\s+(?:in|for)\s+gross\s+profit\s+per\s+cover\b/gi,
        rankings: dollarRankings,
        label: 'gross profit per cover',
      },
    ];

    for (const claim of financialRankingClaims) {
      for (const match of reason.matchAll(claim.pattern)) {
        const claimedRank = Number(match[1]);
        const actualRank = claim.rankings.findIndex(
          item => item.name.toLowerCase().trim() === title
        ) + 1;

        if (actualRank === 0 || claimedRank !== actualRank) {
          console.warn(
            `[ai-recommendations] Rejected incorrect ${claim.label} ranking: ${rec.title}`
          );
          return false;
        }
      }
    }

    // Validate financial figures in both margin and profit statements.
    const financialSentences = `${reason} ${description}`
      .split(/[.!?](?:\s|$)/)
      .filter(sentence =>
        /\b(?:margin|profit|profitable)\b/i.test(sentence)
      );

    for (const sentence of financialSentences) {
      const percentages = /\bmargin\b/i.test(sentence)
        ? [...sentence.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
        : [];

      for (const match of percentages) {
        const claimed = Number(match[1]);

        if (
          menuItem.margin == null ||
          Math.abs(claimed - menuItem.margin) > 0.15
        ) {
          console.warn(
            `[ai-recommendations] Rejected incorrect margin percentage: ${rec.title}`
          );
          return false;
        }
      }

      // Match dollar figures explicitly described as margin or profit
      // per cover, rather than inventory dollars at risk.
      const dollarMatches = [
        ...sentence.matchAll(
          /\$(\d+(?:\.\d+)?)\s*(?:gross\s*)?(?:profit|margin)/gi
        ),
        ...sentence.matchAll(
          /(?:profit|margin)\s*(?:per\s*cover|per\s*dish|\/cover)?\s*(?:of|at|:)?\s*\$(\d+(?:\.\d+)?)/gi
        ),
        ...sentence.matchAll(
          /(?:gross\s+)?profit\s+per\s+(?:cover|dish|plate)\s+(?:of|at|is|equals)?\s*\$(\d+(?:\.\d+)?)/gi
        ),
      ];

      for (const match of dollarMatches) {
        if (
          menuItem.marginDollars == null ||
          Math.abs(Number(match[1]) - menuItem.marginDollars) > 0.015
        ) {
          console.warn(
            `[ai-recommendations] Rejected incorrect dollar margin: ${rec.title}`
          );
          return false;
        }
      }
    }

    // Staff-facing text should describe the dish, not expose
    // financial or inventory analysis intended for the operator.
    const staffText = `${description} ${talkingPoint}`;

    const containsInternalMetrics =
      /\b(?:gross margin|profit per cover|profit margin|food cost|inventory at risk|waste risk|verified margin|margin ranking)\b/i
        .test(staffText) ||
      /\b\d+(?:\.\d+)?\s*%\s*(?:margin|profit)\b/i
        .test(staffText);

    if (containsInternalMetrics) {
      console.warn(
        `[ai-recommendations] Cleaning financial jargon in staff ticket: ${rec.title}`
      );

      rec.description = menuItem.name;
      rec.talking_point = `I'd recommend the ${menuItem.name} tonight.`;
    }

    // Enforce the last-three-nights rotation rule using actual dates.
    const recentlyRecommended = history.some(entry =>
      entry.title.toLowerCase().trim() === title &&
      daysSince(entry.date) >= 1 &&
      daysSince(entry.date) <= 3
    );

    const urgentIngredients = (menuItem.expiringIngredients || [])
      .filter(ingredient =>
        ingredient.daysLeft > 0 &&
        ingredient.daysLeft <= 3
      );

    if (recentlyRecommended) {
      // A recently recommended dish cannot be described as
      // rotation-eligible without acknowledging its exception.
      const falselyClaimsEligibility =
        /\b(?:rotation[- ]eligible|rotation[- ]clear|eligible by rotation|outside the (?:last|past) 3 nights|not (?:recommended|selected|featured) in the (?:last|past) 3 nights)\b/i
          .test(reason);

      if (falselyClaimsEligibility) {
        console.warn(
          `[ai-recommendations] Rejected incorrect rotation claim: ${rec.title}`
        );
        return false;
      }

      const hasWasteException =
        rec.type === 'inventory' &&
        urgentIngredients.length > 0;

      if (!hasWasteException) {
        console.warn(
          `[ai-recommendations] Rejected recent rotation: ${rec.title}`
        );
        return false;
      }

      if (!reason.includes('Repeat exception: last recommended ')) {
        console.warn(
          `[ai-recommendations] Rejected missing server-verified rotation exception: ${rec.title}`
        );
        return false;
      }
    }

    // Prevent multiple inventory recommendations from addressing
    // exactly the same expiring inventory opportunity.
    if (rec.type === 'inventory') {
      const coveredIngredientIds = new Set(
        selected
          .filter(existing => existing.type === 'inventory')
          .flatMap(existing => {
            const existingItem = menuByName.get(
              String(existing.title || '').toLowerCase().trim()
            );

            return (existingItem?.expiringIngredients || [])
              .filter(ingredient =>
                ingredient.daysLeft > 0 &&
                ingredient.daysLeft <= 5 &&
                ingredient.ingredientId != null
              )
              .map(ingredient => String(ingredient.ingredientId));
          })
      );

      const candidateIngredientIds = (menuItem.expiringIngredients || [])
        .filter(ingredient =>
          ingredient.daysLeft > 0 &&
          ingredient.daysLeft <= 5 &&
          ingredient.ingredientId != null
        )
        .map(ingredient => String(ingredient.ingredientId));

      if (
        coveredIngredientIds.size > 0 &&
        candidateIngredientIds.length > 0 &&
        candidateIngredientIds.every(id => coveredIngredientIds.has(id))
      ) {
        console.warn(
          `[ai-recommendations] Rejected duplicate inventory opportunity: ${rec.title}`
        );
        return false;
      }
    }

    // Prevent variants of the same dish from consuming multiple tickets
    // solely because they share the same expiring ingredients.
    const family = normalizeDishFamily(menuItem.name);
    const currentIngredients = ingredientNamesFor(menuItem);

    for (const existing of selected) {
      const existingItem = menuByName.get(
        existing.title.toLowerCase().trim()
      );

      if (!existingItem) continue;

      if (normalizeDishFamily(existingItem.name) !== family) continue;

      const existingIngredients = ingredientNamesFor(existingItem);

      const hasDistinctUrgentIngredient =
        (menuItem.expiringIngredients || []).some(ingredient =>
          ingredient.daysLeft > 0 &&
          ingredient.daysLeft <= 3 &&
          !existingIngredients.has(ingredient.name.toLowerCase().trim())
        );

      const sharedIngredients = [...currentIngredients].filter(
        name => existingIngredients.has(name)
      );

      if (
        sharedIngredients.length > 0 &&
        !hasDistinctUrgentIngredient
      ) {
        console.warn(
          `[ai-recommendations] Rejected redundant dish variant: ${rec.title} vs ${existing.title}`
        );
        return false;
      }
    }

    return true;
  };

  // Validate original recommendations and remove duplicate dishes.
  const validRecommendations = [];
  const selectedNames = new Set();
  const rejectedNames = new Set();

  for (const rec of recommendations) {
    const key = String(rec.title || '').toLowerCase().trim();

    if (!key || selectedNames.has(key)) {
      recordDiagnostic(
        'claude',
        'skipped',
        !key ? 'Missing dish title' : 'Duplicate dish title',
        rec.title
      );
      continue;
    }

    cleanRecommendation(rec);

    if (!isValidRecommendation(rec, validRecommendations)) {
      rejectedNames.add(key);
      continue;
    }

    validRecommendations.push(rec);
    selectedNames.add(key);
    recordDiagnostic('claude', 'accepted', 'Passed validation', rec.title);
  }

  // Fill remaining slots using verified server data.
  // No second Claude call is made.
  if (validRecommendations.length < 3) {
    const fallbackCandidates = safeEnriched
      .filter(item => {
        const key = item.name.toLowerCase().trim();

        if (selectedNames.has(key)) return false;
        if (rejectedNames.has(key)) return false;

        const recentlyRecommended = history.some(entry =>
          String(entry.title || '').toLowerCase().trim() === key &&
          daysSince(entry.date) >= 1 &&
          daysSince(entry.date) <= 3
        );

        const urgentInventory = (item.expiringIngredients || []).some(
          ingredient =>
            ingredient.daysLeft > 0 &&
            ingredient.daysLeft <= 3
        );

        if (recentlyRecommended && !urgentInventory) return false;

        const hasInventory = (item.expiringIngredients || []).some(
          ingredient =>
            ingredient.daysLeft > 0 &&
            ingredient.daysLeft <= 5
        );

        const hasMargin =
          Number.isFinite(item.margin) &&
          Number.isFinite(item.marginDollars);

        return hasInventory || hasMargin;
      })
      .map(item => {
        const urgentIngredients = (item.expiringIngredients || [])
          .filter(ingredient =>
            ingredient.daysLeft > 0 &&
            ingredient.daysLeft <= 3
          );

        const expiringIngredientsForDish = (item.expiringIngredients || [])
          .filter(ingredient =>
            ingredient.daysLeft > 0 &&
            ingredient.daysLeft <= 5
          );

        const hasMargin =
          Number.isFinite(item.margin) &&
          Number.isFinite(item.marginDollars);

        const type = expiringIngredientsForDish.length > 0
          ? 'inventory'
          : 'margin';

        // Prioritize urgent inventory, then verified profitability.
        const score =
          urgentIngredients.length * 1000 +
          expiringIngredientsForDish.length * 100 +
          (hasMargin ? Math.max(0, item.marginDollars) : 0);

        return { item, type, score };
      })
      .sort((a, b) =>
        b.score - a.score ||
        a.item.name.localeCompare(b.item.name)
      );

    for (const candidate of fallbackCandidates) {
      if (validRecommendations.length >= 3) break;

      const { item, type } = candidate;
      const key = item.name.toLowerCase().trim();

      // Identify expiring ingredients not already represented
      // by accepted inventory recommendations.
      const coveredIngredientIds = new Set(
        validRecommendations
          .filter(rec => rec.type === 'inventory')
          .flatMap(rec => {
            const selectedItem = menuByName.get(
              rec.title.toLowerCase().trim()
            );

            return (selectedItem?.expiringIngredients || [])
              .filter(ingredient =>
                ingredient.daysLeft > 0 &&
                ingredient.daysLeft <= 5 &&
                ingredient.ingredientId != null
              )
              .map(ingredient => String(ingredient.ingredientId));
          })
      );

      const distinctIngredientIds = (item.expiringIngredients || [])
        .filter(ingredient =>
          ingredient.daysLeft > 0 &&
          ingredient.daysLeft <= 5 &&
          ingredient.ingredientId != null &&
          !coveredIngredientIds.has(String(ingredient.ingredientId))
        )
        .map(ingredient => String(ingredient.ingredientId));

      // Skip inventory fallbacks that only repeat an existing
      // inventory opportunity.
      if (type === 'inventory' && distinctIngredientIds.length === 0) {
        console.info(
          `[ai-recommendations] Skipped duplicate inventory opportunity: ${item.name}`
        );
        recordDiagnostic(
          'fallback',
          'skipped',
          'Inventory opportunity already covered',
          item.name
        );
        continue;
      }

      const fallback = cleanRecommendation({
        title: item.name,
        type,
        verifiedFallbackIngredientIds:
          type === 'inventory' ? distinctIngredientIds : [],
        description: item.description || item.name,
        talking_point: item.description
          ? `If you're considering the ${item.name}, it's worth a look tonight.`
          : `I'd recommend the ${item.name} tonight.`,
        priority: validRecommendations.length + 1,
      });

      if (!isValidRecommendation(fallback, validRecommendations)) {
        console.info(
          `[ai-recommendations] Skipped ineligible fallback: ${item.name}`
        );
        continue;
      }

      validRecommendations.push(fallback);
      selectedNames.add(key);

      recordDiagnostic(
        'fallback',
        'accepted',
        'Verified server-generated fallback',
        item.name
      );

      console.info(
        `[ai-recommendations] Added verified fallback: ${item.name}`
      );
    }
  }

  // Preserve original valid ticket order and append replacements.
  validRecommendations.forEach((rec, index) => {
    rec.priority = index + 1;
  });

  // A talking point that names another selected dish, and not its own, was
  // written for the wrong ticket. Drop it so the ticket uses its description.
  for (const rec of validRecommendations) {
    const own = rec.title.toLowerCase();
    const others = validRecommendations.filter((r) => r !== rec).map((r) => r.title.toLowerCase());
    const tp = String(rec.talking_point || '').toLowerCase();
    if (tp && !tp.includes(own) && others.some((o) => o && tp.includes(o))) rec.talking_point = null;
  }

  // Save only during normal generation, never during a dry run.
  if (!dryRun) {
    try {
      const { error } = await supabase
        .from('ai_recommendations')
        .upsert({
          restaurant_id: restaurantId,
          generated_date: currentDate,
          recommendations: validRecommendations,
          type: 'general',
        });

      if (error) throw error;
    } catch (cacheWriteErr) {
      console.error(
        `[ai-recommendations] Cache write error for ${restaurantId}:`,
        cacheWriteErr.message
      );
    }
  }

  const generationSummary = {
    restaurantId,
    date: currentDate,
    dryRun,
    claudeCalls: totalClaudeCalls,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    recommendationCount: validRecommendations.length,
  };

  if (diagnostics) {
    diagnostics.usage = {
      model: 'claude-sonnet-4-6',
      claudeCalls: totalClaudeCalls,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd:
        Math.round(
          (
            (totalInputTokens * 3.00 +
              totalOutputTokens * 15.00) / 1_000_000
          ) * 1_000_000
        ) / 1_000_000,
    };

    diagnostics.generation = {
      returnedByClaude: recommendations.length,
      acceptedFromClaude: diagnostics.events.filter(
        event => event.stage === 'claude' && event.outcome === 'accepted'
      ).length,
      acceptedFallbacks: diagnostics.events.filter(
        event => event.stage === 'fallback' && event.outcome === 'accepted'
      ).length,
      rejectedCandidates: diagnostics.events.filter(
        event => event.stage === 'validation' && event.outcome === 'rejected'
      ).length,
      skippedClaudeCandidates: diagnostics.events.filter(
        event => event.stage === 'claude' && event.outcome === 'skipped'
      ).length,
      skippedFallbackCandidates: diagnostics.events.filter(
        event => event.stage === 'fallback' && event.outcome === 'skipped'
      ).length,
      finalRecommendations: validRecommendations.length,
    };
  }

  console.info('[ai-recommendations] Generation summary:', generationSummary);

  return validRecommendations;
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
