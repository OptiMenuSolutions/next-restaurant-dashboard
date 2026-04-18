// components/AdminLayout.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import supabase from '../lib/supabaseClient';
import {
  IconDashboard,
  IconClock,
  IconFileText,
  IconTrendingUp,
  IconBook,
  IconSearch,
  IconUsers,
  IconUserPlus,
  IconSettings,
  IconHelp,
  IconMenu2,
  IconX,
  IconLogout,
} from '@tabler/icons-react';

export default function AdminLayout({ children, pageTitle, pageDescription, pageIcon: PageIcon }) {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    fetchUserProfile();
  }, []);

  async function fetchUserProfile() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return;
      setUserProfile({
        full_name: user.email?.split('@')[0] || 'Admin',
        email: user.email,
      });
    } catch (err) {
      console.error('Error fetching user profile:', err);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/admin/login');
  }

  const navigationData = {
    main: [
      { title: 'Dashboard',      icon: IconDashboard,  href: '/admin',                     active: router.pathname === '/admin' },
      { title: 'Pending Review', icon: IconClock,      href: '/admin/pending-invoices',    active: router.pathname === '/admin/pending-invoices' },
      { title: 'All Invoices',   icon: IconFileText,   href: '/admin/total-invoices',      active: router.pathname === '/admin/total-invoices' },
      { title: 'Analytics',      icon: IconTrendingUp, href: '/admin/analytics',           active: router.pathname === '/admin/analytics' },
      { title: 'Ingredients',    icon: IconBook,       href: '/admin/ingredients',         active: router.pathname === '/admin/ingredients' },
      { title: 'Menu Items',     icon: IconSearch,     href: '/admin/menu-items',          active: router.pathname === '/admin/menu-items' },
      { title: 'Clients',        icon: IconUsers,      href: '/admin/clients',             active: router.pathname === '/admin/clients' },
      { title: 'Prospects',      icon: IconUserPlus,   href: '/admin/prospective-clients', active: router.pathname === '/admin/prospective-clients' },
    ],
    secondary: [
      { title: 'Settings', icon: IconSettings, href: '/admin/settings', active: router.pathname === '/admin/settings' },
      { title: 'Help',     icon: IconHelp,     href: '/admin/help',     active: router.pathname === '/admin/help' },
    ],
  };

  const getUserInitials = () => {
    if (userProfile?.full_name) {
      return userProfile.full_name.split(' ').map(n => n.charAt(0)).slice(0, 2).join('').toUpperCase();
    }
    return 'AD';
  };

  // ── Nav item (main) ──────────────────────────────────────────────────
  const NavItem = ({ item, index }) => {
    const Icon = item.icon;
    const key = `main-${index}`;
    const isHovered = hoveredItem === key;

    return (
      <div style={{ position: 'relative' }}>
        <Link
          href={item.href}
          onMouseEnter={() => setHoveredItem(key)}
          onMouseLeave={() => setHoveredItem(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'clamp(32px, 5vh, 48px)',
            height: 'clamp(32px, 5vh, 48px)',
            borderRadius: '50%',
            transition: 'all 0.2s ease',
            textDecoration: 'none',
            flexShrink: 0,
            color: item.active ? '#fff' : 'rgba(255,255,255,0.55)',
            backgroundColor: item.active ? '#02a4ba' : 'transparent',
            boxShadow: item.active
              ? '0 8px 20px -4px rgba(2,164,186,0.4), 0 4px 8px -2px rgba(2,164,186,0.2)'
              : 'none',
            ...(isHovered && !item.active ? {
              color: 'rgba(255,255,255,0.9)',
              backgroundColor: 'rgba(255,255,255,0.12)',
            } : {}),
          }}
        >
          <Icon style={{ width: 'clamp(15px, 2.5vh, 20px)', height: 'clamp(15px, 2.5vh, 20px)' }} />
        </Link>

        {/* Tooltip */}
        {isHovered && (
          <div style={{
            position: 'absolute',
            left: 'calc(100% + 14px)',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 100,
            pointerEvents: 'none',
          }}>
            <div style={{
              background: '#1c1a18',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#f5f3f0',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: '0.78rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              fontFamily: "'Inter', sans-serif",
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {item.title}
              {/* Arrow */}
              <div style={{
                position: 'absolute',
                left: -4,
                top: '50%',
                transform: 'translateY(-50%) rotate(45deg)',
                width: 8,
                height: 8,
                background: '#1c1a18',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRight: 'none',
                borderTop: 'none',
              }} />
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Secondary / icon-button item ────────────────────────────────────
  const SecondaryItem = ({ item, index, isLogout = false }) => {
    const Icon = item.icon;
    const key = `sec-${index}`;
    const isHovered = hoveredItem === key;

    const handleClick = (e) => {
      if (isLogout) {
        e.preventDefault();
        handleSignOut();
      } else {
        router.push(item.href);
      }
    };

    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={handleClick}
          onMouseEnter={() => setHoveredItem(key)}
          onMouseLeave={() => setHoveredItem(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'clamp(32px, 5vh, 48px)',
            height: 'clamp(32px, 5vh, 48px)',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            flexShrink: 0,
            color: item.active ? '#fff' : 'rgba(255,255,255,0.4)',
            backgroundColor: item.active ? '#02a4ba' : 'transparent',
            boxShadow: item.active
              ? '0 8px 20px -4px rgba(2,164,186,0.4)'
              : 'none',
            ...(isHovered && !item.active ? {
              color: 'rgba(255,255,255,0.75)',
              backgroundColor: 'rgba(255,255,255,0.1)',
            } : {}),
          }}
        >
          <Icon style={{ width: 'clamp(15px, 2.5vh, 20px)', height: 'clamp(15px, 2.5vh, 20px)' }} />
        </button>

        {/* Tooltip */}
        {isHovered && (
          <div style={{
            position: 'absolute',
            left: 'calc(100% + 14px)',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 100,
            pointerEvents: 'none',
          }}>
            <div style={{
              background: '#1c1a18',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#f5f3f0',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: '0.78rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              fontFamily: "'Inter', sans-serif",
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {item.title}
              <div style={{
                position: 'absolute',
                left: -4,
                top: '50%',
                transform: 'translateY(-50%) rotate(45deg)',
                width: 8,
                height: 8,
                background: '#1c1a18',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRight: 'none',
                borderTop: 'none',
              }} />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');

        :root {
          --bg-base:        #0a0908;
          --bg-surface:     #131211;
          --bg-elevated:    #1c1a18;
          --bg-hover:       #242220;
          --border:         rgba(255,255,255,0.07);
          --border-strong:  rgba(255,255,255,0.12);
          --accent:         #02a4ba;
          --accent-dim:     rgba(2, 164, 186, 0.15);
          --accent-glow:    rgba(2, 164, 186, 0.25);
          --text-primary:   #f5f3f0;
          --text-secondary: #9b9590;
          --text-muted:     #5c5650;
          --font-display:   'Playfair Display', Georgia, serif;
          --font-body:      'Inter', system-ui, sans-serif;
          --sidebar-width:  clamp(64px, 8vh, 88px);
          --transition:     all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        * { box-sizing: border-box; }

        body {
          background-color: var(--bg-base);
          color: var(--text-primary);
          font-family: var(--font-body);
          margin: 0;
        }

        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

        /* ── Sidebar ── */
        .admin-sidebar {
          position: fixed;
          left: 0;
          top: 0;
          height: 100vh;
          width: var(--sidebar-width);
          background: rgba(30, 27, 24, 0.97);
          backdrop-filter: blur(8px);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          align-items: center;
          z-index: 40;
          transition: transform 0.25s ease;
        }

        /* ── Main content ── */
        .admin-main {
          margin-left: var(--sidebar-width);
          min-height: 100vh;
          background-color: var(--bg-base);
          background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0);
          background-size: 28px 28px;
        }

        /* ── Page content ── */
        .admin-content {
          padding: clamp(20px, 2.5vh, 40px) clamp(20px, 3vw, 48px);
        }

        /* ── Cards ── */
        .admin-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          overflow: hidden;
        }

        .admin-card-header {
          padding: 20px 24px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .admin-card-title {
          font-family: var(--font-display);
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        /* ── Stat cards ── */
        .admin-stat-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 20px 24px;
          display: flex;
          align-items: flex-start;
          gap: 16px;
          transition: var(--transition);
        }
        .admin-stat-card:hover { border-color: var(--border-strong); background: var(--bg-elevated); }
        .admin-stat-card.clickable { cursor: pointer; }

        .admin-stat-icon {
          width: 44px; height: 44px;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .admin-stat-icon.teal    { background: rgba(2,164,186,0.15);   color: #02a4ba; }
        .admin-stat-icon.amber   { background: rgba(245,158,11,0.15);  color: #f59e0b; }
        .admin-stat-icon.rose    { background: rgba(244,63,94,0.15);   color: #f43f5e; }
        .admin-stat-icon.emerald { background: rgba(16,185,129,0.15);  color: #10b981; }
        .admin-stat-icon.violet  { background: rgba(139,92,246,0.15);  color: #8b5cf6; }

        .admin-stat-value {
          font-family: var(--font-display);
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
          margin-bottom: 4px;
        }
        .admin-stat-label { font-size: 0.8rem;  font-weight: 500; color: var(--text-secondary); }
        .admin-stat-sub   { font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; }

        /* ── Badges ── */
        .admin-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 4px;
          font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em;
        }
        .admin-badge.teal    { background: rgba(2,164,186,0.15);   color: #02a4ba; border: 1px solid rgba(2,164,186,0.25); }
        .admin-badge.amber   { background: rgba(245,158,11,0.15);  color: #f59e0b; border: 1px solid rgba(245,158,11,0.25); }
        .admin-badge.rose    { background: rgba(244,63,94,0.15);   color: #f43f5e; border: 1px solid rgba(244,63,94,0.25); }
        .admin-badge.emerald { background: rgba(16,185,129,0.15);  color: #10b981; border: 1px solid rgba(16,185,129,0.25); }
        .admin-badge.neutral { background: rgba(255,255,255,0.06); color: var(--text-secondary); border: 1px solid var(--border); }

        /* ── Tables ── */
        .admin-table { width: 100%; border-collapse: collapse; }
        .admin-table thead tr { border-bottom: 1px solid var(--border); }
        .admin-table th {
          text-align: left; padding: 12px 20px;
          font-size: 0.72rem; font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--text-muted); white-space: nowrap;
        }
        .admin-table th.sortable { cursor: pointer; user-select: none; transition: color 0.15s ease; }
        .admin-table th.sortable:hover { color: var(--text-secondary); }
        .admin-table td {
          padding: 14px 20px; font-size: 0.85rem;
          color: var(--text-secondary);
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .admin-table tbody tr { transition: background 0.12s ease; }
        .admin-table tbody tr:hover { background: var(--bg-elevated); }
        .admin-table tbody tr:hover td { color: var(--text-primary); }
        .admin-table td.primary { color: var(--text-primary); font-weight: 500; }

        /* ── Buttons ── */
        .admin-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 8px;
          font-family: var(--font-body); font-size: 0.82rem; font-weight: 500;
          cursor: pointer; transition: var(--transition);
          border: none; text-decoration: none; white-space: nowrap;
        }
        .admin-btn-primary { background: var(--accent); color: #000; }
        .admin-btn-primary:hover { background: #03bdd6; box-shadow: 0 0 20px var(--accent-glow); }
        .admin-btn-ghost {
          background: transparent; color: var(--text-secondary);
          border: 1px solid var(--border);
        }
        .admin-btn-ghost:hover { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border-strong); }
        .admin-btn-danger { background: rgba(244,63,94,0.1); color: #f43f5e; border: 1px solid rgba(244,63,94,0.2); }
        .admin-btn-danger:hover { background: rgba(244,63,94,0.2); }
        .admin-btn-sm { padding: 5px 10px; font-size: 0.75rem; border-radius: 6px; gap: 4px; }

        /* ── Form Inputs ── */
        .admin-input {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 8px; color: var(--text-primary);
          font-family: var(--font-body); font-size: 0.85rem;
          padding: 9px 14px; width: 100%;
          transition: var(--transition); outline: none;
        }
        .admin-input::placeholder { color: var(--text-muted); }
        .admin-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
        .admin-input:disabled { opacity: 0.5; cursor: not-allowed; }

        .admin-select {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 8px; color: var(--text-primary);
          font-family: var(--font-body); font-size: 0.85rem;
          padding: 9px 14px; transition: var(--transition);
          outline: none; cursor: pointer;
        }
        .admin-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }

        .admin-label {
          display: block; font-size: 0.75rem; font-weight: 500;
          color: var(--text-secondary); letter-spacing: 0.04em;
          text-transform: uppercase; margin-bottom: 6px;
        }

        /* ── Misc ── */
        .admin-divider { border: none; border-top: 1px solid var(--border); margin: 0; }

        .admin-spinner {
          width: 32px; height: 32px;
          border: 2px solid var(--border-strong);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .admin-empty {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 64px 32px; text-align: center; gap: 12px;
        }
        .admin-empty-icon {
          width: 56px; height: 56px; border-radius: 14px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); margin-bottom: 4px;
        }
        .admin-empty h3 { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin: 0; }
        .admin-empty p  { font-size: 0.85rem; color: var(--text-muted); margin: 0; max-width: 320px; }

        .admin-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .admin-status-dot.green  { background: #10b981; box-shadow: 0 0 6px rgba(16,185,129,0.5); }
        .admin-status-dot.amber  { background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.5); }
        .admin-status-dot.red    { background: #f43f5e; box-shadow: 0 0 6px rgba(244,63,94,0.5); }

        .admin-pagination { display: flex; align-items: center; gap: 4px; }
        .admin-page-btn {
          width: 32px; height: 32px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.8rem; font-weight: 500; cursor: pointer;
          transition: var(--transition); border: none;
          background: transparent; color: var(--text-secondary);
        }
        .admin-page-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .admin-page-btn.active { background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(2,164,186,0.25); }
        .admin-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        .admin-activity-item {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 14px 24px; transition: background 0.12s ease;
        }
        .admin-activity-item:hover { background: var(--bg-elevated); }
        .admin-activity-icon {
          width: 34px; height: 34px; border-radius: 8px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); flex-shrink: 0;
        }
        .admin-activity-title { font-size: 0.85rem; font-weight: 500; color: var(--text-primary); margin: 0 0 2px; }
        .admin-activity-sub   { font-size: 0.78rem; color: var(--text-muted); margin: 0; }
        .admin-activity-time  { font-size: 0.72rem; color: var(--text-muted); flex-shrink: 0; margin-top: 2px; }

        .admin-section-title { font-family: var(--font-display); font-size: 1rem; font-weight: 600; color: var(--text-primary); margin: 0; }

        .admin-search-inline { position: relative; flex: 1; }
        .admin-search-inline input {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 8px; color: var(--text-primary);
          font-family: var(--font-body); font-size: 0.85rem;
          padding: 9px 14px 9px 38px; width: 100%;
          outline: none; transition: var(--transition);
        }
        .admin-search-inline input::placeholder { color: var(--text-muted); }
        .admin-search-inline input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
        .admin-search-inline svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }

        .admin-filter-bar {
          display: flex; align-items: center; gap: 8px;
          padding: 16px 24px; border-bottom: 1px solid var(--border); flex-wrap: wrap;
        }

        /* ── Animations ── */
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .admin-fade-in { animation: fadeIn 0.3s ease forwards; }

        /* ── Mobile ── */
        @media (max-width: 1024px) {
          .admin-sidebar { transform: translateX(-100%); }
          .admin-sidebar.mobile-open { transform: translateX(0); }
          .admin-main { margin-left: 0 !important; }
          .admin-content { padding: 20px; }
        }
      `}</style>

      <div style={{ fontFamily: 'var(--font-body)' }}>

        {/* ── Sidebar ── */}
        <aside className={`admin-sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>

          {/* Logo */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', paddingTop: 'clamp(12px, 2vh, 24px)',
            paddingBottom: 'clamp(8px, 1.5vh, 16px)',
          }}>
            <img
              src="/optimenu-logo-collapsed.png"
              alt="OptiMenu"
              style={{
                width: 'clamp(24px, 4vh, 36px)',
                height: 'clamp(24px, 4vh, 36px)',
                objectFit: 'contain',
              }}
            />
          </div>

          {/* Thin divider */}
          <div style={{ width: '40%', height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 'clamp(8px, 1.5vh, 16px)' }} />

          {/* Main nav — vertically centered */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'clamp(6px, 1.8vh, 20px)',
            padding: '8px 0',
          }}>
            {navigationData.main.map((item, i) => (
              <NavItem key={i} item={item} index={i} />
            ))}
          </div>

          {/* Bottom: secondary + logout + avatar */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(6px, 1.2vh, 14px)',
            paddingBottom: 'clamp(12px, 2vh, 24px)',
          }}>
            {navigationData.secondary.map((item, i) => (
              <SecondaryItem key={i} item={item} index={i} />
            ))}

            <SecondaryItem
              item={{ title: 'Log Out', icon: IconLogout, href: '/logout', active: false }}
              index="logout"
              isLogout={true}
            />

            {/* Thin divider above avatar */}
            <div style={{ width: '40%', height: 1, background: 'rgba(255,255,255,0.08)' }} />

            {/* User avatar */}
            <div
              title={userProfile?.email || 'Admin'}
              style={{
                width: 'clamp(28px, 4vh, 38px)',
                height: 'clamp(28px, 4vh, 38px)',
                borderRadius: '50%',
                background: 'rgba(2,164,186,0.15)',
                border: '1px solid rgba(2,164,186,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'clamp(9px, 1.3vh, 12px)',
                fontWeight: 600,
                color: '#02a4ba',
                fontFamily: "'Inter', sans-serif",
                letterSpacing: '0.03em',
                cursor: 'default',
              }}
            >
              {getUserInitials()}
            </div>
          </div>
        </aside>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileMenuOpen(o => !o)}
          style={{
            display: 'none', // shown via media query below
            position: 'fixed', top: 16, left: 16, zIndex: 50,
            width: 40, height: 40, borderRadius: 8,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
          className="mobile-menu-btn"
        >
          {mobileMenuOpen ? <IconX size={18} /> : <IconMenu2 size={18} />}
        </button>

        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 35,
            }}
          />
        )}

        {/* ── Main content ── */}
        <div className="admin-main">
          <main className="admin-content admin-fade-in">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}