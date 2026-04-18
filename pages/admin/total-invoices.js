// pages/admin/total-invoices.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconSearch,
  IconEdit,
  IconTrash,
  IconEye,
  IconFileText,
  IconBuilding,
  IconCalendar,
  IconCurrencyDollar,
  IconCheck,
  IconAlertTriangle,
  IconSortAscending,
  IconSortDescending,
  IconFilter,
  IconArrowLeft,
  IconX,
} from '@tabler/icons-react';

export default function TotalInvoices() {
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchRestaurants();
    };
    checkUser();
  }, [router]);

  useEffect(() => { fetchInvoices(); }, [selectedRestaurant]);

  async function fetchRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, name').order('name');
    setRestaurants(data || []);
  }

  async function fetchInvoices() {
    try {
      setLoading(true);
      let query = supabase
        .from('invoices')
        .select('*, restaurants!inner(name), invoice_items(count)')
        .order('created_at', { ascending: false });
      if (selectedRestaurant) query = query.eq('restaurant_id', selectedRestaurant);
      const { data, error } = await query;
      if (error) throw error;
      setInvoices(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchInvoiceItems(invoiceId) {
    try {
      setItemsLoading(true);
      const { data, error } = await supabase
        .from('invoice_items')
        .select('*, ingredients(name, unit, last_price)')
        .eq('invoice_id', invoiceId)
        .order('item_name');
      if (error) throw error;
      setInvoiceItems(data || []);
    } catch { setInvoiceItems([]); }
    finally { setItemsLoading(false); }
  }

  async function handleDeleteInvoice(invoiceId) {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return;
    try {
      await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId);
      await supabase.from('invoices').delete().eq('id', invoiceId);
      setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
      if (selectedInvoice?.id === invoiceId) { setSelectedInvoice(null); setInvoiceItems([]); }
    } catch (e) { alert('Failed to delete invoice: ' + e.message); }
  }

  function handleSort(field) {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  }

  function getInvoiceStatus(invoice) {
    const hasAll  = invoice.number && invoice.date && invoice.supplier && invoice.amount;
    const hasItems = invoice.invoice_items?.length > 0;
    if (!hasAll)   return { label: 'Pending',    color: 'amber' };
    if (!hasItems) return { label: 'No Items',   color: 'rose' };
    return          { label: 'Complete',          color: 'emerald' };
  }

  const filteredAndSorted = invoices
    .filter(inv => {
      const s = searchTerm.toLowerCase();
      return (inv.number || '').toLowerCase().includes(s)
          || (inv.supplier || '').toLowerCase().includes(s)
          || (inv.restaurants?.name || '').toLowerCase().includes(s);
    })
    .sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (sortField === 'amount') { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
      else if (['date', 'created_at'].includes(sortField)) { av = new Date(av || 0); bv = new Date(bv || 0); }
      else { av = (av || '').toString().toLowerCase(); bv = (bv || '').toString().toLowerCase(); }
      return sortDirection === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

  const totalValue       = invoices.reduce((s, inv) => s + (inv.amount || 0), 0);
  const completeCount    = invoices.filter(inv => getInvoiceStatus(inv).label === 'Complete').length;
  const selectedName     = selectedRestaurant ? restaurants.find(r => r.id === selectedRestaurant)?.name : 'All Restaurants';

  const SortIcon = ({ field }) => sortField === field
    ? (sortDirection === 'asc' ? <IconSortAscending size={13} /> : <IconSortDescending size={13} />)
    : null;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedInvoice) {
    const status = getInvoiceStatus(selectedInvoice);
    return (
      <AdminLayout
        pageTitle={`Invoice ${selectedInvoice.number || '—'}`}
        pageDescription={selectedInvoice.restaurants?.name}
        pageIcon={IconFileText}
      >
        {/* Back bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <button className="admin-btn admin-btn-ghost" onClick={() => { setSelectedInvoice(null); setInvoiceItems([]); }}>
            <IconArrowLeft size={15} /> Back to Invoices
          </button>
          <button className="admin-btn admin-btn-primary" onClick={() => router.push(`/admin/invoices/edit/${selectedInvoice.id}`)}>
            <IconEdit size={15} /> Edit Invoice
          </button>
        </div>

        {/* Summary card */}
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <div className="admin-card-header">
            <h2 className="admin-card-title">Invoice Summary</h2>
            <span className={`admin-badge ${status.color}`}>{status.label}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 0 }}>
            {[
              { label: 'Invoice Number', value: selectedInvoice.number || '—' },
              { label: 'Supplier',       value: selectedInvoice.supplier || '—' },
              { label: 'Date',           value: selectedInvoice.date ? new Date(selectedInvoice.date).toLocaleDateString() : '—' },
              { label: 'Restaurant',     value: selectedInvoice.restaurants?.name || '—' },
              { label: 'Total Amount',   value: selectedInvoice.amount ? `$${selectedInvoice.amount.toFixed(2)}` : '—', large: true },
            ].map((item, i) => (
              <div key={i} style={{ padding: '18px 24px', borderRight: i < 4 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 6 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: item.large ? '1.4rem' : '0.9rem', fontWeight: item.large ? 700 : 500, color: 'var(--text-primary)', fontFamily: item.large ? 'var(--font-display)' : 'var(--font-body)' }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Items card */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Invoice Items</h2>
            {!itemsLoading && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {invoiceItems.length} {invoiceItems.length === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>

          {itemsLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 }}>
              <div className="admin-spinner" />
            </div>
          ) : invoiceItems.length === 0 ? (
            <div className="admin-empty">
              <div className="admin-empty-icon"><IconFileText size={22} /></div>
              <h3>No items yet</h3>
              <p>This invoice doesn't have any line items.</p>
              <button className="admin-btn admin-btn-primary" style={{ marginTop: 8 }} onClick={() => router.push(`/admin/invoices/edit/${selectedInvoice.id}`)}>
                <IconEdit size={15} /> Add Items
              </button>
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Item Name</th>
                      <th>Quantity</th>
                      <th>Unit</th>
                      <th>Amount</th>
                      <th>Unit Cost</th>
                      <th>Linked Ingredient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceItems.map((item, i) => (
                      <tr key={item.id || i}>
                        <td className="primary">{item.item_name}</td>
                        <td>{item.quantity}</td>
                        <td>{item.unit}</td>
                        <td>${item.amount?.toFixed(2) || '0.00'}</td>
                        <td>${item.unit_cost?.toFixed(4) || '0.0000'}</td>
                        <td>
                          {item.ingredients?.name ? (
                            <div>
                              <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '0.83rem' }}>{item.ingredients.name}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                ${item.ingredients.last_price?.toFixed(4) || '0.0000'} / {item.ingredients.unit}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>Not linked</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary row */}
              <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 32 }}>
                {[
                  { label: 'Total Items',          value: invoiceItems.length },
                  { label: 'Items Total',           value: `$${invoiceItems.reduce((s, i) => s + (i.amount || 0), 0).toFixed(2)}` },
                  { label: 'Linked Ingredients',    value: invoiceItems.filter(i => i.ingredients?.name).length },
                ].map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </AdminLayout>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <AdminLayout pageTitle="All Invoices" pageDescription="View and manage all invoices" pageIcon={IconFileText}>

      {/* ── Filters ──────────────────────────────────────────────────── */}
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
            placeholder="Search by invoice #, supplier, or restaurant…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Stat Cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="admin-stat-card">
          <div className="admin-stat-icon teal"><IconFileText size={20} /></div>
          <div>
            <div className="admin-stat-value">{invoices.length}</div>
            <div className="admin-stat-label">Total Invoices</div>
            <div className="admin-stat-sub">{selectedName}</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon emerald"><IconCheck size={20} /></div>
          <div>
            <div className="admin-stat-value">{completeCount}</div>
            <div className="admin-stat-label">Complete</div>
            <div className="admin-stat-sub">{invoices.length > 0 ? Math.round((completeCount / invoices.length) * 100) : 0}% processed</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon violet">
            <IconCurrencyDollar size={20} />
          </div>
          <div>
            <div className="admin-stat-value">${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
            <div className="admin-stat-label">Total Value</div>
            <div className="admin-stat-sub">Combined invoice amount</div>
          </div>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Invoices</h2>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'invoice' : 'invoices'}
            {searchTerm && ` matching "${searchTerm}"`}
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64 }}>
            <div className="admin-spinner" />
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon"><IconFileText size={22} /></div>
            <h3>No invoices found</h3>
            <p>{searchTerm ? `No results for "${searchTerm}"` : selectedRestaurant ? `${selectedName} has no invoices yet.` : 'No invoices have been uploaded yet.'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('number')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Invoice # <SortIcon field="number" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('date')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Date <SortIcon field="date" /></span>
                  </th>
                  <th className="sortable" onClick={() => handleSort('supplier')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Supplier <SortIcon field="supplier" /></span>
                  </th>
                  <th>Restaurant</th>
                  <th className="sortable" onClick={() => handleSort('amount')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Amount <SortIcon field="amount" /></span>
                  </th>
                  <th>Status</th>
                  <th className="sortable" onClick={() => handleSort('created_at')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Uploaded <SortIcon field="created_at" /></span>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map(invoice => {
                  const status = getInvoiceStatus(invoice);
                  return (
                    <tr
                      key={invoice.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => { setSelectedInvoice(invoice); fetchInvoiceItems(invoice.id); }}
                    >
                      <td className="primary">
                        {invoice.number || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>}
                      </td>
                      <td>
                        {invoice.date
                          ? new Date(invoice.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>
                        }
                      </td>
                      <td>
                        {invoice.supplier || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <IconBuilding size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          {invoice.restaurants?.name || '—'}
                        </div>
                      </td>
                      <td className="primary">
                        {invoice.amount
                          ? `$${invoice.amount.toFixed(2)}`
                          : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>
                        }
                      </td>
                      <td>
                        <span className={`admin-badge ${status.color}`}>{status.label}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <IconCalendar size={13} style={{ color: 'var(--text-muted)' }} />
                          {new Date(invoice.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                          <button
                            className="admin-btn admin-btn-ghost admin-btn-sm"
                            onClick={() => { setSelectedInvoice(invoice); fetchInvoiceItems(invoice.id); }}
                            title="View details"
                          >
                            <IconEye size={14} />
                          </button>
                          <button
                            className="admin-btn admin-btn-ghost admin-btn-sm"
                            onClick={() => router.push(`/admin/invoices/edit/${invoice.id}`)}
                            title="Edit invoice"
                            style={{ color: 'var(--accent)' }}
                          >
                            <IconEdit size={14} />
                          </button>
                          <button
                            className="admin-btn admin-btn-danger admin-btn-sm"
                            onClick={() => handleDeleteInvoice(invoice.id)}
                            title="Delete invoice"
                          >
                            <IconTrash size={14} />
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