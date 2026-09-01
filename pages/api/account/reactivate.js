// pages/api/account/reactivate.js
// Clears deactivated_at if the account is still within the 60-day retention
// window. Called from login.js when a deactivated account's owner signs
// back in and confirms they want to come back.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RETENTION_DAYS = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await supabase
      .from('profiles').select('restaurant_id').eq('id', user.id).single();
    if (!profile?.restaurant_id) return res.status(400).json({ error: 'No restaurant on this account' });

    const { data: restaurant } = await supabase
      .from('restaurants').select('deactivated_at').eq('id', profile.restaurant_id).single();

    if (!restaurant?.deactivated_at) {
      return res.status(200).json({ ok: true, wasDeactivated: false });
    }

    const daysSince = (Date.now() - new Date(restaurant.deactivated_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > RETENTION_DAYS) {
      // Should be rare — the purge cron should have already removed this
      // account by now. Don't reactivate a subscription-less account into
      // a confusing half-state; make the caller re-onboard/re-subscribe.
      return res.status(410).json({ error: 'This account is past its retention window and can no longer be reactivated.' });
    }

    const { error } = await supabase
      .from('restaurants')
      .update({ deactivated_at: null })
      .eq('id', profile.restaurant_id);
    if (error) throw error;

    return res.status(200).json({ ok: true, wasDeactivated: true });
  } catch (err) {
    console.error('[account/reactivate] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
