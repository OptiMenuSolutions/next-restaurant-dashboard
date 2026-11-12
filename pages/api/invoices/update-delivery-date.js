const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function createUpdateDeliveryDateHandler({
  db,
  verifyAccess,
  getMatchingPolicy = async (database, restaurantId) => {
    const { getProgressiveInvoiceMatchingPolicy } =
      await import('../../../lib/progressiveInvoiceMatching');

    return getProgressiveInvoiceMatchingPolicy(database, restaurantId);
  },
  isEnabled = () =>
    process.env.INVOICE_DELIVERY_DATE_CORRECTIONS_ENABLED === 'true',
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).end();
    }

    let body;

    try {
      body = typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body;
    } catch {
      return res.status(400).json({
        error: 'Invalid JSON body.',
      });
    }

    const allowed = [
      'restaurant_id',
      'invoice_id',
      'delivery_date',
      'expected_delivery_date',
    ];

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !allowed.includes(key)) ||
      typeof body.restaurant_id !== 'string' ||
      !UUID.test(body.restaurant_id) ||
      typeof body.invoice_id !== 'string' ||
      !UUID.test(body.invoice_id) ||
      !validDate(body.delivery_date) ||
      !Object.hasOwn(body, 'expected_delivery_date') ||
      (
        body.expected_delivery_date !== null &&
        !validDate(body.expected_delivery_date)
      )
    ) {
      return res.status(422).json({
        error: 'Valid invoice identifiers and calendar dates are required.',
      });
    }

    try {
      const access = verifyAccess
        ? await verifyAccess(req, body.restaurant_id)
        : await import('../../../lib/withRestaurantAuth')
            .then(module =>
              module.verifyRestaurantAccess(req, body.restaurant_id)
            );

      if (access.error) {
        return res.status(access.status || 403).json({
          error: access.error,
        });
      }

      if (!access.user?.id || !UUID.test(access.user.id)) {
        return res.status(401).json({
          error: 'Unauthorized.',
        });
      }

      if (!isEnabled()) {
        return res.status(503).json({
          error: 'Delivery-date editing is not available yet.',
        });
      }

      const database = db ||
        await import('@supabase/supabase-js').then(({ createClient }) =>
          createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
          )
        );

      const policy = await getMatchingPolicy(
        database,
        body.restaurant_id
      );

      if (typeof policy?.matching_enabled !== 'boolean') {
        throw new Error('Invoice matching policy unavailable.');
      }

      const { data: result, error } = await database.rpc(
        'correct_invoice_delivery_date',
        {
          p_restaurant_id: body.restaurant_id,
          p_invoice_id: body.invoice_id,
          p_actor_id: access.user.id,
          p_expected_delivery_date: body.expected_delivery_date,
          p_delivery_date: body.delivery_date,
          p_queue_calculations: policy.matching_enabled,
        }
      );

      if (error) {
        const messages = {
          '40001': [
            409,
            'This invoice changed. Reload it before saving the date.',
          ],
          P0002: [404, 'Invoice not found.'],
          '42501': [403, 'Restaurant access denied.'],
          '22023': [422, 'The delivery date is invalid.'],
        };

        const [status, message] = messages[error.code] || [
          500,
          'The delivery date could not be saved.',
        ];

        return res.status(status).json({
          error: message,
        });
      }

      if (
        result?.success !== true ||
        result.invoice?.id !== body.invoice_id ||
        result.invoice?.restaurant_id !== body.restaurant_id ||
        result.invoice?.delivery_date !== body.delivery_date ||
        typeof result.changed !== 'boolean' ||
        typeof result.calculations_queued !== 'boolean'
      ) {
        throw new Error('Unexpected delivery-date correction result.');
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error('[update-delivery-date]', error.message);

      return res.status(500).json({
        error:
          'The delivery date could not be saved. Please reload before retrying.',
      });
    }
  };
}

export default createUpdateDeliveryDateHandler();