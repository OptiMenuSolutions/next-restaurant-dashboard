// pages/admin/activity.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconBell,
  IconFileText,
  IconUsers,
  IconClock,
  IconRefresh,
  IconSearch,
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
} from '@tabler/icons-react';
import { ACTIVITY_TYPES } from '../../lib/activityLogger';

const ITEMS_PER_PAGE = 20;

const TYPE_META = {
  [ACTIVITY_TYPES?.PROSPECT_CREATED]:  { label: 'Prospect Created',  color: 'emerald', icon: IconUsers    },
  [ACTIVITY_TYPES?.PROSPECT_UPDATED]:  { label: 'Prospect Updated',  color: 'teal',    icon: IconUsers    },
  [ACTIVITY_TYPES?.PROSPECT_DELETED]:  { label: 'Prospect Deleted',  color: 'rose',    icon: IconUsers    },
  [ACTIVITY_TYPES?.INVOICE_CREATED]:   { label: 'Invoice Created',   color: 'teal',    icon: IconFileText },
  [ACTIVITY_TYPES?.INVOICE_UPDATED]:   { label: 'Invoice Updated',   color: 'amber',   icon: IconFileText },
};

function getTypeMeta(type) {
  return TYPE_META[type] || {
    label: (type || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    color: 'neutral',
    icon: IconFileText,
  };
}

function formatRelativeTime(dateString) {
  const diff = (Date.now() - new Date(dateString)) / 1000;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'Yesterday';
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ActivityPage() {
  const router = useRouter();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchActivities();
    };
    checkUser();
  }, [router, currentPage, filterType, searchTerm]);

  async function fetchActivities() {
    try {
      setLoading(true);
      let query = supabase
        .from('activity_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (filterType !== 'all') query = query.eq('activity_type', filterType);
      if (searchTerm) query = query.or(`title.ilike.%${searchTerm}%,subtitle.ilike.%${searchTerm}%,restaurant_name.ilike.%${searchTerm}%`);

      const from = (currentPage - 1) * ITEMS_PER_PAGE;
      query = query.range(from, from + ITEMS_PER_PAGE - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      setActivities(data || []);
      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / ITEMS_PER_PAGE));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const uniqueTypes = [...new Set(Object.values(ACTIVITY_TYPES || {}))];

  const handlePageChange = (p) => {
    if (p >= 1 && p <= totalPages) setCurrentPage(p);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterType('all');
    setCurrentPage(1);
  };

  const hasFilters = searchTerm || filterType !== 'all';

  // page numbers to show (max 5)
  const pageNumbers = (() => {
    const pages = [];
    const max = Math.min(5, totalPages);
    let start = 1;
    if (totalPages > 5) {
      if (currentPage <= 3)              start = 1;
      else if (currentPage >= totalPages - 2) start = totalPages - 4;
      else                               start = currentPage - 2;
    }
    for (let i = 0; i < max; i++) pages.push(start + i);
    return pages;
  })();

  if (loading && activities.length === 0) {
    return (
      <AdminLayout pageTitle="Activity Log" pageDescription="Complete system activity history" pageIcon={IconBell}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading activity…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Activity Log" pageDescription="Complete system activity history" pageIcon={IconBell}>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Search */}
        <div className="admin-search-inline" style={{ flex: 1, minWidth: 220 }}>
          <IconSearch size={15} />
          <input
            placeholder="Search activities…"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          />
          {searchTerm && (
            <button
              onClick={() => { setSearchTerm(''); setCurrentPage(1); }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
            >
              <IconX size={14} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div style={{ position: 'relative' }}>
          <IconFilter size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <select
            className="admin-select"
            value={filterType}
            onChange={e => { setFilterType(e.target.value); setCurrentPage(1); }}
            style={{ paddingLeft: 34, minWidth: 180 }}
          >
            <option value="all">All Activity Types</option>
            {uniqueTypes.map(type => (
              <option key={type} value={type}>{getTypeMeta(type).label}</option>
            ))}
          </select>
        </div>

        <button
          className="admin-btn admin-btn-ghost"
          onClick={fetchActivities}
          disabled={loading}
        >
          <IconRefresh size={15} style={loading ? { animation: 'spin 0.7s linear infinite' } : {}} />
          Refresh
        </button>

        {hasFilters && (
          <button className="admin-btn admin-btn-ghost" onClick={clearFilters}>
            <IconX size={14} /> Clear filters
          </button>
        )}
      </div>

      {/* ── Activity Card ────────────────────────────────────────────────── */}
      <div className="admin-card">
        {/* Header */}
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">System Activity</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              {hasFilters
                ? `Filtered results — page ${currentPage} of ${totalPages}`
                : `${totalCount.toLocaleString()} total events — page ${currentPage} of ${totalPages}`
              }
            </p>
          </div>
          {hasFilters && (
            <span className="admin-badge teal">Filtered</span>
          )}
        </div>

        {/* Empty state */}
        {activities.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon"><IconBell size={22} /></div>
            <h3>{hasFilters ? 'No activities found' : 'No activity yet'}</h3>
            <p>
              {hasFilters
                ? 'No activities match your current filters.'
                : 'System activities will appear here as actions are performed.'
              }
            </p>
            {hasFilters && (
              <button className="admin-btn admin-btn-ghost" style={{ marginTop: 8 }} onClick={clearFilters}>
                <IconX size={14} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Activity list */}
            <div>
              {activities.map((activity, i) => {
                const meta = getTypeMeta(activity.activity_type);
                const Icon = meta.icon;
                return (
                  <div
                    key={activity.id}
                    className="admin-activity-item"
                    style={{
                      borderBottom: i < activities.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      alignItems: 'flex-start',
                    }}
                  >
                    {/* Icon */}
                    <div className="admin-activity-icon" style={{ marginTop: 2 }}>
                      <Icon size={15} />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                          {activity.title}
                        </span>
                        <span className={`admin-badge ${meta.color}`}>{meta.label}</span>
                        {activity.restaurant_name && (
                          <span className="admin-badge neutral">{activity.restaurant_name}</span>
                        )}
                      </div>

                      {activity.subtitle && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 2px' }}>
                          {activity.subtitle}
                        </p>
                      )}
                      {activity.details && (
                        <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', margin: 0 }}>
                          {activity.details}
                        </p>
                      )}

                      {/* Metadata expander */}
                      {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                            View metadata
                          </summary>
                          <pre style={{
                            marginTop: 6, padding: '8px 12px',
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            borderRadius: 6, fontSize: '0.72rem', color: 'var(--text-secondary)',
                            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                          }}>
                            {JSON.stringify(activity.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>

                    {/* Timestamp */}
                    <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 80 }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <IconClock size={11} />
                        {formatRelativeTime(activity.created_at)}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {formatFullDate(activity.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Pagination ──────────────────────────────────────────────── */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderTop: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Page {currentPage} of {totalPages} · {activities.length} shown
                </span>

                <div className="admin-pagination">
                  <button
                    className="admin-page-btn"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <IconChevronLeft size={14} />
                  </button>

                  {pageNumbers.map(p => (
                    <button
                      key={p}
                      className={`admin-page-btn ${p === currentPage ? 'active' : ''}`}
                      onClick={() => handlePageChange(p)}
                    >
                      {p}
                    </button>
                  ))}

                  <button
                    className="admin-page-btn"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    <IconChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}