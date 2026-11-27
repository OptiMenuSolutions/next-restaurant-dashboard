import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell from '../../../components/admin/AdminShell';
import { Card, th, td } from '../../../components/admin/ui';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';
import { restaurantLocalDate } from '../../../lib/restaurantTime';

const eastern = 'America/New_York';
const dateTime = new Intl.DateTimeFormat('en-US', { timeZone: eastern, dateStyle: 'medium', timeStyle: 'short' });
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const cell = value => value ?? '—';
const cash = value => Number.isFinite(value) ? currency.format(value) : '—';
const shownTime = instant => instant ? `${dateTime.format(new Date(instant))} ET` : 'Unavailable';
const duration = ms => Number.isFinite(ms) && ms >= 0 ? `${quantity.format(ms / 1000)} s` : 'Unavailable';

function Totals({ value }) {
  if (!value) return <p>Data unavailable for this date.</p>;
  return <p>{value.count} batches · {cash(value.knownValue)} known value · {value.unvalued} unvalued
    {value.amounts.length > 0 && <> · itemized quantity {value.amounts.map(([unit, amount]) =>
      `${quantity.format(amount)} ${unit}`).join(', ')}</>}</p>;
}

function Ingredients({ title, rows }) {
  return <section>
    <h3>{title}</h3>
    {rows == null ? <p>Evidence unavailable.</p> : rows.length === 0 ? <p>None eligible.</p> :
      <ul>{rows.map((row, i) => <li key={`${row.ingredient_id}-${i}`}>
        {row.name || row.ingredient_id || 'Unlinked ingredient'} · {row.days_left} days left
        {row.use_by_date && <> · use by {row.use_by_date}</>}
      </li>)}</ul>}
  </section>;
}

function Health({ health, assessment, commit, review }) {
  const completed = health.jobs.filter(row => row.status === 'completed');
  const skipped = health.jobs.filter(row => row.status === 'skipped').length;
  const failed = health.jobs.filter(row => row.status === 'failed').length;
  const terminal = completed.length + skipped + failed;
  const fallback = completed.filter(row => row.fallback).length;
  const oldestDisposal = health.disposals.oldest_at;
  const oldestHours = oldestDisposal ? Math.floor((Date.now() - Date.parse(oldestDisposal)) / 3_600_000) : null;
  const rate = (count, total) => total ? `${count}/${total} (${Math.round(100 * count / total)}%)` : 'No observations';
  return <Card title="Assessment health">
    <p>14 dates through the selected day · {health.jobs.length} jobs recorded</p>
    <p>Skipped {rate(skipped, terminal)} · Failed {rate(failed, terminal)} · Forecast fallback {rate(fallback, completed.length)}</p>
    <p>Commit RPC on the selected UTC date, across all restaurants · {commit
      ? `${duration(commit.max_ms)} max of ${commit.calls} calls · 8 s limit`
      : 'No timing recorded'}</p>
    {assessment && <p>Selected assessment · {quantity.format(assessment.compact_bytes)} compact JSON bytes · {
      assessment.payload_bytes == null ? 'Detail payload unavailable' : `${quantity.format(assessment.payload_bytes)} detail JSON bytes`
    }</p>}
    {assessment && <p>Review batches · {review.length ? review.map(([reason, count]) => `${reason} ${count}`).join(' · ') : 'None'}</p>}
    <p>Correction sources needing review · {Object.entries(health.correction_review)
      .map(([reason, count]) => `${reason} ${count}`).join(' · ') || 'None'}</p>
    <p>Pending disposals now · {health.disposals.count} · {health.disposals.past_cutoff} before latest cutoff
      {oldestDisposal && <> · oldest {shownTime(oldestDisposal)} ({Math.max(0, oldestHours)} h ago)</>}</p>
    <ul>{health.jobs.map(job => <li key={job.assessment_date}>
      {job.assessment_date} · {job.status}
      {job.saved_at && <> · cutoff to save {duration(Date.parse(job.saved_at) - Date.parse(job.boundary))}</>}
      {job.fallback && <> · fallback run {cell(job.forecast_run_id)}</>}
      {job.last_error && <> · {job.last_error}</>}
    </li>)}</ul>
  </Card>;
}

