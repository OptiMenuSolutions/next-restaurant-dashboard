// pages/admin/revenue.js
// Revenue & billing: MRR, money collected, estimated profit, cancellations,
// founding seats, 12 months of collected revenue, failed payments, and every
// restaurant's plan with a link to its full billing page.
// The old MRR & Revenue page is at /admin/old/revenue.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Card, th, td, money, shortDate } from '../../components/admin/ui';

const ST = {
  ACTIVE: ['var(--green-tint)', 'var(--green)'], TRIAL: ['var(--accent-tint)', 'var(--accent-deep)'],
  'PAYMENT FAILED': ['var(--red-tint)', 'var(--red)'], CANCELING: ['var(--amber-tint)', 'var(--amber)'],
  'NO CARD YET': ['var(--amber-tint)', 'var(--amber)'], CANCELED: ['var(--panel)', 'var(--muted)'], 'NO PLAN': ['var(--panel)', 'var(--muted)'],
};
const monthName = (m, style = 'short') => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: style }).format(new Date(m + '-15T12:00:00Z'));

function RevenuePage() {
  const router = useRouter();
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
    { k: 'MONTHLY RECURRING', v: money(data.mrr), s: `${data.paying} paying${data.trials ? ` · ${data.trials} on trial` : ''} · ${money(data.mrr * 12, 0)} a year` },
    { k: `COLLECTED · ${mName.toUpperCase()}`, v: money(data.collectedThis), s: `${monthName(data.chart[10].month, 'long')}: ${money(data.collectedPrev)}` },
    { k: `PROFIT · ${mName.toUpperCase()}`, v: money(data.profit), s: 'Estimate, after AI, hosting, Stripe fees and one-off costs', tone: data.profit < 0 ? 'var(--red)' : 'var(--green)' },
    { k: 'CANCELLATIONS · 90 DAYS', v: String(data.cancels), s: data.topReason ? `Top reason: ${data.topReason}` : 'None' },
  ];

  return (
    <>
      <PageHead kicker="BUSINESS" title="Revenue & billing">
        <a className="om-btn" href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">Open Stripe ↗</a>
      </PageHead>
      {data.stripeError && <div style={{ background: 'var(--red-tint)', color: 'var(--red)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>Stripe did not answer: {data.stripeError}. Plans and money below may be missing.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {kpis.map((x) => (
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <Card title="Money collected by month" style={{ flex: '2 1 480px' }}>
          <MonthBars chart={data.chart} />
        </Card>
        <Card title={`Failed payments (${data.failed.length})`} style={{ flex: '1 1 300px' }}>
          {data.failed.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>None. Every open invoice is paid.</div>}
          {data.failed.map((f) => (
            <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {f.restaurant_id ? <Link href={`/admin/billing/${f.restaurant_id}`} style={{ color: 'var(--text)', fontWeight: 700 }}>{f.name}</Link> : <b>{f.name}</b>}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{f.attempts} attempt{f.attempts === 1 ? '' : 's'}{f.retry ? ` · next retry ${shortDate(f.retry)}` : ' · no more retries'}</span>
              </span>
              <span style={{ fontFamily: MONO, color: 'var(--red)' }}>{money(f.amount)}</span>
            </div>
          ))}
        </Card>
      </div>

      <Card title="Billing by restaurant" right={<span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Click a restaurant to open its full billing page</span>}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
            <thead><tr><th style={th}>RESTAURANT</th><th style={th}>PLAN</th><th style={th}>STATE</th><th style={th}>NEXT CHARGE</th><th style={th}>CARD</th><th style={{ ...th, textAlign: 'right' }}>PROFIT / MO</th><th style={th} /></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={7} style={{ ...td, color: 'var(--muted)' }}>No restaurants yet.</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.id} tabIndex={0} onClick={() => router.push(`/admin/billing/${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/admin/billing/${r.id}`); }} style={{ cursor: 'pointer' }}
                  title={`Pays ${money(r.pays)} · AI ${money(r.ai)} · hosting ${money(r.host)} · Stripe ${money(r.fee)} · one-offs ${money(r.other)}`}>
                  <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{r.plan}</td>
                  <td style={td}><Chip bg={ST[r.state][0]} fg={ST[r.state][1]}>{r.state}</Chip>{r.ends && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--amber)', marginTop: 3 }}>Ends {shortDate(r.ends)}</span>}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{r.next ? shortDate(r.next) : '—'}</td>
                  <td style={{ ...td, fontSize: 12.5, color: r.card ? 'var(--text)' : 'var(--muted)' }}>{r.card || 'None on file'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, color: r.profit < 0 ? 'var(--red)' : 'var(--green)' }}>{money(r.profit)}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Profit is an estimate for {mName}: what they pay, minus their AI spend, their share of hosting ({money(data.hosting)} ÷ {data.liveN} live), Stripe’s fee (2.9% + 30¢) and one-off costs logged for them this month. Hover a row for the breakdown.
        </div>
      </Card>
    </>
  );
}

function MonthBars({ chart }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...chart.map((c) => c.amount), 1);
  if (!chart.some((c) => c.amount > 0)) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '20px 0' }}>Fills in with your first paying restaurant.</div>;
  const W = 640, H = 170, L = 50, R = 6, T = 14, B = 22;
  const slot = (W - L - R) / chart.length;
  const bw = Math.min(30, slot - 6);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Money collected, last 12 months: ${chart.map((c) => `${monthName(c.month)} ${money(c.amount, 0)}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
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
          <g key={c.month} onMouseEnter={() => setHover(i)}>
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