// pages/admin/data/analytics.js
// POS analytics across all restaurants.

import { useEffect, useState } from 'react';
import AdminLayout from '../../../components/admin/AdminLayout';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';

function RevenueChart({ data }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  // Show every 5th label to avoid crowding
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%' }}>
          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div
              title={`${d.label}: $${d.value.toLocaleString()}`}
              style={{
                width: '100%',
                borderRadius: '2px 2px 0 0',
                background: i === data.length - 1 ? '#02a4ba' : `rgba(2,164,186,${0.15 + (i / data.length) * 0.7})`,
                height: `${(d.value / max) * 100}%`,
                minHeight: d.value > 0 ? 2 : 0,
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

export default function AnalyticsDataPage() {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/data/analytics');
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
    <AdminLayout title="POS Analytics">
      <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
    </AdminLayout>
  );

  const d = data || {};
  const stats = d.stats || {};
  const maxRestaurantRevenue = Math.max(...(d.restaurantBreakdown || []).map(r => r.revenue), 1);
  const maxCategoryRevenue   = Math.max(...(d.categoryBreakdown || []).map(c => c.revenue), 1);

  return (
    <AdminLayout title="POS Analytics">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>POS Analytics</h1>
          <p style={s.subtitle}>Aggregated sales data across all restaurants · last 30 days</p>
        </div>

        {/* ── KPI Row ── */}
        <div style={s.statGrid}>
          {[
            { label: 'Total Revenue',     value: `$${(stats.totalRevenue || 0).toLocaleString()}`, color: '#3de8a0' },
            { label: 'Total Items Sold',  value: (stats.totalQty || 0).toLocaleString(),           color: '#e4e6f0' },
            { label: 'Restaurants w/ POS', value: `${stats.restaurantsWithPOS || 0} / ${stats.totalRestaurants || 0}`, color: '#02a4ba' },
            { label: 'Avg Rev / Restaurant', value: `$${(stats.avgRevenuePerRestaurant || 0).toLocaleString()}`, color: '#f5a623' },
            { label: 'vs Last 30 Days',   value: stats.revenueChange != null ? `${stats.revenueChange > 0 ? '+' : ''}${stats.revenueChange}%` : '—', color: stats.revenueChange > 0 ? '#3de8a0' : stats.revenueChange < 0 ? '#e85454' : '#5a6080' },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statLabel}>{stat.label}</div>
              <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* ── Daily Trend ── */}
        <Card title="Daily Revenue Trend (Last 30 Days)">
          <RevenueChart data={d.dailyTrend} />
        </Card>

        {/* ── Row 2: Top Items + Category Breakdown ── */}
        <div style={s.row2}>
          <Card title="Top Items by Revenue (Last 30 Days)">
            {(d.topItems || []).length === 0
              ? <p style={s.empty}>No POS data yet</p>
              : (d.topItems || []).map((item, i) => (
                <div key={item.name} style={s.listRow}>
                  <span style={{ fontSize: 9, color: '#3a3e50', width: 16, flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#e4e6f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                    <div style={{ fontSize: 9, color: '#5a6080' }}>{Math.round(item.qty)} sold · {item.restaurants} restaurant{item.restaurants !== 1 ? 's' : ''}</div>
                  </div>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#3de8a0', flexShrink: 0 }}>
                    ${Math.round(item.revenue).toLocaleString()}
                  </span>
                </div>
              ))
            }
          </Card>

          <Card title="Revenue by Category">
            {(d.categoryBreakdown || []).length === 0
              ? <p style={s.empty}>No category data yet</p>
              : (d.categoryBreakdown || []).map(cat => (
                <div key={cat.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#7880a0' }}>{cat.name}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#02a4ba' }}>${Math.round(cat.revenue).toLocaleString()}</span>
                  </div>
                  <div style={{ background: '#1a1c23', borderRadius: 3, height: 4 }}>
                    <div style={{ width: `${(cat.revenue / maxCategoryRevenue) * 100}%`, height: 4, borderRadius: 3, background: '#02a4ba', transition: 'width 0.6s' }} />
                  </div>
                </div>
              ))
            }
          </Card>
        </div>

        {/* ── Restaurant Breakdown ── */}
        <Card title="Revenue by Restaurant (Last 30 Days)">
          {(d.restaurantBreakdown || []).length === 0
            ? <p style={s.empty}>No POS data yet</p>
            : (d.restaurantBreakdown || []).map((r, i) => (
              <div key={r.id} style={{ ...s.listRow, alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: '#3a3e50', width: 20, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#e4e6f0' }}>{r.name}</span>
                      <span style={{ fontSize: 9, color: '#5a6080', marginLeft: 8 }}>{Math.round(r.qty)} sold · {r.items} unique items</span>
                    </div>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#3de8a0' }}>${r.revenue.toLocaleString()}</span>
                  </div>
                  <div style={{ background: '#1a1c23', borderRadius: 3, height: 4 }}>
                    <div style={{ width: `${(r.revenue / maxRestaurantRevenue) * 100}%`, height: 4, borderRadius: 3, background: `rgba(2,164,186,${0.4 + (1 - i / (d.restaurantBreakdown.length || 1)) * 0.6})`, transition: 'width 0.6s' }} />
                  </div>
                </div>
              </div>
            ))
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
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 },
  statCard: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: '12px 14px' },
  statLabel: { fontSize: 8, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  statValue: { fontSize: 20, fontWeight: 600, lineHeight: 1, fontFamily: "'DM Mono', monospace" },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  listRow: { display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1a1c23' },
  empty: { fontSize: 11, color: '#3a3e50', margin: 0 },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};