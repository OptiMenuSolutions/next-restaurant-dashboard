// pages/admin/index.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import supabase from '../../lib/supabaseClient';
import {
  IconDashboard,
  IconClock,
  IconFileText,
  IconUsers,
  IconBell,
  IconActivity,
  IconWifi,
  IconRefresh,
  IconArrowUpRight,
  IconChevronRight,
} from '@tabler/icons-react';
import { ACTIVITY_TYPES } from '../../lib/activityLogger';

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState({
    clientCount: 0,
    pendingInvoices: 0,
    totalInvoices: 0,
    totalRevenue: 0,
    recentActivity: [],
    loading: true,
  });
  const [systemHealth, setSystemHealth] = useState({
    recentActivity:   { count: 0,      status: 'excellent',   loading: true },
    clientEngagement: { percentage: 0, status: 'excellent',   loading: true },
    systemResponse:   { status: 'operational',                loading: true },
  });

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/admin/login'); return; }
      fetchDashboardStats();
      fetchSystemHealth();
    };
    checkUser();
  }, [router]);

  async function fetchRecentActivity() {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(4);
      if (error) throw error;
      return data || [];
    } catch { return []; }
  }

  async function fetchDashboardStats() {
    try {
      const { data: restaurants } = await supabase.from('restaurants').select('id');
      const { data: allInvoices } = await supabase.from('invoices').select('id, number, date, supplier, amount');
      const pending = (allInvoices || []).filter(inv => !inv.number || !inv.date || !inv.supplier || !inv.amount);
      const totalRevenue = (allInvoices || []).reduce((s, inv) => s + (inv.amount || 0), 0);
      const recentActivity = await fetchRecentActivity();
      setStats({
        clientCount:     restaurants?.length || 0,
        pendingInvoices: pending.length,
        totalInvoices:   allInvoices?.length || 0,
        totalRevenue,
        recentActivity,
        loading: false,
      });
    } catch {
      setStats(prev => ({ ...prev, loading: false }));
    }
  }

  async function fetchSystemHealth() {
    const [recentActivity, clientEngagement, systemResponse] = await Promise.all([
      fetchRecentActivityHealth(),
      fetchClientEngagementHealth(),
      fetchSystemResponseHealth(),
    ]);
    setSystemHealth({ recentActivity, clientEngagement, systemResponse });
  }

  async function fetchRecentActivityHealth() {
    try {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const { data } = await supabase.from('activity_logs').select('id').gte('created_at', yesterday.toISOString());
      const count = data?.length || 0;
      return { count, status: count > 5 ? 'excellent' : count >= 2 ? 'good' : 'poor', loading: false };
    } catch { return { count: 0, status: 'error', loading: false }; }
  }

  async function fetchClientEngagementHealth() {
    try {
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data: allR } = await supabase.from('restaurants').select('id');
      const { data: active } = await supabase.from('invoices').select('restaurant_id').gte('created_at', thirtyDaysAgo.toISOString());
      const total = allR?.length || 0;
      const unique = new Set(active?.map(i => i.restaurant_id)).size;
      const percentage = total > 0 ? Math.round((unique / total) * 100) : 0;
      return { percentage, status: percentage > 70 ? 'excellent' : percentage >= 40 ? 'good' : 'poor', loading: false };
    } catch { return { percentage: 0, status: 'error', loading: false }; }
  }

  async function fetchSystemResponseHealth() {
    try {
      const t0 = Date.now();
      await supabase.from('activity_logs').select('id').limit(1);
      const ms = Date.now() - t0;
      return { status: ms > 3000 ? 'slow' : ms > 1000 ? 'minor-issues' : 'operational', responseTime: ms, loading: false };
    } catch { return { status: 'error', loading: false }; }
  }

  const getActivityIcon = (type) => {
    if ([ACTIVITY_TYPES.PROSPECT_CREATED, ACTIVITY_TYPES.PROSPECT_UPDATED, ACTIVITY_TYPES.PROSPECT_DELETED].includes(type)) return IconUsers;
    return IconFileText;
  };

  const formatRelativeTime = (dateString) => {
    const diff = (Date.now() - new Date(dateString)) / 1000;
    if (diff < 60)    return 'Just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const healthDot = (status) => {
    if (['excellent', 'operational'].includes(status)) return 'green';
    if (['good', 'minor-issues'].includes(status))    return 'amber';
    if (['poor', 'slow'].includes(status))             return 'amber';
    return 'red';
  };

  const healthLabel = (metric, status) => {
    const maps = {
      recentActivity:   { excellent: 'Very Active', good: 'Active',    poor: 'Quiet',         error: 'Error' },
      clientEngagement: { excellent: 'High',        good: 'Moderate',  poor: 'Low',           error: 'Error' },
      systemResponse:   { operational: 'Nominal',   'minor-issues': 'Degraded', slow: 'Slow', error: 'Error' },
    };
    return maps[metric]?.[status] ?? status;
  };

  if (stats.loading) {
    return (
      <AdminLayout pageTitle="Dashboard" pageDescription="System overview" pageIcon={IconDashboard}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
          <div className="admin-spinner" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Loading dashboard…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout pageTitle="Dashboard" pageDescription="System overview" pageIcon={IconDashboard}>

      {/* ── Stat Cards ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, marginBottom: 24 }}>

        <div className="admin-stat-card clickable" onClick={() => router.push('/admin/total-invoices')}>
          <div className="admin-stat-icon teal"><IconFileText size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="admin-stat-value">{stats.totalInvoices}</div>
            <div className="admin-stat-label">Total Invoices</div>
            <div className="admin-stat-sub">All processed invoices</div>
          </div>
          <IconArrowUpRight size={15} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 4 }} />
        </div>

        <div
          className="admin-stat-card clickable"
          onClick={() => router.push('/admin/pending-invoices')}
          style={stats.pendingInvoices > 0 ? { borderColor: 'rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.04)' } : {}}
        >
          <div className={`admin-stat-icon ${stats.pendingInvoices > 0 ? 'rose' : 'teal'}`}>
            <IconClock size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="admin-stat-value" style={stats.pendingInvoices > 0 ? { color: '#f43f5e' } : {}}>
              {stats.pendingInvoices}
            </div>
            <div className="admin-stat-label">Pending Review</div>
            <div className="admin-stat-sub">{stats.pendingInvoices > 0 ? 'Requires attention' : 'All caught up'}</div>
          </div>
          {stats.pendingInvoices > 0 && <span className="admin-badge rose">!</span>}
        </div>

        <div className="admin-stat-card clickable" onClick={() => router.push('/admin/clients')}>
          <div className="admin-stat-icon emerald"><IconUsers size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="admin-stat-value">{stats.clientCount}</div>
            <div className="admin-stat-label">Active Clients</div>
            <div className="admin-stat-sub">Restaurant partners</div>
          </div>
          <IconArrowUpRight size={15} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 4 }} />
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon violet">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="admin-stat-value">
              ${stats.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <div className="admin-stat-label">Total Analyzed</div>
            <div className="admin-stat-sub">Invoice value processed</div>
          </div>
        </div>
      </div>

      {/* ── Main grid: Activity feed + Right column ───────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>

        {/* Recent Activity */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Recent Activity</h2>
            <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => router.push('/admin/activity')}>
              View all <IconChevronRight size={13} />
            </button>
          </div>

          {stats.recentActivity.length === 0 ? (
            <div className="admin-empty">
              <div className="admin-empty-icon"><IconBell size={22} /></div>
              <h3>No recent activity</h3>
              <p>Logs will appear here as actions are performed.</p>
            </div>
          ) : (
            <div>
              {stats.recentActivity.map((activity, i) => {
                const Icon = getActivityIcon(activity.activity_type);
                return (
                  <div
                    key={activity.id}
                    className="admin-activity-item"
                    style={{ borderBottom: i < stats.recentActivity.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                  >
                    <div className="admin-activity-icon"><Icon size={15} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="admin-activity-title">{activity.title}</p>
                      {activity.subtitle && <p className="admin-activity-sub">{activity.subtitle}</p>}
                      {activity.restaurant_name && (
                        <span className="admin-badge teal" style={{ marginTop: 6, display: 'inline-flex' }}>
                          {activity.restaurant_name}
                        </span>
                      )}
                    </div>
                    <span className="admin-activity-time">{formatRelativeTime(activity.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Quick Actions */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Quick Actions</h2>
            </div>
            <div style={{ padding: '8px 8px' }}>
              {[
                { label: 'Review Pending Invoices', href: '/admin/pending-invoices', warning: stats.pendingInvoices > 0, count: stats.pendingInvoices },
                { label: 'All Invoices',            href: '/admin/total-invoices' },
                { label: 'Client Management',       href: '/admin/clients' },
                { label: 'Prospective Clients',     href: '/admin/prospective-clients' },
                { label: 'Analytics',               href: '/admin/analytics' },
              ].map((action, i) => (
                <button
                  key={i}
                  onClick={() => router.push(action.href)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: 'none', cursor: 'pointer',
                    background: action.warning ? 'rgba(244,63,94,0.07)' : 'transparent',
                    color: action.warning ? '#f43f5e' : 'var(--text-secondary)',
                    fontSize: '0.83rem', fontWeight: 500, fontFamily: 'var(--font-body)',
                    transition: 'all 0.15s ease', textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = action.warning ? 'rgba(244,63,94,0.13)' : 'var(--bg-elevated)';
                    e.currentTarget.style.color = action.warning ? '#f43f5e' : 'var(--text-primary)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = action.warning ? 'rgba(244,63,94,0.07)' : 'transparent';
                    e.currentTarget.style.color = action.warning ? '#f43f5e' : 'var(--text-secondary)';
                  }}
                >
                  <span>{action.label}</span>
                  {action.warning
                    ? <span className="admin-badge rose">{action.count}</span>
                    : <IconChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
                  }
                </button>
              ))}
            </div>
          </div>

          {/* System Health */}
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">System Health</h2>
              <button
                className="admin-btn admin-btn-ghost admin-btn-sm"
                onClick={() => { fetchDashboardStats(); fetchSystemHealth(); }}
              >
                <IconRefresh size={13} />
              </button>
            </div>
            <div style={{ padding: '4px 0' }}>
              {[
                {
                  icon: IconActivity,
                  label: 'Recent Activity',
                  metric: 'recentActivity',
                  detail: systemHealth.recentActivity.loading
                    ? 'Checking…'
                    : `${systemHealth.recentActivity.count} events / 24h`,
                },
                {
                  icon: IconUsers,
                  label: 'Client Engagement',
                  metric: 'clientEngagement',
                  detail: systemHealth.clientEngagement.loading
                    ? 'Analyzing…'
                    : `${systemHealth.clientEngagement.percentage}% active this month`,
                },
                {
                  icon: IconWifi,
                  label: 'System Response',
                  metric: 'systemResponse',
                  detail: systemHealth.systemResponse.loading
                    ? 'Testing…'
                    : systemHealth.systemResponse.status === 'operational'
                      ? 'All systems nominal'
                      : `${systemHealth.systemResponse.responseTime}ms`,
                },
              ].map((item, i) => {
                const Icon = item.icon;
                const health = systemHealth[item.metric];
                const dot = healthDot(health.status);
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 20px',
                      borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}
                  >
                    <Icon size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 1 }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>{item.detail}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <div className={`admin-status-dot ${dot}`} />
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {healthLabel(item.metric, health.status)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

    </AdminLayout>
  );
}