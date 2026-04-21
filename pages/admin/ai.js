// pages/admin/ai.js
// AI Usage & Costs dashboard page.

import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

const FEATURE_LABELS = {
  invoice_parse: 'Invoice Parse',
  menu_import:   'Menu Import',
  dish_recs:     'Dish Recs',
  profit_score:  'Profit Score',
};

const FEATURE_COLORS = {
  invoice_parse: '#02a4ba',
  menu_import:   '#3de8a0',
  dish_recs:     '#f5a623',
  profit_score:  '#e85454',
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function BarRow({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: '#5a6080', width: 100, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: '#1a1c23', borderRadius: 3, height: 5 }}>
        <div style={{ width: `${pct}%`, height: 5, borderRadius: 3, background: color || '#02a4ba', transition: 'width 0.6s' }} />
      </div>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: color || '#02a4ba', width: 55, textAlign: 'right' }}>
        ${value.toFixed(4)}
      </span>
    </div>
  );
}

// Monthly spend bar chart with dollar value labels on EVERY bar
function MiniChart({ data }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.value), 0.0001);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 72, paddingTop: 20 }}>
      {data.map((d, i) => {
        const isLatest = i === data.length - 1;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%' }}>
            <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
              {/* Dollar label above every bar */}
              <div style={{
                fontSize: 7,
                color: isLatest ? '#02a4ba' : '#3a3e50',
                fontFamily: "'DM Mono', monospace",
                marginBottom: 2,
                whiteSpace: 'nowrap',
              }}>
                ${d.value > 0 ? d.value.toFixed(2) : '0'}
              </div>
              <div style={{
                width: '100%',
                borderRadius: '2px 2px 0 0',
                background: isLatest ? '#02a4ba' : `rgba(2,164,186,${0.2 + (i / data.length) * 0.6})`,
                height: d.value > 0 ? `${(d.value / max) * 100}%` : '2px',
                minHeight: 2,
                transition: 'height 0.6s',
              }} />
            </div>
            <span style={{ fontSize: 7, color: '#3a3e50' }}>{d.label}</span>
          </div>
        );
      })}
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

export default function AiUsagePage() {
  const { adminFetch } = useAdminFetch();
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res  = await adminFetch('/api/admin/ai');
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
    <AdminLayout title="AI Usage">
      <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
    </AdminLayout>
  );

  const d   = data || {};
  const tm  = d.thisMonth || {};
  const lm  = d.lastMonth || {};
  const at  = d.allTime   || {};
  const budgetPct   = d.budgetUsedPct || 0;
  const budgetColor = budgetPct >= 100 ? '#e85454' : budgetPct >= 80 ? '#f5a623' : '#3de8a0';
  const maxFeatureCost = Math.max(tm.invoice_parse || 0, tm.menu_import || 0, tm.dish_recs || 0, 0.0001);

  // Top restaurants — show even if only 1 restaurant has data
  const topRestaurants = d.topRestaurants || [];

  return (
    <AdminLayout title="AI Usage & Costs">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>AI Usage & Costs</h1>
          <p style={s.subtitle}>Anthropic API spend tracked across all features and restaurants</p>
        </div>

        {/* ── KPI Row ── */}
        <div style={s.kpiGrid}>
          <Card>
            <div style={s.kpiLabel}>This Month</div>
            <div style={{ ...s.kpiValue, color: budgetColor }}>${(tm.total || 0).toFixed(2)}</div>
            <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>of ${d.budget || 180} budget</div>
            <div style={{ marginTop: 8, background: '#1a1c23', borderRadius: 3, height: 4 }}>
              <div style={{ width: `${Math.min(budgetPct, 100)}%`, height: 4, borderRadius: 3, background: budgetColor, transition: 'width 0.6s' }} />
            </div>
          </Card>

          <Card>
            <div style={s.kpiLabel}>Last Month</div>
            <div style={s.kpiValue}>${(lm.total || 0).toFixed(2)}</div>
            {lm.total > 0 && tm.total > 0 && (
              <div style={{ fontSize: 9, color: tm.total > lm.total ? '#e85454' : '#3de8a0', marginTop: 3 }}>
                {tm.total > lm.total ? '↑' : '↓'} {Math.abs(Math.round(((tm.total - lm.total) / lm.total) * 100))}% vs last month
              </div>
            )}
          </Card>

          <Card>
            <div style={s.kpiLabel}>All Time Spend</div>
            <div style={s.kpiValue}>${(at.total || 0).toFixed(2)}</div>
            <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>
              {((at.input_tokens || 0) / 1000).toFixed(0)}k input · {((at.output_tokens || 0) / 1000).toFixed(0)}k output tokens
            </div>
          </Card>

          <Card>
            <div style={s.kpiLabel}>This Month Tokens</div>
            <div style={s.kpiValue}>{(((tm.input_tokens || 0) + (tm.output_tokens || 0)) / 1000).toFixed(1)}k</div>
            <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 3 }}>
              {((tm.input_tokens || 0) / 1000).toFixed(0)}k in · {((tm.output_tokens || 0) / 1000).toFixed(0)}k out
            </div>
          </Card>
        </div>

        {/* ── Row 2: Trend + Feature Breakdown ── */}
        <div style={s.row2}>
          <Card title="Monthly Spend Trend">
            <MiniChart data={d.monthlyTrend} />
          </Card>

          <Card title="This Month by Feature">
            <BarRow label="Invoice Parse" value={tm.invoice_parse || 0} max={maxFeatureCost} color={FEATURE_COLORS.invoice_parse} />
            <BarRow label="Menu Import"   value={tm.menu_import   || 0} max={maxFeatureCost} color={FEATURE_COLORS.menu_import} />
            <BarRow label="Dish Recs"     value={tm.dish_recs     || 0} max={maxFeatureCost} color={FEATURE_COLORS.dish_recs} />
            <BarRow label="Profit Score"  value={tm.profit_score  || 0} max={maxFeatureCost} color={FEATURE_COLORS.profit_score} />
          </Card>
        </div>

        {/* ── Row 3: Top Restaurants + Recent Calls ── */}
        <div style={s.row2}>
          <Card title="Top Restaurants by Spend (This Month)">
            {topRestaurants.length === 0 ? (
              <p style={s.empty}>No AI calls this month yet</p>
            ) : (
              topRestaurants.map((r, i) => (
                <div key={r.id} style={s.listRow}>
                  <span style={{ fontSize: 9, color: '#3a3e50', width: 16 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 9, color: '#5a6080' }}>{r.calls} call{r.calls !== 1 ? 's' : ''}</div>
                  </div>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#02a4ba' }}>${r.cost.toFixed(4)}</span>
                </div>
              ))
            )}
          </Card>

          <Card title="Recent API Calls">
            {(d.recentCalls || []).length === 0
              ? <p style={s.empty}>No calls yet</p>
              : (d.recentCalls || []).map((call, i) => (
                <div key={i} style={s.listRow}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: FEATURE_COLORS[call.feature] || '#5a6080', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 600 }}>{FEATURE_LABELS[call.feature] || call.feature}</div>
                    <div style={{ fontSize: 9, color: '#5a6080' }}>{call.restaurant} · {call.input_tokens}in / {call.output_tokens}out tokens</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#7880a0' }}>${call.cost.toFixed(6)}</div>
                    <div style={{ fontSize: 8, color: '#3a3e50' }}>{timeAgo(call.created_at)}</div>
                  </div>
                </div>
              ))
            }
          </Card>
        </div>

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
  listRow: { display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1a1c23' },
  empty: { fontSize: 11, color: '#3a3e50', margin: 0 },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};