// lib/ai/prompts/tonightsDish.js
// Builds the Tonight's Dish Claude prompt from prepared restaurant context.

export function buildPrompt(enriched, expiringIngredients, history, dayOfWeek, currentDate) {
  const hasPOS = enriched.some(i => i.qty7d !== null);

  const menuLines = enriched.map(item => {
    const parts = [`${item.name} · category: ${item.category}`, `$${item.price}`];
    if (item.margin != null) {
      parts.push(`${item.margin}% margin`, `$${item.marginDollars} margin/cover`);
    } else {
      parts.push('margin not yet known');
    }
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
        const urgency = e.daysLeft === 1
          ? 'use TODAY'
          : `${e.daysLeft} days left`;

        return `  - ${e.name}${e.isProtein ? ' [PROTEIN]' : ''}: ${urgency}${e.quantity > 0 ? `, ${e.quantity} ${e.unit || 'units'} on hand` : ''}`;
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
Prioritize dishes containing ingredients that are approaching the end of their usable shelf life, provided those ingredients are still safe to serve.

Ingredients marked EXPIRED must NEVER be used as a reason to recommend a dish. Do not encourage serving expired, spoiled, or otherwise unsafe ingredients.

For ingredients with 1 or 2 days remaining, prioritize dishes that can help use the inventory before its usable shelf life ends.

Proteins approaching the end of their usable shelf life deserve particular attention because of their potential cost and food-safety implications.

If a dish has appeared 3+ consecutive nights, prefer another eligible dish using the same ingredient. If no alternative exists, the dish may be repeated.

Explain inventory urgency using ingredient names and days remaining. Do not state inventory dollar values in reason_selected. Inventory valuations are handled separately by the server.

Multiple dishes may use the same at-risk ingredients. Do not count shared ingredient exposure as separate pools of inventory or imply that selecting two dishes doubles the waste-prevention opportunity.

Consider the incremental benefit of each additional recommendation. Prefer a dish that addresses a different urgent ingredient or provides meaningful additional sales opportunities when its waste-prevention value is otherwise comparable.

Do not claim that recommending or selling a dish eliminates the full inventory risk. Avoid adding ingredient risk amounts together across recommendations.

Never imply that preventing waste takes priority over food safety.

RULE 2 — VARIETY
The three picks should give servers three genuinely different things to talk about.

Evaluate variety across dish format, primary protein, preparation, flavor profile, and major shared ingredients — not merely whether the menu item names differ.

Avoid recommending two variations of the same dish, such as Chicken Stir-Fry and Shrimp Stir-Fry, when another eligible dish offers comparable operational value and greater variety.

Also avoid selecting three dishes dominated by the same sauce, preparation, or flavor profile when meaningful alternatives exist.

Rule 1 still takes precedence. Similar dishes may both be selected when distinct, urgent waste-prevention needs genuinely justify them. However, sharing the same expiring ingredients does not automatically justify selecting both.

When two candidates offer comparable waste-prevention or margin value, prefer the candidate that adds greater variety to the existing selections.

Do not claim that a selection provides strong variety unless its preparation, flavor profile, or dish format is meaningfully different from the other picks.

Picks may come from the same menu category when the dishes themselves are clearly different, such as steak, salmon, and pasta from Entrees.

RULE 3 — MARGIN VALUE (only where margin is known)
After waste slots are filled, remaining picks go to dishes that are underperforming relative to their margin potential — but ONLY among dishes that show a margin. Dishes marked "margin not yet known" have no reliable cost yet; never rank them by margin.
Use BOTH gross margin percentage (%) and gross profit per cover ($) when ranking. Weight these two measures equally when evaluating overall margin attractiveness.

These are different measures and must never be conflated.

If describing a dish as having the highest, second-highest, or otherwise ranked margin, explicitly identify whether the ranking refers to gross margin percentage or gross profit dollars per cover.

Never describe a dish as having the highest margin overall merely because it leads in one of these two measures.

For example, a dish with an 83.5% gross margin and $12.10 gross profit per cover has a higher margin percentage than a dish with a 75.2% gross margin and $14.66 gross profit per cover. The second dish has higher gross profit dollars per cover.

Only make comparative rankings supported by the actual menu data supplied. Never invent rankings or financial figures.
Deprioritize dishes with strong recent sales — they are already moving. Surface dishes with good margin that are being overlooked.
If fewer than 3 dishes show a margin, fill the remaining picks by waste urgency, then sales momentum, then variety.

RULE 5 — PRICING HONESTY
Never state a margin %, margin per cover, food cost, or dollar profit for a dish marked "margin not yet known", and never describe such a dish as "high margin", "top margin", "best margin", "most profitable", or similar. Explain those picks by waste, sales, rotation, or variety instead, and do not use type "margin" for them. Do not invent or cite inventory dollar values.
A dish marked "no POS data" has UNKNOWN sales. Never say it is unsold, has zero or few sales, is overlooked, or "isn't moving" — only describe sales using the "sold N last 7d" figures actually shown.

RULE 6 — ROTATION
Any dish appearing within the last 3 calendar nights is ineligible unless justified by Rule 1.

Calculate rotation using calendar dates, not assumptions about eligibility.

For example, on October 31:
- October 30 = 1 night ago
- October 29 = 2 nights ago
- October 28 = 3 nights ago
- October 27 = 4 nights ago

If a dish was recommended within the last 3 nights but qualifies for an urgent waste-prevention exception, explicitly acknowledge that it is being repeated.

Explain which expiring ingredients justify the exception.

Never describe a dish as rotation-eligible when it actually requires an exception.

RULE 7 — ONE DISH PER TICKET
Each recommendation's description and talking_point are about that recommendation's own dish only. Never mention or describe another selected dish in them.

reason_selected is for the restaurant operator. It should explain the financial, inventory, sales, and rotation logic behind the selection.

description is for the staff briefing. Write one concise, appealing sentence describing the dish and why it is worth featuring tonight.

Both description and talking_point must avoid:
- Gross margin percentages or dollar profits
- Food costs, inventory valuations, or financial rankings
- Expiration dates, days remaining, or waste-risk amounts
- Internal selection rules or technical terminology

The talking_point should sound like something a server would naturally say to a guest.

Do not exaggerate inventory savings, waste urgency, margins, or sales performance.

Do not invent preparation methods, freshness claims, flavor details, or ingredient characteristics that are not supported by the menu information.

━━━ RECENT RECOMMENDATION HISTORY (last 5 nights) ━━━
${historyLines}
${streakWarnings ? `\n⚠ STREAK ALERTS:\n${streakWarnings}` : ''}

━━━ EXPIRING INGREDIENTS ━━━
${expiringLines}

━━━ MENU ━━━
${menuLines}

${!hasPOS ? 'Note: No POS data is connected yet — sales for every dish are UNKNOWN, not zero. Base picks on waste context, known margins (if any), rotation, and variety.' : ''}

━━━ OUTPUT BREVITY ━━━
Keep all three recommendations concise.
Do not narrate your selection process or compare every rejected candidate.
For reason_selected, prioritize the strongest operational reason.
Mention shared inventory exposure only when needed to avoid misleading claims.
Do not repeat the same financial rankings across multiple tickets.
Return the completed JSON immediately, without additional commentary.

━━━ RESPONSE FORMAT ━━━
Return ONLY valid JSON, no markdown, no commentary:
{
  "recommendations": [
    {
      "title": "The dish name exactly as listed above, name only — never add the category or anything in parentheses",
      "reason_selected": "Two concise sentences, maximum 250 characters total. Explain the primary selection reason and any required rotation exception. Use only verified figures. Do not discuss rejected alternatives.",
      "description": "One appealing staff-facing sentence, maximum 90 characters. No financial or inventory jargon.",
      "talking_point": "One natural sentence a server can say to a guest, maximum 120 characters. No operational jargon.",
      "type": "inventory | margin | trending",
      "priority": 1
    },
    { "title": "...", "reason_selected": "...", "description": "...", "talking_point": "...", "type": "...", "priority": 2 },
    { "title": "...", "reason_selected": "...", "description": "...", "talking_point": "...", "type": "...", "priority": 3 }
  ]
}

type: "inventory" = expiring ingredient drove selection · "margin" = underselling margin · "trending" = strong sales momentum`;
}