// pages/admin/revenue.js
// Revenue & billing: MRR, money collected, estimated profit, cancellations,
// founding seats, 12 months of collected revenue, failed payments, and every
// restaurant's plan with a link to its full billing page.
// The old MRR & Revenue page is at /admin/old/revenue.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import useIsPhone from '../../lib/admin/useIsPhone';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Card, th, td, money, shortDate } from '../../components/admin/ui';

const ST = {
  ACTIVE: ['var(--green-tint)', 'var(--green)'], TRIAL: ['var(--accent-tint)', 'var(--accent-deep)'],
  'PAYMENT FAILED': ['var(--red-tint)', 'var(--red)'], CANCELING: ['var(--amber-tint)', 'var(--amber)'],
  'NO CARD YET': ['var(--amber-tint)', 'var(--amber)'], CANCELED: ['var(--panel)', 'var(--muted)'], 'NO PLAN': ['var(--panel)', 'var(--muted)'],
};
const monthName = (m, style = 'short') => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: style }).format(new Date(m + '-15T12:00:00Z'));

// Billing by restaurant scrolls on its own, one screen tall at most.
const PANE_H = 'max(420px, calc(100vh - 320px))';
// The profit breakdown that shows when you hover or focus a restaurant row.
const TIP_CSS = `.om-prow:hover td{background:var(--panel)}
.om-ptip{display:none;position:absolute;z-index:5;right:calc(100% + 8px);top:4px;width:230px;background:var(--text);color:var(--shell);font:500 12px/1.6 Manrope,sans-serif;padding:10px 12px;border-radius:8px;text-align:left;box-shadow:var(--shadow-lg)}
.om-ptip b{display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;opacity:.7;margin-bottom:4px}
.om-pline{display:flex;justify-content:space-between;gap:12px}
.om-pline span:last-child{font-family:'IBM Plex Mono',monospace}
.om-ptotal{border-top:1px solid rgba(255,255,255,.25);margin-top:4px;padding-top:4px;font-weight:700}
.om-prow:hover .om-ptip,.om-prow:focus .om-ptip{display:block}`;

