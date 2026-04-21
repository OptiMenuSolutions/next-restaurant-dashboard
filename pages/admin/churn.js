// pages/admin/churn.js
// Churn forecast — risk scoring for all active restaurants.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function tierColor(tier) {
  if (tier === 'high')   return { text: '#e85454', bg: 'rgba(232,84,84,0.1)',  border: 'rgba(232,84,84,0.25)' };
  if (tier === 'medium') return { text: '#f5a623', bg: 'rgba(245,166,35,0.1)', border: 'rgba(245,166,35,0.25)' };
  return                        { text: '#3de8a0', bg: 'rgba(61,232,160,0.1)', border: 'rgba(61,232,160,0.25)' };
}

function RiskGauge({ score }) {
  const color = score >= 60 ? '#e85454' : score >= 30 ? '#f5a623' : '#3de8a0';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color, fontWeight: 700 }}>{score}</span>
      </div>
      <div style={{ width: 40, height: 3, background: '#1a1c23', borderRadius: 2 }}>
        <div style={{ width: `${score}%`, height: 3, borderRadius: 2, background: color, transition: 'width 0.6s' }} />
      </div>
    </div>
  );
}

function TierPill({ tier }) {
  const c = tierColor(tier);
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'uppercase', letterSpacing: '0.5px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {tier} risk
    </span>
  );
}

export default function ChurnPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [stats, setStats]             = useState({});
  const [loading, setLoading]         = useState(true);
  const [tierFilter, setTierFilter]   = useState('all');
  const [expanded, setExpanded]       = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const res  = await adminFetch('/api/admin/churn');
        const json = await res.json();
        setRestaurants(json.restaurants || []);
        setStats(json.stats || {});
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = restaurants.filter(r =>
    tierFilter === 'all' || r.tier === tierFilter
  );

  return (
    <AdminLayout title="Churn Forecast">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Churn Forecast</h1>
          <p style={s.subtitle}>Risk scoring based on engagement, invoices, and subscription status</p>
        </div>

        {/* ── Stat Cards ── */}
        <div style={s.statGrid}>
          {[
            { label: 'Total Scored',  value: stats.total  || 0, color: '#e4e6f0' },
            { label: 'High Risk',     value: stats.high   || 0, color: '#e85454' },
            { label: 'Medium Risk',   value: stats.medium || 0, color: '#f5a623' },
            { label: 'Low Risk',      value: stats.low    || 0, color: '#3de8a0' },
            { label: 'Avg Risk Score', value: stats.avgRisk || 0, color: stats.avgRisk >= 60 ? '#e85454' : stats.avgRisk >= 30 ? '#f5a623' : '#3de8a0' },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statLabel}>{stat.label}</div>
              <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* ── Tier Filter ── */}
        <div style={s.filterGroup}>
          {[
            { label: 'All',    value: 'all',    count: stats.total },
            { label: 'High',   value: 'high',   count: stats.high,   color: '#e85454' },
            { label: 'Medium', value: 'medium', count: stats.medium, color: '#f5a623' },
            { label: 'Low',    value: 'low',    count: stats.low,    color: '#3de8a0' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setTierFilter(f.value)}
              style={{
                ...s.filterBtn,
                borderColor: tierFilter === f.value ? (f.color || '#02a4ba') : '#1e2028',
                color: tierFilter === f.value ? (f.color || '#02a4ba') : '#5a6080',
                background: tierFilter === f.value ? `${f.color || '#02a4ba'}15` : 'none',
              }}
            >
              {f.label}
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, marginLeft: 4 }}>{f.count || 0}</span>
            </button>
          ))}
        </div>

        {/* ── List ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
        ) : filtered.length === 0 ? (
          <div style={{ ...s.center, flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 24 }}>🎉</span>
            <span style={{ color: '#3a3e50', fontSize: 12 }}>No restaurants in this risk tier</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(r => {
              const isExpanded = expanded === r.id;
              const tc = tierColor(r.tier);
              return (
                <div key={r.id} style={{
                  background: '#111318',
                  border: `1px solid ${r.tier === 'high' ? 'rgba(232,84,84,0.2)' : r.tier === 'medium' ? 'rgba(245,166,35,0.15)' : '#1e2028'}`,
                  borderRadius: 8, overflow: 'hidden',
                }}>
                  {/* ── Row ── */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                    onClick={() => setExpanded(isExpanded ? null : r.id)}
                  >
                    <RiskGauge score={r.risk_score} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e6f0' }}>{r.name}</div>
                      <div style={{ fontSize: 10, color: '#5a6080', marginTop: 1 }}>
                        {r.owner_email || 'No email'} · joined {timeAgo(r.created_at)}
                      </div>
                    </div>

                    {/* Top signals preview */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 280, justifyContent: 'flex-end' }}>
                      {r.signals.slice(0, 2).map((sig, i) => (
                        <span key={i} style={{
                          fontSize: 8, fontWeight: 600, padding: '2px 6px', borderRadius: 10,
                          background: '#1a1c23', border: '1px solid #1e2028', color: '#5a6080',
                        }}>
                          {sig.label}
                        </span>
                      ))}
                      {r.signals.length > 2 && (
                        <span style={{ fontSize: 8, color: '#3a3e50' }}>+{r.signals.length - 2} more</span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <TierPill tier={r.tier} />
                      <span style={{ fontSize: 10, color: '#3a3e50' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* ── Expanded ── */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #1a1c23', padding: '12px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>

                      {/* Stats */}
                      <div style={{ display: 'flex', gap: 20 }}>
                        {[
                          { label: 'Invoices (30d)',  value: r.stats.invoices_30d },
                          { label: 'Menu Items',      value: r.stats.menu_items },
                          { label: 'POS Rows (30d)',  value: r.stats.pos_30d },
                          { label: 'AI Calls (30d)',  value: r.stats.ai_calls_30d },
                          { label: 'Last Invoice',    value: timeAgo(r.stats.last_invoice) },
                          { label: 'Last AI Use',     value: timeAgo(r.stats.last_ai) },
                        ].map(stat => (
                          <div key={stat.label}>
                            <div style={{ fontSize: 8, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>{stat.label}</div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#7880a0' }}>{stat.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* All signals */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 8, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>Risk Signals</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {r.signals.map((sig, i) => (
                            <span key={i} style={{
                              fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 10,
                              background: `${tc.text}15`, border: `1px solid ${tc.text}40`, color: tc.text,
                            }}>
                              {sig.label} <span style={{ opacity: 0.6 }}>+{sig.weight}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => router.push(`/admin/restaurants/${r.id}`)}
                          style={s.actionBtn}
                        >
                          View Profile →
                        </button>
                        {r.owner_email && (
                          <a
                            href={`mailto:${r.owner_email}?subject=Your OptiMenu account&body=Hi ${r.owner_name || 'there'},`}
                            style={{ ...s.actionBtn, textDecoration: 'none', textAlign: 'center' }}
                          >
                            Email Owner
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
  statValue: { fontSize: 22, fontWeight: 600, lineHeight: 1, fontFamily: "'DM Mono', monospace" },
  filterGroup: { display: 'flex', gap: 4 },
  filterBtn: { padding: '6px 12px', fontSize: 10, fontWeight: 600, borderRadius: 20, border: '1px solid', cursor: 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', transition: 'all 0.15s' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  actionBtn: { padding: '6px 12px', fontSize: 10, fontWeight: 600, background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.25)', borderRadius: 6, color: '#02a4ba', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
};