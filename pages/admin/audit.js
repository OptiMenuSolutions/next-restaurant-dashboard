// pages/admin/audit.js
// Audit log — activity history across all restaurants.

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

const TYPE_COLORS = {
  invoice_created:   '#02a4ba',
  invoice_updated:   '#02a4ba',
  client_created:    '#3de8a0',
  prospect_created:  '#3de8a0',
  prospect_updated:  '#3de8a0',
  prospect_deleted:  '#e85454',
  user_login:        '#7880a0',
  user_logout:       '#7880a0',
  file_uploaded:     '#f5a623',
  menu_updated:      '#f5a623',
  settings_changed:  '#5a6080',
};

function dotColor(type) {
  return TYPE_COLORS[type] || '#3a3e50';
}

export default function AuditPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [activity, setActivity]       = useState([]);
  const [typeBreakdown, setTypes]     = useState([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('all');

  useEffect(() => {
    async function load() {
      try {
        const res  = await adminFetch('/api/admin/audit');
        const json = await res.json();
        setActivity(json.activity || []);
        setTypes(json.typeBreakdown || []);
        setTotal(json.total || 0);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = activity.filter(a => {
    const q = search.toLowerCase();
    if (q && !(
      (a.type || '').toLowerCase().includes(q) ||
      (a.restaurant_name || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q)
    )) return false;
    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    return true;
  });

  return (
    <AdminLayout title="Audit Log">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Audit Log</h1>
          <p style={s.subtitle}>{total} events · last 500 shown</p>
        </div>

        {/* ── Type Breakdown ── */}
        {typeBreakdown.length > 0 && (
          <div style={s.chipRow}>
            <button
              onClick={() => setTypeFilter('all')}
              style={{ ...s.chip, borderColor: typeFilter === 'all' ? '#02a4ba' : '#1e2028', color: typeFilter === 'all' ? '#02a4ba' : '#5a6080', background: typeFilter === 'all' ? 'rgba(2,164,186,0.1)' : 'none' }}
            >
              All <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9 }}>{total}</span>
            </button>
            {typeBreakdown.slice(0, 7).map(t => (
              <button
                key={t.type}
                onClick={() => setTypeFilter(t.type)}
                style={{ ...s.chip, borderColor: typeFilter === t.type ? dotColor(t.type) : '#1e2028', color: typeFilter === t.type ? dotColor(t.type) : '#5a6080', background: typeFilter === t.type ? `${dotColor(t.type)}15` : 'none' }}
              >
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor(t.type) }} />
                {t.type.replace(/_/g, ' ')} <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9 }}>{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Search ── */}
        <input
          style={s.search}
          placeholder="Search by type, restaurant, or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* ── Activity Feed ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /></div>
        ) : filtered.length === 0 ? (
          <div style={s.center}><span style={{ color: '#3a3e50', fontSize: 12 }}>No activity found</span></div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Type', 'Restaurant', 'Description', 'When'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr
                    key={a.id}
                    style={{ ...s.row, cursor: a.restaurant_id ? 'pointer' : 'default' }}
                    onClick={() => a.restaurant_id && router.push(`/admin/restaurants/${a.restaurant_id}`)}
                  >
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor(a.type), flexShrink: 0 }} />
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#5a6080' }}>
                          {(a.type || '').replace(/_/g, ' ')}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: '#7880a0' }}>
                      {a.restaurant_name || <span style={{ color: '#3a3e50' }}>—</span>}
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: '#e4e6f0' }}>
                      {a.description || '—'}
                    </td>
                    <td style={{ ...s.td, fontSize: 10, color: '#5a6080', whiteSpace: 'nowrap' }}>
                      {timeAgo(a.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { fontSize: 9, fontWeight: 600, padding: '4px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s', background: 'none' },
  search: { width: '100%', padding: '7px 12px', fontSize: 11, boxSizing: 'border-box', background: '#111318', border: '1px solid #1e2028', borderRadius: 6, color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none' },
  tableWrap: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '10px 14px', textAlign: 'left', borderBottom: '1px solid #1e2028', background: '#0f1115' },
  td: { padding: '11px 14px', borderBottom: '1px solid #0f1115', verticalAlign: 'middle' },
  row: { transition: 'background 0.1s' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};