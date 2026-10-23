// pages/admin/restaurants/index.js
// Restaurants: every account with its health dot, status, setup progress,
// POS, last invoice, last Tonight's Dish, staff page views and last month's
// sales from its own POS. Click a name for the restaurant page, which says
// why the dot is that color.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead } from '../../../components/admin/AdminShell';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';
import { MONO, ErrorState } from '../../../components/client/ClientChrome';
import useIsPhone from '../../../lib/admin/useIsPhone';
import { Dot, StatusChip, Pills, th, td, money, shortDate, HEALTH_WORD } from '../../../components/admin/ui';

const STEP_NAMES = ['Menu parsed', 'First invoice', 'POS connected', 'Tags placed', 'Scanner added'];
const FILTERS = ['ALL', 'LIVE', 'SETTING UP', 'NEEDS HELP', 'DEMO', 'CLOSED'];
const nice = (k) => (k === 'ALL' ? 'All' : k.charAt(0) + k.slice(1).toLowerCase());

function posText(c) {
  if (!c) return 'Not connected';
  const p = c.provider ? c.provider.charAt(0).toUpperCase() + c.provider.slice(1) : 'POS';
  if (c.status === 'connected') return `${p} · connected`;
  if (c.status === 'error') return `${p} · sync failed`;
  return `${p} · ${c.status || 'unknown'}`;
}
function planText(s) {
  if (!s) return 'No plan';
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function RestaurantsPage() {
  const { adminFetch } = useAdminFetch();
  const isPhone = useIsPhone();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/restaurant-list');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load restaurants');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  const all = data?.restaurants || [];
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((r) => (filter === 'ALL' || r.status === filter) &&
      (!term || [r.name, r.town, r.owner?.name, r.owner?.email].some((x) => String(x || '').toLowerCase().includes(term))));
  }, [all, filter, q]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHead kicker="CUSTOMERS" title="Restaurants" />

      <div style={{ display: 'flex', gap: 10, flexDirection: isPhone ? 'column' : 'row', flexWrap: isPhone ? 'nowrap' : 'wrap', alignItems: isPhone ? 'stretch' : 'center' }}>
        <input type="search" className="om-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, town, owner or email" aria-label="Search restaurants"
          style={{ width: isPhone ? '100%' : undefined, maxWidth: isPhone ? 'none' : 320, borderRadius: 18 }} />
        {isPhone ? (
          <div role="group" aria-label="Filter by status" style={{ display: 'flex', gap: 6, overflowX: 'auto', flexWrap: 'nowrap' }}>
            {FILTERS.map((k) => {
              const on = filter === k;
              const count = k === 'ALL' ? all.length : all.filter((r) => r.status === k).length;
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setFilter(k)}
                  style={{ minHeight: 40, padding: '0 13px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap', font: "600 12.5px 'Manrope', sans-serif", border: `1px solid ${on ? 'var(--text)' : 'var(--line)'}`, background: on ? 'var(--text)' : 'var(--shell)', color: on ? 'var(--shell)' : 'var(--text)' }}>
                  {nice(k)} <span style={{ fontFamily: MONO, fontSize: 11, opacity: 0.7 }}>{count}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <Pills label="Filter by status" value={filter} onChange={setFilter}
            options={FILTERS.map((k) => ({ key: k, label: nice(k), n: k === 'ALL' ? all.length : all.filter((r) => r.status === k).length }))} />
        )}
      </div>

      <section aria-label="Restaurant list" style={{ border: isPhone ? 0 : '1px solid var(--line)', borderRadius: isPhone ? 0 : 12, overflowX: isPhone ? 'visible' : 'auto' }}>
        <table style={{ display: isPhone ? 'none' : 'table', width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1180 }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...th, paddingLeft: 18, width: 250 }}>RESTAURANT</th>
              <th scope="col" style={th}>STATUS</th>
              <th scope="col" style={th}>SETUP</th>
              <th scope="col" style={th}>POS</th>
              <th scope="col" style={th}>LAST INVOICE</th>
              <th scope="col" style={{ ...th, width: 200 }}>LAST TONIGHT’S DISH</th>
              <th scope="col" style={th}>STAFF PAGE VIEWS</th>
              <th scope="col" style={th}>PLAN</th>
              <th scope="col" style={{ ...th, paddingRight: 18, textAlign: 'right' }}>THEIR SALES · {data?.salesMonth || ''}</th>
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr><td colSpan={9} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Loading…</td></tr>
            )}
            {data && rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>No restaurants match.</td></tr>
            )}
            {rows.map((r) => {
              const week = r.views.reduce((a, b) => a + b, 0);
              const peak = Math.max(1, ...r.views);
              return (
                <tr key={r.id} className="om-row">
                  <td style={{ ...td, paddingLeft: 18 }}>
                    <Link href={`/admin/restaurants/${r.id}`} title={`Health: ${HEALTH_WORD[r.health.level].toLowerCase()}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: 'var(--text)', fontSize: 13.5 }}>
                      <Dot level={r.health.level} />{r.name}
                    </Link>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2, paddingLeft: 17 }}>
                      {[r.town, r.owner?.name].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </td>
                  <td style={td}><StatusChip status={r.status} /></td>
                  <td style={td}>
                    <div aria-label={`${r.setupDone} of 5 setup steps done`} style={{ display: 'flex', gap: 3 }}>
                      {r.setup.map((ok, i) => <span key={i} title={STEP_NAMES[i]} style={{ width: 16, height: 6, borderRadius: 2, background: ok ? 'var(--accent)' : 'var(--line)' }} />)}
                    </div>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                      {r.setupDone === 5 ? 'Fully set up' : `${r.setupDone} of 5 · next: ${r.nextStep}`}
                    </span>
                  </td>
                  <td style={{ ...td, color: r.conn?.status === 'error' ? 'var(--red)' : 'var(--muted)' }}>{posText(r.conn)}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>
                    {shortDate(r.lastInvoice)}
                    {r.unreviewedCount > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--accent-deep)' }}>{r.unreviewedCount} to check</span>}
                  </td>
                  <td style={td}>
                    <span title={r.lastDish?.title} style={{ display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.lastDish ? r.lastDish.title : 'Not running yet'}
                    </span>
                    {r.lastDish && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{shortDate(r.lastDish.date)}</span>}
                  </td>
                  <td style={td}>
                    {r.tags.length ? (
                      <>
                        <div aria-label={`${r.views[6]} views yesterday, ${week} in 7 days`} style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22 }}>
                          {r.views.map((n, i) => <span key={i} style={{ width: 6, borderRadius: 1, height: Math.max(2, (n / peak) * 22), background: i === 6 ? 'var(--accent)' : 'var(--line)' }} />)}
                          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, marginLeft: 6 }}>{r.views[6]}</span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>yesterday · {week} this week</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>No tags yet</span>
                    )}
                  </td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{planText(r.subscription_status)}</td>
                  <td style={{ ...td, paddingRight: 18, textAlign: 'right' }}>
                    <span style={{ fontFamily: MONO, fontWeight: 600 }}>{r.sales.rows ? money(r.sales.total, 0) : '—'}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{r.sales.rows ? `${Math.round(r.sales.items).toLocaleString()} items sold` : r.conn ? 'No sales last month' : 'No POS connected'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isPhone && (
          <div style={{ display: 'grid', gap: 10, padding: 2 }}>
            {!data && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>}
            {data && rows.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No restaurants match.</div>}
            {rows.map((r) => (
              <Link key={r.id} href={`/admin/restaurants/${r.id}`} title={`Health: ${HEALTH_WORD[r.health.level].toLowerCase()}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--shell)', color: 'var(--text)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Dot level={r.health.level} />
                  <b style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{r.name}</b>
                  <StatusChip status={r.status} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {[r.town, r.owner?.name].filter(Boolean).join(' · ') || '—'}
                </div>
                <div>
                  <div aria-label={`${r.setupDone} of 5 setup steps done`} style={{ display: 'flex', gap: 4 }}>
                    {r.setup.map((ok, i) => <span key={i} title={STEP_NAMES[i]} style={{ flex: 1, height: 6, borderRadius: 3, background: ok ? 'var(--accent)' : 'var(--line)' }} />)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--muted)' }}>
                    {r.setupDone === 5 ? 'Fully set up' : `${r.setupDone} of 5 · next: ${r.nextStep}`}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {[
                    ['POS', posText(r.conn)],
                    ['LAST INVOICE', shortDate(r.lastInvoice)],
                    ['LAST DISH', r.lastDish?.title || '—'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--muted)' }}>{label}</div>
                      <div style={{ marginTop: 3, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
        Setup bars, in order: menu parsed · first invoice · POS connected · tags placed · scanner added. Staff page views count every tag tap. Their sales come from the restaurant’s POS for last month. Open a restaurant to see why its dot is that color.
      </p>
    </>
  );
}

export default function Page() {
  return (
    <AdminShell section="Restaurants" sub="All restaurants" title="Restaurants">
      <RestaurantsPage />
    </AdminShell>
  );
}