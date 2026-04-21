// pages/admin/data/menu.js
// All menu items across all restaurants.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/admin/AdminLayout';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';

function marginColor(margin) {
  if (margin === null) return '#3a3e50';
  if (margin >= 70) return '#3de8a0';
  if (margin >= 50) return '#f5a623';
  return '#e85454';
}

export default function MenuDataPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const [menuItems, setMenuItems] = useState([]);
  const [stats, setStats] = useState({});
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch('/api/admin/data/menu');
        const json = await res.json();
        setMenuItems(json.menuItems || []);
        setStats(json.stats || {});
        setCategories(json.categories || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminFetch]);

  const filtered = menuItems
    .filter(item => {
      const q = search.toLowerCase();
      if (q && !(
        (item.name || '').toLowerCase().includes(q) ||
        (item.restaurant_name || '').toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q)
      )) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'margin') return (b.margin ?? -1) - (a.margin ?? -1);
      if (sortBy === 'price')  return parseFloat(b.price || 0) - parseFloat(a.price || 0);
      if (sortBy === 'name')   return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'restaurant') return (a.restaurant_name || '').localeCompare(b.restaurant_name || '');
      return new Date(b.created_at) - new Date(a.created_at);
    });

  return (
    <AdminLayout title="Menu Items">
      <div style={s.page}>

        {/* ── Header ── */}
        <div>
          <h1 style={s.title}>Menu Items</h1>
          <p style={s.subtitle}>All dishes across every restaurant</p>
        </div>

        {/* ── Stat Cards ── */}
        <div style={s.statGrid}>
          {[
            { label: 'Total Items',       value: stats.total || 0,           color: '#e4e6f0' },
            { label: 'Restaurants',       value: stats.restaurantCount || 0, color: '#02a4ba' },
            { label: 'With Price',        value: stats.withPrice || 0,       color: '#7880a0' },
            { label: 'With Cost',         value: stats.withCost || 0,        color: '#7880a0' },
            { label: 'Avg Margin',        value: stats.avgMargin != null ? `${stats.avgMargin}%` : '—', color: marginColor(stats.avgMargin) },
            { label: 'Avg Price',         value: stats.avgPrice != null ? `$${stats.avgPrice}` : '—', color: '#3de8a0' },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statLabel}>{stat.label}</div>
              <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* ── Category Breakdown ── */}
        {categories.length > 0 && (
          <div style={s.catRow}>
            {categories.slice(0, 8).map(cat => (
              <button
                key={cat.name}
                onClick={() => setCategoryFilter(categoryFilter === cat.name ? 'all' : cat.name)}
                style={{
                  ...s.catChip,
                  borderColor: categoryFilter === cat.name ? '#02a4ba' : '#1e2028',
                  color: categoryFilter === cat.name ? '#02a4ba' : '#5a6080',
                  background: categoryFilter === cat.name ? 'rgba(2,164,186,0.1)' : 'none',
                }}
              >
                {cat.name} <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9 }}>{cat.count}</span>
              </button>
            ))}
            {categoryFilter !== 'all' && (
              <button onClick={() => setCategoryFilter('all')} style={{ ...s.catChip, color: '#3a3e50', borderColor: '#1e2028' }}>
                Clear ×
              </button>
            )}
          </div>
        )}

        {/* ── Filters ── */}
        <div style={s.filterRow}>
          <input
            style={s.search}
            placeholder="Search by dish name, restaurant, or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select style={s.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="created_at">Newest first</option>
            <option value="margin">Highest margin</option>
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
                  {['Dish', 'Restaurant', 'Category', 'Price', 'Cost', 'Margin'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#3a3e50', padding: 32 }}>No items found</td></tr>
                ) : filtered.map(item => (
                  <tr
                    key={item.id}
                    style={s.row}
                    onClick={() => router.push(`/admin/restaurants/${item.restaurant_id}`)}
                  >
                    <td style={s.td}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#e4e6f0' }}>{item.name}</div>
                      {item.description && (
                        <div style={{ fontSize: 9, color: '#3a3e50', marginTop: 2, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.description}
                        </div>
                      )}
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: '#7880a0' }}>{item.restaurant_name}</td>
                    <td style={s.td}>
                      <span style={{ fontSize: 9, color: '#5a6080', background: '#1a1c23', borderRadius: 4, padding: '2px 6px' }}>
                        {item.category || 'Uncategorized'}
                      </span>
                    </td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#3de8a0' }}>
                      {item.price ? `$${parseFloat(item.price).toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...s.td, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#7880a0' }}>
                      {item.cost ? `$${parseFloat(item.cost).toFixed(2)}` : '—'}
                    </td>
                    <td style={s.td}>
                      {item.margin !== null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 36, height: 4, background: '#1a1c23', borderRadius: 2 }}>
                            <div style={{ width: `${Math.min(item.margin, 100)}%`, height: 4, borderRadius: 2, background: marginColor(item.margin) }} />
                          </div>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: marginColor(item.margin) }}>
                            {item.margin}%
                          </span>
                        </div>
                      ) : <span style={{ color: '#3a3e50', fontSize: 10 }}>—</span>}
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
  catRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  catChip: { padding: '5px 10px', fontSize: 10, fontWeight: 500, borderRadius: 20, border: '1px solid', cursor: 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s' },
  filterRow: { display: 'flex', alignItems: 'center', gap: 8 },
  search: {
    flex: 1, padding: '7px 12px', fontSize: 11,
    background: '#111318', border: '1px solid #1e2028', borderRadius: 6,
    color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none',
  },
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