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

// ─── Shelf life knowledge (days from delivery) ────────────────────────────────
const SHELF_LIFE = {
  // Fish & Seafood
  fish: 2, salmon: 2, tuna: 2, halibut: 2, cod: 2, tilapia: 2, mahi: 2,
  shrimp: 2, scallop: 2, lobster: 1, crab: 2, oyster: 3, clam: 3,
  swordfish: 2, bass: 2, snapper: 2, flounder: 2, trout: 2,
  "bluefin tuna": 2, "seared toro": 2,
  // Meat & Poultry
  chicken: 3, beef: 4, pork: 4, lamb: 4, veal: 3, duck: 3, turkey: 3,
  steak: 4, "ground beef": 3, "ground pork": 3, bacon: 7, sausage: 4,
  "filet mignon": 4, "new york strip": 4, ribeye: 4, "short rib": 4,
  // Dairy
  milk: 7, cream: 7, butter: 14, cheese: 14, "heavy cream": 7,
  "sour cream": 14, yogurt: 14, mozzarella: 7, parmesan: 30,
  // Produce — leafy
  lettuce: 7, spinach: 5, arugula: 5, kale: 7, herbs: 5,
  basil: 5, parsley: 7, cilantro: 5, mint: 7, chives: 7,
  // Produce — soft
  tomato: 7, strawberry: 5, raspberry: 3, blueberry: 7, mushroom: 7,
  avocado: 4, asparagus: 5, corn: 4, pea: 5,
  // Produce — firm
  carrot: 21, onion: 30, garlic: 30, potato: 21, apple: 21,
  lemon: 21, lime: 14, orange: 14, beet: 21, celery: 14,
  broccoli: 7, cauliflower: 7, zucchini: 7, pepper: 10,
  // Pantry / long shelf
  olive: 60, oil: 180, flour: 180, sugar: 365, salt: 365,
  pasta: 365, rice: 365, vinegar: 365, sauce: 30,
};

