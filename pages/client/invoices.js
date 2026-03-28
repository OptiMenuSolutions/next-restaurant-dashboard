// pages/client/invoices.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '--';
  const n = parseFloat(amount);
  if (isNaN(n)) return '--';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return 'Invalid date'; }
}

function formatDateShort(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
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

function getUserInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

function calculateItemTotal(item) {
  return (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
}

function getBarColor(total) {
  if (total > 5000) return '#c04040';
  if (total > 2000) return '#d4a020';
  if (total > 0) return '#02a4ba';
  return '#1e1c18';
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; overflow: hidden; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  input::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  .inv-root {
    font-family: 'Inter', sans-serif;
    background: #0a0908;
    color: #e8e2d8;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* NAV */
  .inv-nav {
    background: #0f0e0c;
    border-bottom: 1px solid #2a2620;
    height: clamp(36px,4vh,52px);
    padding: 0 clamp(10px,1vw,20px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .inv-logo { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); color: #e8e2d8; letter-spacing: -.3px; }
  .inv-logo span { color: #02a4ba; }
  .inv-tab { padding: clamp(2px,.3vh,4px) clamp(6px,.6vw,11px); border-radius: 4px; font-size: clamp(10px,.75vw,13px); color: #4a453e; border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .inv-tab.active { color: #e8e2d8; background: #1a1915; }
  .inv-search-sm { background: #1a1915; border: 1px solid #2a2620; border-radius: 4px; padding: clamp(3px,.3vh,6px) clamp(8px,.7vw,13px); font-size: clamp(10px,.75vw,13px); color: #e8e2d8; width: clamp(120px,12vw,220px); outline: none; font-family: 'Inter', sans-serif; }
  .inv-avatar { width: clamp(22px,1.8vw,30px); height: clamp(22px,1.8vw,30px); border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: clamp(8px,.65vw,11px); font-weight: 700; color: #0a0908; flex-shrink: 0; cursor: pointer; }

  /* PAGE HEADER */
  .inv-ph { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(8px,.8vh,14px) clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .inv-ph-title { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,20px); color: #e8e2d8; }
  .inv-ph-sub { font-size: clamp(9px,.65vw,11px); color: #4a453e; margin-top: 2px; }
  .inv-search-lg { background: #1a1915; border: 1px solid #2a2620; border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); color: #e8e2d8; width: clamp(160px,16vw,300px); outline: none; font-family: 'Inter', sans-serif; }
  .inv-upload-btn { display: flex; align-items: center; gap: 6px; background: #02a4ba; border: none; border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: background .2s; }
  .inv-upload-btn:hover { background: #01bcd4; }

  /* STATS BAR */
  .inv-sbar { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,20px); display: flex; gap: clamp(16px,2vw,36px); flex-shrink: 0; }
  .inv-sv { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); line-height: 1; }
  .inv-sl { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 2px; text-transform: uppercase; letter-spacing: .5px; }

  /* SPLIT LAYOUT */
  .inv-split { display: flex; gap: clamp(6px,.6vw,10px); padding: clamp(6px,.6vw,10px); flex: 1; min-height: 0; overflow: hidden; }

  /* LIST PANEL */
  .inv-list { width: 55%; background: #13120f; border: 1px solid #2a2620; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .inv-list-hd { padding: clamp(8px,.8vh,14px) clamp(10px,1vw,18px); border-bottom: 1px solid #2a2620; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .inv-list-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: #e8e2d8; }
  .inv-list-count { font-size: clamp(9px,.65vw,11px); color: #4a453e; background: #0f0e0c; border: 1px solid #2a2620; border-radius: 10px; padding: 1px 8px; }

  .inv-tbl-head { display: grid; grid-template-columns: 2fr 1.5fr 1.2fr 1fr 90px; gap: 8px; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,18px); background: #0f0e0c; border-bottom: 1px solid #2a2620; flex-shrink: 0; }
  .inv-th { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; }

  .inv-tbl-body { flex: 1; overflow-y: auto; }
  .inv-row { display: grid; grid-template-columns: 2fr 1.5fr 1.2fr 1fr 90px; gap: 8px; padding: clamp(7px,.7vh,12px) clamp(10px,1vw,18px); border-bottom: 1px solid #1a1915; cursor: pointer; transition: background .15s; align-items: center; border-left: 2px solid transparent; }
  .inv-row:hover { background: #1a1915; }
  .inv-row.selected { background: rgba(2,164,186,.08); border-left-color: #02a4ba; }
  .inv-td { font-size: clamp(10px,.75vw,12px); color: #9a9086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inv-td.primary { color: #e8e2d8; font-weight: 500; }
  .inv-td.amount { color: #02a4ba; font-weight: 600; }
  .inv-pill { font-size: clamp(8px,.6vw,10px); font-weight: 500; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .inv-pill.ok { background: rgba(42,138,90,.12); color: #2a8a5a; }
  .inv-pill.pend { background: rgba(212,160,32,.12); color: #d4a020; }

  /* DETAIL PANEL */
  .inv-detail { flex: 1; background: #13120f; border: 1px solid #2a2620; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
  .inv-detail-hd { padding: clamp(8px,.8vh,14px) clamp(10px,1vw,18px); border-bottom: 1px solid #2a2620; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .inv-detail-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: #e8e2d8; }
  .inv-detail-body { flex: 1; overflow-y: auto; padding: clamp(10px,1vw,16px); display: flex; flex-direction: column; gap: clamp(8px,.8vh,14px); }

  /* DEFAULT STATE WIDGETS */
  .inv-widget-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .inv-widget { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,14px); }
  .inv-widget-full { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,14px); }
  .inv-wlbl { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 5px; }
  .inv-wlbl svg { width: 10px; height: 10px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  /* Mini bar chart */
  .inv-mini-chart { display: flex; align-items: flex-end; gap: clamp(3px,.28vw,5px); height: clamp(50px,6vh,80px); margin-top: clamp(4px,.4vh,7px); }
  .inv-mc-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
  .inv-mc-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .inv-mc-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
  .inv-mc-lbl { font-size: clamp(7px,.55vw,9px); color: #3a3630; }

  /* Donut */
  .inv-donut-wrap { display: flex; align-items: center; gap: clamp(10px,1vw,18px); }
  .inv-donut { position: relative; width: clamp(52px,5vw,72px); height: clamp(52px,5vw,72px); flex-shrink: 0; }
  .inv-donut svg { width: 100%; height: 100%; }
  .inv-donut-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .inv-donut-pct { font-family: 'Playfair Display', serif; font-size: clamp(12px,1.1vw,16px); color: #e8e2d8; line-height: 1; }
  .inv-donut-sub { font-size: clamp(6px,.52vw,8px); color: #4a453e; }
  .inv-donut-legend { display: flex; flex-direction: column; gap: clamp(4px,.4vh,7px); }
  .inv-dl { display: flex; align-items: center; gap: 5px; font-size: clamp(8px,.62vw,11px); color: #6b6358; }
  .inv-dl-dot { width: clamp(5px,.4vw,7px); height: clamp(5px,.4vw,7px); border-radius: 50%; flex-shrink: 0; }
  .inv-dl-val { font-weight: 600; margin-left: auto; color: #e8e2d8; font-size: clamp(9px,.65vw,11px); }

  /* Key metrics */
  .inv-stat-pair { display: flex; flex-direction: column; gap: clamp(5px,.5vh,8px); }
  .inv-stat-item { display: flex; align-items: center; justify-content: space-between; }
  .inv-stat-name { font-size: clamp(9px,.68vw,11px); color: #6b6358; }
  .inv-stat-val { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.05vw,17px); }

  /* Progress bars */
  .inv-prog-row { display: flex; align-items: center; gap: 7px; margin-bottom: clamp(4px,.4vh,7px); }
  .inv-prog-row:last-child { margin-bottom: 0; }
  .inv-prog-label { font-size: clamp(8px,.62vw,11px); color: #6b6358; width: clamp(60px,6vw,90px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inv-prog-track { flex: 1; background: #1a1915; border-radius: 3px; height: clamp(4px,.35vh,6px); }
  .inv-prog-fill { height: 100%; border-radius: 3px; }
  .inv-prog-val { font-size: clamp(8px,.62vw,11px); font-weight: 600; width: clamp(36px,3.5vw,52px); text-align: right; flex-shrink: 0; }

  /* Activity */
  .inv-act-item { display: flex; align-items: center; gap: clamp(7px,.7vw,12px); padding: clamp(5px,.5vh,8px) 0; border-bottom: 1px solid #1a1915; }
  .inv-act-item:last-child { border-bottom: none; }
  .inv-act-dot { width: clamp(5px,.42vw,7px); height: clamp(5px,.42vw,7px); border-radius: 50%; flex-shrink: 0; }
  .inv-act-text { flex: 1; font-size: clamp(9px,.68vw,11px); color: #9a9086; }
  .inv-act-text strong { color: #e8e2d8; font-weight: 500; }
  .inv-act-amount { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: #02a4ba; flex-shrink: 0; }
  .inv-act-time { font-size: clamp(8px,.6vw,10px); color: #4a453e; flex-shrink: 0; }

  /* Select hint */
  .inv-hint { font-size: clamp(8px,.62vw,10px); color: #3a3630; text-align: center; padding: clamp(4px,.4vh,7px); border: 1px dashed #2a2620; border-radius: 6px; }

  /* DETAIL VIEW */
  .inv-dsection { margin-bottom: clamp(10px,1vh,16px); }
  .inv-dsection-title { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 5px; }
  .inv-dsection-title::after { content: ''; flex: 1; height: 1px; background: #2a2620; }
  .inv-dgrid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: clamp(5px,.5vw,8px); }
  .inv-dfield { background: #0f0e0c; border: 1px solid #1a1915; border-radius: 6px; padding: clamp(6px,.6vh,10px) clamp(8px,.7vw,12px); }
  .inv-dfield-lbl { font-size: clamp(7px,.58vw,9px); color: #4a453e; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .inv-dfield-val { font-size: clamp(10px,.75vw,13px); color: #e8e2d8; font-weight: 500; }
  .inv-dfield-val.accent { color: #02a4ba; font-family: 'Playfair Display', serif; font-size: clamp(14px,1.1vw,18px); }
  .inv-dfield-val.link { color: #02a4ba; font-size: clamp(9px,.65vw,11px); cursor: pointer; text-decoration: underline; }

  .inv-items-head { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 90px; gap: 5px; padding: clamp(5px,.5vh,8px) clamp(8px,.7vw,12px); background: #0f0e0c; border-radius: 6px 6px 0 0; border: 1px solid #2a2620; border-bottom: none; }
  .inv-ith { font-size: clamp(7px,.58vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .6px; }
  .inv-item-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 90px; gap: 5px; padding: clamp(5px,.5vh,9px) clamp(8px,.7vw,12px); border: 1px solid #2a2620; border-top: none; align-items: center; }
  .inv-item-row:last-child { border-radius: 0 0 6px 6px; }
  .inv-item-row:nth-child(odd) { background: #0f0e0c; }
  .inv-item-row:nth-child(even) { background: #13120f; }
  .inv-itd { font-size: clamp(9px,.65vw,11px); color: #9a9086; }
  .inv-itd.name { color: #e8e2d8; font-weight: 500; }
  .inv-itd.val { color: #02a4ba; font-weight: 600; }
  .inv-linked { font-size: clamp(7px,.55vw,9px); padding: 1px 5px; border-radius: 8px; background: rgba(42,138,90,.12); color: #2a8a5a; }
  .inv-unlinked { font-size: clamp(7px,.55vw,9px); padding: 1px 5px; border-radius: 8px; background: rgba(212,160,32,.1); color: #d4a020; }

  .inv-total-bar { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 6px; padding: clamp(7px,.7vh,11px) clamp(10px,.9vw,14px); display: flex; justify-content: space-between; align-items: center; margin-top: clamp(5px,.5vh,8px); }
  .inv-total-label { font-size: clamp(9px,.68vw,12px); color: #6b6358; font-weight: 500; }
  .inv-total-val { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.1vw,18px); color: #02a4ba; }
  .inv-diff { font-size: clamp(8px,.62vw,10px); color: #c04040; margin-top: 3px; text-align: right; }

  /* UPLOAD MODAL */
  .inv-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.75); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .inv-modal { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; width: clamp(300px,40vw,520px); overflow: hidden; }
  .inv-modal-hd { padding: clamp(12px,1.2vh,20px) clamp(14px,1.2vw,22px); border-bottom: 1px solid #2a2620; display: flex; align-items: center; justify-content: space-between; }
  .inv-modal-title { font-size: clamp(12px,1vw,16px); font-weight: 600; color: #e8e2d8; }
  .inv-modal-close { background: none; border: none; color: #4a453e; cursor: pointer; font-size: 16px; line-height: 1; transition: color .2s; }
  .inv-modal-close:hover { color: #e8e2d8; }
  .inv-modal-body { padding: clamp(14px,1.4vh,24px) clamp(14px,1.2vw,22px); }
  .inv-drop-zone { border: 2px dashed #2a2620; border-radius: 8px; padding: clamp(20px,3vh,40px); text-align: center; cursor: pointer; transition: border-color .2s; }
  .inv-drop-zone:hover, .inv-drop-zone.drag-over { border-color: #02a4ba; }
  .inv-drop-title { font-size: clamp(11px,.85vw,14px); color: #e8e2d8; font-weight: 500; margin-bottom: 4px; }
  .inv-drop-sub { font-size: clamp(9px,.65vw,11px); color: #4a453e; }
  .inv-drop-btn { display: inline-block; margin-top: 12px; background: #02a4ba; border: none; border-radius: 5px; padding: 7px 16px; font-size: clamp(10px,.75vw,12px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; }
  .inv-drop-btn:hover { background: #01bcd4; }
  .inv-file-list { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
  .inv-file-item { display: flex; align-items: center; justify-content: space-between; background: #0f0e0c; border: 1px solid #2a2620; border-radius: 5px; padding: 7px 10px; }
  .inv-file-name { font-size: clamp(9px,.68vw,11px); color: #e8e2d8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .inv-file-remove { background: none; border: none; color: #4a453e; cursor: pointer; font-size: 14px; line-height: 1; margin-left: 8px; }
  .inv-file-remove:hover { color: #c04040; }
  .inv-upload-submit { width: 100%; margin-top: 14px; background: #02a4ba; border: none; border-radius: 6px; padding: 10px; font-size: clamp(11px,.85vw,14px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; }
  .inv-upload-submit:hover { background: #01bcd4; }
  .inv-upload-submit:disabled { opacity: .5; cursor: not-allowed; }
  .inv-confirm { background: rgba(42,138,90,.1); border: 1px solid rgba(42,138,90,.25); border-radius: 6px; padding: 10px 14px; font-size: clamp(10px,.75vw,13px); color: #2a8a5a; margin-bottom: 10px; }
`;

// ─── Icon SVGs ────────────────────────────────────────────────────────────────

function IconUpload({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}

function IconFile({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#e8e2d8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .25 }}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientInvoices() {
  const router = useRouter();
  const fileInputRef = useRef(null);

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items'];

  useEffect(() => { init(); }, []);
  useEffect(() => { if (restaurantId) fetchInvoices(); }, [restaurantId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) return;
    setRestaurantId(profile.restaurant_id);
    setUserName(profile.full_name ? profile.full_name.split(' ')[0] : 'User');
  }

  async function fetchInvoices() {
    setLoading(true);
    const { data } = await supabase.from('invoices').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false });
    setInvoices(data || []);
    setLoading(false);
    // Auto-select from query param
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

  function handleFiles(files) {
    const valid = Array.from(files).filter(f => f.size <= 10 * 1024 * 1024);
    setSelectedFiles(prev => [...prev, ...valid]);
  }

  async function handleUpload() {
    if (!selectedFiles.length) return;
    setUploading(true);
    try {
      for (const file of selectedFiles) {
        const path = `${restaurantId}/${Date.now()}_${file.name}`;
        const { data: uploaded, error: uploadError } = await supabase.storage.from('invoices').upload(path, file);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(path);
        await supabase.from('invoices').insert([{ restaurant_id: restaurantId, file_url: publicUrl, file_name: file.name }]);
      }
      setConfirmMsg(`${selectedFiles.length} invoice${selectedFiles.length > 1 ? 's' : ''} uploaded successfully.`);
      setSelectedFiles([]);
      setShowModal(false);
      fetchInvoices();
      setTimeout(() => setConfirmMsg(''), 4000);
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
    }
  }

  // ── Derived data ──
  const filtered = invoices.filter(i => {
    const s = searchTerm.toLowerCase();
    return (i.number || '').toLowerCase().includes(s) || (i.supplier || '').toLowerCase().includes(s);
  });

  const processed = invoices.filter(i => getStatus(i).ok);
  const pending = invoices.filter(i => !getStatus(i).ok);
  const totalSpend = processed.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
  const currentMonth = new Date().getMonth();
  const thisMonthSpend = processed.filter(i => i.date && new Date(i.date).getMonth() === currentMonth).reduce((s, i) => s + parseFloat(i.amount || 0), 0);
  const avgInvoice = processed.length > 0 ? totalSpend / processed.length : 0;
  const largest = processed.length > 0 ? Math.max(...processed.map(i => parseFloat(i.amount || 0))) : 0;
  const lastInvoice = invoices[0];
  const daysSinceLast = lastInvoice ? Math.floor((Date.now() - new Date(lastInvoice.created_at)) / 86400000) : null;
  const invoicesThisMonth = invoices.filter(i => i.created_at && new Date(i.created_at).getMonth() === currentMonth).length;
  const processedPct = invoices.length > 0 ? Math.round((processed.length / invoices.length) * 100) : 0;

  // Supplier spend
  const supplierMap = {};
  processed.forEach(i => {
    if (i.supplier) supplierMap[i.supplier] = (supplierMap[i.supplier] || 0) + parseFloat(i.amount || 0);
  });
  const topSuppliers = Object.entries(supplierMap).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxSupplier = topSuppliers[0]?.[1] || 1;

  // Monthly spend for chart
  const currentYear = new Date().getFullYear();
  const monthlySpend = Array.from({ length: 12 }, (_, m) => {
    const total = processed.filter(i => i.date && new Date(i.date).getFullYear() === currentYear && new Date(i.date).getMonth() === m).reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    return { month: new Date(currentYear, m).toLocaleDateString('en-US', { month: 'short' }).slice(0, 1), total };
  });
  const maxMonthly = Math.max(...monthlySpend.map(m => m.total), 1);

  // Total calculated
  const totalCalculated = invoiceItems.reduce((s, i) => s + calculateItemTotal(i), 0);

  // Donut arc calc
  const donutCirc = 2 * Math.PI * 14; // r=14
  const processedDash = (processed.length / Math.max(invoices.length, 1)) * donutCirc;
  const pendingDash = (pending.length / Math.max(invoices.length, 1)) * donutCirc;

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div style={{ background: '#0a0908', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 28, height: 28, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        <div style={{ fontSize: 'clamp(11px,0.9vw,15px)', color: '#e8e2d8' }}>Loading Invoices</div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>

      <div className="inv-root">

        {/* NAV */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,0.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'clamp(9px,0.65vw,11px)', color: '#02a4ba' }}>
              <div style={{ width: 4, height: 4, background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
              Active
            </div>
            <input className="inv-search-sm" placeholder="Search..." />
            <div className="inv-avatar">{getUserInitials(userName)}</div>
          </div>
        </div>

        {/* PAGE HEADER */}
        <div className="inv-ph">
          <div>
            <div className="inv-ph-title">Invoice Center</div>
            <div className="inv-ph-sub">Track expenses and supplier payments</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="inv-search-lg" placeholder="Search by supplier or invoice number..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <button className="inv-upload-btn" onClick={() => setShowModal(true)}>
              <IconUpload size={11} /> Upload Invoice
            </button>
          </div>
        </div>

        {/* STATS BAR */}
        {confirmMsg && <div className="inv-confirm" style={{ margin: '0 clamp(10px,1vw,20px)' }}>{confirmMsg}</div>}
        <div className="inv-sbar">
          {[
            { v: invoices.length, l: 'Total Invoices', c: '#02a4ba' },
            { v: processed.length, l: 'Processed', c: '#2a8a5a' },
            { v: pending.length, l: 'Pending', c: '#d4a020' },
            { v: formatCurrencyShort(totalSpend), l: 'Total Spend', c: '#e8e2d8' },
            { v: formatCurrencyShort(thisMonthSpend), l: 'This Month', c: '#e8e2d8' },
          ].map(({ v, l, c }) => (
            <div key={l}>
              <div className="inv-sv" style={{ color: c }}>{v}</div>
              <div className="inv-sl">{l}</div>
            </div>
          ))}
        </div>

        {/* SPLIT */}
        <div className="inv-split">

          {/* LIST */}
          <div className="inv-list">
            <div className="inv-list-hd">
              <div className="inv-list-title">Invoice List</div>
              <div className="inv-list-count">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</div>
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8 }}>
                  <IconFile size={40} />
                  <div style={{ fontSize: 'clamp(11px,0.85vw,14px)', color: '#6b6358', fontWeight: 500 }}>
                    {searchTerm ? `No results for "${searchTerm}"` : 'No invoices yet'}
                  </div>
                  {!searchTerm && (
                    <button className="inv-upload-btn" onClick={() => setShowModal(true)} style={{ marginTop: 4 }}>
                      <IconUpload size={11} /> Upload First Invoice
                    </button>
                  )}
                </div>
              ) : filtered.map(invoice => {
                const { label, ok } = getStatus(invoice);
                return (
                  <div key={invoice.id} className={`inv-row${selectedInvoice?.id === invoice.id ? ' selected' : ''}`} onClick={() => selectInvoice(invoice)}>
                    <div className="inv-td primary">{invoice.supplier || <span style={{ color: '#4a453e', fontStyle: 'italic' }}>Unknown</span>}</div>
                    <div className="inv-td">{invoice.number || <span style={{ color: '#4a453e' }}>—</span>}</div>
                    <div className="inv-td">{invoice.date ? formatDateShort(invoice.date) : <span style={{ color: '#4a453e' }}>—</span>}</div>
                    <div className="inv-td amount">{invoice.amount ? formatCurrency(invoice.amount) : <span style={{ color: '#4a453e' }}>—</span>}</div>
                    <div><span className={`inv-pill ${ok ? 'ok' : 'pend'}`}>{label}</span></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DETAIL */}
          <div className="inv-detail">
            <div className="inv-detail-hd">
              <div className="inv-detail-title">{selectedInvoice ? 'Invoice Detail' : 'Invoice Overview'}</div>
              {selectedInvoice
                ? <span className={`inv-pill ${getStatus(selectedInvoice).ok ? 'ok' : 'pend'}`}>{getStatus(selectedInvoice).label}</span>
                : <div style={{ fontSize: 'clamp(9px,0.65vw,11px)', color: '#4a453e' }}>Click an invoice to view details</div>
              }
            </div>

            {/* DEFAULT STATE */}
            {!selectedInvoice && (
              <div className="inv-detail-body">

                {/* Row 1: Chart + Donut */}
                <div className="inv-widget-row">
                  <div className="inv-widget">
                    <div className="inv-wlbl">
                      <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      Monthly Spend Trend
                    </div>
                    <div className="inv-mini-chart">
                      {monthlySpend.map(({ month, total }) => (
                        <div key={month} className="inv-mc-col">
                          <div className="inv-mc-track">
                            <div className="inv-mc-bar" style={{ height: `${Math.max(2, (total / maxMonthly) * 90)}%`, background: getBarColor(total) }} />
                          </div>
                          <div className="inv-mc-lbl">{month}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="inv-widget">
                    <div className="inv-wlbl">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Processing Breakdown
                    </div>
                    <div className="inv-donut-wrap">
                      <div className="inv-donut">
                        <svg viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="14" fill="none" stroke="#1a1915" strokeWidth="5"/>
                          {invoices.length > 0 && <>
                            <circle cx="18" cy="18" r="14" fill="none" stroke="#2a8a5a" strokeWidth="5"
                              strokeDasharray={`${processedDash} ${donutCirc}`} strokeDashoffset={donutCirc * 0.25} strokeLinecap="round"/>
                            <circle cx="18" cy="18" r="14" fill="none" stroke="#d4a020" strokeWidth="5"
                              strokeDasharray={`${pendingDash} ${donutCirc}`} strokeDashoffset={-(processedDash - donutCirc * 0.25)} strokeLinecap="round"/>
                          </>}
                        </svg>
                        <div className="inv-donut-inner">
                          <div className="inv-donut-pct">{processedPct}%</div>
                          <div className="inv-donut-sub">done</div>
                        </div>
                      </div>
                      <div className="inv-donut-legend">
                        <div className="inv-dl"><div className="inv-dl-dot" style={{ background: '#2a8a5a' }}/> Processed <div className="inv-dl-val">{processed.length}</div></div>
                        <div className="inv-dl"><div className="inv-dl-dot" style={{ background: '#d4a020' }}/> Pending <div className="inv-dl-val">{pending.length}</div></div>
                        <div className="inv-dl"><div className="inv-dl-dot" style={{ background: '#1a1915', border: '1px solid #2a2620' }}/> Total <div className="inv-dl-val">{invoices.length}</div></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 2: Key metrics + Top suppliers */}
                <div className="inv-widget-row">
                  <div className="inv-widget">
                    <div className="inv-wlbl">
                      <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                      Key Metrics
                    </div>
                    <div className="inv-stat-pair">
                      <div className="inv-stat-item">
                        <div className="inv-stat-name">Avg invoice size</div>
                        <div className="inv-stat-val" style={{ color: '#e8e2d8' }}>{formatCurrencyShort(avgInvoice)}</div>
                      </div>
                      <div className="inv-stat-item">
                        <div className="inv-stat-name">Largest invoice</div>
                        <div className="inv-stat-val" style={{ color: '#02a4ba' }}>{formatCurrencyShort(largest)}</div>
                      </div>
                      <div className="inv-stat-item">
                        <div className="inv-stat-name">Days since last invoice</div>
                        <div className="inv-stat-val" style={{ color: daysSinceLast > 7 ? '#d4a020' : '#2a8a5a' }}>{daysSinceLast !== null ? daysSinceLast : '—'}</div>
                      </div>
                      <div className="inv-stat-item">
                        <div className="inv-stat-name">Invoices this month</div>
                        <div className="inv-stat-val" style={{ color: '#2a8a5a' }}>{invoicesThisMonth}</div>
                      </div>
                    </div>
                  </div>

                  <div className="inv-widget">
                    <div className="inv-wlbl">
                      <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                      Top Suppliers by Spend
                    </div>
                    {topSuppliers.length > 0 ? topSuppliers.map(([name, amount], i) => {
                      const colors = ['#02a4ba', '#d4a020', '#2a8a5a', '#6b6358'];
                      return (
                        <div key={name} className="inv-prog-row">
                          <div className="inv-prog-label">{name}</div>
                          <div className="inv-prog-track">
                            <div className="inv-prog-fill" style={{ width: `${(amount / maxSupplier) * 100}%`, background: colors[i] }} />
                          </div>
                          <div className="inv-prog-val" style={{ color: colors[i] }}>{formatCurrencyShort(amount)}</div>
                        </div>
                      );
                    }) : (
                      <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e', marginTop: 4 }}>No supplier data yet</div>
                    )}
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="inv-widget-full">
                  <div className="inv-wlbl">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Recent Invoice Activity
                  </div>
                  {invoices.slice(0, 5).map(inv => {
                    const { ok } = getStatus(inv);
                    return (
                      <div key={inv.id} className="inv-act-item" style={{ cursor: 'pointer' }} onClick={() => selectInvoice(inv)}>
                        <div className="inv-act-dot" style={{ background: ok ? '#2a8a5a' : '#d4a020' }} />
                        <div className="inv-act-text">
                          <strong>{inv.number || 'Invoice'}</strong>{inv.supplier ? ` from ${inv.supplier}` : ''} — {ok ? 'processed successfully' : 'pending review'}
                        </div>
                        {inv.amount && <div className="inv-act-amount">{formatCurrencyShort(inv.amount)}</div>}
                        <div className="inv-act-time">{timeAgo(inv.created_at)}</div>
                      </div>
                    );
                  })}
                  {invoices.length === 0 && <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e' }}>No invoice activity yet</div>}
                </div>

                <div className="inv-hint">Select an invoice from the list to view full details →</div>
              </div>
            )}

            {/* INVOICE DETAIL STATE */}
            {selectedInvoice && (
              <div className="inv-detail-body">
                <div className="inv-dsection">
                  <div className="inv-dsection-title">Invoice Information</div>
                  <div className="inv-dgrid">
                    <div className="inv-dfield"><div className="inv-dfield-lbl">Invoice No.</div><div className="inv-dfield-val">{selectedInvoice.number || <span style={{ color: '#4a453e', fontStyle: 'italic' }}>Pending</span>}</div></div>
                    <div className="inv-dfield"><div className="inv-dfield-lbl">Invoice Date</div><div className="inv-dfield-val">{selectedInvoice.date ? formatDate(selectedInvoice.date) : <span style={{ color: '#4a453e', fontStyle: 'italic' }}>Pending</span>}</div></div>
                    <div className="inv-dfield"><div className="inv-dfield-lbl">Supplier</div><div className="inv-dfield-val">{selectedInvoice.supplier || <span style={{ color: '#4a453e', fontStyle: 'italic' }}>Pending</span>}</div></div>
                    <div className="inv-dfield"><div className="inv-dfield-lbl">Upload Date</div><div className="inv-dfield-val">{formatDate(selectedInvoice.created_at)}</div></div>
                    <div className="inv-dfield">
                      <div className="inv-dfield-lbl">File</div>
                      {selectedInvoice.file_url
                        ? <a className="inv-dfield-val link" href={selectedInvoice.file_url} target="_blank" rel="noopener noreferrer">View File ↗</a>
                        : <div className="inv-dfield-val" style={{ color: '#4a453e', fontStyle: 'italic' }}>No file</div>
                      }
                    </div>
                    <div className="inv-dfield"><div className="inv-dfield-lbl">Total Amount</div><div className="inv-dfield-val accent">{selectedInvoice.amount ? formatCurrency(selectedInvoice.amount) : <span style={{ color: '#4a453e', fontStyle: 'italic' }}>Pending</span>}</div></div>
                  </div>
                </div>

                {loadingDetail ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: '#4a453e', fontSize: 'clamp(10px,0.75vw,12px)' }}>
                    <div style={{ width: 16, height: 16, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    Loading items...
                  </div>
                ) : invoiceItems.length > 0 ? (
                  <div className="inv-dsection">
                    <div className="inv-dsection-title">Invoice Items ({invoiceItems.length})</div>
                    <div className="inv-items-head">
                      <div className="inv-ith">Item</div>
                      <div className="inv-ith">Qty</div>
                      <div className="inv-ith">Unit Cost</div>
                      <div className="inv-ith">Total</div>
                      <div className="inv-ith">Status</div>
                    </div>
                    {invoiceItems.map(item => (
                      <div key={item.id} className="inv-item-row">
                        <div className="inv-itd name">{item.item_name || '—'}</div>
                        <div className="inv-itd">{item.quantity ? `${item.quantity} ${item.unit || ''}`.trim() : '—'}</div>
                        <div className="inv-itd">{formatCurrency(item.unit_cost)}</div>
                        <div className="inv-itd val">{formatCurrency(calculateItemTotal(item))}</div>
                        <div>{item.ingredients ? <span className="inv-linked">Linked</span> : <span className="inv-unlinked">Unlinked</span>}</div>
                      </div>
                    ))}
                    <div className="inv-total-bar">
                      <div className="inv-total-label">Calculated Total</div>
                      <div>
                        <div className="inv-total-val">{formatCurrency(totalCalculated)}</div>
                        {selectedInvoice.amount && Math.abs(totalCalculated - parseFloat(selectedInvoice.amount)) > 0.01 && (
                          <div className="inv-diff">Diff: {formatCurrency(Math.abs(totalCalculated - parseFloat(selectedInvoice.amount)))}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: '#4a453e' }}>
                    <IconFile size={36} />
                    <div style={{ fontSize: 'clamp(11px,0.85vw,14px)', color: '#6b6358', fontWeight: 500 }}>
                      {getStatus(selectedInvoice).ok ? 'No line items recorded' : 'Pending processing'}
                    </div>
                    <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e', textAlign: 'center', maxWidth: 260 }}>
                      {getStatus(selectedInvoice).ok
                        ? 'This invoice was processed but no line items were recorded.'
                        : 'Items will appear once this invoice has been processed.'}
                    </div>
                  </div>
                )}

                <button onClick={() => { setSelectedInvoice(null); setInvoiceItems([]); router.replace('/client/invoices', undefined, { shallow: true }); }}
                  style={{ background: 'none', border: '1px solid #2a2620', borderRadius: 5, padding: 'clamp(5px,0.5vh,8px) clamp(10px,0.9vw,14px)', fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e', cursor: 'pointer', fontFamily: "'Inter', sans-serif", marginTop: 'auto', alignSelf: 'flex-start', transition: 'all .15s' }}>
                  ← Back to overview
                </button>
              </div>
            )}
          </div>
        </div>

        {/* UPLOAD MODAL */}
        {showModal && (
          <div className="inv-modal-bg" onClick={() => { if (!uploading) setShowModal(false); }}>
            <div className="inv-modal" onClick={e => e.stopPropagation()}>
              <div className="inv-modal-hd">
                <div className="inv-modal-title">Upload Invoices</div>
                <button className="inv-modal-close" onClick={() => { if (!uploading) setShowModal(false); }}>✕</button>
              </div>
              <div className="inv-modal-body">
                <div
                  className={`inv-drop-zone${dragOver ? ' drag-over' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
                  <IconFile size={40} />
                  <div className="inv-drop-title">Drag & drop invoices here</div>
                  <div className="inv-drop-sub">Supports PDF, JPG, PNG — up to 10MB per file</div>
                  <button className="inv-drop-btn" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>Browse Files</button>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="inv-file-list">
                    {selectedFiles.map((f, i) => (
                      <div key={i} className="inv-file-item">
                        <div className="inv-file-name">{f.name}</div>
                        <div style={{ fontSize: 'clamp(8px,0.6vw,10px)', color: '#4a453e', marginLeft: 8, flexShrink: 0 }}>{(f.size / 1024).toFixed(0)}KB</div>
                        <button className="inv-file-remove" onClick={() => setSelectedFiles(prev => prev.filter((_, j) => j !== i))}>✕</button>
                      </div>
                    ))}
                    <button className="inv-upload-submit" onClick={handleUpload} disabled={uploading}>
                      {uploading ? 'Uploading...' : `Upload ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`}
                    </button>
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: 'clamp(9px,0.65vw,11px)', color: '#4a453e', textAlign: 'center' }}>
                  Files are processed automatically after upload.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}