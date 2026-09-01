// pages/api/pos/analyze-csv.js
// Step 1 of the CSV upload flow: parse the file, auto-detect which POS
// system it's from, build a column mapping, and return a preview — no
// database writes here. The client shows this preview and lets the
// restaurant confirm (or fix a wrong column guess) before anything is
// actually imported into pos_sales, since keyword-based column detection
// has no confidence signal the way the AI invoice parser does.

import { createClient } from '@supabase/supabase-js';
import { parseCSV, detectPOSSystem, buildColumnMapping, normalizeRows } from '../../../lib/parsePOScsv';

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

    const { csvText } = req.body || {};
    if (!csvText) return res.status(400).json({ error: 'csvText is required' });

    let rows;
    try {
      rows = parseCSV(csvText);
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message });
    }
    if (!rows.length) return res.status(400).json({ error: 'No data rows found in that file.' });

    const headers = Object.keys(rows[0]);
    const posSystem = detectPOSSystem(headers);
    const columnMapping = buildColumnMapping(headers, posSystem);
    const normalized = normalizeRows(rows, columnMapping, restaurantId, posSystem);

    if (!normalized.length) {
      return res.status(400).json({
        error: 'Could not find usable item name / date columns in this file. Check the column mapping below.',
        headers,
        posSystem,
        columnMapping,
        preview: [],
        totalRows: rows.length,
        usableRows: 0,
      });
    }

    const dates = normalized.map((r) => r.sale_date).sort();
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];

    // Duplicate check — informational only, doesn't block. The restaurant
    // decides whether an overlap is expected (re-exporting to catch late
    // corrections) or a mistake (re-uploading the same file twice).
    const { count: overlapCount } = await supabase
      .from('pos_sales')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('pos_system', posSystem)
      .gte('sale_date', dateFrom)
      .lte('sale_date', dateTo);

    return res.status(200).json({
      headers,
      posSystem,
      columnMapping,
      preview: normalized.slice(0, 8),
      totalRows: rows.length,
      usableRows: normalized.length,
      dateFrom,
      dateTo,
      possibleOverlapRows: overlapCount || 0,
    });
  } catch (err) {
    console.error('[pos/analyze-csv] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
