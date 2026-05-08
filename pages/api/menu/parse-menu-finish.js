// pages/api/menu/parse-menu-finish.js
// Step 2 of 2: Read completed job (validated dishes + ingredient library) and write to Supabase.
// No Claude API calls here — all parsing is done in parse-menu-start.

import {
  supabase,
  saveToSupabase,
} from '../../../lib/menuParser';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { job_id } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });

  const { data: job, error: jobError } = await supabase
    .from('menu_parse_jobs')
    .select('*')
    .eq('id', job_id)
    .single();

  if (jobError || !job) return res.status(404).json({ error: 'Job not found.' });

  if (job.status !== 'pass1_complete') {
    return res.status(400).json({ error: `Job not ready. Current status: ${job.status}` });
  }

  const { validatedDishes, ingredientLibrary, truncated } = job.pass1_result;
  const restaurantId = job.restaurant_id;

  await supabase.from('menu_parse_jobs').update({ status: 'processing_pass2' }).eq('id', job_id);

  try {
    console.log(`[parse-menu-finish] Job ${job_id} | Writing ${validatedDishes.length} dishes to Supabase...`);

    const saveResults = await saveToSupabase(restaurantId, validatedDishes, ingredientLibrary);

    console.log(`[parse-menu-finish] Job ${job_id} | Save complete:`, saveResults);

    await supabase.from('menu_parse_jobs').update({ status: 'complete' }).eq('id', job_id);

    const withMargin = validatedDishes.filter(d => d.estimated_margin !== null);

    return res.status(200).json({
      success: true,
      job_id,
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
    await supabase.from('menu_parse_jobs').update({ status: 'error', error_text: err.message }).eq('id', job_id);
    return res.status(500).json({ error: err.message || 'Supabase write failed.', job_id });
  }
}