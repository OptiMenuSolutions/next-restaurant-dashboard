// pages/client/menu-items.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import supabase from '../../lib/supabaseClient';
import { calculateStandardizedCost } from '../../lib/standardizedUnits';
import { useWindowSize } from '../../lib/useWindowSize';
import ProfileDropdown from '../../components/ProfileDropdown';
import MenuImportModal from '../../components/MenuImportModal';
import { useTour } from '../../lib/useTour';
import TourOverlay from '../../components/TourOverlay';
import { fetchSampleData } from '../../lib/seedSampleData';
import TourDataBanner from '../../components/TourDataBanner';

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

function getMarginNum(price, cost) {
  const p = parseFloat(price || 0);
  const c = parseFloat(cost || 0);
  if (p === 0 || c === 0) return null;
  return ((p - c) / p) * 100;
}

function getMarginColor(margin) {
  if (margin === null || margin === undefined) return 'var(--text-muted)';
  if (margin >= 70) return 'var(--color-green)';
  if (margin >= 50) return 'var(--accent)';
  if (margin >= 30) return 'var(--color-amber)';
  return 'var(--color-red)';
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
      (c.component_ingredients || []).some(i => !i.ingredients?.last_price || parseFloat(i.ingredients.last_price) === 0)
    );
  }
  if (!item.menu_item_ingredients || item.menu_item_ingredients.length === 0) return true;
  return item.menu_item_ingredients.some(i => !i.ingredients?.last_price || parseFloat(i.ingredients.last_price) === 0);
}

function hasEstimatedCosts(item) {
  if (item.menu_item_components?.length > 0) {
    return item.menu_item_components.some(c => (c.component_ingredients || []).some(ci => ci.ingredients?.is_estimated === true));
  }
  if (item.menu_item_ingredients?.length > 0) {
    return item.menu_item_ingredients.some(i => i.ingredients?.is_estimated === true);
  }
  return false;
}

function getIngredientCount(item) {
  if (item.menu_item_components && item.menu_item_components.length > 0) {
    const ids = new Set();
    item.menu_item_components.forEach(c => (c.component_ingredients || []).forEach(i => { if (i.ingredients?.id) ids.add(i.ingredients.id); }));
    return ids.size;
  }
  return item.menu_item_ingredients?.length || 0;
}

function getIncompleteIngredients(itemData) {
  if (!itemData) return [];
  const missing = [];
  if (itemData.components?.length > 0) {
    itemData.components.forEach(c => { (c.ingredients || []).forEach(ing => { if (!ing.hasPrice) missing.push({ name: ing.name, component: c.name, reason: 'No price on file' }); }); });
  } else {
    (itemData.ingredients || []).forEach(i => { const price = parseFloat(i.ingredients?.last_price || 0); if (price === 0) missing.push({ name: i.ingredients?.name || 'Unknown', component: null, reason: 'No price on file' }); });
  }
  return missing;
}

