// pages/admin/clients.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconSearch,
  IconUsers,
  IconCurrencyDollar,
  IconCalendar,
  IconBuilding,
  IconChartBar,
  IconMenuDeep,
  IconSortAscending,
  IconSortDescending,
  IconMail,
  IconFileText,
  IconChefHat,
  IconActivity,
  IconRefresh,
  IconPlus,
  IconEye,
  IconUserPlus,
  IconX,
} from '@tabler/icons-react';

export default function ClientManagement() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchClients();
    };
    checkUser();
  }, [router]);

  async function fetchClients() {
    try {
      setLoading(true);
      const { data: restaurants, error } = await supabase.from('restaurants').select('*').order('name');
      if (error) throw error;

      const clientsWithStats = await Promise.all(
        (restaurants || []).map(async (restaurant) => {
          try {
            const [
              { data: invoices },
              { data: menuItems },
              { data: ingredients },
            ] = await Promise.all([
              supabase.from('invoices').select('id, amount, created_at').eq('restaurant_id', restaurant.id),
              supabase.from('menu_items').select('id').eq('restaurant_id', restaurant.id),
              supabase.from('ingredients').select('id').eq('restaurant_id', restaurant.id),
            ]);

            const totalSpent       = (invoices || []).reduce((s, inv) => s + (inv.amount || 0), 0);
            const lastInvoiceDate  = (invoices || []).length > 0
              ? new Date(Math.max(...(invoices || []).map(inv => new Date(inv.created_at).getTime())))
              : null;

            return {
              ...restaurant,
              stats: {
                totalInvoices:   (invoices || []).length,
                totalSpent,
                menuItemsCount:  (menuItems || []).length,
                ingredientsCount:(ingredients || []).length,
                lastInvoiceDate,
              },
            };
          } catch {
            return { ...restaurant, stats: { totalInvoices: 0, totalSpent: 0, menuItemsCount: 0, ingredientsCount: 0, lastInvoiceDate: null } };
          }
        })
      );

      setClients(clientsWithStats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleSort(field) {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  }

  const filteredAndSorted = clients
    .filter(c =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let av, bv;
      if (sortField.startsWith('stats.')) {
        const key = sortField.split('.')[1];
        av = a.stats[key];
        bv = b.stats[key];
        if (key === 'lastInvoiceDate') { av = av ? av.getTime() : 0; bv = bv ? bv.getTime() : 0; }
      } else {
        av = a[sortField]; bv = b[sortField];
      }
      if (typeof av === 'number' && typeof bv === 'number') return sortDirection === 'asc' ? av - bv : bv - av;
      av = (av || '').toString().toLowerCase();
      bv = (bv || '').toString().toLowerCase();
      return sortDirection === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

  const thirtyDaysAgo   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const activeClients   = clients.filter(c => c.stats.lastInvoiceDate && c.stats.lastInvoiceDate > thirtyDaysAgo).length;
  const totalRevenue    = clients.reduce((s, c) => s + c.stats.totalSpent, 0);

  const SortIcon = ({ field }) => sortField === field
    ? (sortDirection === 'asc' ? <IconSortAscending size={13} /> : <IconSortDescending size={13} />)
    : null;

  if (loading) {
    return (
      <AdminLayout pageTitle="Client Management" pageDescription="Manage restaurant partners" pageIcon={IconUsers}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading clients…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Client Management" pageDescription="Manage restaurant partners and their data" pageIcon={IconUsers}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Search */}
        <div className="admin-search-inline" style={{ flex: 1, minWidth: 220 }}>
          <IconSearch size={15} />
          <input
            placeholder="Search by name or email…"
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

        <button className="admin-btn admin-btn-ghost" onClick={fetchClients}>
          <IconRefresh size={15} /> Refresh
        </button>
        <button className="admin-btn admin-btn-ghost" onClick={() => router.push('/admin/prospective-clients')}>
          <IconUserPlus size={15} /> Prospects
        </button>
        <button className="admin-btn admin-btn-primary" onClick={() => router.push('/admin/add-client')}>
          <IconPlus size={15} /> Add Client
        </button>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="admin-stat-card">
          <div className="admin-stat-icon teal"><IconBuilding size={20} /></div>
          <div>
            <div className="admin-stat-value">{clients.length}</div>
            <div className="admin-stat-label">Total Clients</div>
            <div className="admin-stat-sub">Restaurant partners</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon emerald"><IconActivity size={20} /></div>
          <div>
            <div className="admin-stat-value">{activeClients}</div>
            <div className="admin-stat-label">Active (30 days)</div>
            <div className="admin-stat-sub">
              {clients.length > 0 ? Math.round((activeClients / clients.length) * 100) : 0}% of clients
            </div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon violet"><IconCurrencyDollar size={20} /></div>
          <div>
            <div className="admin-stat-value">${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
            <div className="admin-stat-label">Total Revenue</div>
            <div className="admin-stat-sub">Combined invoice value</div>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Restaurant Partners</h2>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {filteredAndSorted.length} client{filteredAndSorted.length !== 1 ? 's' : ''}
          </span>
        </div>

        {filteredAndSorted.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon"><IconBuilding size={22} /></div>
            <h3>{searchTerm ? 'No clients found' : 'No restaurant partners yet'}</h3>
            <p>
              {searchTerm
                ? `No clients match "${searchTerm}"`
                : 'Add your first restaurant partner to get started.'
              }
            </p>
            {!searchTerm && (
              <button className="admin-btn admin-btn-primary" style={{ marginTop: 8 }} onClick={() => router.push('/admin/add-client')}>
                <IconPlus size={15} /> Add First Client
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('name')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Restaurant <SortIcon field="name" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('email')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Email <SortIcon field="email" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('stats.totalInvoices')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Invoices <SortIcon field="stats.totalInvoices" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('stats.totalSpent')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Total Spent <SortIcon field="stats.totalSpent" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('stats.menuItemsCount')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Menu Items <SortIcon field="stats.menuItemsCount" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('stats.lastInvoiceDate')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Last Activity <SortIcon field="stats.lastInvoiceDate" /></span>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map(client => {
                  const isActive = client.stats.lastInvoiceDate && client.stats.lastInvoiceDate > thirtyDaysAgo;
                  return (
                    <tr key={client.id}>
                      {/* Name */}
                      <td className="primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                            background: 'var(--accent-dim)', border: '1px solid rgba(2,164,186,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
                          }}>
                            <IconBuilding size={15} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{client.name}</div>
                            {isActive && <span className="admin-badge emerald" style={{ marginTop: 2 }}>Active</span>}
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td>
                        {client.email ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconMail size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.83rem' }}>{client.email}</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>No email</span>
                        )}
                      </td>

                      {/* Invoices */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <IconFileText size={13} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{client.stats.totalInvoices}</span>
                        </div>
                      </td>

                      {/* Spent */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <IconCurrencyDollar size={13} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '0.88rem' }}>
                            ${client.stats.totalSpent.toFixed(2)}
                          </span>
                        </div>
                      </td>

                      {/* Menu items */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <IconChefHat size={13} style={{ color: 'var(--text-muted)' }} />
                          <span>{client.stats.menuItemsCount}</span>
                        </div>
                      </td>

                      {/* Last activity */}
                      <td>
                        {client.stats.lastInvoiceDate ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconCalendar size={13} style={{ color: 'var(--text-muted)' }} />
                            <span>{client.stats.lastInvoiceDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>Never</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button
                            className="admin-btn admin-btn-ghost admin-btn-sm"
                            onClick={() => router.push(`/admin/analytics?restaurant=${client.id}`)}
                            title="View analytics"
                          >
                            <IconChartBar size={14} />
                          </button>
                          <button
                            className="admin-btn admin-btn-ghost admin-btn-sm"
                            onClick={() => router.push(`/admin/menu-items?restaurant=${client.id}`)}
                            title="Manage menu"
                            style={{ color: 'var(--accent)' }}
                          >
                            <IconMenuDeep size={14} />
                          </button>
                          <button
                            className="admin-btn admin-btn-ghost admin-btn-sm"
                            onClick={() => router.push(`/admin/client/${client.id}`)}
                            title="View details"
                          >
                            <IconEye size={14} />
                          </button>
                        </div>
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