import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getProvider } from '../../../lib/pos/registry';
import { updateShift4Connection } from '../../../lib/pos/shift4-state';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STATE_SECRET =
  process.env.OAUTH_STATE_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function verifyState(state, cookie) {
  const [data, sig] = String(state || '').split('.');

  if (!data || !sig) throw new Error('Malformed state');

  const expected = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(data)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Bad state signature');
  }

  const payload = JSON.parse(
    Buffer.from(data, 'base64url').toString()
  );

  const nonce = String(cookie || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('pos_oauth_nonce='))
    ?.slice('pos_oauth_nonce='.length);

  if (
    !Number.isFinite(payload.ts) ||
    Date.now() - payload.ts > 15 * 60 * 1000 ||
    payload.ts > Date.now() + 60000 ||
    !nonce ||
    nonce !== payload.nonce
  ) {
    throw new Error('Expired state or different browser');
  }

  return payload;
}

function back(res, query, returnTo = '/client/profile') {
  const sep = returnTo.includes('?') ? '&' : '?';

  return res.redirect(
    `${APP_URL}${returnTo}${sep}${query}`
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error: providerError } = req.query;

  let parsed = null;

  try {
    parsed = verifyState(state, req.headers.cookie);
  } catch {
    // Handled below.
  }

  const returnTo = parsed?.returnTo || '/client/profile';

  res.setHeader(
    'Set-Cookie',
    'pos_oauth_nonce=; HttpOnly; Secure; SameSite=Lax; Path=/api/pos/oauth-callback; Max-Age=0'
  );

  if (providerError) {
    return back(res, 'pos=denied', '/client/profile');
  }

  if (!code || !parsed) {
    return back(res, 'pos=error', '/client/profile');
  }

  const { restaurantId, provider: providerId } = parsed;

  try {
    const provider = getProvider(providerId);
    let existing = null;

    if (providerId === 'shift4') {
      const loaded = await supabase
        .from('pos_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('provider', 'shift4')
        .maybeSingle();

      if (loaded.error) throw new Error(loaded.error.message);

      existing = loaded.data;

      if (existing?.status === 'disconnecting') {
        throw new Error(
          'Finish disconnecting Shift4 before starting a new connection'
        );
      }
    }

    const redirectUri = `${APP_URL}/api/pos/oauth-callback`;

    const result = await provider.exchangeCode({
      code,
      redirectUri,
    });

    if (providerId === 'shift4' && result.pendingLocation) {
      const hasExistingLink =
        existing?.shift4_location_id &&
        ['connected', 'error', 'pending', 'installing'].includes(
          existing.status
        );

      if (hasExistingLink) {
        const locations = await provider.listLocations(
          result.accessToken
        );

        const linkedLocation = locations.find(
          (location) =>
            String(location.id) ===
            String(existing.shift4_location_id)
        );

        if (
          !linkedLocation ||
          (
            linkedLocation.reason !== 'INSTALLED' &&
            !(
              existing.status === 'installing' &&
              linkedLocation.isAvailable
            )
          )
        ) {
          throw new Error(
            'The existing Shift4 location could not be verified as installed. The saved connection was not changed.'
          );
        }

        result.pendingLocation = existing.status === 'installing';
      }
    }

    const values = {
      restaurant_id: restaurantId,
      provider: providerId,
      status:
        existing?.status === 'installing'
          ? 'installing'
          : result.pendingLocation
            ? 'pending'
            : 'connected',
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      merchant_id: result.merchantId,
      locations: result.locations,
      expires_at: result.expiresAt,
      last_error: null,
      token_error: null,
      updated_at: new Date().toISOString(),
    };

    if (providerId === 'shift4' && existing) {
      const saved = await updateShift4Connection(
        supabase,
        existing,
        values
      );

      if (!saved) {
        throw new Error(
          'The connection changed during authorization. Start again.'
        );
      }
    } else {
      const query = supabase.from('pos_connections');

      const { error: saveError } =
        providerId === 'shift4'
          ? await query.insert(values)
          : await query.upsert(values, {
              onConflict: 'restaurant_id,provider',
            });

      if (saveError) throw new Error(saveError.message);
    }

    if (result.pendingLocation) {
      return res.redirect(
        `${APP_URL}/client/connect-shift4?returnTo=${encodeURIComponent(returnTo)}`
      );
    }

    return back(
      res,
      `pos=connected&provider=${providerId}`,
      returnTo
    );
  } catch (err) {
    console.error(
      `[pos/oauth-callback] ${providerId} connect failed:`,
      err.message
    );

    return back(res, 'pos=error', '/client/profile');
  }
}