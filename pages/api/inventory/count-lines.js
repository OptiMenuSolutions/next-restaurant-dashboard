import { admin, requireOwner } from '../../../lib/scannerAuth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readAll(makeQuery) {
  const rows = [];

  for (let from = 0; ; ) {
    const { data, error } = await makeQuery().range(from, from + 499);

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid list response.');
    if (data.length === 0) return rows;

    rows.push(...data);
    from += data.length;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const auth = await requireOwner(req);

    if (auth.error) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const restaurantId = auth.restaurant.id;
    const sessionId = req.query.session_id;

    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid inventory count ID.' });
    }

    const { data: session, error: sessionError } = await admin
      .from('inventory_count_sessions')
      .select('id, status, source')
      .eq('id', sessionId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (sessionError) throw sessionError;

    if (!session) {
      return res.status(404).json({ error: 'Inventory count not found.' });
    }

    if (req.method === 'GET') {
      const [ingredients, lines] = await Promise.all([
        readAll(() => admin
          .from('ingredients')
          .select('id, name, unit')
          .eq('restaurant_id', restaurantId)
          .order('name', { ascending: true })
          .order('id', { ascending: true })),
        readAll(() => admin
          .from('inventory_count_lines')
          .select('ingredient_id, ingredient_name, quantity, unit, counted_at, recorded_at')
          .eq('restaurant_id', restaurantId)
          .eq('session_id', sessionId)
          .order('id', { ascending: true })),
      ]);

      return res.status(200).json({ session, ingredients, lines });
    }

    const body = req.body;
    const allowed = [
      'ingredient_id',
      'quantity',
      'unit',
      'expected_recorded_at',
    ];

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key)) ||
      typeof body.ingredient_id !== 'string' ||
      !UUID.test(body.ingredient_id) ||
      typeof body.unit !== 'string' ||
      !body.unit.trim() ||
      body.unit.length > 100 ||
      !(
        body.quantity === null ||
        (
          typeof body.quantity === 'number' &&
          Number.isFinite(body.quantity) &&
          body.quantity >= 0 &&
          body.quantity <= 1000000000
        )
      ) ||
      !(
        body.expected_recorded_at === null ||
        (
          typeof body.expected_recorded_at === 'string' &&
          Number.isFinite(Date.parse(body.expected_recorded_at))
        )
      )
    ) {
      return res.status(400).json({ error: 'Invalid count details.' });
    }

    const { data: line, error } = await admin.rpc(
      'save_inventory_count_line',
      {
        p_restaurant_id: restaurantId,
        p_session_id: sessionId,
        p_ingredient_id: body.ingredient_id,
        p_quantity: body.quantity,
        p_unit: body.unit,
        p_expected_recorded_at: body.expected_recorded_at,
        p_user_id: auth.user.id,
      }
    );

    if (error) {
      const messages = {
        COUNT_CONFLICT: [
          409,
          'Another screen saved a different quantity. Reload saved values before editing this ingredient again.',
        ],
        COUNT_NOT_EDITABLE: [
          409,
          'This count is no longer an editable manual draft.',
        ],
        COUNT_UNIT_CHANGED: [
          409,
          'The ingredient unit has changed or is missing. Reload saved values and check the unit before counting.',
        ],
        COUNT_INVALID_QUANTITY: [
          400,
          'Enter a quantity from 0 to 1,000,000,000 with no more than six decimal places.',
        ],
        COUNT_INGREDIENT_NAME_MISSING: [
          400,
          'This ingredient needs a name before it can be counted.',
        ],
        COUNT_INGREDIENT_NOT_FOUND: [404, 'Ingredient not found.'],
        COUNT_NOT_FOUND: [404, 'Inventory count not found.'],
        COUNT_ACCESS_DENIED: [403, 'You cannot edit this inventory count.'],
      };

      const known = messages[error.message];

      if (known) {
        return res.status(known[0]).json({ error: known[1] });
      }

      throw error;
    }

    return res.status(200).json({ line });
  } catch (error) {
    console.error('[inventory/count-lines]', error);

    return res.status(500).json({
      error: 'Could not load or save the count. Please try again.',
    });
  }
}