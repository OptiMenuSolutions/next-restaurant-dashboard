// pages/client/dashboard.js
import React, { useState, useEffect, useRef } from "react";
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

// ─── Shelf life knowledge (days from delivery) ────────────────────────────────
const SHELF_LIFE = {
  fish: 2, salmon: 2, tuna: 2, halibut: 2, cod: 2, tilapia: 2, mahi: 2,
  shrimp: 2, scallop: 2, lobster: 1, crab: 2, oyster: 3, clam: 3,
  swordfish: 2, bass: 2, snapper: 2, flounder: 2, trout: 2,
  "bluefin tuna": 2, "seared toro": 2,
  chicken: 3, beef: 4, pork: 4, lamb: 4, veal: 3, duck: 3, turkey: 3,
  steak: 4, "ground beef": 3, "ground pork": 3, bacon: 7, sausage: 4,
  "filet mignon": 4, "new york strip": 4, ribeye: 4, "short rib": 4,
  milk: 7, cream: 7, butter: 14, cheese: 14, "heavy cream": 7,
  "sour cream": 14, yogurt: 14, mozzarella: 7, parmesan: 30,
  lettuce: 7, spinach: 5, arugula: 5, kale: 7, herbs: 5,
  basil: 5, parsley: 7, cilantro: 5, mint: 7, chives: 7,
  tomato: 7, strawberry: 5, raspberry: 3, blueberry: 7, mushroom: 7,
  avocado: 4, asparagus: 5, corn: 4, pea: 5,
  carrot: 21, onion: 30, garlic: 30, potato: 21, apple: 21,
  lemon: 21, lime: 14, orange: 14, beet: 21, celery: 14,
  broccoli: 7, cauliflower: 7, zucchini: 7, pepper: 10,
  olive: 60, oil: 180, flour: 180, sugar: 365, salt: 365,
  pasta: 365, rice: 365, vinegar: 365, sauce: 30,
};

