// pages/admin/data/invoices.js
// All invoices across all restaurants.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/admin/AdminLayout';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function StatusPill({ status }) {
  const map = {
    completed: { bg: 'rgba(61,232,160,0.1)',  border: 'rgba(61,232,160,0.25)',  text: '#3de8a0' },
    failed:    { bg: 'rgba(232,84,84,0.1)',   border: 'rgba(232,84,84,0.25)',  text: '#e85454' },
    pending:   { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)', text: '#f5a623' },
  };
  const c = map[status] || { bg: 'rgba(255,255,255,0.04)', border: '#1e2028', text: '#5a6080' };
  return (
    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      textTransform: 'capitalize', letterSpacing: '0.3px',
      background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {status || 'unknown'}
    </span>
  );
}

export default function InvoicesDataPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/data/invoices');
        const json = await res.json();
        setInvoices(json.invoices || []);
        setStats(json.stats || {});
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = invoices
    .filter(inv => {
      const q = search.toLowerCase();
      if (q && !( 
        (inv.restaurant_name || '').toLowerCase().includes(q) ||
        (inv.supplier || '').toLowerCase().includes(q) ||
        (inv.number || '').toLowerCase().includes(q)
      )) return false;
      if (statusFilter !== 'all' && inv.parse_status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'amount') return parseFloat(b.amount || 0) - parseFloat(a.amount || 0);
      if (sortBy === 'restaurant') return (a.restaurant_name || '').localeCompare(b.restaurant_name || '');
      return new Date(b.created_at) - new Date(a.created_at);
    });

  return (
    <AdminLayout title="Invoices">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Invoices</h1>
          <p style={s.subtitle}>All parsed invoices across every restaurant</p>
        </div>

        {/* ── Stat Cards ── */}
        <div style={s.statGrid}>
          {[
            { label: 'Total Invoices',   value: stats.total || 0,         color: '#e4e6f0' },
            { label: 'Completed',        value: stats.completed || 0,      color: '#3de8a0' },
            { label: 'Failed',           value: stats.failed || 0,         color: '#e85454' },
            { label: 'Success Rate',     value: `${stats.successRate || 0}%`, color: '#02a4ba' },
            { label: 'This Week',        value: stats.thisWeek || 0,       color: '#f5a623' },
            { label: 'Total Value',      value: `$${(stats.totalValue || 0).toLocaleString()}`, color: '#3de8a0', mono: true },
            { label: 'Avg Confidence',   value: stats.avgConfidence ? `${stats.avgConfidence}%` : '—', color: '#7880a0' },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statLabel}>{stat.label}</div>
              <div style={{ ...s.statValue, color: stat.color, fontFamily: stat.mono ? "'DM Mono', monospace" : undefined }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div style={s.filterRow}>
          <input
            style={s.search}
            placeholder="Search by restaurant, supplier, or invoice #…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={s.filterGroup}>
            {[
              { label: 'All',       value: 'all' },
              { label: 'Completed', value: 'completed' },
              { label: 'Failed',    value: 'failed' },
              { label: 'Pending',   value: 'pending' },
            ].map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                style={{ ...s.filterBtn, ...(statusFilter === f.value ? s.filterBtnActive : {}) }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select style={s.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="created_at">Newest first</option>
            <option value="amount">Highest amount</option>
            <option value="restaurant">Restaurant A–Z</option>
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
                  {['Restaurant', 'Supplier', 'Invoice #', 'Date', 'Amount', 'Status', 'Confidence', 'Parsed', ''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#3a3e50', padding: 32 }}>No invoices found</td></tr>
                ) : filtered.map(inv => (
                  <tr
                    key={inv.id}
                    style={s.row}
                    onClick={() => router.push(`/admin/restaurants/${inv.restaurant_id}`)}
                  >
                    <td style={s.td}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#e4e6f0' }}>{inv.restaurant_name}</div>
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: '#7880a0' }}>{inv.supplier || '—'}</td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#5a6080' }}>
                      {inv.number || '—'}
                    </td>
                    <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{inv.date || '—'}</td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#3de8a0' }}>
                      {inv.amount ? `$${parseFloat(inv.amount).toLocaleString()}` : '—'}
                    </td>
                    <td style={s.td}><StatusPill status={inv.parse_status} /></td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: inv.confidence_score >= 80 ? '#3de8a0' : inv.confidence_score >= 50 ? '#f5a623' : '#5a6080' }}>
                      {inv.confidence_score ? `${inv.confidence_score}%` : '—'}
                    </td>
                    <td style={{ ...s.td, fontSize: 10, color: '#5a6080' }}>{timeAgo(inv.created_at)}</td>
                    <td style={s.td}>
                      {inv.file_url && (
                        <a
                          href={inv.file_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 10, color: '#02a4ba', textDecoration: 'none' }}
                        >
                          PDF →
                        </a>
                      )}
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
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 },
  statCard: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: '12px 14px' },
  statLabel: { fontSize: 8, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  statValue: { fontSize: 20, fontWeight: 600, lineHeight: 1, fontFamily: "'DM Mono', monospace" },
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
    cursor: 'pointer', fontFamily: "'Inter', sans-serif",
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
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};