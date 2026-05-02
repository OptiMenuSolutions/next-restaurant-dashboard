// pages/client/invoices.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useWindowSize } from '../../lib/useWindowSize';
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';
import TourOverlay from '../../components/TourOverlay';
import { fetchSampleData } from '../../lib/seedSampleData';
import TourDataBanner from '../../components/TourDataBanner';
import UniversalSearch from '../../components/UniversalSearch';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '--';
  const n = parseFloat(amount);
  if (isNaN(n)) return '--';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyWhole(amount) {
  if (amount === null || amount === undefined || amount === '') return '--';
  const n = parseFloat(amount);
  if (isNaN(n)) return '--';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrencyShort(amount) {
  if (!amount) return '$0';
  const n = parseFloat(amount);
  if (isNaN(n)) return '$0';
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d) {
  if (!d) return 'Not provided';
  try {
    const [year, month, day] = d.split('T')[0].split('-');
    return new Date(+year, +month - 1, +day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return 'Invalid date'; }
}

function formatDateShort(d) {
  if (!d) return '—';
  try {
    const [year, month, day] = d.split('T')[0].split('-');
    return new Date(+year, +month - 1, +day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function timeAgo(d) {
  if (!d) return '';
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}

function getStatus(invoice) {
  return invoice.number && invoice.date && invoice.supplier && invoice.amount
    ? { label: 'Processed', ok: true }
    : { label: 'Pending', ok: false };
}

function calculateItemTotal(item) {
  return (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
}

function getBarColor(total) {
  if (total > 5000) return 'var(--color-red)';
  if (total > 2000) return 'var(--color-amber)';
  if (total > 0) return 'var(--accent)';
  return '#1e1c18';
}

function getMatchColor(status) {
  if (status === 'auto') return 'var(--color-green)';
  if (status === 'ambiguous') return 'var(--color-amber)';
  return 'var(--accent)';
}

function getMatchLabel(status) {
  if (status === 'auto') return 'Auto-matched';
  if (status === 'ambiguous') return 'Needs review';
  return 'New ingredient';
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg-root); overflow: hidden; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  input::placeholder { color: var(--text-faint) !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: var(--bg-root); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .inv-root { font-family: 'Inter', sans-serif; background: var(--bg-root); color: var(--text-primary); width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

  /* ── TOPBAR ── */
  .inv-nav { background: var(--bg-elevated); border-bottom: 1px solid var(--border); height: clamp(36px,4vh,48px); padding: 0 clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .inv-logo { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.1vw,20px); color: var(--text-primary); letter-spacing: -.3px; }
  .inv-logo span { color: var(--accent); }
  .inv-tab { padding: clamp(2px,.3vh,4px) clamp(6px,.6vw,11px); border-radius: clamp(3px,.3vw,6px); font-size: clamp(10px,.75vw,13px); color: var(--text-muted); border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; line-height: 1.5; transition: all .15s; }
  .inv-tab.active { color: var(--text-primary); background: var(--bg-inset); }

  /* ── WBAR ── */
  .inv-wbar { background: var(--bg-surface); border-bottom: 1px solid var(--border); height: clamp(28px,3.2vh,40px); padding: 0 clamp(10px,1vw,16px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .inv-wname { font-size: clamp(11px,.82vw,15px); font-weight: 600; color: var(--text-primary); }
  .inv-wsub { font-size: clamp(9px,.62vw,11px); color: var(--text-muted); margin-left: 6px; }
  .inv-wactions { display: flex; align-items: center; gap: clamp(10px,1.2vw,20px); }
  .inv-waction-item { display: flex; align-items: center; gap: 4px; font-size: clamp(9px,.62vw,11px); color: var(--text-muted); }
  .inv-waction-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .inv-waction-val { font-weight: 600; }

  .inv-upload-btn { display: flex; align-items: center; gap: 6px; background: var(--accent); border: none; border-radius: 5px; padding: clamp(4px,.4vh,7px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: background .2s; flex-shrink: 0; }
  .inv-upload-btn:hover { background: #01bcd4; }

  /* ── SPLIT LAYOUT ── */
  .inv-split { display: flex; gap: clamp(6px,.6vw,10px); padding: clamp(6px,.6vw,10px) clamp(24px,3vw,60px); flex: 1; min-height: 0; overflow: hidden; }

  /* ── INVOICE LIST ── */
  .inv-list { width: 52%; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .inv-list-hd { padding: clamp(8px,.8vh,12px) clamp(10px,1vw,16px); border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .inv-list-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); }
  .inv-list-count { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 1px 8px; }
  .inv-tbl-head { display: grid; grid-template-columns: 2fr 1.5fr 1.2fr 1fr 80px; gap: 8px; padding: clamp(5px,.5vh,8px) clamp(10px,1vw,16px); background: var(--bg-elevated); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .inv-th { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: var(--text-faint); text-transform: uppercase; letter-spacing: .8px; }
  .inv-tbl-body { flex: 1; overflow-y: auto; }
  .inv-row { display: grid; grid-template-columns: 2fr 1.5fr 1.2fr 1fr 80px; gap: 8px; padding: clamp(7px,.7vh,11px) clamp(10px,1vw,16px); border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: background .15s; align-items: center; border-left: 2px solid transparent; animation: fadeIn .2s ease both; }
  .inv-row:hover { background: var(--bg-elevated); }
  .inv-row.selected { background: rgba(2,164,186,.07); border-left-color: var(--accent); }
  .inv-td { font-size: clamp(10px,.75vw,12px); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inv-td.primary { color: var(--text-primary); font-weight: 500; }
  .inv-td.amount { color: var(--accent); font-weight: 600; font-family: 'Inter', sans-serif; }
  .inv-pill { font-size: clamp(8px,.6vw,10px); font-weight: 500; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .inv-pill.ok { background: rgba(42,138,90,.12); color: var(--color-green); }
  .inv-pill.pend { background: rgba(212,160,32,.12); color: var(--color-amber); }

  /* ── DETAIL PANEL ── */
  .inv-detail { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .inv-detail-hd { padding: clamp(8px,.8vh,12px) clamp(10px,1vw,16px); border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .inv-detail-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); }
  .inv-detail-body { flex: 1; overflow-y: auto; padding: clamp(6px,.6vw,10px); display: flex; flex-direction: column; gap: clamp(5px,.5vh,8px); }

  /* ── OVERVIEW WIDGETS ── */
  .inv-widget-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .inv-widget { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 7px; padding: clamp(7px,.7vw,10px); }
  .inv-widget-full { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 7px; padding: clamp(7px,.7vw,10px); }
  .inv-wlbl { font-size: clamp(8px,.6vw,10px); font-weight: 700; color: var(--text-faint); text-transform: uppercase; letter-spacing: .9px; margin-bottom: clamp(5px,.5vh,8px); display: flex; align-items: center; gap: 5px; }
  .inv-wlbl svg { width: 10px; height: 10px; stroke: var(--accent); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  .inv-mini-chart { display: flex; align-items: flex-end; gap: clamp(2px,.2vw,4px); height: clamp(120px,14vh,180px); }
  .inv-mc-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
  .inv-mc-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .inv-mc-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; transition: height .3s ease; }
  .inv-mc-lbl { font-size: clamp(7px,.52vw,9px); color: var(--text-faint); }

  .inv-stat-pair { display: flex; flex-direction: column; gap: clamp(6px,.6vh,9px); }
  .inv-stat-item { display: flex; align-items: center; justify-content: space-between; padding: clamp(4px,.4vh,6px) 0; border-bottom: 1px solid var(--border-subtle); }
  .inv-stat-item:last-child { border-bottom: none; }
  .inv-stat-name { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); }
  .inv-stat-val { font-family: 'Inter', sans-serif; font-size: clamp(12px,1vw,15px); font-weight: 600; }

  .inv-prog-row { display: flex; align-items: center; gap: 8px; margin-bottom: clamp(6px,.6vh,9px); }
  .inv-prog-row:last-child { margin-bottom: 0; }
  .inv-prog-label { font-size: clamp(8px,.62vw,11px); color: var(--text-muted); width: clamp(70px,7vw,100px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inv-prog-track { flex: 1; background: var(--border-subtle); border-radius: 3px; height: clamp(4px,.35vh,5px); }
  .inv-prog-fill { height: 100%; border-radius: 3px; transition: width .4s ease; }
  .inv-prog-val { font-size: clamp(8px,.62vw,11px); font-weight: 600; width: clamp(40px,4vw,58px); text-align: right; flex-shrink: 0; }

  .inv-act-item { display: flex; align-items: center; gap: clamp(7px,.7vw,10px); padding: clamp(5px,.5vh,8px) 0; border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: background .1s; }
  .inv-act-item:last-child { border-bottom: none; }
  .inv-act-item:hover { opacity: .8; }
  .inv-act-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .inv-act-text { flex: 1; font-size: clamp(9px,.68vw,11px); color: var(--text-muted); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inv-act-text strong { color: var(--text-primary); font-weight: 500; }
  .inv-act-amount { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: var(--accent); flex-shrink: 0; font-family: 'Inter', sans-serif; }
  .inv-act-time { font-size: clamp(8px,.6vw,10px); color: var(--text-faint); flex-shrink: 0; white-space: nowrap; }

  /* ── INVOICE DETAIL ── */
  .inv-dsection { margin-bottom: clamp(8px,.8vh,12px); }
  .inv-dsection-title { font-size: clamp(8px,.6vw,10px); font-weight: 700; color: var(--text-faint); text-transform: uppercase; letter-spacing: .9px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 6px; }
  .inv-dsection-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .inv-dgrid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: clamp(5px,.5vw,8px); }
  .inv-dfield { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; padding: clamp(6px,.6vh,10px) clamp(8px,.7vw,12px); }
  .inv-dfield-lbl { font-size: clamp(7px,.58vw,9px); color: var(--text-faint); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
  .inv-dfield-val { font-size: clamp(10px,.75vw,13px); color: var(--text-primary); font-weight: 500; }
  .inv-dfield-val.accent { color: var(--accent); font-family: 'Inter', sans-serif; font-weight: 700; font-size: clamp(15px,1.2vw,20px); }
  .inv-dfield-val.link { color: var(--accent); font-size: clamp(9px,.65vw,11px); cursor: pointer; text-decoration: underline; }

  .inv-items-head { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 80px; gap: 5px; padding: clamp(5px,.5vh,7px) clamp(8px,.7vw,12px); background: var(--bg-elevated); border-radius: 6px 6px 0 0; border: 1px solid var(--border); border-bottom: none; }
  .inv-ith { font-size: clamp(7px,.58vw,10px); font-weight: 600; color: var(--text-faint); text-transform: uppercase; letter-spacing: .6px; }
  .inv-item-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 80px; gap: 5px; padding: clamp(5px,.5vh,8px) clamp(8px,.7vw,12px); border: 1px solid var(--border); border-top: none; align-items: center; }
  .inv-item-row:last-child { border-radius: 0 0 6px 6px; }
  .inv-item-row:nth-child(odd) { background: var(--bg-elevated); }
  .inv-item-row:nth-child(even) { background: var(--bg-surface); }
  .inv-itd { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); }
  .inv-itd.name { color: var(--text-primary); font-weight: 500; }
  .inv-itd.val { color: var(--accent); font-weight: 600; font-family: 'Inter', sans-serif; }
  .inv-linked { font-size: clamp(7px,.55vw,9px); padding: 1px 6px; border-radius: 8px; background: rgba(42,138,90,.12); color: var(--color-green); }
  .inv-unlinked { font-size: clamp(7px,.55vw,9px); padding: 1px 6px; border-radius: 8px; background: rgba(212,160,32,.1); color: var(--color-amber); }

  .inv-total-bar { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; padding: clamp(8px,.8vh,12px) clamp(10px,.9vw,14px); display: flex; justify-content: space-between; align-items: center; margin-top: clamp(5px,.5vh,8px); }
  .inv-total-label { font-size: clamp(9px,.68vw,12px); color: var(--text-muted); font-weight: 500; }
  .inv-total-val { font-family: 'Inter', sans-serif; font-weight: 700; font-size: clamp(15px,1.2vw,20px); color: var(--accent); }
  .inv-diff { font-size: clamp(8px,.62vw,10px); color: var(--color-red); margin-top: 3px; text-align: right; }

  .inv-confirm-banner { margin: 0 clamp(6px,.6vw,10px); background: rgba(42,138,90,.1); border: 1px solid rgba(42,138,90,.25); border-radius: 6px; padding: 8px 14px; font-size: clamp(10px,.75vw,13px); color: var(--color-green); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }

  .inv-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; gap: 10px; }
  .inv-hint { font-size: clamp(8px,.62vw,11px); color: var(--text-faint); text-align: center; padding: clamp(4px,.4vh,7px); border: 1px dashed var(--border); border-radius: 6px; }

  /* ── PARSE MODAL ── */
  .pm-bg { position: fixed; inset: 0; background: rgba(0,0,0,.82); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
  .pm-modal { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; width: min(760px, 100%); max-height: 90vh; display: flex; flex-direction: column; animation: slideUp .2s ease; }
  .pm-hd { padding: clamp(14px,1.4vh,22px) clamp(16px,1.4vw,24px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .pm-title { font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(14px,1.2vw,20px); color: var(--text-primary); }
  .pm-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; line-height: 1; transition: color .15s; }
  .pm-close:hover { color: var(--text-primary); }
  .pm-body { flex: 1; overflow-y: auto; padding: clamp(14px,1.4vh,22px) clamp(16px,1.4vw,24px); display: flex; flex-direction: column; gap: clamp(12px,1.2vh,20px); }
  .pm-ft { padding: clamp(12px,1.2vh,18px) clamp(16px,1.4vw,24px); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-shrink: 0; }
  .pm-drop { border: 2px dashed var(--border); border-radius: 10px; padding: clamp(28px,4vh,48px) 20px; text-align: center; cursor: pointer; transition: border-color .2s, background .2s; }
  .pm-drop:hover, .pm-drop.over { border-color: var(--accent); background: rgba(2,164,186,.04); }
  .pm-drop-icon { width: 40px; height: 40px; stroke: var(--border); fill: none; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; margin: 0 auto 12px; }
  .pm-drop-title { font-size: clamp(12px,.95vw,15px); color: var(--text-primary); font-weight: 500; margin-bottom: 4px; }
  .pm-drop-sub { font-size: clamp(9px,.68vw,12px); color: var(--text-muted); margin-bottom: 14px; }
  .pm-browse { background: var(--accent); border: none; border-radius: 6px; padding: 8px 18px; font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; }
  .pm-parsing { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 40px 20px; text-align: center; }
  .pm-spin { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  .pm-parse-title { font-size: clamp(13px,1vw,16px); font-weight: 600; color: var(--text-primary); }
  .pm-parse-sub { font-size: clamp(10px,.75vw,13px); color: var(--text-muted); }
  .pm-inv-hd { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: clamp(10px,1vw,16px); }
  .pm-inv-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; }
  .pm-inv-field-lbl { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .pm-inv-field-val { font-size: clamp(11px,.85vw,14px); color: var(--text-primary); font-weight: 500; }
  .pm-inv-field-val.accent { color: var(--accent); font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(14px,1.1vw,18px); }
  .pm-conf-badge { display: inline-block; font-size: clamp(7px,.58vw,9px); padding: 1px 5px; border-radius: 4px; margin-left: 4px; }
  .pm-conf-high { background: rgba(42,138,90,.15); color: var(--color-green); }
  .pm-conf-medium { background: rgba(212,160,32,.15); color: var(--color-amber); }
  .pm-conf-low { background: rgba(192,64,64,.15); color: var(--color-red); }
  .pm-summary { display: flex; gap: 8px; flex-wrap: wrap; }
  .pm-sum-pill { display: flex; align-items: center; gap: 5px; font-size: clamp(9px,.68vw,11px); padding: 4px 10px; border-radius: 20px; font-weight: 500; }
  .pm-sum-auto { background: rgba(42,138,90,.1); color: var(--color-green); border: 1px solid rgba(42,138,90,.2); }
  .pm-sum-ambig { background: rgba(212,160,32,.1); color: var(--color-amber); border: 1px solid rgba(212,160,32,.2); }
  .pm-sum-new { background: rgba(2,164,186,.1); color: var(--accent); border: 1px solid rgba(2,164,186,.2); }
  .pm-section-title { font-size: clamp(9px,.7vw,11px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  .pm-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .pm-line-item { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 6px; transition: border-color .15s; }
  .pm-line-item:last-child { margin-bottom: 0; }
  .pm-line-item.status-auto { border-left: 3px solid var(--color-green); }
  .pm-line-item.status-ambiguous { border-left: 3px solid var(--color-amber); }
  .pm-line-item.status-new { border-left: 3px solid var(--accent); }
  .pm-line-item.dismissed { opacity: .4; }
  .pm-li-hd { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 120px; gap: 8px; padding: clamp(8px,.8vh,12px) clamp(10px,.9vw,14px); align-items: center; cursor: pointer; }
  .pm-li-hd:hover { background: rgba(255,255,255,.02); }
  .pm-li-name { font-size: clamp(10px,.78vw,13px); font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-li-meta { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); margin-top: 2px; }
  .pm-li-cell { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); }
  .pm-li-cell.val { color: var(--accent); font-weight: 600; }
  .pm-li-status { display: flex; align-items: center; gap: 5px; font-size: clamp(8px,.62vw,10px); font-weight: 600; }
  .pm-candidates { padding: clamp(8px,.8vh,12px) clamp(10px,.9vw,14px); border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 6px; }
  .pm-cand-title { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; font-weight: 600; margin-bottom: 4px; }
  .pm-cand-option { display: flex; align-items: flex-start; gap: 10px; padding: clamp(7px,.7vh,11px) clamp(10px,.9vw,14px); border: 1px solid var(--border); border-radius: 7px; cursor: pointer; transition: all .15s; background: var(--bg-surface); }
  .pm-cand-option:hover { border-color: var(--text-faint); background: var(--bg-elevated); }
  .pm-cand-option.selected { border-color: var(--accent); background: rgba(2,164,186,.06); }
  .pm-cand-radio { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
  .pm-cand-radio.checked { border-color: var(--accent); }
  .pm-cand-radio-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .pm-cand-name { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); }
  .pm-cand-unit { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); margin-top: 1px; }
  .pm-cand-dishes { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .pm-cand-dish-tag { font-size: clamp(7px,.58vw,9px); padding: 1px 6px; border-radius: 8px; background: rgba(2,164,186,.08); color: var(--accent); border: 1px solid rgba(2,164,186,.15); }
  .pm-cand-score { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); margin-left: auto; flex-shrink: 0; }
  .pm-new-confirm { padding: clamp(8px,.8vh,12px) clamp(10px,.9vw,14px); border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px; }
  .pm-new-lbl { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; font-weight: 600; }
  .pm-new-name-input { background: var(--bg-inset); border: 1px solid var(--border); border-radius: 5px; padding: 6px 10px; font-size: clamp(10px,.78vw,12px); color: var(--text-primary); outline: none; font-family: 'Inter', sans-serif; width: 100%; transition: border-color .15s; }
  .pm-new-name-input:focus { border-color: var(--accent); }
  .pm-new-actions { display: flex; gap: 8px; }
  .pm-new-confirm-btn { background: rgba(2,164,186,.1); border: 1px solid rgba(2,164,186,.3); border-radius: 5px; padding: 5px 12px; font-size: clamp(9px,.68vw,11px); color: var(--accent); cursor: pointer; font-family: 'Inter', sans-serif; font-weight: 600; transition: all .15s; }
  .pm-new-confirm-btn:hover { background: rgba(2,164,186,.18); }
  .pm-new-confirm-btn.active { background: rgba(2,164,186,.2); border-color: var(--accent); }
  .pm-dismiss-btn { background: none; border: 1px solid var(--border); border-radius: 5px; padding: 5px 12px; font-size: clamp(9px,.68vw,11px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .pm-dismiss-btn:hover { color: var(--color-red); border-color: rgba(192,64,64,.3); }
  .pm-btn-primary { background: var(--accent); border: none; border-radius: 6px; padding: clamp(8px,.8vh,12px) clamp(18px,1.6vw,28px); font-size: clamp(11px,.85vw,14px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; transition: background .2s; white-space: nowrap; }
  .pm-btn-primary:hover { background: #01bcd4; }
  .pm-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
  .pm-btn-secondary { background: none; border: 1px solid var(--border); border-radius: 6px; padding: clamp(8px,.8vh,12px) clamp(14px,1.2vw,20px); font-size: clamp(11px,.85vw,14px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .pm-btn-secondary:hover { color: var(--text-primary); border-color: var(--text-faint); }
  .pm-progress-text { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); }
  .pm-success { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 20px; text-align: center; }
  .pm-success-icon { width: 48px; height: 48px; border-radius: 50%; background: rgba(42,138,90,.12); border: 2px solid rgba(42,138,90,.3); display: flex; align-items: center; justify-content: center; }
  .pm-success-title { font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(16px,1.4vw,22px); color: var(--text-primary); }
  .pm-success-sub { font-size: clamp(10px,.75vw,13px); color: var(--text-muted); max-width: 340px; line-height: 1.5; }

  /* Mobile — unchanged */
  .mob-root { font-family: 'Inter', sans-serif; background: var(--bg-root); color: var(--text-primary); width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .mob-header { background: var(--bg-elevated); border-bottom: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding-top: env(safe-area-inset-top, 10px); }
  .mob-logo { font-family: 'Playfair Display', serif; font-size: 20px; color: var(--text-primary); letter-spacing: -.3px; }
  .mob-logo span { color: var(--accent); }
  .mob-titlebar { background: var(--bg-surface); border-bottom: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .mob-page-title { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 20px; color: var(--text-primary); line-height: 1; }
  .mob-page-sub { font-size: 11px; color: var(--text-muted); margin-top: 3px; }
  .mob-stats { background: var(--bg-surface); border-bottom: 1px solid var(--border); padding: 8px 16px; display: flex; flex-shrink: 0; overflow-x: auto; }
  .mob-stats::-webkit-scrollbar { display: none; }
  .mob-stat { flex: 1; min-width: 0; text-align: center; padding: 0 6px; border-right: 1px solid var(--border); }
  .mob-stat:last-child { border-right: none; }
  .mob-stat-v { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 16px; line-height: 1; }
  .mob-stat-l { font-size: 9px; color: var(--text-muted); margin-top: 2px; text-transform: uppercase; letter-spacing: .4px; }
  .mob-search-bar { padding: 10px 14px; background: var(--bg-root); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .mob-search-input { width: 100%; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 14px; color: var(--text-primary); outline: none; font-family: 'Inter', sans-serif; }
  .mob-list-head { display: grid; grid-template-columns: 2fr 1.5fr 1fr 90px; gap: 6px; padding: 8px 14px; background: var(--bg-elevated); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .mob-list-th { font-size: 9px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .7px; }
  .mob-list-body { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .mob-list-body::-webkit-scrollbar { display: none; }
  .mob-list-row { display: grid; grid-template-columns: 2fr 1.5fr 1fr 90px; gap: 6px; padding: 13px 14px; border-bottom: 1px solid var(--border-subtle); cursor: pointer; align-items: center; border-left: 3px solid transparent; }
  .mob-list-row.selected { background: rgba(2,164,186,.07); border-left-color: var(--accent); }
  .mob-td { font-size: 13px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mob-td.primary { color: var(--text-primary); font-weight: 500; }
  .mob-td.amount { color: var(--accent); font-weight: 600; }
  .mob-pill { font-size: 10px; font-weight: 500; padding: 3px 8px; border-radius: 10px; }
  .mob-pill.ok { background: rgba(42,138,90,.12); color: var(--color-green); }
  .mob-pill.pend { background: rgba(212,160,32,.12); color: var(--color-amber); }
  .mob-add-btn { background: var(--accent); border: none; border-radius: 7px; padding: 8px 14px; font-size: 13px; font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; }
  .mob-detail-overlay { position: absolute; inset: 0; background: var(--bg-root); display: flex; flex-direction: column; z-index: 20; overflow: hidden; }
  .mob-detail-hd { background: var(--bg-elevated); border-bottom: 1px solid var(--border); padding: 12px 16px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .mob-back-btn { background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 13px; color: var(--accent); padding: 0; }
  .mob-detail-title { font-size: 15px; font-weight: 600; color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mob-detail-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .mob-dfield-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .mob-dfield { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .mob-dfield-lbl { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
  .mob-dfield-val { font-size: 13px; color: var(--text-primary); font-weight: 500; }
  .mob-dfield-val.accent { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 18px; color: var(--accent); }
  .mob-items-head { display: grid; grid-template-columns: 2fr 1fr 1fr 80px; gap: 6px; padding: 8px 12px; background: var(--bg-elevated); border-radius: 8px 8px 0 0; border: 1px solid var(--border); border-bottom: none; }
  .mob-ith { font-size: 9px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; }
  .mob-item-row { display: grid; grid-template-columns: 2fr 1fr 1fr 80px; gap: 6px; padding: 11px 12px; border: 1px solid var(--border); border-top: none; align-items: center; }
  .mob-item-row:last-child { border-radius: 0 0 8px 8px; }
  .mob-item-row:nth-child(odd) { background: var(--bg-elevated); }
  .mob-item-row:nth-child(even) { background: var(--bg-surface); }
  .mob-itd { font-size: 12px; color: var(--text-muted); }
  .mob-itd.name { color: var(--text-primary); font-weight: 500; }
  .mob-itd.val { color: var(--accent); font-weight: 600; }
  .mob-linked { font-size: 10px; padding: 2px 6px; border-radius: 8px; background: rgba(42,138,90,.12); color: var(--color-green); }
  .mob-unlinked { font-size: 10px; padding: 2px 6px; border-radius: 8px; background: rgba(212,160,32,.1); color: var(--color-amber); }
  .mob-total-bar { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; }
  .mob-bottom-nav { background: var(--bg-elevated); border-top: 1px solid var(--border); padding: 8px 0; padding-bottom: max(20px, calc(8px + env(safe-area-inset-bottom))); display: flex; flex-shrink: 0; }
  .mob-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; padding: 4px 0; -webkit-tap-highlight-color: transparent; }
  .mob-nav-icon svg { width: 20px; height: 20px; stroke: var(--text-muted); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mob-nav-icon.active svg { stroke: var(--accent); }
  .mob-nav-label { font-size: 10px; color: var(--text-muted); }
  .mob-nav-label.active { color: var(--accent); }
  .mob-nav-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function IconUpload({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}

function IconFile({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .25 }}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/client/dashboard' },
  { label: 'Invoices',  path: '/client/invoices'  },
  { label: 'Ingredients', path: '/client/ingredients' },
  { label: 'Menu', path: '/client/menu-items' },
  { label: 'Analytics', path: '/client/analytics' },
];

function NavIcon({ path }) {
  if (path === '/client/dashboard') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
  if (path === '/client/invoices') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  if (path === '/client/ingredients') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>;
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
}

function MobBottomNav({ current, router }) {
  return (
    <div className="mob-bottom-nav">
      {NAV_ITEMS.map(({ label, path }) => {
        const active = path === current;
        return (
          <div key={label} className="mob-nav-item" onClick={() => router.push(path)}>
            <div className={`mob-nav-icon${active ? ' active' : ''}`}><NavIcon path={path} /></div>
            <div className={`mob-nav-label${active ? ' active' : ''}`}>{label}</div>
            {active && <div className="mob-nav-dot" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Parse Modal ──────────────────────────────────────────────────────────────

function ParseModal({ onClose, restaurantId, onSaved }) {
  const fileInputRef = useRef(null);
  const [step, setStep] = useState('drop');
  const [dragOver, setDragOver] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [expandedItem, setExpandedItem] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedResult, setSavedResult] = useState(null);
  const PARSE_STAGES = [
    { msg: 'Uploading invoice...', sub: 'Sending file to server' },
    { msg: 'Claude is reading your invoice', sub: 'Scanning line items and pricing...' },
    { msg: 'Extracting ingredients...', sub: 'Identifying products and quantities' },
    { msg: 'Matching to your inventory...', sub: 'Comparing against existing ingredients' },
    { msg: 'Almost done...', sub: 'Finalizing results' },
  ];

  const [stageIdx, setStageIdx] = useState(0);
  const stageTimerRef = useRef(null);

  function startStageTimer() {
    setStageIdx(0);
    let idx = 0;
    const intervals = [2000, 8000, 6000, 4000];
    function advance() {
      idx++;
      if (idx < PARSE_STAGES.length - 1) {
        setStageIdx(idx);
        stageTimerRef.current = setTimeout(advance, intervals[idx] || 4000);
      } else {
        setStageIdx(PARSE_STAGES.length - 1);
      }
    }
    stageTimerRef.current = setTimeout(advance, intervals[0]);
  }

  function stopStageTimer() {
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
  }

  const pendingCount = lineItems.filter(i =>
    !i.dismissed && (
      (i.match_status === 'ambiguous' && !i.selected_ingredient_id) ||
      (i.match_status === 'new' && !i.confirm_new && !i.dismissed)
    )
  ).length;

  const canConfirm = pendingCount === 0 && lineItems.length > 0;

  async function handleFile(file) {
    if (!file) return;
    setStep('parsing');
    setErrorMsg('');
    startStageTimer();

    try {
      const filePath = `${restaurantId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('invoices').upload(filePath, file);
      if (uploadError) throw new Error('File upload failed: ' + uploadError.message);
      const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(filePath);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('restaurant_id', restaurantId);
      formData.append('file_url', publicUrl);

      const res = await fetch('/api/invoices/parse-invoice', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Parse failed');

      stopStageTimer();
      setParseResult(data);
      setLineItems((data.line_items || []).map(item => ({
        ...item,
        confirmed_name: item.item_name,
        confirm_new: false,
        dismissed: false,
      })));
      setStep('review');

      const firstPending = (data.line_items || []).find(
        i => i.match_status === 'ambiguous' || i.match_status === 'new'
      );
      if (firstPending) setExpandedItem(firstPending._id);

    } catch (err) {
      setErrorMsg(err.message || 'Something went wrong');
      setStep('error');
    }
  }

  function selectCandidate(itemId, candidate) {
    setLineItems(prev => prev.map(item =>
      item._id === itemId
        ? { ...item, selected_ingredient_id: candidate.id, selected_ingredient_name: candidate.name }
        : item
    ));
    const currentIdx = lineItems.findIndex(i => i._id === itemId);
    const nextPending = lineItems.slice(currentIdx + 1).find(
      i => !i.dismissed && (i.match_status === 'ambiguous' || i.match_status === 'new')
    );
    setExpandedItem(nextPending?._id || null);
  }

  function confirmNew(itemId, confirmed) {
    setLineItems(prev => prev.map(item =>
      item._id === itemId ? { ...item, confirm_new: confirmed } : item
    ));
    if (confirmed) {
      const currentIdx = lineItems.findIndex(i => i._id === itemId);
      const nextPending = lineItems.slice(currentIdx + 1).find(
        i => !i.dismissed && (i.match_status === 'ambiguous' || i.match_status === 'new')
      );
      setExpandedItem(nextPending?._id || null);
    }
  }

  function dismissItem(itemId) {
    setLineItems(prev => prev.map(item =>
      item._id === itemId ? { ...item, dismissed: true } : item
    ));
    setExpandedItem(null);
  }

  function updateConfirmedName(itemId, name) {
    setLineItems(prev => prev.map(item =>
      item._id === itemId ? { ...item, confirmed_name: name } : item
    ));
  }

  async function handleConfirm() {
    setSaving(true);
    setStep('saving');
    try {
      const res = await fetch('/api/invoices/confirm-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          invoice: parseResult.invoice,
          line_items: lineItems,
          file_url: parseResult.file_url,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      setSavedResult(data);
      setStep('success');
      onSaved();
    } catch (err) {
      setErrorMsg(err.message || 'Save failed');
      setStep('error');
    } finally {
      setSaving(false);
    }
  }

  function confBadgeClass(level) {
    if (level === 'high') return 'pm-conf-high';
    if (level === 'medium') return 'pm-conf-medium';
    return 'pm-conf-low';
  }

  const inv = parseResult?.invoice;
  const summary = parseResult?.summary;

  return (
    <div className="pm-bg" onClick={e => { if (e.target === e.currentTarget && step !== 'saving') onClose(); }}>
      <div className="pm-modal">
        <div className="pm-hd">
          <div className="pm-title">
            {step === 'drop' && 'Upload Invoice'}
            {step === 'parsing' && 'Analyzing Invoice...'}
            {step === 'review' && 'Review & Confirm'}
            {step === 'saving' && 'Saving...'}
            {step === 'success' && 'Invoice Saved'}
            {step === 'error' && 'Something went wrong'}
          </div>
          {step !== 'saving' && (
            <button className="pm-close" onClick={onClose}>✕</button>
          )}
        </div>

        <div className="pm-body">
          {step === 'drop' && (
            <div
              className={`pm-drop${dragOver ? ' over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              <svg className="pm-drop-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/></svg>
              <div className="pm-drop-title">Drag & drop your invoice here</div>
              <div className="pm-drop-sub">Supports PDF, JPG, PNG, WEBP — up to 20MB</div>
              <button className="pm-browse" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>Browse Files</button>
            </div>
          )}

          {step === 'parsing' && (
            <div className="pm-parsing">
              <div className="pm-spin" />
              <div className="pm-parse-title" style={{ transition: 'opacity .3s' }}>
                {PARSE_STAGES[stageIdx].msg}
              </div>
              <div className="pm-parse-sub" style={{ transition: 'opacity .3s' }}>
                {PARSE_STAGES[stageIdx].sub}
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                {PARSE_STAGES.map((_, i) => (
                  <div key={i} style={{
                    width: i === stageIdx ? 16 : 5,
                    height: 5,
                    borderRadius: 3,
                    background: i <= stageIdx ? 'var(--accent)' : 'var(--border)',
                    transition: 'all .4s ease',
                  }} />
                ))}
              </div>
            </div>
          )}

          {step === 'saving' && (
            <div className="pm-parsing">
              <div className="pm-spin" />
              <div className="pm-parse-title">Saving to your account</div>
              <div className="pm-parse-sub">Updating invoice records and ingredient prices...</div>
            </div>
          )}

          {step === 'success' && savedResult && (
            <div className="pm-success">
              <div className="pm-success-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div className="pm-success-title">Invoice saved successfully</div>
              <div className="pm-success-sub">
                {savedResult.items_saved} line item{savedResult.items_saved !== 1 ? 's' : ''} saved
                {savedResult.ingredients_created > 0 && ` · ${savedResult.ingredients_created} new ingredient${savedResult.ingredients_created !== 1 ? 's' : ''} created`}
                {savedResult.ingredients_updated > 0 && ` · ${savedResult.ingredients_updated} ingredient price${savedResult.ingredients_updated !== 1 ? 's' : ''} updated`}
              </div>
              {savedResult.errors?.length > 0 && (
                <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--color-amber)', maxWidth: 360, lineHeight: 1.5 }}>
                  {savedResult.errors.length} item{savedResult.errors.length !== 1 ? 's' : ''} had issues and were skipped.
                </div>
              )}
            </div>
          )}

          {step === 'error' && (
            <div className="pm-parsing">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-red)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div className="pm-parse-title" style={{ color: 'var(--color-red)' }}>Parse failed</div>
              <div className="pm-parse-sub">{errorMsg}</div>
            </div>
          )}

          {step === 'review' && inv && (
            <>
              <div className="pm-inv-hd">
                <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 600, marginBottom: 8 }}>Invoice Details</div>
                <div className="pm-inv-grid">
                  <div>
                    <div className="pm-inv-field-lbl">Supplier<span className={`pm-conf-badge ${confBadgeClass(inv.confidence?.supplier)}`}>{inv.confidence?.supplier || '?'}</span></div>
                    <div className="pm-inv-field-val">{inv.supplier || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not found</span>}</div>
                  </div>
                  <div>
                    <div className="pm-inv-field-lbl">Invoice #<span className={`pm-conf-badge ${confBadgeClass(inv.confidence?.invoice_number)}`}>{inv.confidence?.invoice_number || '?'}</span></div>
                    <div className="pm-inv-field-val">{inv.invoice_number || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not found</span>}</div>
                  </div>
                  <div>
                    <div className="pm-inv-field-lbl">Date<span className={`pm-conf-badge ${confBadgeClass(inv.confidence?.invoice_date)}`}>{inv.confidence?.invoice_date || '?'}</span></div>
                    <div className="pm-inv-field-val">{inv.invoice_date ? formatDateShort(inv.invoice_date) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not found</span>}</div>
                  </div>
                  <div>
                    <div className="pm-inv-field-lbl">Total<span className={`pm-conf-badge ${confBadgeClass(inv.confidence?.total_amount)}`}>{inv.confidence?.total_amount || '?'}</span></div>
                    <div className="pm-inv-field-val accent">{inv.total_amount ? formatCurrency(inv.total_amount) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'Inter, sans-serif', fontSize: '13px' }}>Not found</span>}</div>
                  </div>
                </div>
                {inv.notes && (
                  <div style={{ marginTop: 8, fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', fontStyle: 'italic' }}>Note: {inv.notes}</div>
                )}
              </div>

              {summary && (
                <div className="pm-summary">
                  <div className="pm-sum-pill pm-sum-auto">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {summary.auto_matched} auto-matched
                  </div>
                  {summary.needs_review > 0 && (
                    <div className="pm-sum-pill pm-sum-ambig">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {summary.needs_review} need{summary.needs_review === 1 ? 's' : ''} review
                    </div>
                  )}
                  {summary.new_ingredients > 0 && (
                    <div className="pm-sum-pill pm-sum-new">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      {summary.new_ingredients} new ingredient{summary.new_ingredients !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              )}

              <div>
                {lineItems.some(i => i.match_status !== 'auto' && !i.dismissed) && (
                  <>
                    <div className="pm-section-title">Needs Your Review</div>
                    {lineItems
                      .filter(i => i.match_status !== 'auto' && !i.dismissed)
                      .map(item => (
                        <LineItemCard
                          key={item._id}
                          item={item}
                          expanded={expandedItem === item._id}
                          onToggle={() => setExpandedItem(expandedItem === item._id ? null : item._id)}
                          onSelectCandidate={selectCandidate}
                          onConfirmNew={confirmNew}
                          onDismiss={dismissItem}
                          onUpdateName={updateConfirmedName}
                        />
                      ))}
                  </>
                )}

                {lineItems.some(i => i.match_status === 'auto' && !i.dismissed) && (
                  <>
                    <div className="pm-section-title" style={{ marginTop: 16 }}>Auto-Matched</div>
                    {lineItems
                      .filter(i => i.match_status === 'auto' && !i.dismissed)
                      .map(item => (
                        <LineItemCard
                          key={item._id}
                          item={item}
                          expanded={expandedItem === item._id}
                          onToggle={() => setExpandedItem(expandedItem === item._id ? null : item._id)}
                          onSelectCandidate={selectCandidate}
                          onConfirmNew={confirmNew}
                          onDismiss={dismissItem}
                          onUpdateName={updateConfirmedName}
                        />
                      ))}
                  </>
                )}

                {lineItems.some(i => i.dismissed) && (
                  <>
                    <div className="pm-section-title" style={{ marginTop: 16 }}>Dismissed</div>
                    {lineItems
                      .filter(i => i.dismissed)
                      .map(item => (
                        <div key={item._id} className="pm-line-item dismissed" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>{item.item_name}</div>
                          <button onClick={() => setLineItems(prev => prev.map(i => i._id === item._id ? { ...i, dismissed: false } : i))}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'clamp(8px,.62vw,10px)', fontFamily: 'Inter, sans-serif' }}>
                            Restore
                          </button>
                        </div>
                      ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="pm-ft">
          {step === 'drop' && (
            <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>Files are processed immediately — nothing is saved until you confirm.</div>
          )}
          {step === 'review' && (
            <>
              <div className="pm-progress-text">
                {pendingCount > 0
                  ? `${pendingCount} item${pendingCount !== 1 ? 's' : ''} still need${pendingCount === 1 ? 's' : ''} review`
                  : 'All items resolved — ready to save'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="pm-btn-secondary" onClick={onClose}>Cancel</button>
                <button className="pm-btn-primary" disabled={!canConfirm} onClick={handleConfirm}>
                  Confirm & Save Invoice
                </button>
              </div>
            </>
          )}
          {step === 'success' && (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="pm-btn-primary" onClick={onClose}>Done</button>
            </div>
          )}
          {step === 'error' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="pm-btn-secondary" onClick={() => setStep('drop')}>Try Again</button>
              <button className="pm-btn-secondary" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Line Item Card ───────────────────────────────────────────────────────────

function LineItemCard({ item, expanded, onToggle, onSelectCandidate, onConfirmNew, onDismiss, onUpdateName }) {
  const matchColor = getMatchColor(item.match_status);
  const matchLabel = getMatchLabel(item.match_status);
  const lineTotal = item.line_total || ((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0));
  const autoMatchName = item.match_status === 'auto' ? item.match_candidates?.[0]?.name : null;

  return (
    <div className={`pm-line-item status-${item.match_status}`}>
      <div className="pm-li-hd" onClick={item.match_status !== 'auto' ? onToggle : undefined}
        style={{ cursor: item.match_status !== 'auto' ? 'pointer' : 'default' }}>
        <div>
          <div className="pm-li-name">{item.item_name}</div>
          {autoMatchName && <div className="pm-li-meta">→ {autoMatchName}</div>}
          {item.match_status === 'ambiguous' && item.selected_ingredient_id && (
            <div className="pm-li-meta" style={{ color: 'var(--color-green)' }}>→ {item.selected_ingredient_name}</div>
          )}
          {item.match_status === 'new' && item.confirm_new && (
            <div className="pm-li-meta" style={{ color: 'var(--accent)' }}>→ Will create: {item.confirmed_name}</div>
          )}
        </div>
        <div className="pm-li-cell">{item.quantity ? `${item.quantity} ${item.unit || ''}` : '—'}</div>
        <div className="pm-li-cell val">{formatCurrency(item.unit_cost)}</div>
        <div className="pm-li-cell val">{formatCurrency(lineTotal)}</div>
        <div className="pm-li-status">
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: matchColor, flexShrink: 0 }} />
          <span style={{ color: matchColor }}>{matchLabel}</span>
          {item.match_status !== 'auto' && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{expanded ? '▴' : '▾'}</span>
          )}
        </div>
      </div>

      {expanded && item.match_status === 'ambiguous' && (
        <div className="pm-candidates">
          <div className="pm-cand-title">Which ingredient is this?</div>
          {item.match_candidates.map(candidate => {
            const isSelected = item.selected_ingredient_id === candidate.id;
            return (
              <div key={candidate.id} className={`pm-cand-option${isSelected ? ' selected' : ''}`}
                onClick={() => onSelectCandidate(item._id, candidate)}>
                <div className="pm-cand-radio">
                  {isSelected && <div className="pm-cand-radio-dot" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pm-cand-name">{candidate.name}</div>
                  <div className="pm-cand-unit">{candidate.unit} · last price: {candidate.last_price ? formatCurrency(candidate.last_price) : 'not set'}</div>
                  {candidate.used_in?.length > 0 && (
                    <div className="pm-cand-dishes">
                      {candidate.used_in.slice(0, 4).map(dish => (
                        <span key={dish} className="pm-cand-dish-tag">{dish}</span>
                      ))}
                      {candidate.used_in.length > 4 && (
                        <span className="pm-cand-dish-tag">+{candidate.used_in.length - 4} more</span>
                      )}
                    </div>
                  )}
                  {(!candidate.used_in || !candidate.used_in.length) && (
                    <div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: '#3a3630', marginTop: 3 }}>Not used in any menu items yet</div>
                  )}
                </div>
                <div className="pm-cand-score">{Math.round((candidate.score || 0) * 100)}%</div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="pm-dismiss-btn" onClick={() => onDismiss(item._id)}>Skip this item</button>
          </div>
        </div>
      )}

      {expanded && item.match_status === 'new' && (
        <div className="pm-new-confirm">
          <div className="pm-new-lbl">New ingredient — confirm to add to your inventory</div>
          <div>
            <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', marginBottom: 4 }}>Ingredient name</div>
            <input
              className="pm-new-name-input"
              value={item.confirmed_name}
              onChange={e => onUpdateName(item._id, e.target.value)}
              placeholder="Ingredient name..."
            />
          </div>
          <div className="pm-new-actions">
            <button
              className={`pm-new-confirm-btn${item.confirm_new ? ' active' : ''}`}
              onClick={() => onConfirmNew(item._id, !item.confirm_new)}
            >
              {item.confirm_new ? '✓ Confirmed — will create' : 'Confirm & Create Ingredient'}
            </button>
            <button className="pm-dismiss-btn" onClick={() => onDismiss(item._id)}>Skip</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientInvoices() {
  const router = useRouter();
  const { isMobile } = useWindowSize();

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showParseModal, setShowParseModal] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState('');

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];
  const isTour = router.query.tour === 'true';

  useEffect(() => { init(); }, []);
  useEffect(() => {
    if (restaurantId && !isTour) fetchInvoices();
  }, [restaurantId]);
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
    router.prefetch('/client/analytics');
  }, []);

  const { tourProps } = useTour('invoices', restaurantId);

  useEffect(() => {
    if (!router.isReady || !isTour) return;
    fetchSampleData().then(sample => {
      if (!sample) return;
      setInvoices(sample.invoices);
      setLoading(false);
    });
  }, [router.isReady, isTour]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    setUserEmail(user.email || '');
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) return;
    setRestaurantId(profile.restaurant_id);
    setUserName(profile.full_name ? profile.full_name.split(' ')[0] : 'User');
  }

  async function fetchInvoices() {
    setLoading(true);
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('date', { ascending: false, nullsFirst: false });
    setInvoices(data || []);
    setLoading(false);
    const { selected } = router.query;
    if (selected && data) {
      const found = data.find(i => i.id === selected);
      if (found) selectInvoice(found);
    }
  }

  async function selectInvoice(invoice) {
    setSelectedInvoice(invoice);
    setLoadingDetail(true);
    router.replace(`/client/invoices?selected=${invoice.id}`, undefined, { shallow: true });
    const { data } = await supabase.from('invoice_items').select('*, ingredients(name, unit)').eq('invoice_id', invoice.id).order('item_name');
    setInvoiceItems(data || []);
    setLoadingDetail(false);
  }

  function handleInvoiceSaved() {
    fetchInvoices();
    setConfirmMsg('Invoice parsed and saved successfully.');
    setTimeout(() => setConfirmMsg(''), 5000);
  }

  // ── Derived stats ──
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const totalSpend = invoices.reduce((s, i) => s + (Math.round(parseFloat(i.amount || 0) * 100) / 100), 0);

  const thisMonthSpend = invoices.filter(i => {
    if (!i.date) return false;
    const [y, m] = i.date.split('T')[0].split('-').map(Number);
    return y === currentYear && m - 1 === currentMonth;
  }).reduce((s, i) => s + (Math.round(parseFloat(i.amount || 0) * 100) / 100), 0);

  const avgInvoice = invoices.length > 0 ? totalSpend / invoices.length : 0;
  const largest = invoices.length > 0 ? Math.max(...invoices.map(i => parseFloat(i.amount || 0))) : 0;
  const lastInvoice = invoices[0];
  const daysSinceLast = lastInvoice?.date
    ? (() => {
        const [y, m, d] = lastInvoice.date.split('T')[0].split('-').map(Number);
        return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000);
      })()
    : null;

  // Invoices dated in current month
  const invoicesThisMonthByDate = invoices.filter(i => {
    if (!i.date) return false;
    const [y, m] = i.date.split('T')[0].split('-').map(Number);
    return y === currentYear && m - 1 === currentMonth;
  }).length;

  // Invoices uploaded (created_at) in current month
  const invoicesUploadedThisMonth = invoices.filter(i => {
    if (!i.created_at) return false;
    const d = new Date(i.created_at);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).length;

  const supplierMap = {};
  invoices.forEach(i => {
    if (i.supplier) {
      const key = i.supplier.trim();
      supplierMap[key] = Math.round(((supplierMap[key] || 0) + (Math.round(parseFloat(i.amount || 0) * 100) / 100)) * 100) / 100;
    }
  });
  const topSuppliers = Object.entries(supplierMap).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxSupplier = topSuppliers[0]?.[1] || 1;

  const monthlySpend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(currentYear, currentMonth - 11 + i, 1);
    const yr = d.getFullYear();
    const mo = d.getMonth();
    const total = invoices.filter(inv => {
      if (!inv.date) return false;
      const [y, m] = inv.date.split('T')[0].split('-').map(Number);
      return y === yr && (m - 1) === mo;
    }).reduce((s, inv) => s + (Math.round(parseFloat(inv.amount || 0) * 100) / 100), 0);
    return { month: d.toLocaleDateString('en-US', { month: 'short' }).slice(0, 1), total };
  });
  const maxMonthly = Math.max(...monthlySpend.map(m => m.total), 1);

  const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const lastMonthSpend = invoices.filter(inv => {
    if (!inv.date) return false;
    const [y, m] = inv.date.split('T')[0].split('-').map(Number);
    return y === lastMonthDate.getFullYear() && (m - 1) === lastMonthDate.getMonth();
  }).reduce((s, inv) => s + (Math.round(parseFloat(inv.amount || 0) * 100) / 100), 0);

  const monthDelta = thisMonthSpend - lastMonthSpend;
  const monthPct = lastMonthSpend > 0 ? Math.round((monthDelta / lastMonthSpend) * 100) : null;
  const monthUp = monthDelta >= 0;

  const filtered = invoices.filter(i => {
    const s = searchTerm.toLowerCase();
    return (i.number || '').toLowerCase().includes(s) || (i.supplier || '').toLowerCase().includes(s);
  });

  const totalCalculated = invoiceItems.reduce((s, i) => s + calculateItemTotal(i), 0);

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <style>{CSS}</style>
        <div className="mob-root" style={{ position: 'relative' }}>
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="mob-add-btn" onClick={() => setShowParseModal(true)}>+ Upload</button>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
            </div>
          </div>
          <div className="mob-titlebar">
            <div>
              <div className="mob-page-title">Invoice Center</div>
              <div className="mob-page-sub">Track expenses and supplier payments</div>
            </div>
          </div>
          <div className="mob-stats">
            {[
              { v: invoices.length, l: 'Total', c: 'var(--accent)' },
              { v: formatCurrencyShort(totalSpend), l: 'Total Spend', c: 'var(--text-primary)' },
              { v: formatCurrencyShort(thisMonthSpend), l: 'This Month', c: 'var(--text-primary)' },
              { v: formatCurrencyShort(lastMonthSpend), l: 'Last Month', c: '#6b6358' },
            ].map(({ v, l, c }) => (
              <div key={l} className="mob-stat">
                <div className="mob-stat-v" style={{ color: c }}>{v}</div>
                <div className="mob-stat-l">{l}</div>
              </div>
            ))}
          </div>
          <div className="mob-search-bar">
            <input className="mob-search-input" placeholder="Search by supplier or invoice number..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="mob-list-head">
            <div className="mob-list-th">Supplier</div>
            <div className="mob-list-th">Invoice No.</div>
            <div className="mob-list-th">Amount</div>
            <div className="mob-list-th">Date</div>
          </div>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading invoices...</div>
            </div>
          ) : (
            <div className="mob-list-body">
              {filtered.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 }}>
                  <div style={{ fontSize: 13, color: '#6b6358', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No invoices yet'}</div>
                  {!searchTerm && <button className="mob-add-btn" onClick={() => setShowParseModal(true)}>Upload First Invoice</button>}
                </div>
              ) : filtered.map(invoice => (
                <div key={invoice.id} className={`mob-list-row${selectedInvoice?.id === invoice.id ? ' selected' : ''}`} onClick={() => selectInvoice(invoice)}>
                  <div className="mob-td primary">{invoice.supplier || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Unknown</span>}</div>
                  <div className="mob-td">{invoice.number || <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
                  <div className="mob-td amount">{invoice.amount ? formatCurrencyShort(invoice.amount) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
                  <div className="mob-td">{invoice.date ? formatDateShort(invoice.date) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
                </div>
              ))}
            </div>
          )}

          {selectedInvoice && (
            <div className="mob-detail-overlay">
              <div className="mob-detail-hd">
                <button className="mob-back-btn" onClick={() => { setSelectedInvoice(null); setInvoiceItems([]); router.replace('/client/invoices', undefined, { shallow: true }); }}>← Back</button>
                <div className="mob-detail-title">{selectedInvoice.supplier || 'Invoice'}</div>
                <span className={`mob-pill ${getStatus(selectedInvoice).ok ? 'ok' : 'pend'}`}>{getStatus(selectedInvoice).label}</span>
              </div>
              <div className="mob-detail-body">
                <div className="mob-dfield-grid">
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Invoice No.</div><div className="mob-dfield-val">{selectedInvoice.number || '—'}</div></div>
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Date</div><div className="mob-dfield-val">{selectedInvoice.date ? formatDateShort(selectedInvoice.date) : '—'}</div></div>
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Supplier</div><div className="mob-dfield-val">{selectedInvoice.supplier || '—'}</div></div>
                  <div className="mob-dfield"><div className="mob-dfield-lbl">Upload Date</div><div className="mob-dfield-val">{formatDateShort(selectedInvoice.created_at)}</div></div>
                </div>
                <div className="mob-dfield">
                  <div className="mob-dfield-lbl">Total Amount</div>
                  <div className="mob-dfield-val accent">{selectedInvoice.amount ? formatCurrency(selectedInvoice.amount) : '—'}</div>
                </div>
                {selectedInvoice.file_url && (
                  <a href={selectedInvoice.file_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', padding: 10, background: '#13120f', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
                    View Invoice File ↗
                  </a>
                )}
                {loadingDetail ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                    <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    Loading items...
                  </div>
                ) : invoiceItems.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.7px' }}>Invoice Items ({invoiceItems.length})</div>
                    <div className="mob-items-head">
                      <div className="mob-ith">Item</div><div className="mob-ith">Qty</div><div className="mob-ith">Cost</div><div className="mob-ith">Status</div>
                    </div>
                    {invoiceItems.map(item => (
                      <div key={item.id} className="mob-item-row">
                        <div className="mob-itd name">{item.item_name || '—'}</div>
                        <div className="mob-itd">{item.quantity ? `${item.quantity} ${item.unit || ''}`.trim() : '—'}</div>
                        <div className="mob-itd val">{formatCurrency(calculateItemTotal(item))}</div>
                        <div>{item.ingredients ? <span className="mob-linked">Linked</span> : <span className="mob-unlinked">Unlinked</span>}</div>
                      </div>
                    ))}
                    <div className="mob-total-bar">
                      <div style={{ fontSize: 13, color: '#6b6358', fontWeight: 500 }}>Calculated Total</div>
                      <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 18, color: 'var(--accent)' }}>{formatCurrency(totalCalculated)}</div>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>No line items recorded</div>
                )}
              </div>
            </div>
          )}

          <MobBottomNav current="/client/invoices" router={router} />
        </div>
        {showParseModal && restaurantId && (
          <ParseModal restaurantId={restaurantId} onClose={() => setShowParseModal(false)} onSaved={handleInvoiceSaved} />
        )}
        {tourProps && <TourOverlay {...tourProps} />}
        <TourDataBanner />
      </>
    );
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="inv-root">

        {/* TOPBAR */}
        <div className="inv-nav">
          <div style={{display:'flex',alignItems:'center',gap:'clamp(8px,1vw,16px)'}}>
            <div className="inv-logo">Opti<span>Menu</span></div>
            <div style={{display:'flex',gap:2}}>
              {tabs.map(t=>(
                <button key={t} className={`inv-tab${t==='Invoices'?' active':''}`}
                  onClick={()=>router.push(t==='Dashboard'?'/client/dashboard':`/client/${t.toLowerCase().replace(' ','-')}`)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'clamp(6px,.7vw,12px)'}}>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:'clamp(9px,.62vw,11px)',color:'var(--accent)'}}>
              <div style={{width:5,height:5,background:'var(--accent)',borderRadius:'50%',animation:'blink 2s infinite'}}/>Active
            </div>
              <div style={{width:'clamp(140px,13vw,240px)',height:'clamp(26px,2.6vh,34px)',overflow:'visible',position:'relative'}}>
                <UniversalSearch restaurantId={restaurantId} placeholder="Search..."/>
              </div>
            <button className="inv-upload-btn" onClick={()=>setShowParseModal(true)}>
              <IconUpload size={11}/> Upload Invoice
            </button>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile}/>
          </div>
        </div>

        {/* STATS BAR */}
        <div className="inv-wbar">
          <div style={{display:'flex',alignItems:'baseline'}}>
            <span className="inv-wname">Invoice Center</span>
            <span className="inv-wsub">· {invoices.length} invoices · {formatCurrencyWhole(totalSpend)} total</span>
          </div>
          <div className="inv-wactions">
            <div className="inv-waction-item">
              <div className="inv-waction-dot" style={{background:'var(--accent)'}}/>
              <span className="inv-waction-val" style={{color:'var(--accent)'}}>{formatCurrencyWhole(thisMonthSpend)}</span>
              <span>{new Date().toLocaleDateString('en-US',{month:'short'})} spend</span>
            </div>
            <div className="inv-waction-item">
              <div className="inv-waction-dot" style={{background:'var(--text-faint)'}}/>
              <span className="inv-waction-val" style={{color:'var(--text-muted)'}}>{formatCurrencyWhole(lastMonthSpend)}</span>
              <span>{new Date(new Date().getFullYear(),new Date().getMonth()-1,1).toLocaleDateString('en-US',{month:'short'})} spend</span>
            </div>
            {monthPct!==null&&(
              <div className="inv-waction-item">
                <div className="inv-waction-dot" style={{background:monthUp?'var(--color-red)':'var(--color-green)'}}/>
                <span className="inv-waction-val" style={{color:monthUp?'var(--color-red)':'var(--color-green)'}}>
                  {monthUp?'▲':'▼'} {Math.abs(monthPct)}%
                </span>
                <span>vs prior month</span>
              </div>
            )}
            <div className="inv-waction-item">
              <div className="inv-waction-dot" style={{background:'var(--color-amber)'}}/>
              <span className="inv-waction-val" style={{color:'var(--color-amber)'}}>{formatCurrencyWhole(avgInvoice)}</span>
              <span>avg invoice</span>
            </div>
          </div>
        </div>

        {confirmMsg&&(
          <div className="inv-confirm-banner">
            {confirmMsg}
            <button onClick={()=>setConfirmMsg('')} style={{background:'none',border:'none',color:'var(--color-green)',cursor:'pointer',fontSize:14}}>✕</button>
          </div>
        )}

        {loading?(
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
            <div style={{width:22,height:22,border:'2px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
            <div style={{fontSize:'clamp(10px,.78vw,13px)',color:'var(--text-muted)'}}>Loading invoices...</div>
          </div>
        ):(
          <div className="inv-split">

            {/* LEFT — Invoice List */}
            <div className="inv-list">
              <div className="inv-list-hd">
                <div className="inv-list-title">Invoices</div>
                <div className="inv-list-count">{filtered.length} result{filtered.length!==1?'s':''}</div>
              </div>
              <div className="inv-tbl-head">
                <div className="inv-th">Supplier</div>
                <div className="inv-th">Invoice No.</div>
                <div className="inv-th">Date</div>
                <div className="inv-th">Amount</div>
                <div className="inv-th">Status</div>
              </div>
              <div className="inv-tbl-body">
                {filtered.length===0?(
                  <div className="inv-empty-state">
                    <IconFile size={36}/>
                    <div style={{fontSize:'clamp(11px,.85vw,14px)',color:'var(--text-muted)',fontWeight:500}}>
                      {searchTerm?`No results for "${searchTerm}"`:'No invoices yet'}
                    </div>
                    {!searchTerm&&(
                      <button className="inv-upload-btn" onClick={()=>setShowParseModal(true)} style={{marginTop:4}}>
                        <IconUpload size={11}/> Upload First Invoice
                      </button>
                    )}
                  </div>
                ):filtered.map((invoice,idx)=>{
                  const {label,ok}=getStatus(invoice);
                  return (
                    <div key={invoice.id} className={`inv-row${selectedInvoice?.id===invoice.id?' selected':''}`}
                      style={{animationDelay:`${idx*.02}s`}}
                      onClick={()=>selectInvoice(invoice)}>
                      <div className="inv-td primary">{invoice.supplier||<span style={{color:'var(--text-faint)',fontStyle:'italic'}}>Unknown</span>}</div>
                      <div className="inv-td">{invoice.number||<span style={{color:'var(--text-faint)'}}>—</span>}</div>
                      <div className="inv-td">{invoice.date?formatDateShort(invoice.date):<span style={{color:'var(--text-faint)'}}>—</span>}</div>
                      <div className="inv-td amount">{invoice.amount?formatCurrency(invoice.amount):<span style={{color:'var(--text-faint)'}}>—</span>}</div>
                      <div><span className={`inv-pill ${ok?'ok':'pend'}`}>{label}</span></div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT — Detail / Overview */}
            <div className="inv-detail">
              <div className="inv-detail-hd">
                <div className="inv-detail-title">
                  {selectedInvoice?`${selectedInvoice.supplier||'Invoice'} · ${selectedInvoice.number||'—'}`:'Invoice Overview'}
                </div>
                {selectedInvoice
                  ?<span className={`inv-pill ${getStatus(selectedInvoice).ok?'ok':'pend'}`}>{getStatus(selectedInvoice).label}</span>
                  :<div style={{fontSize:'clamp(8px,.6vw,10px)',color:'var(--text-faint)'}}>Select an invoice for details</div>
                }
              </div>

              {/* OVERVIEW STATE */}
              {!selectedInvoice&&(
                <div className="inv-detail-body">

                  {/* Row 1 — Key Metrics horizontal pills */}
                  <div className="inv-widget">
                    <div className="inv-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Key Metrics</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'clamp(5px,.5vw,8px)'}}>
                      {[
                        {l:'Avg Invoice Size',  v:formatCurrencyWhole(avgInvoice),       c:'var(--text-primary)'},
                        {l:'Invoices This Month',v:invoicesThisMonthByDate,              c:'var(--text-primary)'},
                        {l:'Uploaded This Month',v:invoicesUploadedThisMonth,            c:'var(--text-muted)'},
                        {l:'Days Since Last',   v:daysSinceLast!==null?daysSinceLast:'—',c:daysSinceLast>7?'var(--color-amber)':'var(--color-green)'},
                        {l:'Largest Invoice',   v:formatCurrencyWhole(largest),          c:'var(--accent)'},
                      ].map(({l,v,c})=>(
                        <div key={l} style={{background:'var(--bg-surface)',border:'1px solid var(--border-subtle)',borderRadius:'clamp(4px,.3vw,6px)',padding:'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)'}}>
                          <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{l}</div>
                          <div style={{fontFamily:"'Inter',sans-serif",fontSize:'clamp(12px,1vw,16px)',fontWeight:700,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Row 2 — Recent Activity + Month over Month / Top Suppliers */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'clamp(5px,.5vw,8px)',flex:1,minHeight:0}}>

                    {/* Recent Activity — tall left */}
                    <div className="inv-widget" style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
                      <div className="inv-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Recent Activity</div>
                      <div style={{flex:1,overflowY:'auto'}}>
                        {invoices.slice(0,8).map(inv=>{
                          const {ok}=getStatus(inv);
                          return (
                            <div key={inv.id} className="inv-act-item" onClick={()=>selectInvoice(inv)}>
                              <div className="inv-act-dot" style={{background:ok?'var(--color-green)':'var(--color-amber)'}}/>
                              <div className="inv-act-text"><strong>{inv.number||'Invoice'}</strong>{inv.supplier?` · ${inv.supplier}`:''}</div>
                              {inv.amount&&<div className="inv-act-amount">{formatCurrencyWhole(inv.amount)}</div>}
                              <div className="inv-act-time">{timeAgo(inv.created_at)}</div>
                            </div>
                          );
                        })}
                        {invoices.length===0&&<div style={{fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-faint)'}}>No invoice activity yet</div>}
                      </div>
                    </div>

                    {/* Right column — Month over Month + Top Suppliers stacked */}
                    <div style={{display:'flex',flexDirection:'column',gap:'clamp(5px,.5vw,8px)',minHeight:0}}>

                      <div className="inv-widget">
                        <div className="inv-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Month over Month</div>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:8}}>
                          <div>
                            <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:3}}>
                              {new Date().toLocaleDateString('en-US',{month:'long'})}
                            </div>
                            <div style={{fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:'clamp(17px,1.5vw,24px)',color:'var(--accent)',lineHeight:1}}>
                              {formatCurrencyWhole(thisMonthSpend)}
                            </div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:'clamp(7px,.55vw,9px)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:3}}>
                              {new Date(new Date().getFullYear(),new Date().getMonth()-1,1).toLocaleDateString('en-US',{month:'long'})}
                            </div>
                            <div style={{fontFamily:"'Inter',sans-serif",fontWeight:600,fontSize:'clamp(13px,1.05vw,17px)',color:'var(--text-primary)',lineHeight:1}}>
                              {formatCurrencyWhole(lastMonthSpend)}
                            </div>
                          </div>
                        </div>
                        {monthPct!==null?(
                          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:'clamp(9px,.68vw,11px)',color:monthUp?'var(--color-red)':'var(--color-green)',fontWeight:600}}>
                            <span>{monthUp?'▲':'▼'}</span>
                            <span>{Math.abs(monthPct)}% {monthUp?'above':'below'} last month</span>
                          </div>
                        ):(
                          <div style={{fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-faint)'}}>No prior month data</div>
                        )}
                      </div>

                      <div className="inv-widget" style={{flex:1,display:'flex',flexDirection:'column'}}>
                        <div className="inv-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>Top Suppliers</div>
                        <div style={{flex:1,display:'flex',flexDirection:'column',gap:'clamp(6px,.6vh,9px)'}}>
                          {topSuppliers.length>0?topSuppliers.map(([name,amount],i)=>{
                            const colors=['var(--accent)','var(--color-amber)','var(--color-green)','var(--text-faint)'];
                            return (
                              <div key={name} className="inv-prog-row" style={{marginBottom:0}}>
                                <div className="inv-prog-label">{name}</div>
                                <div className="inv-prog-track"><div className="inv-prog-fill" style={{width:`${(amount/maxSupplier)*100}%`,background:colors[i]}}/></div>
                                <div className="inv-prog-val" style={{color:colors[i]}}>{formatCurrencyWhole(amount)}</div>
                              </div>
                            );
                          }):<div style={{fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-faint)'}}>No supplier data yet</div>}
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Row 3 — 12-Month Spend full width */}
                  <div className="inv-widget">
                    <div className="inv-wlbl"><div style={{width:6,height:6,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>12-Month Spend</div>
                    <div className="inv-mini-chart">
                      {monthlySpend.map(({month,total},idx)=>(
                        <div key={idx} className="inv-mc-col">
                          <div className="inv-mc-track">
                            <div className="inv-mc-bar" style={{height:`${Math.max(2,(total/maxMonthly)*90)}%`,background:getBarColor(total)}}/>
                          </div>
                          <div className="inv-mc-lbl">{month}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              )}

              {/* DETAIL STATE */}
              {selectedInvoice&&(
                <div className="inv-detail-body">
                  <div className="inv-dsection">
                    <div className="inv-dsection-title">Invoice Information</div>
                    <div className="inv-dgrid">
                      <div className="inv-dfield"><div className="inv-dfield-lbl">Invoice No.</div><div className="inv-dfield-val">{selectedInvoice.number||<span style={{color:'var(--text-faint)',fontStyle:'italic'}}>Pending</span>}</div></div>
                      <div className="inv-dfield"><div className="inv-dfield-lbl">Invoice Date</div><div className="inv-dfield-val">{selectedInvoice.date?formatDate(selectedInvoice.date):<span style={{color:'var(--text-faint)',fontStyle:'italic'}}>Pending</span>}</div></div>
                      <div className="inv-dfield"><div className="inv-dfield-lbl">Supplier</div><div className="inv-dfield-val">{selectedInvoice.supplier||<span style={{color:'var(--text-faint)',fontStyle:'italic'}}>Pending</span>}</div></div>
                      <div className="inv-dfield"><div className="inv-dfield-lbl">Upload Date</div><div className="inv-dfield-val">{formatDate(selectedInvoice.created_at)}</div></div>
                      <div className="inv-dfield">
                        <div className="inv-dfield-lbl">File</div>
                        {selectedInvoice.file_url
                          ?<a className="inv-dfield-val link" href={selectedInvoice.file_url} target="_blank" rel="noopener noreferrer">View File ↗</a>
                          :<div className="inv-dfield-val" style={{color:'var(--text-faint)',fontStyle:'italic'}}>No file</div>}
                      </div>
                      <div className="inv-dfield">
                        <div className="inv-dfield-lbl">Total Amount</div>
                        <div className="inv-dfield-val accent">{selectedInvoice.amount?formatCurrency(selectedInvoice.amount):<span style={{color:'var(--text-faint)',fontStyle:'italic',fontFamily:'Inter,sans-serif',fontSize:'13px'}}>Pending</span>}</div>
                      </div>
                    </div>
                  </div>

                  {loadingDetail?(
                    <div style={{display:'flex',alignItems:'center',gap:8,padding:'16px 0',color:'var(--text-muted)',fontSize:'clamp(10px,.75vw,12px)'}}>
                      <div style={{width:16,height:16,border:'2px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
                      Loading items...
                    </div>
                  ):invoiceItems.length>0?(
                    <div className="inv-dsection">
                      <div className="inv-dsection-title">Line Items ({invoiceItems.length})</div>
                      <div className="inv-items-head">
                        <div className="inv-ith">Item</div>
                        <div className="inv-ith">Qty</div>
                        <div className="inv-ith">Unit Cost</div>
                        <div className="inv-ith">Total</div>
                        <div className="inv-ith">Status</div>
                      </div>
                      {invoiceItems.map(item=>(
                        <div key={item.id} className="inv-item-row">
                          <div className="inv-itd name">{item.item_name||'—'}</div>
                          <div className="inv-itd">{item.quantity?`${item.quantity} ${item.unit||''}`.trim():'—'}</div>
                          <div className="inv-itd">{formatCurrency(item.unit_cost)}</div>
                          <div className="inv-itd val">{formatCurrency(calculateItemTotal(item))}</div>
                          <div>{item.ingredients?<span className="inv-linked">Linked</span>:<span className="inv-unlinked">Unlinked</span>}</div>
                        </div>
                      ))}
                      <div className="inv-total-bar">
                        <div className="inv-total-label">Calculated Total</div>
                        <div>
                          <div className="inv-total-val">{formatCurrency(totalCalculated)}</div>
                          {selectedInvoice.amount&&Math.abs(totalCalculated-parseFloat(selectedInvoice.amount))>0.01&&(
                            <div className="inv-diff">Diff: {formatCurrency(Math.abs(totalCalculated-parseFloat(selectedInvoice.amount)))}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ):(
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flex:1,gap:8}}>
                      <IconFile size={36}/>
                      <div style={{fontSize:'clamp(11px,.85vw,14px)',color:'var(--text-muted)',fontWeight:500}}>No line items recorded</div>
                    </div>
                  )}

                  <button
                    onClick={()=>{setSelectedInvoice(null);setInvoiceItems([]);router.replace('/client/invoices',undefined,{shallow:true});}}
                    style={{background:'none',border:'1px solid var(--border)',borderRadius:5,padding:'clamp(5px,.5vh,8px) clamp(10px,.9vw,14px)',fontSize:'clamp(9px,.68vw,11px)',color:'var(--text-muted)',cursor:'pointer',fontFamily:"'Inter',sans-serif",marginTop:'auto',alignSelf:'flex-start',transition:'color .15s'}}>
                    ← Back to overview
                  </button>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {showParseModal&&restaurantId&&(
        <ParseModal restaurantId={restaurantId} onClose={()=>setShowParseModal(false)} onSaved={handleInvoiceSaved}/>
      )}
      {tourProps&&<TourOverlay {...tourProps}/>}
      <TourDataBanner/>
    </>
  );
}