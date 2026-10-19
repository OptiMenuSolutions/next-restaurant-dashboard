// lib/scannerAuth.js
// Server-only helpers for invoice scanners (staff who only scan invoices).
//
// Owners and scanners are told apart on the server, never in the browser:
//   requireOwner   - a signed-in owner; their restaurant comes from their own
//                    profile, never from the request body.
//   requireScanner - a signed-in scanner with an active membership.
// Scanners have no profile and no restaurant_id, so the existing
// restaurant checks (and row-level security) give them nothing.
//
// internalHeaders / isInternalCall let /api/scanner/process run a scanner's
// photos through the same parse-invoice and confirm-invoice routes the owner
// uses, after it has checked the scanner itself. Needs INTERNAL_API_KEY set
// in Vercel (any long random string).
import { randomInt } from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export const SCANNER_CAP = 15; // active scanners plus open invites, per restaurant
export const INVITE_DAYS = 7;

async function userFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/* { user, restaurant } or { error, status } */
export async function requireOwner(req) {
  const user = await userFromRequest(req);
  if (!user || user.is_anonymous) return { error: 'Please sign in again.', status: 401 };
  const { data: profile } = await admin
    .from('profiles').select('restaurant_id').eq('id', user.id).single();
  if (!profile?.restaurant_id) return { error: 'No restaurant on this account.', status: 403 };
  const { data: restaurant } = await admin
    .from('restaurants').select('id, name, deactivated_at').eq('id', profile.restaurant_id).single();
  if (!restaurant || restaurant.deactivated_at) return { error: 'This account is closed.', status: 403 };
  return { user, restaurant };
}

/* { user, scanner, restaurant } or { error, status, removed? } */
export async function requireScanner(req) {
  const user = await userFromRequest(req);
  if (!user) return { error: 'Please sign in again.', status: 401 };
  const { data: scanner } = await admin
    .from('restaurant_scanners')
    .select('id, restaurant_id, name, joined_at, removed_at')
    .eq('user_id', user.id)
    .is('removed_at', null)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!scanner) return { error: 'This phone is no longer scanning for a restaurant.', status: 403, removed: true };
  const { data: restaurant } = await admin
    .from('restaurants').select('id, name, deactivated_at').eq('id', scanner.restaurant_id).single();
  if (!restaurant || restaurant.deactivated_at) return { error: 'This restaurant is no longer on OptiMenu.', status: 403, removed: true };
  return { user, scanner, restaurant };
}

export function isInternalCall(req) {
  const key = process.env.INTERNAL_API_KEY;
  return !!key && key.length >= 24 && req.headers['x-optimenu-internal'] === key;
}

export function internalHeaders() {
  return { 'Content-Type': 'application/json', 'x-optimenu-internal': process.env.INTERNAL_API_KEY || '' };
}

/* Base URL of this deployment, for calling its own API routes. */
export function selfBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/* Signs a scanner's phone out everywhere: deleting the email-less user ends
   its session at the next token refresh. Their name stays on past invoices. */
export async function endScannerLogin(userId) {
  if (!userId) return;
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.warn('[scanners] Could not delete scanner login:', error.message);
}

export function newCode() {
  // Uniform over 000000-999999.
  return String(randomInt(0, 1000000)).padStart(6, '0');
}