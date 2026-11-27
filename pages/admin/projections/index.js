import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell from '../../../components/admin/AdminShell';
import WasteAssessmentSwitch from '../../../components/admin/WasteAssessmentSwitch';
import { Card, th, td } from '../../../components/admin/ui';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';

const endpoint = '/api/admin/projections/monitor';
const n = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const leadLabel = lead => lead === 1 ? 'Day-of' : `${lead - 1} day${lead === 2 ? '' : 's'} ahead`;
const cell = value => value === null || value === undefined ? '—' : String(value);
const href = values => ({ pathname: '/admin/projections', query: values });

function Table({ headings, rows }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead><tr>{headings.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j} style={td}>{value}</td>)}</tr>)}</tbody>
  </table></div>;
}

function issued(value, timezone) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'Invalid/Timezone',
    dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return 'Timezone unavailable'; }
}

export default function ProjectionMonitor() {
  const router = useRouter();
  const { adminFetch } = useAdminFetch();
  const [loaded, setLoaded] = useState(null);
  const [failure, setFailure] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(0);
  const sequence = useRef(0);
  const { restaurant = '', date = '', view = 'overview', weeks = '12', regular = 'true', dish = '', run = '', lead = '1', model = '4' } = router.query;
  const params = new URLSearchParams({ view, restaurant, date, weeks, regular, dish, run }).toString();

  const data = loaded?.key === params ? loaded.value : null;
  const error = failure?.key === params ? failure.message : '';

  useEffect(() => {
    if (!router.isReady) return undefined;
    const current = ++sequence.current;
    const controller = new AbortController();
    setLoaded(null); setFailure(null); setPage(0);
    (async () => {
      const response = await adminFetch(`${endpoint}?${params}`, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Read failed');
      if (current !== sequence.current || controller.signal.aborted) return;
      setLoaded({ key: params, value: result });
    })().catch(err => {
      if (current === sequence.current && !controller.signal.aborted) setFailure({ key: params, message: err.message });
    });
    return () => controller.abort();
  }, [adminFetch, params, refresh, router.isReady, view]);

  useEffect(() => setPage(0), [lead, model]);
  const navigate = changes => router.push(href({ ...router.query, ...changes }));
  const zone = data?.restaurant?.timezone;
  const observations = data?.observations || [];
  const allVolumes = observations.filter(row => row.dish_id === null);
  const volumes = allVolumes.filter(row => row.model_major === Number(model));
  const selectedVolume = volumes.find(row => row.days_ahead === Number(lead));
  const dishes = observations.filter(row => row.dish_id && row.run_id === selectedVolume?.run_id);
  const groups = data?.groups || [];
  const weekly = groups.filter(g => g.bucket === 'week');
  const dishGroups = groups.filter(g => g.bucket === 'dish');
  const rows = view === 'accuracy' ? dishGroups : dishes;
  const runLink = (id, label) => <Link href={href({ restaurant, view: 'run', run: id })}>{label}</Link>;
  const name = id => data?.restaurant?.dish_names?.[id] || id;

  return <AdminShell section="Platform" sub="Projections" title="Projection monitoring">
    <main style={{ padding: 24, display: 'grid', gap: 18 }}>
      <h1>Projection monitoring</h1>
      <p>Internal review. Forecasts remain archived as issued; actuals reflect this read. Counts use projection business nights and mapped food dish units. This page does not run the engine.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link className="om-btn" href="/admin/projections">Overview</Link>
        <Link className="om-btn" href="/admin/projections/benchmarks">Benchmarks</Link>
        <button className="om-btn" onClick={() => setRefresh(x => x + 1)}>Refresh</button>
        {restaurant && <>
          <Link className="om-btn" href={href({ restaurant, date, view: 'service' })}>Service review</Link>
          <Link className="om-btn" href={{ pathname: '/admin/projections/waste-rollout', query: { restaurant, date } }}>Waste rollout</Link>
          <Link className="om-btn" href={href({ restaurant, date, view: 'accuracy', weeks, regular })}>Accuracy</Link>
        </>}
      </div>
      {restaurant && view !== 'run' && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label>Service date <input className="om-field" type="date" value={date} onChange={e => navigate({ date: e.target.value })} /></label>
        {view === 'accuracy' && <>
          <label>Window <select className="om-field" value={weeks} onChange={e => navigate({ weeks: e.target.value })}>
            {[4, 8, 12].map(w => <option key={w} value={w}>{w} weeks</option>)}
          </select></label>
          <label>Scoring <select className="om-field" value={regular} onChange={e => navigate({ regular: e.target.value })}>
            <option value="true">Regular nights</option><option value="false">All complete nights</option>
          </select></label>
          {dish && <button className="om-btn" onClick={() => navigate({ dish: '' })}>All dishes</button>}
        </>}
      </div>}
      {error && <p role="alert">{error} <button className="om-btn" onClick={() => setRefresh(x => x + 1)}>Try again</button></p>}
      {!data && !error && <p role="status">Loading projection records…</p>}
      {data?.restaurant && <p>{data.restaurant.name} · {zone || 'Timezone not configured'} · Stored business dates</p>}
      {router.isReady && typeof restaurant === 'string' && restaurant && (
        <WasteAssessmentSwitch key={restaurant} restaurantId={restaurant} adminFetch={adminFetch} refresh={refresh} />
      )}
      {data?.restaurants && <Table headings={['Restaurant', 'Status', 'Waste card', 'Latest job date / stage', 'Forecast / source through', 'Last complete', 'Backfill', 'Repairs']} rows={data.restaurants.map(r => [
        <Link href={href({ restaurant: r.id, view: 'service', date: r.last_complete_date || r.latest_run?.run_date || r.job?.business_date || '' })}>{r.name} · {r.timezone || 'Timezone not configured'}</Link>,
        `${r.state.label}${r.state.stale ? '; previous forecast stale' : ''}`,
        r.waste_card_enabled == null ? 'Unavailable' : r.waste_card_enabled ? 'On' : 'Off',
        `${cell(r.job?.business_date)} · ${cell(r.job?.stage)}`,
        `${cell(r.latest_run?.run_date)} / ${cell(r.latest_run?.source_through)}`,
        cell(r.last_complete_date), r.backfill?.backfill_complete ? 'Complete' : `${cell(r.backfill?.cursor_date)} · ${cell(r.backfill?.phase)}`,
        `${r.source_repairs} source · ${r.menu_repairs} menu · ${r.dirty_nights} queued nights`,
      ])} />}
      {view === 'service' && data?.observations && <>
        <Card title="Volume: archived forecasts versus actuals">
          <label>Model <select className="om-field" value={model} onChange={e => navigate({ model: e.target.value })}>
            {[...new Set([4, ...allVolumes.map(v => v.model_major)])].sort((a, b) => a - b).map(m => <option key={m} value={m}>Major {m}</option>)}
          </select></label>
          <p>Day-of is emphasized. Missing vintages remain “No forecast.” Percent errors use positive actuals only.</p>
          <Table headings={['Vintage', 'Forecast', 'Actual', 'Actual − forecast', 'Absolute error %', 'Original range', 'In range', 'Issued / revision']} rows={Array.from({ length: 8 }, (_, i) => {
            const v = volumes.find(row => row.days_ahead === i + 1);
            return [<button className={Number(lead) === i + 1 ? "om-pri" : "om-btn"} aria-pressed={Number(lead) === i + 1} onClick={() => navigate({ lead: String(i + 1) })}>{leadLabel(i + 1)}</button>,
              v ? n(v.expected) : 'No forecast', n(v?.actual), n(v?.difference), pct(v?.ape), v ? `${n(v.low)}–${n(v.high)}` : '—',
              v?.range_hit == null ? '—' : v.range_hit ? 'Yes' : 'No', v ? <>{runLink(v.run_id, issued(v.issued_at, zone))}<br />Source through {v.source_through}<br />{v.calibration_key}</> : '—'];
          })} />
        </Card>
        <Card title={`Dish shares: ${leadLabel(Number(lead))}`}>
          <p>Available-category actual volume × archived share ÷ total archived share of available categories. Original quantity ranges are shown separately.</p>
          <Table headings={['Dish / category', 'Adjusted expected', 'Actual', 'Difference', 'Expected share', 'Actual share', 'Share difference (pp)', 'Original expected / range', 'Scope / flags']} rows={dishes.slice(page * 50, page * 50 + 50).map(d => [
            `${name(d.dish_id)} · ${cell(d.category)}`, n(d.expected), n(d.actual), n(d.difference), pct(d.projected_share), pct(d.actual_share),
            Number.isFinite(d.actual_share) && Number.isFinite(d.projected_share) ? n((d.actual_share - d.projected_share) * 100) : '—',
            `${n(d.raw_expected)} / ${n(d.low)}–${n(d.high)}`,
            d.reason || `${n(d.scope_actual)} actual units; ${pct(d.scope_share)} archived share${d.recommended ? '; recommended' : ''}${d.sold_out ? '; sold out' : ''}`,
          ])} />
        </Card>
        <Card title="Actual-night flags">
          <pre style={{ whiteSpace: 'pre-wrap' }}>{data.actual_flags ? JSON.stringify(data.actual_flags, null, 2) : 'Actuals unavailable for this service date.'}</pre>
        </Card>
        <Card title="Earlier run revisions">
          <Table headings={['Run date', 'Issued', 'Model / calibration', 'Revision']} rows={data.revisions.map(r => [r.run_date, issued(r.issued_at, zone), `${r.model_major} / ${r.calibration_key}`,
            runLink(r.id, r.id === selectedVolume?.run_id ? 'Revision used' : 'Inspect revision')])} />
        </Card>
      </>}
      {view === 'accuracy' && data?.groups && <>
        <p>Dish MAPE pools eligible dish-night observations equally; dish WAPE uses total absolute unit error ÷ total actual dish units. Zero-actual observations are excluded from MAPE and retained for WAPE. Coverage evaluates original quantity ranges. Model, calibration and coverage targets stay separate.</p>
        {!weekly.length && <p>No archived forecasts in this window.</p>}
        <Table headings={['Week', 'Lead', 'Series / model / calibration', 'MAPE', 'Zero actual excluded', 'WAPE', 'MAE', 'Scored / excluded', 'Coverage / target / n', 'Partial scope']} rows={weekly.map(g => [
          g.week, leadLabel(g.days_ahead), `${g.kind} · ${g.model_major} · ${g.calibration_key}`, pct(g.mape), g.zero_actual,
          pct(g.wape), n(g.mae), `${g.scored} / ${g.excluded}`, `${pct(g.coverage)} / ${pct(g.coverage_target)} / ${g.coverage_count}`, g.partial_scope_count,
        ])} />
        <Card title="Per-dish accuracy across the selected window">
          <Table headings={['Dish', 'Lead / model / calibration', 'MAPE', 'Zero actual excluded', 'WAPE', 'Scored', 'Original range coverage']} rows={dishGroups.slice(page * 50, page * 50 + 50).map(g => [
            <button className="om-btn" onClick={() => navigate({ dish: g.dish })}>{name(g.dish)}</button>, `${leadLabel(g.days_ahead)} · ${g.model_major} · ${g.calibration_key}`,
            pct(g.mape), g.zero_actual, pct(g.wape), g.scored, `${pct(g.coverage)} (${g.coverage_count})`,
          ])} />
        </Card>
        <Card title="Step 9 bias: saved review at issuance">
          <p>These are the original archived bias diagnostics, with their original cutoff—not a newly calculated bias review.</p>
          {data.bias.map(b => <details key={b.run_id}><summary>{b.run_date} · model {b.model_major} · {b.calibration_key} · {issued(b.issued_at, zone)}</summary>
            {runLink(b.run_id, 'Inspect archived run')}<pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(b.nights, null, 2)}</pre>
          </details>)}
        </Card>
      </>}
      {view === 'run' && data?.run && <Card title={`Run ${data.run.id}`}>
        <p>Issued {issued(data.run.issued_at, zone)}. Source through {data.run.source_through}. Model {data.run.model_major}.</p>
        {data.run.supersedes_id && runLink(data.run.supersedes_id, 'Earlier revision')}
        <details><summary>Saved provenance, benchmark version, curve and volume explanations</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(data.run, null, 2)}</pre></details>
        {data.nights.map(night => <details key={night.target_date} open={date === night.target_date}><summary>{night.target_date} · {night.confidence}</summary>
          <Link href={href({ restaurant, view: 'run', run, date: night.target_date })}>Inspect this night</Link>
          {night.trace && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(night.trace, null, 2)}</pre>}
          {(night.dishes || []).map(d => <p key={d.dish_id}><Link href={href({ restaurant, view: 'run', run, date: night.target_date, dish: d.dish_id })}>{name(d.dish_id)}</Link> · {n(d.expected)} units · {d.confidence}</p>)}
          {night.selected_dish && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(night.selected_dish, null, 2)}</pre>}
        </details>)}
      </Card>}
      {rows.length > 50 && <div style={{ display: 'flex', gap: 10 }}>
        <button className="om-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
        <span>Page {page + 1} of {Math.ceil(rows.length / 50)}</span>
        <button className="om-btn" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>}
      {data && <p>Server read: {n(data.read_ms)} ms · {cell(data.snapshot_at)}</p>}
    </main>
  </AdminShell>;
}