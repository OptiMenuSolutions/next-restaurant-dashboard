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
Prioritize dishes containing ingredients that are approaching the end of their usable shelf life, provided those ingredients are still safe to serve.

Ingredients marked EXPIRED must NEVER be used as a reason to recommend a dish. Do not encourage serving expired, spoiled, or otherwise unsafe ingredients.

For ingredients with 1 or 2 days remaining, prioritize dishes that can help use the inventory before its usable shelf life ends.

Proteins approaching the end of their usable shelf life deserve particular attention because of their potential cost and food-safety implications.

If a dish has appeared 3+ consecutive nights, prefer another eligible dish using the same ingredient. If no alternative exists, the dish may be repeated.

Include the dollar value at risk in reason_selected when available. Never imply that preventing waste takes priority over food safety.

RULE 2 — VARIETY
The three picks should give servers three genuinely different things to talk about. Avoid two versions of the same dish or format (two tacos, two burgers, two wing flavors) unless Rule 1 forces it. Picks may come from the same menu category when the dishes themselves are clearly different (for example a steak, a salmon, and a pasta from Entrees).

RULE 3 — MARGIN VALUE (only where margin is known)
After waste slots are filled, remaining picks go to dishes that are underperforming relative to their margin potential — but ONLY among dishes that show a margin. Dishes marked "margin not yet known" have no reliable cost yet; never rank them by margin.
Use BOTH margin % AND margin per cover ($) when ranking. A dish at $8 margin/cover and 65% margin outranks a dish at $2 margin/cover and 72% margin. Weight dollar margin and % margin equally.
Deprioritize dishes with strong recent sales — they are already moving. Surface dishes with good margin that are being overlooked.
If fewer than 3 dishes show a margin, fill the remaining picks by waste urgency, then sales momentum, then variety.

RULE 5 — PRICING HONESTY
Never state a margin %, margin per cover, food cost, or dollar profit for a dish marked "margin not yet known", and never describe such a dish as "high margin", "top margin", "best margin", "most profitable", or similar. Explain those picks by waste, sales, rotation, or variety instead, and do not use type "margin" for them. Dollar values shown for EXPIRING ingredients come from real invoices and may be cited.
A dish marked "no POS data" has UNKNOWN sales. Never say it is unsold, has zero or few sales, is overlooked, or "isn't moving" — only describe sales using the "sold N last 7d" figures actually shown.

RULE 6 — ROTATION
Any dish appearing in the last 3 nights is ineligible unless forced by Rule 1. If forced, explain in reason_selected.

RULE 7 — ONE DISH PER TICKET
Each recommendation's description and talking_point are about that recommendation's own dish only. Never mention or describe another selected dish in them.

━━━ RECENT RECOMMENDATION HISTORY (last 5 nights) ━━━
${historyLines}
${streakWarnings ? `\n⚠ STREAK ALERTS:\n${streakWarnings}` : ''}

━━━ EXPIRING INGREDIENTS ━━━
${expiringLines}

━━━ MENU ━━━
${menuLines}

${!hasPOS ? 'Note: No POS data is connected yet — sales for every dish are UNKNOWN, not zero. Base picks on waste context, known margins (if any), rotation, and variety.' : ''}

━━━ RESPONSE FORMAT ━━━
Return ONLY valid JSON, no markdown, no commentary:
{
  "recommendations": [
    {
      "title": "The dish name exactly as listed above, name only — never add the category or anything in parentheses",
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