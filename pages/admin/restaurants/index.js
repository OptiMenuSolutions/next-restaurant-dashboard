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

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" className="om-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, town, owner or email" aria-label="Search restaurants" style={{ maxWidth: 320, borderRadius: 18 }} />
        <Pills label="Filter by status" value={filter} onChange={setFilter}
          options={FILTERS.map((k) => ({ key: k, label: nice(k), n: k === 'ALL' ? all.length : all.filter((r) => r.status === k).length }))} />
      </div>

      <section aria-label="Restaurant list" style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1180 }}>
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