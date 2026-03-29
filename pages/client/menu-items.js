// pages/client/menu-items.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { calculateStandardizedCost } from '../../lib/standardizedUnits';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '--';
  const n = parseFloat(amount);
  if (isNaN(n)) return '--';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return 'N/A';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return 'N/A'; }
}

function getUserInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase();
}

function getMarginNum(price, cost) {
  const p = parseFloat(price || 0);
  const c = parseFloat(cost || 0);
  if (p === 0 || c === 0) return null;
  return ((p - c) / p) * 100;
}

function getMarginColor(margin) {
  if (margin === null || margin === undefined) return '#4a453e';
  if (margin >= 70) return '#2a8a5a';
  if (margin >= 50) return '#02a4ba';
  if (margin >= 30) return '#d4a020';
  return '#c04040';
}

function getStatus(item) {
  const hasPrice = item.price && parseFloat(item.price) > 0;
  const hasCost = item.cost && parseFloat(item.cost) > 0;
  const hasIncomplete = hasIncompleteCosting(item);
  if (hasIncomplete) return { label: 'Incomplete', cls: 'cs-incomplete' };
  if (hasPrice && hasCost) return { label: 'Complete', cls: 'cs-complete' };
  return { label: 'Partial', cls: 'cs-partial' };
}

function hasIncompleteCosting(item) {
  if (item.menu_item_components && item.menu_item_components.length > 0) {
    return item.menu_item_components.some(c =>
      (c.component_ingredients || []).some(i =>
        !i.ingredients?.last_price || parseFloat(i.ingredients.last_price) === 0
      )
    );
  }
  if (!item.menu_item_ingredients || item.menu_item_ingredients.length === 0) return true;
  return item.menu_item_ingredients.some(i =>
    !i.ingredients?.last_price || parseFloat(i.ingredients.last_price) === 0
  );
}

