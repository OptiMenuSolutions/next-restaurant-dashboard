// pages/admin/ai.js
// AI & parsing: what the readers and Tonight's Dish cost, per day, per job
// and per restaurant (next to what each one pays you), and how often you
// have to fix invoice lines. The old AI Usage page is at /admin/old/ai.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Card, th, td, money, shortDate } from '../../components/admin/ui';

const NAMES = {
  invoice_parse: 'Invoice reading', invoice_sanity: 'Invoice double-check', invoice_match: 'Invoice line matching',
  menu_import: 'Menu reading', dish_recs: 'Tonight’s Dish', profit_score: 'Profit score',
};
const cents = (n) => (n == null ? '—' : n < 0.1 && n > 0 ? `$${n.toFixed(3)}` : money(n));
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const monthLabel = (m) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(m + '-15T12:00:00Z'));
const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };

function AiPage() {
  const { adminFetch } = useAdminFetch();
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch(`/api/admin/platform/ai${month ? `?month=${month}` : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load AI spend');
      setData(json);
      setLimit(String(json.limit));
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch, month]);
  useEffect(() => { load(); }, [load]);

  const saveLimit = async () => {
    setFlash('');
    const res = await adminFetch('/api/admin/platform/ai', { method: 'POST', body: JSON.stringify({ action: 'limit', value: limit }) });
    const json = await res.json();
    setFlash(res.ok ? 'Daily line saved.' : json.error || 'Could not save');
    if (res.ok) load();
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading AI spend…" />;

  const m = data.month;
  const a = data.accuracy;
  const change = data.prevSpend > 0 ? (data.spend - data.prevSpend) / data.prevSpend : null;
  const jobsTotal = data.jobs.reduce((s, j) => s + j.total, 0);

  return (
    <>
      <PageHead kicker="PLATFORM" title="AI & parsing" sub="What the invoice and menu readers and Tonight’s Dish cost, who it is spent on, and how often you fix the readers.">
        <button type="button" className="om-btn" aria-label="Previous month" onClick={() => { setData(null); setMonth(shift(m, -1)); }}>←</button>
        <span style={{ alignSelf: 'center', fontWeight: 700, minWidth: 130, textAlign: 'center' }}>{monthLabel(m)}</span>
        <button type="button" className="om-btn" aria-label="Next month" disabled={data.isThisMonth} onClick={() => { setData(null); setMonth(shift(m, 1)); }}>→</button>
      </PageHead>
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <Tile k={`SPEND · ${monthLabel(m).toUpperCase()}`} v={money(data.spend)} s={change == null ? `${data.calls} calls` : `${data.calls} calls · ${change >= 0 ? '+' : ''}${Math.round(change * 100)}% vs last month`} />
        <Tile k="SPEND · TODAY" v={data.isThisMonth ? money(data.todaySpend) : '—'} s={`Daily line ${money(data.limit)}${data.daysOver ? ` · crossed on ${data.daysOver} day${data.daysOver === 1 ? '' : 's'}` : ''}`} />
        <Tile k="PARSE ACCURACY" v={pct(a.clean, a.lines)} s={`Invoice lines you did not change, of ${a.lines} reviewed in the last 90 days`} />
        <Tile k="PER RESTAURANT" v={data.restaurants.length ? money(data.spend / data.restaurants.length) : '—'} s={`Average AI spend across ${data.restaurants.length} restaurant${data.restaurants.length === 1 ? '' : 's'} this month`} />
      </div>

      <Card title={`Spend per day · ${monthLabel(m)}`} right={
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          Daily line $<input className="om-field" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 70, minHeight: 30 }} />
          <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={Number(limit) === data.limit} onClick={saveLimit}>Save</button>
        </label>
      }>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Hover a bar for that day’s calls. The dashed line is your daily line; days over it are marked.</div>
        <DayBars days={data.days} limit={data.limit} />
      </Card>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <Card title="By job" style={{ flex: '1 1 420px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={th}>JOB</th><th style={{ ...th, textAlign: 'right' }}>RUNS</th><th style={{ ...th, textAlign: 'right' }}>EACH</th><th style={{ ...th, textAlign: 'right' }}>TOTAL</th></tr></thead>
            <tbody>
              {data.jobs.length === 0 && <tr><td colSpan={4} style={{ ...td, color: 'var(--muted)' }}>No AI calls this month.</td></tr>}
              {data.jobs.map((j) => (
                <tr key={j.key}>
                  <td style={td}><b>{j.name}</b><span style={{ display: 'block', fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{j.models.join(', ') || '—'}</span></td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{j.runs}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{cents(j.each)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(j.total)}</td>
                </tr>
              ))}
              {data.jobs.length > 0 && <tr><td style={{ ...td, fontWeight: 800 }}>Total</td><td style={td} /><td style={td} /><td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontWeight: 800 }}>{money(jobsTotal)}</td></tr>}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Claude only. Mistral (the text reader for photos and PDFs) is not logged yet, so its cost is not in these numbers.</div>
        </Card>

        <Card title="What you fix most" style={{ flex: '1 1 340px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>{a.lines ? `Of ${a.lines} invoice lines on invoices you reviewed in the last 90 days.` : 'No reviewed invoices in the last 90 days yet.'}</div>
          {[['Price changed', a.price], ['Quantity changed', a.qty], ['Left without an ingredient link', a.unlinked]].map(([label, n]) => (
            <div key={label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{label}</span><span style={{ fontFamily: MONO }}>{n} · {pct(n, a.lines)}</span></div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--panel)', marginTop: 4 }}>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--accent-deep)', width: a.lines ? `${Math.min(100, (n / a.lines) * 100)}%` : 0 }} />
              </div>
            </div>
          ))}
          <Link href="/admin/review" style={{ fontSize: 12.5, color: 'var(--accent-deep)' }}>Open the review queue</Link>
        </Card>
      </div>

      <Card title={`Spend by restaurant · ${monthLabel(m)}`}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>What each restaurant costs you in AI, next to what they pay you.</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead><tr>
              <th style={th}>RESTAURANT</th><th style={{ ...th, textAlign: 'right' }}>INVOICES</th><th style={{ ...th, textAlign: 'right' }}>MENU CALLS</th><th style={{ ...th, textAlign: 'right' }}>DISH RUNS</th>
              <th style={{ ...th, textAlign: 'right' }}>AI SPEND</th><th style={{ ...th, textAlign: 'right' }}>PAYS YOU / MO</th><th style={{ ...th, textAlign: 'right' }}>AI AS % OF PLAN</th>
            </tr></thead>
            <tbody>
              {data.restaurants.length === 0 && <tr><td colSpan={7} style={{ ...td, color: 'var(--muted)' }}>No restaurant spend this month.</td></tr>}
              {data.restaurants.map((r) => (
                <tr key={r.id}>
                  <td style={td}><Link href={`/admin/restaurants/${r.id}`} style={{ color: 'var(--text)', fontWeight: 700 }}>{r.name}</Link></td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{r.invoices}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{r.menuCalls}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{r.dishRuns}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(r.spend)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{r.pays == null ? <span style={{ color: 'var(--muted)' }}>Not paying</span> : money(r.pays)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, color: r.pct > 0.2 ? 'var(--red)' : r.pct > 0.1 ? 'var(--amber)' : 'var(--text)' }}>{r.pct == null ? '—' : `${(r.pct * 100).toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Tile({ k, v, s }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>{k}</div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4 }}>{v}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s}</div>
    </div>
  );
}

