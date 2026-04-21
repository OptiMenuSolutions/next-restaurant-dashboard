// pages/admin/revenue.js
// MRR & Revenue page — real Stripe data.

import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { usePagination, Pagination } from '../../lib/admin/usePagination';

const PAGE_SIZE = 12;

function timeAgo(unix) {
  if (!unix) return '—';
  const diff = Date.now() - unix * 1000;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatDate(unix) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusStyle(status) {
  const map = {
    active:   { bg: 'rgba(61,232,160,0.1)',  border: 'rgba(61,232,160,0.25)',  text: '#3de8a0' },
    trialing: { bg: 'rgba(2,164,186,0.1)',   border: 'rgba(2,164,186,0.25)',  text: '#02a4ba' },
    past_due: { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
    canceled: { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
  };
  const c = map[status] || { bg: 'rgba(255,255,255,0.04)', border: '#1e2028', text: '#5a6080' };
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'capitalize', letterSpacing: '0.3px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function MrrChart({ data }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, paddingTop: 20 }}>
      {data.map((d, i) => {
        const isLatest = i === data.length - 1;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
            <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
              {d.value > 0 && (
                <div style={{
                  fontSize: 7, color: isLatest ? '#02a4ba' : '#3a3e50',
                  fontFamily: "'DM Mono', monospace", marginBottom: 2, whiteSpace: 'nowrap',
                }}>
                  ${d.value.toLocaleString()}
                </div>
              )}
              <div style={{
                width: '100%',
                borderRadius: '3px 3px 0 0',
                background: isLatest ? '#02a4ba' : `rgba(2,164,186,${0.2 + (i / data.length) * 0.65})`,
                height: d.value > 0 ? `${(d.value / max) * 100}%` : '2px',
                minHeight: 2,
                transition: 'height 0.6s',
              }} />
            </div>
            <span style={{ fontSize: 8, color: '#3a3e50' }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Card({ title, children, style }) {
  return (
    <div style={{ background: '#111318', border: '1px solid #1e2028', borderRadius: 8, overflow: 'hidden', ...style }}>
      {title && (
        <div style={{ fontSize: 9, fontWeight: 700, color: '#5a6080', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '14px 14px 0', marginBottom: 12 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export default function RevenuePage() {
  const { adminFetch } = useAdminFetch();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [subSearch, setSubSearch] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res  = await adminFetch('/api/admin/revenue');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const d = data || {};
  const momColor = d.momChange > 0 ? '#3de8a0' : d.momChange < 0 ? '#e85454' : '#5a6080';
  const momSign  = d.momChange > 0 ? '+' : '';

  const filteredSubs = (d.subscriptions || []).filter(sub => {
    const q = subSearch.toLowerCase();
    return !q || (sub.customer_email || '').toLowerCase().includes(q) || (sub.customer_name || '').toLowerCase().includes(q);
  });

  const subPag    = usePagination(filteredSubs, PAGE_SIZE);
  const chargePag = usePagination(d.recentCharges || [], PAGE_SIZE);

  if (loading) return (
    <AdminLayout title="Revenue">
      <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
    </AdminLayout>
  );

  return (
    <AdminLayout title="MRR & Revenue">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>MRR & Revenue</h1>
          <p style={s.subtitle}>Live Stripe data · updates on refresh</p>
        </div>

        {/* ── KPI Row ── */}
        <div style={s.kpiGrid}>
          <Card style={{ padding: 0 }}>
            <div style={{ padding: '14px' }}>
              <div style={s.kpiLabel}>Monthly Recurring Revenue</div>
              <div style={{ ...s.kpiValue, color: '#02a4ba' }}>${(d.mrr || 0).toLocaleString()}</div>
              {d.momChange != null && (
                <div style={{ fontSize: 9, color: momColor, marginTop: 3 }}>
                  {momSign}{d.momChange}% vs last month
                </div>
              )}
            </div>
          </Card>

          <Card style={{ padding: 0 }}>
            <div style={{ padding: '14px' }}>
              <div style={s.kpiLabel}>ARR Run-Rate</div>
              <div style={s.kpiValue}>${(d.arr || 0).toLocaleString()}</div>
              <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>based on current MRR</div>
            </div>
          </Card>

          <Card style={{ padding: 0 }}>
            <div style={{ padding: '14px' }}>
              <div style={s.kpiLabel}>This Month Revenue</div>
              <div style={s.kpiValue}>${(d.thisMonthRevenue || 0).toLocaleString()}</div>
              <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>
                Last month: ${(d.lastMonthRevenue || 0).toLocaleString()}
              </div>
            </div>
          </Card>

          <Card style={{ padding: 0 }}>
            <div style={{ padding: '14px' }}>
              <div style={s.kpiLabel}>Subscriptions</div>
              <div style={s.kpiValue}>{d.activeCount || 0}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
                {d.trialingCount > 0 && <span style={{ fontSize: 8, color: '#02a4ba' }}>{d.trialingCount} trialing</span>}
                {d.pastDueCount  > 0 && <span style={{ fontSize: 8, color: '#f5a623' }}>{d.pastDueCount} past due</span>}
                {d.canceledCount > 0 && <span style={{ fontSize: 8, color: '#e85454' }}>{d.canceledCount} canceled</span>}
              </div>
            </div>
          </Card>
        </div>

        {/* ── MRR Chart + Failed Payments ── */}
        <div style={s.row2}>
          <Card title="Revenue by Month (Last 6 Months)">
            <div style={{ padding: '0 14px 14px' }}>
              <MrrChart data={d.mrrHistory} />
            </div>
          </Card>

          <Card title={`Failed Payments (${(d.failedInvoices || []).length})`}>
            <div style={{ padding: '0 14px 14px' }}>
              {(d.failedInvoices || []).length === 0
                ? <p style={s.empty}>No failed payments 🎉</p>
                : (d.failedInvoices || []).map(inv => (
                  <div key={inv.id} style={s.listRow}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 600 }}>{inv.customer_email}</div>
                      <div style={{ fontSize: 9, color: '#5a6080' }}>
                        {inv.attempt_count} attempt{inv.attempt_count !== 1 ? 's' : ''}
                        {inv.next_payment_attempt ? ` · next retry ${formatDate(inv.next_payment_attempt)}` : ''}
                      </div>
                    </div>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#e85454' }}>
                      ${inv.amount.toFixed(2)}
                    </span>
                  </div>
                ))
              }
            </div>
          </Card>
        </div>

        {/* ── All Subscriptions — paginated ── */}
        <Card title="All Subscriptions">
          <div style={{ padding: '0 14px 12px' }}>
            <input
              style={s.search}
              placeholder="Search by email or name…"
              value={subSearch}
              onChange={e => { setSubSearch(e.target.value); subPag.reset(); }}
            />
          </div>
          <table style={s.table}>
            <thead>
              <tr>
                {['Customer', 'Status', 'Amount', 'Renews', 'Started', ''].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subPag.pageItems.length === 0
                ? <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#3a3e50', padding: 24 }}>No subscriptions found</td></tr>
                : subPag.pageItems.map(sub => (
                  <tr key={sub.id} style={s.row}>
                    <td style={s.td}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#e4e6f0' }}>{sub.customer_name || sub.customer_email}</div>
                      {sub.customer_name && <div style={{ fontSize: 9, color: '#5a6080' }}>{sub.customer_email}</div>}
                    </td>
                    <td style={s.td}>{statusStyle(sub.status)}</td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#7880a0' }}>
                      ${sub.amount}/mo
                    </td>
                    <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>
                      {sub.cancel_at_period_end
                        ? <span style={{ color: '#e85454' }}>Cancels {formatDate(sub.current_period_end)}</span>
                        : formatDate(sub.current_period_end)
                      }
                    </td>
                    <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{timeAgo(sub.created)}</td>
                    <td style={s.td}>
                      <a
                        href={`https://dashboard.stripe.com/subscriptions/${sub.id}`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 10, color: '#02a4ba', textDecoration: 'none' }}
                      >
                        Stripe →
                      </a>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          <Pagination
            page={subPag.page}
            totalPages={subPag.totalPages}
            setPage={subPag.setPage}
            total={filteredSubs.length}
            pageSize={PAGE_SIZE}
          />
        </Card>

        {/* ── Recent Charges — paginated ── */}
        <Card title="Recent Successful Charges">
          <table style={s.table}>
            <thead>
              <tr>
                {['Customer', 'Amount', 'Description', 'Date'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chargePag.pageItems.map(charge => (
                <tr key={charge.id} style={s.row}>
                  <td style={{ ...s.td, fontSize: 11, color: '#7880a0' }}>{charge.customer_email}</td>
                  <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#3de8a0' }}>${charge.amount.toFixed(2)}</td>
                  <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{charge.description}</td>
                  <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{formatDate(charge.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={chargePag.page}
            totalPages={chargePag.totalPages}
            setPage={chargePag.setPage}
            total={(d.recentCharges || []).length}
            pageSize={PAGE_SIZE}
          />
        </Card>

      </div>
    </AdminLayout>
  );
}

const s = {
  page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Inter', sans-serif" },
  title: { fontSize: 22, fontWeight: 700, color: '#e4e6f0', letterSpacing: '-0.5px', fontFamily: "'Playfair Display', serif", margin: 0 },
  subtitle: { fontSize: 10, color: '#3a3e50', marginTop: 3 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 },
  kpiLabel: { fontSize: 8, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  kpiValue: { fontSize: 24, fontWeight: 600, color: '#e4e6f0', lineHeight: 1, fontFamily: "'DM Mono', monospace" },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  search: {
    width: '100%', padding: '7px 12px', fontSize: 11,
    background: '#0f1115', border: '1px solid #1e2028', borderRadius: 6,
    color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none',
    boxSizing: 'border-box',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase',
    letterSpacing: '0.8px', padding: '8px 14px', textAlign: 'left',
    borderBottom: '1px solid #1e2028', background: '#0f1115',
  },
  td: { padding: '10px 14px', borderBottom: '1px solid #0f1115', verticalAlign: 'middle' },
  row: { transition: 'background 0.1s' },
  listRow: { display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1a1c23' },
  empty: { fontSize: 11, color: '#3a3e50', margin: 0 },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};