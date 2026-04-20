// lib/logAiUsage.js
// Call this after every Anthropic API response to log token usage and cost.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Pricing per million tokens (as of April 2026)
const RATES = {
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-5':         { input: 3.00, output: 15.00 },
};

export async function logAiUsage({ feature, model, usage, restaurantId = null }) {
  try {
    const rates = RATES[model] || { input: 3.00, output: 15.00 };
    const inputCost  = (usage.input_tokens  / 1_000_000) * rates.input;
    const outputCost = (usage.output_tokens / 1_000_000) * rates.output;
    const totalCost  = inputCost + outputCost;

    await supabase.from('ai_usage').insert({
      feature,
      model,
      input_tokens:  usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost:          Math.round(totalCost * 1_000_000) / 1_000_000,
      restaurant_id: restaurantId || null,
    });
  } catch (err) {
    // Non-fatal — never let logging break the actual feature
    console.error('[logAiUsage] Failed to log usage:', err.message);
  }
}