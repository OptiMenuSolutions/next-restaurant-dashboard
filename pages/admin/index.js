// pages/admin/index.js
// Main admin dashboard. Pulls live data from Supabase (restaurants, invoices,
// parse stats) and Stripe (MRR, failed payments). Uses service role key
// via server-side API routes to bypass RLS.

import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

// ── Small reusable components ─────────────────────────────────────────────────

function KpiCard({ label, value, delta, deltaDir, mono }) {
  const deltaColor = deltaDir === 'up' ? '#3de8a0' : deltaDir === 'down' ? '#e85454' : '#5a6080';
  return (
    <div style={s.kpiCard}>
      <div style={s.kpiLabel}>{label}</div>
      <div style={{ ...s.kpiValue, fontFamily: mono ? "'DM Mono', monospace" : undefined }}>
        {value ?? <span style={{ color: '#3a3e50' }}>—</span>}
      </div>
      {delta && <div style={{ ...s.kpiDelta, color: deltaColor }}>{delta}</div>}
    </div>
  );
}

function SectionCard({ title, action, onAction, children }) {
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.cardTitle}>{title}</span>
        {action && <button onClick={onAction} style={s.cardAction}>{action}</button>}
      </div>
      {children}
    </div>
  );
}

function Pill({ color, children }) {
  const colors = {
    green:  { bg: 'rgba(61,232,160,0.1)',  border: 'rgba(61,232,160,0.25)',  text: '#3de8a0' },
    amber:  { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
    red:    { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
    teal:   { bg: 'rgba(2,164,186,0.1)',   border: 'rgba(2,164,186,0.25)', text: '#02a4ba' },
    dim:    { bg: 'rgba(255,255,255,0.04)', border: '#1e2028',              text: '#5a6080' },
  };
  const c = colors[color] || colors.dim;
  return (
    <span style={{ display:'inline-block', fontSize:8, fontWeight:700, padding:'2px 7px',
      borderRadius:20, textTransform:'uppercase', letterSpacing:'0.5px',
      background:c.bg, border:`1px solid ${c.border}`, color:c.text }}>
      {children}
    </span>
  );
}

function BarRow({ label, pct, color }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7 }}>
      <span style={{ fontSize:10, color:'#5a6080', width:110, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
      <div style={{ flex:1, background:'#1a1c23', borderRadius:3, height:4 }}>
        <div style={{ width:`${pct}%`, height:4, borderRadius:3, background: color || '#02a4ba', transition:'width 0.6s' }} />
      </div>
      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: color || '#02a4ba', width:30, textAlign:'right' }}>{pct}%</span>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/dashboard');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  if (loading) return (
    <AdminLayout title="Dashboard">
      <div style={s.center}><div style={s.spinner} /><span style={{ color:'#3a3e50', fontSize:12 }}>Loading dashboard…</span></div>
    </AdminLayout>
  );

  if (error) return (
    <AdminLayout title="Dashboard">
      <div style={s.center}><div style={{ color:'#e85454', fontSize:12 }}>Error: {error}</div></div>
    </AdminLayout>
  );

  const d = data || {};

  return (
    <AdminLayout title="Dashboard">
      <div style={s.page}>

        {/* ── Page header ── */}
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.pageTitle}>Operations Dashboard</h1>
            <p style={s.pageSubtitle}>{new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })} · All times UTC</p>
          </div>
          <button style={s.refreshBtn} onClick={() => window.location.reload()}>↻ Refresh</button>
        </div>

        {/* ── KPI Row ── */}
        <div style={s.kpiGrid}>
          <KpiCard label="MRR" value={d.mrr ? `$${d.mrr.toLocaleString()}` : '—'} delta={d.mrrDelta} deltaDir="up" mono />
          <KpiCard label="Active Restaurants" value={d.activeCount ?? '—'} delta={d.newThisMonth ? `+${d.newThisMonth} this month` : null} deltaDir="up" />
          <KpiCard label="Avg Profit Score" value={d.avgProfitScore ?? '—'} delta={d.profitScoreDelta} deltaDir="down" />
          <KpiCard label="Invoices Parsed" value={d.invoiceCount?.toLocaleString() ?? '—'} delta={d.invoiceDelta} deltaDir="up" />
          <KpiCard label="AI API Spend" value={d.aiSpend ? `$${d.aiSpend}` : '—'} delta={d.aiSpendStatus} deltaDir={d.aiSpendOver ? 'down' : 'up'} mono />
        </div>

        {/* ── Row 2: MRR chart + At-Risk alerts ── */}
        <div style={s.row2}>
          <SectionCard title="MRR Growth (6 months)">
            <MiniBarChart data={d.mrrHistory || []} />
            <div style={s.mrrMeta}>
              <MetaItem label="Rate" value={`$59 × ${d.activeCount || 0}`} />
              <MetaItem label="ARR run-rate" value={d.arr ? `$${d.arr.toLocaleString()}` : '—'} accent />
              <MetaItem label="Failed payments" value={d.failedPayments ?? 0} danger={d.failedPayments > 0} />
              <MetaItem label="Churn risk" value={d.churnRisk ?? 0} danger={d.churnRisk > 2} />
            </div>
          </SectionCard>

          <SectionCard title="At-Risk Restaurants" action="View all →">
            {(d.atRisk || []).length === 0
              ? <p style={{ fontSize:11, color:'#3a3e50', padding:'8px 0' }}>No at-risk restaurants 🎉</p>
              : (d.atRisk || []).slice(0, 3).map(r => (
                <div key={r.id} style={{ ...s.alertRow, borderColor: r.severity === 'high' ? 'rgba(232,84,84,0.2)' : 'rgba(245,166,35,0.2)', background: r.severity === 'high' ? 'rgba(232,84,84,0.06)' : 'rgba(245,166,35,0.06)' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#e4e6f0', marginBottom:2 }}>{r.restaurant_name}</div>
                    <div style={{ fontSize:9, color:'#5a6080' }}>{r.reason}</div>
                  </div>
                  <Pill color={r.severity === 'high' ? 'red' : 'amber'}>{r.severity}</Pill>
                </div>
              ))
            }
          </SectionCard>
        </div>

        {/* ── Row 3: Feature adoption + AI spend + Live activity ── */}
        <div style={s.row3}>
          <SectionCard title="Feature Adoption">
            <BarRow label="Invoice parse" pct={d.adoption?.invoice || 0} color="#02a4ba" />
            <BarRow label="Menu import" pct={d.adoption?.menu || 0} color="#02a4ba" />
            <BarRow label="POS upload" pct={d.adoption?.pos || 0} color="#f5a623" />
            <BarRow label="AI recs used" pct={d.adoption?.ai || 0} color="#e85454" />
          </SectionCard>

          <SectionCard title="AI Spend Breakdown">
            <BarRow label="Invoice parse" pct={d.aiBreakdown?.invoice || 0} />
            <BarRow label="Menu parser" pct={d.aiBreakdown?.menu || 0} color="rgba(2,164,186,0.6)" />
            <BarRow label="Dish recs" pct={d.aiBreakdown?.recs || 0} color="rgba(2,164,186,0.35)" />
            <div style={s.aiSpendRow}>
              <span style={{ fontSize:9, color:'#3a3e50' }}>Monthly budget</span>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: d.aiSpendOver ? '#e85454' : '#3de8a0' }}>
                ${d.aiSpend || 0} / $180
              </span>
            </div>
          </SectionCard>

          <SectionCard title="Live Activity">
            {(d.recentActivity || []).length === 0
              ? <p style={{ fontSize:11, color:'#3a3e50' }}>No recent activity</p>
              : (d.recentActivity || []).slice(0, 5).map((act, i) => (
                <div key={i} style={s.actRow}>
                  <div style={{ ...s.actDot, background: actColor(act.type) }} />
                  <div style={{ flex:1, fontSize:10, color:'#5a6080', lineHeight:1.4 }}>
                    <strong style={{ color:'#e4e6f0' }}>{act.restaurant}</strong> {act.description}
                  </div>
                  <span style={{ fontSize:8, color:'#3a3e50', flexShrink:0 }}>{act.time_ago}</span>
                </div>
              ))
            }
          </SectionCard>
        </div>

      </div>
    </AdminLayout>
  );
}