function getShelfLife(name) {
  if (!name) return 14;
  const lower = name.toLowerCase();
  if (SHELF_LIFE[lower]) return SHELF_LIFE[lower];
  for (const [key, days] of Object.entries(SHELF_LIFE)) {
    if (lower.includes(key) || key.includes(lower.split(' ')[0])) return days;
  }
  return 14;
}

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
function formatDateLong(d) {
  if (!d) return "N/A";
  try { return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return "N/A"; }
}
function getMarginColor(m) {
  if (m >= 60) return "#2a8a5a";
  if (m >= 40) return "#02a4ba";
  if (m >= 25) return "#d4a020";
  return "#c04040";
}
function getScoreInfo(score) {
  if (score >= 85) return { color: "#2a8a5a", label: "Excellent", pct: "Top 10%" };
  if (score >= 70) return { color: "#02a4ba", label: "Good", pct: "Top 30%" };
  if (score >= 55) return { color: "#d4a020", label: "Fair", pct: "Top 50%" };
  return { color: "#c04040", label: "Needs Work", pct: "Bottom 50%" };
}
function getWasteUrgencyColor(daysLeft) {
  if (daysLeft <= 1) return "#c04040";
  if (daysLeft <= 2) return "#d4a020";
  return "#02a4ba";
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
function Sparkline({ points, color, globalMin, globalMax, width = 70, height = 24 }) {
  if (!points || points.length < 2) return null;
  const minV = globalMin !== undefined ? globalMin : Math.min(...points);
  const maxV = globalMax !== undefined ? globalMax : Math.max(...points);
  const range = maxV - minV || 1;
  const pad = 2;
  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = pad + ((maxV - p) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastPt = coords.split(' ').pop().split(',');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ overflow: 'visible', flexShrink: 0 }}>
      <polyline points={coords} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="2.5" fill={color} />
    </svg>
  );
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; overflow: hidden; }
  #__next { height: 100%; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }

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

  /* ── Top bar ── */
  .db-topbar {
    background: #0f0e0c;
    border-bottom: 1px solid #2a2620;
    height: clamp(36px, 4vh, 48px);
    padding: 0 clamp(10px, 1vw, 20px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .db-logo {
    font-family: 'Playfair Display', serif;
    font-size: clamp(14px, 1.1vw, 20px);
    color: #e8e2d8;
    letter-spacing: -.3px;
  }
  .db-logo span { color: #02a4ba; }

  /* ── Nav tabs ── */
  .db-nav {
    background: #0f0e0c;
    border-bottom: 1px solid #2a2620;
    height: clamp(34px, 3.8vh, 46px);
    padding: 0 clamp(10px, 1vw, 20px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
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

  /* ── Main content area ── */
  .db-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Welcome bar ── */
  .db-wbar {
    background: #13120f;
    border-bottom: 1px solid #2a2620;
    height: clamp(28px, 3.2vh, 40px);
    padding: 0 clamp(10px, 1vw, 16px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .db-wname { font-size: clamp(11px, 0.82vw, 15px); font-weight: 600; color: #e8e2d8; }
  .db-wsub { font-size: clamp(9px, 0.62vw, 11px); color: #4a453e; margin-left: 6px; }

  /* ── Section headers ── */
  .db-section-hd {
    font-size: clamp(8px, 0.58vw, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: #3a3630;
    padding: clamp(4px, 0.4vh, 6px) 0 clamp(3px, 0.3vh, 5px);
    flex-shrink: 0;
  }

  /* ── Grid ── */
  .db-grid-wrap {
    flex: 1;
    min-height: 0;
    padding: clamp(6px, 0.6vw, 10px) clamp(24px, 3vw, 60px);
    gap: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .db-row-top {
    display: grid;
    grid-template-columns: clamp(148px, 12vw, 200px) 1fr 1fr 1fr;
    gap: clamp(5px, 0.5vw, 9px);
    flex: 0 0 32%;
    min-height: 0;
    margin-bottom: clamp(5px, 0.5vw, 9px);
  }

  .db-row-bottom {
    display: grid;
    grid-template-columns: clamp(148px, 12vw, 200px) 1fr 1fr 1fr;
    gap: clamp(5px, 0.5vw, 9px);
    flex: 1;
    min-height: 0;
  }

  /* ── Left column — two stacked cards ── */
  .db-left-col {
    grid-column: 1;
    display: flex;
    flex-direction: column;
    gap: clamp(5px, 0.5vw, 9px);
    min-height: 0;
    overflow: hidden;
  }

  /* Score card — top left */
  .db-score-card {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 8px);
    padding: clamp(8px, 0.7vw, 14px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(4px, 0.4vh, 7px);
    flex-shrink: 0;
  }

  /* Stats card — bottom left */
  .db-stats-card {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 8px);
    padding: clamp(8px, 0.7vw, 14px);
    display: flex;
    flex-direction: column;
    gap: clamp(5px, 0.5vh, 8px);
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* FIX #1 — restaurant name/sub use Inter (same as old code) */
  .db-rest-icon {
    width: clamp(22px, 1.8vw, 32px);
    height: clamp(22px, 1.8vw, 32px);
    border-radius: 50%;
    background: rgba(2,164,186,.1);
    border: 1px solid rgba(2,164,186,.2);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .db-rest-icon svg { width: 55%; height: 55%; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .db-rest-name {
    font-family: 'Inter', sans-serif;
    font-size: clamp(10px, 0.8vw, 14px);
    font-weight: 600;
    color: #e8e2d8;
    text-align: center;
  }
  .db-rest-sub {
    font-family: 'Inter', sans-serif;
    font-size: clamp(8px, 0.58vw, 10px);
    color: #4a453e;
    text-align: center;
  }

  .db-score-wrap { display: flex; flex-direction: column; align-items: center; gap: clamp(2px, 0.25vh, 4px); flex-shrink: 0; }
  .db-score-lbl { font-size: clamp(8px, 0.58vw, 10px); color: #6b6358; text-transform: uppercase; letter-spacing: .5px; font-weight: 500; }
  .db-ring { position: relative; width: clamp(52px, 4.8vw, 76px); height: clamp(52px, 4.8vw, 76px); }
  .db-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .db-ring-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .db-ring-num { font-family: 'Playfair Display', serif; font-size: clamp(15px, 1.4vw, 22px); color: #e8e2d8; line-height: 1; }
  .db-ring-sub { font-size: clamp(7px, 0.52vw, 9px); color: #4a453e; }
  .db-score-tag { font-size: clamp(8px, 0.6vw, 11px); font-weight: 600; padding: 2px clamp(6px,0.5vw,10px); border-radius: 10px; }
  .db-score-pct { font-size: clamp(7px, 0.55vw, 9px); color: #4a453e; margin-top: 1px; }

  .db-pills { display: flex; flex-direction: column; gap: clamp(4px, 0.4vh, 7px); flex: 1; overflow: hidden; }
  .db-pill {
    background: #0f0e0c;
    border-radius: clamp(4px, 0.3vw, 6px);
    padding: clamp(4px, 0.42vh, 7px) clamp(7px, 0.6vw, 12px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 1px solid #1a1915;
    flex-shrink: 0;
    gap: 6px;
  }
  .db-pill-left { flex: 1; min-width: 0; }
  .db-pill-l { font-size: clamp(9px, 0.62vw, 11px); color: #6b6358; }
  .db-pill-sub { font-size: clamp(7px, 0.52vw, 9px); color: #3a3630; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-pill-v { font-family: 'Playfair Display', serif; font-size: clamp(12px, 1vw, 16px); flex-shrink: 0; }

  /* ── Generic card ── */
  .db-card {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 8px);
    padding: clamp(8px, 0.8vw, 14px) clamp(9px, 0.9vw, 16px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .db-card-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: clamp(5px, 0.6vh, 10px);
    flex-shrink: 0;
  }
  .db-card-title {
    font-size: clamp(10px, 0.75vw, 13px);
    font-weight: 600;
    color: #e8e2d8;
    display: flex;
    align-items: center;
    gap: clamp(4px, 0.32vw, 6px);
  }
  .db-card-title svg { width: clamp(10px, 0.82vw, 14px); height: clamp(10px, 0.82vw, 14px); stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .db-card-sub { font-size: clamp(8px, 0.58vw, 10px); color: #4a453e; }
  .db-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: clamp(10px, 0.75vw, 13px); color: #4a453e; text-align: center; padding: 8px; }
  .db-spinner { width: clamp(7px, 0.62vw, 10px); height: clamp(7px, 0.62vw, 10px); border: 1.5px solid #2a2620; border-top-color: #02a4ba; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; }

  /* ── Thermal ticket — FIX #2: two-column, no scroll ── */
  .db-ticket {
    background: #111009;
    border: 1px solid #2a2620;
    border-radius: clamp(4px, 0.35vw, 7px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: 'Courier New', monospace;
    animation: fadeIn 0.3s ease both;
    position: relative;
  }
  .db-ticket:nth-child(2) { animation-delay: 0.08s; }
  .db-ticket:nth-child(3) { animation-delay: 0.16s; }

  /* Two-column layout inside ticket */
  .db-ticket-inner {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .db-ticket-left {
    flex: 1;
    padding: clamp(6px, 0.7vh, 10px) clamp(8px, 0.8vw, 12px);
    display: flex;
    flex-direction: column;
    gap: 0;
    border-right: 1px dashed #2a2620;
    overflow: hidden;
  }

  .db-ticket-right {
    width: 40%;
    padding: clamp(6px, 0.7vh, 10px) clamp(6px, 0.6vw, 10px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .db-receipt-stars {
    font-size: clamp(7px, 0.55vw, 9px);
    color: #c04040;
    text-align: center;
    letter-spacing: 1px;
    flex-shrink: 0;
    line-height: 1.4;
  }

  .db-receipt-center {
    font-size: clamp(9px, 0.72vw, 12px);
    font-weight: 700;
    color: #e8e2d8;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: clamp(2px,0.2vh,4px) 0;
    flex-shrink: 0;
  }

  .db-receipt-divider {
    border: none;
    border-top: 1px dashed #2a2620;
    margin: clamp(3px,0.3vh,5px) 0;
    flex-shrink: 0;
  }

  .db-receipt-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: clamp(8px, 0.62vw, 11px);
    line-height: 1.7;
    flex-shrink: 0;
  }
  .db-receipt-key { color: #6b6358; }
  .db-receipt-val { color: #e8e2d8; font-weight: 600; text-align: right; }
  .db-receipt-val.teal { color: #02a4ba; }
  .db-receipt-val.green { color: #2a8a5a; }
  .db-receipt-val.red { color: #c04040; }
  .db-receipt-val.amber { color: #d4a020; }

  .db-receipt-sell {
    font-size: clamp(8px, 0.62vw, 11px);
    color: #9a9086;
    font-style: italic;
    line-height: 1.5;
    margin: clamp(2px,0.2vh,4px) 0;
    flex-shrink: 0;
  }
  .db-receipt-sell::before { content: '"'; color: #02a4ba; font-style: normal; }
  .db-receipt-sell::after { content: '"'; color: #02a4ba; font-style: normal; }

  .db-receipt-component {
    font-size: clamp(8px, 0.6vw, 10px);
    color: #6b6358;
    margin-top: 2px;
    flex-shrink: 0;
  }
  .db-receipt-ingredient {
    font-size: clamp(7px, 0.55vw, 9px);
    color: #4a453e;
    padding-left: 10px;
    line-height: 1.6;
    flex-shrink: 0;
  }
  .db-receipt-ingredient.at-risk {
    color: #c04040;
    font-weight: 600;
  }

  .db-receipt-footer {
    font-size: clamp(7px, 0.52vw, 9px);
    color: #2a2620;
    text-align: center;
    margin-top: auto;
    padding-top: clamp(4px,0.4vh,6px);
    flex-shrink: 0;
  }

  /* ── Waste risk card ── */
  .db-waste-list { flex: 1; overflow-y: auto; min-height: 0; }
  .db-waste-list::-webkit-scrollbar { width: 2px; }

  .db-waste-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: clamp(5px, 0.55vh, 8px) clamp(7px, 0.65vw, 11px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.32vw, 6px);
    border: 1px solid #1a1915;
    margin-bottom: clamp(4px, 0.4vh, 6px);
    flex-shrink: 0;
  }
  .db-waste-row:last-child { margin-bottom: 0; }
  .db-waste-top { display: flex; align-items: center; gap: 6px; }
  .db-waste-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .db-waste-name { flex: 1; font-size: clamp(10px, 0.72vw, 12px); color: #9a9086; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-waste-days { font-size: clamp(9px, 0.62vw, 11px); font-weight: 600; white-space: nowrap; flex-shrink: 0; }
  .db-waste-bar-track { width: 100%; height: 3px; background: #1a1915; border-radius: 2px; overflow: hidden; }
  .db-waste-bar-fill { height: 100%; border-radius: 2px; }
  .db-waste-meta { display: flex; justify-content: space-between; }
  .db-waste-meta-txt { font-size: clamp(7px, 0.52vw, 9px); color: #3a3630; }
  .db-waste-invoice-link {
    font-size: clamp(7px, 0.52vw, 9px);
    color: #02a4ba;
    cursor: pointer;
    background: none;
    border: none;
    font-family: 'Inter', sans-serif;
    padding: 0;
    text-decoration: underline;
    opacity: 0.8;
  }
  .db-waste-invoice-link:hover { opacity: 1; }

  /* ── Price movement card ── */
  .db-pm-back {
    font-size: clamp(8px, 0.6vw, 11px);
    color: #02a4ba;
    background: none;
    border: none;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .db-pm-scroll { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
  .db-pm-scroll::-webkit-scrollbar { width: 2px; }

  .db-pm-cat-row {
    display: flex;
    align-items: center;
    gap: clamp(5px, 0.45vw, 8px);
    padding: 0 clamp(7px, 0.65vw, 11px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.32vw, 6px);
    border: 1px solid #1a1915;
    margin-bottom: clamp(4px, 0.4vh, 6px);
    cursor: pointer;
    transition: border-color 0.15s;
    flex: 1;
    min-height: 0;
  }
  .db-pm-cat-row:last-child { margin-bottom: 0; }
  .db-pm-cat-row:hover { border-color: #3a3630; }
  .db-pm-cat-name { flex: 1; font-size: clamp(10px, 0.72vw, 12px); color: #9a9086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-pm-cat-delta { font-size: clamp(10px, 0.72vw, 12px); font-weight: 600; white-space: nowrap; flex-shrink: 0; }
  .db-pm-cat-count { font-size: clamp(8px, 0.58vw, 10px); color: #4a453e; white-space: nowrap; flex-shrink: 0; }
  .db-pm-cat-chevron { font-size: 10px; color: #3a3630; flex-shrink: 0; }

  .db-pm-ing-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: clamp(5px, 0.55vh, 9px) clamp(7px, 0.65vw, 11px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.32vw, 6px);
    border: 1px solid #1a1915;
    margin-bottom: clamp(4px, 0.4vh, 6px);
    flex-shrink: 0;
  }
  .db-pm-ing-row:last-child { margin-bottom: 0; }
  .db-pm-ing-top { display: flex; align-items: center; gap: 6px; }
  .db-pm-ing-name { flex: 1; font-size: clamp(10px, 0.72vw, 12px); color: #9a9086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }
  .db-pm-ing-delta { font-size: clamp(10px, 0.72vw, 12px); font-weight: 600; white-space: nowrap; flex-shrink: 0; }
  .db-pm-ing-prices { font-size: clamp(7px, 0.55vw, 9px); color: #4a453e; padding-left: 2px; }

  /* ── Top ingredient costs — FIX #4: fixed 8, flex fill ── */
  .db-ing-list { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .db-ing-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0 clamp(7px, 0.65vw, 11px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.32vw, 6px);
    border: 1px solid #1a1915;
    margin-bottom: clamp(4px, 0.4vh, 6px);
    flex: 1;
    justify-content: center;
    min-height: 0;
  }
  .db-ing-row:last-child { margin-bottom: 0; }
  .db-ing-top { display: flex; align-items: center; justify-content: space-between; }
  .db-ing-name { font-size: clamp(10px, 0.72vw, 12px); color: #9a9086; }
  .db-ing-unit { font-size: clamp(7px, 0.55vw, 9px); color: #4a453e; }
  .db-ing-val { font-size: clamp(11px, 0.8vw, 13px); font-weight: 600; color: #02a4ba; }
  .db-ing-bar-track { width: 100%; height: 3px; background: #1a1915; border-radius: 2px; overflow: hidden; }
  .db-ing-bar-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, #02a4ba44, #02a4ba); }

  /* ── Waste risk legend ── */
  .db-legend-strip {
    font-size: clamp(7px, 0.55vw, 9px);
    color: #3a3630;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: clamp(4px, 0.4vh, 6px);
    flex-shrink: 0;
    border-top: 1px solid #1a1915;
    margin-top: clamp(4px, 0.4vh, 6px);
  }
  .db-legend-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 3px; flex-shrink: 0; }

  /* Mobile */
  .mob-root { font-family: 'Inter', sans-serif; background: #0a0908; color: #e8e2d8; width: 100%; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
  .mob-header { background: #0f0e0c; border-bottom: 1px solid #2a2620; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding-top: env(safe-area-inset-top, 10px); }
  .mob-logo { font-family: 'Playfair Display', serif; font-size: 20px; color: #e8e2d8; letter-spacing: -.3px; }
  .mob-logo span { color: #02a4ba; }
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
  .mob-ai-item { background: #0f0e0c; border-radius: 7px; border-left: 2px solid #02a4ba; padding: 10px 12px; margin-bottom: 8px; font-family: 'Courier New', monospace; }
  .mob-ai-item:last-child { margin-bottom: 0; }
  .mob-ai-title { font-size: 13px; font-weight: 700; color: #e8e2d8; margin-bottom: 3px; }
  .mob-ai-desc { font-size: 11px; color: #6b6358; line-height: 1.45; }
  .mob-ai-sell { font-size: 11px; color: #9a9086; font-style: italic; margin-top: 5px; line-height: 1.45; }
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
`;

// ─── ScoreRing ────────────────────────────────────────────────────────────────
function ScoreRing({ score }) {
  const { color, label, pct } = getScoreInfo(score);
  const circumference = 2 * Math.PI * 40;
  const dash = (score / 100) * circumference;
  return (
    <div className="db-score-wrap">
      <div className="db-score-lbl">OptiScore</div>
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
      <div className="db-score-pct">{pct} of similar restaurants</div>
    </div>
  );
}

// ─── Thermal Ticket — FIX #2: two-column, no scroll, dish name bug fixed ─────
const SELL_COPY = [
  "Just came in fresh — one of the best things on the menu tonight.",
  "The kitchen is really proud of this one tonight — worth every bite.",
  "Guests have been loving this lately — a great choice tonight.",
  "This one is exceptional right now — highly recommend it.",
  "A personal favorite of the chef tonight — you won't be disappointed.",
  "Incredibly fresh tonight — this is the one to get.",
];

function ThermalTicket({ rec, index, menuItems, wasteRisk, averageMargin }) {
  if (!rec) return null;

  // FIX: rec coming from fetchAIRecommendations is already mapped to {title, description, sellCopy, ...}
  // so read title first (that's what the mapper outputs), then fall back to dish
  const dishName = rec.title || rec.dish || '';
  const description = rec.description || rec.reason || '';
  const sellCopy = rec.sellCopy || rec.talking_point || SELL_COPY[index % SELL_COPY.length];
  const marginVal = rec.margin ? parseFloat(rec.margin) : null;
  const confidence = rec.confidence || null;

  const typeColor =
    rec.type === 'inventory' ? '#c04040' :
    rec.type === 'margin' ? '#2a8a5a' : '#02a4ba';

  const urgencyLabel =
    rec.urgency === 'high' ? 'URGENT' :
    rec.type === 'margin' ? 'HIGH MARGIN' :
    rec.type === 'trending' ? 'TRENDING' : 'RECOMMENDED';

  // Match dish name: exact first, then partial (handles minor API/DB name differences)
  const dishLower = dishName.toLowerCase().trim();
  const menuItem = (menuItems || []).find(m =>
    m.name?.toLowerCase().trim() === dishLower
  ) || (menuItems || []).find(m =>
    dishLower.includes(m.name?.toLowerCase().trim()) ||
    m.name?.toLowerCase().trim().includes(dishLower)
  );

  const atRiskNames = new Set(
    (wasteRisk || []).map(w => w.name?.toLowerCase().trim())
  );

  let marginVsAvg = null;
  if (marginVal && averageMargin > 0) {
    const diff = marginVal - averageMargin;
    marginVsAvg = diff >= 0 ? `+${diff.toFixed(1)}% vs avg` : `${diff.toFixed(1)}% vs avg`;
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const starRow = '***********************';

  return (
    <div className="db-ticket">
      <div className="db-ticket-inner">

        {/* LEFT: header + meta + sell copy */}
        <div className="db-ticket-left">
          <div className="db-receipt-stars">{starRow}</div>
          <div className="db-receipt-center" style={{ color: typeColor }}>{urgencyLabel}</div>
          <div className="db-receipt-stars">{starRow}</div>

          <div className="db-receipt-divider" />

          <div className="db-receipt-row">
            <span className="db-receipt-key">Date:</span>
            <span className="db-receipt-val" style={{ fontSize: 'clamp(7px,0.55vw,9px)' }}>{today}</span>
          </div>
          <div className="db-receipt-row">
            <span className="db-receipt-key">Pick:</span>
            <span className="db-receipt-val teal">Tonight #{index + 1}</span>
          </div>

          <div className="db-receipt-divider" />

          {/* Dish name — large */}
          <div style={{
            fontFamily: 'Courier New, monospace',
            fontSize: 'clamp(11px, 0.95vw, 15px)',
            fontWeight: 700,
            color: '#e8e2d8',
            lineHeight: 1.2,
            marginBottom: 'clamp(2px, 0.2vh, 3px)',
          }}>{dishName || '—'}</div>

          {/* Description — smaller underneath */}
          {description && (
            <div style={{
              fontFamily: 'Courier New, monospace',
              fontSize: 'clamp(7px, 0.55vw, 9px)',
              color: '#6b6358',
              lineHeight: 1.4,
              marginBottom: 'clamp(3px, 0.3vh, 5px)',
            }}>{description}</div>
          )}

          <div className="db-receipt-divider" />

          {marginVal && (
            <div className="db-receipt-row">
              <span className="db-receipt-key">Margin:</span>
              <span className="db-receipt-val" style={{ color: typeColor }}>
                {marginVal.toFixed(1)}%{marginVsAvg ? ` (${marginVsAvg})` : ''}
              </span>
            </div>
          )}
          {confidence && (
            <div className="db-receipt-row">
              <span className="db-receipt-key">Confidence:</span>
              <span className="db-receipt-val teal">{confidence}%</span>
            </div>
          )}

          <div className="db-receipt-divider" />

          <div className="db-receipt-sell">{sellCopy}</div>

          <div className="db-receipt-footer">#{String(index + 1).padStart(3, '0')} · opti-menu.com</div>
        </div>

        {/* RIGHT: recipe breakdown */}
        <div className="db-ticket-right">
          <div style={{
            fontSize: 'clamp(7px, 0.55vw, 9px)',
            color: '#4a453e',
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            marginBottom: 4,
            flexShrink: 0,
          }}>Recipe</div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {menuItem?.menu_item_components?.length > 0 ? (
              menuItem.menu_item_components.map((comp, ci) => (
                <div key={ci}>
                  <div className="db-receipt-component">— {comp.name || `Component ${ci + 1}`}</div>
                  {(comp.component_ingredients || []).map((ci2, ii) => {
                    const ingName = ci2.ingredients?.name || ci2.name || '';
                    const isAtRisk = atRiskNames.has(ingName.toLowerCase().trim());
                    return (
                      <div key={ii} className={`db-receipt-ingredient${isAtRisk ? ' at-risk' : ''}`}>
                        &nbsp;&nbsp;· {ingName}
                        {ci2.quantity ? ` (${ci2.quantity})` : ''}
                        {isAtRisk ? ' ⚠' : ''}
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <div style={{ fontSize: 'clamp(7px,0.55vw,9px)', color: '#3a3630', fontFamily: 'Courier New, monospace' }}>
                {dishName ? 'Recipe not linked' : 'No dish selected'}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── WasteRow helper ─────────────────────────────────────────────────────────
function WasteRow({ item, router }) {
  const daysLeft = item.daysLeft;
  const isExpired = daysLeft < 0;
  const urgencyColor = isExpired ? '#c04040' : getWasteUrgencyColor(daysLeft);
  const consumed = isExpired ? 100 : Math.min(100, Math.max(0,
    ((item.shelfLife - daysLeft) / item.shelfLife) * 100));
  const label = isExpired
    ? `Expired ${Math.abs(daysLeft)}d ago`
    : daysLeft === 0 ? 'Use today'
    : daysLeft === 1 ? '1 day left'
    : `${daysLeft} days left`;
  const qtyText = item.remainingQty > 0
    ? `~${item.remainingQty.toFixed(1)} ${item.unit || 'units'} remaining`
    : item.invoicedQty > 0 ? `${item.invoicedQty.toFixed(1)} ${item.unit || 'units'} invoiced` : 'Qty unknown';
  return (
    <div className="db-waste-row">
      <div className="db-waste-top">
        <div className="db-waste-dot" style={{ background: urgencyColor }} />
        <div className="db-waste-name">{item.name}</div>
        <div className="db-waste-days" style={{ color: urgencyColor }}>{label}</div>
      </div>
      <div className="db-waste-bar-track">
        <div className="db-waste-bar-fill" style={{ width: `${consumed}%`, background: urgencyColor, opacity: 0.7 }} />
      </div>
      <div className="db-waste-meta">
        <span className="db-waste-meta-txt">{qtyText} · Delivered {formatDate(item.deliveryDate)}</span>
        {item.invoiceId && (
          <button className="db-waste-invoice-link"
            onClick={() => router.push(`/client/invoices?selected=${item.invoiceId}`)}>
            View invoice →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Price Movement Card ──────────────────────────────────────────────────────
function PriceMovementCard({ priceByCategory }) {
  const [selectedCat, setSelectedCat] = useState(null);

  const categories = Object.keys(priceByCategory).sort();

  let globalMin = Infinity;
  let globalMax = -Infinity;
  Object.values(priceByCategory).forEach(cat => {
    cat.ingredients.forEach(ing => {
      ing.history.forEach(p => {
        if (p < globalMin) globalMin = p;
        if (p > globalMax) globalMax = p;
      });
    });
  });
  if (globalMin === Infinity) { globalMin = 0; globalMax = 1; }

  const catData = selectedCat ? priceByCategory[selectedCat] : null;

  return (
    <div className="db-card">
      <div className="db-card-hd">
        <div className="db-card-title">
          <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          Price Movement
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectedCat && (
            <button className="db-pm-back" onClick={() => setSelectedCat(null)}>
              ← Back
            </button>
          )}
          <span className="db-card-sub">{selectedCat || '6-month trend'}</span>
        </div>
      </div>

      <div className="db-pm-scroll">
        {categories.length === 0 && (
          <div className="db-empty">No price history yet</div>
        )}

        {!selectedCat && categories.map(cat => {
          const d = priceByCategory[cat];
          const isUp = d.avgDelta > 0;
          const deltaColor = isUp ? '#c04040' : '#2a8a5a';
          const maxLen = Math.max(...d.ingredients.map(i => i.history.length));
          const avgHistory = Array.from({ length: maxLen }, (_, idx) => {
            const vals = d.ingredients.map(i => i.history[idx] ?? i.history[i.history.length - 1]).filter(Boolean);
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          });
          return (
            <div key={cat} className="db-pm-cat-row" onClick={() => setSelectedCat(cat)}>
              <div className="db-pm-cat-name">{cat || 'Uncategorized'}</div>
              {avgHistory.length >= 2 && (
                <Sparkline points={avgHistory} color={deltaColor}
                  globalMin={globalMin} globalMax={globalMax} width={60} height={20} />
              )}
              <div className="db-pm-cat-delta" style={{ color: deltaColor }}>
                {isUp ? '↑' : '↓'} {Math.abs(d.avgDelta).toFixed(1)}%
              </div>
              <div className="db-pm-cat-count">{d.ingredients.length} items</div>
              <div className="db-pm-cat-chevron">›</div>
            </div>
          );
        })}

        {selectedCat && catData && catData.ingredients.map((ing, i) => {
          const isUp = ing.deltaPct > 0;
          const deltaColor = isUp ? '#c04040' : '#2a8a5a';
          return (
            <div key={i} className="db-pm-ing-row" style={{ animation: 'slideIn 0.2s ease both', animationDelay: `${i * 0.04}s` }}>
              <div className="db-pm-ing-top">
                <div className="db-pm-ing-name">{ing.name}</div>
                {ing.history.length >= 2 && (
                  <Sparkline points={ing.history} color={deltaColor}
                    globalMin={globalMin} globalMax={globalMax} width={60} height={20} />
                )}
                <div className="db-pm-ing-delta" style={{ color: deltaColor }}>
                  {isUp ? '↑' : '↓'} {Math.abs(ing.deltaPct).toFixed(1)}%
                </div>
              </div>
              <div className="db-pm-ing-prices">
                {formatCurrencyDetailed(ing.firstPrice)} → {formatCurrencyDetailed(ing.lastPrice)}
              </div>
            </div>
          );
        })}
      </div>
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
  const [aiLoading, setAiLoading] = useState(false);
  const [menuItemsFull, setMenuItemsFull] = useState([]);

  const [data, setData] = useState({
    totalInvoices: 0, totalIngredients: 0, totalMenuItems: 0,
    ingredientTrends: [], menuItemAnalysis: [],
    unpricedIngredients: 0, averageMargin: 0,
    totalSpending: 0, aiProfitScore: { score: 0 }, aiRecommendations: [],
    lowMarginCount: 0, wasteRisk: [], priceByCategory: {},
  });

  const LOW_MARGIN_THRESHOLD = 40;

  useEffect(() => {
    ['dashboard','invoices','ingredients','menu-items','analytics'].forEach(p => router.prefetch(`/client/${p}`));
  }, []);

  useEffect(() => {
    if (router.query.tour === 'true') return;
    const handler = () => { if (restaurantId) fetchDashboardData(restaurantId); };
    window.addEventListener('optimenu-tour-seeded', handler);
    return () => window.removeEventListener('optimenu-tour-seeded', handler);
  }, [restaurantId]);

  useEffect(() => {
    if (!router.isReady || router.query.tour !== 'true' || !restaurantId) return;
    fetchSampleData().then(sample => {
      if (!sample) return;
      const processed = processDashboardData(sample.invoices, sample.ingredients, sample.menuItems, [], {});
      setData(processed);
      setMenuItemsFull(sample.menuItems || []);
      setLoading(false);
    });
  }, [router.isReady, router.query.tour, restaurantId]);

  useEffect(() => { getRestaurantId(); }, []);

  const { tourProps } = useTour('dashboard', restaurantId);
  const isTour = router.query.tour === 'true';

  useEffect(() => {
    if (isTour && restaurantId) {
      fetchSampleData().then(sample => {
        if (sample) {
          const processed = processDashboardData(sample.invoices, sample.ingredients, sample.menuItems, [], {});
          setData(processed);
          setMenuItemsFull(sample.menuItems || []);
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
      if (profileError || !profile?.restaurant_id) { setError("Could not determine restaurant access"); setLoading(false); return; }
      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name ? profile.full_name.split(' ')[0] : "User");
      const { data: rd } = await supabase.from("restaurants").select("name").eq("id", profile.restaurant_id).single();
      setRestaurantName(rd?.name || "Your Restaurant");
      if (router.query.tour !== 'true') await fetchDashboardData(profile.restaurant_id);
      else setLoading(false);
    } catch { setError("An unexpected error occurred"); setLoading(false); }
  }

  async function fetchDashboardData(restId) {
    try {
      setLoading(true);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const fromDate = sixMonthsAgo.toISOString().split('T')[0];

      const [
        { data: invoices },
        { data: ingredients },
        { data: menuItems },
        { data: invoiceItems },
        { data: posSales },
      ] = await Promise.all([
        supabase.from("invoices").select("*").eq("restaurant_id", restId).order("date", { ascending: false }),
        supabase.from("ingredients").select("*").eq("restaurant_id", restId),
        supabase.from("menu_items").select(`
          id, name, price, cost, category,
          menu_item_components(
            id, name, cost,
            component_ingredients(
              quantity,
              ingredients(id, name, last_price, is_estimated)
            )
          )
        `).eq("restaurant_id", restId),
        supabase.from("invoice_items")
          .select("*, invoices!inner(id, date, restaurant_id)")
          .eq("invoices.restaurant_id", restId)
          .gte("invoices.date", fromDate)
          .order("invoices(date)", { ascending: true }),
        supabase.from("pos_sales")
          .select("item_name, quantity_sold, sale_date")
          .eq("restaurant_id", restId),
      ]);

      setMenuItemsFull(menuItems || []);
      const wasteRisk = computeWasteRisk(invoiceItems || [], invoices || [], posSales || []);
      const priceByCategory = computePriceByCategory(invoiceItems || []);
      const processed = processDashboardData(invoices || [], ingredients || [], menuItems || [], wasteRisk, priceByCategory);
      setData(processed);
      setLoading(false);
      fetchAIRecommendations(processed, restId);
    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message);
      setLoading(false);
    }
  }

  // ── Protein classification ────────────────────────────────────────────────
  const PROTEIN_KEYS = new Set([
    'fish','salmon','tuna','halibut','cod','tilapia','mahi','shrimp','scallop',
    'lobster','crab','oyster','clam','swordfish','bass','snapper','flounder',
    'trout','bluefin tuna','seared toro','chicken','beef','pork','lamb','veal',
    'duck','turkey','steak','ground beef','ground pork','bacon','sausage',
    'filet mignon','new york strip','ribeye','short rib',
  ]);
  function isProtein(name) {
    const lower = (name || '').toLowerCase();
    if (PROTEIN_KEYS.has(lower)) return true;
    for (const key of PROTEIN_KEYS) {
      if (lower.includes(key)) return true;
    }
    return false;
  }

  // ── Waste Risk — proteins shown for any delivery within last 14 days ──────
  function computeWasteRisk(invoiceItems, invoices, posSales) {
    // Build full invoice date + id map from the invoices array (more reliable than join)
    const invoiceDateMap = {};
    const invoiceIdSet = new Set();
    (invoices || []).forEach(inv => {
      if (inv.id && inv.date) {
        invoiceDateMap[inv.id] = inv.date;
        invoiceIdSet.add(inv.id);
      }
    });

    const posByItem = {};
    (posSales || []).forEach(s => {
      const key = (s.item_name || '').toLowerCase().trim();
      if (!posByItem[key]) posByItem[key] = {};
      posByItem[key][s.sale_date] = (posByItem[key][s.sale_date] || 0) + parseFloat(s.quantity_sold || 0);
    });

    const latestByIngredient = {};
    (invoiceItems || []).forEach(item => {
      const name = (item.ingredient_name_normalized || item.item_name || '').trim();
      if (!name) return;
      // Prefer join date, fall back to invoiceDateMap lookup
      const dateStr = item.invoices?.date || invoiceDateMap[item.invoice_id];
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;
      if (!latestByIngredient[name] || date > latestByIngredient[name].date) {
        latestByIngredient[name] = {
          date,
          unit: item.unit,
          quantity: parseFloat(item.quantity || 0),
          unitCost: parseFloat(item.unit_cost || 0),
          invoiceId: item.invoice_id || item.invoices?.id,
          invoiceDate: dateStr,
        };
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const risks = Object.entries(latestByIngredient).map(([name, info]) => {
      const shelfLife = getShelfLife(name);
      const deliveryDate = new Date(info.date);
      deliveryDate.setHours(0, 0, 0, 0);
      const daysSinceDelivery = Math.floor((today - deliveryDate) / (1000 * 60 * 60 * 24));
      const daysLeft = shelfLife - daysSinceDelivery;

      let soldSinceDelivery = 0;
      const nameLower = name.toLowerCase().trim();
      if (posByItem[nameLower]) {
        Object.entries(posByItem[nameLower]).forEach(([saleDate, qty]) => {
          if (saleDate >= info.invoiceDate) soldSinceDelivery += qty;
        });
      }
      const remainingQty = Math.max(0, info.quantity - soldSinceDelivery);
      const totalValue = remainingQty * info.unitCost;
      const protein = isProtein(name);

      return {
        name, daysLeft, shelfLife,
        daysSinceDelivery,
        deliveryDate: info.invoiceDate,
        invoiceId: info.invoiceId,
        unit: info.unit,
        invoicedQty: info.quantity,
        remainingQty,
        totalValue,
        protein,
      };
    });

    // Always show the 4 most recently delivered proteins (sorted by delivery date desc)
    // Plus any non-proteins expiring within 5 days
    const proteins = risks
      .filter(r => r.protein)
      .sort((a, b) => a.daysSinceDelivery - b.daysSinceDelivery)
      .slice(0, 4);

    const others = risks
      .filter(r => !r.protein && r.daysLeft >= 0 && r.daysLeft <= 5)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    return [...proteins, ...others];
  }

  // ── Price by Category ─────────────────────────────────────────────────────
  function computePriceByCategory(invoiceItems) {
    const catMap = {};

    (invoiceItems || []).forEach(item => {
      if (!item.unit_cost || !item.invoices?.date) return;
      const name = (item.ingredient_name_normalized || item.item_name || '').trim();
      if (!name) return;
      const cat = (item.category || 'Uncategorized').trim();
      const date = new Date(item.invoices.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const price = parseFloat(item.unit_cost);

      if (!catMap[cat]) catMap[cat] = {};
      if (!catMap[cat][name]) catMap[cat][name] = {};
      if (!catMap[cat][name][monthKey]) catMap[cat][name][monthKey] = [];
      catMap[cat][name][monthKey].push(price);
    });

    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const result = {};
    Object.entries(catMap).forEach(([cat, ingredients]) => {
      const ingList = [];
      Object.entries(ingredients).forEach(([ingName, monthData]) => {
        const history = buckets.map(b => {
          const vals = monthData[b];
          if (!vals || vals.length === 0) return null;
          return vals.reduce((a, v) => a + v, 0) / vals.length;
        });
        let last = null;
        const filled = history.map(v => { if (v !== null) { last = v; return v; } return last; });
        const filled2 = filled.slice().reverse().map(v => { if (v !== null) { last = v; return v; } return last; }).reverse();
        const validPts = filled2.filter(Boolean);
        if (validPts.length < 2) return;
        const firstPrice = validPts[0];
        const lastPrice = validPts[validPts.length - 1];
        const deltaPct = ((lastPrice - firstPrice) / firstPrice) * 100;
        if (Math.abs(deltaPct) < 2) return;
        ingList.push({ name: ingName, history: filled2, deltaPct, firstPrice, lastPrice });
      });
      if (ingList.length === 0) return;
      ingList.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
      const avgDelta = ingList.reduce((s, i) => s + i.deltaPct, 0) / ingList.length;
      result[cat] = { ingredients: ingList, avgDelta };
    });

    return result;
  }

  async function fetchAIRecommendations(dashData, restId) {
    try {
      setAiLoading(true);
      const res = await fetch('/api/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: restId }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      const recs = (json.recommendations || []).map(r => ({
        title: r.title,
        description: r.description,
        sellCopy: r.talking_point || null,
        type: r.type,
        margin: r.margin,
        confidence: r.confidence,
        urgency: r.urgency,
      }));
      setData(prev => ({ ...prev, aiRecommendations: recs }));
    } catch {
      setData(prev => ({
        ...prev,
        aiRecommendations: [
          { title: "Top Margin Item", description: "Highest margin dish on the menu tonight.", sellCopy: SELL_COPY[0], type: "margin", confidence: 80, urgency: "medium" },
          { title: "Fresh Catch Tonight", description: "Recently delivered — push before weekend.", sellCopy: SELL_COPY[1], type: "inventory", confidence: 75, urgency: "high" },
          { title: "Guest Favorite", description: "Consistently strong seller this week.", sellCopy: SELL_COPY[2], type: "trending", confidence: 70, urgency: "low" },
        ]
      }));
    } finally { setAiLoading(false); }
  }

  function processDashboardData(invoices, ingredients, menuItems, wasteRisk, priceByCategory) {
    const processedInvoices = invoices.filter(i => i.number && i.supplier && i.amount);
    const totalSpending = processedInvoices.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    const unpricedIngredients = ingredients.filter(i => !i.last_price || parseFloat(i.last_price) === 0).length;

    const menuItemAnalysis = menuItems.map(item => {
      const price = parseFloat(item.price || 0);
      let cost = 0; let hasCompleteData = false;
      if (item.menu_item_components && item.menu_item_components.length > 0) {
        cost = item.menu_item_components.reduce((t, c) => t + parseFloat(c.cost || 0), 0);
        hasCompleteData = item.menu_item_components.every(c =>
          (c.component_ingredients || []).length > 0 &&
          (c.component_ingredients || []).every(ci => ci.ingredients?.last_price && parseFloat(ci.ingredients.last_price) > 0)
        );
      } else if (item.cost && parseFloat(item.cost) > 0) {
        cost = parseFloat(item.cost); hasCompleteData = price > 0;
      }
      const margin = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0;
      const hasEstimated = item.menu_item_components?.some(c =>
        (c.component_ingredients || []).some(ci => ci.ingredients?.is_estimated === true)
      ) || false;
      return { id: item.id, name: item.name, price, cost, margin, hasCompleteData, hasEstimated };
    });

    const itemsWithMargins = menuItemAnalysis.filter(i => i.hasCompleteData && i.price > 0 && !i.hasEstimated);
    const averageMargin = itemsWithMargins.length > 0
      ? itemsWithMargins.reduce((s, i) => s + i.margin, 0) / itemsWithMargins.length : 0;
    const lowMarginCount = itemsWithMargins.filter(i => i.margin < LOW_MARGIN_THRESHOLD).length;
    const highMarginCount = itemsWithMargins.filter(i => i.margin >= 60).length;

    // FIX #4: cap at 8
    const ingredientTrends = ingredients
      .filter(i => i.last_price > 0)
      .sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price))
      .slice(0, 8)
      .map(i => ({ name: i.name, price: parseFloat(i.last_price), unit: i.unit }));

    const aiProfitScore = calculateAIProfitScore({
      itemsWithMargins, averageMargin, unpricedIngredients,
      totalIngredients: ingredients.length, totalMenuItems: menuItems.length,
      processedInvoices, totalInvoices: invoices.length,
    });

    return {
      totalInvoices: invoices.length, totalIngredients: ingredients.length,
      totalMenuItems: menuItems.length, ingredientTrends, menuItemAnalysis,
      unpricedIngredients, averageMargin, totalSpending, aiProfitScore,
      lowMarginCount, highMarginCount,
      wasteRisk: wasteRisk || [], priceByCategory: priceByCategory || {},
    };
  }

  function calculateAIProfitScore({ itemsWithMargins, averageMargin, unpricedIngredients, totalIngredients, totalMenuItems, processedInvoices, totalInvoices }) {
    let score = 0;
    score += Math.min((averageMargin / 60) * 35, 35);
    score += totalIngredients > 0 ? ((totalIngredients - unpricedIngredients) / totalIngredients) * 15 : 0;
    score += totalMenuItems > 0 ? (itemsWithMargins.length / totalMenuItems) * 15 : 0;
    score += totalInvoices > 0 ? (processedInvoices.length / totalInvoices) * 10 : 0;
    if (itemsWithMargins.length > 0) {
      const high = itemsWithMargins.filter(i => i.margin >= 50).length;
      const low = itemsWithMargins.filter(i => i.margin < 25).length;
      const balance = ((high / itemsWithMargins.length) * 15) - ((low / itemsWithMargins.length) * 8);
      score += Math.max(0, Math.min(15, balance + 5));
    }
    const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const recent = processedInvoices.filter(i => new Date(i.date || i.created_at) >= thirtyAgo).length;
    score += Math.min((recent / 5) * 10, 10);
    return { score: Math.max(0, Math.min(100, Math.round(score))) };
  }

  // ── MOBILE ─────────────────────────────────────────────────────────────────
  if (isMobile) {
    const circumference = 2 * Math.PI * 40;
    const scoreDash = (data.aiProfitScore.score / 100) * circumference;
    const { color: scoreColor, label: scoreLabel } = getScoreInfo(data.aiProfitScore.score);
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div className="mob-root">
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#02a4ba' }}>
                <div style={{ width: 5, height: 5, background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
                Active
              </div>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
            </div>
          </div>
          <div className="mob-titlebar">
            <div className="mob-page-title">Dashboard</div>
            <div className="mob-page-sub">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}</div>
          </div>
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
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 24, height: 24, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: '#4a453e' }}>Loading...</div>
            </div>
          ) : (
            <div className="mob-content">
              <div className="mob-card">
                <div className="mob-card-title">OptiScore</div>
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
                    <div style={{ fontSize: 12, color: '#4a453e', marginBottom: 4 }}>{restaurantName}</div>
                    <div className="mob-score-badge" style={{ background: `${scoreColor}18`, color: scoreColor }}>{scoreLabel}</div>
                  </div>
                </div>
              </div>
              <div className="mob-pill-grid">
                {[
                  { l: 'Invoices', v: data.totalInvoices, c: '#02a4ba' },
                  { l: 'Low Margin', v: data.lowMarginCount, c: '#c04040' },
                  { l: 'Avg Food Cost', v: `${data.averageMargin > 0 ? (100 - data.averageMargin).toFixed(1) : 0}%`, c: '#2a8a5a' },
                  { l: 'YTD Spend', v: formatCurrency(data.totalSpending), c: '#d4a020' },
                ].map(({ l, v, c }) => (
                  <div key={l} className="mob-pill">
                    <div className="mob-pill-l">{l}</div>
                    <div className="mob-pill-v" style={{ color: c }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="mob-card">
                <div className="mob-card-title">Tonight's Picks</div>
                {(data.aiRecommendations || []).slice(0, 3).map((rec, i) => {
                  const typeColor = rec.type === 'inventory' ? '#c04040' : rec.type === 'margin' ? '#2a8a5a' : '#02a4ba';
                  const sellCopy = rec.sellCopy || SELL_COPY[i % SELL_COPY.length];
                  return (
                    <div key={i} className="mob-ai-item" style={{ borderLeftColor: typeColor }}>
                      <div className="mob-ai-title">{rec.title}</div>
                      <div className="mob-ai-desc">{rec.description}</div>
                      <div className="mob-ai-sell">"{sellCopy}"</div>
                    </div>
                  );
                })}
              </div>
              <div className="mob-card">
                <div className="mob-card-title">Top Ingredient Costs</div>
                {data.ingredientTrends.map(ing => (
                  <div key={ing.name} className="mob-ing-row">
                    <div>
                      <div className="mob-ing-name">{ing.name}</div>
                      <div className="mob-ing-unit">per {ing.unit}</div>
                    </div>
                    <div className="mob-ing-price">{formatCurrencyDetailed(ing.price)}</div>
                  </div>
                ))}
              </div>
              <div style={{ height: 8 }} />
            </div>
          )}
          <div className="mob-bottom-nav">
            {[
              { label: 'Dashboard', path: '/client/dashboard', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
              { label: 'Invoices', path: '/client/invoices', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
              { label: 'Ingredients', path: '/client/ingredients', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
              { label: 'Menu', path: '/client/menu-items', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
              { label: 'Analytics', path: '/client/analytics', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
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
        <Analytics /><SpeedInsights />
        {tourProps && <TourOverlay {...tourProps} />}
        <TourDataBanner />
      </>
    );
  }

  // ── DESKTOP ERROR ──────────────────────────────────────────────────────────
  if (error) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ background: '#0a0908', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16, color: '#e8e2d8' }}>Unable to Load Dashboard</div>
        <div style={{ fontSize: 13, color: '#4a453e', marginBottom: 8 }}>{error}</div>
        <button onClick={() => window.location.reload()} style={{ background: '#02a4ba', border: 'none', borderRadius: 6, padding: '8px 18px', color: '#0a0908', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Try Again</button>
      </div>
    </>
  );

  // ── DESKTOP ────────────────────────────────────────────────────────────────
  const maxIngPrice = data.ingredientTrends.length > 0
    ? Math.max(...data.ingredientTrends.map(i => i.price)) : 1;

  const wasteProteins = data.wasteRisk.filter(w => w.protein);
  const wasteOther = data.wasteRisk.filter(w => !w.protein);

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="db-root">

        {/* TOP NAV */}
        <div className="db-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div className="db-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t} className={`db-tab${t === 'Dashboard' ? ' active' : ''}`}
                  onClick={() => { if (t !== 'Dashboard') router.push(`/client/${t.toLowerCase().replace(' ', '-')}`); }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,0.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'clamp(9px,0.62vw,11px)', color: '#02a4ba' }}>
              <div style={{ width: 5, height: 5, background: '#02a4ba', borderRadius: '50%', animation: 'blink 2s infinite' }} />
              Active
            </div>
            <div style={{ width: 'clamp(140px,13vw,240px)' }}>
              <UniversalSearch restaurantId={restaurantId} placeholder="Search..." />
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false} />
          </div>
        </div>

        {/* WELCOME BAR */}
        <div className="db-wbar">
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="db-wname">Welcome back, {userName}</span>
            <span className="db-wsub">· {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}</span>
          </div>
        </div>

        <div className="db-main">
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 'clamp(10px,0.78vw,13px)', color: '#4a453e' }}>Loading dashboard...</div>
            </div>
          ) : (
            <div className="db-grid-wrap">

              {/* SECTION HEADER — Tickets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'clamp(148px,12vw,200px) 1fr 1fr 1fr', gap: 'clamp(5px,0.5vw,9px)', flexShrink: 0 }}>
                <div />
                <div className="db-section-hd" style={{ gridColumn: '2 / 5' }}>Tonight's Recommendations</div>
              </div>

              {/* ROW TOP */}
              <div className="db-row-top">

                {/* LEFT — score card */}
                <div className="db-score-card">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(2px,0.22vh,3px)', width: '100%' }}>
                    <div className="db-rest-icon">
                      <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
                    </div>
                    <div className="db-rest-name">{restaurantName}</div>
                    <div className="db-rest-sub">Management Dashboard</div>
                  </div>
                  <ScoreRing score={data.aiProfitScore.score} />
                </div>

                {/* THREE THERMAL TICKETS */}
                {aiLoading ? (
                  [0, 1, 2].map(i => (
                    <div key={i} className="db-ticket" style={{ alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <div className="db-spinner" />
                      <div style={{ fontSize: 'clamp(9px,0.62vw,11px)', color: '#4a453e', fontFamily: 'Courier New, monospace' }}>Analyzing menu...</div>
                    </div>
                  ))
                ) : (data.aiRecommendations || []).length > 0
                  ? (data.aiRecommendations || []).slice(0, 3).map((rec, i) => (
                      <ThermalTicket key={i} rec={rec} index={i}
                        menuItems={menuItemsFull}
                        wasteRisk={data.wasteRisk}
                        averageMargin={data.averageMargin} />
                    ))
                  : [0, 1, 2].map(i => (
                      <div key={i} className="db-ticket" style={{ alignItems: 'center', justifyContent: 'center' }}>
                        <div className="db-empty">No recommendations yet</div>
                      </div>
                    ))
                }
              </div>

              {/* SECTION HEADER — Operations */}
              <div style={{ display: 'grid', gridTemplateColumns: 'clamp(148px,12vw,200px) 1fr 1fr 1fr', gap: 'clamp(5px,0.5vw,9px)', flexShrink: 0, margin: 'clamp(3px,0.3vh,5px) 0' }}>
                <div />
                <div className="db-section-hd" style={{ gridColumn: '2 / 5' }}>Operations</div>
              </div>

              {/* ROW BOTTOM */}
              <div className="db-row-bottom">

                {/* FIX #5: Key Metrics — 7 pills to fill the card */}
                <div className="db-stats-card">
                  <div style={{ fontSize: 'clamp(8px,0.58vw,10px)', color: '#3a3630', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600, flexShrink: 0 }}>Key Metrics</div>
                  {[
                    { l: 'YTD Spend', v: formatCurrency(data.totalSpending), c: '#d4a020', sub: `${data.totalInvoices} invoice${data.totalInvoices !== 1 ? 's' : ''}` },
                    { l: 'Avg Margin', v: `${data.averageMargin.toFixed(1)}%`, c: getMarginColor(data.averageMargin), sub: `${(100 - data.averageMargin).toFixed(1)}% avg food cost` },
                    { l: 'High Margin Items', v: data.highMarginCount || 0, c: '#2a8a5a', sub: 'Above 60% margin' },
                    { l: 'Low Margin Items', v: data.lowMarginCount, c: '#c04040', sub: data.lowMarginCount > 0 ? `Below ${LOW_MARGIN_THRESHOLD}% threshold` : 'All items healthy' },
                    { l: 'Menu Items', v: data.totalMenuItems, c: '#02a4ba', sub: `${data.menuItemAnalysis?.filter(m => m.hasCompleteData).length || 0} fully costed` },
                    { l: 'Ingredients', v: data.totalIngredients, c: '#e8e2d8', sub: data.unpricedIngredients > 0 ? `${data.unpricedIngredients} unpriced` : 'All priced' },
                    { l: 'Waste Alerts', v: data.wasteRisk.length, c: data.wasteRisk.length > 0 ? '#c04040' : '#2a8a5a', sub: data.wasteRisk.length > 0 ? `${wasteProteins.length} protein, ${wasteOther.length} other` : 'Nothing expiring soon' },
                  ].map(({ l, v, c, sub }) => (
                    <div key={l} className="db-pill" style={{ flex: 1 }}>
                      <div className="db-pill-left">
                        <div className="db-pill-l">{l}</div>
                        <div className="db-pill-sub">{sub}</div>
                      </div>
                      <div className="db-pill-v" style={{ color: c }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* WASTE RISK — two sections */}
                <div className="db-card">
                  <div className="db-card-hd">
                    <div className="db-card-title">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      Waste Risk
                    </div>
                    <span className="db-card-sub">{data.wasteRisk.length > 0 ? `${data.wasteRisk.length} at risk` : 'All clear'}</span>
                  </div>

                  <div className="db-waste-list">
                    {data.wasteRisk.length === 0 && (
                      <div className="db-empty">No expiring items detected</div>
                    )}

                    {wasteProteins.length > 0 && (
                      <>
                        <div style={{ fontSize: 'clamp(7px,0.55vw,9px)', color: '#4a453e', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600, marginBottom: 'clamp(3px,0.3vh,5px)', flexShrink: 0 }}>
                          Proteins at Risk
                        </div>
                        {wasteProteins.map((item, i) => <WasteRow key={`p-${i}`} item={item} router={router} />)}
                      </>
                    )}

                    {wasteProteins.length > 0 && wasteOther.length > 0 && (
                      <div style={{ borderTop: '1px solid #1a1915', margin: 'clamp(4px,0.4vh,7px) 0', flexShrink: 0 }} />
                    )}

                    {wasteOther.length > 0 && (
                      <>
                        <div style={{ fontSize: 'clamp(7px,0.55vw,9px)', color: '#4a453e', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600, marginBottom: 'clamp(3px,0.3vh,5px)', flexShrink: 0 }}>
                          Ingredients at Risk
                        </div>
                        {wasteOther.map((item, i) => <WasteRow key={`o-${i}`} item={item} router={router} />)}
                      </>
                    )}
                  </div>

                  {data.wasteRisk.length > 0 && (
                    <div className="db-legend-strip">
                      <span><span className="db-legend-dot" style={{ background: '#c04040' }} />Expired / today</span>
                      <span><span className="db-legend-dot" style={{ background: '#d4a020' }} />2 days</span>
                      <span><span className="db-legend-dot" style={{ background: '#02a4ba' }} />3–7 days</span>
                    </div>
                  )}
                </div>

                {/* PRICE MOVEMENT */}
                <PriceMovementCard priceByCategory={data.priceByCategory} />

                {/* TOP INGREDIENT COSTS — FIX #4: top 8, flex fill, no scroll */}
                <div className="db-card">
                  <div className="db-card-hd">
                    <div className="db-card-title">
                      <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                      Top Ingredient Costs
                    </div>
                    <span className="db-card-sub">by unit price</span>
                  </div>
                  <div className="db-ing-list">
                    {data.ingredientTrends.length > 0 ? data.ingredientTrends.map(ing => (
                      <div key={ing.name} className="db-ing-row">
                        <div className="db-ing-top">
                          <div>
                            <div className="db-ing-name">{ing.name}</div>
                            <div className="db-ing-unit">per {ing.unit}</div>
                          </div>
                          <div className="db-ing-val">{formatCurrencyDetailed(ing.price)}</div>
                        </div>
                        <div className="db-ing-bar-track">
                          <div className="db-ing-bar-fill" style={{ width: `${(ing.price / maxIngPrice) * 100}%` }} />
                        </div>
                      </div>
                    )) : <div className="db-empty">No ingredient data yet</div>}
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>

      <Analytics /><SpeedInsights />
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
    </>
  );
}