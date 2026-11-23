import { useCallback, useEffect, useState } from 'react';
import AdminShell from '../../../components/admin/AdminShell';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';
import {
  hasUsableEightWeekPreview,
  formatBenchmarkNumber,
  benchmarkWeekAvailability,
} from '../../../lib/projections/benchmarkPreview.js';

const endpoint = '/api/admin/projections/benchmarks';

export default function Benchmarks() {
  const { adminFetch } = useAdminFetch();
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (url, body) => {
    const response = await adminFetch(
      url,
      body ? { method: 'POST', body: JSON.stringify(body) } : {}
    );
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Request failed');
    }

    return result;
  }, [adminFetch]);

  const load = useCallback(async () => {
    const result = await request(endpoint);
    setVersions(result.versions);
  }, [request]);

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, [load]);

  async function action(body) {
    setBusy(true);
    setError('');

    try {
      const result = await request(endpoint, body);
      await load();

      const id = result.id || preview?.version.id;
      if (id) {
        setPreview(
          await request(`${endpoint}?id=${encodeURIComponent(id)}`)
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const approvalReady = preview?.preview.some(restaurant =>
    hasUsableEightWeekPreview(restaurant.result)
  ) ?? false;

  return (
    <AdminShell>
      <main style={{ padding: 24, overflowX: 'auto' }}>
        <h1>Projection benchmarks</h1>
        <p>
          Census review. Ratios below are before damping; S includes damping
          and the seasonal bounds. Search trends remain neutral until an
          approved provider is available.
        </p>

        {error && <p role="alert">{error}</p>}

        <button
          disabled={busy}
          onClick={() => action({ action: 'refresh' })}
        >
          Build candidate
        </button>

        <select
          aria-label="Benchmark version"
          value={preview?.version.id || ''}
          onChange={async event => {
            try {
              setPreview(await request(
                `${endpoint}?id=${encodeURIComponent(event.target.value)}`
              ));
            } catch (err) {
              setError(err.message);
            }
          }}
        >
          <option value="" disabled>Select version</option>
          {versions.map(version => (
            <option key={version.id} value={version.id}>
              {version.vintage} ·{' '}
              {version.published_at ? 'Published' : 'Needs approval'} ·{' '}
              {version.id}
            </option>
          ))}
        </select>

        {preview && (
          <>
            <p>
              Version {preview.version.id}.
              Weekdays are Monday through Sunday.
            </p>

            {preview.preview.map(restaurant => (
              <section key={restaurant.restaurant_id}>
                <h2>
                  {restaurant.name} · {restaurant.state || 'State missing'}
                </h2>

                {restaurant.result.cpi_gap_policy && (
                  <p>
                    CPI rule: {restaurant.result.cpi_gap_policy}. Interpolated months:{' '}
                    {(restaurant.result.cpi_interpolated ?? []).map(row => row.date).join(', ') || 'none'}.
                  </p>
                )}

                {restaurant.result.status !== 'ok' ? (
                  <p>Unavailable: {restaurant.result.reason}</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Daily raw ratios (Mon–Sun)</th>
                        <th>Daily S (Mon–Sun)</th>
                        <th>Eligible</th>
                        <th>Unavailable days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {restaurant.result.weeks.map(week => (
                        <tr key={week.week_start}>
                          <td>{week.week_start}</td>
                          <td>
                            {week.days.map(day =>
                              formatBenchmarkNumber(day.ratio)
                            ).join(' / ')}
                          </td>
                          <td>
                            {week.days.map(day =>
                              formatBenchmarkNumber(day.capped_S)
                            ).join(' / ')}
                          </td>
                          <td>
                            {benchmarkWeekAvailability(week)}
                          </td>
                          <td>
                            {week.days
                              .filter(day => !day.applies && day.reason !== 'closed_weekday')
                              .map(day => `${day.target_date}: ${day.reason || 'unavailable'}`)
                              .join('; ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}

            {!preview.published_at && !approvalReady && (
              <p>Approval requires at least one restaurant with a usable day in each of its eight preview weeks.</p>
            )}

            <button
              disabled={busy || !!preview.published_at || !approvalReady}
              onClick={() => action({
                action: 'approve',
                id: preview.version.id,
                digest: preview.digest,
              })}
            >
              {preview.published_at
                ? 'Published'
                : 'Approve this version'}
            </button>
          </>
        )}
      </main>
    </AdminShell>
  );
}