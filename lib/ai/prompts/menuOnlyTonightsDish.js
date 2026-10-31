
export function buildMenuOnlyPrompt(
  menuItems,
  history,
  dayOfWeek,
  currentDate
) {
  const menu = menuItems.map(item => ({
    name: item.name,
    category: item.category,
    price: Number.isFinite(item.price) ? item.price : null,
    description: item.description || null,
  }));

  return `You are OptiMenu's restaurant menu analyst.

Today is ${dayOfWeek}, ${currentDate}.

The restaurant has no verified inventory, profitability, or
POS sales data available for recommendation scoring.

Evaluate EVERY dish in the eligible menu supplied below.
Select exactly three different dishes that appear to offer
the strongest combination of potential gross profit per
sale, menu appeal, and variety.

PROFIT POTENTIAL

Consider the listed selling price, explicitly described
ingredients, and likely relative ingredient costs.

A higher selling price does not automatically mean a
higher gross profit per sale.

You may use general restaurant cost knowledge to make
a qualitative judgment, but you do not know actual
ingredient quantities, supplier prices, or recipe costs.

Do not calculate or invent margins, dollar profits,
food-cost percentages, or sales figures.

Do not claim that a dish is definitively profitable,
a bestseller, or a customer favorite.

SELECTION

- Consider the entire menu, not just its first entries.
- Do not favor dishes based on alphabetical order.
- Prefer dishes with plausible gross profit potential.
- Choose different dish families and primary proteins.
- Avoid kids' dishes.
- Avoid recently recommended dishes when alternatives exist.
- Never invent ingredients or preparation details.
- If three distinct suitable dishes exist, select three.

RECENT HISTORY
${JSON.stringify(history, null, 2)}

ELIGIBLE MENU
${JSON.stringify(menu, null, 2)}

WRITING REQUIREMENTS

For each dish, explain specifically why it may have
attractive gross profit potential.

Consider its listed price, described ingredients,
likely relative ingredient costs, and cost uncertainty.

The explanation must be different for each dish.
Do not use generic statements about menu variety
or contribution potential.

reason_selected:
- Write 1–2 complete sentences.
- Explain the dish-specific financial reasoning.
- Qualify all profitability judgments as estimates.
- Do not invent actual recipe costs or margins.
- Do not include unsupported numerical estimates.

description:
- Write one complete sentence of 10–18 words.
- Describe only ingredients and preparation supported
  by the supplied menu description.
- Do not end with an incomplete phrase.

talking_point:
- Write one natural sentence of 15–25 words.
- Make it sound like a server speaking to a guest.
- Highlight a distinctive, documented feature.
- Do not mention finances, inventory, or scoring.
- Do not end with an incomplete phrase.

OUTPUT

Return only valid JSON:
{
  "recommendations": [
    {
      "title": "Exact menu item name",
      "type": "feature",
      "priority": 1,
      "reason_selected": "Qualitative profit-potential rationale, explicitly unverified",
      "description": "Appealing description grounded in the menu",
      "talking_point": "Natural guest-facing recommendation grounded in the menu"
    }
  ]
}

All three recommendations must use type "feature".
Do not mention estimated profitability to guests.
Return exactly three recommendations when possible.
Do not include commentary outside JSON.`;
}
