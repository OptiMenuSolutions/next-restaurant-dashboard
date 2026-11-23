import { projectionInstant } from './businessTime.js';
import { projectionVolumeDigest } from './volumeProvenance.js';
import { benchmarkError } from './benchmarks.js';
import { CPI_GAP_POLICY, interpolateCpiMonths } from './cpiGap.js';

export async function fetchFredBenchmark(
  series,
  { apiKey, snapshotAt, fetchImpl = fetch } = {}
) {
  if (!['MRTSSM722USN', 'CUUR0000SEFV'].includes(series) || !apiKey) {
    throw benchmarkError(
      'A server FRED key and an approved series are required.'
    );
  }

  projectionInstant(snapshotAt);

  const vintage = new Date(snapshotAt).toISOString().slice(0, 10);
  const from = `${Number(vintage.slice(0, 4)) - 3}-01-01`;
  const query = {
    series_id: series,
    realtime_start: vintage,
    realtime_end: vintage,
    observation_start: from,
    observation_end: vintage,
    file_type: 'json',
    sort_order: 'asc',
    output_type: '1',
    limit: '1000',
  };

  const observations = [];
  const seen = new Set();
  let offset = 0;
  let count = null;

  do {
    const url = new URL(
      'https://api.stlouisfed.org/fred/series/observations'
    );
    url.search = new URLSearchParams({
      ...query,
      api_key: apiKey,
      offset: String(offset),
    }).toString();

    let response;

    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw benchmarkError('FRED request failed.');
    }

    if (!response.ok) {
      throw benchmarkError(`FRED HTTP ${response.status}.`);
    }

    let body;

    try {
      body = await response.json();
    } catch {
      throw benchmarkError('Invalid FRED JSON.');
    }

    if (
      !Number.isSafeInteger(body.count) ||
      body.count < 0 ||
      body.offset !== offset ||
      !Array.isArray(body.observations) ||
      (count !== null && body.count !== count)
    ) {
      throw benchmarkError('Invalid or changing FRED pagination.');
    }

    count = body.count;

    if (!body.observations.length && offset < count) {
      throw benchmarkError('Truncated FRED response.');
    }

    for (const row of body.observations) {
      if (
        !/^\d{4}-\d{2}-01$/.test(row.date) ||
        seen.has(row.date) ||
        row.date < from ||
        row.date > vintage ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.realtime_start || '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.realtime_end || '') ||
        row.realtime_start > vintage ||
        row.realtime_end < vintage ||
        (
          row.value !== '.' &&
          (
            !/^[0-9]+(?:\.[0-9]+)?$/.test(row.value) ||
            Number(row.value) <= 0
          )
        )
      ) {
        throw benchmarkError('Invalid FRED observation or vintage.');
      }

      seen.add(row.date);
      observations.push(row);
      offset++;
    }

    if (offset > count) {
      throw benchmarkError('FRED count does not reconcile.');
    }
  } while (offset < count);

  if (!count) {
    throw benchmarkError('FRED returned no observations.');
  }

  const payload = { observations };
  const normalized = observations.map(r => ({ date: r.date, value: r.value === '.' ? null : Number(r.value) }));
  const cpi = series === 'CUUR0000SEFV'
    ? interpolateCpiMonths(normalized, CPI_GAP_POLICY)
    : null;
  return { provider: series === 'MRTSSM722USN' ? 'fred_census' : 'fred_cpi',
    query_metadata: cpi ? {
      ...query, cpi_gap_policy: CPI_GAP_POLICY, cpi_interpolated: cpi.interpolated,
    } : query,
    payload, payload_sha256: projectionVolumeDigest(payload), normalized };
}