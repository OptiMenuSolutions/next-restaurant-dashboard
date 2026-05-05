// pages/api/menu/parse-menu-start.js
// Step 1 of 2: Accept upload, run Pass 1, save job to menu_parse_jobs.
// Returns job_id immediately. Frontend polls /api/menu/job-status for completion.

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import {
  supabase,
  fileToImageContents,
  pass1_extractAndClassify,
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

    console.log('[parse-menu-start] restaurant_id:', restaurantId);

  if (!restaurantId) {
    return res.status(400).json({ error: 'restaurant_id is required' });
  }

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

  // Create job row immediately so frontend has a job_id to poll
  const { data: job, error: jobError } = await supabase
    .from('menu_parse_jobs')
    .insert({
      restaurant_id: restaurantId,
      status: 'processing',
    })
    .select('id')
    .single();

  if (jobError) {
    return res.status(500).json({ error: 'Failed to create parse job.' });
  }

  const jobId = job.id;

  // Run Pass 1 — this is the slow part but stays under 60s per file
  try {
    const { data: globalIngredients, error: dbError } = await supabase
      .from('global_ingredients')
      .select('name, unit')
      .order('name');

    if (dbError) {
      await supabase
        .from('menu_parse_jobs')
        .update({ status: 'error', error_text: 'Failed to load ingredient library.' })
        .eq('id', jobId);
      return res.status(500).json({ error: 'Failed to load ingredient library.', job_id: jobId });
    }

    console.log(`[parse-menu-start] Job: ${jobId} | Restaurant: ${restaurantId} | Files: ${fileList.length}`);

    const allIngredientMap = {};   // deduped across files
    const allDishManifest = [];    // flat list of all dishes from all files

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const fileLabel = `[file ${i + 1}/${fileList.length}: ${file.originalFilename}]`;

      console.log(`[parse-menu-start] ${fileLabel} Converting to images...`);
      const imageContents = await fileToImageContents(file);

      if (imageContents.length === 0) {
        console.warn(`[parse-menu-start] ${fileLabel} No images extracted, skipping`);
        continue;
      }

      console.log(`[parse-menu-start] ${fileLabel} Running Pass 1...`);
      const { ingredients, dishes } = await pass1_extractAndClassify(
        imageContents,
        globalIngredients,
        restaurantId
      );

      for (const ing of ingredients) {
        const key = ing.name.trim().toLowerCase();
        if (!allIngredientMap[key]) allIngredientMap[key] = ing;
      }

      allDishManifest.push(...dishes);

      console.log(`[parse-menu-start] ${fileLabel} Pass 1 done: ${ingredients.length} ingredients, ${dishes.length} dishes`);
    }

    // Clean up temp files
    for (const file of fileList) {
      try { fs.unlinkSync(file.filepath); } catch {}
    }

    if (allDishManifest.length === 0) {
      await supabase
        .from('menu_parse_jobs')
        .update({ status: 'error', error_text: 'No dishes found in uploaded files.' })
        .eq('id', jobId);
      return res.status(200).json({ job_id: jobId, status: 'error', error: 'No dishes found in uploaded files.' });
    }

    // Save Pass 1 result to job row — finish route will pick this up
    await supabase
      .from('menu_parse_jobs')
      .update({
        status: 'pass1_complete',
        pass1_result: {
          ingredients: Object.values(allIngredientMap),
          dishes: allDishManifest,
        },
      })
      .eq('id', jobId);

    console.log(`[parse-menu-start] Job ${jobId} Pass 1 complete. ${allDishManifest.length} dishes, ${Object.keys(allIngredientMap).length} ingredients.`);

    return res.status(200).json({ job_id: jobId, status: 'pass1_complete' });

  } catch (err) {
    console.error('[parse-menu-start] Error:', err);
    for (const file of fileList) {
      try { fs.unlinkSync(file.filepath); } catch {}
    }
    await supabase
      .from('menu_parse_jobs')
      .update({ status: 'error', error_text: err.message })
      .eq('id', jobId);
    return res.status(500).json({ error: err.message || 'Pass 1 failed.', job_id: jobId });
  }
}