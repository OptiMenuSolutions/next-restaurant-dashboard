// pages/admin/at-risk.js
// At-Risk restaurants page — shows churn signals and health scores.

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

function severityStyle(severity) {
  const map = {
    high:   { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
    medium: { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
    low:    { bg: 'rgba(90,96,128,0.1)',   border: 'rgba(90,96,128,0.25)',  text: '#5a6080' },
  };
  const c = map[severity] || map.low;
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'uppercase', letterSpacing: '0.5px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {severity}
    </span>
  );
}

function signalColor(severity) {
  if (severity === 'high')   return '#e85454';
  if (severity === 'medium') return '#f5a623';
  return '#5a6080';
}

function healthColor(score) {
  if (score >= 70) return '#3de8a0';
  if (score >= 40) return '#f5a623';
  return '#e85454';
}

export default function AtRiskPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/at-risk');
        const json = await res.json();
        setRestaurants(json.atRisk || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = restaurants.filter(r =>
    severityFilter === 'all' || r.severity === severityFilter
  );

  const highCount   = restaurants.filter(r => r.severity === 'high').length;
  const mediumCount = restaurants.filter(r => r.severity === 'medium').length;
  const lowCount    = restaurants.filter(r => r.severity === 'low').length;

  return (
    <AdminLayout title="At Risk">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>At-Risk Restaurants</h1>
          <p style={s.subtitle}>{restaurants.length} restaurants flagged · sorted by severity</p>
        </div>

        {/* ── Summary Chips ── */}
        <div style={s.chipRow}>
          {[
            { label: 'All',    value: 'all',    count: restaurants.length, color: '#5a6080' },
            { label: 'High',   value: 'high',   count: highCount,          color: '#e85454' },
            { label: 'Medium', value: 'medium', count: mediumCount,        color: '#f5a623' },
            { label: 'Low',    value: 'low',    count: lowCount,           color: '#5a6080' },
          ].map(chip => (
            <button
              key={chip.value}
              onClick={() => setSeverityFilter(chip.value)}
              style={{
                ...s.chip,
                borderColor: severityFilter === chip.value ? chip.color : '#1e2028',
                color: severityFilter === chip.value ? chip.color : '#5a6080',
                background: severityFilter === chip.value ? `${chip.color}15` : 'none',
              }}
            >
              {chip.label} <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{chip.count}</span>
            </button>
          ))}
        </div>

        {/* ── List ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
        ) : filtered.length === 0 ? (
          <div style={{ ...s.center, flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 24 }}>🎉</span>
            <span style={{ color: '#3a3e50', fontSize: 12 }}>No at-risk restaurants in this category</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(r => {
              const isExpanded = expanded === r.id;
              const hc = healthColor(r.health);
              return (
                <div key={r.id} style={{ background: '#111318', border: `1px solid ${r.severity === 'high' ? 'rgba(232,84,84,0.2)' : r.severity === 'medium' ? 'rgba(245,166,35,0.15)' : '#1e2028'}`, borderRadius: 8, overflow: 'hidden' }}>

                  {/* ── Row ── */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                    onClick={() => setExpanded(isExpanded ? null : r.id)}
                  >
                    {/* Health bar */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', border: `2px solid ${hc}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: hc, fontWeight: 700 }}>{r.health}</span>
                      </div>
                    </div>

                    {/* Name + email */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e6f0' }}>{r.name}</div>
                      <div style={{ fontSize: 10, color: '#5a6080', marginTop: 1 }}>
                        {r.owner_email || 'No email'} · joined {timeAgo(r.created_at)}
                      </div>
                    </div>

                    {/* Signal pills */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 320, justifyContent: 'flex-end' }}>
                      {r.signals.slice(0, 3).map((sig, i) => (
                        <span key={i} style={{
                          fontSize: 8, fontWeight: 600, padding: '2px 6px', borderRadius: 10,
                          background: `${signalColor(sig.severity)}15`,
                          border: `1px solid ${signalColor(sig.severity)}40`,
                          color: signalColor(sig.severity),
                        }}>
                          {sig.label}
                        </span>
                      ))}
                      {r.signals.length > 3 && (
                        <span style={{ fontSize: 8, color: '#3a3e50' }}>+{r.signals.length - 3} more</span>
                      )}
                    </div>

                    {/* Severity + expand */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {severityStyle(r.severity)}
                      <span style={{ fontSize: 10, color: '#3a3e50' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* ── Expanded Detail ── */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #1a1c23', padding: '12px 16px', display: 'flex', gap: 24 }}>

                      {/* Stats */}
                      <div style={{ display: 'flex', gap: 20 }}>
                        {[
                          { label: 'Invoices',    value: r.invoice_count },
                          { label: 'Menu Items',  value: r.menu_count },
                          { label: 'Ingredients', value: r.ingredient_count },
                          { label: 'Failed Parses', value: r.failed_parses, danger: r.failed_parses > 0 },
                          { label: 'Last Invoice', value: timeAgo(r.last_invoice) },
                          { label: 'Last POS',     value: timeAgo(r.last_pos) },
                        ].map(stat => (
                          <div key={stat.label}>
                            <div style={{ fontSize: 8, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>{stat.label}</div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: stat.danger ? '#e85454' : '#7880a0' }}>{stat.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* All signals */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 8, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>All Signals</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {r.signals.map((sig, i) => (
                            <span key={i} style={{
                              fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 10,
                              background: `${signalColor(sig.severity)}15`,
                              border: `1px solid ${signalColor(sig.severity)}40`,
                              color: signalColor(sig.severity),
                            }}>
                              {sig.label}
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
                            href={`mailto:${r.owner_email}?subject=Your OptiMenu account&amp;body=Hi ${r.owner_name || 'there'},`}
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
  chipRow: { display: 'flex', gap: 6 },
  chip: { padding: '6px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, border: '1px solid', cursor: 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  actionBtn: { padding: '6px 12px', fontSize: 10, fontWeight: 600, background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.25)', borderRadius: 6, color: '#02a4ba', cursor: 'pointer', fontFamily: "'Inter', sans-serif' " },
};