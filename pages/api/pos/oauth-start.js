// pages/api/pos/oauth-start.js
//
// Step 1 of the OAuth connect flow (Square today; any future OAuth provider).
// Authenticated POST { restaurantId, provider } -> { url }. The client then
// does window.location = url. We sign the state with HMAC so the callback can
// trust which restaurant/provider it belongs to (CSRF + tamper protection).

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getProvider } from '../../../lib/pos/registry';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { restaurantId, provider: providerId } = req.body || {};
  if (!restaurantId || !providerId) {
    return res.status(400).json({ error: 'restaurantId and provider are required' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('restaurant_id')
    .eq('id', user.id)
    .single();
  if (!profile || profile.restaurant_id !== restaurantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let provider;
  try {
    provider = getProvider(providerId);
  } catch {
    return res.status(400).json({ error: `Unknown provider: ${providerId}` });
  }
  if (provider.authType !== 'oauth2') {
    return res.status(400).json({ error: `${provider.label} does not use OAuth connect` });
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/pos/oauth-callback`;
  const state = signState({ restaurantId, provider: providerId, ts: Date.now() });
  const url = provider.getAuthUrl({ state, redirectUri });

  return res.status(200).json({ url });
}