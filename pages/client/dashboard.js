// pages/client/dashboard.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { useWindowSize } from "../../lib/useWindowSize";
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (!amount) return "$0";
  const n = parseFloat(amount);
  if (isNaN(n)) return "$0";
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrencyDetailed(amount) {
  if (!amount) return "$0.00";
  const n = parseFloat(amount);
  if (isNaN(n)) return "$0.00";
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return "N/A";
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return "N/A"; }
}

function getMarginColor(m) {
  if (m >= 60) return "#2a8a5a";
  if (m >= 40) return "#02a4ba";
  if (m >= 25) return "#d4a020";
  return "#c04040";
}

function getScoreInfo(score) {
  if (score >= 85) return { color: "#2a8a5a", label: "Excellent" };
  if (score >= 70) return { color: "#02a4ba", label: "Good" };
  if (score >= 55) return { color: "#d4a020", label: "Fair" };
  return { color: "#c04040", label: "Needs Work" };
}

function getUserInitials(name) {
  if (!name) return "U";
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

function getBarColor(total) {
  if (total > 5000) return '#c04040';
  if (total > 2000) return '#d4a020';
  if (total > 0) return '#02a4ba';
  return '#1e1c18';
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* Force full height through Next.js wrappers */
  html, body { height: 100%; background: #0a0908; overflow: hidden; }
  #__next { height: 100%; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

  input::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  .db-root {
    font-family: 'Inter', sans-serif;
    background: #0a0908;
    color: #e8e2d8;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── NAV ── */
  .db-nav {
    background: #0f0e0c;
    border-bottom: 1px solid #2a2620;
    height: clamp(36px, 4vh, 52px);
    padding: 0 clamp(10px, 1vw, 20px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .db-logo {
    font-family: 'Playfair Display', serif;
    font-size: clamp(13px, 1.1vw, 19px);
    color: #e8e2d8;
    letter-spacing: -.3px;
  }
  .db-logo span { color: #02a4ba; }

  .db-tab {
    padding: clamp(2px, 0.3vh, 4px) clamp(6px, 0.6vw, 11px);
    border-radius: clamp(3px, 0.3vw, 6px);
    font-size: clamp(10px, 0.75vw, 13px);
    color: #4a453e;
    border: none;
    background: none;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    line-height: 1.5;
    transition: all 0.15s;
  }
  .db-tab.active { color: #e8e2d8; background: #1a1915; }

  .db-search {
    background: #1a1915;
    border: 1px solid #2a2620;
    border-radius: clamp(3px, 0.3vw, 6px);
    padding: clamp(3px, 0.3vh, 6px) clamp(8px, 0.7vw, 13px);
    font-size: clamp(10px, 0.75vw, 13px);
    color: #e8e2d8;
    width: clamp(120px, 12vw, 220px);
    outline: none;
    font-family: 'Inter', sans-serif;
  }

  .db-avatar {
    width: clamp(22px, 1.8vw, 32px);
    height: clamp(22px, 1.8vw, 32px);
    border-radius: 50%;
    background: #02a4ba;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(8px, 0.65vw, 11px);
    font-weight: 700;
    color: #0a0908;
    flex-shrink: 0;
  }

  /* ── WELCOME BAR ── */
  .db-wbar {
    background: #13120f;
    border-bottom: 1px solid #2a2620;
    height: clamp(30px, 3.5vh, 46px);
    padding: 0 clamp(10px, 1vw, 20px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .db-wname { font-size: clamp(11px, 0.85vw, 16px); font-weight: 600; color: #e8e2d8; }
  .db-wsub { font-size: clamp(9px, 0.65vw, 12px); color: #4a453e; margin-left: 6px; }
  .db-wstat-v { font-family: 'Playfair Display', serif; font-size: clamp(12px, 1.05vw, 19px); line-height: 1; }
  .db-wstat-l { font-size: clamp(8px, 0.6vw, 11px); color: #4a453e; margin-top: 1px; }

  /* ── GRID WRAPPER ── */
  .db-grid-wrap {
    flex: 1;
    min-height: 0;
    padding: clamp(6px, 0.6vw, 12px);
    gap: clamp(6px, 0.6vw, 12px);
    display: grid;
    grid-template-columns: clamp(155px, 13vw, 230px) 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    overflow: hidden;
  }

  /* ── PANEL ── */
  .db-panel {
    grid-column: 1;
    grid-row: 1 / 3;
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 9px);
    padding: clamp(10px, 0.9vw, 18px);
    display: flex;
    flex-direction: column;
    gap: clamp(8px, 0.8vh, 16px);
    overflow: hidden;
  }

  .db-panel-top {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: clamp(3px, 0.35vh, 6px);
    padding-bottom: clamp(8px, 0.8vh, 14px);
    border-bottom: 1px solid #2a2620;
    flex-shrink: 0;
  }

  .db-rest-icon {
    width: clamp(26px, 2.4vw, 42px);
    height: clamp(26px, 2.4vw, 42px);
    border-radius: 50%;
    background: rgba(2,164,186,.1);
    border: 1px solid rgba(2,164,186,.2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .db-rest-icon svg { width: 55%; height: 55%; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  .db-rest-name { font-size: clamp(10px, 0.85vw, 15px); font-weight: 600; color: #e8e2d8; }
  .db-rest-sub { font-size: clamp(8px, 0.62vw, 11px); color: #4a453e; }

  /* Score ring */
  .db-score-wrap { display: flex; flex-direction: column; align-items: center; gap: clamp(4px, 0.4vh, 7px); flex-shrink: 0; }
  .db-score-lbl { font-size: clamp(8px, 0.62vw, 11px); color: #6b6358; text-transform: uppercase; letter-spacing: .5px; font-weight: 500; }
  .db-ring { position: relative; width: clamp(56px, 5.5vw, 90px); height: clamp(56px, 5.5vw, 90px); }
  .db-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .db-ring-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .db-ring-num { font-family: 'Playfair Display', serif; font-size: clamp(16px, 1.6vw, 26px); color: #e8e2d8; line-height: 1; }
  .db-ring-sub { font-size: clamp(7px, 0.58vw, 10px); color: #4a453e; }
  .db-score-tag { font-size: clamp(9px, 0.65vw, 12px); font-weight: 600; padding: clamp(2px,0.2vh,3px) clamp(7px,0.55vw,11px); border-radius: 10px; }

  /* Stat pills */
  .db-pills { display: flex; flex-direction: column; gap: clamp(5px, 0.5vh, 9px); flex: 1; overflow: hidden; }
  .db-pill {
    background: #0f0e0c;
    border-radius: clamp(4px, 0.35vw, 7px);
    padding: clamp(5px, 0.55vh, 10px) clamp(8px, 0.7vw, 14px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 1px solid #1a1915;
    flex-shrink: 0;
  }
  .db-pill-l { font-size: clamp(9px, 0.68vw, 13px); color: #6b6358; }
  .db-pill-v { font-family: 'Playfair Display', serif; font-size: clamp(13px, 1.1vw, 18px); }

  /* ── CARD ── */
  .db-card {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 9px);
    padding: clamp(10px, 0.9vw, 18px) clamp(10px, 1vw, 20px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  .db-card-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: clamp(7px, 0.75vh, 14px);
    flex-shrink: 0;
  }

  .db-card-title {
    font-size: clamp(10px, 0.78vw, 14px);
    font-weight: 600;
    color: #e8e2d8;
    display: flex;
    align-items: center;
    gap: clamp(4px, 0.35vw, 7px);
  }
  .db-card-title svg { width: clamp(10px, 0.85vw, 15px); height: clamp(10px, 0.85vw, 15px); stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  .db-card-act {
    font-size: clamp(9px, 0.65vw, 12px);
    color: #02a4ba;
    background: none;
    border: none;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    white-space: nowrap;
    opacity: 0.85;
  }

  /* ── AI ITEMS ── */
  .db-ai-item {
    display: flex;
    gap: clamp(6px, 0.5vw, 10px);
    padding: clamp(7px, 0.65vh, 12px) clamp(9px, 0.8vw, 15px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.35vw, 7px);
    border-left: 2px solid #02a4ba;
    margin-bottom: clamp(6px, 0.6vh, 11px);
    flex-shrink: 0;
  }
  .db-ai-item:last-child { margin-bottom: 0; }
  .db-ai-dot { width: clamp(5px, 0.4vw, 7px); height: clamp(5px, 0.4vw, 7px); border-radius: 50%; background: #02a4ba; margin-top: clamp(3px, 0.35vh, 6px); flex-shrink: 0; }
  .db-ai-title { font-size: clamp(10px, 0.78vw, 14px); font-weight: 600; color: #e8e2d8; margin-bottom: 2px; }
  .db-ai-desc { font-size: clamp(9px, 0.65vw, 12px); color: #6b6358; line-height: 1.45; }

  /* ── MARGIN BARS ── */
  .db-margin-row {
    display: flex;
    align-items: center;
    gap: clamp(6px, 0.5vw, 10px);
    margin-bottom: clamp(6px, 0.65vh, 12px);
  }
  .db-margin-row:last-child { margin-bottom: 0; }
  .db-margin-name { font-size: clamp(10px, 0.75vw, 13px); color: #9a9086; width: clamp(75px, 8vw, 130px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-margin-track { flex: 1; background: #1a1915; border-radius: 3px; height: clamp(3px, 0.3vh, 6px); }
  .db-margin-fill { height: 100%; border-radius: 3px; }
  .db-margin-pct { font-size: clamp(10px, 0.75vw, 13px); font-weight: 600; width: clamp(34px, 3vw, 48px); text-align: right; flex-shrink: 0; }

  /* ── INVOICE / INGREDIENT ROWS ── */
  .db-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: clamp(6px, 0.6vh, 11px) clamp(8px, 0.75vw, 14px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.35vw, 7px);
    margin-bottom: clamp(5px, 0.5vh, 9px);
    flex-shrink: 0;
  }
  .db-row:last-child { margin-bottom: 0; }
  .db-row-name { font-size: clamp(10px, 0.78vw, 14px); font-weight: 500; color: #e8e2d8; }
  .db-row-sub { font-size: clamp(8px, 0.62vw, 11px); color: #4a453e; margin-top: 1px; }
  .db-row-val { font-size: clamp(10px, 0.78vw, 14px); font-weight: 600; color: #e8e2d8; text-align: right; }
  .db-row-date { font-size: clamp(8px, 0.62vw, 11px); color: #4a453e; text-align: right; margin-top: 1px; }
  .db-ing-val { font-size: clamp(10px, 0.78vw, 14px); font-weight: 600; color: #02a4ba; }

  /* ── TOGGLE ── */
  .db-toggle { display: flex; background: #0f0e0c; border-radius: clamp(3px, 0.28vw, 5px); padding: 2px; }
  .db-toggle-btn {
    padding: clamp(2px, 0.22vh, 4px) clamp(7px, 0.6vw, 12px);
    border-radius: clamp(2px, 0.22vw, 4px);
    font-size: clamp(9px, 0.65vw, 12px);
    cursor: pointer; border: none;
    font-family: 'Inter', sans-serif;
    color: #4a453e; background: transparent; line-height: 1.5;
    transition: all 0.15s;
  }
  .db-toggle-btn.active { background: #1a1915; color: #e8e2d8; }

  /* ── CHART ── */
  .db-chart-outer { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .db-chart { display: flex; align-items: flex-end; gap: clamp(3px, 0.3vw, 7px); flex: 1; min-height: 0; }
  .db-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: clamp(2px, 0.22vh, 4px); height: 100%; }
  .db-bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .db-bar { width: 100%; border-radius: clamp(2px, 0.22vw, 4px) clamp(2px, 0.22vw, 4px) 0 0; }
  .db-bar-lbl { font-size: clamp(8px, 0.65vw, 12px); color: #3a3630; }
  .db-legend { display: flex; gap: clamp(8px, 0.9vw, 18px); margin-top: clamp(5px, 0.55vh, 10px); flex-shrink: 0; flex-wrap: wrap; }
  .db-legend-item { display: flex; align-items: center; gap: clamp(3px, 0.28vw, 5px); font-size: clamp(8px, 0.65vw, 12px); color: #4a453e; }
  .db-legend-dot { width: clamp(5px, 0.48vw, 9px); height: clamp(5px, 0.48vw, 9px); border-radius: 50%; flex-shrink: 0; }

  /* ── SPINNER ── */
  .db-spinner { width: clamp(7px, 0.65vw, 11px); height: clamp(7px, 0.65vw, 11px); border: 1.5px solid #2a2620; border-top-color: #02a4ba; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; }

  /* ── EMPTY STATE ── */
  .db-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: clamp(10px, 0.78vw, 14px); color: #4a453e; }

  /* ── RESPONSIVE ── */
  @media (max-width: 1280px) {
    .db-grid-wrap {
      grid-template-columns: clamp(148px, 12.5vw, 185px) 1fr 1fr 1fr;
    }
  }

  @media (max-width: 1024px) {
    .db-grid-wrap {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto auto auto;
      overflow-y: auto;
    }
    .db-panel { grid-column: 1 / 3; grid-row: 1; flex-direction: row; align-items: center; gap: clamp(12px, 2vw, 24px); }
    .db-panel-top { border-bottom: none; border-right: 1px solid #2a2620; padding-bottom: 0; padding-right: clamp(12px, 2vw, 22px); }
    .db-pills { flex-direction: row; flex-wrap: wrap; }
    .db-pill { min-width: 110px; flex: 1; }
  }

  /* ── MOBILE ── */
  .mob-root { font-family: 'Inter', sans-serif; background: #0a0908; color: #e8e2d8; width: 100%; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
  .mob-header { background: #0f0e0c; border-bottom: 1px solid #2a2620; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding-top: env(safe-area-inset-top, 10px); }
  .mob-logo { font-family: 'Playfair Display', serif; font-size: 20px; color: #e8e2d8; letter-spacing: -.3px; }
  .mob-logo span { color: #02a4ba; }
  .mob-avatar { width: 30px; height: 30px; border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #0a0908; }
  .mob-titlebar { background: #13120f; border-bottom: 1px solid #2a2620; padding: 10px 16px; flex-shrink: 0; }
  .mob-page-title { font-family: 'Playfair Display', serif; font-size: 20px; color: #e8e2d8; line-height: 1; }
  .mob-page-sub { font-size: 11px; color: #4a453e; margin-top: 3px; }
  .mob-stats { background: #13120f; border-bottom: 1px solid #2a2620; padding: 8px 16px; display: flex; flex-shrink: 0; overflow-x: auto; }
  .mob-stats::-webkit-scrollbar { display: none; }
  .mob-stat { flex: 1; min-width: 0; text-align: center; padding: 0 6px; border-right: 1px solid #2a2620; }
  .mob-stat:last-child { border-right: none; }
  .mob-stat-v { font-family: 'Playfair Display', serif; font-size: 16px; line-height: 1; }
  .mob-stat-l { font-size: 9px; color: #4a453e; margin-top: 2px; text-transform: uppercase; letter-spacing: .4px; }
  .mob-content { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; -webkit-overflow-scrolling: touch; }
  .mob-content::-webkit-scrollbar { display: none; }
  .mob-card { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; padding: 14px; flex-shrink: 0; }
  .mob-card-title { font-size: 11px; font-weight: 600; color: #e8e2d8; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
  .mob-card-title svg { width: 12px; height: 12px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mob-pill-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .mob-pill { background: #0f0e0c; border: 1px solid #1a1915; border-radius: 8px; padding: 10px 12px; }
  .mob-pill-l { font-size: 10px; color: #6b6358; margin-bottom: 4px; }
  .mob-pill-v { font-family: 'Playfair Display', serif; font-size: 18px; line-height: 1; }
  .mob-score-row { display: flex; align-items: center; gap: 16px; }
  .mob-score-ring { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
  .mob-score-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .mob-score-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .mob-score-num { font-family: 'Playfair Display', serif; font-size: 18px; color: #e8e2d8; line-height: 1; }
  .mob-score-sub { font-size: 9px; color: #4a453e; }
  .mob-score-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 10px; margin-top: 5px; }
  .mob-ai-item { background: #0f0e0c; border-radius: 7px; border-left: 2px solid #02a4ba; padding: 10px 12px; margin-bottom: 8px; }
  .mob-ai-item:last-child { margin-bottom: 0; }
  .mob-ai-title { font-size: 12px; font-weight: 600; color: #e8e2d8; margin-bottom: 3px; }
  .mob-ai-desc { font-size: 11px; color: #6b6358; line-height: 1.45; }
  .mob-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .mob-bar-row:last-child { margin-bottom: 0; }
  .mob-bar-name { font-size: 12px; color: #9a9086; width: 110px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mob-bar-track { flex: 1; background: #1a1915; border-radius: 3px; height: 5px; }
  .mob-bar-fill { height: 5px; border-radius: 3px; }
  .mob-bar-pct { font-size: 12px; font-weight: 600; width: 44px; text-align: right; flex-shrink: 0; }
  .mob-inv-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1a1915; }
  .mob-inv-row:last-child { border-bottom: none; }
  .mob-inv-name { font-size: 13px; font-weight: 500; color: #e8e2d8; }
  .mob-inv-sub { font-size: 11px; color: #4a453e; margin-top: 2px; }
  .mob-inv-amt { font-size: 13px; font-weight: 600; color: #02a4ba; text-align: right; }
  .mob-inv-date { font-size: 11px; color: #4a453e; text-align: right; margin-top: 2px; }
  .mob-chart { display: flex; align-items: flex-end; gap: 3px; height: 56px; margin-top: 6px; }
  .mob-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
  .mob-chart-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .mob-chart-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
  .mob-chart-lbl { font-size: 8px; color: #3a3630; }
  .mob-ing-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1a1915; }
  .mob-ing-row:last-child { border-bottom: none; }
  .mob-ing-name { font-size: 13px; color: #9a9086; }
  .mob-ing-unit { font-size: 11px; color: #4a453e; margin-top: 2px; }
  .mob-ing-price { font-size: 13px; font-weight: 600; color: #02a4ba; }
  .mob-bottom-nav { background: #0f0e0c; border-top: 1px solid #2a2620; padding: 8px 0; padding-bottom: max(8px, env(safe-area-inset-bottom)); display: flex; flex-shrink: 0; }
  .mob-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; padding: 4px 0; -webkit-tap-highlight-color: transparent; }
  .mob-nav-icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
  .mob-nav-icon svg { width: 20px; height: 20px; stroke: #4a453e; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mob-nav-icon.active svg { stroke: #02a4ba; }
  .mob-nav-label { font-size: 10px; color: #4a453e; }
  .mob-nav-label.active { color: #02a4ba; }
  .mob-nav-dot { width: 4px; height: 4px; border-radius: 50%; background: #02a4ba; }
  .mob-toggle { display: flex; background: #0f0e0c; border-radius: 6px; padding: 2px; gap: 2px; }
  .mob-toggle-btn { flex: 1; padding: 5px 10px; border-radius: 5px; font-size: 11px; font-weight: 500; cursor: pointer; border: none; font-family: 'Inter', sans-serif; color: #4a453e; background: transparent; text-align: center; transition: all .15s; }
  .mob-toggle-btn.active { background: #1a1915; color: #e8e2d8; }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRing({ score }) {
  const { color, label } = getScoreInfo(score);
  const circumference = 2 * Math.PI * 40;
  const dash = (score / 100) * circumference;
  return (
    <div className="db-score-wrap">
      <div className="db-score-lbl">AI Profit Score</div>
      <div className="db-ring">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" stroke="#1a1915" strokeWidth="9" fill="none" />
          <circle cx="50" cy="50" r="40" stroke={color} strokeWidth="9" fill="none"
            strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" />
        </svg>
        <div className="db-ring-inner">
          <div className="db-ring-num">{score}</div>
          <div className="db-ring-sub">/ 100</div>
        </div>
      </div>
      <div className="db-score-tag" style={{ background: `${color}18`, color }}>{label}</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientDashboard() {
  const router = useRouter();
  const { isMobile } = useWindowSize();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [restaurantName, setRestaurantName] = useState("Your Restaurant");
  const [marginView, setMarginView] = useState("high");
  const [aiLoading, setAiLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("Dashboard");

  const [data, setData] = useState({
    totalInvoices: 0, totalIngredients: 0, totalMenuItems: 0,
    recentInvoices: [], ingredientTrends: [], menuItemAnalysis: [],
    monthlySpending: [], unpricedIngredients: 0, averageMargin: 0,
    totalSpending: 0, aiProfitScore: { score: 0 }, aiRecommendations: [], lowMarginCount: 0,
  });

  const LOW_MARGIN_THRESHOLD = 40;

  useEffect(() => { getRestaurantId(); }, []);
  useEffect(() => { if (restaurantId) fetchDashboardData(); }, [restaurantId]);
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
    router.prefetch('/client/analytics');
  }, []);

  const { TourComponent } = useTour('dashboard');

  async function getRestaurantId() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setError("Authentication required"); setLoading(false); return; }
      setUserEmail(user.email || '');
      const { data: profile, error: profileError } = await supabase.from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();
      if (profileError || !profile?.restaurant_id) { setError("Could not determine restaurant access"); setLoading(false); return; }
      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name ? profile.full_name.split(' ')[0] : "User");
      const { data: rd } = await supabase.from("restaurants").select("name").eq("id", profile.restaurant_id).single();
      setRestaurantName(rd?.name || "Your Restaurant");
    } catch { setError("An unexpected error occurred"); setLoading(false); }
  }

  async function fetchDashboardData() {
    try {
      setLoading(true);
      const [{ data: invoices }, { data: ingredients }, { data: menuItems }] = await Promise.all([
        supabase.from("invoices").select("*").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }),
        supabase.from("ingredients").select("*").eq("restaurant_id", restaurantId),
        supabase.from("menu_items").select(`*, menu_item_components(id, name, cost, component_ingredients(quantity, ingredients(last_price)))`).eq("restaurant_id", restaurantId),
      ]);
      const processed = processDashboardData(invoices || [], ingredients || [], menuItems || []);
      setData(processed);
      setLoading(false);
      fetchAIRecommendations(processed);
    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message);
      setLoading(false);
    }
  }

  async function fetchAIRecommendations(dashData) {
    try {
      setAiLoading(true);
      const res = await fetch('/api/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardData: dashData, restaurantId, restaurantName: userName }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      setData(prev => ({ ...prev, aiRecommendations: json.recommendations || [] }));
    } catch {
      setData(prev => ({
        ...prev,
        aiRecommendations: [
          { title: "Check High Margins", description: "Review top performing items on your menu to identify dishes worth promoting." },
          { title: "Monitor Costs", description: "Track ingredient pricing changes and update unpriced items for accuracy." },
          { title: "Optimize Menu", description: "Add ingredient costs to get accurate margin calculations across your menu." },
        ]
      }));
    } finally { setAiLoading(false); }
  }

  function processDashboardData(invoices, ingredients, menuItems) {
    const processedInvoices = invoices.filter(i => i.number && i.supplier && i.amount);
    const totalSpending = processedInvoices.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    const unpricedIngredients = ingredients.filter(i => !i.last_price || parseFloat(i.last_price) === 0).length;
    const recentInvoices = processedInvoices.slice(0, 4).map(i => ({ id: i.id, number: i.number, supplier: i.supplier, amount: i.amount, date: i.date }));
    const menuItemAnalysis = menuItems.map(item => {
      const cost = (item.menu_item_components || []).reduce((t, c) => t + parseFloat(c.cost || 0), 0);
      const price = parseFloat(item.price || 0);
      const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
      const hasData = (item.menu_item_components || []).length > 0 &&
        (item.menu_item_components || []).every(c =>
          (c.component_ingredients || []).length > 0 &&
          (c.component_ingredients || []).every(ci => ci.ingredients?.last_price && parseFloat(ci.ingredients.last_price) > 0)
        );
      return { id: item.id, name: item.name, price, cost, margin, hasCompleteData: hasData };
    });
    const itemsWithMargins = menuItemAnalysis.filter(i => i.hasCompleteData && i.price > 0);
    const averageMargin = itemsWithMargins.length > 0 ? itemsWithMargins.reduce((s, i) => s + i.margin, 0) / itemsWithMargins.length : 0;
    const lowMarginCount = itemsWithMargins.filter(i => i.margin < LOW_MARGIN_THRESHOLD).length;
    const ingredientTrends = ingredients.filter(i => i.last_price > 0).sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price)).slice(0, 5).map(i => ({ name: i.name, price: parseFloat(i.last_price), unit: i.unit }));
    const currentYear = new Date().getFullYear();
    const monthlySpending = Array.from({ length: 12 }, (_, m) => {
      const name = new Date(currentYear, m).toLocaleDateString('en-US', { month: 'short' });
      const total = processedInvoices.filter(i => i.date && new Date(i.date).getFullYear() === currentYear && new Date(i.date).getMonth() === m).reduce((s, i) => s + parseFloat(i.amount || 0), 0);
      return { month: name, total };
    });
    const aiProfitScore = calculateAIProfitScore({ itemsWithMargins, averageMargin, unpricedIngredients, totalIngredients: ingredients.length, totalMenuItems: menuItems.length, processedInvoices, totalInvoices: invoices.length });
    return { totalInvoices: invoices.length, totalIngredients: ingredients.length, totalMenuItems: menuItems.length, recentInvoices, ingredientTrends, menuItemAnalysis, monthlySpending, unpricedIngredients, averageMargin, totalSpending, aiProfitScore, lowMarginCount };
  }

  function calculateAIProfitScore({ itemsWithMargins, averageMargin, unpricedIngredients, totalIngredients, totalMenuItems, processedInvoices, totalInvoices }) {
    let score = 0;
    score += Math.min((averageMargin / 60) * 30, 30);
    score += totalIngredients > 0 ? ((totalIngredients - unpricedIngredients) / totalIngredients) * 10 : 0;
    score += totalMenuItems > 0 ? (itemsWithMargins.length / totalMenuItems) * 10 : 0;
    score += totalInvoices > 0 ? (processedInvoices.length / totalInvoices) * 5 : 0;
    if (itemsWithMargins.length > 0) {
      const high = itemsWithMargins.filter(i => i.margin >= 50).length;
      const low = itemsWithMargins.filter(i => i.margin < 25).length;
      score += Math.max(Math.min(((high / itemsWithMargins.length) * 15) - ((low / itemsWithMargins.length) * 10) + 10, 20), 0);
    }
    const recent = processedInvoices.filter(i => { const d = new Date(i.created_at); const ago = new Date(); ago.setDate(ago.getDate() - 30); return d >= ago; }).length;
    score += Math.min((recent / 10) * 15, 15);
    return { score: Math.max(0, Math.min(100, Math.round(score))) };
  }

  function getMarginItems() {
    const items = (data.menuItemAnalysis || []).filter(i => i.hasCompleteData && i.price > 0);
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.margin - a.margin);
    return marginView === 'high' ? sorted.slice(0, 5) : sorted.slice(-5).reverse();
  }

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];
  const marginItems = getMarginItems();
  const spendValues = (data.monthlySpending || []).map(m => m.total);
  const maxSpend = spendValues.length > 0 ? Math.max(...spendValues, 1) : 1;

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────
  if (isMobile) {
    const circumference = 2 * Math.PI * 40;
    const scoreDash = (data.aiProfitScore.score / 100) * circumference;
    const { color: scoreColor, label: scoreLabel } = getScoreInfo(data.aiProfitScore.score);

    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div className="mob-root">

          {/* Header */}
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#02a4ba' }}>
                <div style={{ width: 5, height: 5, background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
                Active
              </div>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
            </div>
          </div>

          {/* Title bar */}
          <div className="mob-titlebar">
            <div className="mob-page-title">Dashboard</div>
            <div className="mob-page-sub">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}
            </div>
          </div>

          {/* Stats strip */}
          <div className="mob-stats">
            {[
              { v: data.totalInvoices, l: 'Invoices', c: '#02a4ba' },
              { v: data.totalIngredients, l: 'Ingredients', c: '#e8e2d8' },
              { v: data.totalMenuItems, l: 'Menu', c: '#e8e2d8' },
              { v: `${data.averageMargin.toFixed(1)}%`, l: 'Margin', c: getMarginColor(data.averageMargin) },
              { v: formatCurrency(data.totalSpending), l: 'YTD', c: '#d4a020' },
            ].map(({ v, l, c }) => (
              <div key={l} className="mob-stat">
                <div className="mob-stat-v" style={{ color: c }}>{v}</div>
                <div className="mob-stat-l">{l}</div>
              </div>
            ))}
          </div>

          {/* Scrollable content */}
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 24, height: 24, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: '#4a453e' }}>Loading dashboard...</div>
            </div>
          ) : (
            <div className="mob-content">

              {/* AI Score */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  AI Profit Score
                </div>
                <div className="mob-score-row">
                  <div className="mob-score-ring">
                    <svg viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" stroke="#1a1915" strokeWidth="9" fill="none"/>
                      <circle cx="50" cy="50" r="40" stroke={scoreColor} strokeWidth="9" fill="none"
                        strokeDasharray={`${scoreDash} ${circumference}`} strokeLinecap="round"/>
                    </svg>
                    <div className="mob-score-inner">
                      <div className="mob-score-num">{data.aiProfitScore.score}</div>
                      <div className="mob-score-sub">/100</div>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#4a453e', marginBottom: 6 }}>{restaurantName}</div>
                    <div className="mob-score-badge" style={{ background: `${scoreColor}18`, color: scoreColor }}>{scoreLabel}</div>
                  </div>
                </div>
              </div>

              {/* Stat pills */}
              <div className="mob-pill-grid">
                {[
                  { l: 'Invoices', v: data.totalInvoices, c: '#02a4ba' },
                  { l: 'Unpriced', v: data.unpricedIngredients, c: '#d4a020' },
                  { l: 'Low Margin', v: data.lowMarginCount, c: '#c04040' },
                  { l: 'Avg Food Cost', v: `${data.averageMargin > 0 ? (100 - data.averageMargin).toFixed(1) : 0}%`, c: '#2a8a5a' },
                ].map(({ l, v, c }) => (
                  <div key={l} className="mob-pill">
                    <div className="mob-pill-l">{l}</div>
                    <div className="mob-pill-v" style={{ color: c }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* AI Recommendations */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  AI Recommendations
                  {aiLoading && <div style={{ width: 10, height: 10, border: '1.5px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite', marginLeft: 4 }} />}
                </div>
                {(data.aiRecommendations || []).slice(0, 3).map((rec, i) => (
                  <div key={i} className="mob-ai-item">
                    <div className="mob-ai-title">{rec.title}</div>
                    <div className="mob-ai-desc">{rec.description}</div>
                  </div>
                ))}
              </div>

              {/* Menu Analysis */}
              <div className="mob-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div className="mob-card-title" style={{ marginBottom: 0 }}>
                    <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    Menu Analysis
                  </div>
                  <div className="mob-toggle">
                    {['high', 'low'].map(v => (
                      <button key={v} className={`mob-toggle-btn${marginView === v ? ' active' : ''}`} onClick={() => setMarginView(v)}>
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {marginItems.length > 0 ? marginItems.map(item => (
                  <div key={item.id} className="mob-bar-row">
                    <div className="mob-bar-name">{item.name}</div>
                    <div className="mob-bar-track">
                      <div className="mob-bar-fill" style={{ width: `${Math.max(0, Math.min(100, item.margin))}%`, background: getMarginColor(item.margin) }} />
                    </div>
                    <div className="mob-bar-pct" style={{ color: getMarginColor(item.margin) }}>{item.margin.toFixed(1)}%</div>
                  </div>
                )) : (
                  <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '8px 0' }}>No menu data yet</div>
                )}
              </div>

              {/* Monthly Spending */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  Monthly Spending
                </div>
                <div className="mob-chart">
                  {(data.monthlySpending || []).map(({ month, total }) => (
                    <div key={month} className="mob-chart-col">
                      <div className="mob-chart-track">
                        <div className="mob-chart-bar" style={{ height: `${Math.max(2, (total / maxSpend) * 92)}%`, background: getBarColor(total) }} />
                      </div>
                      <div className="mob-chart-lbl">{month.slice(0, 1)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Invoices */}
              <div className="mob-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div className="mob-card-title" style={{ marginBottom: 0 }}>
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Recent Invoices
                  </div>
                  <button onClick={() => router.push('/client/invoices')} style={{ fontSize: 11, color: '#02a4ba', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>View all →</button>
                </div>
                {data.recentInvoices.length > 0 ? data.recentInvoices.map(inv => (
                  <div key={inv.id} className="mob-inv-row">
                    <div>
                      <div className="mob-inv-name">{inv.number}</div>
                      <div className="mob-inv-sub">{inv.supplier}</div>
                    </div>
                    <div>
                      <div className="mob-inv-amt">{formatCurrency(inv.amount)}</div>
                      <div className="mob-inv-date">{formatDate(inv.date)}</div>
                    </div>
                  </div>
                )) : (
                  <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '8px 0' }}>No invoices yet</div>
                )}
              </div>

              {/* Top Ingredient Costs */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                  Top Ingredient Costs
                </div>
                {data.ingredientTrends.length > 0 ? data.ingredientTrends.map(ing => (
                  <div key={ing.name} className="mob-ing-row">
                    <div>
                      <div className="mob-ing-name">{ing.name}</div>
                      <div className="mob-ing-unit">per {ing.unit}</div>
                    </div>
                    <div className="mob-ing-price">{formatCurrencyDetailed(ing.price)}</div>
                  </div>
                )) : (
                  <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '8px 0' }}>No ingredient data yet</div>
                )}
              </div>

              <div style={{ height: 8, flexShrink: 0 }} />
            </div>
          )}

          {/* Bottom nav */}
          <div className="mob-bottom-nav">
            {[
              { label: 'Dashboard', path: '/client/dashboard', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
              { label: 'Invoices', path: '/client/invoices', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
              { label: 'Ingredients', path: '/client/ingredients', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
              { label: 'Menu', path: '/client/menu-items', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
              { label: 'Analytics', path: '/client/analytics', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
            ].map(({ label, path, icon }) => {
              const active = path === '/client/dashboard';
              return (
                <div key={label} className="mob-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob-nav-icon${active ? ' active' : ''}`}>{icon}</div>
                  <div className={`mob-nav-label${active ? ' active' : ''}`}>{label}</div>
                  {active && <div className="mob-nav-dot" />}
                </div>
              );
            })}
          </div>

        </div>
        <Analytics />
        <SpeedInsights />
        <TourComponent />
      </>
    );
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────



  if (error) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ background: '#0a0908', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 'clamp(12px,1vw,16px)', color: '#e8e2d8' }}>Unable to Load Dashboard</div>
        <div style={{ fontSize: 'clamp(10px,0.8vw,13px)', color: '#4a453e', marginBottom: 8 }}>{error}</div>
        <button onClick={() => window.location.reload()} style={{ background: '#02a4ba', border: 'none', borderRadius: 6, padding: '8px 18px', color: '#0a0908', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Try Again</button>
      </div>
    </>
  );

  return (
    <>
      <style>{GLOBAL_CSS}</style>

      <div className="db-root">

        {/* NAV */}
        <div className="db-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div className="db-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t} className={`db-tab${activeTab === t ? ' active' : ''}`}
                  onClick={() => { setActiveTab(t); if (t !== 'Dashboard') router.push(`/client/${t.toLowerCase().replace(' ', '-')}`); }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,0.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'clamp(9px,0.65vw,12px)', color: '#02a4ba' }}>
              <div style={{ width: 'clamp(4px,0.35vw,6px)', height: 'clamp(4px,0.35vw,6px)', background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
              Active
            </div>
            <input className="db-search" placeholder="Search..." />
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
          </div>
        </div>

        {/* WELCOME BAR */}
        <div className="db-wbar">
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="db-wname">Welcome back, {userName}</span>
            <span className="db-wsub">· {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}</span>
          </div>
          <div style={{ display: 'flex', gap: 'clamp(14px,1.8vw,32px)' }}>
            {[
              { v: data.totalInvoices, l: 'Invoices', c: '#02a4ba' },
              { v: data.totalIngredients, l: 'Ingredients', c: '#e8e2d8' },
              { v: data.totalMenuItems, l: 'Menu Items', c: '#e8e2d8' },
              { v: `${data.averageMargin.toFixed(1)}%`, l: 'Avg Margin', c: getMarginColor(data.averageMargin) },
              { v: formatCurrency(data.totalSpending), l: 'YTD Spend', c: '#d4a020' },
            ].map(({ v, l, c }) => (
              <div key={l}>
                <div className="db-wstat-v" style={{ color: c }}>{v}</div>
                <div className="db-wstat-l">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* GRID */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 22, height: 22, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 'clamp(10px,0.8vw,13px)', color: '#4a453e' }}>Loading dashboard...</div>
          </div>
        ) : (
        <div className="db-grid-wrap">

          {/* LEFT PANEL */}
          <div className="db-panel">
            <div className="db-panel-top">
              <div className="db-rest-icon">
                <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
              </div>
              <div className="db-rest-name">{restaurantName}</div>
              <div className="db-rest-sub">Management Dashboard</div>
            </div>
            <ScoreRing score={data.aiProfitScore.score} />
            <div className="db-pills">
              {[
                { l: 'Invoices', v: data.totalInvoices, c: '#02a4ba' },
                { l: 'Unpriced', v: data.unpricedIngredients, c: '#d4a020' },
                { l: 'Low Margin', v: data.lowMarginCount, c: '#c04040' },
                { l: 'Avg Food Cost', v: `${data.averageMargin > 0 ? (100 - data.averageMargin).toFixed(1) : 0}%`, c: '#2a8a5a' },
                { l: 'YTD Spend', v: formatCurrency(data.totalSpending), c: '#d4a020' },
              ].map(({ l, v, c }) => (
                <div key={l} className="db-pill">
                  <div className="db-pill-l">{l}</div>
                  <div className="db-pill-v" style={{ color: c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI RECOMMENDATIONS */}
          <div className="db-card" style={{ gridColumn: 2, gridRow: 1 }}>
            <div className="db-card-hd">
              <div className="db-card-title">
                <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                AI Recommendations
              </div>
              {aiLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'clamp(8px,0.62vw,11px)', color: '#4a453e' }}>
                  <div className="db-spinner" /> Analyzing
                </div>
              )}
            </div>
            {(data.aiRecommendations || []).length > 0
              ? (data.aiRecommendations || []).slice(0, 3).map((rec, i) => (
                <div key={i} className="db-ai-item">
                  <div className="db-ai-dot" />
                  <div>
                    <div className="db-ai-title">{rec.title}</div>
                    <div className="db-ai-desc">{rec.description}</div>
                  </div>
                </div>
              ))
              : <div className="db-empty">Preparing recommendations...</div>
            }
          </div>

          {/* MENU ANALYSIS */}
          <div className="db-card" style={{ gridColumn: 3, gridRow: 1 }}>
            <div className="db-card-hd">
              <div className="db-card-title">
                <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Menu Analysis
              </div>
              <div className="db-toggle">
                {['high', 'low'].map(v => (
                  <button key={v} className={`db-toggle-btn${marginView === v ? ' active' : ''}`} onClick={() => setMarginView(v)}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {marginItems.length > 0
              ? marginItems.map(item => (
                <div key={item.id} className="db-margin-row">
                  <div className="db-margin-name">{item.name}</div>
                  <div className="db-margin-track">
                    <div className="db-margin-fill" style={{ width: `${Math.max(0, Math.min(100, item.margin))}%`, background: getMarginColor(item.margin) }} />
                  </div>
                  <div className="db-margin-pct" style={{ color: getMarginColor(item.margin) }}>{item.margin.toFixed(1)}%</div>
                </div>
              ))
              : <div className="db-empty">No menu data yet</div>
            }
          </div>

          {/* RECENT INVOICES */}
          <div className="db-card" style={{ gridColumn: 4, gridRow: 1 }}>
            <div className="db-card-hd">
              <div className="db-card-title">
                <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Recent Invoices
              </div>
              <button className="db-card-act" onClick={() => router.push('/client/invoices')}>View all →</button>
            </div>
            {data.recentInvoices.length > 0
              ? data.recentInvoices.map(inv => (
                <div key={inv.id} className="db-row">
                  <div>
                    <div className="db-row-name">{inv.number}</div>
                    <div className="db-row-sub">{inv.supplier}</div>
                  </div>
                  <div>
                    <div className="db-row-val">{formatCurrency(inv.amount)}</div>
                    <div className="db-row-date">{formatDate(inv.date)}</div>
                  </div>
                </div>
              ))
              : <div className="db-empty">No invoices yet</div>
            }
          </div>

          {/* MONTHLY SPENDING */}
          <div className="db-card" style={{ gridColumn: '2/4', gridRow: 2 }}>
            <div className="db-card-hd">
              <div className="db-card-title">
                <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Monthly Spending
              </div>
              <button className="db-card-act" onClick={() => router.push('/client/invoices')}>View all →</button>
            </div>
            <div className="db-chart-outer">
              <div className="db-chart">
                {(data.monthlySpending || []).map(({ month, total }) => (
                  <div key={month} className="db-bar-col">
                    <div className="db-bar-track">
                      <div className="db-bar" style={{ height: `${Math.max(2, (total / maxSpend) * 92)}%`, background: getBarColor(total) }} />
                    </div>
                    <div className="db-bar-lbl">{month.slice(0, 3)}</div>
                  </div>
                ))}
              </div>
              <div className="db-legend">
                {[{ c: '#c04040', l: 'High (>$5k)' }, { c: '#d4a020', l: 'Moderate' }, { c: '#02a4ba', l: 'Normal' }, { c: '#1e1c18', l: 'No spend', b: '1px solid #2a2620' }].map(({ c, l, b }) => (
                  <div key={l} className="db-legend-item">
                    <div className="db-legend-dot" style={{ background: c, border: b }} />
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* TOP INGREDIENT COSTS */}
          <div className="db-card" style={{ gridColumn: 4, gridRow: 2 }}>
            <div className="db-card-hd">
              <div className="db-card-title">
                <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                Top Ingredient Costs
              </div>
            </div>
            {data.ingredientTrends.length > 0
              ? data.ingredientTrends.map(ing => (
                <div key={ing.name} className="db-row">
                  <div>
                    <div className="db-row-name" style={{ color: '#9a9086' }}>{ing.name}</div>
                    <div className="db-row-sub">per {ing.unit}</div>
                  </div>
                  <div className="db-ing-val">{formatCurrencyDetailed(ing.price)}</div>
                </div>
              ))
              : <div className="db-empty">No ingredient data yet</div>
            }
          </div>

        </div>
        )}
      </div>

      <Analytics />
      <SpeedInsights />
      <TourComponent />
    </>
  );
}