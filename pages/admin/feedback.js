// pages/admin/feedback.js
// User feedback submissions — with fixed filter button focus ring.

import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { FilterButton } from '../../lib/admin/usePagination';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TYPE_COLORS = {
  bug:     { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
  feature: { bg: 'rgba(2,164,186,0.1)',   border: 'rgba(2,164,186,0.25)', text: '#02a4ba' },
  invoice: { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)',text: '#f5a623' },
  general: { bg: 'rgba(90,96,128,0.1)',   border: 'rgba(90,96,128,0.25)', text: '#5a6080' },
  other:   { bg: 'rgba(90,96,128,0.1)',   border: 'rgba(90,96,128,0.25)', text: '#5a6080' },
};

function TypePill({ type }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.other;
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'capitalize', letterSpacing: '0.3px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {type}
    </span>
  );
}

export default function FeedbackPage() {
  const { adminFetch } = useAdminFetch();
  const [feedback, setFeedback]         = useState([]);
  const [stats, setStats]               = useState({});
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('new');
  const [typeFilter, setTypeFilter]     = useState('all');
  const [updating, setUpdating]         = useState({});
  const [expanded, setExpanded]         = useState(null);

  async function load() {
    try {
      const res  = await adminFetch('/api/admin/feedback');
      const json = await res.json();
      setFeedback(json.feedback || []);
      setStats(json.stats || {});
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
      await adminFetch('/api/admin/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      setFeedback(prev => prev.map(f => f.id === id ? { ...f, status } : f));
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(u => ({ ...u, [id]: false }));
    }
  }

  const filtered = feedback.filter(f => {
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (typeFilter   !== 'all' && f.type   !== typeFilter)   return false;
    return true;
  });

  return (
    <AdminLayout title="Feedback">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Feedback</h1>
          <p style={s.subtitle}>{stats.new || 0} new · {stats.reviewed || 0} reviewed · {stats.resolved || 0} resolved</p>
        </div>

        {/* ── Filters — FilterButton fixes the white focus-border bug ── */}
        <div style={s.filterRow}>
          <div style={s.filterGroup}>
            {['all', 'new', 'reviewed', 'resolved'].map(f => (
              <FilterButton key={f} active={statusFilter === f} onClick={() => setStatusFilter(f)}>
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                {f !== 'all' && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, marginLeft: 4 }}>{stats[f] || 0}</span>}
              </FilterButton>
            ))}
          </div>
          <div style={s.filterGroup}>
            {['all', 'bug', 'feature', 'invoice', 'general', 'other'].map(t => (
              <FilterButton key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
                {t === 'all' ? 'All Types' : t}
              </FilterButton>
            ))}
          </div>
        </div>

        {/* ── List ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /></div>
        ) : filtered.length === 0 ? (
          <div style={s.center}><span style={{ color: '#3a3e50', fontSize: 12 }}>No feedback found</span></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(f => (
              <div key={f.id} style={s.card}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <TypePill type={f.type} />
                      {f.restaurant_name && <span style={{ fontSize: 10, color: '#5a6080' }}>{f.restaurant_name}</span>}
                      <span style={{ fontSize: 9, color: '#3a3e50', marginLeft: 'auto' }}>{timeAgo(f.created_at)}</span>
                    </div>
                    <p style={{
                      fontSize: 12, color: '#e4e6f0', margin: 0, lineHeight: 1.5,
                      ...(expanded !== f.id ? { overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } : {})
                    }}>
                      {f.message}
                    </p>
                    {f.message.length > 120 && (
                      <button
                        onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                        style={{ fontSize: 10, color: '#02a4ba', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 0', fontFamily: "'Inter', sans-serif", outline: 'none' }}
                      >
                        {expanded === f.id ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                  {/* Status buttons — outline:none fixes the persistent border bug */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    {['new', 'reviewed', 'resolved'].map(status => (
                      <button
                        key={status}
                        disabled={f.status === status || updating[f.id]}
                        onClick={() => updateStatus(f.id, status)}
                        style={{
                          ...s.statusBtn,
                          opacity: f.status === status ? 1 : 0.5,
                          background: f.status === status ? 'rgba(2,164,186,0.15)' : 'none',
                          borderColor: f.status === status ? 'rgba(2,164,186,0.3)' : '#1e2028',
                          color: f.status === status ? '#02a4ba' : '#5a6080',
                          cursor: f.status === status ? 'default' : 'pointer',
                          outline: 'none',
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
  filterRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterGroup: { display: 'flex', gap: 4 },
  card: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: 14 },
  statusBtn: { padding: '4px 10px', fontSize: 9, fontWeight: 600, borderRadius: 5, border: '1px solid', fontFamily: "'Inter', sans-serif", textTransform: 'capitalize' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};