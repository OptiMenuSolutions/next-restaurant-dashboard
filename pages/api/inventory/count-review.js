import { admin, requireOwner } from '../../../lib/scannerAuth';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const auth = await requireOwner(req);

    if (auth.error) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const body = req.body;
    const allowed = ['session_id', 'effective_date', 'count_timing'];

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key)) ||
      typeof body.session_id !== 'string' ||
      !UUID.test(body.session_id) ||
      !validDate(body.effective_date) ||
      !['before_opening', 'after_closing'].includes(body.count_timing)
    ) {
      return res.status(400).json({
        error: 'Choose a valid count date and timing.',
      });
    }

    const { data, error } = await admin.rpc('review_inventory_count', {
      p_restaurant_id: auth.restaurant.id,
      p_session_id: body.session_id,
      p_user_id: auth.user.id,
      p_effective_date: body.effective_date,
      p_count_timing: body.count_timing,
    });

    if (error) {
      const messages = {
        COUNT_ACCESS_DENIED: [
          403,
          'You cannot review this inventory count.',
        ],
        COUNT_NOT_FOUND: [
          404,
          'Inventory count not found.',
        ],
        COUNT_NOT_EDITABLE: [
          409,
          'This count is no longer an editable manual draft.',
        ],
        COUNT_INVALID_BOUNDARY: [
          400,
          'Choose today or an earlier date, and select when the count was taken.',
        ],
        COUNT_EMPTY: [
          400,
          'Save at least one quantity before reviewing. Zero is a valid count.',
        ],
        COUNT_UNIT_CHANGED: [
          409,
          'An ingredient unit changed after it was counted. Resolve that count before continuing.',
        ],
      };

      const known = messages[error.message];

      if (known) {
        return res.status(known[0]).json({ error: known[1] });
      }

      throw error;
    }

    return res.status(200).json({ review: data });
  } catch (error) {
    console.error('[inventory/count-review]', error);

    return res.status(500).json({
      error: 'Could not review this count. Please try again.',
    });
  }
}