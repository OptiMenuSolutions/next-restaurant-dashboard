// pages/admin/data/ingredients.js
// All ingredients across all restaurants.

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
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function staleColor(dateStr) {
  if (!dateStr) return '#3a3e50';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days < 30) return '#3de8a0';
  if (days < 60) return '#f5a623';
  return '#e85454';
}

export default function IngredientsDataPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [ingredients, setIngredients] = useState([]);
  const [stats, setStats] = useState({});
  const [categoryBreakdown, setCategoryBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [estimatedFilter, setEstimatedFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/data/ingredients');
        const json = await res.json();
        setIngredients(json.ingredients || []);
        setStats(json.stats || {});
        setCategoryBreakdown(json.categoryBreakdown || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = ingredients
    .filter(ing => {
      const q = search.toLowerCase();
      if (q && !(
        (ing.name || '').toLowerCase().includes(q) ||
        (ing.restaurant_name || '').toLowerCase().includes(q) ||
        (ing.unit || '').toLowerCase().includes(q)
      )) return false;
      if (estimatedFilter === 'estimated' && !ing.is_estimated) return false;
      if (estimatedFilter === 'real' && ing.is_estimated) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'price')      return parseFloat(b.last_price || 0) - parseFloat(a.last_price || 0);
      if (sortBy === 'name')       return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'restaurant') return (a.restaurant_name || '').localeCompare(b.restaurant_name || '');
      if (sortBy === 'ordered')    return new Date(b.last_ordered_at || 0) - new Date(a.last_ordered_at || 0);
      return new Date(b.created_at) - new Date(a.created_at);
    });

  return (
    <AdminLayout title="Ingredients">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Ingredients</h1>
          <p style={s.subtitle}>All ingredients across every restaurant</p>
        </div>

        {/* ── Stat Cards ── */}
        <div style={s.statGrid}>
          {[
            { label: 'Total',        value: stats.total || 0,           color: '#e4e6f0' },
            { label: 'Restaurants',  value: stats.restaurantCount || 0, color: '#02a4ba' },
            { label: 'Real Prices',  value: stats.real || 0,            color: '#3de8a0' },
            { label: 'Estimated',    value: stats.estimated || 0,       color: '#f5a623' },
            { label: 'Stale (60d+)', value: stats.stale || 0,           color: '#e85454' },
            { label: 'Avg Price',    value: stats.avgPrice != null ? `$${stats.avgPrice}` : '—', color: '#7880a0' },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statLabel}>{stat.label}</div>
              <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* ── Category Chips ── */}
        {categoryBreakdown.length > 0 && (
          <div style={s.catRow}>
            <span style={{ fontSize: 9, color: '#3a3e50' }}>Categories:</span>
            {categoryBreakdown.slice(0, 6).map(cat => (
              <span key={cat.name} style={s.catChip}>
                {cat.name} <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#02a4ba' }}>{cat.count}</span>
              </span>
            ))}
          </div>
        )}

        {/* ── Filters ── */}
        <div style={s.filterRow}>
          <input
            style={s.search}
            placeholder="Search by ingredient, restaurant, or unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={s.filterGroup}>
            {[
              { label: 'All',       value: 'all' },
              { label: 'Real',      value: 'real' },
              { label: 'Estimated', value: 'estimated' },
            ].map(f => (
              <button
                key={f.value}
                onClick={() => setEstimatedFilter(f.value)}
                style={{ ...s.filterBtn, ...(estimatedFilter === f.value ? s.filterBtnActive : {}) }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select style={s.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="created_at">Newest first</option>
            <option value="ordered">Last ordered</option>
            <option value="price">Highest price</option>
            <option value="name">Name A–Z</option>
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
                  {['Ingredient', 'Restaurant', 'Unit', 'Last Price', 'Last Ordered', 'Category', 'Price Type'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#3a3e50', padding: 32 }}>No ingredients found</td></tr>
                ) : filtered.map(ing => (
                  <tr
                    key={ing.id}
                    style={s.row}
                    onClick={() => router.push(`/admin/restaurants/${ing.restaurant_id}`)}
                  >
                    <td style={s.td}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#e4e6f0' }}>{ing.name}</div>
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: '#7880a0' }}>{ing.restaurant_name}</td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#5a6080' }}>
                      {ing.unit || '—'}
                    </td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#3de8a0' }}>
                      {ing.last_price ? `$${parseFloat(ing.last_price).toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...s.td, fontSize: 10, color: staleColor(ing.last_ordered_at) }}>
                      {timeAgo(ing.last_ordered_at)}
                    </td>
                    <td style={s.td}>
                      <span style={{ fontSize: 9, color: '#5a6080', background: '#1a1c23', borderRadius: 4, padding: '2px 6px' }}>
                        {ing.ingredient_category || '—'}
                      </span>
                    </td>
                    <td style={s.td}>
                      {ing.is_estimated
                        ? <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.25)', color: '#f5a623' }}>estimated</span>
                        : <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(61,232,160,0.1)', border: '1px solid rgba(61,232,160,0.25)', color: '#3de8a0' }}>real</span>
                      }
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
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 },
  statCard: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: '12px 14px' },
  statLabel: { fontSize: 8, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  statValue: { fontSize: 20, fontWeight: 600, lineHeight: 1, fontFamily: "'DM Mono', monospace" },
  catRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  catChip: { fontSize: 9, fontWeight: 500, padding: '3px 8px', borderRadius: 10, background: '#1a1c23', border: '1px solid #1e2028', color: '#5a6080', display: 'flex', alignItems: 'center', gap: 5 },
  filterRow: { display: 'flex', alignItems: 'center', gap: 8 },
  search: {
    flex: 1, padding: '7px 12px', fontSize: 11,
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