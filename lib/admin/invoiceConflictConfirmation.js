
import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_MS = 10 * 60 * 1000;

function signingKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Confirmation signing key is unavailable');
  return key;
}

function signature(payload) {
  return createHmac('sha256', signingKey())
    .update(payload)
    .digest('hex');
}

export function createConflictConfirmation(adminId, request) {
  const payload = Buffer.from(JSON.stringify({
    adminId,
    request,
    expiresAt: Date.now() + MAX_AGE_MS,
  })).toString('base64url');

  return `${payload}.${signature(payload)}`;
}

export function verifyConflictConfirmation(token, adminId, request) {
  if (typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, suppliedSignature] = parts;

  if (!/^[a-f0-9]{64}$/.test(suppliedSignature)) return false;

  const expected = Buffer.from(signature(payload), 'hex');
  const supplied = Buffer.from(suppliedSignature, 'hex');

  if (!timingSafeEqual(expected, supplied)) return false;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    return (
      decoded.adminId === adminId &&
      Number.isFinite(decoded.expiresAt) &&
      decoded.expiresAt > Date.now() &&
      JSON.stringify(decoded.request) === JSON.stringify(request)
    );
  } catch {
    return false;
  }
}
