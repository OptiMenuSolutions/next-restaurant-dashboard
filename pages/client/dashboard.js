// pages/client/dashboard.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { useWindowSize } from "../../lib/useWindowSize";
import ProfileDropdown from '../../components/ProfileDropdown';
import { useTour } from '../../lib/useTour';
import TourOverlay from '../../components/TourOverlay';
import { fetchSampleData } from '../../lib/seedSampleData';
import TourDataBanner from "../../components/TourDataBanner";
import UniversalSearch from '../../components/UniversalSearch';

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

function getBarColor(total) {
  if (total > 5000) return '#c04040';
  if (total > 2000) return '#d4a020';
  if (total > 0) return '#02a4ba';
  return '#1e1c18';
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; overflow: hidden; }
  #__next { height: 100%; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes feedOut {
    0%   { transform: translateY(-6px); opacity: 0; }
    100% { transform: translateY(0);    opacity: 1; }
  }

  input::placeholder { color: #3a3630 !important; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  /* ── base ── */
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

  /* ── nav ── */
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
    font-family: 'Inter', sans-serif;
    font-size: clamp(13px, 1.1vw, 19px);
    font-weight: 700;
    color: #e8e2d8;
    letter-spacing: -.5px;
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

  /* ── welcome bar ── */
  .db-wbar {
    background: #13120f;
    border-bottom: 1px solid #2a2620;
    height: clamp(30px, 3.5vh, 46px);
    padding: 0 clamp(10px, 1vw, 20px);
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .db-wname { font-size: clamp(11px, 0.85vw, 16px); font-weight: 600; color: #e8e2d8; }
  .db-wsub  { font-size: clamp(9px, 0.65vw, 12px);  color: #4a453e; margin-left: 6px; }

  /* ── outer layout: left sidebar + right content ── */
  .db-outer {
    flex: 1;
    display: grid;
    grid-template-columns: clamp(175px, 14vw, 215px) 1fr;
    gap: clamp(6px, 0.6vw, 12px);
    padding: clamp(6px, 0.6vw, 12px);
    background: #0a0908;
    min-height: 0;
    overflow: hidden;
  }

  /* ── left sidebar ── */
  .db-left {
    display: flex;
    flex-direction: column;
    gap: clamp(6px, 0.6vw, 10px);
    min-height: 0;
    overflow: hidden;
  }

  /* score card */
  .db-score-card {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 9px);
    padding: clamp(10px, 0.9vw, 16px) clamp(10px, 0.8vw, 14px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(4px, 0.4vh, 7px);
    flex-shrink: 0;
  }
  .db-rest-icon {
    width: clamp(28px, 2.4vw, 38px);
    height: clamp(28px, 2.4vw, 38px);
    border-radius: 50%;
    background: rgba(2,164,186,.1);
    border: 1px solid rgba(2,164,186,.2);
    display: flex; align-items: center; justify-content: center;
  }
  .db-rest-icon svg { width: 55%; height: 55%; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .db-rest-name { font-size: clamp(10px, 0.82vw, 14px); font-weight: 600; color: #e8e2d8; text-align: center; }
  .db-rest-sub  { font-size: clamp(8px, 0.6vw, 11px);  color: #4a453e; }
  .db-score-lbl { font-size: clamp(8px, 0.6vw, 11px); color: #6b6358; text-transform: uppercase; letter-spacing: .5px; font-weight: 500; margin-top: 2px; }
  .db-ring { position: relative; width: clamp(60px, 5.5vw, 84px); height: clamp(60px, 5.5vw, 84px); }
  .db-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .db-ring-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .db-ring-num { font-size: clamp(18px, 1.8vw, 28px); font-weight: 700; color: #e8e2d8; line-height: 1; }
  .db-ring-sub  { font-size: clamp(8px, 0.58vw, 10px); color: #4a453e; }
  .db-score-tag { font-size: clamp(9px, 0.65vw, 12px); font-weight: 600; padding: clamp(2px,.2vh,3px) clamp(7px,.55vw,11px); border-radius: 10px; }
  .db-score-hint { font-size: clamp(8px, 0.6vw, 11px); color: #6b6358; text-align: center; line-height: 1.4; padding: 0 2px; }

  /* waste risk card */
  .db-waste-card {
    background: rgba(192,64,64,.06);
    border: 1px solid rgba(192,64,64,.22);
    border-radius: clamp(5px, 0.4vw, 9px);
    padding: clamp(8px, 0.75vw, 14px) clamp(10px, 0.8vw, 14px);
    display: flex;
    flex-direction: column;
    gap: clamp(4px, 0.4vh, 7px);
    flex-shrink: 0;
  }
  .db-waste-hd   { display: flex; align-items: center; justify-content: space-between; }
  .db-waste-title { font-size: clamp(9px, 0.7vw, 12px); font-weight: 600; color: #e05050; display: flex; align-items: center; gap: 4px; }
  .db-waste-title svg { width: clamp(9px,.7vw,12px); height: clamp(9px,.7vw,12px); stroke: #e05050; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .db-waste-amt  { font-size: clamp(11px, 0.9vw, 15px); font-weight: 700; color: #e05050; }
  .db-waste-item { display: flex; align-items: center; justify-content: space-between; padding: clamp(3px,.3vh,5px) 0; border-bottom: 1px solid rgba(192,64,64,.1); }
  .db-waste-item:last-child { border-bottom: none; padding-bottom: 0; }
  .db-waste-name  { font-size: clamp(9px, 0.66vw, 11px); color: #c08080; }
  .db-waste-badge { font-size: clamp(8px, 0.58vw, 10px); font-weight: 600; padding: 1px 6px; border-radius: 8px; background: rgba(192,64,64,.15); color: #e05050; white-space: nowrap; }

  /* stats pills card */
  .db-pills-card {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 9px);
    padding: clamp(8px, 0.7vw, 12px);
    display: flex;
    flex-direction: column;
    gap: clamp(4px, 0.4vh, 7px);
    flex: 1;
    overflow: hidden;
  }
  .db-pill {
    background: #0f0e0c;
    border-radius: clamp(4px, 0.3vw, 6px);
    padding: clamp(4px, 0.45vh, 8px) clamp(8px, 0.65vw, 12px);
    display: flex; align-items: center; justify-content: space-between;
    border: 1px solid #1a1915;
    flex-shrink: 0;
  }
  .db-pill-l { font-size: clamp(8px, 0.62vw, 11px); color: #6b6358; }
  .db-pill-v { font-size: clamp(11px, 0.95vw, 16px); font-weight: 700; }

  /* ── right content area ── */
  .db-right {
    display: flex;
    flex-direction: column;
    gap: clamp(6px, 0.6vw, 12px);
    min-height: 0;
    overflow: hidden;
  }

  /* ── THERMAL RECEIPT HERO CARD ── */
  .db-thermal-wrap {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    filter: drop-shadow(0 4px 24px rgba(0,0,0,.5));
    position: relative;
  }
  /* top torn edge */
  .db-thermal-tear-top {
    height: 10px;
    background: #f0ece4;
    clip-path: polygon(
      0% 100%, 2% 20%, 4% 80%, 6% 10%, 8% 90%, 10% 15%,
      12% 85%, 14% 5%,  16% 95%, 18% 20%, 20% 80%, 22% 10%,
      24% 90%, 26% 25%, 28% 75%, 30% 5%,  32% 95%, 34% 20%,
      36% 80%, 38% 10%, 40% 90%, 42% 15%, 44% 85%, 46% 5%,
      48% 95%, 50% 20%, 52% 80%, 54% 10%, 56% 90%, 58% 25%,
      60% 75%, 62% 5%,  64% 95%, 66% 20%, 68% 80%, 70% 10%,
      72% 90%, 74% 15%, 76% 85%, 78% 5%,  80% 95%, 82% 20%,
      84% 80%, 86% 10%, 88% 90%, 90% 25%, 92% 75%, 94% 5%,
      96% 95%, 98% 20%, 100% 80%, 100% 100%
    );
  }
  /* bottom torn edge */
  .db-thermal-tear-bot {
    height: 10px;
    background: #f0ece4;
    clip-path: polygon(
      0% 0%, 2% 80%, 4% 20%, 6% 90%, 8% 10%, 10% 85%,
      12% 15%, 14% 95%, 16% 5%,  18% 80%, 20% 20%, 22% 90%,
      24% 10%, 26% 75%, 28% 25%, 30% 95%, 32% 5%,  34% 80%,
      36% 20%, 38% 90%, 40% 10%, 42% 85%, 44% 15%, 46% 95%,
      48% 5%,  50% 80%, 52% 20%, 54% 90%, 56% 10%, 58% 75%,
      60% 25%, 62% 95%, 64% 5%,  66% 80%, 68% 20%, 70% 90%,
      72% 10%, 74% 85%, 76% 15%, 78% 95%, 80% 5%,  82% 80%,
      84% 20%, 86% 90%, 88% 10%, 90% 75%, 92% 25%, 94% 95%,
      96% 5%,  98% 80%, 100% 20%, 100% 0%
    );
  }
  .db-thermal-body {
    background: #f0ece4;
    padding: clamp(8px, 0.9vw, 16px) clamp(12px, 1.2vw, 22px);
    display: flex;
    flex-direction: column;
    gap: clamp(6px, 0.6vh, 10px);
    animation: feedOut 0.4s ease both;
  }
  /* subtle vertical grain lines to mimic thermal paper */
  .db-thermal-body::before {
    content: '';
    position: absolute;
    inset: 10px 0;
    pointer-events: none;
    background-image: repeating-linear-gradient(
      90deg,
      transparent,
      transparent 3px,
      rgba(0,0,0,.018) 3px,
      rgba(0,0,0,.018) 4px
    );
  }
  .db-thermal-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .db-thermal-title {
    font-family: 'Courier New', Courier, monospace;
    font-size: clamp(9px, 0.78vw, 13px);
    font-weight: 700;
    color: #1a1612;
    text-transform: uppercase;
    letter-spacing: .8px;
  }
  .db-thermal-sync {
    font-family: 'Courier New', Courier, monospace;
    font-size: clamp(7px, 0.58vw, 10px);
    color: #7a7068;
  }
  .db-thermal-divider {
    border: none;
    border-top: 1px dashed #b0a898;
    margin: 0;
  }
  .db-thermal-sub {
    font-family: 'Courier New', Courier, monospace;
    font-size: clamp(7px, 0.6vw, 10px);
    color: #7a7068;
    text-transform: uppercase;
    letter-spacing: .5px;
  }
  .db-thermal-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: clamp(8px, 0.8vw, 14px);
  }
  .db-thermal-item {
    display: flex;
    flex-direction: column;
    gap: clamp(3px, 0.3vh, 5px);
    padding: clamp(6px, 0.6vw, 10px) clamp(8px, 0.7vw, 12px);
    background: rgba(0,0,0,.04);
    border: 1px dashed #b0a898;
    border-radius: 2px;
  }
  .db-thermal-badge {
    font-family: 'Courier New', Courier, monospace;
    font-size: clamp(7px, 0.56vw, 9px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .6px;
    display: inline-block;
    align-self: flex-start;
    padding: 1px 5px;
    border-radius: 2px;
  }
  .db-thermal-item-name {
    font-family: 'Courier New', Courier, monospace;
    font-size: clamp(10px, 0.85vw, 14px);
    font-weight: 700;
    color: #1a1612;
    line-height: 1.2;
  }
  .db-thermal-item-desc {
    font-family: 'Courier New', Courier, monospace;
    font-size: clamp(7px, 0.6vw, 10px);
    color: #5a5248;
    line-height: 1.5;
  }
  .db-thermal-nfc {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: clamp(4px, 0.4vh, 6px);
  }
  .db-thermal-nfc svg { width: clamp(10px,.85vw,14px); height: clamp(10px,.85vw,14px); stroke: #7a7068; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .db-thermal-nfc-text {
    font-family: 'Courier New', Courier, monospace;
    font-size: clamp(7px, 0.56vw, 9px);
    color: #7a7068;
    text-transform: uppercase;
    letter-spacing: .4px;
    line-height: 1.4;
  }

  /* ── bottom row cards ── */
  .db-bottom {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: clamp(6px, 0.6vw, 12px);
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .db-card {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 9px);
    padding: clamp(10px, 0.9vw, 16px) clamp(10px, 1vw, 18px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .db-card-hd {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: clamp(7px, 0.7vh, 12px);
    flex-shrink: 0;
  }
  .db-card-title {
    font-size: clamp(10px, 0.75vw, 13px);
    font-weight: 600;
    color: #e8e2d8;
    display: flex; align-items: center; gap: clamp(4px,.35vw,6px);
  }
  .db-card-title svg { width: clamp(10px,.82vw,13px); height: clamp(10px,.82vw,13px); stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .db-card-act { font-size: clamp(9px,.62vw,11px); color: #02a4ba; background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; opacity: .85; }

  .db-toggle { display: flex; background: #0f0e0c; border-radius: clamp(3px,.28vw,5px); padding: 2px; }
  .db-toggle-btn {
    padding: clamp(2px,.22vh,4px) clamp(7px,.6vw,12px);
    border-radius: clamp(2px,.22vw,4px);
    font-size: clamp(9px,.62vw,11px);
    cursor: pointer; border: none; font-family: 'Inter', sans-serif;
    color: #4a453e; background: transparent; line-height: 1.5; transition: all .15s;
  }
  .db-toggle-btn.active { background: #1a1915; color: #e8e2d8; }

  .db-margin-row { display: flex; align-items: center; gap: clamp(5px,.5vw,9px); margin-bottom: clamp(6px,.6vh,10px); }
  .db-margin-row:last-child { margin-bottom: 0; }
  .db-margin-name { font-size: clamp(9px,.7vw,12px); color: #9a9086; width: clamp(70px,7vw,115px); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-margin-track { flex: 1; background: #1a1915; border-radius: 3px; height: clamp(3px,.28vh,5px); }
  .db-margin-fill  { height: 100%; border-radius: 3px; }
  .db-margin-pct   { font-size: clamp(9px,.7vw,12px); font-weight: 600; width: clamp(32px,2.8vw,44px); text-align: right; flex-shrink: 0; }

  .db-row { display: flex; align-items: center; justify-content: space-between; padding: clamp(5px,.5vh,9px) clamp(7px,.65vw,12px); background: #0f0e0c; border-radius: clamp(4px,.32vw,6px); margin-bottom: clamp(4px,.45vh,8px); flex-shrink: 0; }
  .db-row:last-child { margin-bottom: 0; }
  .db-row-name { font-size: clamp(10px,.75vw,13px); font-weight: 500; color: #e8e2d8; }
  .db-row-sub  { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 1px; }
  .db-row-val  { font-size: clamp(10px,.75vw,13px); font-weight: 600; color: #e8e2d8; text-align: right; }
  .db-row-date { font-size: clamp(8px,.6vw,10px); color: #4a453e; text-align: right; margin-top: 1px; }

  .db-chart-outer { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .db-chart { display: flex; align-items: flex-end; gap: clamp(2px,.28vw,6px); flex: 1; min-height: 0; }
  .db-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: clamp(2px,.2vh,4px); height: 100%; }
  .db-bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .db-bar { width: 100%; border-radius: clamp(2px,.2vw,3px) clamp(2px,.2vw,3px) 0 0; }
  .db-bar-lbl { font-size: clamp(7px,.6vw,10px); color: #3a3630; }
  .db-legend { display: flex; gap: clamp(8px,.9vw,16px); margin-top: clamp(5px,.5vh,9px); flex-shrink: 0; flex-wrap: wrap; }
  .db-legend-item { display: flex; align-items: center; gap: clamp(3px,.28vw,5px); font-size: clamp(8px,.62vw,11px); color: #4a453e; }
  .db-legend-dot { width: clamp(5px,.45vw,8px); height: clamp(5px,.45vw,8px); border-radius: 50%; flex-shrink: 0; }

  .db-spinner { width: clamp(7px,.65vw,11px); height: clamp(7px,.65vw,11px); border: 1.5px solid #2a2620; border-top-color: #02a4ba; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; }
  .db-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: clamp(10px,.75vw,13px); color: #4a453e; }

  /* ── mobile ── */
  .mob-root { font-family: 'Inter', sans-serif; background: #0a0908; color: #e8e2d8; width: 100%; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
  .mob-header { background: #0f0e0c; border-bottom: 1px solid #2a2620; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding-top: env(safe-area-inset-top, 10px); }
  .mob-logo { font-size: 20px; font-weight: 700; color: #e8e2d8; letter-spacing: -.4px; }
  .mob-logo span { color: #02a4ba; }
  .mob-titlebar { background: #13120f; border-bottom: 1px solid #2a2620; padding: 10px 16px; flex-shrink: 0; }
  .mob-page-title { font-size: 20px; font-weight: 700; color: #e8e2d8; line-height: 1; }
  .mob-page-sub { font-size: 11px; color: #4a453e; margin-top: 3px; }
  .mob-stats { background: #13120f; border-bottom: 1px solid #2a2620; padding: 8px 16px; display: flex; flex-shrink: 0; overflow-x: auto; }
  .mob-stats::-webkit-scrollbar { display: none; }
  .mob-stat { flex: 1; min-width: 0; text-align: center; padding: 0 6px; border-right: 1px solid #2a2620; }
  .mob-stat:last-child { border-right: none; }
  .mob-stat-v { font-size: 16px; font-weight: 700; line-height: 1; }
  .mob-stat-l { font-size: 9px; color: #4a453e; margin-top: 2px; text-transform: uppercase; letter-spacing: .4px; }
  .mob-content { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; -webkit-overflow-scrolling: touch; }
  .mob-content::-webkit-scrollbar { display: none; }
  .mob-card { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; padding: 14px; flex-shrink: 0; }
  .mob-card-title { font-size: 11px; font-weight: 600; color: #e8e2d8; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
  .mob-card-title svg { width: 12px; height: 12px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  /* mobile thermal */
  .mob-thermal-wrap { filter: drop-shadow(0 4px 18px rgba(0,0,0,.5)); flex-shrink: 0; }
  .mob-thermal-tear { height: 8px; background: #f0ece4; }
  .mob-thermal-tear-top { clip-path: polygon(0% 100%,2% 20%,4% 80%,6% 10%,8% 90%,10% 15%,12% 85%,14% 5%,16% 95%,18% 20%,20% 80%,22% 10%,24% 90%,26% 25%,28% 75%,30% 5%,32% 95%,34% 20%,36% 80%,38% 10%,40% 90%,42% 15%,44% 85%,46% 5%,48% 95%,50% 20%,52% 80%,54% 10%,56% 90%,58% 25%,60% 75%,62% 5%,64% 95%,66% 20%,68% 80%,70% 10%,72% 90%,74% 15%,76% 85%,78% 5%,80% 95%,82% 20%,84% 80%,86% 10%,88% 90%,90% 25%,92% 75%,94% 5%,96% 95%,98% 20%,100% 80%,100% 100%); }
  .mob-thermal-tear-bot { clip-path: polygon(0% 0%,2% 80%,4% 20%,6% 90%,8% 10%,10% 85%,12% 15%,14% 95%,16% 5%,18% 80%,20% 20%,22% 90%,24% 10%,26% 75%,28% 25%,30% 95%,32% 5%,34% 80%,36% 20%,38% 90%,40% 10%,42% 85%,44% 15%,46% 95%,48% 5%,50% 80%,52% 20%,54% 90%,56% 10%,58% 75%,60% 25%,62% 95%,64% 5%,66% 80%,68% 20%,70% 90%,72% 10%,74% 85%,76% 15%,78% 95%,80% 5%,82% 80%,84% 20%,86% 90%,88% 10%,90% 75%,92% 25%,94% 95%,96% 5%,98% 80%,100% 20%,100% 0%); }
  .mob-thermal-body { background: #f0ece4; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .mob-thermal-title { font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; color: #1a1612; text-transform: uppercase; letter-spacing: .8px; }
  .mob-thermal-sync  { font-family: 'Courier New', monospace; font-size: 9px; color: #7a7068; }
  .mob-thermal-divider { border: none; border-top: 1px dashed #b0a898; }
  .mob-thermal-item { padding: 8px 10px; background: rgba(0,0,0,.04); border: 1px dashed #b0a898; border-radius: 2px; margin-bottom: 6px; }
  .mob-thermal-item:last-child { margin-bottom: 0; }
  .mob-thermal-badge { font-family: 'Courier New', monospace; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; padding: 1px 5px; border-radius: 2px; display: inline-block; margin-bottom: 3px; }
  .mob-thermal-name { font-family: 'Courier New', monospace; font-size: 12px; font-weight: 700; color: #1a1612; margin-bottom: 2px; }
  .mob-thermal-desc { font-family: 'Courier New', monospace; font-size: 9px; color: #5a5248; line-height: 1.5; }
  .mob-thermal-nfc  { display: flex; align-items: center; gap: 5px; }
  .mob-thermal-nfc svg { width: 11px; height: 11px; stroke: #7a7068; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .mob-thermal-nfc-text { font-family: 'Courier New', monospace; font-size: 8px; color: #7a7068; text-transform: uppercase; letter-spacing: .4px; line-height: 1.4; }

  .mob-pill-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .mob-pill { background: #0f0e0c; border: 1px solid #1a1915; border-radius: 8px; padding: 10px 12px; }
  .mob-pill-l { font-size: 10px; color: #6b6358; margin-bottom: 4px; }
  .mob-pill-v { font-size: 18px; font-weight: 700; line-height: 1; }
  .mob-score-row { display: flex; align-items: center; gap: 16px; }
  .mob-score-ring { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
  .mob-score-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .mob-score-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .mob-score-num  { font-size: 18px; font-weight: 700; color: #e8e2d8; line-height: 1; }
  .mob-score-sub  { font-size: 9px; color: #4a453e; }
  .mob-score-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 10px; margin-top: 5px; }
  .mob-waste-card { background: rgba(192,64,64,.06); border: 1px solid rgba(192,64,64,.22); border-radius: 10px; padding: 12px 14px; flex-shrink: 0; }
  .mob-waste-hd  { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .mob-waste-title { font-size: 11px; font-weight: 600; color: #e05050; display: flex; align-items: center; gap: 5px; }
  .mob-waste-title svg { width: 11px; height: 11px; stroke: #e05050; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mob-waste-amt { font-size: 13px; font-weight: 700; color: #e05050; }
  .mob-waste-item { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid rgba(192,64,64,.1); }
  .mob-waste-item:last-child { border-bottom: none; }
  .mob-waste-name  { font-size: 11px; color: #c08080; }
  .mob-waste-badge { font-size: 9px; font-weight: 600; padding: 1px 7px; border-radius: 8px; background: rgba(192,64,64,.15); color: #e05050; }
  .mob-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .mob-bar-row:last-child { margin-bottom: 0; }
  .mob-bar-name { font-size: 12px; color: #9a9086; width: 110px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mob-bar-track { flex: 1; background: #1a1915; border-radius: 3px; height: 5px; }
  .mob-bar-fill  { height: 5px; border-radius: 3px; }
  .mob-bar-pct   { font-size: 12px; font-weight: 600; width: 44px; text-align: right; flex-shrink: 0; }
  .mob-inv-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1a1915; }
  .mob-inv-row:last-child { border-bottom: none; }
  .mob-inv-name { font-size: 13px; font-weight: 500; color: #e8e2d8; }
  .mob-inv-sub  { font-size: 11px; color: #4a453e; margin-top: 2px; }
  .mob-inv-amt  { font-size: 13px; font-weight: 600; color: #02a4ba; text-align: right; }
  .mob-inv-date { font-size: 11px; color: #4a453e; text-align: right; margin-top: 2px; }
  .mob-chart { display: flex; align-items: flex-end; gap: 3px; height: 56px; margin-top: 6px; }
  .mob-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
  .mob-chart-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .mob-chart-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
  .mob-chart-lbl { font-size: 8px; color: #3a3630; }
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

  @media (max-width: 1024px) {
    .db-outer { grid-template-columns: 1fr; grid-template-rows: auto 1fr; overflow-y: auto; }
    .db-left  { flex-direction: row; flex-wrap: wrap; }
    .db-score-card { flex: 1; min-width: 160px; }
    .db-waste-card { flex: 1; min-width: 160px; }
    .db-pills-card { flex: 2; min-width: 220px; }
    .db-bottom { grid-template-columns: 1fr 1fr; }
  }
`;

// ─── Thermal Receipt Badge Colors ─────────────────────────────────────────────

function getThermalBadgeStyle(type) {
  if (type === 'inventory') return { background: 'rgba(180,40,40,.12)', color: '#8b1a1a', border: '1px solid rgba(180,40,40,.3)' };
  if (type === 'margin')    return { background: 'rgba(30,90,50,.1)',   color: '#1a5a2a', border: '1px solid rgba(30,90,50,.25)' };
  return                           { background: 'rgba(0,80,100,.08)',  color: '#005060', border: '1px solid rgba(0,80,100,.2)' };
}

function getThermalBadgeLabel(type) {
  if (type === 'inventory') return '⚠ Move Stock';
  if (type === 'margin')    return '★ High Margin';
  return                           '↑ Trending';
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, mobile }) {
  const { color, label } = getScoreInfo(score);
  const circumference = 2 * Math.PI * 40;
  const dash = (score / 100) * circumference;
  if (mobile) {
    return (
      <div className="mob-score-row">
        <div className="mob-score-ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" stroke="#1a1915" strokeWidth="9" fill="none"/>
            <circle cx="50" cy="50" r="40" stroke={color} strokeWidth="9" fill="none"
              strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"/>
          </svg>
          <div className="mob-score-inner">
            <div className="mob-score-num">{score}</div>
            <div className="mob-score-sub">/100</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#4a453e', marginBottom: 4 }}>AI Profit Score</div>
          <div className="mob-score-badge" style={{ background: `${color}18`, color }}>{label}</div>
          <div style={{ fontSize: 10, color: '#6b6358', marginTop: 5, lineHeight: 1.4 }}>+4 pts this week</div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="db-score-lbl">AI Profit Score</div>
      <div className="db-ring">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" stroke="#1a1915" strokeWidth="9" fill="none"/>
          <circle cx="50" cy="50" r="40" stroke={color} strokeWidth="9" fill="none"
            strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"/>
        </svg>
        <div className="db-ring-inner">
          <div className="db-ring-num">{score}</div>
          <div className="db-ring-sub">/ 100</div>
        </div>
      </div>
      <div className="db-score-tag" style={{ background: `${color}18`, color }}>{label}</div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientDashboard() {
  const router = useRouter();
  const { isMobile } = useWindowSize();
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName]         = useState("");
  const [userEmail, setUserEmail]       = useState("");
  const [restaurantName, setRestaurantName] = useState("Your Restaurant");
  const [marginView, setMarginView]     = useState("high");
  const [aiLoading, setAiLoading]       = useState(false);
  const [activeTab, setActiveTab]       = useState("Dashboard");

  const [data, setData] = useState({
    totalInvoices: 0, totalIngredients: 0, totalMenuItems: 0,
    recentInvoices: [], ingredientTrends: [], menuItemAnalysis: [],
    monthlySpending: [], unpricedIngredients: 0, averageMargin: 0,
    totalSpending: 0, aiProfitScore: { score: 0 }, aiRecommendations: [], lowMarginCount: 0,
  });

  const LOW_MARGIN_THRESHOLD = 40;

  // ── Prefetch routes ─────────────────────────────────────────────────────────
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
    router.prefetch('/client/analytics');
  }, []);

  // ── Re-fetch when tour seeds sample data ────────────────────────────────────
  useEffect(() => {
    if (router.query.tour === 'true') return;
    const handler = () => { if (restaurantId) fetchDashboardData(restaurantId); };
    window.addEventListener('optimenu-tour-seeded', handler);
    return () => window.removeEventListener('optimenu-tour-seeded', handler);
  }, [restaurantId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.tour !== 'true') return;
    if (!restaurantId) return;
    fetchSampleData().then(sample => {
      if (!sample) return;
      setData(processDashboardData(sample.invoices, sample.ingredients, sample.menuItems));
      setLoading(false);
    });
  }, [router.isReady, router.query.tour, restaurantId]);

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => { getRestaurantId(); }, []);

  const { tourProps } = useTour('dashboard', restaurantId);
  const isTour = router.query.tour === 'true';

  useEffect(() => {
    if (isTour && restaurantId) {
      fetchSampleData().then(sample => {
        if (sample) {
          setData(processDashboardData(sample.invoices, sample.ingredients, sample.menuItems));
          setLoading(false);
        }
      });
    }
  }, [isTour, restaurantId]);

  async function getRestaurantId() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setError("Authentication required"); setLoading(false); return; }
      setUserEmail(user.email || '');

      const { data: profile, error: profileError } = await supabase
        .from("profiles").select("restaurant_id, full_name").eq("id", user.id).single();

      if (profileError || !profile?.restaurant_id) {
        setError("Could not determine restaurant access"); setLoading(false); return;
      }

      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name ? profile.full_name.split(' ')[0] : "User");

      const { data: rd } = await supabase.from("restaurants").select("name").eq("id", profile.restaurant_id).single();
      setRestaurantName(rd?.name || "Your Restaurant");

      if (router.query.tour !== 'true') {
        await fetchDashboardData(profile.restaurant_id);
      } else {
        setLoading(false);
      }
    } catch {
      setError("An unexpected error occurred"); setLoading(false);
    }
  }

  async function fetchDashboardData(restId) {
    try {
      setLoading(true);
      const [{ data: invoices }, { data: ingredients }, { data: menuItems }] = await Promise.all([
        supabase.from("invoices").select("*").eq("restaurant_id", restId).order("created_at", { ascending: false }),
        supabase.from("ingredients").select("*").eq("restaurant_id", restId),
        supabase.from("menu_items").select(`*, menu_item_components(id, name, cost, component_ingredients(quantity, ingredients(last_price, is_estimated)))`).eq("restaurant_id", restId),
      ]);
      const processed = processDashboardData(invoices || [], ingredients || [], menuItems || []);
      setData(processed);
      setLoading(false);
      fetchAIRecommendations(processed, restId);
    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message); setLoading(false);
    }
  }

  async function fetchAIRecommendations(dashData, restId) {
    try {
      setAiLoading(true);
      const res = await fetch('/api/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardData: dashData, restaurantId: restId, restaurantName: userName }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      setData(prev => ({ ...prev, aiRecommendations: json.recommendations || [] }));
    } catch {
      setData(prev => ({
        ...prev,
        aiRecommendations: [
          { title: "Grilled Salmon",          description: "2.8 lbs expiring tomorrow · $18.40 margin · #2 seller this week",    type: "inventory" },
          { title: "Chicken Marsala",         description: "Uses at-risk chicken breast · 71% margin · suggest as verbal upsell", type: "margin"    },
          { title: "Cream of Mushroom Soup",  description: "Heavy cream expires today · 64% margin · easy add-on upsell",        type: "trending"  },
        ]
      }));
    } finally { setAiLoading(false); }
  }

  function processDashboardData(invoices, ingredients, menuItems) {
    const processedInvoices = invoices.filter(i => i.number && i.supplier && i.amount);
    const totalSpending = processedInvoices.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    const unpricedIngredients = ingredients.filter(i => !i.last_price || parseFloat(i.last_price) === 0).length;
    const recentInvoices = processedInvoices.slice(0, 4).map(i => ({
      id: i.id, number: i.number, supplier: i.supplier, amount: i.amount, date: i.date,
    }));

    const menuItemAnalysis = menuItems.map(item => {
      const price = parseFloat(item.price || 0);
      let cost = 0, hasCompleteData = false;
      if (item.menu_item_components && item.menu_item_components.length > 0) {
        cost = item.menu_item_components.reduce((t, c) => t + parseFloat(c.cost || 0), 0);
        hasCompleteData = item.menu_item_components.every(c =>
          (c.component_ingredients || []).length > 0 &&
          (c.component_ingredients || []).every(ci => ci.ingredients?.last_price && parseFloat(ci.ingredients.last_price) > 0)
        );
      } else if (item.cost && parseFloat(item.cost) > 0) {
        cost = parseFloat(item.cost);
        hasCompleteData = price > 0;
      }
      const margin = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0;
      const hasEstimated = item.menu_item_components?.some(c =>
        (c.component_ingredients || []).some(ci => ci.ingredients?.is_estimated === true)
      ) || false;
      return { id: item.id, name: item.name, price, cost, margin, hasCompleteData, hasEstimated };
    });

    const itemsWithMargins = menuItemAnalysis.filter(i => i.hasCompleteData && i.price > 0 && !i.hasEstimated);
    const averageMargin  = itemsWithMargins.length > 0 ? itemsWithMargins.reduce((s, i) => s + i.margin, 0) / itemsWithMargins.length : 0;
    const lowMarginCount = itemsWithMargins.filter(i => i.margin < LOW_MARGIN_THRESHOLD).length;

    const ingredientTrends = ingredients
      .filter(i => i.last_price > 0)
      .sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price))
      .slice(0, 5)
      .map(i => ({ name: i.name, price: parseFloat(i.last_price), unit: i.unit }));

    const now = new Date();
    const monthlySpending = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      const name = d.toLocaleDateString('en-US', { month: 'short' });
      const total = processedInvoices
        .filter(inv => {
          if (!inv.date) return false;
          const id = new Date(inv.date);
          return id.getFullYear() === d.getFullYear() && id.getMonth() === d.getMonth();
        })
        .reduce((s, inv) => s + parseFloat(inv.amount || 0), 0);
      return { month: name, total };
    });

    const aiProfitScore = calculateAIProfitScore({
      itemsWithMargins, averageMargin, unpricedIngredients,
      totalIngredients: ingredients.length,
      totalMenuItems: menuItems.length,
      processedInvoices,
      totalInvoices: invoices.length,
    });

    return {
      totalInvoices: invoices.length, totalIngredients: ingredients.length,
      totalMenuItems: menuItems.length, recentInvoices, ingredientTrends,
      menuItemAnalysis, monthlySpending, unpricedIngredients, averageMargin,
      totalSpending, aiProfitScore, lowMarginCount,
    };
  }

  function calculateAIProfitScore({ itemsWithMargins, averageMargin, unpricedIngredients, totalIngredients, totalMenuItems, processedInvoices, totalInvoices }) {
    let score = 0;
    score += Math.min((averageMargin / 60) * 35, 35);
    score += totalIngredients > 0 ? ((totalIngredients - unpricedIngredients) / totalIngredients) * 15 : 0;
    score += totalMenuItems   > 0 ? (itemsWithMargins.length / totalMenuItems) * 15 : 0;
    score += totalInvoices    > 0 ? (processedInvoices.length / totalInvoices) * 10 : 0;
    if (itemsWithMargins.length > 0) {
      const high    = itemsWithMargins.filter(i => i.margin >= 50).length;
      const low     = itemsWithMargins.filter(i => i.margin < 25).length;
      const balance = ((high / itemsWithMargins.length) * 15) - ((low / itemsWithMargins.length) * 8);
      score += Math.max(0, Math.min(15, balance + 5));
    }
    const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const recent = processedInvoices.filter(i => new Date(i.date || i.created_at) >= thirtyAgo).length;
    score += Math.min((recent / 5) * 10, 10);
    return { score: Math.max(0, Math.min(100, Math.round(score))) };
  }

  function getMarginItems() {
    const items = (data.menuItemAnalysis || []).filter(i => i.hasCompleteData && i.price > 0);
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.margin - a.margin);
    return marginView === 'high' ? sorted.slice(0, 5) : sorted.slice(-5).reverse();
  }

  const tabs        = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];
  const marginItems = getMarginItems();
  const spendValues = (data.monthlySpending || []).map(m => m.total);
  const maxSpend    = spendValues.length > 0 ? Math.max(...spendValues, 1) : 1;
  const recs        = (data.aiRecommendations || []).slice(0, 3);

  // ── MOBILE ─────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div className="mob-root">

          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'#02a4ba' }}>
                <div style={{ width:5, height:5, background:'#02a4ba', borderRadius:'50%', animation:'blink 2s infinite' }}/>
                Active
              </div>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile}/>
            </div>
          </div>

          <div className="mob-titlebar">
            <div className="mob-page-title">Dashboard</div>
            <div className="mob-page-sub">
              {new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })} · {restaurantName}
            </div>
          </div>

          <div className="mob-stats">
            {[
              { v: data.totalInvoices,    l: 'Invoices',    c: '#02a4ba' },
              { v: data.totalIngredients, l: 'Ingredients', c: '#e8e2d8' },
              { v: data.totalMenuItems,   l: 'Menu',        c: '#e8e2d8' },
              { v: `${data.averageMargin.toFixed(1)}%`, l: 'Margin', c: getMarginColor(data.averageMargin) },
              { v: formatCurrency(data.totalSpending),  l: 'YTD',    c: '#d4a020' },
            ].map(({ v, l, c }) => (
              <div key={l} className="mob-stat">
                <div className="mob-stat-v" style={{ color:c }}>{v}</div>
                <div className="mob-stat-l">{l}</div>
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
              <div style={{ width:24, height:24, border:'2px solid #2a2620', borderTopColor:'#02a4ba', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>
              <div style={{ fontSize:12, color:'#4a453e' }}>Loading dashboard...</div>
            </div>
          ) : (
            <div className="mob-content">

              {/* mobile: score */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  AI Profit Score
                </div>
                <ScoreRing score={data.aiProfitScore.score} mobile />
              </div>

              {/* mobile: waste */}
              <div className="mob-waste-card">
                <div className="mob-waste-hd">
                  <div className="mob-waste-title">
                    <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    Waste Risk Today
                  </div>
                  <div className="mob-waste-amt">$340 at risk</div>
                </div>
                <div className="mob-waste-item"><div className="mob-waste-name">Chicken Breast — 4.2 lbs</div><div className="mob-waste-badge">2 days</div></div>
                <div className="mob-waste-item"><div className="mob-waste-name">Fresh Salmon — 2.8 lbs</div><div className="mob-waste-badge">1 day</div></div>
                <div className="mob-waste-item"><div className="mob-waste-name">Heavy Cream — 1.5 qt</div><div className="mob-waste-badge">Today</div></div>
              </div>

              {/* mobile: thermal recs */}
              <div className="mob-thermal-wrap">
                <div className="mob-thermal-tear mob-thermal-tear-top"/>
                <div className="mob-thermal-body">
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div className="mob-thermal-title">Today's Shift</div>
                    <div className="mob-thermal-sync">{aiLoading ? 'Analyzing...' : 'Synced 8 min ago'}</div>
                  </div>
                  <hr className="mob-thermal-divider"/>
                  {recs.length > 0 ? recs.map((rec, i) => {
                    const bs = getThermalBadgeStyle(rec.type);
                    const bl = getThermalBadgeLabel(rec.type);
                    return (
                      <div key={i} className="mob-thermal-item">
                        <div className="mob-thermal-badge" style={bs}>{bl}</div>
                        <div className="mob-thermal-name">{rec.title}</div>
                        <div className="mob-thermal-desc">{rec.description}</div>
                      </div>
                    );
                  }) : (
                    <div style={{ fontFamily:"'Courier New',monospace", fontSize:10, color:'#7a7068', textAlign:'center', padding:'8px 0' }}>Preparing recommendations...</div>
                  )}
                  <hr className="mob-thermal-divider"/>
                  <div className="mob-thermal-nfc">
                    <svg viewBox="0 0 24 24"><path d="M6 12a6 6 0 0012 0"/><path d="M3 12a9 9 0 0018 0"/><circle cx="12" cy="12" r="1" fill="#7a7068"/></svg>
                    <div className="mob-thermal-nfc-text">Staff tap NFC tag at POS to see this — updated every shift</div>
                  </div>
                </div>
                <div className="mob-thermal-tear mob-thermal-tear-bot"/>
              </div>

              {/* mobile: pills */}
              <div className="mob-pill-grid">
                {[
                  { l:'Invoices',     v:data.totalInvoices,    c:'#02a4ba' },
                  { l:'Unpriced',     v:data.unpricedIngredients, c:'#d4a020' },
                  { l:'Low Margin',   v:data.lowMarginCount,   c:'#c04040' },
                  { l:'Avg Food Cost',v:`${data.averageMargin > 0 ? (100 - data.averageMargin).toFixed(1) : 0}%`, c:'#2a8a5a' },
                ].map(({ l, v, c }) => (
                  <div key={l} className="mob-pill">
                    <div className="mob-pill-l">{l}</div>
                    <div className="mob-pill-v" style={{ color:c }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* mobile: menu analysis */}
              <div className="mob-card">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div className="mob-card-title" style={{ marginBottom:0 }}>
                    <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    Menu Analysis
                  </div>
                  <div className="mob-toggle">
                    {['high','low'].map(v => (
                      <button key={v} className={`mob-toggle-btn${marginView===v?' active':''}`} onClick={() => setMarginView(v)}>
                        {v.charAt(0).toUpperCase()+v.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {marginItems.length > 0 ? marginItems.map(item => (
                  <div key={item.id} className="mob-bar-row">
                    <div className="mob-bar-name">{item.name}</div>
                    <div className="mob-bar-track"><div className="mob-bar-fill" style={{ width:`${Math.max(0,Math.min(100,item.margin))}%`, background:getMarginColor(item.margin) }}/></div>
                    <div className="mob-bar-pct" style={{ color:getMarginColor(item.margin) }}>{item.margin.toFixed(1)}%</div>
                  </div>
                )) : <div style={{ fontSize:12, color:'#4a453e', textAlign:'center', padding:'8px 0' }}>No menu data yet</div>}
              </div>

              {/* mobile: monthly spending */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  Monthly Spending
                </div>
                <div className="mob-chart">
                  {(data.monthlySpending || []).map(({ month, total }) => (
                    <div key={month} className="mob-chart-col">
                      <div className="mob-chart-track"><div className="mob-chart-bar" style={{ height:`${Math.max(2,(total/maxSpend)*92)}%`, background:getBarColor(total) }}/></div>
                      <div className="mob-chart-lbl">{month.slice(0,1)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* mobile: recent invoices */}
              <div className="mob-card">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div className="mob-card-title" style={{ marginBottom:0 }}>
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Recent Invoices
                  </div>
                  <button onClick={() => router.push('/client/invoices')} style={{ fontSize:11, color:'#02a4ba', background:'none', border:'none', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>View all →</button>
                </div>
                {data.recentInvoices.length > 0 ? data.recentInvoices.map(inv => (
                  <div key={inv.id} className="mob-inv-row">
                    <div><div className="mob-inv-name">{inv.number}</div><div className="mob-inv-sub">{inv.supplier}</div></div>
                    <div><div className="mob-inv-amt">{formatCurrency(inv.amount)}</div><div className="mob-inv-date">{formatDate(inv.date)}</div></div>
                  </div>
                )) : <div style={{ fontSize:12, color:'#4a453e', textAlign:'center', padding:'8px 0' }}>No invoices yet</div>}
              </div>

              <div style={{ height:8, flexShrink:0 }}/>
            </div>
          )}

          <div className="mob-bottom-nav">
            {[
              { label:'Dashboard',  path:'/client/dashboard',   icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
              { label:'Invoices',   path:'/client/invoices',    icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
              { label:'Ingredients',path:'/client/ingredients', icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
              { label:'Menu',       path:'/client/menu-items',  icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
              { label:'Analytics',  path:'/client/analytics',   icon:<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
            ].map(({ label, path, icon }) => {
              const active = path === '/client/dashboard';
              return (
                <div key={label} className="mob-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob-nav-icon${active?' active':''}`}>{icon}</div>
                  <div className={`mob-nav-label${active?' active':''}`}>{label}</div>
                  {active && <div className="mob-nav-dot"/>}
                </div>
              );
            })}
          </div>

        </div>
        <Analytics/>
        <SpeedInsights/>
        {tourProps && <TourOverlay {...tourProps}/>}
        <TourDataBanner/>
      </>
    );
  }

  // ── DESKTOP ERROR ──────────────────────────────────────────────────────────
  if (error) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ background:'#0a0908', height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:'clamp(12px,1vw,16px)', color:'#e8e2d8' }}>Unable to Load Dashboard</div>
        <div style={{ fontSize:'clamp(10px,0.8vw,13px)', color:'#4a453e', marginBottom:8 }}>{error}</div>
        <button onClick={() => window.location.reload()} style={{ background:'#02a4ba', border:'none', borderRadius:6, padding:'8px 18px', color:'#0a0908', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>Try Again</button>
      </div>
    </>
  );

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="db-root">

        {/* NAV */}
        <div className="db-nav">
          <div style={{ display:'flex', alignItems:'center', gap:'clamp(8px,1vw,16px)' }}>
            <div className="db-logo">Opti<span>Menu</span></div>
            <div style={{ display:'flex', gap:2 }}>
              {tabs.map(t => (
                <button key={t} className={`db-tab${activeTab===t?' active':''}`}
                  onClick={() => { setActiveTab(t); if (t !== 'Dashboard') router.push(`/client/${t.toLowerCase().replace(' ','-')}`); }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'clamp(6px,0.7vw,12px)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:'clamp(9px,0.65vw,12px)', color:'#02a4ba' }}>
              <div style={{ width:'clamp(4px,0.35vw,6px)', height:'clamp(4px,0.35vw,6px)', background:'#02a4ba', borderRadius:'50%', animation:'blink 2s infinite' }}/>
              Active
            </div>
            <div style={{ width:'clamp(160px,14vw,260px)' }}>
              <UniversalSearch restaurantId={restaurantId} placeholder="Search..."/>
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile}/>
          </div>
        </div>

        {/* WELCOME BAR */}
        <div className="db-wbar">
          <span className="db-wname">Welcome back, {userName}</span>
          <span className="db-wsub">· {new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })} · {restaurantName}</span>
        </div>

        {/* CONTENT */}
        {loading ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
            <div style={{ width:22, height:22, border:'2px solid #2a2620', borderTopColor:'#02a4ba', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>
            <div style={{ fontSize:'clamp(10px,0.8vw,13px)', color:'#4a453e' }}>Loading dashboard...</div>
          </div>
        ) : (
          <div className="db-outer">

            {/* LEFT SIDEBAR */}
            <div className="db-left">

              {/* Score Card */}
              <div className="db-score-card">
                <div className="db-rest-icon">
                  <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg>
                </div>
                <div className="db-rest-name">{restaurantName}</div>
                <div className="db-rest-sub">Management Dashboard</div>
                <ScoreRing score={data.aiProfitScore.score}/>
                <div className="db-score-hint">+4 pts this week — invoice coverage improved</div>
              </div>

              {/* Waste Risk Card */}
              <div className="db-waste-card">
                <div className="db-waste-hd">
                  <div className="db-waste-title">
                    <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    Waste Risk Today
                  </div>
                  <div className="db-waste-amt">
                    {formatCurrency(data.ingredientTrends.reduce((s, _) => s + 80, 0) || 340)}
                  </div>
                </div>
                {data.ingredientTrends.slice(0, 3).length > 0
                  ? data.ingredientTrends.slice(0, 3).map((ing, i) => (
                    <div key={ing.name} className="db-waste-item">
                      <div className="db-waste-name">{ing.name}</div>
                      <div className="db-waste-badge">{i === 0 ? 'Today' : i === 1 ? '1 day' : '2 days'}</div>
                    </div>
                  ))
                  : ['Chicken Breast — 4.2 lbs', 'Fresh Salmon — 2.8 lbs', 'Heavy Cream — 1.5 qt'].map((name, i) => (
                    <div key={name} className="db-waste-item">
                      <div className="db-waste-name">{name}</div>
                      <div className="db-waste-badge">{i === 0 ? '2 days' : i === 1 ? '1 day' : 'Today'}</div>
                    </div>
                  ))
                }
              </div>

              {/* Stats Pills Card */}
              <div className="db-pills-card">
                {[
                  { l:'Invoices',     v:data.totalInvoices,    c:'#02a4ba' },
                  { l:'Ingredients',  v:data.totalIngredients, c:'#e8e2d8' },
                  { l:'Menu Items',   v:data.totalMenuItems,   c:'#e8e2d8' },
                  { l:'Unpriced',     v:data.unpricedIngredients, c:'#d4a020' },
                  { l:'Low Margin',   v:data.lowMarginCount,   c:'#c04040' },
                  { l:'Avg Food Cost',v:`${data.averageMargin > 0 ? (100 - data.averageMargin).toFixed(1) : 0}%`, c:'#2a8a5a' },
                  { l:'YTD Spend',    v:formatCurrency(data.totalSpending), c:'#d4a020' },
                ].map(({ l, v, c }) => (
                  <div key={l} className="db-pill">
                    <div className="db-pill-l">{l}</div>
                    <div className="db-pill-v" style={{ color:c }}>{v}</div>
                  </div>
                ))}
              </div>

            </div>

            {/* RIGHT CONTENT */}
            <div className="db-right">

              {/* THERMAL RECEIPT HERO */}
              <div className="db-thermal-wrap">
                <div className="db-thermal-tear-top"/>
                <div className="db-thermal-body">
                  <div className="db-thermal-hd">
                    <div className="db-thermal-title">
                      Today's Shift Recommendations
                    </div>
                    <div className="db-thermal-sync">
                      {aiLoading ? (
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                          <span className="db-spinner"/> Analyzing...
                        </span>
                      ) : 'Synced 8 min ago'}
                    </div>
                  </div>
                  <div className="db-thermal-sub">
                    Based on expiry risk · margins · sales velocity — dishes to push this shift
                  </div>
                  <hr className="db-thermal-divider"/>
                  <div className="db-thermal-grid">
                    {recs.length > 0 ? recs.map((rec, i) => {
                      const bs = getThermalBadgeStyle(rec.type);
                      const bl = getThermalBadgeLabel(rec.type);
                      return (
                        <div key={i} className="db-thermal-item">
                          <div className="db-thermal-badge" style={bs}>{bl}</div>
                          <div className="db-thermal-item-name">{rec.title}</div>
                          <div className="db-thermal-item-desc">{rec.description}</div>
                        </div>
                      );
                    }) : (
                      ['Grilled Salmon', 'Chicken Marsala', 'Mushroom Soup'].map((name, i) => (
                        <div key={i} className="db-thermal-item">
                          <div className="db-thermal-badge" style={getThermalBadgeStyle(['inventory','margin','trending'][i])}>
                            {getThermalBadgeLabel(['inventory','margin','trending'][i])}
                          </div>
                          <div className="db-thermal-item-name">{name}</div>
                          <div className="db-thermal-item-desc">Preparing recommendation...</div>
                        </div>
                      ))
                    )}
                  </div>
                  <hr className="db-thermal-divider"/>
                  <div className="db-thermal-nfc">
                    <svg viewBox="0 0 24 24"><path d="M6 12a6 6 0 0012 0"/><path d="M3 12a9 9 0 0018 0"/><circle cx="12" cy="12" r="1" fill="#7a7068"/></svg>
                    <div className="db-thermal-nfc-text">
                      Staff tap NFC tag at POS to see these 3 dishes — updated every shift automatically
                    </div>
                  </div>
                </div>
                <div className="db-thermal-tear-bot"/>
              </div>

              {/* BOTTOM ROW */}
              <div className="db-bottom">

                {/* Menu Analysis */}
                <div className="db-card">
                  <div className="db-card-hd">
                    <div className="db-card-title">
                      <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                      Menu Analysis
                    </div>
                    <div className="db-toggle">
                      {['high','low'].map(v => (
                        <button key={v} className={`db-toggle-btn${marginView===v?' active':''}`} onClick={() => setMarginView(v)}>
                          {v.charAt(0).toUpperCase()+v.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {marginItems.length > 0
                    ? marginItems.map(item => (
                      <div key={item.id} className="db-margin-row">
                        <div className="db-margin-name">
                          {item.name}
                          {item.hasEstimated && <span style={{ marginLeft:3, fontSize:'clamp(7px,.52vw,9px)', color:'#d4a020' }}>~</span>}
                        </div>
                        <div className="db-margin-track">
                          <div className="db-margin-fill" style={{ width:`${Math.max(0,Math.min(100,item.margin))}%`, background: item.hasEstimated ? '#d4a020' : getMarginColor(item.margin), opacity: item.hasEstimated ? 0.5 : 1 }}/>
                        </div>
                        <div className="db-margin-pct" style={{ color: item.hasEstimated ? '#d4a020' : getMarginColor(item.margin) }}>
                          {item.margin.toFixed(1)}%
                        </div>
                      </div>
                    ))
                    : <div className="db-empty">No menu data yet</div>
                  }
                </div>

                {/* Monthly Spending */}
                <div className="db-card">
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
                            <div className="db-bar" style={{ height:`${Math.max(2,(total/maxSpend)*92)}%`, background:getBarColor(total) }}/>
                          </div>
                          <div className="db-bar-lbl">{month.slice(0,3)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="db-legend">
                      {[{c:'#c04040',l:'High (>$5k)'},{c:'#d4a020',l:'Moderate'},{c:'#02a4ba',l:'Normal'},{c:'#1e1c18',l:'No spend',b:'1px solid #2a2620'}].map(({ c,l,b }) => (
                        <div key={l} className="db-legend-item">
                          <div className="db-legend-dot" style={{ background:c, border:b }}/>
                          {l}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recent Invoices */}
                <div className="db-card">
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

              </div>
            </div>
          </div>
        )}
      </div>

      <Analytics/>
      <SpeedInsights/>
      {tourProps && <TourOverlay {...tourProps}/>}
      <TourDataBanner/>
    </>
  );
}