export default function WasteRollout() {
  const router = useRouter();
  const { adminFetch } = useAdminFetch();
  const restaurant = typeof router.query.restaurant === 'string' ? router.query.restaurant : '';
  const date = typeof router.query.date === 'string' && router.query.date
    ? router.query.date : router.isReady ? restaurantLocalDate(eastern) : '';
  const params = new URLSearchParams({ restaurantId: restaurant, date }).toString();
  const [response, setResponse] = useState(null);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!router.isReady || !restaurant) return;
    const controller = new AbortController();
    setPage(0);
    setResponse(null);
    (async () => {
      const res = await adminFetch(`/api/admin/projections/waste-rollout?${params}`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read waste rollout.');
      if (!controller.signal.aborted) setResponse({ params, data });
    })().catch(error => {
      if (!controller.signal.aborted) setResponse({ params, error: error.message });
    });
    return () => controller.abort();
  }, [adminFetch, params, reload, restaurant, router.isReady]);

  const current = response?.params === params ? response : null;
  const data = current?.data;
  const rows = data?.comparison.rows ?? [];
  const shadow = data?.briefing?.shadow;

  return <AdminShell section="Platform" sub="Projections" title="Waste rollout">
    <main style={{ padding: 24, display: 'grid', gap: 18 }}>
      <h1>Waste rollout {data && <>· {data.health.name}</>}</h1>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link className="om-btn" href="/admin/projections">Projections</Link>
        <label>Business date <input type="date" value={date} onChange={e => {
          if (e.target.value) router.replace({ query: { restaurant, date: e.target.value } });
        }} /></label>
        <button type="button" className="om-btn" onClick={() => setReload(value => value + 1)}>Refresh</button>
      </div>
      {router.isReady && !restaurant && <p>Open a restaurant from Projections to compare its dated results.</p>}
      {restaurant && !current && <p role="status">Loading rollout evidence…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {data && <>
        <Card title="Dated card comparison">
          <h3>Legacy at-risk stock</h3>
          <p>Snapshot {data.snapshotDate} · first saved {shownTime(data.snapshotObservedAt)}.
            Days left are adjusted to the selected service date. Snapshots store invoice batches and omit historical units.</p>
          <Totals value={data.comparison.legacy} />
          <h3>Projected excess</h3>
          {data.assessment && <p>Inventory through {data.assessment.inventory_cutoff} · cutoff {shownTime(data.assessment.boundary)}
            {' · saved '}{shownTime(data.assessment.saved_at)} · assessment {data.assessment.id}</p>}
          <Totals value={data.comparison.projected} />
          {data.assessment && <p>Summarized batches · {Object.entries(data.assessment.omitted ?? {})
            .map(([status, value]) => `${status} ${value.count}`).join(' · ') || 'None'}.
            Summarized batches contribute totals where available. Batch identities are available for itemized rows.</p>}
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}>
            <thead><tr>{['Batch', 'Legacy at risk', 'Projected excess', 'Difference'].map(label =>
              <th style={th} key={label}>{label}</th>)}</tr></thead>
            <tbody>{rows.slice(page * 50, page * 50 + 50).map(row => <tr key={row.id}>
              <td style={td}>{row.name}<br /><small>{row.id}</small></td>
              <td style={td}>{row.legacy ? <>{cell(row.legacy.quantity)} · {cash(row.legacy.value)} · {row.legacy.daysLeft} days left</> : '—'}</td>
              <td style={td}>{row.projected ? <>{cell(row.projected.quantity)} {row.projected.unit}
                {' · '}{cash(row.projected.value)} · {row.projected.status} · use by {cell(row.projected.useBy)}</> : '—'}</td>
              <td style={td}>{cell(row.reason)}</td>
            </tr>)}</tbody>
          </table></div>
          {rows.length > 50 && <p>
            <button className="om-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
            {' '}{page + 1} / {Math.ceil(rows.length / 50)}{' '}
            <button className="om-btn" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(p => p + 1)}>Next</button>
          </p>}
        </Card>
        <Card title="Tonight’s Dish evidence">
          {data.briefing?.titles.length > 0 && <p>Saved picks · {data.briefing.titles.join(' · ')}
            {' · actual source '}{data.briefing.input?.reason || data.briefing.input?.assessment_id || 'unrecorded'}</p>}
          {shadow ? <>
            <p>Observed {shownTime(shadow.observed_at)} · projected source {
              shadow.projected_input.reason || shadow.projected_input.assessment_id
            }{shadow.projected_input.stale && ' · stale'}</p>
            <Ingredients title="Used in generation" rows={shadow.actual_ingredients} />
            <Ingredients title="Legacy ingredient evidence" rows={data.briefing.input?.mode === 'assessment' ? shadow.legacy_ingredients : shadow.actual_ingredients} />
            <Ingredients title="Projected ingredient evidence" rows={shadow.projected_ingredients} />
          </> : <p>Shadow evidence unavailable for this briefing.</p>}
        </Card>
        <Health health={data.health} assessment={data.assessment} commit={data.commit} review={data.comparison.review} />
      </>}
    </main>
  </AdminShell>;
}