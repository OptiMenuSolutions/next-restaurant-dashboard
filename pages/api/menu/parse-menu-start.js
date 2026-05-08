// pages/api/menu/parse-menu-start.js
// Step 1 of 2: Accept upload, run Pass 1 + Pass 2 per file, save results to job row.
// Frontend polls /api/menu/job-status. Once status = 'pass1_complete',
// frontend calls parse-menu-finish which just writes to Supabase.

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import {
  supabase,
  fileToImageContents,
  pass1_extractAndClassify,
  pass2_buildRecipes,
  validateDishes,
} from '../../../lib/menuParser';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = formidable({ maxFileSize: 20 * 1024 * 1024, multiples: true });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch {
    return res.status(400).json({ error: 'Failed to parse upload' });
  }

  const rawFiles = files.file;
  const fileList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
  if (fileList.length === 0) return res.status(400).json({ error: 'No files provided' });

  const restaurantId = Array.isArray(fields.restaurant_id)
    ? fields.restaurant_id[0]
    : fields.restaurant_id;

  if (!restaurantId) return res.status(400).json({ error: 'restaurant_id is required' });

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  for (const file of fileList) {
    const ext = path.extname(file.originalFilename || '').toLowerCase();
    const isPDF = ext === '.pdf' || file.mimetype === 'application/pdf';
    if (!allowed.includes(file.mimetype) && !isPDF) {
      return res.status(400).json({
        error: `"${file.originalFilename}" is an unsupported type. Please upload JPG, PNG, WEBP, or PDF files.`,
      });
    }
  }

  // Create job row
  const { data: job, error: jobError } = await supabase
    .from('menu_parse_jobs')
    .insert({ restaurant_id: restaurantId, status: 'processing' })
    .select('id')
    .single();

  if (jobError) return res.status(500).json({ error: 'Failed to create parse job.' });

  const jobId = job.id;

  try {
    const { data: globalIngredients, error: dbError } = await supabase
      .from('global_ingredients')
      .select('name, unit')
      .order('name');

    if (dbError) {
      await supabase.from('menu_parse_jobs').update({ status: 'error', error_text: 'Failed to load ingredient library.' }).eq('id', jobId);
      return res.status(500).json({ error: 'Failed to load ingredient library.', job_id: jobId });
    }

    console.log(`[parse-menu-start] Job ${jobId} | Restaurant: ${restaurantId} | Files: ${fileList.length}`);

    const allValidatedDishes = [];
    const ingredientMap = {};   // deduped across files
    let anyTruncated = false;

    // ── Per-file Pass 1 + Pass 2 loop ────────────────────────────────────────
    // Each file gets its own focused pair of Claude calls.
    // This keeps each call smaller and more accurate than batching all files.

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const label = `[file ${i + 1}/${fileList.length}: ${file.originalFilename}]`;

      console.log(`[parse-menu-start] ${label} Converting to images...`);
      const imageContents = await fileToImageContents(file);

      if (imageContents.length === 0) {
        console.warn(`[parse-menu-start] ${label} No images extracted, skipping`);
        continue;
      }

      console.log(`[parse-menu-start] ${label} Pass 1...`);
      const { ingredients: fileIngredients, dishes: fileDishManifest } =
        await pass1_extractAndClassify(imageContents, globalIngredients, restaurantId);

      if (!fileIngredients?.length || !fileDishManifest?.length) {
        console.warn(`[parse-menu-start] ${label} Pass 1 returned nothing, skipping`);
        continue;
      }

      console.log(`[parse-menu-start] ${label} Pass 1: ${fileIngredients.length} ingredients, ${fileDishManifest.length} dishes`);

      // Merge ingredients (last writer wins on cost — fine for estimates)
      for (const ing of fileIngredients) {
        const key = ing.name.trim().toLowerCase();
        if (!ingredientMap[key]) ingredientMap[key] = ing;
      }

      console.log(`[parse-menu-start] ${label} Pass 2...`);
      const { dishes: rawDishes, truncated } =
        await pass2_buildRecipes(fileDishManifest, fileIngredients, restaurantId);

      if (truncated) anyTruncated = true;

      if (!rawDishes || !Array.isArray(rawDishes)) {
        console.warn(`[parse-menu-start] ${label} Pass 2 returned nothing, skipping`);
        continue;
      }

      const validated = validateDishes(rawDishes);
      console.log(`[parse-menu-start] ${label} Pass 2: ${validated.length} validated dishes`);
      allValidatedDishes.push(...validated);
    }

    // Clean up temp files
    for (const file of fileList) {
      try { fs.unlinkSync(file.filepath); } catch {}
    }

    if (allValidatedDishes.length === 0) {
      await supabase.from('menu_parse_jobs').update({ status: 'error', error_text: 'No dishes found in uploaded files.' }).eq('id', jobId);
      return res.status(200).json({ job_id: jobId, status: 'error', error: 'No dishes found in uploaded files.' });
    }

    // Deduplicate dishes by normalized name
    const seenDishes = new Set();
    const dedupedDishes = allValidatedDishes.filter(d => {
      const key = d.name.trim().toLowerCase();
      if (seenDishes.has(key)) return false;
      seenDishes.add(key);
      return true;
    });

    console.log(`[parse-menu-start] Job ${jobId} complete: ${dedupedDishes.length} dishes, ${Object.keys(ingredientMap).length} ingredients`);

    // Save fully validated dishes + ingredient library to job row
    // parse-menu-finish just reads this and writes to Supabase — no more Claude calls
    await supabase
      .from('menu_parse_jobs')
      .update({
        status: 'pass1_complete',
        pass1_result: {
          validatedDishes: dedupedDishes,
          ingredientLibrary: Object.values(ingredientMap),
          truncated: anyTruncated,
        },
      })
      .eq('id', jobId);

    return res.status(200).json({ job_id: jobId, status: 'pass1_complete' });

  } catch (err) {
    console.error('[parse-menu-start] Error:', err);
    for (const file of fileList) {
      try { fs.unlinkSync(file.filepath); } catch {}
    }
    await supabase.from('menu_parse_jobs').update({ status: 'error', error_text: err.message }).eq('id', jobId);
    return res.status(500).json({ error: err.message || 'Parse failed.', job_id: jobId });
  }
}