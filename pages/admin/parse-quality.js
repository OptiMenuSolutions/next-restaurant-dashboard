// pages/admin/parse-quality.js
// Invoice parse quality metrics and failure analysis.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function rateColor(rate) {
  if (rate == null) return '#3a3e50';
  if (rate >= 90) return '#3de8a0';
  if (rate >= 70) return '#f5a623';
  return '#e85454';
}

function TrendChart({ data }) {
  if (!data?.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 72 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%' }}>
          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div
              title={d.rate != null ? `${d.label}: ${d.rate}% (${d.total} invoices)` : `${d.label}: no data`}
              style={{
                width: '100%',
                borderRadius: '2px 2px 0 0',
                background: d.rate != null ? rateColor(d.rate) : '#1a1c23',
                opacity: d.rate != null ? 0.85 : 0.3,
                height: d.rate != null ? `${d.rate}%` : '4px',
                minHeight: 2,
                transition: 'height 0.4s',
                cursor: 'default',
              }}
            />
          </div>
          {i % 5 === 0 && (
            <span style={{ fontSize: 7, color: '#3a3e50', whiteSpace: 'nowrap' }}>{d.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Card({ title, children, style }) {
  return (
    <div style={{ background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: 14, ...style }}>
      {title && <div style={{ fontSize: 9, fontWeight: 700, color: '#5a6080', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  );
}

export default function ParseQualityPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/parse-quality');
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

  if (loading) return (
    <AdminLayout title="Parse Quality">
      <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
    </AdminLayout>
  );

  const d = data || {};
  const tm = d.thisMonth || {};
  const lm = d.lastMonth || {};
  const buckets = d.confBuckets || {};
  const maxBucket = Math.max(...Object.values(buckets), 1);

  const rateChange = lm.successRate > 0
    ? Math.round(tm.successRate - lm.successRate)
    : null;

  return (
    <AdminLayout title="Parse Quality">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Parse Quality</h1>
          <p style={s.subtitle}>Invoice parser performance · last 30 days</p>
        </div>

        {/* ── KPI Row ── */}
        <div style={s.kpiGrid}>
          <Card>
            <div style={s.kpiLabel}>Success Rate</div>
            <div style={{ ...s.kpiValue, color: rateColor(tm.successRate) }}>{tm.successRate ?? '—'}%</div>
            {rateChange != null && (
              <div style={{ fontSize: 9, color: rateChange >= 0 ? '#3de8a0' : '#e85454', marginTop: 3 }}>
                {rateChange >= 0 ? '↑' : '↓'} {Math.abs(rateChange)}pts vs last month
              </div>
            )}
          </Card>

          <Card>
            <div style={s.kpiLabel}>Total Parsed</div>
            <div style={s.kpiValue}>{tm.total ?? 0}</div>
            <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>last month: {lm.total ?? 0}</div>
          </Card>

          <Card>
            <div style={s.kpiLabel}>Completed</div>
            <div style={{ ...s.kpiValue, color: '#3de8a0' }}>{tm.completed ?? 0}</div>
          </Card>

          <Card>
            <div style={s.kpiLabel}>Failed</div>
            <div style={{ ...s.kpiValue, color: tm.failed > 0 ? '#e85454' : '#3a3e50' }}>{tm.failed ?? 0}</div>
            <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>last month: {lm.failed ?? 0}</div>
          </Card>

          <Card>
            <div style={s.kpiLabel}>Avg Confidence</div>
            <div style={{ ...s.kpiValue, color: rateColor(tm.avgConf) }}>{tm.avgConf != null ? `${tm.avgConf}%` : '—'}</div>
            <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>last month: {lm.avgConf != null ? `${lm.avgConf}%` : '—'}</div>
          </Card>
        </div>

        {/* ── Trend + Confidence Distribution ── */}
        <div style={s.row2}>
          <Card title="Daily Success Rate (Last 30 Days)">
            <TrendChart data={d.dailyTrend} />
            <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid #1a1c23' }}>
              {[
                { label: '≥90%', color: '#3de8a0' },
                { label: '70–89%', color: '#f5a623' },
                { label: '<70%', color: '#e85454' },
                { label: 'No data', color: '#1a1c23' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color }} />
                  <span style={{ fontSize: 8, color: '#3a3e50' }}>{item.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Confidence Score Distribution">
            {Object.entries(buckets).map(([label, count]) => (
              <div key={label} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: '#7880a0' }}>{label}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#5a6080' }}>{count}</span>
                </div>
                <div style={{ background: '#1a1c23', borderRadius: 3, height: 5 }}>
                  <div style={{
                    width: `${(count / maxBucket) * 100}%`, height: 5, borderRadius: 3,
                    background: label === '90-100' ? '#3de8a0' : label === '70-89' ? '#f5a623' : label === 'N/A' ? '#3a3e50' : '#e85454',
                    transition: 'width 0.6s',
                  }} />
                </div>
              </div>
            ))}
          </Card>
        </div>

        {/* ── Row 2: Top Failures + Failed Suppliers ── */}
        <div style={s.row2}>
          <Card title="Most Failures by Restaurant (This Month)">
            {(d.topFailures || []).length === 0
              ? <p style={s.empty}>No failures this month 🎉</p>
              : (d.topFailures || []).map((r, i) => (
                <div
                  key={r.id}
                  style={{ ...s.listRow, cursor: 'pointer' }}
                  onClick={() => router.push(`/admin/restaurants/${r.id}`)}
                >
                  <span style={{ fontSize: 9, color: '#3a3e50', width: 16 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#e4e6f0' }}>{r.name}</div>
                  </div>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#e85454' }}>
                    {r.failures} failed
                  </span>
                </div>
              ))
            }
          </Card>

          <Card title="Most Failures by Supplier (This Month)">
            {(d.topFailedSuppliers || []).length === 0
              ? <p style={s.empty}>No failures this month 🎉</p>
              : (d.topFailedSuppliers || []).map((sup, i) => (
                <div key={sup.name} style={s.listRow}>
                  <span style={{ fontSize: 9, color: '#3a3e50', width: 16 }}>{i + 1}</span>
                  <div style={{ flex: 1, fontSize: 11, color: '#7880a0' }}>{sup.name}</div>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#e85454' }}>
                    {sup.count} failed
                  </span>
                </div>
              ))
            }
          </Card>
        </div>

        {/* ── Recent Failures ── */}
        <Card title="Recent Failed Invoices">
          {(d.recentFailed || []).length === 0
            ? <p style={s.empty}>No recent failures</p>
            : (
              <table style={s.table}>
                <thead>
                  <tr>
                    {['Restaurant', 'Supplier', 'Failed'].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.recentFailed || []).map(inv => (
                    <tr
                      key={inv.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/admin/restaurants/${inv.restaurant_id}`)}
                    >
                      <td style={{ ...s.td, fontSize: 11, fontWeight: 600, color: '#e4e6f0' }}>{inv.restaurant}</td>
                      <td style={{ ...s.td, fontSize: 11, color: '#7880a0' }}>{inv.supplier}</td>
                      <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{timeAgo(inv.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Card>

      </div>
    </AdminLayout>
  );
}

const s = {
  page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Inter', sans-serif" },
  title: { fontSize: 22, fontWeight: 700, color: '#e4e6f0', letterSpacing: '-0.5px', fontFamily: "'Playfair Display', serif", margin: 0 },
  subtitle: { fontSize: 10, color: '#3a3e50', marginTop: 3 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 },
  kpiLabel: { fontSize: 8, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  kpiValue: { fontSize: 24, fontWeight: 600, color: '#e4e6f0', lineHeight: 1, fontFamily: "'DM Mono', monospace" },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  listRow: { display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1a1c23' },
  empty: { fontSize: 11, color: '#3a3e50', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #1e2028' },
  td: { padding: '10px 12px', borderBottom: '1px solid #0f1115', verticalAlign: 'middle' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};