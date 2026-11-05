
import {
  adminDb as db,
  requireAdmin,
} from '../../../../lib/admin/requireAdmin';
import { processInvoiceCalculations } from '../../../../lib/admin/processInvoiceCalculations';
import {
  getRestaurantInvoiceMatchingControl,
} from '../../../../lib/invoiceMatchingControls';

export const config = { maxDuration: 300 };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { restaurant_id } = req.body || {};

  if (
    typeof restaurant_id !== 'string' ||
    !UUID_PATTERN.test(restaurant_id)
  ) {
    return res.status(400).json({
      error: 'A valid restaurant ID is required.',
    });
  }

  try {
    const control = await getRestaurantInvoiceMatchingControl(
      db,
      restaurant_id
    );

    if (!control.matching_enabled) {
      return res.status(403).json({
        ok: false,
        error: 'Invoice calculations are disabled for this restaurant.',
      });
    }

    const { data: before, error: readError } = await db
      .from('invoice_calculation_jobs')
      .select('generation, completed_generation, last_error')
      .eq('restaurant_id', restaurant_id)
      .maybeSingle();

    if (readError) throw readError;

    if (
      !before ||
      before.generation <= before.completed_generation
    ) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        message: 'No pending invoice calculations.',
      });
    }

    console.info('[admin invoice calculation retry]', {
      restaurantId: restaurant_id,
      adminId: admin.user.id,
      generation: before.generation,
    });

    const result = await processInvoiceCalculations(
      db,
      restaurant_id
    );

    const { data: after, error: verifyError } = await db
      .from('invoice_calculation_jobs')
      .select(
        'generation, completed_generation, last_error, finished_at'
      )
      .eq('restaurant_id', restaurant_id)
      .single();

    if (verifyError) throw verifyError;

    return res.status(200).json({
      ok:
        after.completed_generation >= after.generation &&
        !after.last_error,
      skipped: result.skipped,
      errors: result.errors,
      job: after,
    });
  } catch (error) {
    console.error('[admin invoice calculation retry]', error);

    return res.status(500).json({
      ok: false,
      error: 'Invoice calculation retry failed.',
    });
  }
}