function getShelfLife(ingredientName) {
  if (!ingredientName) return 14;
  const lower = ingredientName.toLowerCase();
  // Try exact match first
  if (SHELF_LIFE[lower]) return SHELF_LIFE[lower];
  // Try partial match
  for (const [key, days] of Object.entries(SHELF_LIFE)) {
    if (lower.includes(key) || key.includes(lower.split(' ')[0])) return days;
  }
  return 14; // default: 2 weeks
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

function getWasteUrgencyColor(daysLeft) {
  if (daysLeft <= 1) return "#c04040";
  if (daysLeft <= 2) return "#d4a020";
  return "#02a4ba";
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a0908; overflow: hidden; }
  #__next { height: 100%; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

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

  /* ── Grid ── */
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

  /* ── Left panel ── */
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

  .db-score-wrap { display: flex; flex-direction: column; align-items: center; gap: clamp(4px, 0.4vh, 7px); flex-shrink: 0; }
  .db-score-lbl { font-size: clamp(8px, 0.62vw, 11px); color: #6b6358; text-transform: uppercase; letter-spacing: .5px; font-weight: 500; }
  .db-ring { position: relative; width: clamp(56px, 5.5vw, 90px); height: clamp(56px, 5.5vw, 90px); }
  .db-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .db-ring-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .db-ring-num { font-family: 'Playfair Display', serif; font-size: clamp(16px, 1.6vw, 26px); color: #e8e2d8; line-height: 1; }
  .db-ring-sub { font-size: clamp(7px, 0.58vw, 10px); color: #4a453e; }
  .db-score-tag { font-size: clamp(9px, 0.65vw, 12px); font-weight: 600; padding: clamp(2px,0.2vh,3px) clamp(7px,0.55vw,11px); border-radius: 10px; }

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

  /* ── Generic card ── */
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

  .db-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: clamp(10px, 0.78vw, 14px); color: #4a453e; }
  .db-spinner { width: clamp(7px, 0.65vw, 11px); height: clamp(7px, 0.65vw, 11px); border: 1.5px solid #2a2620; border-top-color: #02a4ba; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; }

  /* ── Kitchen Tickets row ── */
  .db-tickets-row {
    grid-column: 2 / 5;
    grid-row: 1;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: clamp(6px, 0.6vw, 12px);
    min-height: 0;
  }

  /* ── Single kitchen ticket ── */
  .db-ticket {
    background: #13120f;
    border: 1px solid #2a2620;
    border-radius: clamp(5px, 0.4vw, 9px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    animation: fadeIn 0.3s ease both;
  }
  .db-ticket:nth-child(2) { animation-delay: 0.08s; }
  .db-ticket:nth-child(3) { animation-delay: 0.16s; }

  /* Ticket top tear edge */
  .db-ticket-tear {
    height: clamp(6px, 0.6vh, 10px);
    background: repeating-linear-gradient(
      90deg,
      #1a1915 0px,
      #1a1915 6px,
      transparent 6px,
      transparent 10px
    );
    flex-shrink: 0;
  }

  .db-ticket-header {
    background: #1a1915;
    border-bottom: 1px dashed #2a2620;
    padding: clamp(6px, 0.6vh, 10px) clamp(10px, 0.9vw, 16px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .db-ticket-label {
    font-size: clamp(7px, 0.58vw, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #4a453e;
    font-family: 'Courier New', monospace;
  }

  .db-ticket-badge {
    font-size: clamp(7px, 0.55vw, 9px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .5px;
    padding: clamp(2px,0.2vh,3px) clamp(5px,0.45vw,8px);
    border-radius: 4px;
  }

  .db-ticket-body {
    flex: 1;
    padding: clamp(8px, 0.8vh, 14px) clamp(10px, 0.9vw, 16px);
    display: flex;
    flex-direction: column;
    gap: clamp(5px, 0.5vh, 9px);
    min-height: 0;
  }

  .db-ticket-name {
    font-family: 'Playfair Display', serif;
    font-size: clamp(13px, 1.15vw, 20px);
    color: #e8e2d8;
    line-height: 1.2;
    flex-shrink: 0;
  }

  .db-ticket-divider {
    border: none;
    border-top: 1px dashed #2a2620;
    flex-shrink: 0;
  }

  .db-ticket-why {
    font-size: clamp(9px, 0.65vw, 11px);
    color: #6b6358;
    line-height: 1.5;
    flex-shrink: 0;
  }

  .db-ticket-sell {
    font-size: clamp(9px, 0.68vw, 12px);
    color: #9a9086;
    line-height: 1.5;
    font-style: italic;
    flex: 1;
  }

  .db-ticket-sell::before {
    content: '"';
    color: #02a4ba;
    font-style: normal;
    font-weight: 600;
  }
  .db-ticket-sell::after {
    content: '"';
    color: #02a4ba;
    font-style: normal;
    font-weight: 600;
  }

  /* Ticket bottom tear */
  .db-ticket-bottom {
    padding: clamp(5px, 0.5vh, 8px) clamp(10px, 0.9vw, 16px);
    border-top: 1px dashed #2a2620;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .db-ticket-margin {
    font-family: 'Courier New', monospace;
    font-size: clamp(9px, 0.72vw, 13px);
    font-weight: 700;
  }

  .db-ticket-no {
    font-family: 'Courier New', monospace;
    font-size: clamp(8px, 0.6vw, 11px);
    color: #2a2620;
  }

  /* ── Bottom row cards ── */
  .db-bottom-row {
    grid-column: 2 / 5;
    grid-row: 2;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: clamp(6px, 0.6vw, 12px);
    min-height: 0;
  }

  /* Waste risk rows */
  .db-waste-row {
    display: flex;
    align-items: center;
    gap: clamp(6px, 0.5vw, 10px);
    padding: clamp(5px, 0.5vh, 9px) clamp(8px, 0.7vw, 12px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.35vw, 6px);
    border: 1px solid #1a1915;
    margin-bottom: clamp(4px, 0.4vh, 7px);
    flex-shrink: 0;
  }
  .db-waste-row:last-child { margin-bottom: 0; }

  .db-waste-dot {
    width: clamp(6px, 0.5vw, 9px);
    height: clamp(6px, 0.5vw, 9px);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .db-waste-name {
    flex: 1;
    font-size: clamp(10px, 0.75vw, 13px);
    color: #9a9086;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .db-waste-days {
    font-size: clamp(9px, 0.65vw, 11px);
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Price movement rows */
  .db-price-row {
    display: flex;
    align-items: center;
    gap: clamp(6px, 0.5vw, 10px);
    padding: clamp(5px, 0.5vh, 9px) clamp(8px, 0.7vw, 12px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.35vw, 6px);
    border: 1px solid #1a1915;
    margin-bottom: clamp(4px, 0.4vh, 7px);
    flex-shrink: 0;
  }
  .db-price-row:last-child { margin-bottom: 0; }

  .db-price-name {
    flex: 1;
    font-size: clamp(10px, 0.75vw, 13px);
    color: #9a9086;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .db-price-delta {
    font-size: clamp(10px, 0.75vw, 13px);
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .db-price-arrow {
    font-size: clamp(9px, 0.65vw, 11px);
    flex-shrink: 0;
  }

  /* Top ingredient rows */
  .db-ing-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: clamp(5px, 0.5vh, 9px) clamp(8px, 0.7vw, 12px);
    background: #0f0e0c;
    border-radius: clamp(4px, 0.35vw, 6px);
    border: 1px solid #1a1915;
    margin-bottom: clamp(4px, 0.4vh, 7px);
    flex-shrink: 0;
  }
  .db-ing-row:last-child { margin-bottom: 0; }
  .db-ing-name { font-size: clamp(10px, 0.75vw, 13px); color: #9a9086; }
  .db-ing-unit { font-size: clamp(8px, 0.6vw, 10px); color: #4a453e; margin-top: 1px; }
  .db-ing-val { font-size: clamp(10px, 0.78vw, 14px); font-weight: 600; color: #02a4ba; }

  /* Mobile (preserved from original) */
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
  .mob-ai-item { background: #0f0e0c; border-radius: 7px; border-left: 2px solid #02a4ba; padding: 10px 12px; margin-bottom: 8px; }
  .mob-ai-item:last-child { margin-bottom: 0; }
  .mob-ai-title { font-size: 12px; font-weight: 600; color: #e8e2d8; margin-bottom: 3px; }
  .mob-ai-desc { font-size: 11px; color: #6b6358; line-height: 1.45; }
  .mob-ai-sell { font-size: 11px; color: #9a9086; font-style: italic; margin-top: 5px; line-height: 1.45; }
  .mob-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .mob-bar-row:last-child { margin-bottom: 0; }
  .mob-bar-name { font-size: 12px; color: #9a9086; width: 110px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mob-bar-track { flex: 1; background: #1a1915; border-radius: 3px; height: 5px; }
  .mob-bar-fill { height: 5px; border-radius: 3px; }
  .mob-bar-pct { font-size: 12px; font-weight: 600; width: 44px; text-align: right; flex-shrink: 0; }
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
    .db-tickets-row { grid-column: 1 / 3; grid-row: 2; }
    .db-bottom-row { grid-column: 1 / 3; grid-row: 3; }
  }
`;

// ─── ScoreRing (unchanged) ────────────────────────────────────────────────────

function ScoreRing({ score }) {
  const { color, label } = getScoreInfo(score);
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
    </div>
  );
}

// ─── KitchenTicket ────────────────────────────────────────────────────────────

const SELL_COPY = [
  "Just came in fresh — one of the best things on the menu tonight.",
  "The kitchen is really proud of this one tonight — worth every bite.",
  "Guests have been loving this lately — a great choice tonight.",
  "This one is exceptional right now — highly recommend it.",
  "A personal favorite of the chef tonight — you won't be disappointed.",
  "Incredibly fresh tonight — this is the one to get.",
];

function KitchenTicket({ rec, index }) {
  if (!rec) return null;

  const typeColor =
    rec.type === 'inventory' ? '#c04040' :
    rec.type === 'margin' ? '#2a8a5a' : '#02a4ba';

  const typeLabel =
    rec.type === 'inventory' ? 'Move Tonight' :
    rec.type === 'margin' ? 'High Margin' : 'Trending';

  const sellCopy = rec.sellCopy || SELL_COPY[index % SELL_COPY.length];
  const marginDisplay = rec.margin ? `${rec.margin.toFixed(1)}%` : null;

  return (
    <div className="db-ticket">
      <div className="db-ticket-tear" />
      <div className="db-ticket-header">
        <span className="db-ticket-label">Tonight's Pick #{index + 1}</span>
        <span className="db-ticket-badge" style={{ background: `${typeColor}18`, color: typeColor }}>
          {typeLabel}
        </span>
      </div>
      <div className="db-ticket-body">
        <div className="db-ticket-name">{rec.title}</div>
        <hr className="db-ticket-divider" />
        <div className="db-ticket-why">{rec.description}</div>
        <div className="db-ticket-sell">{sellCopy}</div>
      </div>
      <div className="db-ticket-bottom">
        {marginDisplay
          ? <span className="db-ticket-margin" style={{ color: typeColor }}>{marginDisplay} margin</span>
          : <span className="db-ticket-margin" style={{ color: '#4a453e' }}>—</span>
        }
        <span className="db-ticket-no">#{String(index + 1).padStart(3, '0')}</span>
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
  const [activeTab, setActiveTab] = useState("Dashboard");

  const [data, setData] = useState({
    totalInvoices: 0, totalIngredients: 0, totalMenuItems: 0,
    ingredientTrends: [], menuItemAnalysis: [],
    unpricedIngredients: 0, averageMargin: 0,
    totalSpending: 0, aiProfitScore: { score: 0 }, aiRecommendations: [],
    lowMarginCount: 0, wasteRisk: [], priceMovement: [],
  });

  const LOW_MARGIN_THRESHOLD = 40;

  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
    router.prefetch('/client/analytics');
  }, []);

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
      const processed = processDashboardData(sample.invoices, sample.ingredients, sample.menuItems, [], []);
      setData(processed);
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
          const processed = processDashboardData(sample.invoices, sample.ingredients, sample.menuItems, [], []);
          setData(processed);
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

      if (router.query.tour !== 'true') await fetchDashboardData(profile.restaurant_id);
      else setLoading(false);
    } catch {
      setError("An unexpected error occurred"); setLoading(false);
    }
  }

  async function fetchDashboardData(restId) {
    try {
      setLoading(true);

      const [
        { data: invoices },
        { data: ingredients },
        { data: menuItems },
        { data: invoiceItems },
      ] = await Promise.all([
        supabase.from("invoices").select("*").eq("restaurant_id", restId).order("created_at", { ascending: false }),
        supabase.from("ingredients").select("*").eq("restaurant_id", restId),
        supabase.from("menu_items").select(`*, menu_item_components(id, name, cost, component_ingredients(quantity, ingredients(last_price, is_estimated)))`).eq("restaurant_id", restId),
        // Join invoice_items with invoices to get delivery dates
        supabase.from("invoice_items")
          .select("*, invoices!inner(date, restaurant_id)")
          .eq("invoices.restaurant_id", restId)
          .order("invoices(date)", { ascending: false }),
      ]);

      const wasteRisk = computeWasteRisk(invoiceItems || [], invoices || []);
      const priceMovement = computePriceMovement(invoiceItems || []);
      const processed = processDashboardData(invoices || [], ingredients || [], menuItems || [], wasteRisk, priceMovement);
      setData(processed);
      setLoading(false);
      fetchAIRecommendations(processed, restId);
    } catch (err) {
      setError("Failed to fetch dashboard data: " + err.message);
      setLoading(false);
    }
  }

  // ── Waste Risk: find most recent delivery date per ingredient, compute days left ──
  function computeWasteRisk(invoiceItems, invoices) {
    // Build invoice date map
    const invoiceDateMap = {};
    (invoices || []).forEach(inv => { if (inv.id && inv.date) invoiceDateMap[inv.id] = inv.date; });

    // Find most recent purchase date per ingredient
    const latestByIngredient = {};
    (invoiceItems || []).forEach(item => {
      const name = (item.ingredient_name_normalized || item.item_name || '').trim();
      if (!name) return;
      // Date from joined invoices object or from map
      const dateStr = item.invoices?.date || invoiceDateMap[item.invoice_id];
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (!latestByIngredient[name] || date > latestByIngredient[name].date) {
        latestByIngredient[name] = { date, unit: item.unit };
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const risks = Object.entries(latestByIngredient).map(([name, { date, unit }]) => {
      const shelfLife = getShelfLife(name);
      const deliveryDate = new Date(date);
      deliveryDate.setHours(0, 0, 0, 0);
      const daysSinceDelivery = Math.floor((today - deliveryDate) / (1000 * 60 * 60 * 24));
      const daysLeft = shelfLife - daysSinceDelivery;
      return { name, daysLeft, shelfLife, deliveryDate };
    });

    // Only show items expiring within 5 days, sorted by urgency
    return risks
      .filter(r => r.daysLeft >= 0 && r.daysLeft <= 5)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 5);
  }

  // ── Price Movement: find last two prices per ingredient, compute delta ──
  function computePriceMovement(invoiceItems) {
    // Group by normalized ingredient name, collect all prices with dates
    const priceHistory = {};
    (invoiceItems || []).forEach(item => {
      const name = (item.ingredient_name_normalized || item.item_name || '').trim();
      if (!name || !item.unit_cost || !item.invoices?.date) return;
      if (!priceHistory[name]) priceHistory[name] = [];
      priceHistory[name].push({ price: parseFloat(item.unit_cost), date: new Date(item.invoices.date) });
    });

    const movements = [];
    Object.entries(priceHistory).forEach(([name, entries]) => {
      if (entries.length < 2) return;
      // Sort by date desc
      entries.sort((a, b) => b.date - a.date);
      const latest = entries[0].price;
      const prior = entries[1].price;
      if (prior === 0) return;
      const deltaPct = ((latest - prior) / prior) * 100;
      if (Math.abs(deltaPct) < 3) return; // filter noise
      movements.push({ name, latest, prior, deltaPct });
    });

    // Sort by absolute change, show top 5
    return movements
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
      .slice(0, 5);
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
          { title: "Review Top Performers", description: "Your highest margin items are ready to promote.", sellCopy: "This one is exceptional right now — highly recommend it.", type: "margin" },
          { title: "Monitor Ingredient Costs", description: "Track pricing changes across key ingredients.", sellCopy: "Just came in fresh — one of the best things on the menu tonight.", type: "trending" },
          { title: "Optimize Your Menu", description: "A few adjustments could meaningfully improve overall margins.", sellCopy: "The kitchen is really proud of this one tonight — worth every bite.", type: "trending" },
        ]
      }));
    } finally { setAiLoading(false); }
  }

  function processDashboardData(invoices, ingredients, menuItems, wasteRisk, priceMovement) {
    const processedInvoices = invoices.filter(i => i.number && i.supplier && i.amount);
    const totalSpending = processedInvoices.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    const unpricedIngredients = ingredients.filter(i => !i.last_price || parseFloat(i.last_price) === 0).length;

    const menuItemAnalysis = menuItems.map(item => {
      const price = parseFloat(item.price || 0);
      let cost = 0;
      let hasCompleteData = false;

      if (item.menu_item_components && item.menu_item_components.length > 0) {
        cost = item.menu_item_components.reduce((t, c) => t + parseFloat(c.cost || 0), 0);
        hasCompleteData = item.menu_item_components.every(c =>
          (c.component_ingredients || []).length > 0 &&
          (c.component_ingredients || []).every(ci =>
            ci.ingredients?.last_price && parseFloat(ci.ingredients.last_price) > 0
          )
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
    const averageMargin = itemsWithMargins.length > 0
      ? itemsWithMargins.reduce((s, i) => s + i.margin, 0) / itemsWithMargins.length : 0;
    const lowMarginCount = itemsWithMargins.filter(i => i.margin < LOW_MARGIN_THRESHOLD).length;

    const ingredientTrends = ingredients
      .filter(i => i.last_price > 0)
      .sort((a, b) => parseFloat(b.last_price) - parseFloat(a.last_price))
      .slice(0, 5)
      .map(i => ({ name: i.name, price: parseFloat(i.last_price), unit: i.unit }));

    const aiProfitScore = calculateAIProfitScore({
      itemsWithMargins, averageMargin, unpricedIngredients,
      totalIngredients: ingredients.length,
      totalMenuItems: menuItems.length,
      processedInvoices,
      totalInvoices: invoices.length,
    });

    return {
      totalInvoices: invoices.length,
      totalIngredients: ingredients.length,
      totalMenuItems: menuItems.length,
      ingredientTrends,
      menuItemAnalysis,
      unpricedIngredients,
      averageMargin,
      totalSpending,
      aiProfitScore,
      lowMarginCount,
      wasteRisk: wasteRisk || [],
      priceMovement: priceMovement || [],
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

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];

  // ── MOBILE LAYOUT (preserved) ──────────────────────────────────────────────
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
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
            </div>
          </div>
          <div className="mob-titlebar">
            <div className="mob-page-title">Dashboard</div>
            <div className="mob-page-sub">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}
            </div>
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
              <div style={{ fontSize: 12, color: '#4a453e' }}>Loading dashboard...</div>
            </div>
          ) : (
            <div className="mob-content">
              {/* OptiScore */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  OptiScore
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
              {/* Quick pills */}
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
              {/* Tonight's Picks */}
              <div className="mob-card">
                <div className="mob-card-title">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  Tonight's Picks
                  {aiLoading && <div style={{ width: 10, height: 10, border: '1.5px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite', marginLeft: 4 }} />}
                </div>
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
              {/* Waste Risk */}
              {data.wasteRisk.length > 0 && (
                <div className="mob-card">
                  <div className="mob-card-title">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Waste Risk
                  </div>
                  {data.wasteRisk.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: i < data.wasteRisk.length - 1 ? '1px solid #1a1915' : 'none' }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: getWasteUrgencyColor(item.daysLeft), flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 13, color: '#9a9086' }}>{item.name}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: getWasteUrgencyColor(item.daysLeft) }}>
                        {item.daysLeft === 0 ? 'Use today' : `${item.daysLeft}d left`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                )) : <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '8px 0' }}>No ingredient data yet</div>}
              </div>
              <div style={{ height: 8, flexShrink: 0 }} />
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

  // ── DESKTOP ERROR STATE ────────────────────────────────────────────────────
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

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────
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
            <div style={{ width: 'clamp(160px, 14vw, 260px)' }}>
              <UniversalSearch restaurantId={restaurantId} placeholder="Search..." />
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={isMobile} />
          </div>
        </div>

        {/* WELCOME BAR */}
        <div className="db-wbar">
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="db-wname">Welcome back, {userName}</span>
            <span className="db-wsub">· {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {restaurantName}</span>
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
                  { l: 'Invoices',      v: data.totalInvoices,                                                               c: '#02a4ba' },
                  { l: 'Low Margin',    v: data.lowMarginCount,                                                              c: '#c04040' },
                  { l: 'Avg Food Cost', v: `${data.averageMargin > 0 ? (100 - data.averageMargin).toFixed(1) : 0}%`,        c: '#2a8a5a' },
                  { l: 'YTD Spend',     v: formatCurrency(data.totalSpending),                                               c: '#d4a020' },
                ].map(({ l, v, c }) => (
                  <div key={l} className="db-pill">
                    <div className="db-pill-l">{l}</div>
                    <div className="db-pill-v" style={{ color: c }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ROW 1 — THREE KITCHEN TICKETS */}
            <div className="db-tickets-row">
              {aiLoading ? (
                [0, 1, 2].map(i => (
                  <div key={i} className="db-ticket" style={{ alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <div className="db-spinner" />
                    <div style={{ fontSize: 'clamp(9px,0.65vw,11px)', color: '#4a453e' }}>Analyzing tonight's menu...</div>
                  </div>
                ))
              ) : (data.aiRecommendations || []).length > 0
                ? (data.aiRecommendations || []).slice(0, 3).map((rec, i) => (
                    <KitchenTicket key={i} rec={rec} index={i} />
                  ))
                : [0, 1, 2].map(i => (
                    <div key={i} className="db-ticket">
                      <div className="db-ticket-tear" />
                      <div className="db-ticket-header">
                        <span className="db-ticket-label">Tonight's Pick #{i + 1}</span>
                      </div>
                      <div className="db-empty">No recommendations yet</div>
                    </div>
                  ))
              }
            </div>

            {/* ROW 2 — WASTE RISK | PRICE MOVEMENT | TOP INGREDIENTS */}
            <div className="db-bottom-row">

              {/* Waste Risk */}
              <div className="db-card">
                <div className="db-card-hd">
                  <div className="db-card-title">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Waste Risk
                  </div>
                </div>
                {data.wasteRisk.length > 0
                  ? data.wasteRisk.map((item, i) => (
                    <div key={i} className="db-waste-row">
                      <div className="db-waste-dot" style={{ background: getWasteUrgencyColor(item.daysLeft) }} />
                      <div className="db-waste-name">{item.name}</div>
                      <div className="db-waste-days" style={{ color: getWasteUrgencyColor(item.daysLeft) }}>
                        {item.daysLeft === 0 ? 'Use today' : item.daysLeft === 1 ? '1 day left' : `${item.daysLeft} days left`}
                      </div>
                    </div>
                  ))
                  : <div className="db-empty">No expiring items detected</div>
                }
              </div>

              {/* Price Movement */}
              <div className="db-card">
                <div className="db-card-hd">
                  <div className="db-card-title">
                    <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                    Price Movement
                  </div>
                </div>
                {data.priceMovement.length > 0
                  ? data.priceMovement.map((item, i) => (
                    <div key={i} className="db-price-row">
                      <div className="db-price-name">{item.name}</div>
                      <div className="db-price-arrow" style={{ color: item.deltaPct > 0 ? '#c04040' : '#2a8a5a' }}>
                        {item.deltaPct > 0 ? '↑' : '↓'}
                      </div>
                      <div className="db-price-delta" style={{ color: item.deltaPct > 0 ? '#c04040' : '#2a8a5a' }}>
                        {Math.abs(item.deltaPct).toFixed(1)}%
                      </div>
                    </div>
                  ))
                  : <div className="db-empty">No price changes detected</div>
                }
              </div>

              {/* Top Ingredient Costs */}
              <div className="db-card">
                <div className="db-card-hd">
                  <div className="db-card-title">
                    <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                    Top Ingredient Costs
                  </div>
                </div>
                {data.ingredientTrends.length > 0
                  ? data.ingredientTrends.map(ing => (
                    <div key={ing.name} className="db-ing-row">
                      <div>
                        <div className="db-ing-name">{ing.name}</div>
                        <div className="db-ing-unit">per {ing.unit}</div>
                      </div>
                      <div className="db-ing-val">{formatCurrencyDetailed(ing.price)}</div>
                    </div>
                  ))
                  : <div className="db-empty">No ingredient data yet</div>
                }
              </div>

            </div>
          </div>
        )}
      </div>

      <Analytics /><SpeedInsights />
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
    </>
  );
}