// pages/admin/errors.js
// Error queue — view and triage application errors.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusPill({ status }) {
  const map = {
    open:          { bg: 'rgba(232,84,84,0.1)',  border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
    investigating: { bg: 'rgba(245,166,35,0.1)', border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
    resolved:      { bg: 'rgba(61,232,160,0.1)', border: 'rgba(61,232,160,0.25)', text: '#3de8a0' },
  };
  const c = map[status] || map.open;
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'capitalize', letterSpacing: '0.3px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {status}
    </span>
  );
}

export default function ErrorsPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [errors, setErrors]             = useState([]);
  const [stats, setStats]               = useState({});
  const [featureBreakdown, setFeature]  = useState([]);
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('open');
  const [updating, setUpdating]         = useState({});
  const [expanded, setExpanded]         = useState(null);

  async function load() {
    try {
      const res  = await adminFetch('/api/admin/errors');
      const json = await res.json();
      setErrors(json.errors || []);
      setStats(json.stats || {});
      setFeature(json.featureBreakdown || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(id, status) {
    setUpdating(u => ({ ...u, [id]: true }));
    try {
      await adminFetch('/api/admin/errors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      setErrors(prev => prev.map(e => e.id === id ? { ...e, status } : e));
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(u => ({ ...u, [id]: false }));
    }
  }

  const filtered = errors.filter(e =>
    statusFilter === 'all' || e.status === statusFilter
  );

  return (
    <AdminLayout title="Error Queue">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Error Queue</h1>
          <p style={s.subtitle}>{stats.open || 0} open · {stats.investigating || 0} investigating · {stats.resolved || 0} resolved</p>
        </div>

        {/* ── Feature Breakdown ── */}
        {featureBreakdown.length > 0 && (
          <div style={s.chipRow}>
            <span style={{ fontSize: 9, color: '#3a3e50' }}>Open by feature:</span>
            {featureBreakdown.map(f => (
              <span key={f.feature} style={s.chip}>
                {f.feature} <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#e85454' }}>{f.count}</span>
              </span>
            ))}
          </div>
        )}

        {/* ── Filters ── */}
        <div style={s.filterGroup}>
          {['all', 'open', 'investigating', 'resolved'].map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              style={{ ...s.filterBtn, ...(statusFilter === f ? s.filterBtnActive : {}) }}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'all' && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, marginLeft: 4 }}>{stats[f] || 0}</span>}
            </button>
          ))}
        </div>

        {/* ── List ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ ...s.center, flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 24 }}>🎉</span>
            <span style={{ color: '#3a3e50', fontSize: 12 }}>No errors in this category</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(err => (
              <div key={err.id} style={{ ...s.card, borderColor: err.status === 'open' ? 'rgba(232,84,84,0.2)' : '#1e2028' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <StatusPill status={err.status} />
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#02a4ba', background: 'rgba(2,164,186,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                        {err.feature}
                      </span>
                      {err.restaurant_name && (
                        <span
                          style={{ fontSize: 10, color: '#5a6080', cursor: 'pointer' }}
                          onClick={() => router.push(`/admin/restaurants/${err.restaurant_id}`)}
                        >
                          {err.restaurant_name} →
                        </span>
                      )}
                      <span style={{ fontSize: 9, color: '#3a3e50', marginLeft: 'auto' }}>{timeAgo(err.created_at)}</span>
                    </div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#e4e6f0', margin: '0 0 4px' }}>
                      {err.error_message}
                    </p>
                    {err.error_stack && (
                      <>
                        <button
                          onClick={() => setExpanded(expanded === err.id ? null : err.id)}
                          style={{ fontSize: 9, color: '#3a3e50', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'Inter', sans-serif" }}
                        >
                          {expanded === err.id ? '▲ Hide stack trace' : '▼ Show stack trace'}
                        </button>
                        {expanded === err.id && (
                          <pre style={{ fontSize: 9, color: '#5a6080', background: '#0a0908', borderRadius: 4, padding: 8, marginTop: 6, overflow: 'auto', maxHeight: 120, fontFamily: "'DM Mono', monospace" }}>
                            {err.error_stack}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    {['open', 'investigating', 'resolved'].map(status => (
                      <button
                        key={status}
                        disabled={err.status === status || updating[err.id]}
                        onClick={() => updateStatus(err.id, status)}
                        style={{
                          ...s.statusBtn,
                          opacity: err.status === status ? 1 : 0.5,
                          background: err.status === status ? 'rgba(2,164,186,0.15)' : 'none',
                          borderColor: err.status === status ? 'rgba(2,164,186,0.3)' : '#1e2028',
                          color: err.status === status ? '#02a4ba' : '#5a6080',
                          cursor: err.status === status ? 'default' : 'pointer',
                        }}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
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
  chipRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: { fontSize: 9, fontWeight: 500, padding: '3px 8px', borderRadius: 10, background: '#1a1c23', border: '1px solid #1e2028', color: '#5a6080', display: 'flex', alignItems: 'center', gap: 4 },
  filterGroup: { display: 'flex', gap: 4 },
  filterBtn: { padding: '6px 10px', fontSize: 10, fontWeight: 500, borderRadius: 6, border: '1px solid #1e2028', background: 'none', color: '#5a6080', cursor: 'pointer', fontFamily: "'Inter', sans-serif", textTransform: 'capitalize' },
  filterBtnActive: { background: 'rgba(2,164,186,0.1)', borderColor: 'rgba(2,164,186,0.3)', color: '#02a4ba' },
  card: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: 14 },
  statusBtn: { padding: '4px 10px', fontSize: 9, fontWeight: 600, borderRadius: 5, border: '1px solid', fontFamily: "'Inter', sans-serif", textTransform: 'capitalize' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};