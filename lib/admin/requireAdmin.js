// lib/admin/requireAdmin.js
// Auth check for the new admin API routes. Same check as withAdminAuth
// (Bearer token, then profiles.role === 'admin') but it does not write an
// audit entry on every call. The new routes log only real changes, by
// calling writeAuditLog themselves, so the audit log stays readable.
//
// Usage inside a route:
//   const admin = await requireAdmin(req, res);
//   if (!admin) return;            // response already sent

import { createClient } from '@supabase/supabase-js';

export const adminDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const TOUR_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

export async function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No session token' });
    return null;
  }
  const { data: { user } = {}, error } = await adminDb.auth.getUser(auth.slice(7));
  if (error || !user) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    res.status(403).json({ error: 'Admins only' });
    return null;
  }

  // getUser above has already validated this token.
  let verifiedSecondFactor = false;
  try {
    const claims = JSON.parse(
      Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString('utf8')
    );
    verifiedSecondFactor = claims.sub === user.id && claims.aal === 'aal2';
  } catch {
    verifiedSecondFactor = false;
  }

  if (!verifiedSecondFactor) {
    res.status(403).json({
      error: 'Admin verification required',
      code: 'MFA_REQUIRED',
    });
    return null;
  }

  return { user, profile, name: profile.full_name || profile.email || 'Admin' };
}

// Today's date in Eastern time as YYYY-MM-DD.
export function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// The current hour (0 to 23) in Eastern time.
export function etHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(d));
}

// YYYY-MM-DD plus n days.
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 6:00 AM Eastern, n days from today. Used for snoozes.
export function etMorning(days = 1) {
  const [y, m, d] = etDate().split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d + days, 10); // 10:00 UTC is 5 or 6 AM Eastern
  return new Date(guess + (6 - etHour(new Date(guess))) * 3600000);
}