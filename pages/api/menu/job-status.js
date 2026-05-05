// pages/api/menu/job-status.js
// Lightweight polling endpoint. Frontend hits this every 3s to check parse progress.
// Returns status and final result once complete.

import { supabase } from '../../../lib/menuParser';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { job_id } = req.query;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });

  const { data: job, error } = await supabase
    .from('menu_parse_jobs')
    .select('id, status, error_text, created_at, updated_at')
    .eq('id', job_id)
    .single();

  if (error || !job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.status(200).json({
    job_id: job.id,
    status: job.status,           // processing | pass1_complete | processing_pass2 | complete | error
    error: job.error_text ?? null,
    created_at: job.created_at,
    updated_at: job.updated_at,
  });
}