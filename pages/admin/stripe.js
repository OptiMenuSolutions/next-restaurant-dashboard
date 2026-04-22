// pages/admin/stripe.js
// Stripe subscription management — view all subs, cancel, refund, reactivate.

import { useState, useEffect } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import supabase from '../../lib/supabaseClient';

async function adminFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('No active session');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
}

function StatusBadge({ status, cancelAtPeriodEnd }) {
  const display = cancelAtPeriodEnd ? 'cancels soon' : status;
  const colors = {
    active: { bg: 'rgba(2,164,186,0.1)', border: 'rgba(2,164,186,0.25)', color: '#02a4ba' },
    'cancels soon': { bg: 'rgba(245,166,35,0.1)', border: 'rgba(245,166,35,0.25)', color: '#f5a623' },
    canceled: { bg: 'rgba(232,84,84,0.1)', border: 'rgba(232,84,84,0.25)', color: '#e85454' },
    past_due: { bg: 'rgba(232,84,84,0.1)', border: 'rgba(232,84,84,0.25)', color: '#e85454' },
    trialing: { bg: 'rgba(130,100,200,0.1)', border: 'rgba(130,100,200,0.25)', color: '#a080e0' },
  };
  const c = colors[display] || colors.canceled;
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`, color: c.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {display}
    </span>
  );
}

function ConfirmModal({ title, body, confirmLabel, confirmColor = '#e85454', onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#111318', border: '1px solid #1e2028', borderRadius: 12, padding: 28, maxWidth: 400, width: '100%' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e4e6f0', marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#5a6080', lineHeight: 1.55, marginBottom: 24 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ background: 'none', border: '1px solid #1e2028', borderRadius: 7, padding: '8px 16px', fontSize: 12, color: '#5a6080', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Cancel</button>
          <button onClick={onConfirm} style={{ background: `${confirmColor}22`, border: `1px solid ${confirmColor}55`, borderRadius: 7, padding: '8px 16px', fontSize: 12, fontWeight: 700, color: confirmColor, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function StripePage() {
  const [subs, setSubs] = useState([]);
  const [mrr, setMrr] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [refundAmount, setRefundAmount] = useState('');

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/stripe-management?action=list');
      const data = await res.json();
      setSubs(data.subscriptions || []);
      setMrr(data.mrr || 0);
    } catch (err) {
      showToast('Failed to load subscriptions', 'error');
    }
    setLoading(false);
  }

  function showToast(text, type = 'success') {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleAction(action, body) {
    setActionLoading(action + (body.subscriptionId || body.chargeId));
    try {
      const res = await adminFetch(`/api/admin/stripe-management?action=${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(
        action === 'cancel' ? 'Subscription cancelled' :
        action === 'reactivate' ? 'Subscription reactivated' :
        'Refund issued successfully'
      );
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Action failed', 'error');
    }
    setActionLoading(null);
    setModal(null);
  }

  const filtered = subs.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.customerEmail?.toLowerCase().includes(q) || s.customerName?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || s.status === statusFilter || (statusFilter === 'cancels_soon' && s.cancelAtPeriodEnd);
    return matchSearch && matchStatus;
  });

  const activeSubs = subs.filter(s => s.status === 'active').length;
  const canceledSubs = subs.filter(s => s.status === 'canceled').length;
  const pastDue = subs.filter(s => s.status === 'past_due').length;

  return (
    <AdminLayout title="Stripe Management">
      {modal && (
        <ConfirmModal
          title={modal.title}
          body={modal.body}
          confirmLabel={modal.confirmLabel}
          confirmColor={modal.confirmColor}
          onConfirm={modal.onConfirm}
          onCancel={() => setModal(null)}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 200,
          background: toast.type === 'success' ? 'rgba(2,164,186,0.15)' : 'rgba(232,84,84,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(2,164,186,0.3)' : 'rgba(232,84,84,0.3)'}`,
          color: toast.type === 'success' ? '#02a4ba' : '#e85454',
          borderRadius: 8, padding: '10px 16px', fontSize: 12, fontWeight: 500,
        }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.text}
        </div>
      )}

      <div style={s.page}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={s.title}>Stripe Management</div>
            <div style={s.sub}>Manage subscriptions, cancellations, and refunds</div>
          </div>
          <button onClick={fetchData} style={s.refreshBtn}>↻ Refresh</button>
        </div>

        {/* Stats */}
        <div style={s.statsRow}>
          {[
            { label: 'MRR', value: `$${mrr.toLocaleString()}`, color: '#02a4ba' },
            { label: 'Active', value: activeSubs, color: '#02a4ba' },
            { label: 'Canceled', value: canceledSubs, color: '#e85454' },
            { label: 'Past Due', value: pastDue, color: '#f5a623' },
          ].map((stat) => (
            <div key={stat.label} style={s.statCard}>
              <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
              <div style={s.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={s.filters}>
          <input
            style={s.search}
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'active', 'canceled', 'past_due', 'cancels_soon'].map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                style={{
                  ...s.filterBtn,
                  ...(statusFilter === f ? s.filterBtnActive : {}),
                }}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={s.table}>
          <div style={s.tableHeader}>
            <div style={{ flex: 2 }}>Customer</div>
            <div style={{ flex: 1 }}>Plan</div>
            <div style={{ flex: 1 }}>Status</div>
            <div style={{ flex: 1 }}>Renewal</div>
            <div style={{ flex: 1, textAlign: 'right' }}>Actions</div>
          </div>

          {loading ? (
            <div style={s.empty}>Loading subscriptions...</div>
          ) : filtered.length === 0 ? (
            <div style={s.empty}>No subscriptions found</div>
          ) : filtered.map((sub) => (
            <div key={sub.id}>
              <div
                style={{ ...s.tableRow, ...(expanded === sub.id ? s.tableRowExpanded : {}) }}
                onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
              >
                <div style={{ flex: 2, minWidth: 0 }}>
                  <div style={s.custName}>{sub.customerName || '—'}</div>
                  <div style={s.custEmail}>{sub.customerEmail}</div>
                </div>
                <div style={{ flex: 1, fontSize: 12, color: '#9aa0b8' }}>
                  ${sub.amount}/mo
                </div>
                <div style={{ flex: 1 }}>
                  <StatusBadge status={sub.status} cancelAtPeriodEnd={sub.cancelAtPeriodEnd} />
                </div>
                <div style={{ flex: 1, fontSize: 11, color: '#5a6080' }}>
                  {sub.cancelAtPeriodEnd
                    ? `Ends ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`
                    : new Date(sub.currentPeriodEnd).toLocaleDateString()}
                </div>
                <div style={{ flex: 1, display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                  {/* Cancel / Reactivate */}
                  {sub.status === 'active' && !sub.cancelAtPeriodEnd && (
                    <button
                      onClick={() => setModal({
                        title: 'Cancel Subscription',
                        body: `Cancel ${sub.customerEmail}'s subscription? They'll keep access until ${new Date(sub.currentPeriodEnd).toLocaleDateString()}.`,
                        confirmLabel: 'Cancel at Period End',
                        confirmColor: '#f5a623',
                        onConfirm: () => handleAction('cancel', { subscriptionId: sub.id, immediately: false }),
                      })}
                      style={s.actionBtn}
                    >
                      Cancel
                    </button>
                  )}
                  {sub.cancelAtPeriodEnd && (
                    <button
                      onClick={() => setModal({
                        title: 'Reactivate Subscription',
                        body: `Reactivate ${sub.customerEmail}'s subscription? They'll continue being billed normally.`,
                        confirmLabel: 'Reactivate',
                        confirmColor: '#02a4ba',
                        onConfirm: () => handleAction('reactivate', { subscriptionId: sub.id }),
                      })}
                      style={{ ...s.actionBtn, color: '#02a4ba', borderColor: 'rgba(2,164,186,0.3)' }}
                    >
                      Reactivate
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
                    style={{ ...s.actionBtn, color: '#5a6080' }}
                  >
                    {expanded === sub.id ? '▲' : '▼'}
                  </button>
                </div>
              </div>

              {/* Expanded: recent charges + refund */}
              {expanded === sub.id && (
                <div style={s.expandedPanel}>
                  <div style={s.expandedTitle}>Recent Charges</div>
                  {sub.recentCharges.length === 0 ? (
                    <div style={{ fontSize: 11, color: '#3a3e50', padding: '8px 0' }}>No recent charges</div>
                  ) : sub.recentCharges.map((charge) => (
                    <div key={charge.id} style={s.chargeRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#9aa0b8' }}>${charge.amount.toFixed(2)} {charge.currency.toUpperCase()}</div>
                        <div style={{ fontSize: 10, color: '#3a3e50' }}>{new Date(charge.created).toLocaleDateString()} · {charge.id}</div>
                      </div>
                      {charge.refunded ? (
                        <span style={{ fontSize: 10, color: '#5a6080' }}>Refunded</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            style={{ ...s.refundInput }}
                            placeholder={`Max $${charge.amount}`}
                            value={refundAmount}
                            onChange={(e) => setRefundAmount(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const amt = refundAmount ? parseFloat(refundAmount) : null;
                              setModal({
                                title: 'Issue Refund',
                                body: amt
                                  ? `Issue a partial refund of $${amt} to ${sub.customerEmail}?`
                                  : `Issue a full refund of $${charge.amount} to ${sub.customerEmail}?`,
                                confirmLabel: 'Issue Refund',
                                confirmColor: '#f5a623',
                                onConfirm: () => handleAction('refund', { chargeId: charge.id, amount: amt }),
                              });
                            }}
                            style={{ ...s.actionBtn, color: '#f5a623', borderColor: 'rgba(245,166,35,0.3)' }}
                          >
                            Refund
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Immediate cancel option */}
                  {sub.status === 'active' && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1a1d24' }}>
                      <button
                        onClick={() => setModal({
                          title: 'Cancel Immediately',
                          body: `Immediately cancel ${sub.customerEmail}'s subscription? Access ends now with no refund.`,
                          confirmLabel: 'Cancel Immediately',
                          confirmColor: '#e85454',
                          onConfirm: () => handleAction('cancel', { subscriptionId: sub.id, immediately: true }),
                        })}
                        style={{ ...s.actionBtn, color: '#e85454', borderColor: 'rgba(232,84,84,0.3)', fontSize: 11 }}
                      >
                        Cancel Immediately (no refund)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

