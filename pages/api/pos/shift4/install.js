import shift4 from '../../../../lib/pos/providers/shift4';
import {
  supabaseAdmin,
  getRestaurantIdForRequest,
  getShift4Connection,
} from '../../../../lib/pos/shift4-connect';
import { updateShift4Connection } from '../../../../lib/pos/shift4-state';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const restaurantId = await getRestaurantIdForRequest(req);

  if (!restaurantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const locationId = Number(req.body?.locationId);

  if (!Number.isSafeInteger(locationId) || locationId <= 0) {
    return res.status(400).json({
      error: 'A positive locationId is required',
    });
  }

  const conn = await getShift4Connection(restaurantId);

  const recovering =
    conn?.status === 'installing' &&
    conn.shift4_location_id === locationId;

  if (
    !conn ||
    (!recovering && conn.status !== 'pending') ||
    !conn.access_token
  ) {
    return res.status(409).json({
      error: 'There is no Shift4 connection in progress. Go back and click Connect Shift4 to start again.',
      restart: true,
    });
  }

  let target;
  let claimed = conn;

  try {
    const locations = await shift4.listLocations(conn.access_token);
    target = locations.find((l) => l.id === locationId);

    if (
      !target ||
      (
        !target.isAvailable &&
        !(recovering && target.reason === 'INSTALLED')
      )
    ) {
      return res.status(400).json({
        error: 'That location cannot be connected to OptiMenu.',
      });
    }

    if (!recovering) {
      const won = await updateShift4Connection(supabaseAdmin, conn, {
        status: 'installing',
        shift4_location_id: locationId,
        updated_at: new Date().toISOString(),
      });

      if (!won) {
        return res.status(409).json({
          error: 'The connection changed. Reload and try again.',
        });
      }

      claimed = {
        ...conn,
        status: 'installing',
        shift4_location_id: locationId,
      };
    }

    // A retry can finish linking an installation already accepted by Shift4.
    if (target.isAvailable) {
      await shift4.installLocation(conn.access_token, locationId);
    }

    if (!target.timeZone) {
      const installed = await shift4.listInstalledLocations();

      target = {
        ...target,
        timeZone: installed.find((l) => l.id === locationId)?.timeZone,
      };
    }

    if (!target.timeZone) {
      throw new Error(
        'Shift4 has not returned the installed location time zone yet'
      );
    }
  } catch (err) {
    console.error('[pos/shift4/install]', err.message);

    if (err.status === 401) {
      return res.status(409).json({
        error: 'Your Shift4 sign-in has expired. Go back and click Connect Shift4 to start again.',
        restart: true,
      });
    }

    return res.status(502).json({
      error: 'Shift4 could not connect that location. Please try again.',
    });
  }

  try {
    const saved = await updateShift4Connection(supabaseAdmin, claimed, {
      status: 'connected',
      shift4_location_id: locationId,
      shift4_timezone: target.timeZone,
      last_error: null,
      token_error: null,
      updated_at: new Date().toISOString(),
    });

    if (!saved) {
      return res.status(409).json({
        error: 'The connection changed during installation. Reload to check its state.',
      });
    }
  } catch (updateError) {
    console.error(
      '[pos/shift4/install] Installed on Shift4 but could not save:',
      updateError.message
    );

    return res.status(500).json({
      error: 'Connected in Shift4, but we could not save it. Please contact support.',
    });
  }

  return res.status(200).json({
    ok: true,
    locationName: target.name,
  });
}