// pages/client/invoices.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
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

// ─── Image compression ────────────────────────────────────────────────────────
// Resizes images to max 1500px long edge, re-encodes as JPEG at 85% quality.
// PDFs pass through unchanged. Runs entirely client-side before upload.

async function compressImage(file) {
  if (file.type === 'application/pdf') return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1500;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg',
        0.85
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); }; // fallback: use original
    img.src = url;
  });
}

// ─── Merge key for grouping multi-page invoices ───────────────────────────────

function invoiceMergeKey(inv) {
  const supplier = (inv.supplier || 'unknown').toLowerCase().trim().replace(/\s+/g, '_');
  const number = (inv.invoice_number || '').trim();
  return number ? `${supplier}__${number}` : `${supplier}__${Date.now()}_${Math.random()}`;
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
  .inv-widget { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 7px; padding: clamp(7px,.7vw,10px); }
  .inv-wlbl { font-size: clamp(8px,.6vw,10px); font-weight: 700; color: var(--text-faint); text-transform: uppercase; letter-spacing: .9px; margin-bottom: clamp(5px,.5vh,8px); display: flex; align-items: center; gap: 5px; }
  .inv-mini-chart { display: flex; align-items: flex-end; gap: clamp(2px,.2vw,4px); height: clamp(120px,14vh,180px); }
  .inv-mc-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
  .inv-mc-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .inv-mc-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; transition: height .3s ease; }
  .inv-mc-lbl { font-size: clamp(7px,.52vw,9px); color: var(--text-faint); }
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
  .inv-item-row { border-bottom: 1px solid var(--border-subtle); align-items: center; }
  .inv-item-row:first-child { border-top: 1px solid var(--border); }
  .inv-item-row:last-child { border-radius: 0 0 6px 6px; border-bottom: none; }
  .inv-item-row:nth-child(odd) { background: var(--bg-elevated); }
  .inv-item-row:nth-child(even) { background: var(--bg-surface); }
  .inv-item-row:last-child { border-radius: 0 0 6px 6px; }
  .inv-item-row:nth-child(odd) { background: var(--bg-elevated); }
  .inv-item-row:nth-child(even) { background: var(--bg-surface); }
  .inv-itd { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); }
  .inv-itd.name { color: var(--text-primary); font-weight: 500; }
  .inv-itd.val { color: var(--accent); font-weight: 600; font-family: 'Inter', sans-serif; }
  .inv-linked { font-size: clamp(7px,.55vw,9px); padding: 1px 6px; border-radius: 8px; background: rgba(42,138,90,.12); color: var(--color-green); }
  .inv-unlinked { font-size: clamp(7px,.55vw,9px); padding: 1px 6px; border-radius: 8px; background: rgba(212,160,32,.1); color: var(--color-amber); }
  .inv-confirm-banner { margin: 0 clamp(6px,.6vw,10px); background: rgba(42,138,90,.1); border: 1px solid rgba(42,138,90,.25); border-radius: 6px; padding: 8px 14px; font-size: clamp(10px,.75vw,13px); color: var(--color-green); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .inv-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; gap: 10px; }

  /* ── PARSE MODAL ── */
  .pm-bg { position: fixed; inset: 0; background: rgba(0,0,0,.82); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
  .pm-modal { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; width: min(980px, 100%); max-height: 90vh; display: flex; flex-direction: column; animation: slideUp .2s ease; }
  .pm-hd { padding: clamp(14px,1.4vh,20px) clamp(16px,1.4vw,24px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .pm-title { font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(14px,1.2vw,18px); color: var(--text-primary); }
  .pm-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; line-height: 1; transition: color .15s; }
  .pm-close:hover { color: var(--text-primary); }
  .pm-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
  .pm-ft { padding: clamp(10px,1vh,16px) clamp(16px,1.4vw,24px); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-shrink: 0; }

  /* Drop zone */
  .pm-drop-wrap { padding: clamp(14px,1.4vh,22px) clamp(16px,1.4vw,24px); display: flex; flex-direction: column; gap: clamp(12px,1.2vh,20px); overflow-y: auto; flex: 1; }
  .pm-drop { border: 2px dashed var(--border); border-radius: 10px; padding: clamp(28px,4vh,48px) 20px; text-align: center; cursor: pointer; transition: border-color .2s, background .2s; }
  .pm-drop:hover, .pm-drop.over { border-color: var(--accent); background: rgba(2,164,186,.04); }
  .pm-drop-icon { width: 40px; height: 40px; stroke: var(--border); fill: none; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; margin: 0 auto 12px; }
  .pm-drop-title { font-size: clamp(12px,.95vw,15px); color: var(--text-primary); font-weight: 500; margin-bottom: 4px; }
  .pm-drop-sub { font-size: clamp(9px,.68vw,12px); color: var(--text-muted); margin-bottom: 14px; }
  .pm-browse { background: var(--accent); border: none; border-radius: 6px; padding: 8px 18px; font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; }

  /* File queue */
  .pm-file-queue { display: flex; flex-direction: column; gap: 6px; }
  .pm-file-item { display: flex; align-items: center; gap: 10px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 7px; padding: 8px 12px; }
  .pm-file-icon { width: 28px; height: 28px; border-radius: 5px; background: rgba(2,164,186,.1); border: 1px solid rgba(2,164,186,.2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .pm-file-name { flex: 1; font-size: clamp(10px,.75vw,12px); color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-file-size { font-size: clamp(8px,.6vw,10px); color: var(--text-muted); flex-shrink: 0; }
  .pm-file-remove { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; line-height: 1; padding: 2px; transition: color .15s; flex-shrink: 0; }
  .pm-file-remove:hover { color: var(--color-red); }

  /* Parsing / states */
  .pm-parsing { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 40px 20px; text-align: center; flex: 1; justify-content: center; }
  .pm-spin { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  .pm-parse-title { font-size: clamp(13px,1vw,16px); font-weight: 600; color: var(--text-primary); }
  .pm-parse-sub { font-size: clamp(10px,.75vw,13px); color: var(--text-muted); }

  /* Review layout: sidebar + detail */
  .pm-review { display: flex; flex: 1; overflow: hidden; }

  /* Left sidebar */
  .pm-sidebar { width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; background: var(--bg-elevated); }
  .pm-sidebar-hd { padding: 10px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .pm-sidebar-label { font-size: clamp(7px,.58vw,9px); font-weight: 700; color: var(--text-faint); text-transform: uppercase; letter-spacing: .9px; }
  .pm-sidebar-body { flex: 1; overflow-y: auto; padding: 6px; }
  .pm-sidebar-supplier { margin-bottom: 4px; }
  .pm-sidebar-supplier-name { font-size: clamp(8px,.62vw,10px); font-weight: 700; color: var(--text-faint); text-transform: uppercase; letter-spacing: .7px; padding: 6px 8px 3px; }
  .pm-sidebar-inv { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 6px; cursor: pointer; transition: background .12s; border: 1px solid transparent; margin-bottom: 2px; }
  .pm-sidebar-inv:hover { background: var(--bg-surface); }
  .pm-sidebar-inv.active { background: rgba(2,164,186,.08); border-color: rgba(2,164,186,.2); }
  .pm-sidebar-inv-num { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-sidebar-inv-badge { width: 16px; height: 16px; border-radius: 50%; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .pm-sidebar-inv-badge.warn { background: rgba(212,160,32,.15); color: var(--color-amber); }
  .pm-sidebar-inv-badge.ok { background: rgba(42,138,90,.12); color: var(--color-green); }

  /* Right detail panel */
  .pm-detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .pm-detail-body { flex: 1; overflow-y: auto; padding: clamp(12px,1.2vh,18px) clamp(14px,1.2vw,20px); display: flex; flex-direction: column; gap: clamp(10px,1vh,16px); }
  .pm-detail-body > * { flex-shrink: 0; }

  /* Invoice header card */
  .pm-inv-hd { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: clamp(10px,1vw,14px); flex-shrink: 0; }
  .pm-inv-hd-label { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; font-weight: 600; margin-bottom: 8px; }
  .pm-inv-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; }
  .pm-inv-field-lbl { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .pm-inv-field-val { font-size: clamp(11px,.85vw,13px); color: var(--text-primary); font-weight: 500; }
  .pm-inv-field-val.accent { color: var(--accent); font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(13px,1.1vw,17px); }
  .pm-conf-badge { display: inline-block; font-size: clamp(7px,.58vw,9px); padding: 1px 5px; border-radius: 4px; margin-left: 4px; }
  .pm-conf-high { background: rgba(2,164,186,.1); color: var(--accent); }
  .pm-conf-medium { background: rgba(2,164,186,.08); color: var(--text-muted); }
  .pm-conf-low { background: rgba(2,164,186,.06); color: var(--text-faint); }

  /* Format notes */
  .pm-format-note { font-size: clamp(8px,.62vw,10px); color: var(--text-faint); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); font-style: italic; }

  /* Summary pills */
  .pm-summary { display: flex; gap: 6px; flex-wrap: wrap; }
  .pm-sum-pill { display: flex; align-items: center; gap: 5px; font-size: clamp(9px,.68vw,11px); padding: 3px 9px; border-radius: 20px; font-weight: 500; }
  .pm-sum-auto { background: rgba(2,164,186,.08); color: var(--accent); border: 1px solid rgba(2,164,186,.15); }
  .pm-sum-ambig { background: rgba(2,164,186,.08); color: var(--accent); border: 1px solid rgba(2,164,186,.15); }
  .pm-sum-new { background: rgba(2,164,186,.08); color: var(--accent); border: 1px solid rgba(2,164,186,.15); }
  .pm-sum-warn { background: rgba(2,164,186,.08); color: var(--accent); border: 1px solid rgba(2,164,186,.15); }

  /* Section title */
  .pm-section-title { font-size: clamp(9px,.7vw,11px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
  .pm-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }

  /* Line item cards */
  .pm-line-item { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 5px; transition: border-color .15s; }
  .pm-line-item:last-child { margin-bottom: 0; }
  .pm-line-item.status-auto { border-left: 3px solid var(--accent); }
  .pm-line-item.status-ambiguous { border-left: 3px solid var(--accent); }
  .pm-line-item.status-new { border-left: 3px solid var(--accent); }
  .pm-line-item.dismissed { opacity: .4; }
  .pm-li-hd { display: grid; grid-template-columns: 1.6fr 0.7fr 0.7fr 0.7fr 0.8fr 0.8fr 130px; gap: 8px; padding: clamp(7px,.7vh,10px) clamp(10px,.9vw,14px); align-items: center; cursor: pointer; }
  .pm-li-hd:hover { background: rgba(255,255,255,.02); }
  .pm-li-name { font-size: clamp(10px,.78vw,12px); font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-li-meta { font-size: clamp(7px,.6vw,9px); color: var(--text-muted); margin-top: 1px; }
  .pm-li-cell { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); }
  .pm-li-cell.val { color: var(--accent); font-weight: 600; }
  .pm-li-status { display: flex; align-items: center; gap: 5px; font-size: clamp(8px,.62vw,10px); font-weight: 600; }
  .pm-li-hd input::placeholder { color: var(--text-faint) !important; font-size: clamp(9px,.68vw,11px); }
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }

  /* Candidate options */
  .pm-candidates { padding: clamp(8px,.8vh,12px) clamp(10px,.9vw,14px); border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 5px; }
  .pm-cand-title { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; font-weight: 600; margin-bottom: 4px; }
  .pm-cand-option { display: flex; align-items: flex-start; gap: 10px; padding: clamp(6px,.6vh,10px) clamp(10px,.9vw,14px); border: 1px solid var(--border); border-radius: 7px; cursor: pointer; transition: all .15s; background: var(--bg-surface); }
  .pm-cand-option:hover { border-color: var(--text-faint); background: var(--bg-elevated); }
  .pm-cand-option.selected { border-color: var(--accent); background: rgba(2,164,186,.06); }
  .pm-cand-radio { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
  .pm-cand-radio.checked { border-color: var(--accent); }
  .pm-cand-radio-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .pm-cand-name { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: var(--text-primary); }
  .pm-cand-unit { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); margin-top: 1px; }
  .pm-cand-dishes { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .pm-cand-dish-tag { font-size: clamp(7px,.58vw,9px); padding: 1px 6px; border-radius: 8px; background: rgba(2,164,186,.08); color: var(--accent); border: 1px solid rgba(2,164,186,.15); }
  .pm-cand-score { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); margin-left: auto; flex-shrink: 0; }

  /* New ingredient confirm */
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

  /* Buttons */
  .pm-btn-primary { background: var(--accent); border: none; border-radius: 6px; padding: clamp(8px,.8vh,11px) clamp(18px,1.6vw,26px); font-size: clamp(11px,.85vw,13px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; transition: background .2s; white-space: nowrap; }
  .pm-btn-primary:hover { background: #01bcd4; }
  .pm-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
  .pm-btn-secondary { background: none; border: 1px solid var(--border); border-radius: 6px; padding: clamp(8px,.8vh,11px) clamp(14px,1.2vw,18px); font-size: clamp(11px,.85vw,13px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .pm-btn-secondary:hover { color: var(--text-primary); border-color: var(--text-faint); }
  .pm-progress-text { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); }

  /* Success */
  .pm-success { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 20px; text-align: center; flex: 1; justify-content: center; }
  .pm-success-icon { width: 48px; height: 48px; border-radius: 50%; background: rgba(42,138,90,.12); border: 2px solid rgba(42,138,90,.3); display: flex; align-items: center; justify-content: center; }
  .pm-success-title { font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(16px,1.4vw,20px); color: var(--text-primary); }
  .pm-success-sub { font-size: clamp(10px,.75vw,13px); color: var(--text-muted); max-width: 380px; line-height: 1.6; }

  /* Duplicate warning */
  .pm-dup-warn { background: rgba(212,160,32,.08); border: 1px solid rgba(212,160,32,.25); border-radius: 7px; padding: 8px 12px; font-size: clamp(9px,.68vw,11px); color: var(--color-amber); display: flex; align-items: center; gap: 7px; }
`;

// ─── Icons ────────────────────────────────────────────────────────────────────

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
  { label: 'Dashboard',   path: '/client/dashboard',    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
  { label: 'Invoices',    path: '/client/invoices',     icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
  { label: 'Ingredients', path: '/client/ingredients',  icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
  { label: 'Menu',        path: '/client/menu-items',   icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  { label: 'Analytics',   path: '/client/analytics',    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
];

// ─── Line Item Card ───────────────────────────────────────────────────────────

function LineItemCard({ item, columns, expanded, onToggle, onSelectCandidate, onConfirmNew, onDismiss, onUpdateName, onEdit, mode = 'numbers' }) {
  const matchColor = getMatchColor(item.match_status);
  const matchLabel = getMatchLabel(item.match_status);
  const autoMatchName = item.match_status === 'auto' ? item.match_candidates?.[0]?.name : null;

  // Derived unit cost — always computed, never editable
  const orderedCases = item.quantity_shipped ?? item.quantity_ordered ?? 0;
  const unitsPerCase = (item.pack ?? 1) * (item.size ?? 1);
  const totalQty = orderedCases * unitsPerCase;
  const lineTotal = item.line_total ?? null;
  const unitCost = lineTotal && totalQty > 0
    ? Math.round((lineTotal / totalQty) * 10000) / 10000
    : null;
  const sizeUnit = item.size_unit || item.quantity_unit || '';

  function renderCell(col) {
    const val = item[col.key];

    if (col.key === 'unit_cost_derived') {
      return (
        <div key={col.key} className="pm-li-cell val">
          {unitCost ? `${formatCurrency(unitCost)}/${sizeUnit}` : '—'}
        </div>
      );
    }

    if (col.key === 'item_name_normalized') {
      return (
        <div key={col.key} style={{ minWidth: 0 }}>
          <div className="pm-li-name">{item.item_name_normalized || item.item_name_raw}</div>
          {item.item_name_raw && item.item_name_normalized && item.item_name_raw !== item.item_name_normalized &&
            <div className="pm-li-meta" style={{ color: 'var(--text-faint)' }}>Raw: {item.item_name_raw}</div>}
          {autoMatchName && <div className="pm-li-meta">→ {autoMatchName}</div>}
          {item.match_status === 'ambiguous' && item.selected_ingredient_id &&
            <div className="pm-li-meta" style={{ color: 'var(--color-green)' }}>→ {item.selected_ingredient_name}</div>}
          {item.match_status === 'new' && item.confirm_new &&
            <div className="pm-li-meta" style={{ color: 'var(--accent)' }}>→ Will create: {item.confirmed_name}</div>}
        </div>
      );
    }

    if (!col.editable) {
      return (
        <div key={col.key} className="pm-li-cell">
          {val ?? '—'}
        </div>
      );
    }

    // Editable cell — read-only in matches mode
    const isAmount = col.key === 'line_total';

    if (mode === 'matches') {
      return (
        <div key={col.key} className="pm-li-cell" style={{ color: isAmount ? 'var(--accent)' : 'var(--text-muted)' }}>
          {isAmount && val != null ? formatCurrency(val) : (val ?? '—')}
        </div>
      );
    }

    return (
      <div key={col.key} className="pm-li-cell val" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {isAmount && <span style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-muted)' }}>$</span>}
          <input
            type="text"
            inputMode={col.type === 'number' ? 'decimal' : 'text'}
            value={val != null ? String(val) : ''}
            placeholder="—"
            onChange={e => {
              const raw = col.type === 'number'
                ? e.target.value.replace(/[^0-9.]/g, '')
                : e.target.value;
              if (raw === '') {
                onEdit(item._id, { [col.key]: null });
                return;
              }
              // Store raw string while typing to preserve decimal point mid-entry
              if (col.type === 'number') {
                if (raw.endsWith('.') || raw.endsWith('.0') || raw.endsWith('.00')) {
                  onEdit(item._id, { [col.key]: raw });
                  return;
                }
                const parsed = parseFloat(raw);
                if (isNaN(parsed)) return;
                onEdit(item._id, { [col.key]: parsed });
              } else {
                onEdit(item._id, { [col.key]: raw });
              }
            }}
            style={{
              width: col.key === 'item_name_normalized'
                ? '100%'
                : col.type === 'number'
                ? 'clamp(36px,3.5vw,52px)'
                : 'clamp(60px,6vw,100px)',
              background: 'var(--bg-inset)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '2px 5px',
              fontSize: 'clamp(9px,.68vw,11px)',
              color: isAmount ? 'var(--accent)' : 'var(--text-primary)',
              fontFamily: 'Inter,sans-serif',
              textAlign: col.type === 'number' ? 'right' : 'left',
              outline: 'none',
            }}
          />
        </div>
      </div>
    );
  }

  // Build grid template from columns
  const gridTemplate = columns.map(col =>
    col.key === 'item_name_normalized' ? '1.8fr'
    : col.key === 'unit_cost_derived' ? '0.9fr'
    : col.key === 'line_total' ? '0.7fr'
    : '0.6fr'
  ).join(' ') + ' 130px';

  return (
    <div className={`pm-line-item status-${item.match_status}${item.dismissed ? ' dismissed' : ''}`}>
      <div
        className="pm-li-hd"
        onClick={mode === 'matches' && item.match_status !== 'auto' ? onToggle : undefined}
        style={{ cursor: mode === 'matches' && item.match_status !== 'auto' ? 'pointer' : 'default', gridTemplateColumns: gridTemplate }}
      >
        {columns.map(col => renderCell(col))}

        {/* Status always last */}
        <div className="pm-li-status">
          {mode === 'numbers' ? (
            <span className={`pm-conf-badge pm-conf-${item.confidence || 'medium'}`}>
              {item.confidence || 'medium'}
            </span>
          ) : (
            <>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: matchColor, flexShrink: 0 }} />
              <span style={{ color: matchColor }}>{matchLabel}</span>
              {item.confidence && item.confidence !== 'high' && (
                <span className={`pm-conf-badge pm-conf-${item.confidence}`}>{item.confidence}</span>
              )}
              {item.match_status !== 'auto' &&
                <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{expanded ? '▴' : '▾'}</span>}
            </>
          )}
        </div>
      </div>

      {mode === 'matches' && expanded && item.match_status === 'ambiguous' && (
        <div className="pm-candidates">
          <div className="pm-cand-title">Which ingredient is this?</div>
          {(item.match_candidates || []).map(candidate => {
            const isSelected = item.selected_ingredient_id === candidate.id;
            return (
              <div key={candidate.id} className={`pm-cand-option${isSelected ? ' selected' : ''}`}
                onClick={() => onSelectCandidate(item._id, candidate)}>
                <div className={`pm-cand-radio${isSelected ? ' checked' : ''}`}>
                  {isSelected && <div className="pm-cand-radio-dot" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pm-cand-name">{candidate.name}</div>
                  <div className="pm-cand-unit">{candidate.unit} · last price: {candidate.last_price ? formatCurrency(candidate.last_price) : 'not set'}</div>
                  {candidate.used_in?.length > 0 && (
                    <div className="pm-cand-dishes">
                      {candidate.used_in.slice(0, 4).map(dish => <span key={dish} className="pm-cand-dish-tag">{dish}</span>)}
                      {candidate.used_in.length > 4 && <span className="pm-cand-dish-tag">+{candidate.used_in.length - 4} more</span>}
                    </div>
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

      {mode === 'matches' && expanded && item.match_status === 'new' && (
        <div className="pm-new-confirm">
          <div className="pm-new-lbl">New ingredient — confirm to add to your inventory</div>
          <div>
            <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', marginBottom: 4 }}>Ingredient name</div>
            <input className="pm-new-name-input" value={item.confirmed_name || ''} onChange={e => onUpdateName(item._id, e.target.value)} placeholder="Ingredient name..." />
          </div>
          <div className="pm-new-actions">
            <button className={`pm-new-confirm-btn${item.confirm_new ? ' active' : ''}`} onClick={() => onConfirmNew(item._id, !item.confirm_new)}>
              {item.confirm_new ? '✓ Confirmed — will create' : 'Confirm & Create Ingredient'}
            </button>
            <button className="pm-dismiss-btn" onClick={() => onDismiss(item._id)}>Skip</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Parse Modal ──────────────────────────────────────────────────────────────

function ParseModal({ onClose, restaurantId, onSaved }) {
  const fileInputRef = useRef(null);
  const [step, setStep] = useState('drop'); // drop | parsing | review | saving | success | error
  const [dragOver, setDragOver] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState([]); // File[] staged for upload
  const [parseStage, setParseStage] = useState({ msg: '', sub: '' });

  // invoiceGroups: array of { key, invoice, lineItems, fileUrl, duplicate }
  const [invoiceGroups, setInvoiceGroups] = useState([]);
  const [activeGroupKey, setActiveGroupKey] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedResult, setSavedResult] = useState(null);
  const [reviewStep, setReviewStep] = useState('numbers');

  const PARSE_STAGES = [
    { msg: 'Compressing images...', sub: 'Optimizing files for upload' },
    { msg: 'Uploading invoices...', sub: 'Sending files to server' },
    { msg: 'Reading invoices with Claude...', sub: 'Scanning line items and pricing' },
    { msg: 'Matching to your inventory...', sub: 'Comparing against existing ingredients' },
    { msg: 'Almost done...', sub: 'Finalizing results' },
  ];

  // ── Derived: total pending count across all invoice groups ─────────────────
  const totalPending = invoiceGroups.reduce((sum, g) => {
    return sum + g.lineItems.filter(i =>
      !i.dismissed && (
        (i.match_status === 'ambiguous' && !i.selected_ingredient_id) ||
        (i.match_status === 'new' && !i.confirm_new)
      )
    ).length;
  }, 0);

  const canConfirmAll = totalPending === 0 && invoiceGroups.length > 0;

  const activeGroup = invoiceGroups.find(g => g.key === activeGroupKey) || invoiceGroups[0] || null;

  // ── Sidebar grouping: by supplier ─────────────────────────────────────────
  const sidebarGroups = (() => {
    const bySupplier = {};
    for (const g of invoiceGroups) {
      const s = g.invoice.supplier || 'Unknown Supplier';
      if (!bySupplier[s]) bySupplier[s] = [];
      bySupplier[s].push(g);
    }
    return Object.entries(bySupplier);
  })();

  // ── File queue management ─────────────────────────────────────────────────
  function addFiles(newFiles) {
    const arr = Array.from(newFiles).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext);
    });
    setQueuedFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...arr.filter(f => !names.has(f.name))];
    });
  }

  function removeFile(name) {
    setQueuedFiles(prev => prev.filter(f => f.name !== name));
  }

  function formatBytes(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  // ── Main parse flow ───────────────────────────────────────────────────────
  async function handleParse() {
    if (!queuedFiles.length) return;
    setStep('parsing');
    setReviewStep('numbers');
    setErrorMsg('');

    try {
      // Step 1: compress
      setParseStage(PARSE_STAGES[0]);
      const compressed = await Promise.all(queuedFiles.map(f => compressImage(f)));

      // Step 2: upload to Supabase storage in parallel
      setParseStage(PARSE_STAGES[1]);
      const uploadResults = await Promise.all(compressed.map(async (file) => {
        const filePath = `${restaurantId}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('invoices').upload(filePath, file);
        if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(filePath);
        return { file, publicUrl };
      }));

      // Step 3: parse each file
      setParseStage(PARSE_STAGES[2]);
      const parseResults = await Promise.all(uploadResults.map(async ({ file, publicUrl }) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('restaurant_id', restaurantId);
        formData.append('file_url', publicUrl);
        const res = await fetch('/api/invoices/parse-invoice', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || `Parse failed for ${file.name}`);
        return { data, publicUrl };
      }));

      // Step 4: match to inventory (already done server-side), group by supplier+invoice_number
      setParseStage(PARSE_STAGES[3]);

      const groupMap = {};
      for (const { data, publicUrl } of parseResults) {
        const key = invoiceMergeKey(data.invoice);
        if (!groupMap[key]) {       
          const DEFAULT_COLUMNS = [
            { key: 'item_name_normalized', label: 'Item', editable: true, type: 'text' },
            { key: 'quantity_shipped', label: 'Shipped', editable: true, type: 'number' },
            { key: 'quantity_unit', label: 'Unit', editable: false, type: 'text' },
            { key: 'pack', label: 'Pack', editable: true, type: 'number' },
            { key: 'size', label: 'Size', editable: true, type: 'number' },
            { key: 'size_unit', label: 'Unit', editable: false, type: 'text' },
            { key: 'line_total', label: 'Price', editable: true, type: 'number' },
            { key: 'unit_cost_derived', label: 'Unit Cost', editable: false, type: 'number' },
          ];

          groupMap[key] = {
            key,
            invoice: data.invoice,
            columns: data.invoice.columns?.length > 0 ? data.invoice.columns : DEFAULT_COLUMNS,
            fileUrl: publicUrl,
            duplicate: data.duplicate || false,
            lineItems: [],
          };
        }
        // Merge line items, avoiding duplicates by _id prefix collision
        const existingIds = new Set(groupMap[key].lineItems.map(i => i.item_name_raw));
        const newItems = (data.line_items || []).map((item, idx) => ({
          ...item,
          _id: `${key}_${groupMap[key].lineItems.length + idx}`,
          confirmed_name: item.item_name_normalized || item.item_name_raw || '',
          confirm_new: false,
          dismissed: false,
        })).filter(item => !existingIds.has(item.item_name_raw));
        groupMap[key].lineItems.push(...newItems);
      }

      setParseStage(PARSE_STAGES[4]);
      const groups = Object.values(groupMap);
      setInvoiceGroups(groups);
      setActiveGroupKey(groups[0]?.key || null);
      setStep('review');

    } catch (err) {
      setErrorMsg(err.message || 'Something went wrong');
      setStep('error');
    }
  }

  // ── Line item update helpers ──────────────────────────────────────────────
  function updateLineItem(groupKey, itemId, updates) {
    setInvoiceGroups(prev => prev.map(g => g.key !== groupKey ? g : {
      ...g,
      lineItems: g.lineItems.map(i => i._id !== itemId ? i : { ...i, ...updates }),
    }));
  }

  function selectCandidate(groupKey, itemId, candidate) {
    updateLineItem(groupKey, itemId, { selected_ingredient_id: candidate.id, selected_ingredient_name: candidate.name });
  }

  function confirmNew(groupKey, itemId, confirmed) {
    updateLineItem(groupKey, itemId, { confirm_new: confirmed });
  }

  function dismissItem(groupKey, itemId) {
    updateLineItem(groupKey, itemId, { dismissed: true });
  }

  function updateConfirmedName(groupKey, itemId, name) {
    updateLineItem(groupKey, itemId, { confirmed_name: name });
  }

  function restoreItem(groupKey, itemId) {
    updateLineItem(groupKey, itemId, { dismissed: false });
  }

  // ── Confirm all invoices ──────────────────────────────────────────────────
  async function handleConfirmAll() {
    setStep('saving');
    const aggregate = { items_saved: 0, ingredients_created: 0, ingredients_updated: 0, errors: [] };

    for (const group of invoiceGroups) {
      try {
        const res = await fetch('/api/invoices/confirm-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurant_id: restaurantId,
            invoice: group.invoice,
            line_items: group.lineItems,
            file_url: group.fileUrl,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
        aggregate.items_saved += data.items_saved || 0;
        aggregate.ingredients_created += data.ingredients_created || 0;
        aggregate.ingredients_updated += data.ingredients_updated || 0;
        if (data.errors?.length) aggregate.errors.push(...data.errors);
      } catch (err) {
        aggregate.errors.push(`${group.invoice.supplier || 'Invoice'}: ${err.message}`);
      }
    }

    setSavedResult(aggregate);
    setStep('success');
    onSaved();
  }

  // ── Confidence badge ──────────────────────────────────────────────────────
  function confBadgeClass(level) {
    if (level === 'high') return 'pm-conf-high';
    if (level === 'medium') return 'pm-conf-medium';
    return 'pm-conf-low';
  }

  // ── Per-group pending count for sidebar badge ─────────────────────────────
  function groupPendingCount(group) {
    return group.lineItems.filter(i =>
      !i.dismissed && (
        (i.match_status === 'ambiguous' && !i.selected_ingredient_id) ||
        (i.match_status === 'new' && !i.confirm_new)
      )
    ).length;
  }

  return (
    <div className="pm-bg">
      <div className="pm-modal">

        {/* Header */}
        <div className="pm-hd">
          <div className="pm-title">
            {step === 'drop' && 'Upload Invoices'}
            {step === 'parsing' && 'Analyzing Invoices...'}
            {step === 'review' && reviewStep === 'numbers' && `Step 1 of 2 — Review Numbers · ${invoiceGroups.length} invoice${invoiceGroups.length !== 1 ? 's' : ''}`}
            {step === 'review' && reviewStep === 'matches' && `Step 2 of 2 — Match Ingredients · ${invoiceGroups.length} invoice${invoiceGroups.length !== 1 ? 's' : ''}`}
            {step === 'saving' && 'Saving...'}
            {step === 'success' && 'Invoices Saved'}
            {step === 'error' && 'Something went wrong'}
          </div>
          {step !== 'saving' && <button className="pm-close" onClick={onClose}>✕</button>}
        </div>

        {/* Body */}
        <div className="pm-body">

          {/* ── DROP ── */}
          {step === 'drop' && (
            <div className="pm-drop-wrap">
              <div className={`pm-drop${dragOver ? ' over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                />
                <svg className="pm-drop-icon" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="12" y2="12"/>
                  <line x1="15" y1="15" x2="12" y2="12"/>
                </svg>
                <div className="pm-drop-title">Drag & drop invoices here</div>
                <div className="pm-drop-sub">
                  Upload multiple files at once — separate invoices or multi-page invoices.<br />
                  Supports PDF, JPG, PNG, WEBP. Pages from the same invoice are auto-merged.
                </div>
                <button className="pm-browse" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                  Browse Files
                </button>
              </div>

              {queuedFiles.length > 0 && (
                <div className="pm-file-queue">
                  <div className="pm-section-title">{queuedFiles.length} file{queuedFiles.length !== 1 ? 's' : ''} queued</div>
                  {queuedFiles.map(f => (
                    <div key={f.name} className="pm-file-item">
                      <div className="pm-file-icon">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                      </div>
                      <div className="pm-file-name">{f.name}</div>
                      <div className="pm-file-size">{formatBytes(f.size)}</div>
                      <button className="pm-file-remove" onClick={() => removeFile(f.name)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PARSING ── */}
          {step === 'parsing' && (
            <div className="pm-parsing">
              <div className="pm-spin" />
              <div className="pm-parse-title">{parseStage.msg}</div>
              <div className="pm-parse-sub">{parseStage.sub}</div>
              <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                {PARSE_STAGES.map((s, i) => (
                  <div key={i} style={{
                    width: s.msg === parseStage.msg ? 16 : 5,
                    height: 5, borderRadius: 3,
                    background: PARSE_STAGES.indexOf(parseStage) >= i ? 'var(--accent)' : 'var(--border)',
                    transition: 'all .4s ease',
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* ── SAVING ── */}
          {step === 'saving' && (
            <div className="pm-parsing">
              <div className="pm-spin" />
              <div className="pm-parse-title">Saving invoices...</div>
              <div className="pm-parse-sub">Updating invoice records and ingredient prices</div>
            </div>
          )}

          {/* ── SUCCESS ── */}
          {step === 'success' && savedResult && (
            <div className="pm-success">
              <div className="pm-success-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div className="pm-success-title">
                {invoiceGroups.length} invoice{invoiceGroups.length !== 1 ? 's' : ''} saved successfully
              </div>
              <div className="pm-success-sub">
                {savedResult.items_saved} line item{savedResult.items_saved !== 1 ? 's' : ''} saved
                {savedResult.ingredients_created > 0 && ` · ${savedResult.ingredients_created} new ingredient${savedResult.ingredients_created !== 1 ? 's' : ''} created`}
                {savedResult.ingredients_updated > 0 && ` · ${savedResult.ingredients_updated} price${savedResult.ingredients_updated !== 1 ? 's' : ''} updated`}
                {savedResult.errors?.length > 0 && (
                  <div style={{ color: 'var(--color-amber)', marginTop: 8 }}>
                    {savedResult.errors.length} error{savedResult.errors.length !== 1 ? 's' : ''} — some items may not have saved correctly.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === 'error' && (
            <div className="pm-parsing">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-red)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div className="pm-parse-title" style={{ color: 'var(--color-red)' }}>Parse failed</div>
              <div className="pm-parse-sub">{errorMsg}</div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {step === 'review' && (
            <div className="pm-review">

              {/* Left sidebar */}
              <div className="pm-sidebar">
                <div className="pm-sidebar-hd">
                  <div className="pm-sidebar-label">Invoices</div>
                </div>
                <div className="pm-sidebar-body">
                  {sidebarGroups.map(([supplier, groups]) => (
                    <div key={supplier} className="pm-sidebar-supplier">
                      <div className="pm-sidebar-supplier-name">{supplier}</div>
                      {groups.map(g => {
                        const pending = groupPendingCount(g);
                        const isActive = g.key === activeGroupKey;
                        return (
                          <div
                            key={g.key}
                            className={`pm-sidebar-inv${isActive ? ' active' : ''}`}
                            onClick={() => setActiveGroupKey(g.key)}
                          >
                            <div className="pm-sidebar-inv-num">
                              {g.invoice.invoice_number || 'No number'}
                            </div>
                            <div className={`pm-sidebar-inv-badge ${reviewStep === 'matches' && pending > 0 ? 'warn' : 'ok'}`}>
                              {reviewStep === 'matches' && pending > 0 ? pending : '✓'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right detail panel */}
              <div className="pm-detail">
                {activeGroup ? (
                  <div className="pm-detail-body">

                    {/* Duplicate warning */}
                    {activeGroup.duplicate && (
                      <div className="pm-dup-warn">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        This invoice number was already uploaded on {formatDateShort(activeGroup.duplicate.existing_date)}. Saving will update ingredient prices.
                      </div>
                    )}

                    {/* Invoice header */}
                    <div className="pm-inv-hd">
                      <div className="pm-inv-hd-label">Invoice Details</div>
                      <div className="pm-inv-grid">
                        {[
                          { l: 'Supplier', v: activeGroup.invoice.supplier, conf: activeGroup.invoice.confidence?.supplier },
                          { l: 'Invoice #', v: activeGroup.invoice.invoice_number, conf: activeGroup.invoice.confidence?.invoice_number },
                          { l: 'Date', v: activeGroup.invoice.invoice_date ? formatDateShort(activeGroup.invoice.invoice_date) : null, conf: activeGroup.invoice.confidence?.invoice_date },
                          { l: 'Total', v: activeGroup.invoice.total_amount ? formatCurrency(activeGroup.invoice.total_amount) : null, conf: activeGroup.invoice.confidence?.total_amount, accent: true },
                        ].map(({ l, v, conf, accent }) => (
                          <div key={l}>
                            <div className="pm-inv-field-lbl">
                              {l}
                              {conf && <span className={`pm-conf-badge ${confBadgeClass(conf)}`}>{conf}</span>}
                            </div>
                            <div className={`pm-inv-field-val${accent ? ' accent' : ''}`}>
                              {v || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not found</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {activeGroup.invoice.format_notes && (
                        <div className="pm-format-note">📋 {activeGroup.invoice.format_notes}</div>
                      )}
                    </div>

                    {/* ── STEP 1: NUMBERS ── */}
                    {reviewStep === 'numbers' && (
                      <>
                        {/* Column header */}
                        {activeGroup.columns?.length > 0 && (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: activeGroup.columns.map(col =>
                              col.key === 'item_name_normalized' ? '1.8fr'
                              : col.key === 'unit_cost_derived' ? '0.9fr'
                              : col.key === 'line_total' ? '0.7fr'
                              : '0.6fr'
                            ).join(' ') + ' 130px',
                            gap: 8,
                            padding: 'clamp(4px,.4vh,6px) clamp(10px,.9vw,14px)',
                            marginBottom: 4,
                          }}>
                            {activeGroup.columns.map(col => (
                              <div key={col.key} style={{ fontSize: 'clamp(7px,.58vw,9px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
                                {col.label}
                              </div>
                            ))}
                            <div style={{ fontSize: 'clamp(7px,.58vw,9px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
                              Confidence
                            </div>
                          </div>
                        )}

                        {/* Summary of skipped items */}
                        {(() => {
                          const skipped = activeGroup.lineItems.filter(i => i.skip_number_review && !i.dismissed).length;
                          const needsReview = activeGroup.lineItems.filter(i => !i.skip_number_review && !i.dismissed).length;
                          return (
                            <div className="pm-summary">
                              {needsReview > 0 && <div className="pm-sum-pill pm-sum-ambig">⚠ {needsReview} need number review</div>}
                              {skipped > 0 && <div className="pm-sum-pill pm-sum-auto">✓ {skipped} high confidence — skipped</div>}
                            </div>
                          );
                        })()}

                        {/* Only medium/low confidence items — editable */}
                        {activeGroup.lineItems.filter(i => !i.skip_number_review && !i.dismissed).map(item => (
                          <LineItemCard
                            key={item._id}
                            item={item}
                            columns={activeGroup.columns || []}
                            mode="numbers"
                            expanded={false}
                            onToggle={() => {}}
                            onSelectCandidate={() => {}}
                            onConfirmNew={() => {}}
                            onDismiss={() => dismissItem(activeGroup.key, item._id)}
                            onUpdateName={() => {}}
                            onEdit={(itemId, updates) => updateLineItem(activeGroup.key, itemId, updates)}
                          />
                        ))}

                        {/* Empty state — all items high confidence */}
                        {activeGroup.lineItems.filter(i => !i.skip_number_review && !i.dismissed).length === 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', gap: 10 }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <div style={{ fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-primary)', fontWeight: 500 }}>All items parsed with high confidence</div>
                            <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>Proceed to match ingredients</div>
                          </div>
                        )}

                        {/* Dismissed */}
                        {activeGroup.lineItems.some(i => i.dismissed) && (
                          <>
                            <div className="pm-section-title" style={{ marginTop: 8 }}>Dismissed</div>
                            {activeGroup.lineItems.filter(i => i.dismissed).map(item => (
                              <div key={item._id} className="pm-line-item dismissed"
                                style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>
                                  {item.item_name_normalized || item.item_name_raw}
                                </div>
                                <button onClick={() => restoreItem(activeGroup.key, item._id)}
                                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'clamp(8px,.62vw,10px)', fontFamily: 'Inter, sans-serif' }}>
                                  Restore
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    )}

                    {/* ── STEP 2: MATCHES ── */}
                    {reviewStep === 'matches' && (
                      <>
                        {/* Summary pills */}
                        {(() => {
                          const items = activeGroup.lineItems;
                          const autoCount = items.filter(i => i.match_status === 'auto' && !i.dismissed).length;
                          const ambigCount = items.filter(i => i.match_status === 'ambiguous' && !i.dismissed).length;
                          const newCount = items.filter(i => i.match_status === 'new' && !i.dismissed).length;
                          const noCostCount = items.filter(i => i.needs_cost_input && !i.dismissed).length;
                          const numberCleared = items.filter(i => i.skip_number_review && !i.dismissed).length;
                          return (
                            <div className="pm-summary">
                              {autoCount > 0 && <div className="pm-sum-pill pm-sum-auto">✓ {autoCount} auto-matched</div>}
                              {numberCleared > 0 && <div className="pm-sum-pill pm-sum-auto">✓ {numberCleared} numbers cleared</div>}
                              {ambigCount > 0 && <div className="pm-sum-pill pm-sum-ambig">! {ambigCount} need review</div>}
                              {newCount > 0 && <div className="pm-sum-pill pm-sum-new">+ {newCount} new</div>}
                              {noCostCount > 0 && <div className="pm-sum-pill pm-sum-warn">⚠ {noCostCount} missing cost</div>}
                            </div>
                          );
                        })()}

                        {/* Needs review */}
                        {activeGroup.lineItems.some(i => i.match_status !== 'auto' && !i.dismissed) && (
                          <>
                            <div className="pm-section-title">Needs Your Review</div>
                            {activeGroup.columns?.length > 0 && (
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: activeGroup.columns.map(col =>
                                  col.key === 'item_name_normalized' ? '1.8fr'
                                  : col.key === 'unit_cost_derived' ? '0.9fr'
                                  : col.key === 'line_total' ? '0.7fr'
                                  : '0.6fr'
                                ).join(' ') + ' 130px',
                                gap: 8,
                                padding: 'clamp(4px,.4vh,6px) clamp(10px,.9vw,14px)',
                                marginBottom: 4,
                              }}>
                                {activeGroup.columns.map(col => (
                                  <div key={col.key} style={{ fontSize: 'clamp(7px,.58vw,9px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
                                    {col.label}
                                  </div>
                                ))}
                                <div style={{ fontSize: 'clamp(7px,.58vw,9px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
                                  Status
                                </div>
                              </div>
                            )}
                            {activeGroup.lineItems.filter(i => i.match_status !== 'auto' && !i.dismissed).map(item => (
                              <LineItemCard
                                key={item._id}
                                item={item}
                                columns={activeGroup.columns || []}
                                mode="matches"
                                expanded={activeGroup._expandedId === item._id}
                                onToggle={() => setInvoiceGroups(prev => prev.map(g => g.key !== activeGroup.key ? g : {
                                  ...g, _expandedId: g._expandedId === item._id ? null : item._id,
                                }))}
                                onSelectCandidate={(_, cand) => selectCandidate(activeGroup.key, item._id, cand)}
                                onConfirmNew={(_, confirmed) => confirmNew(activeGroup.key, item._id, confirmed)}
                                onDismiss={() => dismissItem(activeGroup.key, item._id)}
                                onUpdateName={(_, name) => updateConfirmedName(activeGroup.key, item._id, name)}
                                onEdit={(itemId, updates) => updateLineItem(activeGroup.key, itemId, updates)}
                              />
                            ))}
                          </>
                        )}

                        {/* Dismissed */}
                        {activeGroup.lineItems.some(i => i.dismissed) && (
                          <>
                            <div className="pm-section-title" style={{ marginTop: 8 }}>Dismissed</div>
                            {activeGroup.lineItems.filter(i => i.dismissed).map(item => (
                              <div key={item._id} className="pm-line-item dismissed"
                                style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>
                                  {item.item_name_normalized || item.item_name_raw}
                                </div>
                                <button onClick={() => restoreItem(activeGroup.key, item._id)}
                                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'clamp(8px,.62vw,10px)', fontFamily: 'Inter, sans-serif' }}>
                                  Restore
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    )}

                  </div>
                ) : (
                  <div className="pm-parsing">
                    <div style={{ fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-muted)' }}>Select an invoice from the sidebar</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pm-ft">
          {step === 'drop' && (
            <>
              <div className="pm-progress-text">
                {queuedFiles.length === 0
                  ? 'Files are processed immediately — nothing is saved until you confirm.'
                  : `${queuedFiles.length} file${queuedFiles.length !== 1 ? 's' : ''} ready — pages from the same invoice are auto-merged.`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="pm-btn-secondary" onClick={onClose}>Cancel</button>
                <button className="pm-btn-primary" disabled={queuedFiles.length === 0} onClick={handleParse}>
                  Analyze {queuedFiles.length > 0 ? `${queuedFiles.length} ` : ''}Invoice{queuedFiles.length !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}
          {step === 'review' && reviewStep === 'numbers' && (
            <>
              <div className="pm-progress-text">
                Verify quantities and prices before matching to your ingredient library.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="pm-btn-secondary" onClick={onClose}>Cancel</button>
                <button className="pm-btn-primary" onClick={() => setReviewStep('matches')}>
                  Review Matches →
                </button>
              </div>
            </>
          )}
          {step === 'review' && reviewStep === 'matches' && (
            <>
              <div className="pm-progress-text">
                {totalPending > 0
                  ? `${totalPending} item${totalPending !== 1 ? 's' : ''} still need review across ${invoiceGroups.length} invoice${invoiceGroups.length !== 1 ? 's' : ''}`
                  : `All items resolved — ready to save ${invoiceGroups.length} invoice${invoiceGroups.length !== 1 ? 's' : ''}`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="pm-btn-secondary" onClick={() => setReviewStep('numbers')}>← Back to Numbers</button>
                <button className="pm-btn-primary" disabled={!canConfirmAll} onClick={handleConfirmAll}>
                  Confirm & Save All
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
              <button className="pm-btn-secondary" onClick={() => { setStep('drop'); setQueuedFiles([]); }}>Try Again</button>
              <button className="pm-btn-secondary" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
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
  const [mobTab, setMobTab] = useState('invoices');
  const [showRawNames, setShowRawNames] = useState(false);

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];
  const isTour = router.query.tour === 'true';

  useEffect(() => { init(); }, []);
  useEffect(() => { if (restaurantId && !isTour) fetchInvoices(); }, [restaurantId]);
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
    fetchSampleData().then(sample => { if (!sample) return; setInvoices(sample.invoices); setLoading(false); });
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
    const { data } = await supabase.from('invoices').select('*').eq('restaurant_id', restaurantId).order('date', { ascending: false, nullsFirst: false });
    setInvoices(data || []);
    setLoading(false);
    const { selected } = router.query;
    if (selected && data) { const found = data.find(i => i.id === selected); if (found) selectInvoice(found); }
  }

  async function selectInvoice(invoice) {
    setSelectedInvoice(invoice);
    setLoadingDetail(true);
    if (!isMobile) router.replace(`/client/invoices?selected=${invoice.id}`, undefined, { shallow: true });
    const { data } = await supabase.from('invoice_items').select('*, ingredients(name, unit)').eq('invoice_id', invoice.id).order('item_name');
    setInvoiceItems(data || []);
    setLoadingDetail(false);
  }

  function handleInvoiceSaved() {
    fetchInvoices();
    setConfirmMsg('Invoices parsed and saved successfully.');
    setTimeout(() => setConfirmMsg(''), 5000);
  }

  // ── Derived stats ──
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const totalSpend = invoices.reduce((s, i) => s + (Math.round(parseFloat(i.amount || 0) * 100) / 100), 0);
  const thisMonthSpend = invoices.filter(i => { if (!i.date) return false; const [y, m] = i.date.split('T')[0].split('-').map(Number); return y === currentYear && m - 1 === currentMonth; }).reduce((s, i) => s + (Math.round(parseFloat(i.amount || 0) * 100) / 100), 0);
  const avgInvoice = invoices.length > 0 ? totalSpend / invoices.length : 0;
  const largest = invoices.length > 0 ? Math.max(...invoices.map(i => parseFloat(i.amount || 0))) : 0;
  const lastInvoice = invoices[0];
  const daysSinceLast = lastInvoice?.date ? (() => { const [y, m, d] = lastInvoice.date.split('T')[0].split('-').map(Number); return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000); })() : null;
  const invoicesThisMonthByDate = invoices.filter(i => { if (!i.date) return false; const [y, m] = i.date.split('T')[0].split('-').map(Number); return y === currentYear && m - 1 === currentMonth; }).length;
  const invoicesUploadedThisMonth = invoices.filter(i => { if (!i.created_at) return false; const d = new Date(i.created_at); return d.getFullYear() === currentYear && d.getMonth() === currentMonth; }).length;
  const supplierMap = {};
  invoices.forEach(i => { if (i.supplier) { const key = i.supplier.trim(); supplierMap[key] = Math.round(((supplierMap[key] || 0) + (Math.round(parseFloat(i.amount || 0) * 100) / 100)) * 100) / 100; } });
  const topSuppliers = Object.entries(supplierMap).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxSupplier = topSuppliers[0]?.[1] || 1;
  const monthlySpend = Array.from({ length: 12 }, (_, i) => { const d = new Date(currentYear, currentMonth - 11 + i, 1); const yr = d.getFullYear(); const mo = d.getMonth(); const total = invoices.filter(inv => { if (!inv.date) return false; const [y, m] = inv.date.split('T')[0].split('-').map(Number); return y === yr && (m - 1) === mo; }).reduce((s, inv) => s + (Math.round(parseFloat(inv.amount || 0) * 100) / 100), 0); return { month: d.toLocaleDateString('en-US', { month: 'short' }).slice(0, 1), total }; });
  const maxMonthly = Math.max(...monthlySpend.map(m => m.total), 1);
  const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const lastMonthSpend = invoices.filter(inv => { if (!inv.date) return false; const [y, m] = inv.date.split('T')[0].split('-').map(Number); return y === lastMonthDate.getFullYear() && (m - 1) === lastMonthDate.getMonth(); }).reduce((s, inv) => s + (Math.round(parseFloat(inv.amount || 0) * 100) / 100), 0);
  const monthDelta = thisMonthSpend - lastMonthSpend;
  const monthPct = lastMonthSpend > 0 ? Math.round((monthDelta / lastMonthSpend) * 100) : null;
  const monthUp = monthDelta >= 0;
  const filtered = invoices.filter(i => { const s = searchTerm.toLowerCase(); return (i.number || '').toLowerCase().includes(s) || (i.supplier || '').toLowerCase().includes(s); });
  const totalCalculated = invoiceItems.reduce((s, i) => s + calculateItemTotal(i), 0);

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────
  if (isMobile) {
    const MOB_TABS = [
      { id: 'invoices', label: 'Invoices', badge: filtered.length },
      { id: 'overview', label: 'Overview' },
      { id: 'suppliers', label: 'Suppliers' },
      { id: 'spending', label: 'Spending' },
    ];

    return (
      <>
        <Head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></Head>
        <style>{CSS}</style>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
          .mob2-root { font-family:'Inter',sans-serif; background:var(--bg-root); color:var(--text-primary); width:100%; height:100dvh; display:flex; flex-direction:column; overflow:hidden; }
          .mob2-header { background:var(--bg-elevated); border-bottom:1px solid var(--border); padding:10px 16px; padding-top:max(10px,env(safe-area-inset-top)); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
          .mob2-logo { font-family:'Inter',sans-serif; font-size:18px; font-weight:700; color:var(--text-primary); letter-spacing:-.3px; }
          .mob2-logo span { color:var(--accent); }
          .mob2-subbar { background:var(--bg-surface); border-bottom:1px solid var(--border); padding:10px 16px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
          .mob2-tabs { background:var(--bg-elevated); border-bottom:1px solid var(--border); display:flex; overflow-x:auto; flex-shrink:0; -webkit-overflow-scrolling:touch; }
          .mob2-tabs::-webkit-scrollbar { display:none; }
          .mob2-tab { flex-shrink:0; padding:10px 14px; font-size:12px; font-weight:500; color:var(--text-muted); border:none; background:none; cursor:pointer; font-family:'Inter',sans-serif; border-bottom:2px solid transparent; white-space:nowrap; -webkit-tap-highlight-color:transparent; display:flex; align-items:center; gap:5px; }
          .mob2-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
          .mob2-tab-badge { background:var(--accent); color:#0a0908; font-size:9px; font-weight:700; border-radius:8px; padding:1px 5px; }
          .mob2-search { padding:10px 16px; background:var(--bg-root); border-bottom:1px solid var(--border); flex-shrink:0; }
          .mob2-search-input { width:100%; background:var(--bg-surface); border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:14px; color:var(--text-primary); outline:none; font-family:'Inter',sans-serif; }
          .mob2-scroll { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
          .mob2-scroll::-webkit-scrollbar { display:none; }
          .mob2-content { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; }
          .mob2-content::-webkit-scrollbar { display:none; }
          .mob2-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:10px; padding:14px; flex-shrink:0; }
          .mob2-card-title { font-size:11px; font-weight:600; color:var(--text-primary); text-transform:uppercase; letter-spacing:.7px; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
          .mob2-card-title svg { width:12px; height:12px; stroke:var(--accent); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
          .mob2-inv-row { display:flex; align-items:center; padding:13px 16px; border-bottom:1px solid var(--border-subtle); cursor:pointer; gap:12px; border-left:3px solid transparent; -webkit-tap-highlight-color:transparent; }
          .mob2-inv-row.selected { background:rgba(2,164,186,.07); border-left-color:var(--accent); }
          .mob2-bottom-nav { background:var(--bg-elevated); border-top:1px solid var(--border); padding:8px 0 0; padding-bottom:env(safe-area-inset-bottom,8px); display:flex; flex-shrink:0; position:sticky; bottom:0; z-index:50; }
          .mob2-nav-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; padding:4px 0; -webkit-tap-highlight-color:transparent; }
          .mob2-nav-icon svg { width:20px; height:20px; stroke:var(--text-muted); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
          .mob2-nav-icon.active svg { stroke:var(--accent); }
          .mob2-nav-label { font-size:10px; color:var(--text-muted); }
          .mob2-nav-label.active { color:var(--accent); }
          .mob2-detail-overlay { position:fixed; inset:0; background:var(--bg-root); display:flex; flex-direction:column; z-index:30; overflow:hidden; }
          .mob2-detail-hd { background:var(--bg-elevated); border-bottom:1px solid var(--border); padding:12px 16px; padding-top:max(12px,env(safe-area-inset-top)); display:flex; align-items:center; gap:12px; flex-shrink:0; }
          .mob2-detail-body { flex:1; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px; padding-bottom:max(24px,env(safe-area-inset-bottom)); }
          .mob2-detail-body::-webkit-scrollbar { display:none; }
        `}</style>

        <div className="mob2-root">
          <div className="mob2-header">
            <div className="mob2-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setShowParseModal(true)}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '7px 13px', fontSize: 12, fontWeight: 600, color: '#0a0908', cursor: 'pointer', fontFamily: 'Inter,sans-serif', display: 'flex', alignItems: 'center', gap: 5 }}>
                <IconUpload size={10} /> Upload
              </button>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
            </div>
          </div>

          <div className="mob2-subbar">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Invoice Center</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{invoices.length} invoices · {formatCurrencyShort(totalSpend)} total</div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5 }}>This Month</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{formatCurrencyShort(thisMonthSpend)}</div>
              </div>
              {monthPct !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5 }}>vs Last Mo</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: monthUp ? 'var(--color-red)' : 'var(--color-green)' }}>{monthUp ? '▲' : '▼'}{Math.abs(monthPct)}%</div>
                </div>
              )}
            </div>
          </div>

          <div className="mob2-tabs">
            {MOB_TABS.map(t => (
              <button key={t.id} className={`mob2-tab${mobTab === t.id ? ' active' : ''}`} onClick={() => setMobTab(t.id)}>
                {t.label}
                {t.badge !== undefined && <span className="mob2-tab-badge">{t.badge}</span>}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading invoices...</div>
            </div>
          ) : (
            <>
              {mobTab === 'invoices' && (
                <>
                  <div className="mob2-search">
                    <input className="mob2-search-input" placeholder="Search supplier or invoice number..."
                      value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  </div>
                  <div className="mob2-scroll">
                    {filtered.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
                        <IconFile size={36} />
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No invoices yet'}</div>
                        {!searchTerm && (
                          <button onClick={() => setShowParseModal(true)}
                            style={{ background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, color: '#0a0908', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                            Upload First Invoice
                          </button>
                        )}
                      </div>
                    ) : filtered.map(invoice => {
                      const { ok } = getStatus(invoice);
                      return (
                        <div key={invoice.id} className={`mob2-inv-row${selectedInvoice?.id === invoice.id ? ' selected' : ''}`}
                          onClick={() => selectInvoice(invoice)}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? 'var(--color-green)' : 'var(--color-amber)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invoice.supplier || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Unknown supplier</span>}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{invoice.number || '—'} · {invoice.date ? formatDateShort(invoice.date) : '—'}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{invoice.amount ? formatCurrencyShort(invoice.amount) : '—'}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{timeAgo(invoice.created_at)}</div>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>›</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {mobTab === 'overview' && (
                <div className="mob2-content">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { l: 'Total Spend', v: formatCurrencyShort(totalSpend), c: 'var(--accent)' },
                      { l: 'Avg Invoice', v: formatCurrencyShort(avgInvoice), c: 'var(--text-primary)' },
                      { l: 'Largest Invoice', v: formatCurrencyShort(largest), c: 'var(--color-amber)' },
                      { l: 'Days Since Last', v: daysSinceLast !== null ? daysSinceLast : '—', c: daysSinceLast > 7 ? 'var(--color-amber)' : 'var(--color-green)' },
                    ].map(({ l, v, c }) => (
                      <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>{l}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: c, lineHeight: 1 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ height: 8 }} />
                </div>
              )}

              {mobTab === 'suppliers' && (
                <div className="mob2-content">
                  <div className="mob2-card">
                    <div className="mob2-card-title">Top Suppliers</div>
                    {topSuppliers.length > 0 ? topSuppliers.map(([name, amount], i) => {
                      const colors = ['var(--accent)', 'var(--color-amber)', 'var(--color-green)', 'var(--text-faint)'];
                      return (
                        <div key={name} style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{name}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: colors[i] }}>{formatCurrencyShort(amount)}</div>
                          </div>
                          <div style={{ height: 5, background: 'var(--border-subtle)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(amount / maxSupplier) * 100}%`, height: '100%', background: colors[i], borderRadius: 3 }} />
                          </div>
                        </div>
                      );
                    }) : <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No supplier data yet</div>}
                  </div>
                  <div style={{ height: 8 }} />
                </div>
              )}

              {mobTab === 'spending' && (
                <div className="mob2-content">
                  <div className="mob2-card">
                    <div className="mob2-card-title">12-Month Spend</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
                      {monthlySpend.map(({ month, total }, idx) => (
                        <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%' }}>
                          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                            <div style={{ width: '100%', height: `${Math.max(2, (total / maxMonthly) * 90)}%`, background: getBarColor(total), borderRadius: '2px 2px 0 0', minHeight: 2 }} />
                          </div>
                          <div style={{ fontSize: 8, color: 'var(--text-faint)' }}>{month}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ height: 8 }} />
                </div>
              )}
            </>
          )}

          <div className="mob2-bottom-nav">
            {NAV_ITEMS.map(({ label, path, icon }) => {
              const active = path === '/client/invoices';
              return (
                <div key={label} className="mob2-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob2-nav-icon${active ? ' active' : ''}`}>{icon}</div>
                  <div className={`mob2-nav-label${active ? ' active' : ''}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {selectedInvoice && (
          <div className="mob2-detail-overlay">
            <div className="mob2-detail-hd">
              <button onClick={() => { setSelectedInvoice(null); setInvoiceItems([]); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)', fontFamily: 'Inter,sans-serif', padding: 0, flexShrink: 0 }}>← Back</button>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedInvoice.supplier || 'Invoice'}</div>
              <span style={{ fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 10, background: getStatus(selectedInvoice).ok ? 'rgba(42,138,90,.12)' : 'rgba(212,160,32,.12)', color: getStatus(selectedInvoice).ok ? 'var(--color-green)' : 'var(--color-amber)', flexShrink: 0 }}>
                {getStatus(selectedInvoice).label}
              </span>
            </div>
            <div className="mob2-detail-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { l: 'Invoice No.', v: selectedInvoice.number || '—' },
                  { l: 'Date', v: selectedInvoice.date ? formatDateShort(selectedInvoice.date) : '—' },
                  { l: 'Supplier', v: selectedInvoice.supplier || '—' },
                  { l: 'Upload Date', v: formatDateShort(selectedInvoice.created_at) },
                ].map(({ l, v }) => (
                  <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Total Amount</div>
                <div style={{ fontFamily: "'Inter',sans-serif", fontWeight: 700, fontSize: 20, color: 'var(--accent)' }}>{selectedInvoice.amount ? formatCurrency(selectedInvoice.amount) : '—'}</div>
              </div>
              {selectedInvoice.file_url && (
                <a href={selectedInvoice.file_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
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
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .7 }}>Line Items ({invoiceItems.length})</div>
                  {invoiceItems.map(item => (
                    <div key={item.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.item_name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.quantity ? `${item.quantity} ${item.unit || ''}`.trim() : '—'} · {item.unit_cost ? `${formatCurrency(item.unit_cost)}/${item.unit || ''}` : '—'}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{formatCurrency(calculateItemTotal(item))}</div>
                        <div style={{ fontSize: 10, marginTop: 2 }}>
                          {item.ingredients ? <span style={{ color: 'var(--color-green)' }}>Linked</span> : <span style={{ color: 'var(--color-amber)' }}>Unlinked</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>No line items recorded</div>
              )}
            </div>
          </div>
        )}

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

        <div className="inv-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div className="inv-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t} className={`inv-tab${t === 'Invoices' ? ' active' : ''}`}
                  onClick={() => router.push(t === 'Dashboard' ? '/client/dashboard' : `/client/${t.toLowerCase().replace(' ', '-')}`)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'clamp(9px,.62vw,11px)', color: 'var(--accent)' }}>
              <div style={{ width: 5, height: 5, background: 'var(--accent)', borderRadius: '50%', animation: 'blink 2s infinite' }} />Active
            </div>
            <div style={{ width: 'clamp(140px,13vw,240px)', height: 'clamp(26px,2.6vh,34px)', overflow: 'visible', position: 'relative' }}>
              <UniversalSearch restaurantId={restaurantId} placeholder="Search..." />
            </div>
            <button className="inv-upload-btn" onClick={() => setShowParseModal(true)}>
              <IconUpload size={11} /> Upload Invoice
            </button>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
          </div>
        </div>

        <div className="inv-wbar">
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="inv-wname">Invoice Center</span>
            <span className="inv-wsub">· {invoices.length} invoices · {formatCurrencyWhole(totalSpend)} total</span>
          </div>
          <div className="inv-wactions">
            <div className="inv-waction-item">
              <div className="inv-waction-dot" style={{ background: 'var(--accent)' }} />
              <span className="inv-waction-val" style={{ color: 'var(--accent)' }}>{formatCurrencyWhole(thisMonthSpend)}</span>
              <span>{new Date().toLocaleDateString('en-US', { month: 'short' })} spend</span>
            </div>
            <div className="inv-waction-item">
              <div className="inv-waction-dot" style={{ background: 'var(--text-faint)' }} />
              <span className="inv-waction-val" style={{ color: 'var(--text-muted)' }}>{formatCurrencyWhole(lastMonthSpend)}</span>
              <span>{new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'short' })} spend</span>
            </div>
            {monthPct !== null && (
              <div className="inv-waction-item">
                <div className="inv-waction-dot" style={{ background: monthUp ? 'var(--color-red)' : 'var(--color-green)' }} />
                <span className="inv-waction-val" style={{ color: monthUp ? 'var(--color-red)' : 'var(--color-green)' }}>
                  {monthUp ? '▲' : '▼'} {Math.abs(monthPct)}%
                </span>
                <span>vs prior month</span>
              </div>
            )}
            <div className="inv-waction-item">
              <div className="inv-waction-dot" style={{ background: 'var(--color-amber)' }} />
              <span className="inv-waction-val" style={{ color: 'var(--color-amber)' }}>{formatCurrencyWhole(avgInvoice)}</span>
              <span>avg invoice</span>
            </div>
          </div>
        </div>

        {confirmMsg && (
          <div className="inv-confirm-banner">
            {confirmMsg}
            <button onClick={() => setConfirmMsg('')} style={{ background: 'none', border: 'none', color: 'var(--color-green)', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        )}

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 'clamp(10px,.78vw,13px)', color: 'var(--text-muted)' }}>Loading invoices...</div>
          </div>
        ) : (
          <div className="inv-split">
            <div className="inv-list">
              <div className="inv-list-hd">
                <div className="inv-list-title">Invoices</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search..."
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'Inter,sans-serif', width: 'clamp(80px,8vw,130px)' }}
                  />
                  <div className="inv-list-count">{filtered.length}</div>
                </div>
              </div>
              <div className="inv-tbl-head">
                <div className="inv-th">Supplier</div>
                <div className="inv-th">Invoice No.</div>
                <div className="inv-th">Date</div>
                <div className="inv-th">Amount</div>
                <div className="inv-th">Status</div>
              </div>
              <div className="inv-tbl-body">
                {filtered.length === 0 ? (
                  <div className="inv-empty-state">
                    <IconFile size={36} />
                    <div style={{ fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-muted)', fontWeight: 500 }}>
                      {searchTerm ? `No results for "${searchTerm}"` : 'No invoices yet'}
                    </div>
                    {!searchTerm && (
                      <button className="inv-upload-btn" onClick={() => setShowParseModal(true)} style={{ marginTop: 4 }}>
                        <IconUpload size={11} /> Upload First Invoice
                      </button>
                    )}
                  </div>
                ) : filtered.map((invoice, idx) => {
                  const { label, ok } = getStatus(invoice);
                  return (
                    <div key={invoice.id} className={`inv-row${selectedInvoice?.id === invoice.id ? ' selected' : ''}`}
                      style={{ animationDelay: `${idx * .02}s` }} onClick={() => selectInvoice(invoice)}>
                      <div className="inv-td primary">{invoice.supplier || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>Unknown</span>}</div>
                      <div className="inv-td">{invoice.number || <span style={{ color: 'var(--text-faint)' }}>—</span>}</div>
                      <div className="inv-td">{invoice.date ? formatDateShort(invoice.date) : <span style={{ color: 'var(--text-faint)' }}>—</span>}</div>
                      <div className="inv-td amount">{invoice.amount ? formatCurrency(invoice.amount) : <span style={{ color: 'var(--text-faint)' }}>—</span>}</div>
                      <div><span className={`inv-pill ${ok ? 'ok' : 'pend'}`}>{label}</span></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="inv-detail">
              <div className="inv-detail-hd">
                <div className="inv-detail-title">
                  {selectedInvoice ? `${selectedInvoice.supplier || 'Invoice'} · ${selectedInvoice.number || '—'}` : 'Invoice Overview'}
                </div>
                {selectedInvoice
                  ? <span className={`inv-pill ${getStatus(selectedInvoice).ok ? 'ok' : 'pend'}`}>{getStatus(selectedInvoice).label}</span>
                  : <div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-faint)' }}>Select an invoice for details</div>}
              </div>

              {!selectedInvoice && (
                <div className="inv-detail-body">
                  <div className="inv-widget">
                    <div className="inv-wlbl"><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />Key Metrics</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 'clamp(5px,.5vw,8px)' }}>
                      {[
                        { l: 'Avg Invoice Size', v: formatCurrencyWhole(avgInvoice), c: 'var(--text-primary)' },
                        { l: 'Invoices This Month', v: invoicesThisMonthByDate, c: 'var(--text-primary)' },
                        { l: 'Uploaded This Month', v: invoicesUploadedThisMonth, c: 'var(--text-muted)' },
                        { l: 'Days Since Last', v: daysSinceLast !== null ? daysSinceLast : '—', c: daysSinceLast > 7 ? 'var(--color-amber)' : 'var(--color-green)' },
                        { l: 'Largest Invoice', v: formatCurrencyWhole(largest), c: 'var(--accent)' },
                      ].map(({ l, v, c }) => (
                        <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'clamp(4px,.3vw,6px)', padding: 'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)' }}>
                          <div style={{ fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{l}</div>
                          <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 'clamp(12px,1vw,16px)', fontWeight: 700, color: c }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(5px,.5vw,8px)', flex: 1, minHeight: 0 }}>
                    <div className="inv-widget" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <div className="inv-wlbl"><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />Recent Activity</div>
                      <div style={{ flex: 1, overflowY: 'auto' }}>
                        {invoices.slice(0, 8).map(inv => {
                          const { ok } = getStatus(inv);
                          return (
                            <div key={inv.id} className="inv-act-item" onClick={() => selectInvoice(inv)}>
                              <div className="inv-act-dot" style={{ background: ok ? 'var(--color-green)' : 'var(--color-amber)' }} />
                              <div className="inv-act-text"><strong>{inv.number || 'Invoice'}</strong>{inv.supplier ? ` · ${inv.supplier}` : ''}</div>
                              {inv.amount && <div className="inv-act-amount">{formatCurrencyWhole(inv.amount)}</div>}
                              <div className="inv-act-time">{timeAgo(inv.created_at)}</div>
                            </div>
                          );
                        })}
                        {invoices.length === 0 && <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-faint)' }}>No invoice activity yet</div>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(5px,.5vw,8px)', minHeight: 0 }}>
                      <div className="inv-widget">
                        <div className="inv-wlbl"><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />Month over Month</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{new Date().toLocaleDateString('en-US', { month: 'long' })}</div>
                            <div style={{ fontFamily: "'Inter',sans-serif", fontWeight: 700, fontSize: 'clamp(17px,1.5vw,24px)', color: 'var(--accent)', lineHeight: 1 }}>{formatCurrencyWhole(thisMonthSpend)}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'long' })}</div>
                            <div style={{ fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 'clamp(13px,1.05vw,17px)', color: 'var(--text-primary)', lineHeight: 1 }}>{formatCurrencyWhole(lastMonthSpend)}</div>
                          </div>
                        </div>
                        {monthPct !== null ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'clamp(9px,.68vw,11px)', color: monthUp ? 'var(--color-red)' : 'var(--color-green)', fontWeight: 600 }}>
                            <span>{monthUp ? '▲' : '▼'}</span><span>{Math.abs(monthPct)}% {monthUp ? 'above' : 'below'} last month</span>
                          </div>
                        ) : <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-faint)' }}>No prior month data</div>}
                      </div>

                      <div className="inv-widget" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div className="inv-wlbl"><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />Top Suppliers</div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'clamp(6px,.6vh,9px)' }}>
                          {topSuppliers.length > 0 ? topSuppliers.map(([name, amount], i) => {
                            const colors = ['var(--accent)', 'var(--color-amber)', 'var(--color-green)', 'var(--text-faint)'];
                            return (
                              <div key={name} className="inv-prog-row" style={{ marginBottom: 0 }}>
                                <div className="inv-prog-label">{name}</div>
                                <div className="inv-prog-track"><div className="inv-prog-fill" style={{ width: `${(amount / maxSupplier) * 100}%`, background: colors[i] }} /></div>
                                <div className="inv-prog-val" style={{ color: colors[i] }}>{formatCurrencyWhole(amount)}</div>
                              </div>
                            );
                          }) : <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-faint)' }}>No supplier data yet</div>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="inv-widget">
                    <div className="inv-wlbl"><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />12-Month Spend</div>
                    <div className="inv-mini-chart">
                      {monthlySpend.map(({ month, total }, idx) => (
                        <div key={idx} className="inv-mc-col">
                          <div className="inv-mc-track"><div className="inv-mc-bar" style={{ height: `${Math.max(2, (total / maxMonthly) * 90)}%`, background: getBarColor(total) }} /></div>
                          <div className="inv-mc-lbl">{month}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedInvoice && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: 'clamp(6px,.6vw,10px) clamp(10px,1vw,16px)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <button onClick={() => { setSelectedInvoice(null); setInvoiceItems([]); router.replace('/client/invoices', undefined, { shallow: true }); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--accent)', fontFamily: "'Inter',sans-serif", display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
                      ← Back to overview
                    </button>
                  </div>

                  <div className="inv-detail-body">
                    <div className="inv-widget">
                      <div className="inv-wlbl"><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />Invoice Information</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto', gap: 'clamp(5px,.5vw,8px)', alignItems: 'stretch' }}>
                        {[
                          { l: 'Invoice No.', v: selectedInvoice.number || '—' },
                          { l: 'Invoice Date', v: selectedInvoice.date ? formatDate(selectedInvoice.date) : '—' },
                          { l: 'Supplier', v: selectedInvoice.supplier || '—' },
                          { l: 'Upload Date', v: formatDate(selectedInvoice.created_at) },
                          { l: 'Total Amount', v: selectedInvoice.amount ? formatCurrency(selectedInvoice.amount) : '—', accent: true },
                        ].map(({ l, v, accent }) => (
                          <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'clamp(4px,.3vw,6px)', padding: 'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)' }}>
                            <div style={{ fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{l}</div>
                            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 'clamp(11px,.85vw,14px)', fontWeight: accent ? 700 : 500, color: accent ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
                          </div>
                        ))}
                        {selectedInvoice.file_url ? (
                          <a href={selectedInvoice.file_url} target="_blank" rel="noopener noreferrer"
                            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'clamp(4px,.3vw,6px)', padding: 'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, textDecoration: 'none', cursor: 'pointer', flexShrink: 0, minWidth: 'clamp(44px,4vw,60px)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            <div style={{ fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Open</div>
                          </a>
                        ) : (
                          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'clamp(4px,.3vw,6px)', padding: 'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 0, minWidth: 'clamp(44px,4vw,60px)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            <div style={{ fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>No file</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="inv-widget" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <div className="inv-wlbl"><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />Line Items {invoiceItems.length > 0 && `(${invoiceItems.length})`}</div>
                      {loadingDetail ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'clamp(10px,.75vw,12px)' }}>
                          <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                          Loading items...
                        </div>
                      ) : invoiceItems.length > 0 ? (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: 5, padding: 'clamp(4px,.4vh,6px) clamp(8px,.7vw,12px)', background: 'var(--bg-elevated)', borderRadius: 'clamp(4px,.3vw,6px)', marginBottom: 4, flexShrink: 0 }}>
                            <div style={{ fontSize: 'clamp(7px,.58vw,10px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              onClick={() => setShowRawNames(r => !r)}>
                              Item {showRawNames ? '↕ invoice' : '↕ normalized'}
                            </div>
                            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                              <div style={{ fontSize: 'clamp(7px,.58vw,10px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px', textAlign: 'right' }}>QTY</div>
                              <div style={{ fontSize: 'clamp(7px,.58vw,10px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}></div>
                            </div>
                            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                              <div style={{ fontSize: 'clamp(7px,.58vw,10px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px', textAlign: 'right' }}>COST</div>
                              <div style={{ fontSize: 'clamp(7px,.58vw,10px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}></div>
                            </div>
                            <div style={{ fontSize: 'clamp(7px,.58vw,10px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}>TOTAL</div>
                            <div style={{ fontSize: 'clamp(7px,.58vw,10px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.6px' }}>STATUS</div>
                          </div>
                          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                            {invoiceItems.map(item => (
                              <div key={item.id} className="inv-item-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: 5, padding: 'clamp(5px,.5vh,8px) clamp(8px,.7vw,12px)', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                                <div className="inv-itd name" style={{ cursor: item.ingredients ? 'pointer' : 'default' }}
                                  onClick={() => item.ingredients && setShowRawNames(r => !r)}
                                  title={showRawNames ? item.ingredients?.name : item.item_name}>
                                  {item.ingredients
                                    ? (showRawNames ? item.item_name : item.ingredients.name) || '—'
                                    : item.item_name || '—'}
                                </div>
                                <div className="inv-itd" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  {item.quantity ?? '—'}
                                </div>
                                <div className="inv-itd" style={{ textAlign: 'left' }}>
                                  {item.unit || ''}
                                </div>
                                <div className="inv-itd" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  {item.unit_cost ? formatCurrency(item.unit_cost) : '—'}
                                </div>
                                <div className="inv-itd" style={{ textAlign: 'left' }}>
                                  {item.unit || ''}
                                </div>
                                <div className="inv-itd val">{formatCurrency(calculateItemTotal(item))}</div>
                                <div>{item.ingredients ? <span className="inv-linked">Linked</span> : <span className="inv-unlinked">Unlinked</span>}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8 }}>
                          <IconFile size={36} />
                          <div style={{ fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-muted)', fontWeight: 500 }}>No line items recorded</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showParseModal && restaurantId && (
        <ParseModal restaurantId={restaurantId} onClose={() => setShowParseModal(false)} onSaved={handleInvoiceSaved} />
      )}
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
    </>
  );
}