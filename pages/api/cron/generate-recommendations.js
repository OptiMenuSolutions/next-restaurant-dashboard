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
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, name');

  if (error || !restaurants?.length) {
    console.error('[cron] Failed to fetch restaurants:', error?.message);
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

    try {
      await generateForRestaurant(restaurant.id, currentDate, dayOfWeek);
      results.success.push(restaurant.name);
      console.log(`[cron] ✓ ${restaurant.name}`);
    } catch (err) {
      results.failed.push({ name: restaurant.name, error: err.message });
      console.error(`[cron] ✗ ${restaurant.name}:`, err.message);
    }

    // Small delay between restaurants to avoid hammering the API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[cron] Done — ${results.success.length} generated, ${results.skipped.length} skipped, ${results.failed.length} failed`);
  return res.status(200).json({ date: currentDate, ...results });
}