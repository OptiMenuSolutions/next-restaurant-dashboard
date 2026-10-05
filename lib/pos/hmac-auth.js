// lib/pos/hmac-auth.js
//
// HMAC-SHA256 signing for Shift4 Marketplace API requests and webhook verification.
// Implements the signing scheme from Shift4 Onboarding Flows docs Section 3.
//
// Usage:
//   const sig = signRequest({ clientId, clientSecret, method, path, body, timestamp });
//   headers['x-access-key'] = clientId;
//   headers['x-timestamp'] = timestamp;
//   headers['x-signature'] = sig;
//
//   // For webhook verification:
//   const valid = verifyWebhook({ clientId, clientSecret, signature, timestamp, path, body });

import crypto from 'crypto';

function normalizeBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function normalizePath(path) {
  // Remove host and query parameters, convert to lowercase
  try {
    const url = new URL(path, 'https://dummy.local');
    return url.pathname.toLowerCase();
  } catch {
    // Not a URL, just lowercase it
    return String(path).toLowerCase();
  }
}

/**
 * Sign a Shift4 API request.
 * @param {object} opts - { clientId, clientSecret, method, path, body?, timestamp? }
 * @returns {string} hex-encoded HMAC-SHA256 signature
 */
export function signRequest({ clientId, clientSecret, method, body, path, timestamp }) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const normalizedPath = normalizePath(path);
  const normalizedBody = normalizeBody(body);
  const normalizedMethod = (method || 'GET').toUpperCase();

  const stringToSign = `${clientId}${normalizedMethod}${normalizedPath}${normalizedBody}${ts}`;
  const digest = crypto
    .createHmac('sha256', clientSecret)
    .update(stringToSign)
    .digest('hex');

  return digest;
}

/**
 * Verify a Shift4 webhook signature.
 * @param {object} opts - { clientId, clientSecret, signature, path, body, timestamp }
 * @returns {boolean} true if signature is valid
 */
export function verifyWebhook({ clientId, clientSecret, signature, path, body, timestamp }) {
  // Webhooks always POST to the subscription path
  const expected = signRequest({
    clientId,
    clientSecret,
    method: 'POST',
    path,
    body,
    timestamp,
  });
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Build a signed fetch request for Shift4 API.
 * @param {object} opts - { clientId, clientSecret, method, path, body?, timestamp? }
 * @returns {object} headers object with x-access-key, x-timestamp, x-signature
 */
export function buildHmacHeaders({ clientId, clientSecret, method, path, body, timestamp }) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const signature = signRequest({
    clientId,
    clientSecret,
    method,
    path,
    body,
    timestamp: ts,
  });

  return {
    'x-access-key': clientId,
    'x-timestamp': String(ts),
    'x-signature': signature,
    'Content-Type': 'application/json',
  };
}

export default {
  signRequest,
  verifyWebhook,
  buildHmacHeaders,
};