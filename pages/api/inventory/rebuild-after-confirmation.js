import { admin, requireOwner } from '../../../lib/scannerAuth';
import { rebuildCurrentInventory } from '../../../lib/currentInventory';

export const config = { maxDuration: 300 };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const body =
    typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body || {};

  const confirmationId = body.confirmation_id;

  console.warn('[inventory-rebuild-debug]', {
    contentType: req.headers['content-type'] || null,
    bodyType: typeof req.body,
    bodyKeys:
      body && typeof body === 'object' && !Array.isArray(body)
        ? Object.keys(body)
        : [],
    confirmationIdType: typeof confirmationId,
    confirmationIdLength:
      typeof confirmationId === 'string'
        ? confirmationId.length
        : null,
    confirmationIdValid:
      typeof confirmationId === 'string'
        ? UUID.test(confirmationId)
        : false,
  });

    if (
      !confirmationId ||
      typeof confirmationId !== 'string' ||
      !UUID.test(confirmationId)
    ) {
      return res.status(400).json({
        error: 'A valid confirmation ID is required.',
      });
    }

    const { data: confirmation, error: lookupError } =
      await admin
        .from('waste_confirmations')
        .select('id,status,confirmed_at')
        .eq('id', confirmationId)
        .eq('restaurant_id', auth.restaurant.id)
        .maybeSingle();

    if (lookupError) throw lookupError;

    if (!confirmation) {
      return res.status(404).json({
        error: 'Confirmation not found.',
      });
    }

    if (
      ![
        'confirmed_wasted',
        'confirmed_used',
        'kept',
        'not_sure',
      ].includes(confirmation.status)
    ) {
      return res.status(409).json({
        error: 'The confirmation has not been answered yet.',
      });
    }

    // Rebuild using the signed-in owner's restaurant ID.
    // Never accept a restaurant ID from the browser.
    await rebuildCurrentInventory(
      admin,
      auth.restaurant.id
    );

    return res.status(200).json({
      ok: true,
      rebuilt: true,
    });
  } catch (error) {
    console.error(
      '[inventory/rebuild-after-confirmation]',
      error
    );

    return res.status(500).json({
      error:
        'The response was saved, but inventory could not be refreshed. Please try again.',
    });
  }
}