import { admin, requireOwner } from '../../../lib/scannerAuth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_FIELDS = [
  'id',
  'restaurant_id',
  'status',
  'source',
  'created_by',
  'created_at',
  'updated_at',
  'submitted_at',
  'notes',
].join(',');

async function findSession(restaurantId, sessionId) {
  const { data, error } = await admin
    .from('inventory_count_sessions')
    .select(SESSION_FIELDS)
    .eq('restaurant_id', restaurantId)
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function readLines(restaurantId, sessionId) {
  const lines = [];
  const pageSize = 500;

  for (let from = 0; ; ) {
    const { data, error } = await admin
      .from('inventory_count_lines')
      .select(
        'id, ingredient_id, ingredient_name, quantity, unit, counted_at, recorded_by, recorded_at, notes'
      )
      .eq('restaurant_id', restaurantId)
      .eq('session_id', sessionId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!Array.isArray(data)) {
      throw new Error('Invalid inventory count response.');
    }

    if (data.length === 0) return lines;

    lines.push(...data);
    from += data.length;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const auth = await requireOwner(req);

    if (auth.error) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const restaurantId = auth.restaurant.id;

    if (req.method === 'GET') {
      const requestedId = req.query.session_id;
      let session;

      if (requestedId !== undefined) {
        if (typeof requestedId !== 'string' || !UUID.test(requestedId)) {
          return res.status(400).json({
            error: 'Invalid inventory count ID.',
          });
        }

        session = await findSession(restaurantId, requestedId);

        if (!session) {
          return res.status(404).json({
            error: 'Inventory count not found.',
          });
        }
      } else {
        // Reopen the most recently updated manual draft.
        const { data, error } = await admin
          .from('inventory_count_sessions')
          .select(SESSION_FIELDS)
          .eq('restaurant_id', restaurantId)
          .eq('status', 'draft')
          .eq('source', 'manual')
          .order('updated_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        session = data;
      }

      if (!session) {
        return res.status(200).json({
          session: null,
          lines: [],
        });
      }

      const lines = await readLines(restaurantId, session.id);

      return res.status(200).json({ session, lines });
    }

    let body;

    try {
      body = typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body;
    } catch {
      return res.status(400).json({ error: 'Invalid request body.' });
    }

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'session_id') ||
      typeof body.session_id !== 'string' ||
      !UUID.test(body.session_id)
    ) {
      return res.status(400).json({
        error: 'Provide a valid session_id only.',
      });
    }

    // The client creates this ID once and reuses it for retries.
    // A repeated request returns the same draft instead of duplicating it.
    const existing = await findSession(restaurantId, body.session_id);

    if (existing) {
      if (existing.status !== 'draft' || existing.source !== 'manual') {
        return res.status(409).json({
          error: 'This count cannot be reopened as a manual draft.',
        });
      }

      return res.status(200).json({
        session: existing,
        created: false,
      });
    }

    const { data: session, error: createError } = await admin
      .from('inventory_count_sessions')
      .insert({
        id: body.session_id,
        restaurant_id: restaurantId,
        status: 'draft',
        source: 'manual',
        created_by: auth.user.id,
      })
      .select(SESSION_FIELDS)
      .single();

    if (createError) {
      // Handle two requests for the same draft arriving together.
      if (createError.code === '23505') {
        const retrySession = await findSession(
          restaurantId,
          body.session_id
        );

        if (
          retrySession?.status === 'draft' &&
          retrySession?.source === 'manual'
        ) {
          return res.status(200).json({
            session: retrySession,
            created: false,
          });
        }

        return res.status(409).json({
          error: 'Could not create this draft. Start a new count.',
        });
      }

      throw createError;
    }

    return res.status(201).json({
      session,
      created: true,
    });
  } catch (error) {
    console.error('[inventory/counts]', error);

    return res.status(500).json({
      error: 'Could not load or create the inventory count. Please try again.',
    });
  }
}