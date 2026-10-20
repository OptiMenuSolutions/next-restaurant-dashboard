// lib/scannerKey.js
// The device key an invoice scanner's phone keeps after joining with a code.
// It is not a Supabase login: only the /api/scanner routes understand it,
// and it goes in the X-Scanner-Key header. Leave or Enter a new code clears it.
const KEY = "om_scanner_key";

export function getScannerKey() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setScannerKey(key) {
  try { localStorage.setItem(KEY, key); } catch {}
}

export function clearScannerKey() {
  try { localStorage.removeItem(KEY); } catch {}
}

/* Headers for an /api/scanner call, with the key when this phone has one. */
export function scannerHeaders(extra = {}) {
  const key = getScannerKey();
  return key ? { ...extra, "X-Scanner-Key": key } : { ...extra };
}