function getIngredientCount(item) {
  if (item.menu_item_components && item.menu_item_components.length > 0) {
    const ids = new Set();
    item.menu_item_components.forEach(c =>
      (c.component_ingredients || []).forEach(i => { if (i.ingredients?.id) ids.add(i.ingredients.id); })
    );
    return ids.size;
  }
  return item.menu_item_ingredients?.length || 0;
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
  select option { background: #1a1915; color: #e8e2d8; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #0f0e0c; }
  ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }
  input[type=range] { -webkit-appearance: none; height: 4px; border-radius: 2px; background: #1a1915; outline: none; cursor: pointer; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #02a4ba; cursor: pointer; }

  .mi-root { font-family: 'Inter', sans-serif; background: #0a0908; color: #e8e2d8; width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

  /* NAV */
  .mi-nav { background: #0f0e0c; border-bottom: 1px solid #2a2620; height: clamp(36px,4vh,52px); padding: 0 clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .mi-logo { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); color: #e8e2d8; letter-spacing: -.3px; }
  .mi-logo span { color: #02a4ba; }
  .mi-tab { padding: clamp(2px,.3vh,4px) clamp(6px,.6vw,11px); border-radius: 4px; font-size: clamp(10px,.75vw,13px); color: #4a453e; border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .mi-tab.active { color: #e8e2d8; background: #1a1915; }
  .mi-search-sm { background: #1a1915; border: 1px solid #2a2620; border-radius: 4px; padding: clamp(3px,.3vh,6px) clamp(8px,.7vw,13px); font-size: clamp(10px,.75vw,13px); color: #e8e2d8; width: clamp(120px,12vw,220px); outline: none; font-family: 'Inter', sans-serif; }
  .mi-avatar { width: clamp(22px,1.8vw,30px); height: clamp(22px,1.8vw,30px); border-radius: 50%; background: #02a4ba; display: flex; align-items: center; justify-content: center; font-size: clamp(8px,.65vw,11px); font-weight: 700; color: #0a0908; flex-shrink: 0; cursor: pointer; }

  /* PAGE HEADER */
  .mi-ph { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(8px,.8vh,14px) clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .mi-ph-title { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,20px); color: #e8e2d8; }
  .mi-ph-sub { font-size: clamp(9px,.65vw,11px); color: #4a453e; margin-top: 2px; }
  .mi-search-lg { background: #1a1915; border: 1px solid #2a2620; border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); color: #e8e2d8; width: clamp(160px,16vw,280px); outline: none; font-family: 'Inter', sans-serif; }
  .mi-sort { background: #1a1915; border: 1px solid #2a2620; border-radius: 5px; padding: clamp(4px,.4vh,7px) clamp(8px,.7vw,12px); font-size: clamp(10px,.75vw,12px); color: #9a9086; font-family: 'Inter', sans-serif; outline: none; cursor: pointer; }
  .mi-add-btn { display: flex; align-items: center; gap: 5px; background: #02a4ba; border: none; border-radius: 5px; padding: clamp(5px,.5vh,8px) clamp(10px,.9vw,16px); font-size: clamp(10px,.75vw,13px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: background .2s; }
  .mi-add-btn:hover { background: #01bcd4; }

  /* STATS BAR */
  .mi-sbar { background: #13120f; border-bottom: 1px solid #2a2620; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,20px); display: flex; gap: clamp(16px,2vw,36px); flex-shrink: 0; }
  .mi-sv { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); line-height: 1; }
  .mi-sl { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 2px; text-transform: uppercase; letter-spacing: .5px; }

  /* BODY */
  .mi-body { display: flex; gap: clamp(8px,.8vw,12px); padding: clamp(8px,.8vw,12px); flex: 1; min-height: 0; overflow: hidden; }

  /* CARD GRID */
  .mi-grid-wrap { flex: 1; overflow-y: auto; min-width: 0; }
  .mi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(155px,16vw,225px), 1fr)); gap: clamp(6px,.6vw,10px); }

  /* MENU CARD */
  .mi-card { background: #13120f; border: 1px solid #2a2620; border-radius: 8px; padding: clamp(10px,1vw,16px); cursor: pointer; transition: all .15s; position: relative; border-left: 3px solid transparent; }
  .mi-card:hover { border-color: #3a3630; background: #1a1915; }
  .mi-card.selected { border-color: #02a4ba; background: rgba(2,164,186,.06); border-left-color: #02a4ba; }

  .mi-card-status { position: absolute; top: 10px; right: 10px; font-size: clamp(7px,.58vw,9px); font-weight: 600; padding: 2px 6px; border-radius: 8px; }
  .cs-complete { background: rgba(42,138,90,.1); color: #2a8a5a; }
  .cs-incomplete { background: rgba(192,64,64,.1); color: #c04040; }
  .cs-partial { background: rgba(212,160,32,.1); color: #d4a020; }

  .mi-card-icon { width: clamp(26px,2.4vw,36px); height: clamp(26px,2.4vw,36px); border-radius: 7px; background: rgba(2,164,186,.08); border: 1px solid rgba(2,164,186,.15); display: flex; align-items: center; justify-content: center; margin-bottom: clamp(8px,.8vh,12px); }
  .mi-card-icon svg { width: 55%; height: 55%; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  .mi-card-name { font-size: clamp(11px,.88vw,14px); font-weight: 600; color: #e8e2d8; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 40px; }
  .mi-card-sub { font-size: clamp(8px,.62vw,10px); color: #4a453e; margin-bottom: clamp(8px,.8vh,12px); }

  .mi-card-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(4px,.4vw,6px); margin-bottom: clamp(6px,.6vh,9px); }
  .mi-metric-lbl { font-size: clamp(7px,.58vw,9px); color: #4a453e; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
  .mi-metric-val { font-size: clamp(10px,.8vw,13px); font-weight: 600; color: #e8e2d8; }

  .mi-margin-bar { margin-top: clamp(6px,.6vh,9px); padding-top: clamp(6px,.6vh,9px); border-top: 1px solid #2a2620; }
  .mi-margin-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .mi-margin-lbl { font-size: clamp(7px,.58vw,9px); color: #4a453e; text-transform: uppercase; letter-spacing: .5px; }
  .mi-margin-val { font-size: clamp(10px,.8vw,13px); font-weight: 700; }
  .mi-track { background: #1a1915; border-radius: 3px; height: clamp(3px,.28vh,5px); }
  .mi-fill { height: 100%; border-radius: 3px; transition: width .3s; }

  /* DETAIL PANEL */
  .mi-detail { width: clamp(280px,32vw,440px); background: #13120f; border: 1px solid #2a2620; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
  .mi-detail-hd { padding: clamp(8px,.8vh,13px) clamp(10px,1vw,16px); border-bottom: 1px solid #2a2620; flex-shrink: 0; }
  .mi-detail-hd-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .mi-detail-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: #e8e2d8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%; }
  .mi-close-btn { background: none; border: 1px solid #2a2620; border-radius: 4px; padding: 2px 8px; font-size: clamp(8px,.62vw,10px); color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; white-space: nowrap; }
  .mi-close-btn:hover { color: #e8e2d8; border-color: #3a3630; }

  .mi-view-tabs { display: flex; background: #0f0e0c; border-radius: 5px; padding: 2px; gap: 2px; }
  .mi-vtab { flex: 1; padding: clamp(3px,.3vh,5px); border-radius: 3px; font-size: clamp(8px,.65vw,11px); font-weight: 500; cursor: pointer; border: none; font-family: 'Inter', sans-serif; color: #4a453e; background: transparent; text-align: center; transition: all .15s; }
  .mi-vtab.active { background: #1a1915; color: #e8e2d8; }

  .mi-detail-body { flex: 1; overflow-y: auto; padding: clamp(10px,1vw,14px); display: flex; flex-direction: column; gap: clamp(8px,.8vh,12px); }

  /* DETAIL METRICS */
  .mi-d-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(5px,.5vw,8px); }
  .mi-d-metric { background: #0f0e0c; border: 1px solid #1a1915; border-radius: 6px; padding: clamp(7px,.7vh,11px) clamp(8px,.8vw,12px); text-align: center; }
  .mi-d-metric-lbl { font-size: clamp(7px,.58vw,9px); color: #4a453e; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
  .mi-d-metric-val { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,19px); color: #e8e2d8; line-height: 1; }

  .mi-sect-title { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,9px); display: flex; align-items: center; gap: 5px; }
  .mi-sect-title::after { content: ''; flex: 1; height: 1px; background: #2a2620; }

  /* COMPONENTS */
  .mi-comp { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 6px; overflow: hidden; margin-bottom: 5px; }
  .mi-comp:last-child { margin-bottom: 0; }
  .mi-comp-hd { padding: clamp(6px,.6vh,10px) clamp(8px,.8vw,12px); display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background .15s; }
  .mi-comp-hd:hover { background: #1a1915; }
  .mi-comp-name { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: #e8e2d8; }
  .mi-comp-sub { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 1px; }
  .mi-comp-cost { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: #02a4ba; }
  .mi-comp-pct { font-size: clamp(8px,.6vw,10px); color: #4a453e; margin-top: 1px; text-align: right; }
  .mi-comp-ings { background: #13120f; border-top: 1px solid #2a2620; padding: clamp(5px,.5vh,8px) clamp(8px,.8vw,12px); }
  .mi-comp-ing-row { display: flex; align-items: center; justify-content: space-between; padding: clamp(3px,.3vh,5px) 0; border-bottom: 1px solid #1a1915; }
  .mi-comp-ing-row:last-child { border-bottom: none; }
  .mi-comp-ing-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-right: 6px; }
  .mi-comp-ing-name { font-size: clamp(9px,.68vw,11px); color: #e8e2d8; flex: 1; }
  .mi-comp-ing-qty { font-size: clamp(8px,.62vw,10px); color: #4a453e; margin: 0 8px; }
  .mi-comp-ing-cost { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: #9a9086; }

  /* TOTAL BAR */
  .mi-total-bar { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 6px; padding: clamp(7px,.7vh,11px) clamp(10px,.9vw,14px); display: flex; justify-content: space-between; align-items: center; }
  .mi-total-lbl { font-size: clamp(9px,.68vw,12px); color: #6b6358; font-weight: 500; }
  .mi-total-val { font-family: 'Playfair Display', serif; font-size: clamp(14px,1.2vw,18px); color: #02a4ba; }

  /* PRICING RECS */
  .mi-price-recs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: clamp(4px,.4vw,7px); }
  .mi-price-rec { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 6px; padding: clamp(6px,.6vh,10px); text-align: center; }
  .mi-price-rec-lbl { font-size: clamp(7px,.58vw,9px); color: #4a453e; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 3px; line-height: 1.4; }
  .mi-price-rec-val { font-family: 'Playfair Display', serif; font-size: clamp(12px,1.1vw,16px); color: #e8e2d8; }
  .mi-price-rec-val.highlight { color: #2a8a5a; }

  /* OPTIMIZER */
  .mi-opt-compare { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .mi-opt-card { border-radius: 6px; padding: clamp(8px,.8vw,12px); }
  .mi-opt-orig { background: #0f0e0c; border: 1px solid #2a2620; }
  .mi-opt-new { background: rgba(42,138,90,.05); border: 1px solid rgba(42,138,90,.2); }
  .mi-opt-card-title { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 8px; }
  .mi-opt-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
  .mi-opt-row:last-child { margin-bottom: 0; padding-top: 5px; border-top: 1px solid #2a2620; }
  .mi-opt-label { font-size: clamp(9px,.68vw,11px); color: #6b6358; }
  .mi-opt-val { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: #e8e2d8; }
  .mi-opt-price-input { background: #1a1915; border: 1px solid #2a2620; border-radius: 4px; padding: 2px 6px; font-size: clamp(9px,.68vw,11px); color: #e8e2d8; width: clamp(55px,5.5vw,80px); text-align: right; outline: none; font-family: 'Inter', sans-serif; }
  .mi-opt-price-input:focus { border-color: #02a4ba; }

  /* OPT SLIDERS */
  .mi-opt-comp { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 6px; padding: clamp(8px,.8vw,12px); margin-bottom: 6px; }
  .mi-opt-comp:last-child { margin-bottom: 0; }
  .mi-opt-comp-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .mi-opt-comp-name { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: #e8e2d8; }
  .mi-opt-cost { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: #02a4ba; }
  .mi-opt-slider-wrap { display: flex; align-items: center; gap: 7px; }
  .mi-opt-slider-lbl { font-size: clamp(8px,.6vw,10px); color: #6b6358; flex-shrink: 0; width: clamp(50px,5vw,70px); }
  .mi-opt-pct { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: #02a4ba; width: 35px; text-align: right; flex-shrink: 0; }
  .mi-opt-reset { background: none; border: 1px solid #2a2620; border-radius: 4px; padding: 3px 8px; font-size: clamp(8px,.62vw,10px); color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .mi-opt-reset:hover { color: #e8e2d8; border-color: #3a3630; }

  /* OVERVIEW */
  .mi-ov-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .mi-ov-w { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,13px); }
  .mi-ov-wf { background: #0f0e0c; border: 1px solid #2a2620; border-radius: 7px; padding: clamp(8px,.8vw,13px); }
  .mi-ov-lbl { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: #4a453e; text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 4px; }
  .mi-ov-lbl svg { width: 10px; height: 10px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mi-ov-item { display: flex; align-items: center; justify-content: space-between; padding: clamp(4px,.4vh,7px) 0; border-bottom: 1px solid #1a1915; }
  .mi-ov-item:last-child { border-bottom: none; }
  .mi-ov-name { font-size: clamp(9px,.68vw,11px); color: #e8e2d8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mi-ov-val { font-size: clamp(9px,.68vw,11px); font-weight: 600; flex-shrink: 0; }
  .mi-ov-pill { font-size: clamp(7px,.58vw,9px); padding: 1px 6px; border-radius: 8px; flex-shrink: 0; margin-left: 5px; }

  .mi-hint { font-size: clamp(8px,.62vw,10px); color: #3a3630; text-align: center; padding: clamp(4px,.4vh,7px); border: 1px dashed #2a2620; border-radius: 6px; }
  .mi-back-btn { background: none; border: 1px solid #2a2620; border-radius: 5px; padding: clamp(4px,.4vh,7px) clamp(8px,.7vw,12px); font-size: clamp(9px,.68vw,11px); color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; align-self: flex-start; transition: all .15s; }
  .mi-back-btn:hover { border-color: #3a3630; color: #9a9086; }
`;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientMenuItems() {
  const router = useRouter();

  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemData, setSelectedItemData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewMode, setViewMode] = useState('overview'); // 'overview' | 'details' | 'optimize'
  const [expandedComponents, setExpandedComponents] = useState(new Set());
  const [multipliers, setMultipliers] = useState({});
  const [optimizedPrice, setOptimizedPrice] = useState(null);

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items'];

  useEffect(() => { init(); }, []);
  useEffect(() => { if (restaurantId) fetchMenuItems(); }, [restaurantId]);
  useEffect(() => { if (selectedItem && restaurantId) fetchItemDetail(selectedItem); }, [selectedItem, restaurantId]);
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) return;
    setRestaurantId(profile.restaurant_id);
    setUserName(profile.full_name ? profile.full_name.split(' ')[0] : 'User');
  }

  async function fetchMenuItems() {
    setLoading(true);
    const { data } = await supabase.from('menu_items').select(`
      *,
      menu_item_ingredients(quantity, ingredients(id, name, unit, last_price)),
      menu_item_components(id, name, cost, component_ingredients(id, quantity, unit, ingredients:ingredient_id(id, name, last_price, unit, last_ordered_at)))
    `).eq('restaurant_id', restaurantId).order('name');
    setMenuItems(data || []);
    setLoading(false);
  }

  async function fetchItemDetail(itemId) {
    setDetailLoading(true);
    const [{ data: item }, { data: ings }, { data: comps }, { data: history }] = await Promise.all([
      supabase.from('menu_items').select('*').eq('id', itemId).single(),
      supabase.from('menu_item_ingredients').select('quantity, ingredients(id, name, unit, last_price, last_ordered_at)').eq('menu_item_id', itemId),
      supabase.from('menu_item_components').select('id, name, cost, component_ingredients(id, quantity, unit, ingredients:ingredient_id(id, name, last_price, unit, last_ordered_at))').eq('menu_item_id', itemId).order('name'),
      supabase.from('menu_item_cost_history').select('*').eq('menu_item_id', itemId).order('created_at', { ascending: false }).limit(10),
    ]);

    const processedComps = (comps || []).map(c => {
      const processedIngs = (c.component_ingredients || []).map(ci => {
        const ing = ci.ingredients;
        const unitCost = ing?.last_price || 0;
        let totalCost = 0;
        if (unitCost > 0) {
          try { totalCost = typeof calculateStandardizedCost === 'function' ? calculateStandardizedCost(ci.quantity, ci.unit, unitCost, ing?.name) : ci.quantity * unitCost; }
          catch { totalCost = ci.quantity * unitCost; }
        }
        return { id: ci.id, ingredientId: ing?.id, name: ing?.name || 'Unknown', quantity: ci.quantity, unit: ci.unit, unitCost, standardUnit: ing?.unit || 'unit', totalCost, hasPrice: unitCost > 0 };
      });
      return { id: c.id, name: c.name, storedCost: c.cost || 0, calculatedCost: processedIngs.reduce((s, i) => s + i.totalCost, 0), ingredients: processedIngs, ingredientCount: processedIngs.length };
    });

    setSelectedItemData({ item, ingredients: ings || [], components: processedComps, costHistory: history || [] });
    setOptimizedPrice(null);
    setMultipliers({});
    setExpandedComponents(new Set());
    setDetailLoading(false);
  }

  function selectItem(id) {
    setSelectedItem(id);
    setViewMode('details');
  }

  function handleSortChange(e) {
    const [field, dir] = e.target.value.split('-');
    setSortBy(field); setSortOrder(dir);
  }

  const filtered = menuItems
    .filter(i => (i.name || '').toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
        case 'price': va = parseFloat(a.price || 0); vb = parseFloat(b.price || 0); break;
        case 'cost': va = parseFloat(a.cost || 0); vb = parseFloat(b.cost || 0); break;
        case 'margin':
          va = getMarginNum(a.price, a.cost) || 0;
          vb = getMarginNum(b.price, b.cost) || 0;
          break;
        default: return 0;
      }
      if (va < vb) return sortOrder === 'asc' ? -1 : 1;
      if (va > vb) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  // ── Overview stats ──
  const itemsWithMargins = menuItems.filter(i => getMarginNum(i.price, i.cost) !== null);
  const avgMargin = itemsWithMargins.length > 0 ? itemsWithMargins.reduce((s, i) => s + getMarginNum(i.price, i.cost), 0) / itemsWithMargins.length : 0;
  const belowTarget = itemsWithMargins.filter(i => getMarginNum(i.price, i.cost) < 40).length;
  const incomplete = menuItems.filter(i => hasIncompleteCosting(i)).length;
  const avgPrice = menuItems.filter(i => i.price).length > 0 ? menuItems.filter(i => i.price).reduce((s, i) => s + parseFloat(i.price), 0) / menuItems.filter(i => i.price).length : 0;

  const topMargin = [...itemsWithMargins].sort((a, b) => getMarginNum(b.price, b.cost) - getMarginNum(a.price, a.cost)).slice(0, 4);
  const lowMargin = itemsWithMargins.filter(i => getMarginNum(i.price, i.cost) < 40).slice(0, 3);
  const noData = menuItems.filter(i => !i.price || !i.cost).slice(0, 2);

  // Margin distribution buckets
  const bucket = (lo, hi) => itemsWithMargins.filter(i => { const m = getMarginNum(i.price, i.cost); return m >= lo && m < hi; }).length;
  const maxBucket = Math.max(bucket(0, 40), bucket(40, 60), bucket(60, 75), bucket(75, 100), 1);

  // ── Detail calculations ──
  const totalCost = selectedItemData ? (selectedItemData.components.length > 0
    ? selectedItemData.components.reduce((s, c) => s + c.calculatedCost, 0)
    : (selectedItemData.ingredients || []).reduce((s, i) => s + (parseFloat(i.ingredients?.last_price || 0) * parseFloat(i.quantity || 0)), 0)) : 0;

  const profitMargin = selectedItemData ? getMarginNum(selectedItemData.item?.price, totalCost) : null;

  // ── Optimizer ──
  function getMultiplier(id) { return multipliers[id] ?? 1.0; }
  function setMultiplier(id, val) { setMultipliers(prev => ({ ...prev, [id]: Math.max(0, Math.min(2, val)) })); }

  const optimizedCost = selectedItemData ? (selectedItemData.components.length > 0
    ? selectedItemData.components.reduce((s, c) => s + c.calculatedCost * getMultiplier(c.id), 0)
    : totalCost * getMultiplier('all')) : 0;

  const effectivePrice = parseFloat(optimizedPrice ?? selectedItemData?.item?.price ?? 0);
  const optimizedMargin = effectivePrice > 0 ? ((effectivePrice - optimizedCost) / effectivePrice) * 100 : null;

  function toggleComp(id) {
    setExpandedComponents(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }



// ── PASTE THIS BLOCK INTO menu-items.js IMMEDIATELY BEFORE the desktop return ──
// Find: return ( <> <style>{CSS}</style> <div className="mi-root">
// Paste this entire block above it.

  if (isMobile) {
    const navItems = [
      { label: 'Dashboard', path: '/client/dashboard', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
      { label: 'Invoices', path: '/client/invoices', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
      { label: 'Ingredients', path: '/client/ingredients', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
      { label: 'Menu', path: '/client/menu-items', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
    ];

    return (
      <>
        <style>{CSS}</style>
        <div className="mob-root" style={{ position: 'relative' }}>

          {/* Header */}
          <div className="mob-header">
            <div className="mob-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="mob-add-btn">+ Add Item</button>
              <div className="mob-avatar">{getUserInitials(userName)}</div>
            </div>
          </div>

          {/* Title bar */}
          <div className="mob-titlebar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="mob-page-title">Menu Engineering</div>
              <div className="mob-page-sub">Optimize pricing and profitability</div>
            </div>
            <select
              style={{ background: '#1a1915', border: '1px solid #2a2620', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#9a9086', fontFamily: "'Inter', sans-serif", outline: 'none' }}
              value={`${sortBy}-${sortOrder}`}
              onChange={e => { const [f, d] = e.target.value.split('-'); setSortBy(f); setSortOrder(d); }}>
              <option value="name-asc">Name A–Z</option>
              <option value="margin-desc">Margin ↓</option>
              <option value="price-desc">Price ↓</option>
              <option value="cost-desc">Cost ↓</option>
            </select>
          </div>

          {/* Stats */}
          <div className="mob-stats">
            {[
              { v: menuItems.length, l: 'Items', c: '#02a4ba' },
              { v: `${avgMargin.toFixed(1)}%`, l: 'Avg Margin', c: avgMargin >= 60 ? '#2a8a5a' : avgMargin >= 40 ? '#02a4ba' : '#d4a020' },
              { v: belowTarget, l: 'Below Target', c: '#c04040' },
              { v: incomplete, l: 'Incomplete', c: '#d4a020' },
              { v: avgPrice > 0 ? formatCurrency(avgPrice) : '—', l: 'Avg Price', c: '#e8e2d8' },
            ].map(({ v, l, c }) => (
              <div key={l} className="mob-stat">
                <div className="mob-stat-v" style={{ color: c }}>{v}</div>
                <div className="mob-stat-l">{l}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="mob-search-bar">
            <input className="mob-search-input" placeholder="Search menu items..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>

          {/* Card grid */}
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: '#4a453e' }}>Loading menu items...</div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'start', WebkitOverflowScrolling: 'touch' }}>
              {filtered.length === 0 ? (
                <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40, gap: 8 }}>
                  <div style={{ fontSize: 13, color: '#6b6358', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No menu items yet'}</div>
                </div>
              ) : filtered.map(item => {
                const margin = getMarginNum(item.price, item.cost);
                const mc = getMarginColor(margin);
                const { label, cls } = getStatus(item);
                const ingCount = getIngredientCount(item);
                return (
                  <div key={item.id}
                    style={{ background: '#13120f', border: `1px solid ${selectedItem === item.id ? '#02a4ba' : '#2a2620'}`, borderRadius: 10, padding: 12, cursor: 'pointer', position: 'relative', borderLeft: selectedItem === item.id ? '3px solid #02a4ba' : '1px solid #2a2620' }}
                    onClick={() => selectItem(item.id)}>
                    <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 7,
                      background: cls === 'cs-complete' ? 'rgba(42,138,90,.1)' : cls === 'cs-incomplete' ? 'rgba(192,64,64,.1)' : 'rgba(212,160,32,.1)',
                      color: cls === 'cs-complete' ? '#2a8a5a' : cls === 'cs-incomplete' ? '#c04040' : '#d4a020' }}>
                      {label}
                    </span>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(2,164,186,.08)', border: '1px solid rgba(2,164,186,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#02a4ba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/>
                      </svg>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e2d8', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 32 }}>{item.name}</div>
                    <div style={{ fontSize: 10, color: '#4a453e', marginBottom: 8 }}>{ingCount} ingredient{ingCount !== 1 ? 's' : ''}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div><div style={{ fontSize: 9, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.4px' }}>Price</div><div style={{ fontSize: 12, fontWeight: 600, color: '#e8e2d8' }}>{item.price ? formatCurrency(item.price) : '—'}</div></div>
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 9, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.4px' }}>Cost</div><div style={{ fontSize: 12, fontWeight: 600, color: '#e8e2d8' }}>{item.cost ? formatCurrency(item.cost) : '—'}</div></div>
                    </div>
                    <div style={{ borderTop: '1px solid #2a2620', paddingTop: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontSize: 9, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.4px' }}>Margin</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: mc }}>{margin !== null ? `${margin.toFixed(1)}%` : '—'}</div>
                      </div>
                      <div style={{ background: '#1a1915', borderRadius: 3, height: 4 }}>
                        <div style={{ height: 4, borderRadius: 3, background: mc, width: `${Math.max(0, Math.min(100, margin || 0))}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Detail overlay */}
          {selectedItem && selectedItemData && (
            <div className="mob-detail-overlay">
              <div className="mob-detail-hd">
                <button className="mob-back-btn" onClick={() => { setSelectedItem(null); setSelectedItemData(null); setViewMode('overview'); }}>← Back</button>
                <div className="mob-detail-title">{selectedItemData.item?.name}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['details', 'optimize'].map(v => (
                    <button key={v} onClick={() => setViewMode(v)}
                      style={{ background: viewMode === v ? '#1a1915' : 'none', border: '1px solid #2a2620', borderRadius: 5, padding: '4px 8px', fontSize: 11, color: viewMode === v ? '#e8e2d8' : '#4a453e', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mob-detail-body">
                {detailLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4a453e', fontSize: 12 }}>
                    <div style={{ width: 16, height: 16, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    Loading details...
                  </div>
                ) : viewMode === 'details' ? (
                  <>
                    {/* Metrics */}
                    <div className="mob-dfield-grid">
                      <div className="mob-dfield"><div className="mob-dfield-lbl">Menu Price</div><div className="mob-dfield-val accent">{selectedItemData.item?.price ? formatCurrency(selectedItemData.item.price) : '—'}</div></div>
                      <div className="mob-dfield"><div className="mob-dfield-lbl">Total Cost</div><div className="mob-dfield-val">{formatCurrency(totalCost)}</div></div>
                      <div className="mob-dfield"><div className="mob-dfield-lbl">Profit Margin</div><div className="mob-dfield-val" style={{ color: getMarginColor(profitMargin) }}>{profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—'}</div></div>
                      <div className="mob-dfield"><div className="mob-dfield-lbl">Ingredients</div><div className="mob-dfield-val">{selectedItem ? getIngredientCount(menuItems.find(i => i.id === selectedItem) || {}) : 0}</div></div>
                    </div>

                    {/* Components */}
                    {selectedItemData.components.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.7px' }}>Component Breakdown</div>
                        {selectedItemData.components.map(c => (
                          <div key={c.id} style={{ background: '#13120f', border: '1px solid #2a2620', borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                              onClick={() => toggleComp(c.id)}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e2d8' }}>{c.name}</div>
                                <div style={{ fontSize: 10, color: '#4a453e', marginTop: 2 }}>{c.ingredientCount} ingredients</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#02a4ba' }}>{formatCurrency(c.calculatedCost)}</div>
                                <div style={{ fontSize: 10, color: '#4a453e', marginTop: 2 }}>{totalCost > 0 ? ((c.calculatedCost / totalCost) * 100).toFixed(0) : 0}% of total</div>
                              </div>
                            </div>
                            {expandedComponents.has(c.id) && (
                              <div style={{ borderTop: '1px solid #2a2620', padding: '8px 12px', background: '#0f0e0c' }}>
                                {c.ingredients.map(ing => (
                                  <div key={ing.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #1a1915' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: ing.hasPrice ? '#2a8a5a' : '#c04040', flexShrink: 0 }} />
                                      <div>
                                        <div style={{ fontSize: 12, color: '#e8e2d8' }}>{ing.name}</div>
                                        <div style={{ fontSize: 10, color: '#4a453e' }}>{ing.quantity} {ing.unit}</div>
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: '#9a9086' }}>{formatCurrency(ing.totalCost)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="mob-total-bar">
                          <div style={{ fontSize: 13, color: '#6b6358', fontWeight: 500 }}>Total Food Cost</div>
                          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: '#02a4ba' }}>{formatCurrency(totalCost)}</div>
                        </div>
                      </>
                    )}

                    {/* Pricing recs */}
                    {totalCost > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.7px' }}>Pricing Recommendations</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                          {[
                            { l: 'Break-even\n30% cost', v: formatCurrency(totalCost / 0.30), c: '#e8e2d8' },
                            { l: 'Recommended\n25% cost', v: formatCurrency(totalCost / 0.25), c: '#2a8a5a' },
                            { l: 'Premium\n20% cost', v: formatCurrency(totalCost / 0.20), c: '#e8e2d8' },
                          ].map(({ l, v, c }) => (
                            <div key={l} style={{ background: '#13120f', border: '1px solid #2a2620', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                              <div style={{ fontSize: 9, color: '#4a453e', marginBottom: 6, lineHeight: 1.4, whiteSpace: 'pre-line' }}>{l}</div>
                              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: c }}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  /* Optimize view */
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ background: '#0f0e0c', border: '1px solid #2a2620', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>Original</div>
                        {[['Cost', formatCurrency(totalCost)], ['Price', formatCurrency(selectedItemData.item?.price)], ['Margin', profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—']].map(([l, v]) => (
                          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                            <span style={{ color: '#6b6358' }}>{l}</span>
                            <span style={{ color: '#e8e2d8', fontWeight: 500 }}>{v}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ background: 'rgba(42,138,90,.05)', border: '1px solid rgba(42,138,90,.2)', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>Optimized</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}><span style={{ color: '#6b6358' }}>Cost</span><span style={{ color: '#e8e2d8', fontWeight: 500 }}>{formatCurrency(optimizedCost)}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, alignItems: 'center' }}>
                          <span style={{ color: '#6b6358' }}>Price</span>
                          <input type="number" step="0.01" min="0" value={optimizedPrice ?? selectedItemData.item?.price ?? ''} onChange={e => setOptimizedPrice(parseFloat(e.target.value) || null)}
                            style={{ background: '#1a1915', border: '1px solid #2a2620', borderRadius: 4, padding: '2px 6px', fontSize: 12, color: '#e8e2d8', width: 70, textAlign: 'right', outline: 'none', fontFamily: "'Inter', sans-serif" }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, paddingTop: 6, borderTop: '1px solid #2a2620' }}><span style={{ color: '#6b6358' }}>Margin</span><span style={{ color: getMarginColor(optimizedMargin), fontWeight: 600 }}>{optimizedMargin !== null ? `${optimizedMargin.toFixed(1)}%` : '—'}</span></div>
                      </div>
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 600, color: '#4a453e', textTransform: 'uppercase', letterSpacing: '.7px' }}>Adjust Portions</div>
                    {selectedItemData.components.length > 0 ? selectedItemData.components.map(c => {
                      const m = getMultiplier(c.id);
                      return (
                        <div key={c.id} style={{ background: '#13120f', border: '1px solid #2a2620', borderRadius: 8, padding: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div><div style={{ fontSize: 13, fontWeight: 600, color: '#e8e2d8' }}>{c.name}</div><div style={{ fontSize: 10, color: '#4a453e' }}>{c.ingredientCount} ingredients</div></div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#02a4ba' }}>{formatCurrency(c.calculatedCost * m)}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: '#6b6358', flexShrink: 0 }}>Portion</span>
                            <input type="range" min="0" max="2" step="0.01" value={m} onChange={e => setMultiplier(c.id, parseFloat(e.target.value))}
                              style={{ flex: 1, background: `linear-gradient(to right,#02a4ba 0%,#02a4ba ${m * 50}%,#1a1915 ${m * 50}%,#1a1915 100%)` }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#02a4ba', width: 40, textAlign: 'right', flexShrink: 0 }}>{Math.round(m * 100)}%</span>
                          </div>
                        </div>
                      );
                    }) : (
                      <div style={{ fontSize: 12, color: '#4a453e', textAlign: 'center', padding: '16px 0' }}>No components to adjust</div>
                    )}
                    <button onClick={() => { setMultipliers({}); setOptimizedPrice(null); }}
                      style={{ background: 'none', border: '1px solid #2a2620', borderRadius: 7, padding: '8px 16px', fontSize: 12, color: '#4a453e', cursor: 'pointer', fontFamily: "'Inter', sans-serif", alignSelf: 'flex-start' }}>
                      Reset
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Bottom nav */}
          <div className="mob-bottom-nav">
            {navItems.map(({ label, path, icon }) => {
              const active = path === '/client/menu-items';
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
      </>
    );
  }

  // ── END MOBILE — desktop return follows ──

  return (
    <>
      <style>{CSS}</style>
      <div className="mi-root">

        {/* NAV */}
        <div className="mi-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div className="mi-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t} className={`mi-tab${t === 'Menu Items' ? ' active' : ''}`}
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
            <input className="mi-search-sm" placeholder="Search..." />
            <div className="mi-avatar">{getUserInitials(userName)}</div>
          </div>
        </div>

        {/* PAGE HEADER */}
        <div className="mi-ph">
          <div>
            <div className="mi-ph-title">Menu Engineering</div>
            <div className="mi-ph-sub">Optimize pricing and profitability</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="mi-search-lg" placeholder="Search menu items..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <select className="mi-sort" value={`${sortBy}-${sortOrder}`} onChange={handleSortChange}>
              <option value="name-asc">Name (A–Z)</option>
              <option value="name-desc">Name (Z–A)</option>
              <option value="margin-desc">Margin (High–Low)</option>
              <option value="margin-asc">Margin (Low–High)</option>
              <option value="price-desc">Price (High–Low)</option>
              <option value="cost-desc">Cost (High–Low)</option>
            </select>
            <button className="mi-add-btn">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Item
            </button>
          </div>
        </div>

        {/* STATS BAR */}
        <div className="mi-sbar">
          {[
            { v: menuItems.length, l: 'Menu Items', c: '#02a4ba' },
            { v: `${avgMargin.toFixed(1)}%`, l: 'Avg Margin', c: avgMargin >= 60 ? '#2a8a5a' : avgMargin >= 40 ? '#02a4ba' : '#d4a020' },
            { v: belowTarget, l: 'Below Target', c: '#c04040' },
            { v: incomplete, l: 'Incomplete Cost', c: '#d4a020' },
            { v: avgPrice > 0 ? formatCurrency(avgPrice) : '--', l: 'Avg Price', c: '#e8e2d8' },
          ].map(({ v, l, c }) => (
            <div key={l}>
              <div className="mi-sv" style={{ color: c }}>{v}</div>
              <div className="mi-sl">{l}</div>
            </div>
          ))}
        </div>

        {/* BODY */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 22, height: 22, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 'clamp(10px,0.8vw,13px)', color: '#4a453e' }}>Loading menu items...</div>
          </div>
        ) : (
        <div className="mi-body">

          {/* CARD GRID */}
          <div className="mi-grid-wrap">
            <div className="mi-grid">
              {filtered.length === 0 ? (
                <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#e8e2d8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .2 }}>
                    <path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/>
                    <line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/>
                  </svg>
                  <div style={{ fontSize: 'clamp(11px,0.85vw,14px)', color: '#6b6358', fontWeight: 500 }}>
                    {searchTerm ? `No results for "${searchTerm}"` : 'No menu items yet'}
                  </div>
                </div>
              ) : filtered.map(item => {
                const margin = getMarginNum(item.price, item.cost);
                const mc = getMarginColor(margin);
                const { label, cls } = getStatus(item);
                const ingCount = getIngredientCount(item);
                const isSelected = selectedItem === item.id;
                return (
                  <div key={item.id} className={`mi-card${isSelected ? ' selected' : ''}`} onClick={() => selectItem(item.id)}>
                    <span className={`mi-card-status ${cls}`}>{label}</span>
                    <div className="mi-card-icon">
                      <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
                    </div>
                    <div className="mi-card-name">{item.name || 'Unnamed'}</div>
                    <div className="mi-card-sub">{ingCount} ingredient{ingCount !== 1 ? 's' : ''}</div>
                    <div className="mi-card-metrics">
                      <div>
                        <div className="mi-metric-lbl">Price</div>
                        <div className="mi-metric-val">{item.price ? formatCurrency(item.price) : <span style={{ color: '#4a453e' }}>—</span>}</div>
                      </div>
                      <div>
                        <div className="mi-metric-lbl">Cost</div>
                        <div className="mi-metric-val">{item.cost ? formatCurrency(item.cost) : <span style={{ color: '#4a453e' }}>—</span>}</div>
                      </div>
                    </div>
                    <div className="mi-margin-bar">
                      <div className="mi-margin-hd">
                        <span className="mi-margin-lbl">Margin</span>
                        <span className="mi-margin-val" style={{ color: mc }}>{margin !== null ? `${margin.toFixed(1)}%` : '—'}</span>
                      </div>
                      <div className="mi-track">
                        <div className="mi-fill" style={{ width: `${Math.max(0, Math.min(100, margin || 0))}%`, background: mc }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DETAIL PANEL */}
          <div className="mi-detail">
            <div className="mi-detail-hd">
              <div className="mi-detail-hd-top">
                <div className="mi-detail-title">
                  {selectedItem && selectedItemData ? selectedItemData.item?.name : 'Menu Overview'}
                </div>
                {selectedItem && (
                  <button className="mi-close-btn" onClick={() => { setSelectedItem(null); setSelectedItemData(null); setViewMode('overview'); }}>✕ Close</button>
                )}
              </div>
              <div className="mi-view-tabs">
                {selectedItem ? (
                  <>
                    <button className={`mi-vtab${viewMode === 'details' ? ' active' : ''}`} onClick={() => setViewMode('details')}>Details</button>
                    <button className={`mi-vtab${viewMode === 'optimize' ? ' active' : ''}`} onClick={() => setViewMode('optimize')}>Optimize</button>
                  </>
                ) : (
                  <button className="mi-vtab active" style={{ cursor: 'default' }}>Overview</button>
                )}
              </div>
            </div>

            {/* OVERVIEW STATE */}
            {!selectedItem && (
              <div className="mi-detail-body">
                <div className="mi-ov-row">
                  <div className="mi-ov-w">
                    <div className="mi-ov-lbl">
                      <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      Top Margin Items
                    </div>
                    {topMargin.length > 0 ? topMargin.map(i => {
                      const m = getMarginNum(i.price, i.cost);
                      return (
                        <div key={i.id} className="mi-ov-item" style={{ cursor: 'pointer' }} onClick={() => selectItem(i.id)}>
                          <span className="mi-ov-name">{i.name}</span>
                          <span className="mi-ov-val" style={{ color: getMarginColor(m) }}>{m?.toFixed(1)}%</span>
                        </div>
                      );
                    }) : <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#4a453e' }}>No data yet</div>}
                  </div>

                  <div className="mi-ov-w">
                    <div className="mi-ov-lbl">
                      <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      Needs Attention
                    </div>
                    {lowMargin.map(i => {
                      const m = getMarginNum(i.price, i.cost);
                      return (
                        <div key={i.id} className="mi-ov-item" style={{ cursor: 'pointer' }} onClick={() => selectItem(i.id)}>
                          <span className="mi-ov-name">{i.name}</span>
                          <span className="mi-ov-pill" style={{ background: 'rgba(192,64,64,.1)', color: '#c04040' }}>{m?.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                    {noData.map(i => (
                      <div key={i.id} className="mi-ov-item" style={{ cursor: 'pointer' }} onClick={() => selectItem(i.id)}>
                        <span className="mi-ov-name">{i.name}</span>
                        <span className="mi-ov-pill" style={{ background: 'rgba(212,160,32,.1)', color: '#d4a020' }}>No cost</span>
                      </div>
                    ))}
                    {lowMargin.length === 0 && noData.length === 0 && (
                      <div style={{ fontSize: 'clamp(9px,0.68vw,11px)', color: '#2a8a5a' }}>All items on target ✓</div>
                    )}
                  </div>
                </div>

                {/* Margin distribution */}
                <div className="mi-ov-wf">
                  <div className="mi-ov-lbl">
                    <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    Margin Distribution
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 'clamp(50px,7vh,80px)' }}>
                    {[
                      { lo: 0, hi: 40, label: '<40%', c: '#c04040' },
                      { lo: 40, hi: 60, label: '40–60%', c: '#d4a020' },
                      { lo: 60, hi: 75, label: '60–75%', c: '#02a4ba' },
                      { lo: 75, hi: 101, label: '>75%', c: '#2a8a5a' },
                    ].map(({ lo, hi, label, c }) => {
                      const count = bucket(lo, hi);
                      return (
                        <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%' }}>
                          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                            <div style={{ width: '100%', height: `${Math.max(5, (count / maxBucket) * 100)}%`, background: c, opacity: .7, borderRadius: '2px 2px 0 0' }} />
                          </div>
                          <div style={{ fontSize: 'clamp(7px,0.58vw,9px)', color: '#4a453e', textAlign: 'center' }}>{label}</div>
                          <div style={{ fontSize: 'clamp(8px,0.62vw,10px)', color: c, fontWeight: 600 }}>{count}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mi-hint">Click any menu item card to view details and optimize the recipe →</div>
              </div>
            )}

            {/* DETAIL / OPTIMIZE STATE */}
            {selectedItem && (
              <div className="mi-detail-body">
                {detailLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4a453e', fontSize: 'clamp(10px,0.75vw,12px)' }}>
                    <div style={{ width: 16, height: 16, border: '2px solid #2a2620', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    Loading details...
                  </div>
                ) : selectedItemData && viewMode === 'details' ? (
                  <>
                    {/* Metrics */}
                    <div className="mi-d-metrics">
                      <div className="mi-d-metric">
                        <div className="mi-d-metric-lbl">Menu Price</div>
                        <div className="mi-d-metric-val" style={{ color: '#02a4ba' }}>{selectedItemData.item?.price ? formatCurrency(selectedItemData.item.price) : '—'}</div>
                      </div>
                      <div className="mi-d-metric">
                        <div className="mi-d-metric-lbl">Total Cost</div>
                        <div className="mi-d-metric-val">{formatCurrency(totalCost)}</div>
                      </div>
                      <div className="mi-d-metric">
                        <div className="mi-d-metric-lbl">Profit Margin</div>
                        <div className="mi-d-metric-val" style={{ color: getMarginColor(profitMargin) }}>{profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—'}</div>
                      </div>
                      <div className="mi-d-metric">
                        <div className="mi-d-metric-lbl">Ingredients</div>
                        <div className="mi-d-metric-val">{selectedItem ? getIngredientCount(menuItems.find(i => i.id === selectedItem) || {}) : 0}</div>
                      </div>
                    </div>

                    {/* Components */}
                    {selectedItemData.components.length > 0 && (
                      <div>
                        <div className="mi-sect-title">Component Breakdown</div>
                        {selectedItemData.components.map(c => (
                          <div key={c.id} className="mi-comp">
                            <div className="mi-comp-hd" onClick={() => toggleComp(c.id)}>
                              <div>
                                <div className="mi-comp-name">{c.name}</div>
                                <div className="mi-comp-sub">{c.ingredientCount} ingredient{c.ingredientCount !== 1 ? 's' : ''}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div className="mi-comp-cost">{formatCurrency(c.calculatedCost)}</div>
                                <div className="mi-comp-pct">{totalCost > 0 ? ((c.calculatedCost / totalCost) * 100).toFixed(0) : 0}% of total</div>
                              </div>
                            </div>
                            {expandedComponents.has(c.id) && (
                              <div className="mi-comp-ings">
                                {c.ingredients.map(ing => (
                                  <div key={ing.id} className="mi-comp-ing-row">
                                    <div className="mi-comp-ing-dot" style={{ background: ing.hasPrice ? '#2a8a5a' : '#c04040' }} />
                                    <div className="mi-comp-ing-name">{ing.name}</div>
                                    <div className="mi-comp-ing-qty">{ing.quantity} {ing.unit}</div>
                                    <div className="mi-comp-ing-cost">{formatCurrency(ing.totalCost)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="mi-total-bar">
                          <div className="mi-total-lbl">Total Food Cost</div>
                          <div className="mi-total-val">{formatCurrency(totalCost)}</div>
                        </div>
                      </div>
                    )}

                    {/* Pricing recs */}
                    {totalCost > 0 && (
                      <div>
                        <div className="mi-sect-title">Pricing Recommendations</div>
                        <div className="mi-price-recs">
                          <div className="mi-price-rec">
                            <div className="mi-price-rec-lbl">Break-even<br />30% cost</div>
                            <div className="mi-price-rec-val">{formatCurrency(totalCost / 0.30)}</div>
                          </div>
                          <div className="mi-price-rec">
                            <div className="mi-price-rec-lbl">Recommended<br />25% cost</div>
                            <div className="mi-price-rec-val highlight">{formatCurrency(totalCost / 0.25)}</div>
                          </div>
                          <div className="mi-price-rec">
                            <div className="mi-price-rec-lbl">Premium<br />20% cost</div>
                            <div className="mi-price-rec-val">{formatCurrency(totalCost / 0.20)}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Cost history */}
                    {selectedItemData.costHistory.length > 0 && (
                      <div>
                        <div className="mi-sect-title">Cost Change History</div>
                        {selectedItemData.costHistory.slice(0, 5).map(r => {
                          const change = parseFloat(r.new_cost || 0) - parseFloat(r.old_cost || 0);
                          return (
                            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, padding: 'clamp(5px,0.5vh,8px) 0', borderBottom: '1px solid #1a1915' }}>
                              <div style={{ fontSize: 'clamp(9px,0.65vw,11px)', color: '#4a453e' }}>{formatDate(r.created_at)}</div>
                              <div style={{ fontSize: 'clamp(9px,0.65vw,11px)', color: '#9a9086' }}>{formatCurrency(r.old_cost)}</div>
                              <div style={{ fontSize: 'clamp(9px,0.65vw,11px)', color: '#e8e2d8' }}>{formatCurrency(r.new_cost)}</div>
                              <div style={{ fontSize: 'clamp(9px,0.65vw,11px)', fontWeight: 600, color: change > 0 ? '#c04040' : '#2a8a5a' }}>{change > 0 ? '+' : ''}{formatCurrency(change)}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : selectedItemData && viewMode === 'optimize' ? (
                  <>
                    {/* Compare cards */}
                    <div className="mi-opt-compare">
                      <div className="mi-opt-card mi-opt-orig">
                        <div className="mi-opt-card-title">Original</div>
                        <div className="mi-opt-row"><span className="mi-opt-label">Cost</span><span className="mi-opt-val">{formatCurrency(totalCost)}</span></div>
                        <div className="mi-opt-row"><span className="mi-opt-label">Price</span><span className="mi-opt-val">{formatCurrency(selectedItemData.item?.price)}</span></div>
                        <div className="mi-opt-row"><span className="mi-opt-label">Margin</span><span className="mi-opt-val" style={{ color: getMarginColor(profitMargin) }}>{profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—'}</span></div>
                      </div>
                      <div className="mi-opt-card mi-opt-new">
                        <div className="mi-opt-card-title">Optimized</div>
                        <div className="mi-opt-row"><span className="mi-opt-label">Cost</span><span className="mi-opt-val">{formatCurrency(optimizedCost)}</span></div>
                        <div className="mi-opt-row">
                          <span className="mi-opt-label">Price</span>
                          <input className="mi-opt-price-input" type="number" step="0.01" min="0"
                            value={optimizedPrice ?? selectedItemData.item?.price ?? ''}
                            onChange={e => setOptimizedPrice(parseFloat(e.target.value) || null)} />
                        </div>
                        <div className="mi-opt-row"><span className="mi-opt-label">Margin</span><span className="mi-opt-val" style={{ color: getMarginColor(optimizedMargin) }}>{optimizedMargin !== null ? `${optimizedMargin.toFixed(1)}%` : '—'}</span></div>
                      </div>
                    </div>

                    {/* Sliders */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'clamp(6px,0.6vh,9px)' }}>
                        <div className="mi-sect-title" style={{ marginBottom: 0, flex: 1 }}>Adjust Component Portions</div>
                        <button className="mi-opt-reset" onClick={() => { setMultipliers({}); setOptimizedPrice(null); }}>Reset</button>
                      </div>

                      {selectedItemData.components.length > 0 ? selectedItemData.components.map(c => {
                        const m = getMultiplier(c.id);
                        const newCost = c.calculatedCost * m;
                        return (
                          <div key={c.id} className="mi-opt-comp">
                            <div className="mi-opt-comp-hd">
                              <div>
                                <div className="mi-opt-comp-name">{c.name}</div>
                                <div style={{ fontSize: 'clamp(8px,0.6vw,10px)', color: '#4a453e' }}>{c.ingredientCount} ingredients</div>
                              </div>
                              <div className="mi-opt-cost">{formatCurrency(newCost)}</div>
                            </div>
                            <div className="mi-opt-slider-wrap">
                              <div className="mi-opt-slider-lbl">Portion Size</div>
                              <input type="range" style={{ flex: 1, background: `linear-gradient(to right,#02a4ba 0%,#02a4ba ${m * 50}%,#1a1915 ${m * 50}%,#1a1915 100%)` }}
                                min="0" max="2" step="0.01" value={m}
                                onChange={e => setMultiplier(c.id, parseFloat(e.target.value))} />
                              <div className="mi-opt-pct">{Math.round(m * 100)}%</div>
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="mi-opt-comp">
                          <div className="mi-opt-comp-hd">
                            <div><div className="mi-opt-comp-name">Recipe Portion</div><div style={{ fontSize: 'clamp(8px,0.6vw,10px)', color: '#4a453e' }}>{selectedItemData.ingredients.length} ingredients</div></div>
                            <div className="mi-opt-cost">{formatCurrency(totalCost * getMultiplier('all'))}</div>
                          </div>
                          <div className="mi-opt-slider-wrap">
                            <div className="mi-opt-slider-lbl">Portion Size</div>
                            <input type="range" style={{ flex: 1, background: `linear-gradient(to right,#02a4ba 0%,#02a4ba ${getMultiplier('all') * 50}%,#1a1915 ${getMultiplier('all') * 50}%,#1a1915 100%)` }}
                              min="0" max="2" step="0.01" value={getMultiplier('all')}
                              onChange={e => setMultiplier('all', parseFloat(e.target.value))} />
                            <div className="mi-opt-pct">{Math.round(getMultiplier('all') * 100)}%</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </>
  );
}