// pages/admin/restaurants.js
// All restaurants list with health scores, stats, and search.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

function healthColor(score) {
  if (score >= 80) return '#3de8a0';
  if (score >= 50) return '#f5a623';
  return '#e85454';
}

function statusColor(status) {
  const map = {
    active:   { bg: 'rgba(61,232,160,0.1)',  border: 'rgba(61,232,160,0.25)',  text: '#3de8a0' },
    trialing: { bg: 'rgba(2,164,186,0.1)',   border: 'rgba(2,164,186,0.25)',  text: '#02a4ba' },
    past_due: { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
    canceled: { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
    unknown:  { bg: 'rgba(255,255,255,0.04)', border: '#1e2028',              text: '#5a6080' },
  };
  return map[status] || map.unknown;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function RestaurantsPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/restaurants');
        const json = await res.json();
        setRestaurants(json.restaurants || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = restaurants
    .filter(r => {
      const q = search.toLowerCase();
      if (q && !r.name.toLowerCase().includes(q) && !(r.owner_email || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && r.subscription_status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'health') return a.health - b.health;
      if (sortBy === 'mrr') return b.mrr - a.mrr;
      if (sortBy === 'invoices') return b.invoice_count - a.invoice_count;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  const totalMRR = restaurants.filter(r => r.subscription_status === 'active').reduce((s, r) => s + r.mrr, 0);
  const atRiskCount = restaurants.filter(r => r.health < 50).length;

  return (
    <AdminLayout title="Restaurants">
      <div style={s.page}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>All Restaurants</h1>
            <p style={s.subtitle}>{restaurants.length} total · ${Math.round(totalMRR).toLocaleString()} MRR · {atRiskCount} at risk</p>
          </div>
        </div>

        {/* ── Filters ── */}
        <div style={s.filterRow}>
          <input
            style={s.search}
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={s.filterGroup}>
            {['all', 'active', 'trialing', 'past_due', 'canceled'].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                style={{ ...s.filterBtn, ...(statusFilter === status ? s.filterBtnActive : {}) }}
              >
                {status === 'all' ? 'All' : status.replace('_', ' ')}
              </button>
            ))}
          </div>
          <select style={s.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="created_at">Newest first</option>
            <option value="health">Health ↑</option>
            <option value="mrr">MRR ↓</option>
            <option value="invoices">Most invoices</option>
          </select>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Restaurant', 'Owner', 'Status', 'Health', 'Invoices', 'Menu Items', 'Joined', ''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#3a3e50', padding: 32 }}>No restaurants found</td></tr>
                ) : filtered.map(r => {
                  const sc = statusColor(r.subscription_status);
                  const hc = healthColor(r.health);
                  return (
                    <tr
                      key={r.id}
                      style={s.row}
                      onClick={() => router.push(`/admin/restaurants/${r.id}`)}
                    >
                      <td style={s.td}>
                        <div style={{ fontWeight: 600, color: '#e4e6f0', fontSize: 12 }}>{r.name}</div>
                        {r.failed_invoices > 0 && (
                          <div style={{ fontSize: 9, color: '#e85454', marginTop: 2 }}>⚠ {r.failed_invoices} failed parse{r.failed_invoices > 1 ? 's' : ''}</div>
                        )}
                      </td>
                      <td style={s.td}>
                        <div style={{ fontSize: 11, color: '#7880a0' }}>{r.owner_name || '—'}</div>
                        <div style={{ fontSize: 9, color: '#3a3e50' }}>{r.owner_email || '—'}</div>
                      </td>
                      <td style={s.td}>
                        <span style={{ ...s.pill, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text }}>
                          {r.subscription_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 48, height: 4, background: '#1a1c23', borderRadius: 2 }}>
                            <div style={{ width: `${r.health}%`, height: 4, borderRadius: 2, background: hc }} />
                          </div>
                          <span style={{ fontSize: 10, color: hc, fontFamily: "'DM Mono', monospace" }}>{r.health}</span>
                        </div>
                      </td>
                      <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#7880a0' }}>{r.invoice_count}</td>
                      <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#7880a0' }}>{r.menu_item_count}</td>
                      <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{timeAgo(r.created_at)}</td>
                      <td style={s.td}>
                        <span style={{ fontSize: 10, color: '#02a4ba' }}>View →</span>
                      </td>
                    </tr>
                  );
                })}
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
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: 700, color: '#e4e6f0', letterSpacing: '-0.5px', fontFamily: "'Playfair Display', serif", margin: 0 },
  subtitle: { fontSize: 10, color: '#3a3e50', marginTop: 3 },
  filterRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  search: {
    flex: 1, minWidth: 200, padding: '7px 12px', fontSize: 11,
    background: '#111318', border: '1px solid #1e2028', borderRadius: 6,
    color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none',
  },
  filterGroup: { display: 'flex', gap: 4 },
  filterBtn: {
    padding: '6px 10px', fontSize: 10, fontWeight: 500, borderRadius: 6,
    border: '1px solid #1e2028', background: 'none', color: '#5a6080',
    cursor: 'pointer', fontFamily: "'Inter', sans-serif", textTransform: 'capitalize',
  },
  filterBtnActive: { background: 'rgba(2,164,186,0.1)', borderColor: 'rgba(2,164,186,0.3)', color: '#02a4ba' },
  sortSelect: {
    padding: '6px 10px', fontSize: 10, background: '#111318',
    border: '1px solid #1e2028', borderRadius: 6, color: '#5a6080',
    fontFamily: "'Inter', sans-serif", cursor: 'pointer', outline: 'none',
  },
  tableWrap: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase',
    letterSpacing: '0.8px', padding: '10px 14px', textAlign: 'left',
    borderBottom: '1px solid #1e2028', background: '#0f1115',
  },
  td: { padding: '11px 14px', borderBottom: '1px solid #0f1115', verticalAlign: 'middle' },
  row: { cursor: 'pointer', transition: 'background 0.1s' },
  pill: { fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20, textTransform: 'capitalize', letterSpacing: '0.3px' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};