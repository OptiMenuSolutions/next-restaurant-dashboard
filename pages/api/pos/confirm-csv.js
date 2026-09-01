// pages/api/pos/confirm-csv.js
// Step 2 of the CSV upload flow: takes the same CSV text plus the mapping
// the restaurant confirmed (or corrected) in the preview step, re-normalizes
// with that mapping, creates an upload_sessions row, and chunk-inserts into
// pos_sales with upload_session_id set — matching pos/sync.js's own comment
// that CSV-sourced rows always carry a session id, unlike API-synced rows.
//
// upload_sessions schema confirmed: id, restaurant_id, uploaded_at, filename,
// row_count, date_from, date_to, pos_system. date_from/date_to are NOT NULL
// on that table — always populated below from the parsed rows' actual dates.

import { createClient } from '@supabase/supabase-js';
import { parseCSV, normalizeRows } from '../../../lib/parsePOScsv';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await supabase
      .from('profiles').select('restaurant_id').eq('id', user.id).single();
    if (!profile?.restaurant_id) return res.status(400).json({ error: 'No restaurant on this account yet' });
    const restaurantId = profile.restaurant_id;

    const { csvText, columnMapping, posSystem, filename } = req.body || {};
    if (!csvText || !columnMapping || !posSystem) {
      return res.status(400).json({ error: 'csvText, columnMapping, and posSystem are required' });
    }

    const rows = parseCSV(csvText);
    const normalized = normalizeRows(rows, columnMapping, restaurantId, posSystem);
    if (!normalized.length) {
      return res.status(400).json({ error: 'No usable rows with that column mapping.' });
    }

    const dates = normalized.map((r) => r.sale_date).sort();
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];

    const { data: session, error: sessionError } = await supabase
      .from('upload_sessions')
      .insert({
        restaurant_id: restaurantId,
        pos_system: posSystem,
        row_count: normalized.length,
        date_from: dateFrom,
        date_to: dateTo,
        filename: filename || null,
        uploaded_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (sessionError) throw new Error(`Failed to create upload session: ${sessionError.message}`);

    const rowsToInsert = normalized.map((r) => ({ ...r, upload_session_id: session.id }));

    for (let i = 0; i < rowsToInsert.length; i += 500) {
      const { error: insertError } = await supabase.from('pos_sales').insert(rowsToInsert.slice(i, i + 500));
      if (insertError) throw new Error(`pos_sales insert failed: ${insertError.message}`);
    }

    return res.status(200).json({
      ok: true,
      rowsImported: rowsToInsert.length,
      dateFrom,
      dateTo,
      uploadSessionId: session.id,
    });
  } catch (err) {
    console.error('[pos/confirm-csv] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
