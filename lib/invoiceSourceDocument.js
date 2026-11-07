import { createHash } from 'node:crypto';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Download the original invoice from private storage
 * and calculate its SHA-256 fingerprint.
 *
 * The supplied path identifies which file to retrieve.
 * The fingerprint always comes from downloaded bytes.
 */
export async function getInvoiceDocumentFingerprint({
  db,
  restaurantId,
  filePaths,
} = {}) {
  const reject = (reason) => ({
    verified: false,
    reason,
    fingerprint: null,
  });

  if (
    !db ||
    typeof restaurantId !== 'string' ||
    !restaurantId.trim()
  ) {
    return reject('invalid_context');
  }

  // Each source proof must correspond to exactly
  // one original uploaded document.
  if (!Array.isArray(filePaths) || filePaths.length !== 1) {
    return reject('unsupported_document_count');
  }

  const filePath = filePaths[0];

  if (
    typeof filePath !== 'string' ||
    !filePath.startsWith(`${restaurantId}/`) ||
    filePath.includes('..') ||
    filePath.includes('\\') ||
    filePath.includes('\0')
  ) {
    return reject('invalid_document_path');
  }

  try {
    const { data, error } = await db.storage
      .from('invoices')
      .download(filePath);

    if (error || !data) {
      return reject('document_download_failed');
    }

    const bytes = Buffer.from(
      await data.arrayBuffer()
    );

    if (!bytes.length) {
      return reject('empty_document');
    }

    const fingerprint = createHash('sha256')
      .update(bytes)
      .digest('hex');

    if (!FINGERPRINT_PATTERN.test(fingerprint)) {
      return reject('invalid_fingerprint');
    }

    return {
      verified: true,
      reason: null,
      fingerprint,
    };
  } catch {
    return reject('document_verification_failed');
  }
}