// ── Mini components ───────────────────────────────────────────────────────────

function MiniBarChart({ data }) {
  if (!data.length) return <div style={{ height:52, display:'flex', alignItems:'center', justifyContent:'center', color:'#3a3e50', fontSize:10 }}>No data yet</div>;
  const max = Math.max(...data.map(d => d.value));
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:52 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2, height:'100%' }}>
          <div style={{ flex:1, width:'100%', display:'flex', alignItems:'flex-end' }}>
            <div style={{ width:'100%', borderRadius:'2px 2px 0 0', background: i === data.length - 1 ? '#02a4ba' : `rgba(2,164,186,${0.2 + (i / data.length) * 0.6})`, height: `${(d.value / max) * 100}%`, transition:'height 0.6s' }} />
          </div>
          <span style={{ fontSize:7, color:'#3a3e50' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function MetaItem({ label, value, accent, danger }) {
  return (
    <div>
      <div style={{ fontSize:8, color:'#3a3e50', marginBottom:1 }}>{label}</div>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: danger ? '#e85454' : accent ? '#02a4ba' : '#7880a0' }}>{value}</div>
    </div>
  );
}

function actColor(type) {
  const map = { invoice:'#02a4ba', menu:'#3de8a0', error:'#e85454', pos:'#f5a623', login:'#7880a0' };
  return map[type] || '#3a3e50';
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page: { padding: '20px 24px', display:'flex', flexDirection:'column', gap:14, fontFamily:"'Inter',sans-serif" },
  pageHeader: { display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexShrink:0 },
  pageTitle: { fontSize:22, fontWeight:700, color:'#e4e6f0', letterSpacing:'-0.5px', fontFamily:"'Playfair Display',serif", margin:0 },
  pageSubtitle: { fontSize:10, color:'#3a3e50', marginTop:3 },
  refreshBtn: { background:'none', border:'1px solid #1e2028', borderRadius:6, color:'#5a6080', fontSize:10, fontWeight:600, padding:'6px 12px', cursor:'pointer', fontFamily:"'Inter',sans-serif" },
  kpiGrid: { display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 },
  kpiCard: { background:'#111318', border:'1px solid #1e2028', borderRadius:8, padding:'12px 14px' },
  kpiLabel: { fontSize:8, fontWeight:700, color:'#3a3e50', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:5 },
  kpiValue: { fontSize:22, fontWeight:600, color:'#e4e6f0', lineHeight:1, marginBottom:3, fontFamily:"'DM Mono',monospace" },
  kpiDelta: { fontSize:9 },
  row2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  row3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 },
  card: { background:'#111318', border:'1px solid #1e2028', borderRadius:8, padding:'14px' },
  cardHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 },
  cardTitle: { fontSize:9, fontWeight:700, color:'#5a6080', textTransform:'uppercase', letterSpacing:'0.8px' },
  cardAction: { fontSize:10, color:'#02a4ba', fontWeight:600, background:'none', border:'none', cursor:'pointer', fontFamily:"'Inter',sans-serif" },
  mrrMeta: { marginTop:10, paddingTop:10, borderTop:'1px solid #1e2028', display:'flex', gap:16 },
  alertRow: { display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:6, marginBottom:5, border:'1px solid' },
  aiSpendRow: { marginTop:10, paddingTop:8, borderTop:'1px solid #1e2028', display:'flex', justifyContent:'space-between', alignItems:'center' },
  actRow: { display:'flex', alignItems:'flex-start', gap:8, paddingBottom:7, marginBottom:7, borderBottom:'1px solid #1e2028' },
  actDot: { width:6, height:6, borderRadius:'50%', flexShrink:0, marginTop:3 },
  center: { flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:10 },
  spinner: { width:16, height:16, border:'2px solid #1e2028', borderTopColor:'#02a4ba', borderRadius:'50%', animation:'spin 0.8s linear infinite' },
};