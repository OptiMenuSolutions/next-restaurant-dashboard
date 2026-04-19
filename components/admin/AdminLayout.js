// components/admin/AdminLayout.js
// Wraps every admin page. Includes topbar, sidebar navigation, and main content area.
// Matches OptiMenu's dark design system: #0a0908 bg, #02a4ba teal, Playfair + Inter.

import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

const NAV = [
  {
    group: 'Overview',
    items: [
      { label: 'Dashboard',       href: '/admin',                icon: 'grid' },
      { label: 'MRR & Revenue',   href: '/admin/revenue',        icon: 'trending-up' },
      { label: 'Churn Forecast',  href: '/admin/churn',          icon: 'activity' },
    ],
  },
  {
    group: 'Customers',
    items: [
      { label: 'All Restaurants', href: '/admin/restaurants',    icon: 'store' },
      { label: 'At Risk',         href: '/admin/at-risk',        icon: 'alert-triangle', badge: 'red' },
      { label: 'Onboarding',      href: '/admin/onboarding',     icon: 'user-plus' },
    ],
  },
  {
    group: 'Customer Data',
    items: [
      { label: 'Menu Items',      href: '/admin/data/menu',      icon: 'bar-chart-2' },
      { label: 'Ingredients',     href: '/admin/data/ingredients', icon: 'droplet' },
      { label: 'Invoices',        href: '/admin/data/invoices',  icon: 'file-text' },
      { label: 'POS Analytics',   href: '/admin/data/analytics', icon: 'activity' },
    ],
  },
  {
    group: 'Product',
    items: [
      { label: 'AI Usage & Costs', href: '/admin/ai',            icon: 'cpu' },
      { label: 'Global Ingredients', href: '/admin/ingredients', icon: 'list' },
      { label: 'Parse Quality',   href: '/admin/parse-quality',  icon: 'check-circle' },
      { label: 'Feature Flags',   href: '/admin/flags',          icon: 'flag' },
    ],
  },
  {
    group: 'Support',
    items: [
      { label: 'Feedback',        href: '/admin/feedback',       icon: 'message-square', badge: 'amber' },
      { label: 'Error Queue',     href: '/admin/errors',         icon: 'alert-circle',   badge: 'red' },
      { label: 'Audit Log',       href: '/admin/audit',          icon: 'clipboard' },
    ],
  },
];

// Feather-style SVG icons (inline, no external dependency)
function Icon({ name, size = 14 }) {
  const icons = {
    'grid':           <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    'trending-up':    <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    'activity':       <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>,
    'store':          <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    'alert-triangle': <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    'user-plus':      <><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></>,
    'bar-chart-2':    <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    'droplet':        <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/>,
    'file-text':      <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></>,
    'cpu':            <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></>,
    'list':           <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    'check-circle':   <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
    'flag':           <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></>,
    'message-square': <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>,
    'alert-circle':   <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    'clipboard':      <><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></>,
    'log-out':        <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    'refresh-cw':     <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>,
  };
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {icons[name] || null}
    </svg>
  );
}

