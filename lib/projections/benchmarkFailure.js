const safeDetails = new Set([
  'A server FRED key and an approved series are required.',
  'FRED request failed.',
  'Invalid FRED JSON.',
  'Invalid or changing FRED pagination.',
  'Truncated FRED response.',
  'Invalid FRED observation or vintage.',
  'FRED count does not reconcile.',
  'FRED returned no observations.',
  'Missing candidate Census week.',
]);

export function benchmarkFailureMessage(error) {
  const code = typeof error?.code === 'string' &&
    /^(?:PROJECTION_[A-Z_]{1,70}|[A-Z0-9]{5})$/.test(error.code)
    ? error.code
    : 'UNEXPECTED_ERROR';
  const detail = typeof error?.message === 'string' && (
    safeDetails.has(error.message) || /^FRED HTTP [1-5]\d{2}\.$/.test(error.message)
  ) ? `: ${error.message}` : '';

  return `BENCHMARK_REVIEW_FAILED (${code})${detail}`;
}