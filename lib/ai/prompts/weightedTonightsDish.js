// lib/ai/prompts/weightedTonightsDish.js
// Experimental weighted selection prompt for Recommendation Lab only.

export function buildWeightedPrompt(
  shortlist,
  history,
  dayOfWeek,
  currentDate,
  config
) {
  const candidates = shortlist.map((item, index) => {
    const scoring = item.recommendationScoring;

    return {
      rank: index + 1,
      name: item.name,
      category: item.category,
      description: item.description || null,
      price: Number.isFinite(item.price) ? item.price : null,
      weightedScore: scoring.totalScore,
      scoreBreakdown: scoring.scores,
      effectiveWeights: scoring.effectiveWeights,
      marginPercent: Number.isFinite(item.margin)
        ? item.margin
        : null,
      grossProfitPerCover: Number.isFinite(item.marginDollars)
        ? item.marginDollars
        : null,
      salesLast7Days: Number.isFinite(item.qty7d)
        ? item.qty7d
        : null,
      expiringIngredients: (item.expiringIngredients || []).map(
        ingredient => ({
          id: ingredient.ingredientId,
          name: ingredient.name,
          daysLeft: ingredient.daysLeft,
        })
      ),
    };
  });

  return `You are OptiMenu's restaurant recommendation selector.

Select exactly 3 different dishes for tonight,
${dayOfWeek} ${currentDate}, from the supplied ranked shortlist.

SELECTION MODEL

The server has already calculated weighted scores using:
- Inventory urgency: ${config.inventoryWeight}%
- Verified profitability: ${config.profitabilityWeight}%
- Customer demand: ${config.salesWeight}%

The weights have been adjusted by the server when an entire
category of operational data is unavailable.

Treat the server's scores as the primary ranking signal.
Do not recalculate or override the weights.

Higher-ranked dishes deserve preference, but do not simply
select the first three automatically.

BALANCE THE FINAL THREE

1. Prioritize meaningful operational value.
2. Select genuinely different dishes whenever practical.
3. Avoid multiple variations of the same dish, such as
   Chicken Stir-Fry and Shrimp Stir-Fry.
4. Do not count the same expiring ingredient as multiple
   independent waste-prevention opportunities.
5. Prefer different urgent ingredients when two dishes
   have otherwise comparable value.
6. Avoid dishes recommended in the previous 3 calendar
   nights unless urgent verified inventory justifies reuse.
7. Never recommend unsafe or expired ingredients.

VERIFIED EVIDENCE

A null score means that evidence is unavailable.
It does not mean zero sales, zero profitability, or zero stock.

Only claim an inventory opportunity when the dish has a
verified ingredient with 1–5 days of usable life remaining.

Only claim profitability when verified margin figures exist.

Only claim sales momentum when positive matched POS sales exist.
A seven-day sales count alone does not establish an upward trend.

Never invent sales, margin, inventory, preparation methods,
ingredient details, or customer preferences.

RECOMMENDATION TYPES

- inventory: verified expiring ingredient drives selection.
- margin: verified profitability drives selection.
- trending: verified positive POS sales drive selection.

- feature: a legitimate menu-feature recommendation that does
  not depend on verified inventory, profitability, or POS data.

Use "feature" when a dish is worth presenting for variety
but no verified operational evidence supports another type.

Return exactly three distinct dishes when three suitable
shortlisted dishes exist. Never invent operational claims.

STAFF-FACING LANGUAGE

reason_selected explains the operational reason to the owner.
Keep it under 250 characters.

description is a concise, appealing description of the dish.
Keep it under 90 characters.

talking_point is something a server could naturally say
to a guest. Keep it under 120 characters.

Do not put financial figures, waste details, expiration dates,
or internal scoring terminology in staff-facing text.

Each ticket must describe its own dish only.

RECENT HISTORY
${JSON.stringify(history, null, 2)}

RANKED CANDIDATES
${JSON.stringify(candidates, null, 2)}

OUTPUT

Return only valid JSON:

{
  "recommendations": [
    {
      "title": "Exact dish name from shortlist",
      "reason_selected": "Verified operational reason",
      "description": "One concise sentence",
      "talking_point": "One natural sentence",
      "type": "inventory",
      "priority": 1
    }
  ]
}

Return up to 3 recommendations in priority order.
Use only exact dish names from the shortlist.
Do not include commentary outside the JSON.`;
}