// pages/admin/ingredients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconSearch,
  IconX,
  IconSortAscending,
  IconSortDescending,
  IconCurrencyDollar,
  IconCalendar,
  IconPackage,
  IconEye,
  IconRefresh,
  IconAlertTriangle,
  IconChefHat,
  IconTrendingUp,
  IconClock,
  IconFilter,
} from '@tabler/icons-react';

const DISPLAY_UNITS = [
  { group: 'Weight',  options: ['lb', 'oz', 'kg', 'g'] },
  { group: 'Volume',  options: ['gal', 'qt', 'cup', 'fl oz', 'ml', 'liter'] },
  { group: 'Count',   options: ['each', 'dozen', 'case'] },
];

export default function Ingredients() {
  const router = useRouter();
  const [ingredients, setIngredients] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchRestaurants();
    };
    checkUser();
  }, [router]);

  useEffect(() => { fetchIngredients(); }, [selectedRestaurant]);

  async function fetchRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, name').order('name');
    setRestaurants(data || []);
  }

  async function fetchIngredients() {
    try {
      setLoading(true);
      setError('');
      let query = supabase.from('ingredients').select('*').order('name');
      if (selectedRestaurant) query = query.eq('restaurant_id', selectedRestaurant);
      const { data, error } = await query;
      if (error) throw error;
      setIngredients(data || []);
    } catch (err) {
      setError('Failed to fetch ingredients: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisplayUnitChange(ingredientId, newUnit) {
    try {
      const { error } = await supabase.from('ingredients').update({ display_unit: newUnit }).eq('id', ingredientId);
      if (error) throw error;
      setIngredients(prev => prev.map(i => i.id === ingredientId ? { ...i, display_unit: newUnit } : i));
    } catch (err) {
      alert('Failed to update display unit: ' + err.message);
    }
  }

  function handleSort(col) {
    if (sortBy === col) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortOrder('asc'); }
  }

  function formatCurrency(amount) {
    const n = parseFloat(amount);
    if (!amount || isNaN(n)) return '—';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  function formatDate(d) {
    if (!d) return 'Never';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const filtered = ingredients
    .filter(i =>
      !searchTerm ||
      i.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.unit?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let av, bv;
      switch (sortBy) {
        case 'last_price':
          av = parseFloat(a.last_price) || 0;
          bv = parseFloat(b.last_price) || 0;
          break;
        case 'last_ordered_at':
          av = new Date(a.last_ordered_at || '1970-01-01');
          bv = new Date(b.last_ordered_at || '1970-01-01');
          break;
        case 'unit':
          av = (a.unit || '').toLowerCase();
          bv = (b.unit || '').toLowerCase();
          break;
        default:
          av = (a.name || '').toLowerCase();
          bv = (b.name || '').toLowerCase();
      }
      if (av < bv) return sortOrder === 'asc' ? -1 : 1;
      if (av > bv) return sortOrder === 'asc' ?  1 : -1;
      return 0;
    });

  const withPricing     = filtered.filter(i => i.last_price > 0).length;
  const recentlyOrdered = filtered.filter(i => i.last_ordered_at && new Date(i.last_ordered_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length;
  const avgPrice        = withPricing > 0 ? filtered.filter(i => i.last_price > 0).reduce((s, i) => s + i.last_price, 0) / withPricing : 0;
  const selectedName    = selectedRestaurant ? restaurants.find(r => r.id === selectedRestaurant)?.name || '' : 'All Restaurants';

  const SortIcon = ({ col }) => sortBy === col
    ? (sortOrder === 'asc' ? <IconSortAscending size={13} /> : <IconSortDescending size={13} />)
    : null;

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <AdminLayout pageTitle="Ingredients" pageDescription="Monitor ingredient costs" pageIcon={IconChefHat}>
        <div className="admin-card">
          <div className="admin-empty">
            <div className="admin-empty-icon" style={{ background: 'rgba(244,63,94,0.1)', borderColor: 'rgba(244,63,94,0.2)', color: '#f43f5e' }}>
              <IconAlertTriangle size={22} />
            </div>
            <h3>Error Loading Ingredients</h3>
            <p>{error}</p>
            <button className="admin-btn admin-btn-ghost" style={{ marginTop: 8 }} onClick={fetchIngredients}>
              <IconRefresh size={15} /> Retry
            </button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AdminLayout pageTitle="Ingredients" pageDescription="Monitor ingredient costs" pageIcon={IconChefHat}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading ingredients…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Ingredients" pageDescription="Monitor ingredient costs and availability" pageIcon={IconChefHat}>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Restaurant filter */}
        <div style={{ position: 'relative' }}>
          <IconFilter size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <select
            className="admin-select"
            value={selectedRestaurant}
            onChange={e => setSelectedRestaurant(e.target.value)}
            style={{ paddingLeft: 34, minWidth: 200 }}
          >
            <option value="">All Restaurants</option>
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        {/* Search */}
        <div className="admin-search-inline" style={{ flex: 1, minWidth: 220 }}>
          <IconSearch size={15} />
          <input
            placeholder="Search by name or unit…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
            >
              <IconX size={14} />
            </button>
          )}
        </div>

        <button className="admin-btn admin-btn-ghost" onClick={fetchIngredients}>
          <IconRefresh size={15} /> Refresh
        </button>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="admin-stat-card">
          <div className="admin-stat-icon teal"><IconPackage size={20} /></div>
          <div>
            <div className="admin-stat-value">{filtered.length}</div>
            <div className="admin-stat-label">Total Ingredients</div>
            <div className="admin-stat-sub">{selectedName}</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon emerald"><IconCurrencyDollar size={20} /></div>
          <div>
            <div className="admin-stat-value">{withPricing}</div>
            <div className="admin-stat-label">With Pricing</div>
            <div className="admin-stat-sub">
              {filtered.length > 0 ? Math.round((withPricing / filtered.length) * 100) : 0}% coverage
            </div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon amber"><IconClock size={20} /></div>
          <div>
            <div className="admin-stat-value">{recentlyOrdered}</div>
            <div className="admin-stat-label">Recent Orders</div>
            <div className="admin-stat-sub">Last 30 days</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon violet"><IconTrendingUp size={20} /></div>
          <div>
            <div className="admin-stat-value">{formatCurrency(avgPrice)}</div>
            <div className="admin-stat-label">Avg Cost</div>
            <div className="admin-stat-sub">Per unit</div>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Ingredient Database</h2>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {filtered.length} ingredient{filtered.length !== 1 ? 's' : ''}
            {searchTerm && ` matching "${searchTerm}"`}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon">
              {searchTerm ? <IconSearch size={22} /> : <IconChefHat size={22} />}
            </div>
            <h3>{searchTerm ? 'No ingredients found' : 'No ingredients yet'}</h3>
            <p>
              {searchTerm
                ? `No ingredients match "${searchTerm}"`
                : 'Ingredients will appear here after invoices are processed.'
              }
            </p>
            {searchTerm && (
              <button className="admin-btn admin-btn-ghost" style={{ marginTop: 8 }} onClick={() => setSearchTerm('')}>
                <IconX size={14} /> Clear search
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('name')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Ingredient <SortIcon col="name" />
                    </span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('last_price')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Latest Cost <SortIcon col="last_price" />
                    </span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('unit')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Unit <SortIcon col="unit" />
                    </span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('last_ordered_at')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Last Ordered <SortIcon col="last_ordered_at" />
                    </span>
                  </th>
                  <th>Display Unit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(ingredient => {
                  const hasPrice        = ingredient.last_price > 0;
                  const recentlyOrderedItem = ingredient.last_ordered_at &&
                    new Date(ingredient.last_ordered_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

                  return (
                    <tr
                      key={ingredient.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/admin/ingredients/${ingredient.id}`)}
                    >
                      {/* Name */}
                      <td className="primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                            background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981',
                          }}>
                            <IconChefHat size={15} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                              {ingredient.name || 'Unnamed ingredient'}
                            </div>
                            {recentlyOrderedItem && (
                              <span className="admin-badge emerald" style={{ marginTop: 3 }}>Recent</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Price */}
                      <td>
                        {hasPrice ? (
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '0.88rem' }}>
                            {formatCurrency(ingredient.last_price)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>No price data</span>
                        )}
                      </td>

                      {/* Unit */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <IconPackage size={13} style={{ color: 'var(--text-muted)' }} />
                          <span>{ingredient.unit || '—'}</span>
                        </div>
                      </td>

                      {/* Last Ordered */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <IconCalendar size={13} style={{ color: 'var(--text-muted)' }} />
                          <span>{formatDate(ingredient.last_ordered_at)}</span>
                        </div>
                      </td>

                      {/* Display Unit */}
                      <td onClick={e => e.stopPropagation()}>
                        <select
                          value={ingredient.display_unit || ingredient.unit || 'lb'}
                          onChange={e => handleDisplayUnitChange(ingredient.id, e.target.value)}
                          className="admin-select"
                          style={{ padding: '5px 10px', fontSize: '0.78rem', minWidth: 110 }}
                        >
                          {DISPLAY_UNITS.map(group => (
                            <optgroup key={group.group} label={group.group}>
                              {group.options.map(u => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>

                      {/* Actions */}
                      <td onClick={e => e.stopPropagation()}>
                        <button
                          className="admin-btn admin-btn-ghost admin-btn-sm"
                          onClick={() => router.push(`/admin/ingredients/${ingredient.id}`)}
                          title="View details"
                        >
                          <IconEye size={14} /> View
                        </button>
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