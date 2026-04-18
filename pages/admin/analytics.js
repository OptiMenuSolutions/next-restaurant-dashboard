// pages/admin/analytics.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconTrendingUp,
  IconFilter,
  IconCurrencyDollar,
  IconFileText,
  IconBook,
  IconToolsKitchen2,
  IconArrowUp,
  IconArrowDown,
  IconRefresh,
  IconChefHat,
} from '@tabler/icons-react';

export default function Analytics() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState({
    costHistory: [],
    ingredientTrends: [],
    menuItemStats: [],
    invoiceStats: {},
  });

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchRestaurants();
    };
    checkUser();
  }, [router]);

  useEffect(() => {
    if (selectedRestaurant) fetchAnalytics();
  }, [selectedRestaurant]);

  async function fetchRestaurants() {
    try {
      const { data } = await supabase.from('restaurants').select('id, name').order('name');
      setRestaurants(data || []);
      if (data?.length > 0) setSelectedRestaurant(data[0].id);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function fetchAnalytics() {
    if (!selectedRestaurant) return;
    try {
      setRefreshing(true);

      const [
        { data: costHistory },
        { data: ingredients },
        { data: menuItems },
        { data: invoices },
      ] = await Promise.all([
        supabase.from('menu_item_cost_history').select('*').eq('restaurant_id', selectedRestaurant).order('created_at', { ascending: false }).limit(50),
        supabase.from('ingredients').select('*').eq('restaurant_id', selectedRestaurant).order('last_ordered_at', { ascending: false }),
        supabase.from('menu_items').select('*').eq('restaurant_id', selectedRestaurant).order('cost', { ascending: false }),
        supabase.from('invoices').select('*').eq('restaurant_id', selectedRestaurant),
      ]);

      const invoiceStats = {
        total:      (invoices || []).length,
        totalValue: (invoices || []).reduce((s, inv) => s + (inv.amount || 0), 0),
        avgValue:   (invoices || []).length > 0
          ? (invoices || []).reduce((s, inv) => s + (inv.amount || 0), 0) / (invoices || []).length
          : 0,
        lastMonth:  (invoices || []).filter(inv => new Date(inv.created_at) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length,
      };

      setAnalytics({
        costHistory:      costHistory || [],
        ingredientTrends: ingredients || [],
        menuItemStats:    menuItems   || [],
        invoiceStats,
      });
    } catch (e) { console.error(e); }
    finally { setRefreshing(false); }
  }

  // ── derived data ──────────────────────────────────────────────────────────
  const recentChanges = analytics.costHistory.slice(0, 10);
  const avgCostChange = recentChanges.length > 0
    ? recentChanges.reduce((s, c) => s + (c.new_cost - c.old_cost), 0) / recentChanges.length
    : 0;

  const topIngredients = analytics.ingredientTrends
    .filter(i => i.last_price > 0)
    .sort((a, b) => b.last_price - a.last_price)
    .slice(0, 5);

  const topMenuItems = analytics.menuItemStats
    .filter(i => i.cost > 0)
    .slice(0, 5);

  const selectedName = restaurants.find(r => r.id === selectedRestaurant)?.name || '';

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AdminLayout pageTitle="Analytics" pageDescription="Cost trends and performance insights" pageIcon={IconTrendingUp}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading analytics…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Analytics" pageDescription="Cost trends and performance insights" pageIcon={IconTrendingUp}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <IconFilter size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <select
            className="admin-select"
            value={selectedRestaurant}
            onChange={e => setSelectedRestaurant(e.target.value)}
            style={{ paddingLeft: 34, minWidth: 220 }}
          >
            <option value="">Select a restaurant…</option>
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <button
          className="admin-btn admin-btn-ghost"
          onClick={fetchAnalytics}
          disabled={refreshing || !selectedRestaurant}
        >
          <IconRefresh size={15} style={refreshing ? { animation: 'spin 0.7s linear infinite' } : {}} />
          Refresh
        </button>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!selectedRestaurant ? (
        <div className="admin-card">
          <div className="admin-empty">
            <div className="admin-empty-icon"><IconTrendingUp size={22} /></div>
            <h3>Select a Restaurant</h3>
            <p>Choose a restaurant from the dropdown above to view detailed analytics and cost trends.</p>
          </div>
        </div>
      ) : (
        <>
          {/* ── KPI Cards ──────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>

            <div className="admin-stat-card">
              <div className="admin-stat-icon emerald"><IconCurrencyDollar size={20} /></div>
              <div>
                <div className="admin-stat-value">${analytics.invoiceStats.totalValue?.toFixed(0) || '0'}</div>
                <div className="admin-stat-label">Total Invoice Value</div>
                <div className="admin-stat-sub">From {analytics.invoiceStats.total} invoices</div>
              </div>
            </div>

            <div className="admin-stat-card">
              <div className={`admin-stat-icon ${avgCostChange >= 0 ? 'rose' : 'emerald'}`}>
                {avgCostChange >= 0 ? <IconArrowUp size={20} /> : <IconArrowDown size={20} />}
              </div>
              <div>
                <div className="admin-stat-value" style={{ color: avgCostChange >= 0 ? '#f43f5e' : '#10b981' }}>
                  {avgCostChange >= 0 ? '+' : ''}${avgCostChange.toFixed(4)}
                </div>
                <div className="admin-stat-label">Avg Cost Change</div>
                <div className="admin-stat-sub">Recent 10 changes</div>
              </div>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-icon teal"><IconToolsKitchen2 size={20} /></div>
              <div>
                <div className="admin-stat-value">{analytics.menuItemStats.length}</div>
                <div className="admin-stat-label">Menu Items</div>
                <div className="admin-stat-sub">Total items tracked</div>
              </div>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-icon amber"><IconBook size={20} /></div>
              <div>
                <div className="admin-stat-value">{analytics.ingredientTrends.length}</div>
                <div className="admin-stat-label">Ingredients</div>
                <div className="admin-stat-sub">With pricing data</div>
              </div>
            </div>
          </div>

          {/* ── Recent Cost Changes ────────────────────────────────────────── */}
          <div className="admin-card" style={{ marginBottom: 16 }}>
            <div className="admin-card-header">
              <h2 className="admin-card-title">Recent Cost Changes</h2>
              {recentChanges.length > 0 && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{recentChanges.length} changes</span>
              )}
            </div>

            {recentChanges.length === 0 ? (
              <div className="admin-empty">
                <div className="admin-empty-icon"><IconFileText size={22} /></div>
                <h3>No cost changes</h3>
                <p>No recent cost changes found for {selectedName}.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Menu Item</th>
                      <th>Old Cost</th>
                      <th>New Cost</th>
                      <th>Change</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentChanges.map(change => {
                      const delta   = change.new_cost - change.old_cost;
                      const pct     = change.old_cost > 0 ? (delta / change.old_cost) * 100 : 0;
                      const up      = delta >= 0;
                      return (
                        <tr key={change.id}>
                          <td>
                            {new Date(change.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td className="primary">{change.menu_item_name}</td>
                          <td>${change.old_cost.toFixed(4)}</td>
                          <td>${change.new_cost.toFixed(4)}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {up
                                ? <IconArrowUp size={13} style={{ color: '#f43f5e' }} />
                                : <IconArrowDown size={13} style={{ color: '#10b981' }} />
                              }
                              <span style={{ color: up ? '#f43f5e' : '#10b981', fontWeight: 600, fontSize: '0.83rem' }}>
                                {up ? '+' : ''}${delta.toFixed(4)}
                              </span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                              </span>
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{change.change_reason || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Two-column: Top Ingredients + Top Menu Items ───────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Most Expensive Ingredients */}
            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">Most Expensive Ingredients</h2>
              </div>

              {topIngredients.length === 0 ? (
                <div className="admin-empty" style={{ padding: '40px 24px' }}>
                  <div className="admin-empty-icon"><IconBook size={20} /></div>
                  <h3>No ingredient data</h3>
                  <p>No ingredient pricing available for {selectedName}.</p>
                </div>
              ) : (
                <div style={{ padding: '8px 0' }}>
                  {topIngredients.map((ing, i) => (
                    <div
                      key={ing.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '12px 20px',
                        borderBottom: i < topIngredients.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Rank */}
                      <div style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: i === 0 ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                        border: `1px solid ${i === 0 ? 'rgba(2,164,186,0.25)' : 'var(--border)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.72rem', fontWeight: 700,
                        color: i === 0 ? 'var(--accent)' : 'var(--text-muted)',
                        flexShrink: 0,
                      }}>
                        {i + 1}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ing.name}
                        </div>
                        {ing.last_ordered_at && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            Last ordered {new Date(ing.last_ordered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </div>
                        )}
                      </div>
                      {/* Price */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.88rem', fontFamily: 'var(--font-display)' }}>
                          ${ing.last_price.toFixed(4)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>per {ing.unit}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Most Expensive Menu Items */}
            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">Most Expensive Menu Items</h2>
              </div>

              {topMenuItems.length === 0 ? (
                <div className="admin-empty" style={{ padding: '40px 24px' }}>
                  <div className="admin-empty-icon"><IconChefHat size={20} /></div>
                  <h3>No menu data</h3>
                  <p>No menu item cost data available for {selectedName}.</p>
                </div>
              ) : (
                <div style={{ padding: '8px 0' }}>
                  {topMenuItems.map((item, i) => {
                    const margin = item.price > 0 ? ((item.price - item.cost) / item.price) * 100 : 0;
                    const marginColor = margin > 30 ? '#10b981' : margin > 15 ? '#f59e0b' : '#f43f5e';
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '12px 20px',
                          borderBottom: i < topMenuItems.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          transition: 'background 0.12s ease',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        {/* Rank */}
                        <div style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: i === 0 ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                          border: `1px solid ${i === 0 ? 'rgba(2,164,186,0.25)' : 'var(--border)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.72rem', fontWeight: 700,
                          color: i === 0 ? 'var(--accent)' : 'var(--text-muted)',
                          flexShrink: 0,
                        }}>
                          {i + 1}
                        </div>
                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </div>
                          {item.price > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Margin:</span>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: marginColor }}>
                                {margin.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Cost / Price */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.88rem', fontFamily: 'var(--font-display)' }}>
                            ${item.cost.toFixed(2)}
                          </div>
                          {item.price > 0 && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>price ${item.price.toFixed(2)}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </>
      )}
    </AdminLayout>
  );
}