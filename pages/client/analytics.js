// pages/client/analytics.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import { parseCSV, detectPOSSystem, buildColumnMapping, normalizeRows } from '../../lib/parsePOScsv';
import ProfileDropdown from '../../components/ProfileDropdown';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n) {
  if (!n) return '$0';
  return parseFloat(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrencyDetailed(n) {
  if (!n) return '$0.00';
  return parseFloat(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getUserInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

function getUrgencyColor(urgency) {
  if (urgency === 'high') return '#c04040';
  if (urgency === 'medium') return '#d4a020';
  return '#02a4ba';
}

function getTypeLabel(type) {
  if (type === 'inventory') return 'Move Stock';
  if (type === 'margin') return 'High Margin';
  return 'Trending';
}

function getMarginColor(m) {
  if (!m) return '#4a453e';
  if (m >= 60) return '#2a8a5a';
  if (m >= 40) return '#02a4ba';
  if (m >= 25) return '#d4a020';
  return '#c04040';
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; overflow: hidden; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
  input::placeholder, textarea::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  .an-root { font-family: 'Inter', sans-serif; background: #0a0908; color: #e8e2d8; width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

  /* NAV */
  .an-nav { background: #0f0e0c; border-bottom: 1px solid #2a2620; height: clamp(36px,4vh,52px); padding: 0 clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .an-logo { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); color: #e8e2d8; letter-spacing: -.3px; }
  .an-logo span { color: #02a4ba; }
  .an-tab { padding: clamp(2px,.3vh,4px) clamp(6px,.6vw,11px); border-radius: 4px; font-size: clamp(10px,.75vw,13px); color: #4a453e; border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .an-tab.active { color: #e8e2d8; background: #1a1915; }
  .an-avatar { width: clamp(22px,1.8vw,30px); height: clamp(22px,1.8vw,30px); border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: clamp(8px,.65vw,11px); font-weight: 700; color: #0a0908; flex-shrink: 0; }

  /* PAGE HEADER */
  .an-ph { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(8px,.8vh,14px) clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .an-ph-title { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,20px); color: #e8e2d8; }
  .an-ph-sub { font-size: clamp(9px,.65vw,11px); color: #4a453e; margin-top: 2px; }
  .an-ph-right { display: flex; align-items: center; gap: 10px; }

  /* STATUS BAR */
  .an-sbar { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,20px); display: flex; gap: clamp(16px,2vw,36px); align-items: center; flex-shrink: 0; }
  .an-sv { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); line-height: 1; }
  .an-sl { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 2px; text-transform: uppercase; letter-spacing: .5px; }
  .an-sync-badge { display: flex; align-items: center; gap: 5px; font-size: clamp(9px,.68vw,11px); color: #2a8a5a; background: rgba(42,138,90,.1); border: 1px solid rgba(42,138,90,.2); border-radius: 20px; padding: 3px 10px; margin-left: auto; }
  .an-sync-dot { width: 6px; height: 6px; border-radius: 50%; background: #2a8a5a; animation: blink 2s infinite; }

  /* BODY */
  .an-body { flex: 1; overflow-y: auto; padding: clamp(8px,.8vw,14px); display: flex; flex-direction: column; gap: clamp(8px,.8vw,14px); }
  .an-body::-webkit-scrollbar { width: 3px; }

  /* UPLOAD ZONE */
  .an-upload-zone { background: #13120f; border: 2px dashed #2a2620; border-radius: 10px; padding: clamp(24px,3vh,48px); text-align: center; cursor: pointer; transition: border-color .2s; }
  .an-upload-zone:hover, .an-upload-zone.drag { border-color: #02a4ba; }
  .an-upload-title { font-size: clamp(13px,1vw,16px); font-weight: 600; color: #e8e2d8; margin-bottom: 6px; }
  .an-upload-sub { font-size: clamp(10px,.75vw,13px); color: #4a453e; margin-bottom: 14px; }
  .an-upload-btn { background: #02a4ba; border: none; border-radius: 7px; padding: clamp(8px,.8vw,12px) clamp(16px,1.4vw,24px); font-size: clamp(11px,.85vw,14px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; }
  .an-pos-pills { display: flex; gap: 8px; justify-content: center; margin-top: 14px; flex-wrap: wrap; }
  .an-pos-pill { font-size: clamp(9px,.68vw,11px); padding: 3px 10px; border-radius: 10px; border: 1px solid #2a2620; color: #4a453e; cursor: pointer; transition: all .15s; background: none; font-family: 'Inter', sans-serif; }
  .an-pos-pill.active { border-color: #02a4ba; color: #02a4ba; background: rgba(2,164,186,.08); }

  /* COLUMN MAPPER */
  .an-mapper { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; padding: clamp(14px,1.4vw,22px); }
  .an-mapper-title { font-size: clamp(12px,.95vw,16px); font-weight: 600; color: #e8e2d8; margin-bottom: 4px; }
  .an-mapper-sub { font-size: clamp(10px,.75vw,13px); color: #4a453e; margin-bottom: 14px; }
  .an-mapper-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(8px,.8vw,12px); margin-bottom: 14px; }
  .an-mapper-field { display: flex; flex-direction: column; gap: 5px; }
  .an-mapper-lbl { font-size: clamp(9px,.68vw,11px); color: #6b6358; text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
  .an-mapper-lbl.required::after { content: ' *'; color: #c04040; }
  .an-mapper-select { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 6px; padding: clamp(6px,.6vw,10px) clamp(8px,.75vw,12px); font-size: clamp(11px,.85vw,14px); color: #e8e2d8; outline: none; font-family: 'Inter', sans-serif; width: 100%; cursor: pointer; }
  .an-mapper-select:focus { border-color: #02a4ba; }

  /* GRID LAYOUT */
  .an-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(8px,.8vw,14px); }
  .an-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: clamp(8px,.8vw,14px); }

  /* CARDS */
  .an-card { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; padding: clamp(12px,1.1vw,18px); display: flex; flex-direction: column; }
  .an-card-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: clamp(10px,1vh,16px); flex-shrink: 0; }
  .an-card-title { font-size: clamp(10px,.78vw,14px); font-weight: 600; color: #e8e2d8; display: flex; align-items: center; gap: 6px; }
  .an-card-title svg { width: clamp(11px,.88vw,15px); height: clamp(11px,.88vw,15px); stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .an-card-badge { font-size: clamp(8px,.62vw,10px); font-weight: 600; padding: 2px 8px; border-radius: 10px; }

  /* DISH RECOMMENDATION CARDS */
  .an-dish-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: clamp(8px,.8vw,14px); }
  .an-dish-card { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; padding: clamp(14px,1.2vw,20px); display: flex; flex-direction: column; gap: clamp(8px,.8vh,14px); position: relative; overflow: hidden; }
  .an-dish-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
  .an-dish-num { font-family: 'Playfair Display', serif; font-size: clamp(28px,2.8vw,44px); color: #1a1915; line-height: 1; position: absolute; top: 12px; right: 16px; }
  .an-dish-type-badge { display: inline-flex; align-items: center; gap: 5px; font-size: clamp(9px,.68vw,11px); font-weight: 600; padding: 3px 10px; border-radius: 10px; align-self: flex-start; text-transform: uppercase; letter-spacing: .5px; }
  .an-dish-name { font-family: 'Playfair Display', serif; font-size: clamp(15px,1.3vw,21px); color: #e8e2d8; line-height: 1.2; }
  .an-dish-reason { font-size: clamp(10px,.75vw,13px); color: #6b6358; line-height: 1.5; flex: 1; }
  .an-dish-meta { display: flex; gap: clamp(10px,1vw,18px); padding-top: clamp(8px,.8vh,12px); border-top: 1px solid #2a2620; }
  .an-dish-meta-item { display: flex; flex-direction: column; gap: 2px; }
  .an-dish-meta-lbl { font-size: clamp(8px,.6vw,10px); color: #4a453e; text-transform: uppercase; letter-spacing: .5px; }
  .an-dish-meta-val { font-size: clamp(11px,.88vw,15px); font-weight: 600; }
  .an-dish-loading { display: flex; align-items: center; justify-content: center; gap: 10px; padding: clamp(24px,3vh,40px); color: '#4a453e'; color: #4a453e; font-size: clamp(11px,.85vw,14px); }

  /* SALES TABLE */
  .an-table { width: 100%; border-collapse: collapse; }
  .an-th { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .7px; padding: clamp(5px,.5vh,8px) clamp(8px,.7vw,12px); border-bottom: 1px solid #2a2620; text-align: left; }
  .an-th.right { text-align: right; }
  .an-td { font-size: clamp(10px,.75vw,13px); color: #9a9086; padding: clamp(7px,.7vh,11px) clamp(8px,.7vw,12px); border-bottom: 1px solid #1a1915; }
  .an-td.primary { color: #e8e2d8; font-weight: 500; }
  .an-td.accent { color: #02a4ba; font-weight: 600; }
  .an-td.right { text-align: right; }
  .an-td.warning { color: #d4a020; }
  .an-td.danger { color: #c04040; }
  .an-tr:hover td { background: #1a1915; }

  /* BAR CHART */
  .an-bar-row { display: flex; align-items: center; gap: clamp(6px,.55vw,10px); margin-bottom: clamp(6px,.6vh,10px); }
  .an-bar-row:last-child { margin-bottom: 0; }
  .an-bar-label { font-size: clamp(9px,.68vw,12px); color: #9a9086; width: clamp(80px,8vw,130px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-bar-track { flex: 1; background: #1a1915; border-radius: 3px; height: clamp(4px,.4vh,7px); }
  .an-bar-fill { height: 100%; border-radius: 3px; transition: width .4s ease; }
  .an-bar-val { font-size: clamp(9px,.68vw,12px); font-weight: 600; width: clamp(36px,3.5vw,56px); text-align: right; flex-shrink: 0; }

  /* HEATMAP */
  .an-heatmap { display: grid; gap: 3px; }
  .an-heatmap-cell { border-radius: 3px; aspect-ratio: 1; transition: opacity .2s; cursor: default; }
  .an-heatmap-lbl { font-size: clamp(7px,.55vw,9px); color: #4a453e; text-align: center; }
  .an-heatmap-hour-lbl { font-size: clamp(7px,.55vw,9px); color: #4a453e; }

  /* RISK BADGE */
  .an-risk-high { background: rgba(192,64,64,.1); color: #c04040; border: 1px solid rgba(192,64,64,.2); font-size: clamp(8px,.62vw,10px); padding: 2px 7px; border-radius: 8px; white-space: nowrap; }
  .an-risk-med { background: rgba(212,160,32,.1); color: #d4a020; border: 1px solid rgba(212,160,32,.2); font-size: clamp(8px,.62vw,10px); padding: 2px 7px; border-radius: 8px; white-space: nowrap; }
  .an-risk-low { background: rgba(42,138,90,.1); color: #2a8a5a; border: 1px solid rgba(42,138,90,.2); font-size: clamp(8px,.62vw,10px); padding: 2px 7px; border-radius: 8px; white-space: nowrap; }

  /* BUTTONS */
  .an-btn-primary { background: #02a4ba; border: none; border-radius: 7px; padding: clamp(7px,.7vw,11px) clamp(14px,1.2vw,20px); font-size: clamp(11px,.85vw,14px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; transition: background .2s; white-space: nowrap; }
  .an-btn-primary:hover { background: #01bcd4; }
  .an-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
  .an-btn-ghost { background: none; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(7px,.7vw,11px) clamp(14px,1.2vw,20px); font-size: clamp(11px,.85vw,14px); color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; white-space: nowrap; }
  .an-btn-ghost:hover { color: #e8e2d8; border-color: #3a3630; }
  .an-empty { display: flex; align-items: center; justify-content: center; flex: 1; font-size: clamp(10px,.78vw,14px); color: #4a453e; padding: clamp(16px,2vh,32px) 0; }

  /* MOBILE */
  .mob-root { font-family: 'Inter', sans-serif; background: #0a0908; color: #e8e2d8; width: 100%; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
  .mob-header { background: #0f0e0c; border-bottom: 1px solid #2a2620; padding: 10px 16px; padding-top: env(safe-area-inset-top, 10px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .mob-logo { font-family: 'Playfair Display', serif; font-size: 20px; color: #e8e2d8; letter-spacing: -.3px; }
  .mob-logo span { color: #02a4ba; }
  .mob-avatar { width: 30px; height: 30px; border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #0a0908; }
  .mob-titlebar { background: #13120f; border-bottom: 1px solid #2a2620; padding: 10px 16px; flex-shrink: 0; }
  .mob-page-title { font-family: 'Playfair Display', serif; font-size: 20px; color: #e8e2d8; line-height: 1; }
  .mob-page-sub { font-size: 11px; color: #4a453e; margin-top: 3px; }
  .mob-content { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; }
  .mob-content::-webkit-scrollbar { display: none; }
  .mob-card { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; padding: 14px; flex-shrink: 0; }
  .mob-card-title { font-size: 11px; font-weight: 600; color: #e8e2d8; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
  .mob-card-title svg { width: 12px; height: 12px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mob-dish-card { background: #0f0e0c; border-radius: 8px; border-left: 3px solid #02a4ba; padding: 12px; margin-bottom: 10px; }
  .mob-dish-card:last-child { margin-bottom: 0; }
  .mob-dish-num { font-size: 10px; font-weight: 600; color: #4a453e; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .5px; }
  .mob-dish-name { font-family: 'Playfair Display', serif; font-size: 16px; color: #e8e2d8; margin-bottom: 6px; }
  .mob-dish-reason { font-size: 12px; color: #6b6358; line-height: 1.45; margin-bottom: 8px; }
  .mob-dish-meta { display: flex; gap: 12px; }
  .mob-dish-meta-item { display: flex; flex-direction: column; gap: 2px; }
  .mob-dish-meta-lbl { font-size: 9px; color: #4a453e; text-transform: uppercase; letter-spacing: .5px; }
  .mob-dish-meta-val { font-size: 13px; font-weight: 600; }
  .mob-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .mob-bar-row:last-child { margin-bottom: 0; }
  .mob-bar-label { font-size: 12px; color: #9a9086; width: 110px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mob-bar-track { flex: 1; background: #1a1915; border-radius: 3px; height: 5px; }
  .mob-bar-fill { height: 5px; border-radius: 3px; }
  .mob-bar-val { font-size: 12px; font-weight: 600; color: #02a4ba; width: 44px; text-align: right; flex-shrink: 0; }
  .mob-upload-zone { border: 2px dashed #2a2620; border-radius: 10px; padding: 28px 16px; text-align: center; }
  .mob-upload-title { font-size: 14px; font-weight: 600; color: #e8e2d8; margin-bottom: 6px; }
  .mob-upload-sub { font-size: 12px; color: #4a453e; margin-bottom: 14px; }
  .mob-upload-btn { background: #02a4ba; border: none; border-radius: 7px; padding: 10px 20px; font-size: 13px; font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; }
  .mob-bottom-nav { background: #0f0e0c; border-top: 1px solid #2a2620; padding: 8px 0; padding-bottom: max(8px, env(safe-area-inset-bottom)); display: flex; flex-shrink: 0; }
  .mob-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; padding: 4px 0; -webkit-tap-highlight-color: transparent; }
  .mob-nav-icon svg { width: 18px; height: 18px; stroke: #4a453e; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mob-nav-icon.active svg { stroke: #02a4ba; }
  .mob-nav-label { font-size: 9px; color: #4a453e; }
  .mob-nav-label.active { color: #02a4ba; }
  .mob-nav-dot { width: 4px; height: 4px; border-radius: 50%; background: #02a4ba; }
  .mob-section-tab { flex: 1; padding: 8px 0; font-size: 11px; font-weight: 500; color: #4a453e; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .mob-section-tab.active { color: #02a4ba; border-bottom-color: #02a4ba; }
`;

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/client/dashboard' },
  { label: 'Invoices', path: '/client/invoices' },
  { label: 'Ingredients', path: '/client/ingredients' },
  { label: 'Menu', path: '/client/menu-items' },
  { label: 'Analytics', path: '/client/analytics' },
];

function NavIcon({ path }) {
  if (path === '/client/dashboard') return <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
  if (path === '/client/invoices') return <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  if (path === '/client/ingredients') return <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>;
  if (path === '/client/menu-items') return <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
  return <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter();
  const { isMobile } = useWindowSize();
  const fileInputRef = useRef(null);

  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);

  // Upload state
  const [dragOver, setDragOver] = useState(false);
  const [selectedPOS, setSelectedPOS] = useState('other');
  const [uploadStep, setUploadStep] = useState('idle'); // idle | mapping | uploading | done
  const [csvRows, setCsvRows] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('');

  // Data state
  const [hasSalesData, setHasSalesData] = useState(false);
  const [salesStats, setSalesStats] = useState({ totalDays: 0, totalItems: 0, totalRevenue: 0, lastSync: null });
  const [topSellers, setTopSellers] = useState([]);
  const [slowMovers, setSlowMovers] = useState([]);
  const [dayOfWeekData, setDayOfWeekData] = useState([]);
  const [hourlyData, setHourlyData] = useState([]);
  const [inventoryRisk, setInventoryRisk] = useState([]);
  const [dishRecs, setDishRecs] = useState([]);
  const [dishLoading, setDishLoading] = useState(false);
  const [voidsComps, setVoidsComps] = useState([]);

  // Mobile section tab
  const [mobileSection, setMobileSection] = useState('recs');

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    setUserEmail(user.email || '');
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) { setLoading(false); return; }
    setRestaurantId(profile.restaurant_id);
    setUserName(profile.full_name ? profile.full_name.split(' ')[0] : 'User');
    await loadSalesData(profile.restaurant_id);
    setLoading(false);
  }

  async function loadSalesData(restId) {
    const { data: sales, error } = await supabase
      .from('pos_sales')
      .select('*')
      .eq('restaurant_id', restId)
      .order('sale_date', { ascending: false });

    if (error || !sales?.length) { setHasSalesData(false); return; }
    setHasSalesData(true);
    processSalesData(sales, restId);
  }

  async function processSalesData(sales, restId) {
    // Stats
    const dates = [...new Set(sales.map(s => s.sale_date))];
    const totalRevenue = sales.reduce((t, s) => t + parseFloat(s.revenue || 0), 0);
    const lastSync = dates[0];
    setSalesStats({ totalDays: dates.length, totalItems: sales.length, totalRevenue, lastSync });

    // Top sellers by quantity
    const itemMap = {};
    for (const s of sales) {
      if (!itemMap[s.item_name]) itemMap[s.item_name] = { name: s.item_name, qty: 0, rev: 0, category: s.category };
      itemMap[s.item_name].qty += parseFloat(s.quantity_sold || 0);
      itemMap[s.item_name].rev += parseFloat(s.revenue || 0);
    }
    const items = Object.values(itemMap).sort((a, b) => b.qty - a.qty);
    setTopSellers(items.slice(0, 10));

    // Slow movers — sold less than 3x in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSales = sales.filter(s => new Date(s.sale_date) >= sevenDaysAgo);
    const recentMap = {};
    for (const s of recentSales) {
      recentMap[s.item_name] = (recentMap[s.item_name] || 0) + parseFloat(s.quantity_sold || 0);
    }
    const slow = items.filter(i => (recentMap[i.name] || 0) < 3).slice(0, 8).map(i => ({
      ...i, recentQty: recentMap[i.name] || 0
    }));
    setSlowMovers(slow);

    // Voids & comps
    const voidsMap = {};
    for (const s of sales) {
      if (!voidsMap[s.item_name]) voidsMap[s.item_name] = { name: s.item_name, voids: 0, comps: 0 };
      voidsMap[s.item_name].voids += parseInt(s.voids || 0);
      voidsMap[s.item_name].comps += parseFloat(s.comps || 0);
    }
    const vc = Object.values(voidsMap).filter(i => i.voids > 0 || i.comps > 0).sort((a, b) => b.voids - a.voids).slice(0, 8);
    setVoidsComps(vc);

    // Day of week
    const dayMap = {};
    for (const day of DAYS) dayMap[day] = { day, qty: 0, rev: 0 };
    for (const s of sales) {
      if (s.day_of_week && dayMap[s.day_of_week]) {
        dayMap[s.day_of_week].qty += parseFloat(s.quantity_sold || 0);
        dayMap[s.day_of_week].rev += parseFloat(s.revenue || 0);
      }
    }
    setDayOfWeekData(DAYS.map(d => dayMap[d]));

    // Hourly
    const hourMap = {};
    for (const h of HOURS) hourMap[h] = 0;
    for (const s of sales) {
      if (s.hour_of_day !== null && s.hour_of_day !== undefined) {
        hourMap[s.hour_of_day] = (hourMap[s.hour_of_day] || 0) + parseFloat(s.quantity_sold || 0);
      }
    }
    setHourlyData(HOURS.map(h => ({ hour: h, qty: hourMap[h] || 0 })));

    // Inventory risk — cross-reference ingredients with slow movers
    const { data: ingredients } = await supabase
      .from('ingredients')
      .select('name, last_ordered_at, unit, last_price')
      .eq('restaurant_id', restId)
      .not('last_ordered_at', 'is', null);

    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    const recentIngredients = (ingredients || []).filter(i => i.last_ordered_at >= sevenDaysAgoStr);

    const risk = recentIngredients.map(ing => {
      const ingLower = ing.name.toLowerCase();
      const matchedItem = slow.find(s => s.name.toLowerCase().includes(ingLower) || ingLower.includes(s.name.toLowerCase().split(' ')[0]));
      const riskLevel = matchedItem ? (matchedItem.recentQty === 0 ? 'high' : 'medium') : 'low';
      return { ingredient: ing.name, unit: ing.unit, lastOrdered: ing.last_ordered_at, riskLevel, linkedDish: matchedItem?.name || null };
    }).filter(r => r.riskLevel !== 'low').sort((a, b) => (a.riskLevel === 'high' ? -1 : 1));

    setInventoryRisk(risk.slice(0, 10));

    // Fetch dish recommendations
    fetchDishRecs(restId);
  }

  async function fetchDishRecs(restId) {
    setDishLoading(true);
    try {
      const res = await fetch('/api/dish-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: restId }),
      });
      const json = await res.json();
      setDishRecs(json.recommendations || []);
    } catch (err) {
      console.error('Dish recs error:', err);
    } finally {
      setDishLoading(false);
    }
  }

  // ── CSV Upload ──────────────────────────────────────────────────────────────

  function handleFileSelect(files) {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rows = parseCSV(text);
        const headers = Object.keys(rows[0] || {});
        const detectedPOS = detectPOSSystem(headers);
        const mapping = buildColumnMapping(headers, selectedPOS !== 'other' ? selectedPOS : detectedPOS);
        setCsvRows(rows);
        setCsvHeaders(headers);
        setColumnMapping(mapping);
        if (detectedPOS !== 'other') setSelectedPOS(detectedPOS);
        setUploadStep('mapping');
      } catch (err) {
        setUploadMsg('Failed to parse CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  async function handleUploadConfirm() {
    if (!restaurantId) return;
    setUploadStep('uploading');
    setUploadProgress(0);

    try {
      const normalized = normalizeRows(csvRows, columnMapping, restaurantId, selectedPOS);
      if (!normalized.length) throw new Error('No valid rows found after mapping. Check your column selections.');

      // Delete existing data for the date range being uploaded
      const dates = [...new Set(normalized.map(r => r.sale_date))];
      const minDate = dates.sort()[0];
      const maxDate = dates.sort().pop();

      await supabase.from('pos_sales').delete()
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', minDate)
        .lte('sale_date', maxDate);

      // Batch insert in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < normalized.length; i += CHUNK) {
        const chunk = normalized.slice(i, i + CHUNK);
        const { error } = await supabase.from('pos_sales').insert(chunk);
        if (error) throw error;
        setUploadProgress(Math.round(((i + CHUNK) / normalized.length) * 100));
      }

      setUploadProgress(100);
      setUploadMsg(`✓ Successfully imported ${normalized.length} records across ${dates.length} days.`);
      setUploadStep('done');
      setHasSalesData(true);
      await loadSalesData(restaurantId);
    } catch (err) {
      setUploadMsg('Upload failed: ' + err.message);
      setUploadStep('mapping');
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const maxTopQty = topSellers[0]?.qty || 1;
  const maxDayQty = Math.max(...dayOfWeekData.map(d => d.qty), 1);
  const maxHourQty = Math.max(...hourlyData.map(h => h.qty), 1);

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────

  if (isMobile) {
    return (
      <>
        <style>{CSS}</style>
        <div className="mob-root">
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
          </div>

          <div className="mob-titlebar">
            <div className="mob-page-title">Analytics</div>
            <div className="mob-page-sub">POS Sales Intelligence</div>
          </div>

          {/* Section tabs */}
          <div style={{ background: '#13120f', borderBottom: '1px solid #2a2620', display: 'flex', flexShrink: 0 }}>
            {[
              { id: 'recs', label: 'Dish Picks' },
              { id: 'sales', label: 'Sales' },
              { id: 'inventory', label: 'Inventory' },
              { id: 'upload', label: 'Upload' },
            ].map(t => (
              <button key={t.id} className={`mob-section-tab${mobileSection === t.id ? ' active' : ''}`} onClick={() => setMobileSection(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="mob-content">
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, flexDirection: 'column', gap: 10 }}>
                <div style={{ width: 22, height: 22, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                <div style={{ fontSize: 12, color: '#4a453e' }}>Loading analytics...</div>
              </div>
            ) : (
              <>
                {/* DISH RECS */}
                {mobileSection === 'recs' && (
                  <div className="mob-card">
                    <div className="mob-card-title">
                      <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      Today's Dish Picks
                    </div>
                    {dishLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4a453e', fontSize: 12, padding: '8px 0' }}>
                        <div style={{ width: 16, height: 16, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                        Generating recommendations...
                      </div>
                    ) : !hasSalesData ? (
                      <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '16px 0' }}>Upload POS data to get dish recommendations</div>
                    ) : dishRecs.length > 0 ? dishRecs.map((rec, i) => (
                      <div key={i} className="mob-dish-card" style={{ borderLeftColor: getUrgencyColor(rec.urgency) }}>
                        <div className="mob-dish-num">#{i + 1} Push Today</div>
                        <div className="mob-dish-name">{rec.dish}</div>
                        <div className="mob-dish-reason">{rec.reason}</div>
                        <div className="mob-dish-meta">
                          <div className="mob-dish-meta-item">
                            <div className="mob-dish-meta-lbl">Type</div>
                            <div className="mob-dish-meta-val" style={{ color: getUrgencyColor(rec.urgency), fontSize: 12 }}>{getTypeLabel(rec.type)}</div>
                          </div>
                          {rec.margin && (
                            <div className="mob-dish-meta-item">
                              <div className="mob-dish-meta-lbl">Margin</div>
                              <div className="mob-dish-meta-val" style={{ color: getMarginColor(rec.margin), fontSize: 12 }}>{rec.margin.toFixed(1)}%</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )) : (
                      <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '16px 0' }}>No recommendations yet</div>
                    )}
                  </div>
                )}

                {/* SALES */}
                {mobileSection === 'sales' && (
                  <>
                    {!hasSalesData ? (
                      <div style={{ fontSize: 13, color: '#6b6358', textAlign: 'center', padding: 32 }}>Upload POS data to see sales analytics</div>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          {[
                            { l: 'Days of Data', v: salesStats.totalDays, c: '#02a4ba' },
                            { l: 'Total Revenue', v: formatCurrency(salesStats.totalRevenue), c: '#2a8a5a' },
                          ].map(({ l, v, c }) => (
                            <div key={l} style={{ background: '#13120f', border: '1px solid #2a2620', borderRadius: 8, padding: 12 }}>
                              <div style={{ fontSize: 9, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{l}</div>
                              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: c }}>{v}</div>
                            </div>
                          ))}
                        </div>

                        <div className="mob-card">
                          <div className="mob-card-title">Top Sellers</div>
                          {topSellers.slice(0, 8).map(item => (
                            <div key={item.name} className="mob-bar-row">
                              <div className="mob-bar-label">{item.name}</div>
                              <div className="mob-bar-track"><div className="mob-bar-fill" style={{ width: `${(item.qty / maxTopQty) * 100}%`, background: '#02a4ba' }} /></div>
                              <div className="mob-bar-val">{Math.round(item.qty)}</div>
                            </div>
                          ))}
                        </div>

                        <div className="mob-card">
                          <div className="mob-card-title">Sales by Day</div>
                          {dayOfWeekData.map(d => (
                            <div key={d.day} className="mob-bar-row">
                              <div className="mob-bar-label">{d.day.slice(0, 3)}</div>
                              <div className="mob-bar-track"><div className="mob-bar-fill" style={{ width: `${(d.qty / maxDayQty) * 100}%`, background: '#d4a020' }} /></div>
                              <div className="mob-bar-val" style={{ color: '#d4a020' }}>{Math.round(d.qty)}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* INVENTORY */}
                {mobileSection === 'inventory' && (
                  <div className="mob-card">
                    <div className="mob-card-title">Inventory Risk</div>
                    {!hasSalesData ? (
                      <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '16px 0' }}>Upload POS data to see inventory risk</div>
                    ) : inventoryRisk.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '16px 0' }}>No at-risk ingredients identified</div>
                    ) : inventoryRisk.map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1a1915' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#e8e2d8' }}>{r.ingredient}</div>
                          {r.linkedDish && <div style={{ fontSize: 10, color: '#4a453e', marginTop: 2 }}>Used in: {r.linkedDish}</div>}
                        </div>
                        <span className={r.riskLevel === 'high' ? 'an-risk-high' : 'an-risk-med'}>
                          {r.riskLevel === 'high' ? 'High Risk' : 'Medium Risk'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* UPLOAD */}
                {mobileSection === 'upload' && (
                  <div className="mob-card">
                    <div className="mob-card-title">Upload POS Data</div>
                    {uploadStep === 'idle' && (
                      <>
                        <div className="mob-upload-zone" onClick={() => fileInputRef.current?.click()}>
                          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFileSelect(e.target.files)} />
                          <div className="mob-upload-title">Upload Sales CSV</div>
                          <div className="mob-upload-sub">Export from your POS and upload here</div>
                          <button className="mob-upload-btn">Choose File</button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                          {['toast', 'square', 'clover', 'lightspeed', 'other'].map(p => (
                            <button key={p} className={`an-pos-pill${selectedPOS === p ? ' active' : ''}`} onClick={() => setSelectedPOS(p)}>
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {uploadStep === 'mapping' && renderMobileMapper()}
                    {uploadStep === 'uploading' && (
                      <div style={{ textAlign: 'center', padding: '24px 0' }}>
                        <div style={{ width: 24, height: 24, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite', margin: '0 auto 12px' }} />
                        <div style={{ fontSize: 13, color: '#e8e2d8' }}>Uploading... {uploadProgress}%</div>
                      </div>
                    )}
                    {uploadStep === 'done' && (
                      <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <div style={{ fontSize: 13, color: '#2a8a5a', marginBottom: 12 }}>{uploadMsg}</div>
                        <button className="mob-upload-btn" onClick={() => setUploadStep('idle')}>Upload More</button>
                      </div>
                    )}
                    {uploadMsg && uploadStep === 'mapping' && <div style={{ fontSize: 12, color: '#c04040', marginTop: 8 }}>{uploadMsg}</div>}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mob-bottom-nav">
            {NAV_ITEMS.map(({ label, path }) => {
              const active = path === '/client/analytics';
              return (
                <div key={label} className="mob-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob-nav-icon${active ? ' active' : ''}`}><NavIcon path={path} /></div>
                  <div className={`mob-nav-label${active ? ' active' : ''}`}>{label}</div>
                  {active && <div className="mob-nav-dot" />}
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  function renderMobileMapper() {
    const fields = ['item_name', 'sale_date', 'quantity_sold', 'revenue', 'category', 'unit_price', 'hour_of_day', 'voids', 'comps'];
    const required = ['item_name', 'sale_date', 'quantity_sold', 'revenue'];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: '#4a453e', marginBottom: 4 }}>Match your CSV columns to the right fields. Required fields are marked *</div>
        {fields.map(field => (
          <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 10, color: '#6b6358', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600 }}>
              {field.replace(/_/g, ' ')}{required.includes(field) ? ' *' : ''}
            </div>
            <select className="an-mapper-select" value={columnMapping[field] || ''} onChange={e => setColumnMapping(prev => ({ ...prev, [field]: e.target.value || null }))}>
              <option value="">— not mapped —</option>
              {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="an-btn-primary" style={{ flex: 1 }} onClick={handleUploadConfirm}>Import {csvRows.length} rows</button>
          <button className="an-btn-ghost" onClick={() => setUploadStep('idle')}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>
      <div className="an-root">

        {/* NAV */}
        <div className="an-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div className="an-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t} className={`an-tab${t === 'Analytics' ? ' active' : ''}`}
                  onClick={() => {
                    const paths = { Dashboard: '/client/dashboard', Invoices: '/client/invoices', Ingredients: '/client/ingredients', 'Menu Items': '/client/menu-items', Analytics: '/client/analytics' };
                    router.push(paths[t]);
                  }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'clamp(9px,.65vw,12px)', color: '#02a4ba' }}>
              <div style={{ width: 'clamp(4px,.35vw,6px)', height: 'clamp(4px,.35vw,6px)', background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
              Active
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false} />
          </div>
        </div>

        {/* PAGE HEADER */}
        <div className="an-ph">
          <div>
            <div className="an-ph-title">Sales Analytics</div>
            <div className="an-ph-sub">POS intelligence · inventory risk · daily dish recommendations</div>
          </div>
          <div className="an-ph-right">
            {hasSalesData && (
              <div className="an-sync-badge">
                <div className="an-sync-dot" />
                Last sync: {salesStats.lastSync}
              </div>
            )}
            <button className="an-btn-primary" onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFileSelect(e.target.files)} />
              ↑ Upload CSV
            </button>
          </div>
        </div>

        {/* STATS BAR */}
        {hasSalesData && (
          <div className="an-sbar">
            {[
              { v: salesStats.totalDays, l: 'Days of Data', c: '#02a4ba' },
              { v: topSellers.length, l: 'Menu Items Tracked', c: '#e8e2d8' },
              { v: formatCurrency(salesStats.totalRevenue), l: 'Total Revenue', c: '#2a8a5a' },
              { v: topSellers[0]?.name || '—', l: 'Top Seller', c: '#d4a020' },
              { v: slowMovers.length, l: 'Slow Movers', c: '#c04040' },
            ].map(({ v, l, c }) => (
              <div key={l}>
                <div className="an-sv" style={{ color: c }}>{v}</div>
                <div className="an-sl">{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* BODY */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 24, height: 24, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 'clamp(11px,.85vw,14px)', color: '#4a453e' }}>Loading analytics...</div>
          </div>
        ) : (
          <div className="an-body">

            {/* ── UPLOAD / MAPPER ── */}
            {uploadStep === 'idle' && !hasSalesData && (
              <div className="an-upload-zone"
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                style={{ borderColor: dragOver ? '#02a4ba' : undefined }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2a2620" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <div className="an-upload-title">Upload your POS sales export</div>
                <div className="an-upload-sub">Drag & drop a CSV file here, or click to browse. Supports Toast, Square, Clover, Lightspeed, and any standard CSV export.</div>
                <button className="an-upload-btn" onClick={e => e.stopPropagation()}>Browse Files</button>
                <div className="an-pos-pills">
                  {['toast', 'square', 'clover', 'lightspeed', 'other'].map(p => (
                    <button key={p} className={`an-pos-pill${selectedPOS === p ? ' active' : ''}`}
                      onClick={e => { e.stopPropagation(); setSelectedPOS(p); }}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {uploadStep === 'mapping' && (
              <div className="an-mapper">
                <div className="an-mapper-title">Map your columns</div>
                <div className="an-mapper-sub">{csvRows.length} rows detected. Match each field to the right column in your CSV. Required fields are marked *</div>
                <div className="an-mapper-grid">
                  {['item_name', 'sale_date', 'quantity_sold', 'revenue', 'category', 'unit_price', 'hour_of_day', 'voids', 'comps'].map(field => {
                    const required = ['item_name', 'sale_date', 'quantity_sold', 'revenue'].includes(field);
                    return (
                      <div key={field} className="an-mapper-field">
                        <div className={`an-mapper-lbl${required ? ' required' : ''}`}>{field.replace(/_/g, ' ')}</div>
                        <select className="an-mapper-select" value={columnMapping[field] || ''}
                          onChange={e => setColumnMapping(prev => ({ ...prev, [field]: e.target.value || null }))}>
                          <option value="">— not in CSV —</option>
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
                {uploadMsg && <div style={{ fontSize: 'clamp(10px,.75vw,13px)', color: '#c04040', marginBottom: 10 }}>{uploadMsg}</div>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="an-btn-primary" onClick={handleUploadConfirm}>Import {csvRows.length} rows</button>
                  <button className="an-btn-ghost" onClick={() => { setUploadStep('idle'); setUploadMsg(''); }}>Cancel</button>
                </div>
              </div>
            )}

            {uploadStep === 'uploading' && (
              <div className="an-card" style={{ alignItems: 'center', padding: '32px 20px' }}>
                <div style={{ width: 28, height: 28, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite', marginBottom: 12 }} />
                <div style={{ fontSize: 'clamp(12px,.95vw,16px)', color: '#e8e2d8', fontWeight: 600 }}>Importing sales data...</div>
                <div style={{ fontSize: 'clamp(10px,.75vw,13px)', color: '#4a453e', marginTop: 6 }}>{uploadProgress}% complete</div>
                <div style={{ width: '100%', maxWidth: 300, background: '#1a1915', borderRadius: 4, height: 4, marginTop: 14 }}>
                  <div style={{ height: 4, borderRadius: 4, background: '#02a4ba', width: `${uploadProgress}%`, transition: 'width .3s' }} />
                </div>
              </div>
            )}

            {uploadStep === 'done' && (
              <div style={{ background: 'rgba(42,138,90,.08)', border: '1px solid rgba(42,138,90,.2)', borderRadius: 10, padding: 'clamp(12px,1.2vw,18px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 'clamp(12px,.95vw,15px)', color: '#2a8a5a', fontWeight: 500 }}>{uploadMsg}</div>
                <button className="an-btn-ghost" style={{ fontSize: 'clamp(10px,.75vw,13px)' }} onClick={() => { setUploadStep('idle'); setUploadMsg(''); }}>Upload More</button>
              </div>
            )}

            {/* ── DAILY DISH RECOMMENDATIONS ── */}
            <div className="an-card">
              <div className="an-card-hd">
                <div className="an-card-title">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  Today's Dish Recommendations
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {dishLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'clamp(9px,.68vw,11px)', color: '#4a453e' }}>
                      <div style={{ width: 10, height: 10, border: '1.5px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                      Analyzing...
                    </div>
                  )}
                  <button className="an-btn-ghost" style={{ fontSize: 'clamp(9px,.68vw,11px)', padding: '4px 10px' }} onClick={() => fetchDishRecs(restaurantId)}>↻ Refresh</button>
                </div>
              </div>

              {!hasSalesData ? (
                <div className="an-empty">Upload POS data to generate dish recommendations</div>
              ) : dishLoading ? (
                <div className="an-dish-loading">
                  <div style={{ width: 18, height: 18, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                  Analyzing sales data and inventory...
                </div>
              ) : dishRecs.length > 0 ? (
                <div className="an-dish-cards">
                  {dishRecs.map((rec, i) => {
                    const color = getUrgencyColor(rec.urgency);
                    return (
                      <div key={i} className="an-dish-card" style={{ '--card-color': color }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '10px 10px 0 0' }} />
                        <div className="an-dish-num">#{i + 1}</div>
                        <div className="an-dish-type-badge" style={{ background: `${color}18`, color }}>
                          {getTypeLabel(rec.type)}
                        </div>
                        <div className="an-dish-name">{rec.dish}</div>
                        <div className="an-dish-reason">{rec.reason}</div>
                        <div className="an-dish-meta">
                          <div className="an-dish-meta-item">
                            <div className="an-dish-meta-lbl">Urgency</div>
                            <div className="an-dish-meta-val" style={{ color, fontSize: 'clamp(11px,.88vw,14px)' }}>{rec.urgency.charAt(0).toUpperCase() + rec.urgency.slice(1)}</div>
                          </div>
                          {rec.margin && (
                            <div className="an-dish-meta-item">
                              <div className="an-dish-meta-lbl">Margin</div>
                              <div className="an-dish-meta-val" style={{ color: getMarginColor(rec.margin), fontSize: 'clamp(11px,.88vw,14px)' }}>{rec.margin.toFixed(1)}%</div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="an-empty">No recommendations generated yet</div>
              )}
            </div>

            {hasSalesData && (
              <>
                {/* ── TOP SELLERS + SLOW MOVERS ── */}
                <div className="an-grid-2">
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title">
                        <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                        Top Sellers
                      </div>
                      <div className="an-card-badge" style={{ background: 'rgba(42,138,90,.1)', color: '#2a8a5a' }}>by quantity</div>
                    </div>
                    {topSellers.map(item => (
                      <div key={item.name} className="an-bar-row">
                        <div className="an-bar-label">{item.name}</div>
                        <div className="an-bar-track"><div className="an-bar-fill" style={{ width: `${(item.qty / maxTopQty) * 100}%`, background: '#02a4ba' }} /></div>
                        <div className="an-bar-val" style={{ color: '#02a4ba' }}>{Math.round(item.qty)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title">
                        <svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
                        Slow Movers
                      </div>
                      <div className="an-card-badge" style={{ background: 'rgba(192,64,64,.1)', color: '#c04040' }}>&lt;3 sold this week</div>
                    </div>
                    {slowMovers.length === 0 ? (
                      <div className="an-empty">All items selling well</div>
                    ) : (
                      <table className="an-table">
                        <thead>
                          <tr>
                            <th className="an-th">Item</th>
                            <th className="an-th right">14d Total</th>
                            <th className="an-th right">Last 7d</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slowMovers.map(item => (
                            <tr key={item.name} className="an-tr">
                              <td className="an-td primary">{item.name}</td>
                              <td className="an-td right">{Math.round(item.qty)}</td>
                              <td className="an-td right danger">{Math.round(item.recentQty)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* ── DAY OF WEEK + HOURLY ── */}
                <div className="an-grid-2">
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title">
                        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        Sales by Day of Week
                      </div>
                    </div>
                    {dayOfWeekData.map(d => (
                      <div key={d.day} className="an-bar-row">
                        <div className="an-bar-label">{d.day}</div>
                        <div className="an-bar-track"><div className="an-bar-fill" style={{ width: `${(d.qty / maxDayQty) * 100}%`, background: '#d4a020' }} /></div>
                        <div className="an-bar-val" style={{ color: '#d4a020' }}>{Math.round(d.qty)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title">
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        Hourly Sales Heatmap
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {hourlyData.map(h => {
                          const intensity = maxHourQty > 0 ? h.qty / maxHourQty : 0;
                          const bg = intensity > 0.7 ? '#c04040' : intensity > 0.4 ? '#d4a020' : intensity > 0.1 ? '#02a4ba' : '#1a1915';
                          return (
                            <div key={h.hour} title={`${h.hour}:00 — ${Math.round(h.qty)} items`}
                              style={{ width: 24, height: 24, borderRadius: 4, background: bg, opacity: intensity > 0 ? 0.3 + intensity * 0.7 : 0.3, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: 7, color: intensity > 0.4 ? '#0a0908' : '#4a453e' }}>{h.hour}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                        {[{ c: '#c04040', l: 'Peak' }, { c: '#d4a020', l: 'Busy' }, { c: '#02a4ba', l: 'Steady' }, { c: '#1a1915', l: 'Quiet' }].map(({ c, l }) => (
                          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'clamp(8px,.62vw,10px)', color: '#4a453e' }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── INVENTORY RISK + VOIDS & COMPS ── */}
                <div className="an-grid-2">
                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title">
                        <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        Inventory Risk
                      </div>
                      <div className="an-card-badge" style={{ background: 'rgba(192,64,64,.1)', color: '#c04040' }}>recently ordered · slow selling</div>
                    </div>
                    {inventoryRisk.length === 0 ? (
                      <div className="an-empty">No at-risk ingredients identified</div>
                    ) : (
                      <table className="an-table">
                        <thead>
                          <tr>
                            <th className="an-th">Ingredient</th>
                            <th className="an-th">Used In</th>
                            <th className="an-th">Last Ordered</th>
                            <th className="an-th right">Risk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventoryRisk.map((r, i) => (
                            <tr key={i} className="an-tr">
                              <td className="an-td primary">{r.ingredient}</td>
                              <td className="an-td">{r.linkedDish || <span style={{ color: '#4a453e' }}>—</span>}</td>
                              <td className="an-td">{r.lastOrdered}</td>
                              <td className="an-td right"><span className={r.riskLevel === 'high' ? 'an-risk-high' : 'an-risk-med'}>{r.riskLevel === 'high' ? 'High' : 'Medium'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="an-card">
                    <div className="an-card-hd">
                      <div className="an-card-title">
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                        Voids & Comps
                      </div>
                    </div>
                    {voidsComps.length === 0 ? (
                      <div className="an-empty">No void or comp data in this export</div>
                    ) : (
                      <table className="an-table">
                        <thead>
                          <tr>
                            <th className="an-th">Item</th>
                            <th className="an-th right">Voids</th>
                            <th className="an-th right">Comps</th>
                          </tr>
                        </thead>
                        <tbody>
                          {voidsComps.map(item => (
                            <tr key={item.name} className="an-tr">
                              <td className="an-td primary">{item.name}</td>
                              <td className="an-td right warning">{item.voids}</td>
                              <td className="an-td right warning">{formatCurrency(item.comps)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* ── REVENUE BY ITEM ── */}
                <div className="an-card">
                  <div className="an-card-hd">
                    <div className="an-card-title">
                      <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                      Revenue by Menu Item
                    </div>
                  </div>
                  <table className="an-table">
                    <thead>
                      <tr>
                        <th className="an-th">#</th>
                        <th className="an-th">Item</th>
                        <th className="an-th">Category</th>
                        <th className="an-th right">Qty Sold</th>
                        <th className="an-th right">Revenue</th>
                        <th className="an-th right">Avg Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...topSellers].sort((a, b) => b.rev - a.rev).slice(0, 12).map((item, i) => (
                        <tr key={item.name} className="an-tr">
                          <td className="an-td" style={{ color: '#4a453e' }}>{i + 1}</td>
                          <td className="an-td primary">{item.name}</td>
                          <td className="an-td">{item.category || <span style={{ color: '#4a453e' }}>—</span>}</td>
                          <td className="an-td right">{Math.round(item.qty)}</td>
                          <td className="an-td right accent">{formatCurrency(item.rev)}</td>
                          <td className="an-td right">{item.qty > 0 ? formatCurrencyDetailed(item.rev / item.qty) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}