const s = {
  page: { padding: 24, display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: 700, color: '#e4e6f0', fontFamily: "'Playfair Display', serif" },
  sub: { fontSize: 11, color: '#4a5068', marginTop: 4 },
  refreshBtn: { background: 'none', border: '1px solid #1e2028', borderRadius: 7, padding: '6px 14px', fontSize: 11, color: '#5a6080', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },

  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 },
  statCard: { background: '#111318', border: '1px solid #1e2028', borderRadius: 10, padding: '16px 20px' },
  statValue: { fontSize: 24, fontWeight: 700, fontFamily: "'Playfair Display', serif" },
  statLabel: { fontSize: 10, color: '#4a5068', textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: 4 },

  filters: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  search: { background: '#111318', border: '1px solid #1e2028', borderRadius: 7, padding: '8px 14px', fontSize: 12, color: '#e4e6f0', outline: 'none', fontFamily: "'Inter', sans-serif", flex: 1, minWidth: 200 },
  filterBtn: { background: 'none', border: '1px solid #1e2028', borderRadius: 20, padding: '4px 12px', fontSize: 10, fontWeight: 500, color: '#5a6080', cursor: 'pointer', fontFamily: "'Inter', sans-serif", textTransform: 'capitalize' },
  filterBtnActive: { background: 'rgba(2,164,186,0.1)', borderColor: 'rgba(2,164,186,0.3)', color: '#02a4ba' },

  table: { background: '#111318', border: '1px solid #1e2028', borderRadius: 10, overflow: 'hidden' },
  tableHeader: { display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #1e2028', fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px' },
  tableRow: { display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #1a1d24', cursor: 'pointer', transition: 'background 0.1s' },
  tableRowExpanded: { background: 'rgba(2,164,186,0.04)' },
  custName: { fontSize: 12, fontWeight: 600, color: '#e4e6f0', marginBottom: 2 },
  custEmail: { fontSize: 10, color: '#4a5068' },
  empty: { padding: '32px', fontSize: 12, color: '#3a3e50', textAlign: 'center' },

  actionBtn: { background: 'none', border: '1px solid #1e2028', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 600, color: '#e85454', cursor: 'pointer', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap' },

  expandedPanel: { padding: '14px 20px 16px', background: '#0d0f14', borderBottom: '1px solid #1a1d24' },
  expandedTitle: { fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 },
  chargeRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #1a1d24' },
  refundInput: { background: '#111318', border: '1px solid #1e2028', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#e4e6f0', outline: 'none', width: 80, fontFamily: "'Inter', sans-serif" },
};