export default function AdminLayout({ children, title = 'Admin' }) {
  const router = useRouter();
  const supabase = createClientComponentClient();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  const isActive = (href) => {
    if (href === '/admin') return router.pathname === '/admin';
    return router.pathname.startsWith(href);
  };

  return (
    <>
      <Head>
        <title>{title} — OptiMenu Admin</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>

      <div style={styles.shell}>
        {/* ── TOPBAR ────────────────────────────────────────────────────── */}
        <header style={styles.topbar}>
          <div style={styles.topbarLeft}>
            <span style={styles.logo}>
              Opti<span style={styles.logoAccent}>Menu</span>
              <span style={styles.logoSub}>admin</span>
            </span>
            <div style={styles.liveChip}>
              <div style={styles.liveDot} />
              live
            </div>
          </div>
          <div style={styles.topbarRight}>
            <span style={styles.adminBadge}>Super Admin</span>
            <div style={styles.avatar}>NP</div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              style={styles.signOutBtn}
              title="Sign out"
            >
              <Icon name="log-out" size={13} />
            </button>
          </div>
        </header>

        {/* ── SIDEBAR ───────────────────────────────────────────────────── */}
        <aside style={styles.sidebar}>
          {NAV.map((section) => (
            <div key={section.group} style={styles.navGroup}>
              <div style={styles.navGroupLabel}>{section.group}</div>
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    style={{
                      ...styles.navItem,
                      ...(active ? styles.navItemActive : {}),
                    }}
                  >
                    <span style={{ color: active ? '#02a4ba' : '#5a6080', transition: 'color 0.15s' }}>
                      <Icon name={item.icon} size={13} />
                    </span>
                    <span style={styles.navLabel}>{item.label}</span>
                    {item.badge === 'red' && <span style={styles.badgeRed}>!</span>}
                    {item.badge === 'amber' && <span style={styles.badgeAmber}>!</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
        <main style={styles.main}>
          {children}
        </main>
      </div>
    </>
  );
}

const styles = {
  shell: {
    display: 'grid',
    gridTemplateColumns: '210px 1fr',
    gridTemplateRows: '48px 1fr',
    height: '100vh',
    background: '#0a0908',
    overflow: 'hidden',
    fontFamily: "'Inter', sans-serif",
  },
  topbar: {
    gridColumn: '1 / -1',
    background: '#111318',
    borderBottom: '1px solid #1e2028',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    flexShrink: 0,
    zIndex: 10,
  },
  topbarLeft: { display: 'flex', alignItems: 'center', gap: 14 },
  logo: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 700,
    color: '#e4e6f0',
    letterSpacing: '-0.3px',
  },
  logoAccent: { color: '#02a4ba' },
  logoSub: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    fontWeight: 400,
    color: '#4a5068',
    marginLeft: 8,
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  liveChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 9,
    fontWeight: 600,
    color: '#02a4ba',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    background: 'rgba(2,164,186,0.1)',
    border: '1px solid rgba(2,164,186,0.25)',
    borderRadius: 20,
    padding: '2px 8px',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: '#02a4ba',
    animation: 'pulse 2s infinite',
  },
  topbarRight: { display: 'flex', alignItems: 'center', gap: 10 },
  adminBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: '#02a4ba',
    background: 'rgba(2,164,186,0.1)',
    border: '1px solid rgba(2,164,186,0.2)',
    borderRadius: 20,
    padding: '2px 8px',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'rgba(2,164,186,0.15)',
    border: '1px solid rgba(2,164,186,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    fontWeight: 700,
    color: '#02a4ba',
  },
  signOutBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#4a5068',
    display: 'flex',
    alignItems: 'center',
    padding: 4,
    borderRadius: 4,
    transition: 'color 0.15s',
  },
  sidebar: {
    background: '#111318',
    borderRight: '1px solid #1e2028',
    overflowY: 'auto',
    padding: '12px 0 24px',
  },
  navGroup: { marginBottom: 20 },
  navGroupLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: '#3a3e50',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    padding: '0 16px',
    marginBottom: 4,
  },
  navItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 16px',
    fontSize: 11,
    fontWeight: 500,
    color: '#5a6080',
    background: 'none',
    border: 'none',
    borderLeft: '2px solid transparent',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.1s',
    fontFamily: "'Inter', sans-serif",
  },
  navItemActive: {
    color: '#02a4ba',
    background: 'rgba(2,164,186,0.07)',
    borderLeftColor: '#02a4ba',
  },
  navLabel: { flex: 1 },
  badgeRed: {
    fontSize: 8,
    fontWeight: 700,
    background: 'rgba(232,84,84,0.15)',
    color: '#e85454',
    border: '1px solid rgba(232,84,84,0.3)',
    borderRadius: 10,
    padding: '1px 5px',
  },
  badgeAmber: {
    fontSize: 8,
    fontWeight: 700,
    background: 'rgba(245,166,35,0.15)',
    color: '#f5a623',
    border: '1px solid rgba(245,166,35,0.3)',
    borderRadius: 10,
    padding: '1px 5px',
  },
  main: {
    overflowY: 'auto',
    background: '#0a0908',
    display: 'flex',
    flexDirection: 'column',
  },
};