function RevenuePage() {
  const router = useRouter();
  const isPhone = useIsPhone();
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/business/revenue');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load revenue');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading revenue from Stripe…" />;

  const mName = monthName(data.month, 'long');
  const kpis = [
    { k: 'MONTHLY RECURRING', v: money(data.mrr), s: `${data.paying} paying in Stripe${data.trials ? ` · ${data.trials} on trial` : ''} · ${money(data.mrr * 12, 0)} a year${data.unlinked.n ? ` · ${data.payingLinked} linked to a restaurant` : ''}` },
    { k: `COLLECTED · ${mName.toUpperCase()}`, v: money(data.collectedThis), s: `${monthName(data.chart[10].month, 'long')}: ${money(data.collectedPrev)}` },
    { k: `PROFIT · ${mName.toUpperCase()}`, v: money(data.profit), s: 'Estimate, after AI, hosting, Stripe fees and one-off costs', tone: data.profit < 0 ? 'var(--red)' : 'var(--green)' },
    { k: 'CANCELLATIONS · 90 DAYS', v: String(data.cancels), s: data.topReason ? `Top reason: ${data.topReason}` : 'None' },
  ];

  return (
    <>
      <style>{TIP_CSS}</style>
      <PageHead kicker="BUSINESS" title="Revenue & billing">
        <a className="om-btn" href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">Open Stripe ↗</a>
      </PageHead>
      {data.stripeError && <div style={{ background: 'var(--red-tint)', color: 'var(--red)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>Stripe did not answer: {data.stripeError}. Plans and money below may be missing.</div>}
      {data.unlinked.n > 0 && (
        <div style={{ background: 'var(--amber-tint)', color: 'var(--amber)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>
          {data.unlinked.n} live Stripe subscription{data.unlinked.n === 1 ? '' : 's'} ({money(data.unlinked.amount)}/mo) {data.unlinked.n === 1 ? 'is' : 'are'} not linked to any restaurant. They count in MRR, as in Stripe, but not in Billing by restaurant.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {isPhone
          ? [
              { k: 'MRR', v: money(data.mrr), s: 'Monthly recurring revenue' },
              { k: 'LIVE SUBS', v: String(data.paying), s: 'Paying in Stripe' },
              { k: 'FOUNDING SEATS', v: `${data.seatsUsed} / ${data.seats ?? '—'}`, s: 'Claimed' },
              { k: 'FAILED', v: String(data.failed.length), s: 'Open failed payments', tone: data.failed.length ? 'var(--red)' : 'var(--text)' },
            ].map((x) => (
              <div key={x.k} style={{ minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, padding: 11 }}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)' }}>{x.k}</div>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4, color: x.tone || 'var(--text)', overflowWrap: 'anywhere' }}>{x.v}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{x.s}</div>
              </div>
            ))
          : kpis.map((x) => (
              <div key={x.k} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>{x.k}</div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4, color: x.tone || 'var(--text)' }}>{x.v}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{x.s}</div>
              </div>
            ))}
      </div>

      <section aria-label="Founding members" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 18px' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>FOUNDING MEMBERS</div>
          <div style={{ fontSize: 15 }}><b style={{ fontSize: 22 }}>{data.seatsUsed}</b> of {data.seats ?? '[N]'} founding seats claimed</div>
        </div>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>FOUNDING PRICE</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{data.foundingPrice != null ? `${money(Number(data.foundingPrice))} / month` : 'Not set'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Locked for as long as they stay</div>
        </div>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>REGULAR PRICE</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{data.regularPrice != null ? `${money(Number(data.regularPrice))} / month` : 'Not set'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Starts after the last founding seat</div>
        </div>
        <div style={{ flex: '1 1 240px', fontSize: 12.5, color: 'var(--muted)' }}>
          Every plan: {data.tagsPerPlan} NFC tags, unlimited invoice uploads and menu re-launches, free scanner logins. No setup fee.{' '}
          <Link href="/admin/settings" style={{ color: 'var(--accent-deep)' }}>Change in Settings</Link>
        </div>
      </section>

      <div style={isPhone
        ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 18, alignItems: 'start' }
        : { display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <Card title="Money collected by month" style={isPhone ? { minWidth: 0 } : { flex: '2 1 480px' }}>
          <MonthBars chart={data.chart} />
        </Card>
        <Card title={`Failed payments (${data.failed.length})`} style={isPhone ? { minWidth: 0 } : { flex: '1 1 300px' }}>
          {data.failed.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>None. Every open invoice is paid.</div>}
          {data.failed.map((f) => (
            <div key={f.id} style={isPhone
              ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 10px', padding: '10px 0', borderTop: '1px solid var(--line-soft)' }
              : { display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ minWidth: 0, gridColumn: isPhone ? '1 / 2' : undefined }}>
                {f.restaurant_id
                  ? <Link href={`/admin/billing/${f.restaurant_id}`} style={{ color: 'var(--text)', fontWeight: 700, overflowWrap: 'anywhere' }}>{f.name}</Link>
                  : <b style={{ color: 'var(--muted)' }}>Not matched to a restaurant</b>}
                {(f.owner || f.email) && (
                  isPhone
                    ? <span style={{ display: 'block', fontSize: 12.5, overflowWrap: 'anywhere' }}>{f.owner}{f.owner && f.email ? ' · ' : ''}{f.email}</span>
                    : <span style={{ display: 'block', fontSize: 12.5 }}>{[f.owner, f.email].filter(Boolean).join(' · ')}</span>
                )}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{f.attempts} attempt{f.attempts === 1 ? '' : 's'}{f.retry ? ` · next retry ${shortDate(f.retry)}` : ' · no more retries'}</span>
              </span>
              <span style={{ gridColumn: isPhone ? '2 / 3' : undefined, gridRow: isPhone ? '1 / 2' : undefined, fontFamily: MONO, color: 'var(--red)' }}>{money(f.amount)}</span>
            </div>
          ))}
        </Card>
      </div>

      <Card title="Billing by restaurant" right={!isPhone && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Click a restaurant to open its full billing page</span>}>
        <div style={{ display: isPhone ? 'none' : undefined, overflow: 'auto', maxHeight: PANE_H, border: '1px solid var(--line-soft)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}><tr><th style={th}>RESTAURANT</th><th style={th}>PLAN</th><th style={th}>STATE</th><th style={th}>NEXT CHARGE</th><th style={th}>CARD</th><th style={{ ...th, textAlign: 'right' }}>PROFIT / MO</th><th style={th} /></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={7} style={{ ...td, color: 'var(--muted)' }}>No restaurants yet.</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.id} className="om-prow" tabIndex={0} onClick={() => router.push(`/admin/billing/${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/admin/billing/${r.id}`); }} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{r.plan}</td>
                  <td style={td}><Chip bg={ST[r.state][0]} fg={ST[r.state][1]}>{r.state}</Chip>{r.ends && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--amber)', marginTop: 3 }}>Ends {shortDate(r.ends)}</span>}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{r.next ? shortDate(r.next) : '—'}</td>
                  <td style={{ ...td, fontSize: 12.5, color: r.card ? 'var(--text)' : 'var(--muted)' }}>{r.card || 'None on file'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, color: r.profit < 0 ? 'var(--red)' : 'var(--green)', position: 'relative' }}>
                    {money(r.profit)}
                    <span className="om-ptip" role="tooltip">
                      <b>{r.name.toUpperCase()} · {mName.toUpperCase()}</b>
                      {[['Pays you', r.pays], ['AI', -r.ai], ['Hosting share', -r.host], ['Stripe fee', -r.fee], ['One-off costs', -r.other]].map(([k, v]) => (
                        <span key={k} className="om-pline"><span>{k}</span><span>{money(v)}</span></span>
                      ))}
                      <span className="om-pline om-ptotal"><span>Profit</span><span>{money(r.profit)}</span></span>
                    </span>
                  </td>
                  <td style={{ ...td, color: 'var(--muted)' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isPhone && (
          <div>
            {data.rows.length === 0 && <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>No restaurants yet.</div>}
            {data.rows.map((r) => (
              <div key={r.id} style={{ minWidth: 0, padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Link href={`/admin/billing/${r.id}`} style={{ minWidth: 0, color: 'var(--text)', fontWeight: 800, overflowWrap: 'anywhere' }}>{r.name}</Link>
                  <strong style={{ flexShrink: 0, fontFamily: MONO, color: r.profit < 0 ? 'var(--red)' : 'var(--green)' }}>{money(r.profit)}</strong>
                </div>
                <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                  Pays {money(r.pays)} − AI {money(r.ai)} − Hosting {money(r.host)} − Stripe {money(r.fee)} − One-off {money(r.other)}
                </div>
                <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                  {r.plan} · {r.state}{r.next ? ` · Next charge ${shortDate(r.next)}` : ''} · {r.card || 'No card on file'}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
              Profit is an estimate for {mName}; hosting is shared across {data.liveN} live restaurants.
            </div>
          </div>
        )}
        {!isPhone && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Profit is an estimate for {mName}: what they pay, minus their AI spend, their share of hosting ({money(data.hosting)} ÷ {data.liveN} live), Stripe’s fee (2.9% + 30¢) and one-off costs logged for them this month. Hover a row for the breakdown.
          </div>
        )}
      </Card>
    </>
  );
}

function MonthBars({ chart }) {
  const isPhone = useIsPhone();
  const [hover, setHover] = useState(null);
  const max = Math.max(...chart.map((c) => c.amount), 1);
  if (!chart.some((c) => c.amount > 0)) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '20px 0' }}>Fills in with your first paying restaurant.</div>;
  const W = 640, H = 170, L = 50, R = 6, T = 14, B = 22;
  const slot = (W - L - R) / chart.length;
  const bw = Math.min(30, slot - 6);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Money collected, last 12 months: ${chart.map((c) => `${monthName(c.month)} ${money(c.amount, 0)}`).join(', ')}`} onMouseLeave={() => { if (!isPhone) setHover(null); }}>
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
          <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">{money(v, 0)}</text>
        </g>
      ))}
      {chart.map((c, i) => {
        const x = L + slot * i + (slot - bw) / 2;
        const h = y(0) - y(c.amount);
        const last = i === chart.length - 1;
        return (
          <g key={c.month} onMouseEnter={() => { if (!isPhone) setHover(i); }} onClick={() => { if (isPhone) setHover(i); }}>
            <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" />
            {c.amount > 0 && <rect x={x} y={y(c.amount)} width={bw} height={h} rx={Math.min(4, bw / 2)} fill="var(--accent-deep)" opacity={hover == null || hover === i ? 1 : 0.55} />}
            {(hover === i || (hover == null && last)) && c.amount > 0 && <text x={x + bw / 2} y={y(c.amount) - 4} textAnchor="middle" fontSize="10.5" fontFamily="IBM Plex Mono, monospace" fill="var(--text)">{money(c.amount, 0)}</text>}
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill={last ? 'var(--text)' : 'var(--muted)'}>{monthName(c.month).toUpperCase()}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Page() {
  return (
    <AdminShell section="Business" sub="Revenue & billing" title="Revenue & billing">
      <RevenuePage />
    </AdminShell>
  );
}