const S = {
  wf: { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: 'clamp(7px,.7vw,10px)', fontFamily: "'Inter', sans-serif" },
  wlbl: { fontSize: 'clamp(8px,.6vw,10px)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 'clamp(6px,.6vh,10px)', display: 'flex', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 },
  pill: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'clamp(4px,.3vw,6px)', padding: 'clamp(6px,.6vh,9px) clamp(8px,.7vw,10px)' },
  pillLbl: { fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4, fontFamily: "'Inter', sans-serif" },
  pillVal: { fontFamily: "'Inter', sans-serif", fontSize: 'clamp(11px,.85vw,14px)', fontWeight: 600 },
};

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg-root); overflow: hidden; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  input::placeholder { color: var(--text-faint) !important; }
  select option { background: var(--bg-inset); color: var(--text-primary); }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: var(--bg-elevated); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  input[type=range] { -webkit-appearance: none; height: 4px; border-radius: 2px; background: var(--bg-inset); outline: none; cursor: pointer; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); cursor: pointer; }

  .mi-root { font-family: 'Inter', sans-serif; background: var(--bg-root); color: var(--text-primary); width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .mi-nav { background: var(--bg-elevated); border-bottom: 1px solid var(--border); height: clamp(36px,4vh,52px); padding: 0 clamp(10px,1vw,20px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .mi-logo { font-family: 'Playfair Display', serif; font-size: clamp(13px,1.1vw,18px); color: var(--text-primary); letter-spacing: -.3px; }
  .mi-logo span { color: var(--accent); }
  .mi-tab { padding: clamp(2px,.3vh,4px) clamp(6px,.6vw,11px); border-radius: 4px; font-size: clamp(10px,.75vw,13px); color: var(--text-muted); border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .mi-tab.active { color: var(--text-primary); background: var(--bg-inset); }
  .mi-ph { background: var(--bg-surface); border-bottom: 1px solid var(--border); height: clamp(28px,3.2vh,40px); padding: 0 clamp(10px,1vw,16px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .mi-ph-title { font-size: clamp(11px,.82vw,15px); font-weight: 600; color: var(--text-primary); }
  .mi-ph-sub { font-size: clamp(9px,.62vw,11px); color: var(--text-muted); margin-left: 6px; }
  .mi-ph-action-item { display: flex; align-items: center; gap: 4px; font-size: clamp(9px,.62vw,11px); color: var(--text-muted); }
  .mi-ph-action-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .mi-ph-action-val { font-weight: 600; }
  .mi-body { display: flex; gap: clamp(6px,.6vw,10px); padding: clamp(6px,.6vw,10px) clamp(24px,3vw,60px); flex: 1; min-height: 0; overflow: hidden; }
  .mi-container { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .mi-container-hd { padding: clamp(8px,.8vh,13px) clamp(10px,1vw,16px); border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mi-container-title { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); white-space: nowrap; }
  .mi-container-count { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
  .mi-container-controls { display: flex; align-items: center; gap: 6px; flex: 1; justify-content: flex-end; }
  .mi-search { background: var(--bg-inset); border: 1px solid var(--border); border-radius: 4px; padding: clamp(3px,.3vh,5px) clamp(8px,.7vw,12px); font-size: clamp(10px,.75vw,12px); color: var(--text-primary); width: clamp(120px,13vw,200px); outline: none; font-family: 'Inter', sans-serif; }
  .mi-sort-sel { background: var(--bg-inset); border: 1px solid var(--border); border-radius: 4px; padding: clamp(3px,.3vh,5px) clamp(6px,.5vw,10px); font-size: clamp(9px,.68vw,11px); color: var(--text-muted); font-family: 'Inter', sans-serif; outline: none; cursor: pointer; }
  .mi-view-toggle { display: flex; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 5px; overflow: hidden; flex-shrink: 0; }
  .mi-toggle-btn { background: none; border: none; cursor: pointer; padding: clamp(3px,.3vh,5px) clamp(7px,.6vw,10px); color: var(--text-muted); transition: all .15s; display: flex; align-items: center; justify-content: center; }
  .mi-toggle-btn.active { background: var(--bg-inset); color: var(--accent); }
  .mi-toggle-btn:first-child { border-right: 1px solid var(--border); }
  .mi-toggle-btn svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .mi-add-btn { display: flex; align-items: center; gap: 5px; background: var(--accent); border: none; border-radius: 5px; padding: clamp(3px,.3vh,5px) clamp(8px,.7vw,12px); font-size: clamp(10px,.75vw,13px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: background .2s; }
  .mi-add-btn:hover { background: #01bcd4; }
  .mi-grid-wrap { flex: 1; overflow-y: auto; padding: clamp(8px,.8vw,12px); min-width: 0; }
  .mi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(6px,.6vw,10px); }
  .mi-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: clamp(10px,1vw,16px); cursor: pointer; transition: all .15s; position: relative; border-left: 3px solid transparent; min-width: 0; overflow: hidden; }
  .mi-card:hover { border-color: var(--text-faint); background: var(--bg-inset); }
  .mi-card.selected { border-color: var(--accent); background: rgba(2,164,186,.06); border-left-color: var(--accent); }
  .mi-card-status { position: absolute; top: 10px; right: 10px; font-size: clamp(7px,.58vw,9px); font-weight: 600; padding: 2px 6px; border-radius: 8px; }
  .cs-complete { background: rgba(42,138,90,.1); color: var(--color-green); }
  .cs-incomplete { background: rgba(192,64,64,.1); color: var(--color-red); }
  .cs-partial { background: rgba(212,160,32,.1); color: var(--color-amber); }
  .mi-card-icon { width: clamp(26px,2.4vw,36px); height: clamp(26px,2.4vw,36px); border-radius: 7px; background: rgba(2,164,186,.08); border: 1px solid rgba(2,164,186,.15); display: flex; align-items: center; justify-content: center; margin-bottom: clamp(8px,.8vh,12px); }
  .mi-card-icon svg { width: 55%; height: 55%; stroke: var(--accent); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mi-card-name { font-size: clamp(11px,.88vw,14px); font-weight: 600; color: var(--text-primary); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 40px; }
  .mi-card-sub { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); margin-bottom: clamp(8px,.8vh,12px); }
  .mi-card-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(4px,.4vw,6px); margin-bottom: clamp(6px,.6vh,9px); }
  .mi-metric-lbl { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
  .mi-metric-val { font-size: clamp(10px,.8vw,13px); font-weight: 600; color: var(--text-primary); }
  .mi-margin-bar { margin-top: clamp(6px,.6vh,9px); padding-top: clamp(6px,.6vh,9px); border-top: 1px solid var(--border); }
  .mi-margin-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .mi-margin-lbl { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; }
  .mi-margin-val { font-size: clamp(10px,.8vw,13px); font-weight: 700; }
  .mi-track { background: var(--bg-inset); border-radius: 3px; height: clamp(3px,.28vh,5px); }
  .mi-fill { height: 100%; border-radius: 3px; transition: width .3s; }
  .mi-list-head { display: grid; grid-template-columns: 2fr 1fr 1fr 1.4fr; gap: 8px; padding: clamp(6px,.6vh,10px) clamp(10px,1vw,16px); background: var(--bg-elevated); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .mi-list-th { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .8px; cursor: pointer; display: flex; align-items: center; gap: 3px; user-select: none; }
  .mi-list-th:hover { color: var(--text-muted); }
  .mi-list-th.active { color: var(--accent); }
  .mi-list-body { flex: 1; overflow-y: auto; }
  .mi-list-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1.4fr; gap: 8px; padding: clamp(7px,.7vh,11px) clamp(10px,1vw,16px); border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: background .15s; align-items: center; border-left: 2px solid transparent; }
  .mi-list-row:hover { background: var(--bg-elevated); }
  .mi-list-row.selected { background: rgba(2,164,186,.08); border-left-color: var(--accent); }
  .mi-list-td { font-size: clamp(10px,.75vw,12px); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mi-list-td.name { color: var(--text-primary); font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .mi-list-td.price { color: var(--accent); font-weight: 600; }
  .mi-list-td.no-price { color: var(--text-muted); font-style: italic; }
  .mi-list-margin { display: flex; align-items: center; gap: 6px; }
  .mi-list-margin-track { flex: 1; background: var(--bg-inset); border-radius: 3px; height: 4px; }
  .mi-list-margin-fill { height: 100%; border-radius: 3px; }
  .mi-list-margin-val { font-size: clamp(9px,.68vw,11px); font-weight: 600; flex-shrink: 0; width: 38px; text-align: right; }
  .mi-detail { width: clamp(320px,38vw,540px); background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; position: relative; }
  .mi-detail-hd { padding: clamp(8px,.8vh,13px) clamp(10px,1vw,16px); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .mi-detail-hd-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .mi-detail-title { font-family: 'Playfair Display', serif; font-size: clamp(12px,1vw,16px); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
  .mi-close-btn { background: none; border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: clamp(8px,.62vw,10px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; white-space: nowrap; }
  .mi-close-btn:hover { color: var(--text-primary); border-color: var(--text-faint); }
  .mi-view-tabs { display: flex; background: var(--bg-elevated); border-radius: 5px; padding: 2px; gap: 2px; }
  .mi-vtab { flex: 1; padding: clamp(3px,.3vh,5px); border-radius: 3px; font-size: clamp(8px,.65vw,11px); font-weight: 500; cursor: pointer; border: none; font-family: 'Inter', sans-serif; color: var(--text-muted); background: transparent; text-align: center; transition: all .15s; }
  .mi-vtab.active { background: var(--bg-inset); color: var(--text-primary); }
  .mi-detail-body { flex: 1; overflow-y: auto; padding: clamp(10px,1vw,14px); display: flex; flex-direction: column; gap: clamp(8px,.8vh,12px); font-family: 'Inter', sans-serif; }
  .mi-comp { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 6px; overflow: hidden; margin-bottom: 5px; }
  .mi-comp:last-child { margin-bottom: 0; }
  .mi-comp-hd { padding: clamp(6px,.6vh,9px) clamp(8px,.8vw,12px); display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background .15s; }
  .mi-comp-hd:hover { background: var(--bg-elevated); }
  .mi-comp-name { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: var(--text-primary); font-family: 'Inter', sans-serif; }
  .mi-comp-sub { font-size: clamp(8px,.6vw,10px); color: var(--text-muted); margin-top: 1px; font-family: 'Inter', sans-serif; }
  .mi-comp-cost { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: var(--accent); font-family: 'Inter', sans-serif; }
  .mi-comp-pct { font-size: clamp(8px,.6vw,10px); color: var(--text-muted); margin-top: 1px; font-family: 'Inter', sans-serif; }
  .mi-comp-ings { background: var(--bg-elevated); border-top: 1px solid var(--border-subtle); padding: clamp(5px,.5vh,8px) clamp(8px,.8vw,12px); }
  .mi-comp-ing-row { display: flex; align-items: center; padding: clamp(4px,.4vh,6px) 0; border-bottom: 1px solid var(--border-subtle); }
  .mi-comp-ing-row:last-child { border-bottom: none; }
  .mi-comp-ing-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-right: 6px; }
  .mi-comp-ing-name { font-size: clamp(9px,.68vw,11px); color: var(--text-primary); flex: 1; font-family: 'Inter', sans-serif; }
  .mi-comp-ing-qty { font-size: clamp(8px,.62vw,10px); color: var(--text-muted); margin: 0 8px; font-family: 'Inter', sans-serif; }
  .mi-comp-ing-cost { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: var(--text-muted); font-family: 'Inter', sans-serif; }
  .mi-opt-compare { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .mi-opt-card { border-radius: 7px; padding: clamp(8px,.8vw,12px); font-family: 'Inter', sans-serif; }
  .mi-opt-orig { background: var(--bg-elevated); border: 1px solid var(--border-subtle); }
  .mi-opt-new { background: rgba(42,138,90,.05); border: 1px solid rgba(42,138,90,.2); }
  .mi-opt-card-title { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 10px; }
  .mi-opt-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .mi-opt-row:last-child { margin-bottom: 0; padding-top: 6px; border-top: 1px solid var(--border-subtle); }
  .mi-opt-label { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); }
  .mi-opt-val { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); }
  .mi-opt-price-input { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 3px 7px; font-size: clamp(9px,.68vw,11px); color: var(--text-primary); width: clamp(55px,5.5vw,80px); text-align: right; outline: none; font-family: 'Inter', sans-serif; }
  .mi-opt-price-input:focus { border-color: var(--accent); }
  .mi-opt-comp { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 7px; padding: clamp(8px,.8vw,12px); margin-bottom: 6px; font-family: 'Inter', sans-serif; }
  .mi-opt-comp:last-child { margin-bottom: 0; }
  .mi-opt-comp-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .mi-opt-comp-name { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: var(--text-primary); }
  .mi-opt-cost { font-size: clamp(10px,.78vw,12px); font-weight: 600; color: var(--accent); }
  .mi-opt-slider-wrap { display: flex; align-items: center; gap: 7px; }
  .mi-opt-slider-lbl { font-size: clamp(8px,.6vw,10px); color: var(--text-muted); flex-shrink: 0; width: clamp(50px,5vw,70px); }
  .mi-opt-pct { font-size: clamp(9px,.68vw,11px); font-weight: 600; color: var(--accent); width: 35px; text-align: right; flex-shrink: 0; }
  .mi-opt-reset { background: none; border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; font-size: clamp(8px,.62vw,10px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .mi-opt-reset:hover { color: var(--text-primary); border-color: var(--text-faint); }
  .mi-edit-comp { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 7px; overflow: hidden; margin-bottom: 8px; }
  .mi-edit-comp-hd { background: var(--bg-surface); padding: clamp(6px,.6vh,9px) clamp(8px,.8vw,12px); display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--border-subtle); }
  .mi-edit-comp-name { flex: 1; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: clamp(10px,.78vw,12px); font-weight: 600; color: var(--text-primary); font-family: 'Inter', sans-serif; outline: none; }
  .mi-edit-comp-name:focus { border-color: var(--accent); }
  .mi-edit-ing-grid { display: grid; grid-template-columns: 1fr 68px 68px auto; gap: 5px; align-items: center; padding: clamp(5px,.5vh,8px) clamp(8px,.8vw,12px); border-bottom: 1px solid var(--border-subtle); }
  .mi-edit-input { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 4px 7px; font-size: clamp(9px,.68vw,11px); color: var(--text-primary); width: 100%; outline: none; font-family: 'Inter', sans-serif; }
  .mi-edit-input:focus { border-color: var(--accent); }
  .mi-edit-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 3px; transition: color .15s; line-height: 1; }
  .mi-edit-del:hover { color: var(--color-red); }
  .mi-edit-add-ing { background: none; border: 1px dashed var(--border); border-radius: 4px; padding: 5px 10px; font-size: clamp(8px,.62vw,10px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; width: 100%; margin: 6px 0 4px; transition: all .15s; }
  .mi-edit-add-ing:hover { border-color: var(--accent); color: var(--accent); }
  .mi-edit-add-comp { background: none; border: 1px dashed var(--border); border-radius: 7px; padding: 9px; font-size: clamp(9px,.68vw,11px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; width: 100%; transition: all .15s; text-align: center; }
  .mi-edit-add-comp:hover { border-color: var(--accent); color: var(--accent); }
  .mi-edit-save { background: var(--accent); border: none; border-radius: 6px; padding: clamp(7px,.7vh,10px) clamp(12px,1.1vw,18px); font-size: clamp(10px,.75vw,13px); font-weight: 600; color: var(--bg-root); cursor: pointer; font-family: 'Inter', sans-serif; transition: background .2s; width: 100%; margin-top: 4px; }
  .mi-edit-save:hover { background: #01bcd4; }
  .mi-edit-save:disabled { background: var(--border); color: var(--text-muted); cursor: not-allowed; }
  .mi-ing-search-wrap { position: relative; }
  .mi-ing-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 50; background: var(--bg-inset); border: 1px solid var(--text-faint); border-radius: 4px; max-height: 140px; overflow-y: auto; margin-top: 2px; }
  .mi-ing-option { padding: 5px 8px; font-size: clamp(9px,.68vw,11px); color: var(--text-primary); cursor: pointer; border-bottom: 1px solid var(--border); font-family: 'Inter', sans-serif; }
  .mi-ing-option:last-child { border-bottom: none; }
  .mi-ing-option:hover { background: var(--border); }
  .mi-ing-option-sub { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); margin-top: 1px; }
  .mi-ov-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .mi-ov-w { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 7px; padding: clamp(8px,.8vw,13px); }
  .mi-ov-wf { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 7px; padding: clamp(8px,.8vw,13px); }
  .mi-ov-lbl { font-size: clamp(8px,.6vw,10px); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: clamp(6px,.6vh,10px); display: flex; align-items: center; gap: 4px; }
  .mi-ov-lbl svg { width: 10px; height: 10px; stroke: var(--accent); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mi-ov-item { display: flex; align-items: center; justify-content: space-between; padding: clamp(4px,.4vh,7px) 0; border-bottom: 1px solid var(--bg-inset); }
  .mi-ov-item:last-child { border-bottom: none; }
  .mi-ov-name { font-size: clamp(9px,.68vw,11px); color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mi-ov-val { font-size: clamp(9px,.68vw,11px); font-weight: 600; flex-shrink: 0; }
  .mi-ov-pill { font-size: clamp(7px,.58vw,9px); padding: 1px 6px; border-radius: 8px; flex-shrink: 0; margin-left: 5px; }
  .mi-hint { font-size: clamp(8px,.62vw,10px); color: var(--text-faint); text-align: center; padding: clamp(4px,.4vh,7px); border: 1px dashed var(--border); border-radius: 6px; }
`;

export default function ClientMenuItems() {
  const router = useRouter();
  const { isMobile } = useWindowSize();

  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemData, setSelectedItemData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('details');
  const [displayMode, setDisplayMode] = useState('grid');
  const [expandedComponents, setExpandedComponents] = useState(new Set());
  const [multipliers, setMultipliers] = useState({});
  const [optimizedPrice, setOptimizedPrice] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [ingredientLibrary, setIngredientLibrary] = useState([]);
  const [editComponents, setEditComponents] = useState([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveMsg, setEditSaveMsg] = useState(null);
  const [ingSearch, setIngSearch] = useState({});
  const [ingDropdownOpen, setIngDropdownOpen] = useState({});
  const [editDirty, setEditDirty] = useState(false);
  const [editingCompIdx, setEditingCompIdx] = useState(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [unsavedCallback, setUnsavedCallback] = useState(null);
  const [mobTab, setMobTab] = useState('menu');

  const tabs = ['Dashboard', 'Invoices', 'Ingredients', 'Menu Items', 'Analytics'];
  const isTour = router.query.tour === 'true';

  useEffect(() => { init(); }, []);
  useEffect(() => { if (restaurantId && !isTour) fetchMenuItems(); }, [restaurantId]);
  useEffect(() => {
    router.prefetch('/client/dashboard');
    router.prefetch('/client/invoices');
    router.prefetch('/client/ingredients');
    router.prefetch('/client/menu-items');
    router.prefetch('/client/analytics');
  }, []);

  const { tourProps } = useTour('menu-items', restaurantId);

  useEffect(() => {
    if (!router.isReady || !isTour) return;
    fetchSampleData().then(sample => { if (sample) { setMenuItems(sample.menuItems); setLoading(false); } });
  }, [router.isReady, isTour]);

  useEffect(() => {
    if (selectedItemData && detailTab === 'edit') initEditComponents(selectedItemData);
  }, [selectedItemData]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/client/login'); return; }
    setUserEmail(user.email || '');
    const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
    if (!profile?.restaurant_id) return;
    setRestaurantId(profile.restaurant_id);
    setUserName(profile.full_name ? profile.full_name.split(' ')[0] : 'User');
  }

  async function fetchMenuItems() {
    setLoading(true);
    const { data } = await supabase.from('menu_items').select(`
      *, menu_item_ingredients(quantity, ingredients(id, name, unit, last_price)),
      menu_item_components(id, name, cost, component_ingredients(id, quantity, unit, ingredients:ingredient_id(id, name, last_price, unit, last_ordered_at, is_estimated)))
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
        if (unitCost > 0) { try { const calc = typeof calculateStandardizedCost === 'function' ? calculateStandardizedCost(ci.quantity, ci.unit, unitCost, ing?.name) : null; totalCost = (calc !== null && calc !== undefined && !isNaN(calc)) ? calc : 0; } catch { totalCost = 0; } }
        return { id: ci.id, ingredientId: ing?.id, name: ing?.name || 'Unknown', quantity: ci.quantity, unit: ci.unit, unitCost, standardUnit: ing?.unit || 'unit', totalCost, hasPrice: unitCost > 0, isEstimated: ing?.is_estimated === true };
      });
      const calculatedCost = processedIngs.reduce((s, i) => s + i.totalCost, 0);
      const effectiveCost = (c.cost > 0 && calculatedCost > c.cost * 3) ? c.cost : calculatedCost;
      return { id: c.id, name: c.name, storedCost: c.cost || 0, calculatedCost: effectiveCost, ingredients: processedIngs, ingredientCount: processedIngs.length };
    });
    setSelectedItemData({ item, ingredients: ings || [], components: processedComps, costHistory: history || [] });
    setOptimizedPrice(null); setMultipliers({}); setExpandedComponents(new Set());
    setDetailLoading(false);
  }

  function selectItem(id) {
    setSelectedItem(id); setDetailTab('details');
    setOptimizedPrice(null); setMultipliers({}); setExpandedComponents(new Set());
    if (isTour) {
      const item = menuItems.find(i => i.id === id);
      if (!item) return;
      const comps = (item.menu_item_components || []).map(c => {
        const processedIngs = (c.component_ingredients || []).map(ci => { const ing = ci.ingredients; const unitCost = parseFloat(ing?.last_price || 0); return { id: ci.id || `ci-${Math.random()}`, ingredientId: ing?.id, name: ing?.name || 'Unknown', quantity: ci.quantity, unit: ci.unit || ing?.unit || 'unit', unitCost, standardUnit: ing?.unit || 'unit', totalCost: parseFloat(ci.quantity || 0) * unitCost, hasPrice: unitCost > 0 }; });
        return { id: c.id, name: c.name, storedCost: parseFloat(c.cost || 0), calculatedCost: processedIngs.reduce((s, i) => s + i.totalCost, 0) || parseFloat(c.cost || 0), ingredients: processedIngs, ingredientCount: processedIngs.length };
      });
      setSelectedItemData({ item, ingredients: item.menu_item_ingredients || [], components: comps, costHistory: [] });
      return;
    }
    fetchItemDetail(id).then(() => fetchIngredientLibrary());
  }

  function handleSortChange(e) { const [field, dir] = e.target.value.split('-'); setSortBy(field); setSortOrder(dir); }

  const filtered = menuItems
    .filter(i => (i.name || '').toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
        case 'price': va = parseFloat(a.price || 0); vb = parseFloat(b.price || 0); break;
        case 'cost': va = parseFloat(a.cost || 0); vb = parseFloat(b.cost || 0); break;
        case 'margin': va = getMarginNum(a.price, a.cost) || 0; vb = getMarginNum(b.price, b.cost) || 0; break;
        default: return 0;
      }
      if (va < vb) return sortOrder === 'asc' ? -1 : 1;
      if (va > vb) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const itemsWithMargins = menuItems.filter(i => getMarginNum(i.price, i.cost) !== null);
  const avgMargin = itemsWithMargins.length > 0 ? itemsWithMargins.reduce((s, i) => s + getMarginNum(i.price, i.cost), 0) / itemsWithMargins.length : 0;
  const belowTarget = itemsWithMargins.filter(i => getMarginNum(i.price, i.cost) < 40).length;
  const topMargin = [...itemsWithMargins].sort((a, b) => getMarginNum(b.price, b.cost) - getMarginNum(a.price, a.cost)).slice(0, 4);
  const lowMargin = itemsWithMargins.filter(i => getMarginNum(i.price, i.cost) < 40).slice(0, 3);
  const noData = menuItems.filter(i => !i.price || !i.cost).slice(0, 2);
  const bucket = (lo, hi) => itemsWithMargins.filter(i => { const m = getMarginNum(i.price, i.cost); return m >= lo && m < hi; }).length;
  const maxBucket = Math.max(bucket(0, 40), bucket(40, 60), bucket(60, 75), bucket(75, 100), 1);

  const totalCost = selectedItemData
    ? selectedItemData.components.length > 0
      ? (() => { const compSum = selectedItemData.components.reduce((s, c) => s + (c.calculatedCost || c.storedCost || 0), 0); const stored = parseFloat(selectedItemData.item?.cost || 0); return (stored > 0 && compSum > stored * 3) ? stored : compSum; })()
      : selectedItemData.ingredients.length > 0
        ? selectedItemData.ingredients.reduce((s, i) => s + (parseFloat(i.ingredients?.last_price || 0) * parseFloat(i.quantity || 0)), 0)
        : parseFloat(selectedItemData.item?.cost || 0)
    : 0;

  const profitMargin = selectedItemData ? getMarginNum(selectedItemData.item?.price, totalCost) : null;
  function getMultiplier(id) { return multipliers[id] ?? 1.0; }
  function setMultiplier(id, val) { setMultipliers(prev => ({ ...prev, [id]: Math.max(0, Math.min(2, val)) })); }
  const optimizedCost = selectedItemData ? (selectedItemData.components.length > 0 ? selectedItemData.components.reduce((s, c) => s + (c.calculatedCost || c.storedCost || 0) * getMultiplier(c.id), 0) : totalCost * getMultiplier('all')) : 0;
  const effectivePrice = parseFloat(optimizedPrice ?? selectedItemData?.item?.price ?? 0);
  const optimizedMargin = effectivePrice > 0 ? ((effectivePrice - optimizedCost) / effectivePrice) * 100 : null;

  function toggleComp(id) { setExpandedComponents(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }

  async function fetchIngredientLibrary() {
    if (!restaurantId || ingredientLibrary.length > 0) return;
    const { data } = await supabase.from('ingredients').select('id, name, unit, last_price, is_estimated').eq('restaurant_id', restaurantId).order('name');
    setIngredientLibrary(data || []);
  }

  function initEditComponents(itemData) {
    setEditDirty(false);
    if (!itemData) return;
    setEditComponents(itemData.components.map(c => ({ id: c.id, name: c.name, isNew: false, ingredients: c.ingredients.map(ing => ({ ciId: ing.id, ingredientId: ing.ingredientId, name: ing.name, quantity: ing.quantity, unit: ing.unit, unitCost: ing.unitCost, isEstimated: ing.isEstimated, isNew: false })) })));
    setIngSearch({}); setIngDropdownOpen({}); setEditSaveMsg(null); setEditingCompIdx(null);
  }

  function addEditComponent() { setEditDirty(true); setEditComponents(prev => [...prev, { id: `new-${Date.now()}`, name: 'New Component', isNew: true, ingredients: [] }]); }
  function removeEditComponent(i) { setEditDirty(true); setEditComponents(prev => prev.filter((_, idx) => idx !== i)); }
  function updateEditComponentName(i, name) { setEditDirty(true); setEditComponents(prev => prev.map((c, idx) => idx === i ? { ...c, name } : c)); }
  function addEditIngredient(ci) { setEditDirty(true); setEditComponents(prev => prev.map((c, i) => i === ci ? { ...c, ingredients: [...c.ingredients, { ciId: `new-${Date.now()}`, ingredientId: null, name: '', quantity: 1, unit: 'oz', unitCost: 0, isEstimated: true, isNew: true }] } : c)); }
  function removeEditIngredient(ci, ii) { setEditDirty(true); setEditComponents(prev => prev.map((c, i) => i === ci ? { ...c, ingredients: c.ingredients.filter((_, j) => j !== ii) } : c)); }
  function updateEditIngredient(ci, ii, field, value) { setEditDirty(true); setEditComponents(prev => prev.map((c, i) => i === ci ? { ...c, ingredients: c.ingredients.map((ing, j) => j === ii ? { ...ing, [field]: value } : ing) } : c)); }

  function guardEditNavigation(callback) {
    if (detailTab === 'edit' && editDirty) { setUnsavedCallback(() => callback); setShowUnsavedModal(true); }
    else callback();
  }

  function selectLibraryIngredient(ci, ii, libIng) {
    setEditDirty(true);
    setEditComponents(prev => prev.map((c, i) => i === ci ? { ...c, ingredients: c.ingredients.map((ing, j) => j === ii ? { ...ing, ingredientId: libIng.id, name: libIng.name, unit: libIng.unit, unitCost: libIng.last_price || 0, isEstimated: libIng.is_estimated === true } : ing) } : c));
    const key = `${ci}-${ii}`;
    setIngDropdownOpen(prev => ({ ...prev, [key]: false }));
    setIngSearch(prev => ({ ...prev, [key]: '' }));
  }

  async function saveItemEdits() {
    if (!selectedItemData) return;
    setEditSaving(true); setEditSaveMsg(null);
    const menuItemId = selectedItemData.item.id;
    const errors = [];
    for (const comp of editComponents) {
      let componentId = comp.id;
      if (comp.isNew) {
        const compCost = comp.ingredients.reduce((s, i) => s + (parseFloat(i.quantity || 0) * parseFloat(i.unitCost || 0)), 0);
        const { data: newComp, error } = await supabase.from('menu_item_components').insert({ menu_item_id: menuItemId, name: comp.name, cost: Math.round(compCost * 10000) / 10000 }).select('id').single();
        if (error) { errors.push(`Failed to create component "${comp.name}"`); continue; }
        componentId = newComp.id;
      } else {
        const compCost = comp.ingredients.reduce((s, i) => s + (parseFloat(i.quantity || 0) * parseFloat(i.unitCost || 0)), 0);
        await supabase.from('menu_item_components').update({ name: comp.name, cost: Math.round(compCost * 10000) / 10000 }).eq('id', componentId);
      }
      for (const ing of comp.ingredients) {
        if (!ing.ingredientId) { errors.push(`"${ing.name}" has no ingredient selected`); continue; }
        if (!ing.isEstimated && ing.unitCost > 0) await supabase.from('ingredients').update({ last_price: ing.unitCost, is_estimated: false }).eq('id', ing.ingredientId);
        if (ing.isNew) await supabase.from('component_ingredients').insert({ component_id: componentId, ingredient_id: ing.ingredientId, quantity: parseFloat(ing.quantity || 0), unit: ing.unit });
        else await supabase.from('component_ingredients').update({ quantity: parseFloat(ing.quantity || 0), unit: ing.unit }).eq('id', ing.ciId);
      }
    }
    const newTotalCost = editComponents.reduce((s, c) => s + c.ingredients.reduce((ss, i) => ss + (parseFloat(i.quantity || 0) * parseFloat(i.unitCost || 0)), 0), 0);
    await supabase.from('menu_items').update({ cost: Math.round(newTotalCost * 100) / 100 }).eq('id', menuItemId);
    setEditSaving(false);
    if (errors.length > 0) { setEditSaveMsg({ type: 'error', text: `Saved with ${errors.length} issue(s): ${errors[0]}` }); }
    else { setEditSaveMsg({ type: 'success', text: 'Saved successfully' }); setEditDirty(false); await fetchItemDetail(menuItemId); await fetchMenuItems(); }
  }

  // ── Detail tab renderers (desktop) ───────────────────────────────────────

  function renderDetailsTab() {
    if (!selectedItemData) return null;
    const inc = getIncompleteIngredients(selectedItemData);
    return (
      <>
        <div style={S.wf}>
          <div style={S.wlbl}><div style={S.dot} />Menu Item</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 'clamp(5px,.5vw,8px)' }}>
            {[
              { l: 'Menu Price', v: selectedItemData.item?.price ? formatCurrency(selectedItemData.item.price) : '—', c: 'var(--accent)' },
              { l: 'Total Cost', v: formatCurrency(totalCost), c: 'var(--text-primary)' },
              { l: 'Profit Margin', v: profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—', c: getMarginColor(profitMargin), est: hasEstimatedCosts(selectedItemData.item) },
              { l: 'Ingredients', v: getIngredientCount(menuItems.find(i => i.id === selectedItem) || {}), c: 'var(--text-primary)' },
            ].map(({ l, v, c, est }) => (
              <div key={l} style={S.pill}>
                <div style={S.pillLbl}>{l}{est && <span style={{ marginLeft: 4, fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--color-amber)' }}>~est</span>}</div>
                <div style={{ ...S.pillVal, color: c }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        {totalCost > 0 && (
          <div style={S.wf}>
            <div style={S.wlbl}><div style={S.dot} />Pricing Recommendations</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'clamp(4px,.4vw,7px)' }}>
              {[{ l: 'Break-even\n30% cost', v: formatCurrency(totalCost / 0.30), highlight: false }, { l: 'Recommended\n25% cost', v: formatCurrency(totalCost / 0.25), highlight: true }, { l: 'Premium\n20% cost', v: formatCurrency(totalCost / 0.20), highlight: false }].map(({ l, v, highlight }) => (
                <div key={l} style={{ ...S.pill, textAlign: 'center' }}>
                  <div style={{ ...S.pillLbl, whiteSpace: 'pre-line', lineHeight: 1.4, marginBottom: 5 }}>{l}</div>
                  <div style={{ ...S.pillVal, color: highlight ? 'var(--color-green)' : 'var(--text-primary)', fontSize: 'clamp(12px,1vw,15px)' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {selectedItemData.components.length > 0 && (
          <div style={S.wf}>
            <div style={S.wlbl}><div style={S.dot} />Recipe</div>
            {selectedItemData.components.map(c => (
              <div key={c.id} className="mi-comp">
                <div className="mi-comp-hd" onClick={() => toggleComp(c.id)}>
                  <div><div className="mi-comp-name">{c.name}</div><div className="mi-comp-sub">{c.ingredientCount} ingredient{c.ingredientCount !== 1 ? 's' : ''}</div></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ textAlign: 'right' }}><div className="mi-comp-cost">{formatCurrency(c.calculatedCost)}</div><div className="mi-comp-pct">{totalCost > 0 ? ((c.calculatedCost / totalCost) * 100).toFixed(0) : 0}% of total</div></div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{expandedComponents.has(c.id) ? '▴' : '▾'}</span>
                  </div>
                </div>
                {expandedComponents.has(c.id) && (
                  <div className="mi-comp-ings">
                    {c.ingredients.map(ing => (
                      <div key={ing.id} className="mi-comp-ing-row">
                        <div className="mi-comp-ing-dot" style={{ background: ing.hasPrice ? 'var(--color-green)' : 'var(--color-red)' }} />
                        <div className="mi-comp-ing-name">{ing.name}</div>
                        <div className="mi-comp-ing-qty">{ing.quantity} {ing.unit}</div>
                        <div className="mi-comp-ing-cost" style={{ color: ing.isEstimated ? 'var(--color-amber)' : 'var(--text-muted)' }}>{formatCurrency(ing.totalCost)}{ing.isEstimated ? ' ~' : ''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif" }}>Total Food Cost</div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 'clamp(13px,1.1vw,17px)', color: 'var(--accent)' }}>{formatCurrency(totalCost)}</div>
            </div>
          </div>
        )}
        {selectedItemData.costHistory.length > 0 && (
          <div style={S.wf}>
            <div style={S.wlbl}><div style={S.dot} />Cost Change History</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'clamp(55px,5vw,70px) 1fr 1fr 1fr', gap: 5, padding: '0 clamp(8px,.7vw,10px) clamp(5px,.5vh,7px)', marginBottom: 2 }}>
              {['Date','Previous','New','Change'].map(h => <div key={h} style={{ fontSize: 'clamp(7px,.58vw,9px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: "'Inter', sans-serif" }}>{h}</div>)}
            </div>
            {selectedItemData.costHistory.slice(0, 6).map(r => {
              const change = parseFloat(r.new_cost || 0) - parseFloat(r.old_cost || 0);
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'clamp(55px,5vw,70px) 1fr 1fr 1fr', gap: 5, padding: 'clamp(5px,.5vh,7px) clamp(8px,.7vw,10px)', borderTop: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                  <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif" }}>{formatDate(r.created_at)}</div>
                  <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif" }}>{formatCurrency(r.old_cost)}</div>
                  <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif" }}>{formatCurrency(r.new_cost)}</div>
                  <div style={{ fontSize: 'clamp(9px,.68vw,11px)', fontWeight: 600, color: change > 0 ? 'var(--color-red)' : 'var(--color-green)', fontFamily: "'Inter', sans-serif" }}>{change > 0 ? '+' : ''}{formatCurrency(change)}</div>
                </div>
              );
            })}
          </div>
        )}
        {inc.length > 0 && (
          <div style={{ background: 'rgba(192,64,64,.05)', border: '1px solid rgba(192,64,64,.2)', borderRadius: 7, padding: 'clamp(8px,.8vw,12px)' }}>
            <div style={{ ...S.wlbl, color: 'var(--color-red)', marginBottom: 8 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-red)', flexShrink: 0 }} />Why Incomplete?</div>
            <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)', marginBottom: 8, fontFamily: "'Inter', sans-serif" }}>{inc.length} ingredient{inc.length !== 1 ? 's are' : ' is'} missing a price.</div>
            {inc.map((ing, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'clamp(3px,.3vh,5px) 0', borderBottom: '1px solid rgba(192,64,64,.1)' }}>
                <div><div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif" }}>{ing.name}</div>{ing.component && <div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif" }}>in {ing.component}</div>}</div>
                <span style={{ fontSize: 'clamp(7px,.58vw,9px)', padding: '1px 6px', borderRadius: 8, background: 'rgba(192,64,64,.1)', color: 'var(--color-red)', fontFamily: "'Inter', sans-serif" }}>{ing.reason}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  function renderOptimizeTab() {
    if (!selectedItemData) return null;
    return (
      <>
        <div style={S.wf}>
          <div style={S.wlbl}><div style={S.dot} />Scenario Comparison</div>
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
              <div className="mi-opt-row"><span className="mi-opt-label">Price</span><input className="mi-opt-price-input" type="number" step="0.01" min="0" value={optimizedPrice ?? selectedItemData.item?.price ?? ''} onChange={e => setOptimizedPrice(parseFloat(e.target.value) || null)} /></div>
              <div className="mi-opt-row"><span className="mi-opt-label">Margin</span><span className="mi-opt-val" style={{ color: getMarginColor(optimizedMargin) }}>{optimizedMargin !== null ? `${optimizedMargin.toFixed(1)}%` : '—'}</span></div>
            </div>
          </div>
        </div>
        <div style={S.wf}>
          <div style={{ ...S.wlbl, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={S.dot} />Adjust Portions</span>
            <button className="mi-opt-reset" onClick={() => { setMultipliers({}); setOptimizedPrice(null); }}>Reset</button>
          </div>
          {selectedItemData.components.length > 0 ? selectedItemData.components.map(c => {
            const m = getMultiplier(c.id);
            return (
              <div key={c.id} className="mi-opt-comp">
                <div className="mi-opt-comp-hd"><div><div className="mi-opt-comp-name">{c.name}</div><div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-muted)' }}>{c.ingredientCount} ingredients</div></div><div className="mi-opt-cost">{formatCurrency((c.calculatedCost || c.storedCost || 0) * m)}</div></div>
                <div className="mi-opt-slider-wrap">
                  <div className="mi-opt-slider-lbl">Portion</div>
                  <input type="range" style={{ flex: 1, background: `linear-gradient(to right,var(--accent) 0%,var(--accent) ${m * 50}%,var(--bg-inset) ${m * 50}%,var(--bg-inset) 100%)` }} min="0" max="2" step="0.01" value={m} onChange={e => setMultiplier(c.id, parseFloat(e.target.value))} />
                  <div className="mi-opt-pct">{Math.round(m * 100)}%</div>
                </div>
              </div>
            );
          }) : (
            <div className="mi-opt-comp">
              <div className="mi-opt-comp-hd"><div><div className="mi-opt-comp-name">Recipe Portion</div><div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-muted)' }}>{selectedItemData.ingredients.length} ingredients</div></div><div className="mi-opt-cost">{formatCurrency(totalCost * getMultiplier('all'))}</div></div>
              <div className="mi-opt-slider-wrap">
                <div className="mi-opt-slider-lbl">Portion</div>
                <input type="range" style={{ flex: 1, background: `linear-gradient(to right,var(--accent) 0%,var(--accent) ${getMultiplier('all') * 50}%,var(--bg-inset) ${getMultiplier('all') * 50}%,var(--bg-inset) 100%)` }} min="0" max="2" step="0.01" value={getMultiplier('all')} onChange={e => setMultiplier('all', parseFloat(e.target.value))} />
                <div className="mi-opt-pct">{Math.round(getMultiplier('all') * 100)}%</div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderEditTab() {
    return (
      <>
        <div style={S.wf}>
          <div style={S.wlbl}><div style={S.dot} />Components</div>
          {editComponents.length === 0 && <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif", padding: '4px 0' }}>No components yet. Add one below.</div>}
          {editComponents.map((comp, compIdx) => {
            const compCost = comp.ingredients.reduce((s, i) => s + (parseFloat(i.quantity || 0) * parseFloat(i.unitCost || 0)), 0);
            const isExpanded = editingCompIdx === compIdx;
            return (
              <div key={comp.id} style={{ marginBottom: 5 }}>
                <div onClick={() => setEditingCompIdx(isExpanded ? null : compIdx)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'clamp(7px,.7vh,10px) clamp(8px,.7vw,12px)', background: isExpanded ? 'var(--bg-surface)' : 'var(--bg-elevated)', border: `1px solid ${isExpanded ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: isExpanded ? '6px 6px 0 0' : 6, cursor: 'pointer', transition: 'all .15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 'clamp(10px,.78vw,12px)', fontWeight: 600, color: isExpanded ? 'var(--accent)' : 'var(--text-primary)', fontFamily: "'Inter', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comp.name || 'Unnamed'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif" }}>{comp.ingredients.length} ing.</span>
                    <span style={{ fontSize: 'clamp(9px,.68vw,11px)', fontWeight: 600, color: 'var(--accent)', fontFamily: "'Inter', sans-serif" }}>{formatCurrency(compCost)}</span>
                    <span style={{ fontSize: 10, color: isExpanded ? 'var(--accent)' : 'var(--text-muted)' }}>{isExpanded ? '▴' : '▾'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: 'clamp(8px,.8vw,12px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 'clamp(7px,.58vw,9px)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: "'Inter', sans-serif", marginBottom: 4 }}>Component Name</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="mi-edit-input" style={{ flex: 1 }} value={comp.name} onChange={e => updateEditComponentName(compIdx, e.target.value)} />
                        <button onClick={() => { removeEditComponent(compIdx); setEditingCompIdx(null); }} style={{ background: 'rgba(192,64,64,.08)', border: '1px solid rgba(192,64,64,.2)', borderRadius: 4, padding: '4px 10px', fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--color-red)', cursor: 'pointer', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap' }}>Remove</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 62px 48px auto', gap: 5 }}>
                      {['Ingredient','Qty','Unit','Cost',''].map(h => <div key={h} style={{ fontSize: 'clamp(7px,.55vw,9px)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: "'Inter', sans-serif" }}>{h}</div>)}
                    </div>
                    {comp.ingredients.length === 0 && <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif", fontStyle: 'italic' }}>No ingredients. Add one below.</div>}
                    {comp.ingredients.map((ing, ingIdx) => {
                      const key = `${compIdx}-${ingIdx}`;
                      const searchVal = ingSearch[key] ?? ing.name;
                      const isOpen = ingDropdownOpen[key] || false;
                      const filteredLib = ingredientLibrary.filter(lib => lib.name.toLowerCase().includes((ingSearch[key] || '').toLowerCase())).slice(0, 8);
                      const ingCost = parseFloat(ing.quantity || 0) * parseFloat(ing.unitCost || 0);
                      return (
                        <div key={ing.ciId} style={{ display: 'grid', gridTemplateColumns: '1fr 62px 62px 48px auto', gap: 5, alignItems: 'center' }}>
                          <div className="mi-ing-search-wrap">
                            <input className="mi-edit-input" value={searchVal} style={{ borderColor: ing.isEstimated ? 'rgba(212,160,32,.35)' : 'var(--border)' }} placeholder="Search..." onChange={e => { setIngSearch(prev => ({ ...prev, [key]: e.target.value })); setIngDropdownOpen(prev => ({ ...prev, [key]: true })); }} onFocus={() => setIngDropdownOpen(prev => ({ ...prev, [key]: true }))} onBlur={() => setTimeout(() => setIngDropdownOpen(prev => ({ ...prev, [key]: false })), 150)} />
                            {isOpen && filteredLib.length > 0 && (
                              <div className="mi-ing-dropdown">
                                {filteredLib.map(lib => <div key={lib.id} className="mi-ing-option" onMouseDown={() => selectLibraryIngredient(compIdx, ingIdx, lib)}>{lib.name}<div className="mi-ing-option-sub">{lib.unit} · {lib.last_price ? formatCurrency(lib.last_price) : 'no price'}{lib.is_estimated ? ' ~est' : ''}</div></div>)}
                              </div>
                            )}
                          </div>
                          <input className="mi-edit-input" type="number" min="0" step="0.01" value={ing.quantity} onChange={e => updateEditIngredient(compIdx, ingIdx, 'quantity', e.target.value)} />
                          <input className="mi-edit-input" value={ing.unit} onChange={e => updateEditIngredient(compIdx, ingIdx, 'unit', e.target.value)} />
                          <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif", textAlign: 'right' }}>{formatCurrency(ingCost)}</div>
                          <button className="mi-edit-del" onClick={() => removeEditIngredient(compIdx, ingIdx)}>✕</button>
                        </div>
                      );
                    })}
                    <button className="mi-edit-add-ing" onClick={() => addEditIngredient(compIdx)}>+ Add Ingredient</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button className="mi-edit-add-comp" onClick={() => { addEditComponent(); setEditingCompIdx(editComponents.length); }}>+ Add Component</button>
        {editSaveMsg && <div style={{ fontSize: 'clamp(9px,.68vw,11px)', padding: '7px 10px', borderRadius: 6, textAlign: 'center', fontFamily: "'Inter', sans-serif", background: editSaveMsg.type === 'success' ? 'rgba(42,138,90,.1)' : 'rgba(192,64,64,.1)', color: editSaveMsg.type === 'success' ? 'var(--color-green)' : 'var(--color-red)', border: `1px solid ${editSaveMsg.type === 'success' ? 'rgba(42,138,90,.2)' : 'rgba(192,64,64,.2)'}` }}>{editSaveMsg.text}</div>}
        <button className="mi-edit-save" onClick={saveItemEdits} disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</button>
      </>
    );
  }

  function renderGridItem(item) {
    const margin = getMarginNum(item.price, item.cost);
    const mc = getMarginColor(margin);
    const { label, cls } = getStatus(item);
    const ingCount = getIngredientCount(item);
    const isSelected = selectedItem === item.id;
    return (
      <div key={item.id} className={`mi-card${isSelected ? ' selected' : ''}`} onClick={() => guardEditNavigation(() => selectItem(item.id))}>
        <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4, alignItems: 'center' }}>
          {hasEstimatedCosts(item) && <span style={{ fontSize: 'clamp(7px,.55vw,9px)', fontWeight: 600, padding: '1px 5px', borderRadius: 6, background: 'rgba(212,160,32,.12)', color: 'var(--color-amber)', border: '1px solid rgba(212,160,32,.2)' }}>est. costs</span>}
          <span className={`mi-card-status ${cls}`} style={{ position: 'static' }}>{label}</span>
        </div>
        <div className="mi-card-icon"><svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg></div>
        <div className="mi-card-name">{item.name || 'Unnamed'}</div>
        <div className="mi-card-sub">{ingCount} ingredient{ingCount !== 1 ? 's' : ''}</div>
        <div className="mi-card-metrics">
          <div><div className="mi-metric-lbl">Price</div><div className="mi-metric-val">{item.price ? formatCurrency(item.price) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</div></div>
          <div><div className="mi-metric-lbl">Cost</div><div className="mi-metric-val">{item.cost ? formatCurrency(item.cost) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</div></div>
        </div>
        <div className="mi-margin-bar">
          <div className="mi-margin-hd"><span className="mi-margin-lbl">Margin</span><span className="mi-margin-val" style={{ color: mc }}>{margin !== null ? `${margin.toFixed(1)}%` : '—'}</span></div>
          <div className="mi-track"><div className="mi-fill" style={{ width: `${Math.max(0, Math.min(100, margin || 0))}%`, background: mc }} /></div>
        </div>
      </div>
    );
  }

  function renderListItem(item) {
    const margin = getMarginNum(item.price, item.cost);
    const mc = getMarginColor(margin);
    const { cls } = getStatus(item);
    const isSelected = selectedItem === item.id;
    return (
      <div key={item.id} className={`mi-list-row${isSelected ? ' selected' : ''}`} onClick={() => guardEditNavigation(() => selectItem(item.id))}>
        <div className="mi-list-td name"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || 'Unnamed'}</span><span className={cls} style={{ fontSize: 'clamp(7px,.55vw,9px)', fontWeight: 600, padding: '1px 5px', borderRadius: 6, flexShrink: 0 }}>{getStatus(item).label}</span></div>
        <div className={`mi-list-td ${item.price ? 'price' : 'no-price'}`}>{item.price ? formatCurrency(item.price) : '—'}</div>
        <div className="mi-list-td" style={{ color: item.cost ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: item.cost ? 'normal' : 'italic' }}>{item.cost ? formatCurrency(item.cost) : '—'}</div>
        <div className="mi-list-td"><div className="mi-list-margin"><div className="mi-list-margin-track"><div className="mi-list-margin-fill" style={{ width: `${Math.max(0, Math.min(100, margin || 0))}%`, background: mc }} /></div><div className="mi-list-margin-val" style={{ color: mc }}>{margin !== null ? `${margin.toFixed(1)}%` : '—'}</div></div></div>
      </div>
    );
  }

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    const MOB_TABS = [
      { id: 'menu',     label: 'Menu Items', badge: filtered.length },
      { id: 'overview', label: 'Overview' },
      { id: 'margins',  label: 'Margins' },
    ];

    const NAV_ITEMS = [
      { label: 'Dashboard',   path: '/client/dashboard',   icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
      { label: 'Invoices',    path: '/client/invoices',    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
      { label: 'Ingredients', path: '/client/ingredients', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/></svg> },
      { label: 'Menu',        path: '/client/menu-items',  icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
      { label: 'Analytics',   path: '/client/analytics',   icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
    ];

    return (
      <>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        </Head>
        <style>{CSS}</style>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
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
          .mob2-menu-row { display:flex; align-items:center; padding:13px 16px; border-bottom:1px solid var(--border-subtle); cursor:pointer; gap:12px; border-left:3px solid transparent; -webkit-tap-highlight-color:transparent; }
          .mob2-bottom-nav { background:var(--bg-elevated); border-top:1px solid var(--border); padding:8px 0 0; padding-bottom:env(safe-area-inset-bottom,8px); display:flex; flex-shrink:0; position:sticky; bottom:0; z-index:50; }
          .mob2-nav-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; padding:4px 0; -webkit-tap-highlight-color:transparent; }
          .mob2-nav-icon svg { width:20px; height:20px; stroke:var(--text-muted); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
          .mob2-nav-icon.active svg { stroke:var(--accent); }
          .mob2-nav-label { font-size:10px; color:var(--text-muted); }
          .mob2-nav-label.active { color:var(--accent); }
          .mob2-detail-overlay { position:fixed; inset:0; background:var(--bg-root); display:flex; flex-direction:column; z-index:30; overflow:hidden; }
          .mob2-detail-hd { background:var(--bg-elevated); border-bottom:1px solid var(--border); padding:12px 16px; padding-top:max(12px,env(safe-area-inset-top)); display:flex; align-items:center; gap:12px; flex-shrink:0; }
          .mob2-detail-vtabs { background:var(--bg-root); border-bottom:1px solid var(--border); display:flex; flex-shrink:0; }
          .mob2-detail-vtab { flex:1; padding:10px; font-size:12px; font-weight:500; color:var(--text-muted); border:none; background:none; cursor:pointer; font-family:'Inter',sans-serif; border-bottom:2px solid transparent; text-align:center; -webkit-tap-highlight-color:transparent; }
          .mob2-detail-vtab.active { color:var(--accent); border-bottom-color:var(--accent); }
          .mob2-detail-body { flex:1; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px; padding-bottom:max(24px,env(safe-area-inset-bottom)); }
          .mob2-detail-body::-webkit-scrollbar { display:none; }
          cs-complete { background: rgba(42,138,90,.1); color: var(--color-green); }
          cs-incomplete { background: rgba(192,64,64,.1); color: var(--color-red); }
          cs-partial { background: rgba(212,160,32,.1); color: var(--color-amber); }
        `}</style>

        <div className="mob2-root">

          {/* Header */}
          <div className="mob2-header">
            <div className="mob2-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setShowImportModal(true)}
                style={{ background: 'transparent', border: '1px solid var(--accent)', borderRadius: 7, padding: '7px 12px', fontSize: 12, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                Import
              </button>
              <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={true} />
            </div>
          </div>

          {/* Sub bar */}
          <div className="mob2-subbar">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Menu Engineering</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{menuItems.length} items · {avgMargin.toFixed(1)}% avg margin</div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {belowTarget > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5 }}>Below Target</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-red)' }}>{belowTarget}</div>
                </div>
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5 }}>Avg Margin</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: avgMargin >= 60 ? 'var(--color-green)' : avgMargin >= 40 ? 'var(--accent)' : 'var(--color-amber)' }}>{avgMargin.toFixed(1)}%</div>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="mob2-tabs">
            {MOB_TABS.map(t => (
              <button key={t.id} className={`mob2-tab${mobTab === t.id ? ' active' : ''}`} onClick={() => setMobTab(t.id)}>
                {t.label}
                {t.badge !== undefined && <span className="mob2-tab-badge">{t.badge}</span>}
              </button>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading menu items...</div>
            </div>
          ) : (
            <>
              {/* ── MENU ITEMS TAB ── */}
              {mobTab === 'menu' && (
                <>
                  <div className="mob2-search">
                    <input className="mob2-search-input" placeholder="Search menu items..."
                      value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  </div>
                  <div className="mob2-scroll">
                    {filtered.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No menu items yet'}</div>
                        {!searchTerm && <button onClick={() => setShowImportModal(true)} style={{ background: 'rgba(2,164,186,.1)', border: '1px solid rgba(2,164,186,.3)', borderRadius: 8, padding: '10px 24px', fontSize: 13, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>↑ Import Your Menu</button>}
                      </div>
                    ) : filtered.map(item => {
                      const margin = getMarginNum(item.price, item.cost);
                      const mc = getMarginColor(margin);
                      const { label, cls } = getStatus(item);
                      const ingCount = getIngredientCount(item);
                      return (
                        <div key={item.id} className="mob2-menu-row" onClick={() => selectItem(item.id)}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: mc, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || 'Unnamed'}</div>
                              <span className={cls} style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 6, flexShrink: 0 }}>{label}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{ingCount} ingredient{ingCount !== 1 ? 's' : ''} · {item.price ? formatCurrency(item.price) : 'No price'}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: mc }}>{margin !== null ? `${margin.toFixed(1)}%` : '—'}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>margin</div>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>›</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ── OVERVIEW TAB ── */}
              {mobTab === 'overview' && (
                <div className="mob2-content">
                  {/* Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { l: 'Total Items', v: menuItems.length, c: 'var(--text-primary)' },
                      { l: 'Avg Margin', v: `${avgMargin.toFixed(1)}%`, c: avgMargin >= 60 ? 'var(--color-green)' : avgMargin >= 40 ? 'var(--accent)' : 'var(--color-amber)' },
                      { l: 'Below Target', v: belowTarget, c: belowTarget > 0 ? 'var(--color-red)' : 'var(--color-green)' },
                      { l: 'No Cost Data', v: noData.length, c: noData.length > 0 ? 'var(--color-amber)' : 'var(--color-green)' },
                    ].map(({ l, v, c }) => (
                      <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>{l}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: c, lineHeight: 1 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Top margin items */}
                  <div className="mob2-card">
                    <div className="mob2-card-title">
                      <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      Top Margin Items
                    </div>
                    {topMargin.length > 0 ? topMargin.map(item => {
                      const m = getMarginNum(item.price, item.cost);
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { setMobTab('menu'); selectItem(item.id); }}>
                          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: getMarginColor(m) }}>{m?.toFixed(1)}%</div>
                        </div>
                      );
                    }) : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No data yet</div>}
                  </div>

                  {/* Needs attention */}
                  <div className="mob2-card">
                    <div className="mob2-card-title">
                      <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      Needs Attention
                    </div>
                    {lowMargin.length === 0 && noData.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--color-green)' }}>All items on target ✓</div>
                    ) : [...lowMargin, ...noData].map(item => {
                      const m = getMarginNum(item.price, item.cost);
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { setMobTab('menu'); selectItem(item.id); }}>
                          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 8, background: m !== null ? 'rgba(192,64,64,.1)' : 'rgba(212,160,32,.1)', color: m !== null ? 'var(--color-red)' : 'var(--color-amber)' }}>
                            {m !== null ? `${m.toFixed(1)}%` : 'No cost'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ height: 8 }} />
                </div>
              )}

              {/* ── MARGINS TAB ── */}
              {mobTab === 'margins' && (
                <div className="mob2-content">
                  {/* Distribution chart */}
                  <div className="mob2-card">
                    <div className="mob2-card-title">
                      <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                      Margin Distribution
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
                      {[{ lo: 0, hi: 40, label: '<40%', c: 'var(--color-red)' }, { lo: 40, hi: 60, label: '40–60%', c: 'var(--color-amber)' }, { lo: 60, hi: 75, label: '60–75%', c: 'var(--accent)' }, { lo: 75, hi: 101, label: '>75%', c: 'var(--color-green)' }].map(({ lo, hi, label, c }) => {
                        const count = bucket(lo, hi);
                        return (
                          <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
                            <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                              <div style={{ width: '100%', height: `${Math.max(5, (count / maxBucket) * 100)}%`, background: c, opacity: .8, borderRadius: '3px 3px 0 0' }} />
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center' }}>{label}</div>
                            <div style={{ fontSize: 11, color: c, fontWeight: 700 }}>{count}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* All items ranked by margin */}
                  <div className="mob2-card">
                    <div className="mob2-card-title">All Items by Margin</div>
                    {[...itemsWithMargins].sort((a, b) => getMarginNum(b.price, b.cost) - getMarginNum(a.price, a.cost)).map((item, i) => {
                      const m = getMarginNum(item.price, item.cost);
                      const mc = getMarginColor(m);
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { setMobTab('menu'); selectItem(item.id); }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', width: 20, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                            <div style={{ marginTop: 4, height: 4, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.max(0, Math.min(100, m || 0))}%`, height: '100%', background: mc, borderRadius: 2 }} />
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: mc, flexShrink: 0 }}>{m?.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                    {itemsWithMargins.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No margin data yet — add prices and costs to menu items</div>}
                  </div>
                  <div style={{ height: 8 }} />
                </div>
              )}
            </>
          )}

          {/* Bottom nav */}
          <div className="mob2-bottom-nav">
            {NAV_ITEMS.map(({ label, path, icon }) => {
              const active = path === '/client/menu-items';
              return (
                <div key={label} className="mob2-nav-item" onClick={() => router.push(path)}>
                  <div className={`mob2-nav-icon${active ? ' active' : ''}`}>{icon}</div>
                  <div className={`mob2-nav-label${active ? ' active' : ''}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Item detail overlay */}
        {selectedItem && selectedItemData && (
          <div className="mob2-detail-overlay">
            <div className="mob2-detail-hd">
              <button onClick={() => { setSelectedItem(null); setSelectedItemData(null); setDetailTab('details'); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)', fontFamily: 'Inter,sans-serif', padding: 0, flexShrink: 0 }}>← Back</button>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedItemData.item?.name}</div>
              <span className={getStatus(selectedItemData.item || {}).cls} style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 8, flexShrink: 0 }}>{getStatus(selectedItemData.item || {}).label}</span>
            </div>

            {/* Sub-tabs */}
            <div className="mob2-detail-vtabs">
              {['details', 'optimize'].map(tab => (
                <button key={tab} className={`mob2-detail-vtab${detailTab === tab ? ' active' : ''}`} onClick={() => setDetailTab(tab)}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
              <button className="mob2-detail-vtab" style={{ color: 'var(--text-faint)', cursor: 'default', fontSize: 11 }} title="Edit is only available on desktop">
                Edit (Desktop)
              </button>
            </div>

            <div className="mob2-detail-body">
              {detailLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                  <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                  Loading details...
                </div>
              ) : (
                <>
                  {/* Details tab */}
                  {detailTab === 'details' && (
                    <>
                      {/* Key metrics */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[
                          { l: 'Menu Price', v: selectedItemData.item?.price ? formatCurrency(selectedItemData.item.price) : '—', c: 'var(--accent)' },
                          { l: 'Total Cost', v: formatCurrency(totalCost), c: 'var(--text-primary)' },
                          { l: 'Profit Margin', v: profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—', c: getMarginColor(profitMargin) },
                          { l: 'Ingredients', v: getIngredientCount(menuItems.find(i => i.id === selectedItem) || {}), c: 'var(--text-primary)' },
                        ].map(({ l, v, c }) => (
                          <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: c, lineHeight: 1 }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      {/* Pricing recs */}
                      {totalCost > 0 && (
                        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .7, marginBottom: 10 }}>Pricing Recommendations</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            {[{ l: '30% cost', v: formatCurrency(totalCost / 0.30) }, { l: '25% cost', v: formatCurrency(totalCost / 0.25), highlight: true }, { l: '20% cost', v: formatCurrency(totalCost / 0.20) }].map(({ l, v, highlight }) => (
                              <div key={l} style={{ background: 'var(--bg-elevated)', border: `1px solid ${highlight ? 'rgba(42,138,90,.3)' : 'var(--border-subtle)'}`, borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? 'var(--color-green)' : 'var(--text-primary)' }}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recipe */}
                      {selectedItemData.components.length > 0 && (
                        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .7, marginBottom: 10 }}>Recipe</div>
                          {selectedItemData.components.map(c => (
                            <div key={c.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', cursor: 'pointer' }} onClick={() => toggleComp(c.id)}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{c.ingredientCount} ingredients</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{formatCurrency(c.calculatedCost)}</div>
                                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{expandedComponents.has(c.id) ? '▴' : '▾'}</div>
                                </div>
                              </div>
                              {expandedComponents.has(c.id) && (
                                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '8px 12px' }}>
                                  {c.ingredients.map(ing => (
                                    <div key={ing.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: ing.hasPrice ? 'var(--color-green)' : 'var(--color-red)', flexShrink: 0 }} />
                                      <div style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>{ing.name}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ing.quantity} {ing.unit}</div>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: ing.isEstimated ? 'var(--color-amber)' : 'var(--text-muted)' }}>{formatCurrency(ing.totalCost)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Food Cost</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(totalCost)}</div>
                          </div>
                        </div>
                      )}

                      {/* Incomplete warning */}
                      {(() => { const inc = getIncompleteIngredients(selectedItemData); return inc.length > 0 ? (
                        <div style={{ background: 'rgba(192,64,64,.05)', border: '1px solid rgba(192,64,64,.2)', borderRadius: 8, padding: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-red)', marginBottom: 8 }}>⚠ {inc.length} ingredient{inc.length !== 1 ? 's are' : ' is'} missing a price</div>
                          {inc.map((ing, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0', borderBottom: '1px solid rgba(192,64,64,.1)' }}>{ing.name}{ing.component ? ` · in ${ing.component}` : ''}</div>)}
                        </div>
                      ) : null; })()}
                    </>
                  )}

                  {/* Optimize tab */}
                  {detailTab === 'optimize' && (
                    <>
                      {/* Comparison */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .6, marginBottom: 10 }}>Original</div>
                          {[{ l: 'Cost', v: formatCurrency(totalCost) }, { l: 'Price', v: formatCurrency(selectedItemData.item?.price) }, { l: 'Margin', v: profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—', c: getMarginColor(profitMargin) }].map(({ l, v, c }) => (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: c || 'var(--text-primary)' }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ background: 'rgba(42,138,90,.05)', border: '1px solid rgba(42,138,90,.2)', borderRadius: 8, padding: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .6, marginBottom: 10 }}>Optimized</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cost</span><span style={{ fontSize: 12, fontWeight: 600 }}>{formatCurrency(optimizedCost)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Price</span>
                            <input type="number" step="0.01" min="0" value={optimizedPrice ?? selectedItemData.item?.price ?? ''} onChange={e => setOptimizedPrice(parseFloat(e.target.value) || null)}
                              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontSize: 12, color: 'var(--text-primary)', width: 70, textAlign: 'right', outline: 'none', fontFamily: 'Inter,sans-serif' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Margin</span><span style={{ fontSize: 12, fontWeight: 600, color: getMarginColor(optimizedMargin) }}>{optimizedMargin !== null ? `${optimizedMargin.toFixed(1)}%` : '—'}</span></div>
                        </div>
                      </div>

                      {/* Portion sliders */}
                      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .7 }}>Adjust Portions</div>
                          <button onClick={() => { setMultipliers({}); setOptimizedPrice(null); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Reset</button>
                        </div>
                        {selectedItemData.components.length > 0 ? selectedItemData.components.map(c => {
                          const m = getMultiplier(c.id);
                          return (
                            <div key={c.id} style={{ marginBottom: 14 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{formatCurrency((c.calculatedCost || c.storedCost || 0) * m)}</div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <input type="range" style={{ flex: 1, background: `linear-gradient(to right,var(--accent) 0%,var(--accent) ${m * 50}%,var(--bg-inset) ${m * 50}%,var(--bg-inset) 100%)` }} min="0" max="2" step="0.01" value={m} onChange={e => setMultiplier(c.id, parseFloat(e.target.value))} />
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', width: 36, textAlign: 'right' }}>{Math.round(m * 100)}%</div>
                              </div>
                            </div>
                          );
                        }) : (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Recipe Portion</div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{formatCurrency(totalCost * getMultiplier('all'))}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <input type="range" style={{ flex: 1 }} min="0" max="2" step="0.01" value={getMultiplier('all')} onChange={e => setMultiplier('all', parseFloat(e.target.value))} />
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', width: 36, textAlign: 'right' }}>{Math.round(getMultiplier('all') * 100)}%</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {showImportModal && <MenuImportModal restaurantId={restaurantId} onClose={() => setShowImportModal(false)} onImported={() => { setShowImportModal(false); fetchMenuItems(); }} />}
        {tourProps && <TourOverlay {...tourProps} />}
        <TourDataBanner />
      </>
    );
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="mi-root">
        <div className="mi-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vw,16px)' }}>
            <div className="mi-logo">Opti<span>Menu</span></div>
            <div style={{ display: 'flex', gap: 2 }}>
              {tabs.map(t => (
                <button key={t} className={`mi-tab${t === 'Menu Items' ? ' active' : ''}`}
                  onClick={() => guardEditNavigation(() => router.push(t === 'Dashboard' ? '/client/dashboard' : `/client/${t.toLowerCase().replace(' ', '-')}`))}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px,.7vw,12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'clamp(9px,.65vw,11px)', color: 'var(--accent)' }}>
              <div style={{ width: 4, height: 4, background: 'var(--accent)', borderRadius: '50%', animation: 'blink 2s infinite' }} />Active
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false} />
          </div>
        </div>

        <div className="mi-ph">
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="mi-ph-title">Menu Engineering</span>
            <span className="mi-ph-sub">· {menuItems.length} items</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px,1.2vw,20px)' }}>
            <div className="mi-ph-action-item"><div className="mi-ph-action-dot" style={{ background: 'var(--accent)' }} /><span className="mi-ph-action-val" style={{ color: 'var(--accent)' }}>{menuItems.length}</span><span>menu items</span></div>
            <div className="mi-ph-action-item"><div className="mi-ph-action-dot" style={{ background: avgMargin >= 60 ? 'var(--color-green)' : avgMargin >= 40 ? 'var(--accent)' : 'var(--color-amber)' }} /><span className="mi-ph-action-val" style={{ color: avgMargin >= 60 ? 'var(--color-green)' : avgMargin >= 40 ? 'var(--accent)' : 'var(--color-amber)' }}>{avgMargin.toFixed(1)}%</span><span>avg margin</span></div>
            <div className="mi-ph-action-item"><div className="mi-ph-action-dot" style={{ background: 'var(--color-red)' }} /><span className="mi-ph-action-val" style={{ color: 'var(--color-red)' }}>{belowTarget}</span><span>below target</span></div>
          </div>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 'clamp(10px,.8vw,13px)', color: 'var(--text-muted)' }}>Loading menu items...</div>
          </div>
        ) : (
          <div className="mi-body">
            <div className="mi-container">
              <div className="mi-container-hd">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div className="mi-container-title">Menu Items</div>
                  <div className="mi-container-count">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="mi-container-controls">
                  <input className="mi-search" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  <select className="mi-sort-sel" value={`${sortBy}-${sortOrder}`} onChange={handleSortChange}>
                    <option value="name-asc">Name (A–Z)</option>
                    <option value="name-desc">Name (Z–A)</option>
                    <option value="margin-desc">Margin (High–Low)</option>
                    <option value="margin-asc">Margin (Low–High)</option>
                    <option value="price-desc">Price (High–Low)</option>
                    <option value="cost-desc">Cost (High–Low)</option>
                  </select>
                  <div className="mi-view-toggle">
                    <button className={`mi-toggle-btn${displayMode === 'grid' ? ' active' : ''}`} onClick={() => setDisplayMode('grid')} title="Grid view">
                      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    </button>
                    <button className={`mi-toggle-btn${displayMode === 'list' ? ' active' : ''}`} onClick={() => setDisplayMode('list')} title="List view">
                      <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    </button>
                  </div>
                  <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
                  <button onClick={() => setShowImportModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid var(--accent)', borderRadius: 5, padding: 'clamp(3px,.3vh,5px) clamp(8px,.7vw,12px)', fontSize: 'clamp(10px,.75vw,13px)', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap', transition: 'all .2s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(2,164,186,.08)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Import Menu
                  </button>
                  <button className="mi-add-btn">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Item
                  </button>
                </div>
              </div>

              {displayMode === 'list' && (
                <div className="mi-list-head">
                  {[['name','Name'],['price','Price'],['cost','Cost'],['margin','Margin']].map(([col, label]) => (
                    <div key={col} className={`mi-list-th${sortBy === col ? ' active' : ''}`}
                      onClick={() => { if (sortBy === col) setSortOrder(o => o === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortOrder('asc'); } }}>
                      {label}{sortBy === col ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                    </div>
                  ))}
                </div>
              )}

              {displayMode === 'grid' ? (
                <div className="mi-grid-wrap">
                  {filtered.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
                      <div style={{ fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-faint)', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No menu items yet'}</div>
                      {!searchTerm && <button onClick={() => setShowImportModal(true)} style={{ background: 'rgba(2,164,186,.1)', border: '1px solid rgba(2,164,186,.3)', borderRadius: 8, padding: '10px 24px', fontSize: 13, color: 'var(--accent)', cursor: 'pointer', fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>↑ Import Your Menu</button>}
                    </div>
                  ) : <div className="mi-grid">{filtered.map(renderGridItem)}</div>}
                </div>
              ) : (
                <div className="mi-list-body">
                  {filtered.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-faint)' }}>{searchTerm ? `No results for "${searchTerm}"` : 'No menu items yet'}</div>
                  ) : filtered.map(renderListItem)}
                </div>
              )}
            </div>

            <div className="mi-detail">
              <div className="mi-detail-hd">
                <div className="mi-detail-hd-top">
                  <div className="mi-detail-title">{selectedItem && selectedItemData ? selectedItemData.item?.name : 'Menu Overview'}</div>
                  {selectedItem && <button className="mi-close-btn" onClick={() => guardEditNavigation(() => { setSelectedItem(null); setSelectedItemData(null); setDetailTab('details'); })}>✕ Close</button>}
                </div>
                <div className="mi-view-tabs">
                  {selectedItem ? (
                    <>
                      <button className={`mi-vtab${detailTab === 'details' ? ' active' : ''}`} onClick={() => guardEditNavigation(() => setDetailTab('details'))}>Details</button>
                      <button className={`mi-vtab${detailTab === 'optimize' ? ' active' : ''}`} onClick={() => guardEditNavigation(() => setDetailTab('optimize'))}>Optimize</button>
                      <button className={`mi-vtab${detailTab === 'edit' ? ' active' : ''}`}
                        onClick={() => { setDetailTab('edit'); initEditComponents(selectedItemData); fetchIngredientLibrary(); }}
                        style={{ color: detailTab === 'edit' ? 'var(--text-primary)' : 'var(--color-amber)' }}>Edit</button>
                    </>
                  ) : <button className="mi-vtab active" style={{ cursor: 'default' }}>Overview</button>}
                </div>
              </div>

              {!selectedItem && (
                <div className="mi-detail-body">
                  <div className="mi-ov-row">
                    <div className="mi-ov-w">
                      <div className="mi-ov-lbl"><svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Top Margin Items</div>
                      {topMargin.length > 0 ? topMargin.map(i => { const m = getMarginNum(i.price, i.cost); return <div key={i.id} className="mi-ov-item" style={{ cursor: 'pointer' }} onClick={() => selectItem(i.id)}><span className="mi-ov-name">{i.name}</span><span className="mi-ov-val" style={{ color: getMarginColor(m) }}>{m?.toFixed(1)}%</span></div>; }) : <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--text-muted)' }}>No data yet</div>}
                    </div>
                    <div className="mi-ov-w">
                      <div className="mi-ov-lbl"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Needs Attention</div>
                      {lowMargin.map(i => { const m = getMarginNum(i.price, i.cost); return <div key={i.id} className="mi-ov-item" style={{ cursor: 'pointer' }} onClick={() => selectItem(i.id)}><span className="mi-ov-name">{i.name}</span><span className="mi-ov-pill" style={{ background: 'rgba(192,64,64,.1)', color: 'var(--color-red)' }}>{m?.toFixed(1)}%</span></div>; })}
                      {noData.map(i => <div key={i.id} className="mi-ov-item" style={{ cursor: 'pointer' }} onClick={() => selectItem(i.id)}><span className="mi-ov-name">{i.name}</span><span className="mi-ov-pill" style={{ background: 'rgba(212,160,32,.1)', color: 'var(--color-amber)' }}>No cost</span></div>)}
                      {lowMargin.length === 0 && noData.length === 0 && <div style={{ fontSize: 'clamp(9px,.68vw,11px)', color: 'var(--color-green)' }}>All items on target ✓</div>}
                    </div>
                  </div>
                  <div className="mi-ov-wf">
                    <div className="mi-ov-lbl"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>Margin Distribution</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 'clamp(50px,7vh,80px)' }}>
                      {[{lo:0,hi:40,label:'<40%',c:'var(--color-red)'},{lo:40,hi:60,label:'40–60%',c:'var(--color-amber)'},{lo:60,hi:75,label:'60–75%',c:'var(--accent)'},{lo:75,hi:101,label:'>75%',c:'var(--color-green)'}].map(({ lo, hi, label, c }) => {
                        const count = bucket(lo, hi);
                        return (
                          <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%' }}>
                            <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}><div style={{ width: '100%', height: `${Math.max(5,(count/maxBucket)*100)}%`, background: c, opacity:.7, borderRadius:'2px 2px 0 0' }} /></div>
                            <div style={{ fontSize: 'clamp(7px,.58vw,9px)', color: 'var(--text-muted)', textAlign: 'center' }}>{label}</div>
                            <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: c, fontWeight: 600 }}>{count}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mi-hint">Click any menu item to view details and optimize the recipe →</div>
                </div>
              )}

              {selectedItem && (
                <div className="mi-detail-body">
                  {detailLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'clamp(10px,.75vw,12px)', fontFamily: "'Inter', sans-serif" }}>
                      <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                      Loading details...
                    </div>
                  ) : selectedItemData && detailTab === 'details' ? renderDetailsTab()
                    : selectedItemData && detailTab === 'optimize' ? renderOptimizeTab()
                    : selectedItemData && detailTab === 'edit' ? renderEditTab()
                    : null}
                </div>
              )}

              {showUnsavedModal && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, borderRadius: 8 }}>
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '28px', width: 'min(300px,90%)', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div>
                      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(15px,1.2vw,19px)', color: 'var(--text-primary)', marginBottom: 8 }}>Leave without saving?</div>
                      <div style={{ fontSize: 'clamp(11px,.82vw,13px)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: "'Inter', sans-serif" }}>Your unsaved changes will be lost.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowUnsavedModal(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 18px', fontSize: 'clamp(10px,.75vw,13px)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Stay</button>
                      <button onClick={() => { setShowUnsavedModal(false); setEditDirty(false); unsavedCallback?.(); }} style={{ background: 'var(--color-red)', border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 'clamp(10px,.75vw,13px)', color: '#fff', cursor: 'pointer', fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>Leave</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showImportModal && <MenuImportModal restaurantId={restaurantId} onClose={() => setShowImportModal(false)} onImported={() => { setShowImportModal(false); fetchMenuItems(); }} />}
      </div>
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
    </>
  );
}