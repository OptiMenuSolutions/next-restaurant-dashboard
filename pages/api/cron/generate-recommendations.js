// pages/api/cron/generate-recommendations.js
// Nightly cron job — runs at 6am ET (11:00 UTC) via Vercel Cron.
// Generates Tonight's Dish recommendations for every restaurant.
//
// SETUP REQUIRED:
//   Add CRON_SECRET to your Vercel environment variables.
//   Set it to any long random string (e.g. openssl rand -hex 32).
//   Vercel will send this automatically in the Authorization header.
//   Never expose this value publicly.

import { createClient } from '@supabase/supabase-js';
import { generateForRestaurant } from '../ai-recommendations';
import { sendCronAlert } from '../../../lib/cronAlert';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentDate = estDate.toISOString().split('T')[0];
  const dayOfWeek = estDate.toLocaleDateString('en-US', { weekday: 'long' });

  // Fetch all restaurants
  // Only accounts someone can open: onboarding finished, not deactivated.
  // The tour sample is skipped: its recommendation history is fixed demo
  // data kept current by refresh_sample_dates() in the waste snapshot cron.
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, name')
    .is('deactivated_at', null)
    .not('onboarding_completed_at', 'is', null)
    .neq('id', SAMPLE_RESTAURANT_ID);

  if (error || !restaurants?.length) {
    console.error('[cron] Failed to fetch restaurants:', error?.message);
    await sendCronAlert("Tonight's Dish cron", 'Could not load the restaurant list, so no tickets were generated.', [error?.message || 'No restaurants returned']);
    return res.status(500).json({ error: 'Failed to fetch restaurants' });
  }

  console.log(`[cron] Generating recs for ${restaurants.length} restaurants — ${currentDate}`);

  const results = { success: [], skipped: [], failed: [] };

  for (const restaurant of restaurants) {
    // Skip if already generated today (e.g. a user triggered on-demand earlier)
    const { data: existing } = await supabase
      .from('ai_recommendations')
      .select('id')
      .eq('restaurant_id', restaurant.id)
      .eq('generated_date', currentDate)
      .single();

    if (existing) {
      results.skipped.push(restaurant.name);
      continue;
    }

    // Up to three attempts: one bad AI response should not leave a
    // restaurant's staff without tonight's tickets.
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await generateForRestaurant(restaurant.id, currentDate, dayOfWeek);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[cron] ${restaurant.name} attempt ${attempt}/3 failed:`, err.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    if (lastErr) {
      results.failed.push({ name: restaurant.name, error: lastErr.message });
      console.error(`[cron] ✗ ${restaurant.name}:`, lastErr.message);
    } else {
      results.success.push(restaurant.name);
      console.log(`[cron] ✓ ${restaurant.name}`);
    }

    // Small delay between restaurants to avoid hammering the API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[cron] Done — ${results.success.length} generated, ${results.skipped.length} skipped, ${results.failed.length} failed`);
  if (results.failed.length) {
    await sendCronAlert(
      "Tonight's Dish cron",
      `${results.failed.length} of ${restaurants.length} restaurants got no tickets for ${currentDate} after 3 attempts each.`,
      results.failed.map(f => `${f.name}: ${f.error}`)
    );
  }
  return res.status(200).json({ date: currentDate, ...results });
}