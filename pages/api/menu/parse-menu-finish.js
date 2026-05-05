// pages/api/menu/parse-menu-finish.js
// Step 2 of 2: Given a job_id, run Pass 2 (recipe building) and write to Supabase.
// Called by the frontend after polling job-status and seeing 'pass1_complete'.

import {
  supabase,
  pass2_buildRecipes,
  validateDishes,
  saveToSupabase,
} from '../../../lib/menuParser';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { job_id } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });

  // Load job
  const { data: job, error: jobError } = await supabase
    .from('menu_parse_jobs')
    .select('*')
    .eq('id', job_id)
    .single();

  if (jobError || !job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  if (job.status !== 'pass1_complete') {
    return res.status(400).json({ error: `Job is not ready for Pass 2. Current status: ${job.status}` });
  }

  const { ingredients: ingredientLibrary, dishes: dishManifest } = job.pass1_result;
  const restaurantId = job.restaurant_id;

  // Mark as processing so duplicate calls don't double-run
  await supabase
    .from('menu_parse_jobs')
    .update({ status: 'processing_pass2' })
    .eq('id', job_id);

  try {
    console.log(`[parse-menu-finish] Job ${job_id} | Pass 2 starting: ${dishManifest.length} dishes`);

    const { dishes: rawDishes, truncated } = await pass2_buildRecipes(
      dishManifest,
      ingredientLibrary,
      restaurantId
    );

    if (!rawDishes || !Array.isArray(rawDishes)) {
      throw new Error('Pass 2 returned no dishes.');
    }

    const validatedDishes = validateDishes(rawDishes);

    console.log(`[parse-menu-finish] Job ${job_id} | Pass 2 complete: ${validatedDishes.length} dishes. Writing to Supabase...`);

    const saveResults = await saveToSupabase(restaurantId, validatedDishes, ingredientLibrary);

    console.log(`[parse-menu-finish] Job ${job_id} | Save complete:`, saveResults);

    // Mark job complete
    await supabase
      .from('menu_parse_jobs')
      .update({ status: 'complete' })
      .eq('id', job_id);

    const withMargin = validatedDishes.filter(d => d.estimated_margin !== null);

    return res.status(200).json({
      success: true,
      job_id,
      dishes: validatedDishes,
      count: validatedDishes.length,
      truncated,
      save_results: saveResults,
      summary: {
        total_items: validatedDishes.length,
        categories: [...new Set(validatedDishes.map(d => d.category))].sort(),
        archetypes_used: [...new Set(validatedDishes.map(d => d.archetype))].sort(),
        avg_estimated_cost:
          validatedDishes.length > 0
            ? Math.round(validatedDishes.reduce((s, d) => s + d.total_estimated_cost, 0) / validatedDishes.length * 100) / 100
            : 0,
        avg_estimated_margin:
          withMargin.length > 0
            ? Math.round(withMargin.reduce((s, d) => s + d.estimated_margin, 0) / withMargin.length * 10) / 10
            : null,
      },
    });

  } catch (err) {
    console.error('[parse-menu-finish] Error:', err);
    await supabase
      .from('menu_parse_jobs')
      .update({ status: 'error', error_text: err.message })
      .eq('id', job_id);
    return res.status(500).json({ error: err.message || 'Pass 2 failed.', job_id });
  }
}