function DayBars({ days, limit }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  if (!days.length) return <div style={{ fontSize: 13, color: 'var(--muted)' }}>No days yet.</div>;
  const W = 760, H = 170, L = 44, R = 8, T = 10, B = 22;
  const max = Math.max(limit * 1.15, ...days.map((d) => d.spend), 0.01);
  const n = days.length;
  const slot = (W - L - R) / n;
  const bw = Math.max(3, Math.min(22, slot - 2));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const d = hover != null ? days[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Spend per day. ${days.filter((x) => x.spend > limit).length} days over the ${money(limit)} line.`} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">{money(v)}</text>
          </g>
        ))}
        {days.map((x, i) => {
          const h = Math.max(0, y(0) - y(x.spend));
          const over = x.spend > limit;
          const cx = L + slot * i + (slot - bw) / 2;
          return (
            <g key={x.date} onMouseEnter={() => setHover(i)}>
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" />
              {h > 0 && <rect x={cx} y={y(x.spend)} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={over ? 'var(--amber)' : 'var(--accent-deep)'} opacity={hover == null || hover === i ? 1 : 0.55} />}
              {over && <text x={cx + bw / 2} y={y(x.spend) - 4} textAnchor="middle" fontSize="10" fill="var(--amber)">!</text>}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(limit)} y2={y(limit)} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x={W - R} y={y(limit) - 4} textAnchor="end" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">{money(limit)} LINE</text>
        <text x={L} y={H - 6} fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">{shortDate(days[0].date).toUpperCase()}</text>
        <text x={W - R} y={H - 6} textAnchor="end" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">{shortDate(days[n - 1].date).toUpperCase()}</text>
      </svg>
      {d && (
        <div style={{ position: 'absolute', top: 0, left: `${Math.min(72, Math.max(0, ((L + slot * hover) / W) * 100 - 12))}%`, pointerEvents: 'none', background: 'var(--text)', color: 'var(--shell)', borderRadius: 8, padding: '8px 10px', fontSize: 12, minWidth: 170, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ fontFamily: MONO, fontSize: 10, opacity: 0.75 }}>{shortDate(d.date).toUpperCase()}</div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{money(d.spend)}{d.spend > limit ? ' · over the line' : ''}</div>
          <div style={{ opacity: 0.8 }}>{d.calls} call{d.calls === 1 ? '' : 's'}</div>
          {Object.entries(d.by).sort((p, q) => q[1] - p[1]).map(([f, c]) => <div key={f} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>{NAMES[f] || f}</span><span style={{ fontFamily: MONO }}>{c}</span></div>)}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <AdminShell section="Platform" sub="AI & parsing" title="AI & parsing">
      <AiPage />
    </AdminShell>
  );
}