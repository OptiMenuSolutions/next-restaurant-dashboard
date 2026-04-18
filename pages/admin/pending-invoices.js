// pages/admin/pending-invoices.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconClock,
  IconEye,
  IconCalendar,
  IconBuilding,
  IconAlertTriangle,
  IconCheck,
  IconFile,
  IconPhoto,
  IconRefresh,
  IconFileText,
} from '@tabler/icons-react';

export default function PendingInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restaurants, setRestaurants] = useState({});
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchPendingInvoices();
    };
    checkUser();
  }, [router]);

  async function fetchPendingInvoices() {
    try {
      setRefreshing(true);

      const { data: pendingInvoices, error: invoicesError } = await supabase
        .from('invoices')
        .select('*')
        .or('number.is.null,date.is.null,supplier.is.null,amount.is.null')
        .order('created_at', { ascending: false });

      if (invoicesError) throw invoicesError;

      const restaurantIds = [...new Set((pendingInvoices || []).map(inv => inv.restaurant_id).filter(Boolean))];
      if (restaurantIds.length > 0) {
        const { data: restaurantData } = await supabase
          .from('restaurants')
          .select('id, name')
          .in('id', restaurantIds);
        const map = {};
        (restaurantData || []).forEach(r => { map[r.id] = r.name; });
        setRestaurants(map);
      }

      setInvoices(pendingInvoices || []);
    } catch (error) {
      console.error('Error fetching pending invoices:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function getFileType(url) {
    if (!url) return 'Unknown';
    const ext = url.split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'PDF';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'Image';
    return 'File';
  }

  function getFileIcon(url) {
    const t = getFileType(url);
    if (t === 'PDF')   return IconFile;
    if (t === 'Image') return IconPhoto;
    return IconFileText;
  }

  function getMissingFields(invoice) {
    const missing = [];
    if (!invoice.number)   missing.push('Number');
    if (!invoice.date)     missing.push('Date');
    if (!invoice.supplier) missing.push('Supplier');
    if (!invoice.amount)   missing.push('Amount');
    return missing;
  }

  function formatDate(dateString) {
    const d = new Date(dateString);
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };
  }

  if (loading) {
    return (
      <AdminLayout pageTitle="Pending Review" pageDescription="Review and process uploaded invoices" pageIcon={IconClock}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading pending invoices…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Pending Review" pageDescription="Review and process uploaded invoices" pageIcon={IconClock}>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {invoices.length > 0 ? (
            <span className="admin-badge rose" style={{ padding: '5px 12px', fontSize: '0.78rem' }}>
              <IconAlertTriangle size={13} />
              {invoices.length} pending
            </span>
          ) : (
            <span className="admin-badge emerald" style={{ padding: '5px 12px', fontSize: '0.78rem' }}>
              <IconCheck size={13} />
              All clear
            </span>
          )}
        </div>
        <button
          className="admin-btn admin-btn-ghost"
          onClick={fetchPendingInvoices}
          disabled={refreshing}
        >
          <IconRefresh size={15} style={refreshing ? { animation: 'spin 0.7s linear infinite' } : {}} />
          Refresh
        </button>
      </div>

      {/* ── Empty State ──────────────────────────────────────────────── */}
      {invoices.length === 0 ? (
        <div className="admin-card">
          <div className="admin-empty">
            <div className="admin-empty-icon" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)', color: '#10b981' }}>
              <IconCheck size={24} />
            </div>
            <h3>All caught up!</h3>
            <p>There are no pending invoices to review. All uploaded invoices have been processed.</p>
            <button className="admin-btn admin-btn-ghost" style={{ marginTop: 8 }} onClick={() => router.push('/admin')}>
              Back to Dashboard
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Desktop Table ─────────────────────────────────────────── */}
          <div className="admin-card" style={{ display: 'none' }} id="desktop-table">
            <table className="admin-table" style={{ display: 'table' }}>
              <thead>
                <tr>
                  <th>Restaurant</th>
                  <th>Uploaded</th>
                  <th>File Type</th>
                  <th>Missing Fields</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const missing = getMissingFields(invoice);
                  const FileIcon = getFileIcon(invoice.file_url);
                  const { date, time } = formatDate(invoice.created_at);
                  return (
                    <tr
                      key={invoice.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/admin/invoices/edit/${invoice.id}`)}
                    >
                      <td className="primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: 'var(--accent-dim)', border: '1px solid rgba(2,164,186,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--accent)', flexShrink: 0,
                          }}>
                            <IconBuilding size={15} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                              {restaurants[invoice.restaurant_id] || 'Unknown Restaurant'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>{date}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{time}</div>
                      </td>
                      <td>
                        <span className="admin-badge neutral" style={{ gap: 5 }}>
                          <FileIcon size={11} />
                          {getFileType(invoice.file_url)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {missing.map(f => (
                            <span key={f} className="admin-badge rose">{f}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <button
                          className="admin-btn admin-btn-primary admin-btn-sm"
                          onClick={e => { e.stopPropagation(); router.push(`/admin/invoices/edit/${invoice.id}`); }}
                        >
                          <IconEye size={14} />
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Responsive Card List ──────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {invoices.map((invoice) => {
              const missing = getMissingFields(invoice);
              const FileIcon = getFileIcon(invoice.file_url);
              const { date, time } = formatDate(invoice.created_at);
              return (
                <div
                  key={invoice.id}
                  className="admin-card"
                  style={{ cursor: 'pointer', transition: 'border-color 0.15s ease' }}
                  onClick={() => router.push(`/admin/invoices/edit/${invoice.id}`)}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-strong)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{ padding: '18px 20px' }}>
                    {/* Top row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 10,
                          background: 'var(--accent-dim)', border: '1px solid rgba(2,164,186,0.2)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--accent)', flexShrink: 0,
                        }}>
                          <IconBuilding size={18} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: 2 }}>
                            {restaurants[invoice.restaurant_id] || 'Unknown Restaurant'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="admin-badge neutral" style={{ gap: 4 }}>
                              <FileIcon size={10} />
                              {getFileType(invoice.file_url)}
                            </span>
                            <span className="admin-badge amber">
                              <IconAlertTriangle size={10} />
                              Pending
                            </span>
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{date}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{time}</div>
                      </div>
                    </div>

                    {/* Missing fields */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        Missing:
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {missing.map(f => (
                          <span key={f} className="admin-badge rose">{f}</span>
                        ))}
                      </div>
                    </div>

                    {/* Action */}
                    <button
                      className="admin-btn admin-btn-primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={e => { e.stopPropagation(); router.push(`/admin/invoices/edit/${invoice.id}`); }}
                    >
                      <IconEye size={15} />
                      Review Invoice
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </AdminLayout>
  );
}