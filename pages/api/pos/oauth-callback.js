// pages/api/pos/oauth-callback.js
//
// Step 2 of the OAuth connect flow. The provider redirects the browser here with
// ?code & ?state. We verify the signed state, exchange the code for tokens, and
// upsert the pos_connections row, then redirect back into the app.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getProvider } from '../../../lib/pos/registry';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function verifyState(state) {
  const [data, sig] = String(state || '').split('.');
  if (!data || !sig) throw new Error('Malformed state');
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url');
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Bad state signature');
  return JSON.parse(Buffer.from(data, 'base64url').toString());
}

function back(res, query, returnTo = '/client/profile') {
  const sep = returnTo.includes('?') ? '&' : '?';
  return res.redirect(`${APP_URL}${returnTo}${sep}${query}`);
}

export default async function handler(req, res) {
  const { code, state, error: providerError } = req.query;

  let parsed = null;
  try {
    parsed = verifyState(state);
  } catch {
    // handled below
  }
  const returnTo = parsed?.returnTo || '/client/profile';

  if (providerError) return back(res, `pos=denied`, returnTo);
  if (!code || !parsed) return back(res, `pos=error`, returnTo);

  const { restaurantId, provider: providerId } = parsed;

  try {
    const provider = getProvider(providerId);
    const redirectUri = `${APP_URL}/api/pos/oauth-callback`;
    const result = await provider.exchangeCode({ code, redirectUri });

    const { error: upsertError } = await supabase
      .from('pos_connections')
      .upsert({
        restaurant_id: restaurantId,
        provider: providerId,
        status: result.pendingLocation ? 'pending' : 'connected',
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        merchant_id: result.merchantId,
        locations: result.locations,
        expires_at: result.expiresAt,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'restaurant_id,provider' });
    if (upsertError) throw new Error(upsertError.message);

    // Shift4: the merchant still has to pick which location to connect.
    if (result.pendingLocation) {
      return res.redirect(`${APP_URL}/client/connect-shift4?returnTo=${encodeURIComponent(returnTo)}`);
    }

    return back(res, `pos=connected&provider=${providerId}`, returnTo);
  } catch (err) {
    console.error(`[pos/oauth-callback] ${providerId} connect failed:`, err.message);
    return back(res, `pos=error`, returnTo);
  }
}