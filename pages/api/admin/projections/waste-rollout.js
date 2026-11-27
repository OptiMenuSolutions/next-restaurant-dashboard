import { readAllInventoryRows } from '../../../../lib/currentInventory.js';
import { compareWasteCards } from '../../../../lib/admin/wasteRollout.js';
import { shiftProjectionDate } from '../../../../lib/projections/businessTime.js';
import { projectionDayNumber, PROJECTION_UUID } from '../../../../lib/projections/eligibility.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const { requireAdmin, adminDb } = await import('../../../../lib/admin/requireAdmin.js');
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { restaurantId, date } = req.query;
  let tomorrow;
  try {
    if (typeof restaurantId !== 'string' || !PROJECTION_UUID.test(restaurantId)) throw new Error();
    tomorrow = shiftProjectionDate(date, 1);
  } catch {
    return res.status(422).json({ error: 'Provide a restaurant and a YYYY-MM-DD date.' });
  }

  const target = restaurantId.toLowerCase();
  try {
    const { data, error } = await adminDb.rpc('waste_rollout_read', {
      target, day: date, actor: admin.user.id,
    });
    if (error?.code === 'PT404') return res.status(404).json({ error: 'Restaurant unavailable.' });
    if (error || !data) throw error || new Error('Missing rollout record');
    const { assessment, ...health } = data;
    const snapshotDate = assessment?.inventory_cutoff ?? shiftProjectionDate(date, -1);
    const [snapshots, names, briefing, runs] = await Promise.all([
      readAllInventoryRows(() => adminDb.from('waste_risk_snapshots')
        .select('invoice_item_id,ingredient_name,days_left,remaining_qty,total_value,created_at')
        .eq('restaurant_id', target).eq('snapshot_date', snapshotDate).order('id'), 'dated waste risk snapshots'),
      readAllInventoryRows(() => adminDb.from('ingredients').select('id,name')
        .eq('restaurant_id', target).order('id'), 'ingredient names'),
      adminDb.from('ai_recommendations').select('recommendations')
        .eq('restaurant_id', target).eq('generated_date', date).maybeSingle(),
      adminDb.from('admin_job_runs').select('result')
        .eq('job', 'run-waste-projection-assessments')
        .gte('started_at', date + 'T00:00:00Z').lt('started_at', tomorrow + 'T00:00:00Z')
        .order('started_at', { ascending: false }).limit(120),
    ]);
    const comparison = compareWasteCards(
      snapshots, assessment, new Map(names.map(row => [row.id, row.name])),
      projectionDayNumber(date) - projectionDayNumber(snapshotDate),
    );
    const tickets = briefing.data?.recommendations ?? [];
    const timings = (runs.data ?? []).flatMap(row => row.result?.rpc_ms?.commit ?? []).filter(Number.isFinite);
    return res.status(200).json({
      health, comparison, snapshotDate,
      snapshotObservedAt: snapshots.map(row => row.created_at).filter(Boolean).sort()[0] ?? null,
      assessment: assessment && {
        id: assessment.id, inventory_cutoff: assessment.inventory_cutoff, saved_at: assessment.saved_at,
        boundary: assessment.boundary, compact_bytes: assessment.compact_bytes, payload_bytes: assessment.payload_bytes,
        omitted: assessment.omitted,
      },
      briefing: briefing.error ? null : {
        input: tickets[0]?.waste_input ?? null, shadow: tickets[0]?.waste_shadow ?? null,
        titles: tickets.map(row => row.title),
      },
      commit: timings.length ? { max_ms: Math.max(...timings), calls: timings.length } : null,
    });
  } catch (error) {
    console.error('[waste-rollout]', error.code || 'READ_FAILED');
    return res.status(503).json({ error: 'Waste rollout data unavailable.' });
  }
}