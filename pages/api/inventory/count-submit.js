import { admin, requireOwner } from '../../../lib/scannerAuth';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';

export const config = { maxDuration: 300 };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method not allowed.',
    });
  }

  try {
    const auth = await requireOwner(req);

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error,
      });
    }

    const body = req.body;
    const allowed = [
      'session_id',
      'expected_revision',
      'effective_date',
      'count_timing',
    ];

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key)) ||
      typeof body.session_id !== 'string' ||
      !UUID.test(body.session_id) ||
      typeof body.expected_revision !== 'string' ||
      !/^\d+$/.test(body.expected_revision) ||
      typeof body.effective_date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.effective_date) ||
      !['before_opening', 'after_closing'].includes(body.count_timing)
    ) {
      return res.status(400).json({
        error: 'Review the saved count before submitting.',
      });
    }

    const { data: existing, error: existingError } = await admin
      .from('inventory_count_sessions')
      .select('status,effective_date,count_timing')
      .eq('id', body.session_id)
      .eq('restaurant_id', auth.restaurant.id)
      .maybeSingle();

    if (existingError) throw existingError;

    if (!existing) {
      return res.status(404).json({
        error: 'Count not found.',
      });
    }

    if (existing.status === 'submitted') {
      if (
        existing.effective_date !== body.effective_date ||
        existing.count_timing !== body.count_timing
      ) {
        return res.status(409).json({
          error: 'This count was already submitted with a different date or timing.',
        });
      }

      return res.status(200).json({
        submitted: true,
        already_submitted: true,
      });
    }

    const { error: reviewError } = await admin.rpc(
      'review_inventory_count',
      {
        p_restaurant_id: auth.restaurant.id,
        p_session_id: body.session_id,
        p_user_id: auth.user.id,
        p_effective_date: body.effective_date,
        p_count_timing: body.count_timing,
      }
    );

    if (reviewError) {
      return res.status(409).json({
        error: 'This count needs a fresh review. Reload saved values and review again.',
      });
    }

    const result = await rebuildCurrentInventory(
      admin,
      auth.restaurant.id,
      {
        ...body,
        user_id: auth.user.id,
        submitted_at: new Date().toISOString(),
      }
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('[inventory/count-submit]', error);

    return res.status(409).json({
      error: error.message ||
        'Submission could not finish. Please try again.',
    });
  }
}