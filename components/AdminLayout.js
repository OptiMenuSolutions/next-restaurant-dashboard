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
  IconChevronRight,
} from '@tabler/icons-react';

export default function AdminLayout({ children, pageTitle, pageDescription, pageIcon: PageIcon }) {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetchUserProfile();
  }, []);

  async function fetchUserProfile() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return;
      setUserProfile({
        full_name: user.email?.split('@')[0] || 'Admin',
        email: user.email
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
      { title: 'Dashboard',       icon: IconDashboard,  href: '/admin',                        active: router.pathname === '/admin' },
      { title: 'Pending Review',  icon: IconClock,      href: '/admin/pending-invoices',       active: router.pathname === '/admin/pending-invoices' },
      { title: 'All Invoices',    icon: IconFileText,   href: '/admin/total-invoices',         active: router.pathname === '/admin/total-invoices' },
      { title: 'Analytics',       icon: IconTrendingUp, href: '/admin/analytics',              active: router.pathname === '/admin/analytics' },
      { title: 'Ingredients',     icon: IconBook,       href: '/admin/ingredients',            active: router.pathname === '/admin/ingredients' },
      { title: 'Menu Items',      icon: IconSearch,     href: '/admin/menu-items',             active: router.pathname === '/admin/menu-items' },
      { title: 'Clients',         icon: IconUsers,      href: '/admin/clients',                active: router.pathname === '/admin/clients' },
      { title: 'Prospects',       icon: IconUserPlus,   href: '/admin/prospective-clients',    active: router.pathname === '/admin/prospective-clients' },
    ],
    secondary: [
      { title: 'Settings', icon: IconSettings, href: '/admin/settings', active: router.pathname === '/admin/settings' },
      { title: 'Help',     icon: IconHelp,     href: '/admin/help',     active: router.pathname === '/admin/help' },
    ]
  };

  const getUserInitials = () => {
    if (userProfile?.full_name) {
      return userProfile.full_name.split(' ').map(n => n.charAt(0)).slice(0, 2).join('').toUpperCase();
    }
    return 'AD';
  };

  const sidebarWidth = collapsed ? '72px' : '220px';

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
          --sidebar-width:  ${sidebarWidth};
          --transition:     all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        * { box-sizing: border-box; }

        body {
          background-color: var(--bg-base);
          color: var(--text-primary);
          font-family: var(--font-body);
          margin: 0;
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

        /* ---- Sidebar ---- */
        .admin-sidebar {
          position: fixed;
          left: 0;
          top: 0;
          height: 100vh;
          width: var(--sidebar-width);
          background: var(--bg-surface);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          z-index: 40;
          transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
        }

        .admin-sidebar-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 20px 16px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          min-height: 72px;
          overflow: hidden;
        }

        .admin-sidebar-logo img {
          width: 36px;
          height: 36px;
          object-fit: contain;
          flex-shrink: 0;
        }

        .admin-sidebar-logo-text {
          font-family: var(--font-display);
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          opacity: 1;
          transition: opacity 0.15s ease;
        }

        .admin-sidebar-logo-text.hidden {
          opacity: 0;
          pointer-events: none;
        }

        .admin-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 12px 0;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .admin-nav-section-label {
          font-family: var(--font-body);
          font-size: 0.6rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 8px 18px 4px;
          white-space: nowrap;
          opacity: 1;
          transition: opacity 0.15s ease;
        }

        .admin-nav-section-label.hidden {
          opacity: 0;
        }

        .admin-nav-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 16px;
          margin: 1px 8px;
          border-radius: 8px;
          text-decoration: none;
          color: var(--text-secondary);
          font-family: var(--font-body);
          font-size: 0.85rem;
          font-weight: 500;
          transition: var(--transition);
          white-space: nowrap;
          overflow: hidden;
          position: relative;
          cursor: pointer;
          border: none;
          background: transparent;
          width: calc(100% - 16px);
          text-align: left;
        }

        .admin-nav-item:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .admin-nav-item.active {
          color: var(--accent);
          background: var(--accent-dim);
        }

        .admin-nav-item.active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          background: var(--accent);
          border-radius: 0 2px 2px 0;
        }

        .admin-nav-item svg {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
        }

        .admin-nav-item-label {
          opacity: 1;
          transition: opacity 0.15s ease;
          flex: 1;
        }

        .admin-nav-item-label.hidden {
          opacity: 0;
          width: 0;
        }

        .admin-sidebar-bottom {
          border-top: 1px solid var(--border);
          padding: 12px 0;
          flex-shrink: 0;
        }

        .admin-sidebar-user {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          margin: 0 8px;
          border-radius: 8px;
          overflow: hidden;
        }

        .admin-sidebar-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--accent-dim);
          border: 1px solid var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-body);
          font-size: 0.65rem;
          font-weight: 600;
          color: var(--accent);
          flex-shrink: 0;
          letter-spacing: 0.02em;
        }

        .admin-sidebar-user-info {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          opacity: 1;
          transition: opacity 0.15s ease;
          min-width: 0;
        }

        .admin-sidebar-user-info.hidden {
          opacity: 0;
          width: 0;
        }

        .admin-sidebar-user-name {
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .admin-sidebar-user-role {
          font-size: 0.7rem;
          color: var(--text-muted);
          white-space: nowrap;
        }

        .admin-collapse-btn {
          position: absolute;
          right: -12px;
          top: 50%;
          transform: translateY(-50%);
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-strong);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-secondary);
          transition: var(--transition);
          z-index: 50;
        }

        .admin-collapse-btn:hover {
          color: var(--text-primary);
          border-color: var(--accent);
        }

        .admin-collapse-btn svg {
          transition: transform 0.25s ease;
        }

        .admin-collapse-btn.collapsed svg {
          transform: rotate(180deg);
        }

        /* ---- Main Content ---- */
        .admin-main {
          margin-left: var(--sidebar-width);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          transition: margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          background-color: var(--bg-base);
          background-image:
            radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0);
          background-size: 24px 24px;
        }

        /* ---- Header ---- */
        .admin-header {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(10, 9, 8, 0.85);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          padding: 0 32px;
          height: 68px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .admin-header-left {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }

        .admin-header-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--accent-dim);
          border: 1px solid rgba(2, 164, 186, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
          flex-shrink: 0;
        }

        .admin-page-title {
          font-family: var(--font-display);
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin: 0;
        }

        .admin-page-desc {
          font-size: 0.78rem;
          color: var(--text-muted);
          margin: 0;
          white-space: nowrap;
        }

        .admin-header-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        /* ---- Search ---- */
        .admin-search {
          position: relative;
        }

        .admin-search input {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: 0.82rem;
          padding: 8px 14px 8px 36px;
          width: 260px;
          transition: var(--transition);
          outline: none;
        }

        .admin-search input::placeholder {
          color: var(--text-muted);
        }

        .admin-search input:focus {
          border-color: var(--accent);
          background: var(--bg-surface);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }

        .admin-search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
        }

        /* ---- Page Content ---- */
        .admin-content {
          flex: 1;
          padding: 32px;
        }

        /* ---- Cards ---- */
        .admin-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 12px;
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

        /* ---- Stat Cards ---- */
        .admin-stat-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px 24px;
          display: flex;
          align-items: flex-start;
          gap: 16px;
          transition: var(--transition);
        }

        .admin-stat-card:hover {
          border-color: var(--border-strong);
          background: var(--bg-elevated);
        }

        .admin-stat-card.clickable {
          cursor: pointer;
        }

        .admin-stat-icon {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .admin-stat-icon.teal    { background: rgba(2, 164, 186, 0.15); color: #02a4ba; }
        .admin-stat-icon.amber   { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
        .admin-stat-icon.rose    { background: rgba(244, 63, 94, 0.15);  color: #f43f5e; }
        .admin-stat-icon.emerald { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .admin-stat-icon.violet  { background: rgba(139, 92, 246, 0.15); color: #8b5cf6; }

        .admin-stat-value {
          font-family: var(--font-display);
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
          margin-bottom: 4px;
        }

        .admin-stat-label {
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .admin-stat-sub {
          font-size: 0.72rem;
          color: var(--text-muted);
          margin-top: 2px;
        }

        /* ---- Badges ---- */
        .admin-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        .admin-badge.teal    { background: rgba(2, 164, 186, 0.15); color: #02a4ba; border: 1px solid rgba(2, 164, 186, 0.25); }
        .admin-badge.amber   { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.25); }
        .admin-badge.rose    { background: rgba(244, 63, 94, 0.15);  color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.25); }
        .admin-badge.emerald { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25); }
        .admin-badge.neutral { background: rgba(255,255,255,0.06);   color: var(--text-secondary); border: 1px solid var(--border); }

        /* ---- Tables ---- */
        .admin-table {
          width: 100%;
          border-collapse: collapse;
        }

        .admin-table thead tr {
          border-bottom: 1px solid var(--border);
        }

        .admin-table th {
          text-align: left;
          padding: 12px 20px;
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
          white-space: nowrap;
        }

        .admin-table th.sortable {
          cursor: pointer;
          user-select: none;
          transition: color 0.15s ease;
        }

        .admin-table th.sortable:hover {
          color: var(--text-secondary);
        }

        .admin-table td {
          padding: 14px 20px;
          font-size: 0.85rem;
          color: var(--text-secondary);
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }

        .admin-table tbody tr {
          transition: background 0.12s ease;
        }

        .admin-table tbody tr:hover {
          background: var(--bg-elevated);
        }

        .admin-table tbody tr:hover td {
          color: var(--text-primary);
        }

        .admin-table td.primary {
          color: var(--text-primary);
          font-weight: 500;
        }

        /* ---- Buttons ---- */
        .admin-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 8px;
          font-family: var(--font-body);
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
          transition: var(--transition);
          border: none;
          text-decoration: none;
          white-space: nowrap;
        }

        .admin-btn-primary {
          background: var(--accent);
          color: #000;
        }

        .admin-btn-primary:hover {
          background: #03bdd6;
          box-shadow: 0 0 20px var(--accent-glow);
        }

        .admin-btn-ghost {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border);
        }

        .admin-btn-ghost:hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
          border-color: var(--border-strong);
        }

        .admin-btn-danger {
          background: rgba(244, 63, 94, 0.1);
          color: #f43f5e;
          border: 1px solid rgba(244, 63, 94, 0.2);
        }

        .admin-btn-danger:hover {
          background: rgba(244, 63, 94, 0.2);
        }

        .admin-btn-sm {
          padding: 5px 10px;
          font-size: 0.75rem;
          border-radius: 6px;
          gap: 4px;
        }

        /* ---- Form Inputs ---- */
        .admin-input {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: 0.85rem;
          padding: 9px 14px;
          width: 100%;
          transition: var(--transition);
          outline: none;
        }

        .admin-input::placeholder {
          color: var(--text-muted);
        }

        .admin-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }

        .admin-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .admin-select {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: 0.85rem;
          padding: 9px 14px;
          transition: var(--transition);
          outline: none;
          cursor: pointer;
        }

        .admin-select:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }

        /* ---- Label ---- */
        .admin-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        /* ---- Dividers ---- */
        .admin-divider {
          border: none;
          border-top: 1px solid var(--border);
          margin: 0;
        }

        /* ---- Loading Spinner ---- */
        .admin-spinner {
          width: 32px;
          height: 32px;
          border: 2px solid var(--border-strong);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* ---- Empty State ---- */
        .admin-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 64px 32px;
          text-align: center;
          gap: 12px;
        }

        .admin-empty-icon {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          margin-bottom: 4px;
        }

        .admin-empty h3 {
          font-family: var(--font-display);
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .admin-empty p {
          font-size: 0.85rem;
          color: var(--text-muted);
          margin: 0;
          max-width: 320px;
        }

        /* ---- Pill tabs / filter row ---- */
        .admin-filter-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 16px 24px;
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
        }

        /* ---- Health / status indicator ---- */
        .admin-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .admin-status-dot.green  { background: #10b981; box-shadow: 0 0 6px rgba(16,185,129,0.5); }
        .admin-status-dot.amber  { background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.5); }
        .admin-status-dot.red    { background: #f43f5e; box-shadow: 0 0 6px rgba(244,63,94,0.5); }
        .admin-status-dot.teal   { background: #02a4ba; box-shadow: 0 0 6px rgba(2,164,186,0.5); }

        /* ---- Tooltip ---- */
        .admin-tooltip {
          position: relative;
        }

        /* ---- Pagination ---- */
        .admin-pagination {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .admin-page-btn {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          transition: var(--transition);
          border: none;
          background: transparent;
          color: var(--text-secondary);
        }

        .admin-page-btn:hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }

        .admin-page-btn.active {
          background: var(--accent-dim);
          color: var(--accent);
          border: 1px solid rgba(2,164,186,0.25);
        }

        .admin-page-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        /* ---- Mobile ---- */
        @media (max-width: 1024px) {
          .admin-sidebar {
            transform: translateX(-100%);
          }

          .admin-sidebar.open {
            transform: translateX(0);
          }

          .admin-main {
            margin-left: 0 !important;
          }

          .admin-content {
            padding: 20px;
          }

          .admin-header {
            padding: 0 20px;
          }
        }

        /* ---- Animations ---- */
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .admin-fade-in {
          animation: fadeIn 0.3s ease forwards;
        }

        /* ---- Activity feed ---- */
        .admin-activity-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 14px 24px;
          transition: background 0.12s ease;
        }

        .admin-activity-item:hover {
          background: var(--bg-elevated);
        }

        .admin-activity-icon {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .admin-activity-title {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--text-primary);
          margin: 0 0 2px;
        }

        .admin-activity-sub {
          font-size: 0.78rem;
          color: var(--text-muted);
          margin: 0;
        }

        .admin-activity-time {
          font-size: 0.72rem;
          color: var(--text-muted);
          flex-shrink: 0;
          margin-top: 2px;
        }

        /* ---- Section heading within pages ---- */
        .admin-section-title {
          font-family: var(--font-display);
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        /* ---- Inline search ---- */
        .admin-search-inline {
          position: relative;
          flex: 1;
        }

        .admin-search-inline input {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: 0.85rem;
          padding: 9px 14px 9px 38px;
          width: 100%;
          outline: none;
          transition: var(--transition);
        }

        .admin-search-inline input::placeholder { color: var(--text-muted); }
        .admin-search-inline input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }

        .admin-search-inline svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
        }
      `}</style>

      <div style={{ fontFamily: 'var(--font-body)' }}>
        {/* ---- Sidebar ---- */}
        <aside className={`admin-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
          {/* Logo */}
          <div className="admin-sidebar-logo">
            <img src="/optimenu-logo-collapsed.png" alt="OptiMenu" />
            <span className={`admin-sidebar-logo-text ${collapsed ? 'hidden' : ''}`}>
              OptiMenu
            </span>
          </div>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className={`admin-collapse-btn ${collapsed ? 'collapsed' : ''}`}
            style={{ top: '36px' }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <IconChevronRight size={12} />
          </button>

          {/* Main Nav */}
          <nav className="admin-nav">
            <span className={`admin-nav-section-label ${collapsed ? 'hidden' : ''}`}>
              Navigation
            </span>

            {navigationData.main.map((item, index) => {
              const Icon = item.icon;
              return (
                <Link
                  key={index}
                  href={item.href}
                  className={`admin-nav-item ${item.active ? 'active' : ''}`}
                  title={collapsed ? item.title : ''}
                  style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                >
                  <Icon size={18} />
                  <span className={`admin-nav-item-label ${collapsed ? 'hidden' : ''}`}>
                    {item.title}
                  </span>
                </Link>
              );
            })}

            <span
              className={`admin-nav-section-label ${collapsed ? 'hidden' : ''}`}
              style={{ marginTop: '16px' }}
            >
              System
            </span>

            {navigationData.secondary.map((item, index) => {
              const Icon = item.icon;
              return (
                <Link
                  key={index}
                  href={item.href}
                  className={`admin-nav-item ${item.active ? 'active' : ''}`}
                  title={collapsed ? item.title : ''}
                  style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                >
                  <Icon size={18} />
                  <span className={`admin-nav-item-label ${collapsed ? 'hidden' : ''}`}>
                    {item.title}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* Bottom: User + Logout */}
          <div className="admin-sidebar-bottom">
            <button
              onClick={handleSignOut}
              className="admin-nav-item"
              title={collapsed ? 'Log Out' : ''}
              style={{ justifyContent: collapsed ? 'center' : 'flex-start', width: 'calc(100% - 16px)', margin: '0 8px 8px' }}
            >
              <IconLogout size={18} />
              <span className={`admin-nav-item-label ${collapsed ? 'hidden' : ''}`}>
                Log Out
              </span>
            </button>

            <div className="admin-sidebar-user">
              <div className="admin-sidebar-avatar">{getUserInitials()}</div>
              <div className={`admin-sidebar-user-info ${collapsed ? 'hidden' : ''}`}>
                <span className="admin-sidebar-user-name">
                  {userProfile?.full_name || 'Admin'}
                </span>
                <span className="admin-sidebar-user-role">Administrator</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileMenuOpen(o => !o)}
          className="lg:hidden"
          style={{
            position: 'fixed', top: 20, left: 20, zIndex: 50,
            width: 40, height: 40, borderRadius: 8,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
          }}
        >
          {mobileMenuOpen ? <IconX size={18} /> : <IconMenu2 size={18} />}
        </button>

        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              zIndex: 35, display: 'block'
            }}
          />
        )}

        {/* ---- Main Content Area ---- */}
        <div
          className="admin-main"
          style={{ marginLeft: collapsed ? '72px' : '220px' }}
        >
          {/* Header */}
          <header className="admin-header">
            <div className="admin-header-left">
              {PageIcon && (
                <div className="admin-header-icon">
                  <PageIcon size={18} />
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                {pageTitle && (
                  <h1 className="admin-page-title">{pageTitle}</h1>
                )}
                {pageDescription && (
                  <p className="admin-page-desc">{pageDescription}</p>
                )}
              </div>
            </div>

            <div className="admin-header-right">
              <div className="admin-search" style={{ display: 'none' /* hidden on mobile, shown md+ */ }}>
                <IconSearch size={14} className="admin-search-icon" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input placeholder="Search..." />
              </div>

              <div className="admin-sidebar-avatar" style={{ width: 34, height: 34, fontSize: '0.7rem' }}>
                {getUserInitials()}
              </div>
            </div>
          </header>

          {/* Page Content */}
          <main className="admin-content admin-fade-in">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}