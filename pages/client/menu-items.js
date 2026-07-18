// pages/client/menu-items.js
// "THE BOOK" — menu engineering, redesigned in the Ledger design language.
// Same dark room as the dashboard and analytics: quiet cards, dotted
// hairlines, Inter tabular numerals, one accent, green/red reserved for
// meaning (margin health). Card/list toggle preserved — cards by default.
// All data fetching, editing, optimizing, and import logic preserved.
import React, { useState, useEffect, useMemo } from 'react';
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
import ParseReviewModal from '../../components/ParseReviewModal';

const LOW_MARGIN_THRESHOLD = 60;

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
  if (margin >= 60) return 'var(--accent)';
  return 'var(--color-red)';
}

function getStatus(item) {
  const hasPrice = item.price && parseFloat(item.price) > 0;
  const hasCost = item.cost && parseFloat(item.cost) > 0;
  const hasIncomplete = hasIncompleteCosting(item);
  if (hasIncomplete) return { label: 'Incomplete', cls: 'cs-incomplete', color: 'var(--color-red)' };
  if (hasPrice && hasCost) return { label: 'Complete', cls: 'cs-complete', color: 'var(--color-green)' };
  return { label: 'Partial', cls: 'cs-partial', color: 'var(--color-amber)' };
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

// detail-panel section styles (ledger vocabulary)
const S = {
  wf: { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 9, padding: 'clamp(9px,.85vw,13px)', fontFamily: "'Inter', sans-serif" },
  wlbl: { fontSize: 'clamp(10px,.78vw,13px)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-.01em', marginBottom: 'clamp(7px,.7vh,11px)', display: 'flex', alignItems: 'center', gap: 8 },
  rule: { content: '', display: 'block', flex: 1, height: 1, background: 'var(--border)', maxWidth: 44 },
  pill: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: 'clamp(7px,.65vh,10px) clamp(9px,.75vw,12px)' },
  pillLbl: { fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-faint)', letterSpacing: '.03em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 5, fontFamily: "'Inter', sans-serif" },
  pillVal: { fontFamily: "'Inter', sans-serif", fontSize: 'clamp(12px,.95vw,15px)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' },
};
const Rule = () => <span style={S.rule} aria-hidden="true" />;

// ── MarginSpectrum: every dish is a dot on a 0–100% margin axis ──────────────
function MarginSpectrum({ items, onSelect, avgMargin }) {
  const dots = items
    .map(i => ({ id: i.id, name: i.name, m: getMarginNum(i.price, i.cost) }))
    .filter(d => d.m !== null)
    .map(d => ({ ...d, x: Math.max(0, Math.min(100, d.m)) }));
  if (!dots.length) return <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>No margin data yet — add prices and costs to see the spread.</div>;
  const avgX = Math.max(0, Math.min(100, avgMargin));
  return (
    <div>
      <div className="dp-spectrum">
        <div className="dp-spectrum-axis" />
        <div className="dp-spectrum-target" style={{ left: `${LOW_MARGIN_THRESHOLD}%` }} />
        {/* average marker */}
        <div style={{ position: 'absolute', left: `${avgX}%`, top: 0, transform: 'translateX(-50%)', fontSize: 8, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>avg ▾</div>
        {dots.map((d, i) => (
          <button key={d.id} type="button" className="dp-dot" title={`${d.name} — ${d.m.toFixed(1)}%`}
            onClick={() => onSelect(d.id)}
            style={{
              left: `${d.x}%`,
              top: `calc(50% + ${((i % 3) - 1) * 9}px)`,
              background: getMarginColor(d.m),
              opacity: 0.9,
            }} />
        ))}
      </div>
      <div className="dp-axis-cap"><span>0%</span><span>margin</span><span>100%</span></div>
    </div>
  );
}

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg-root); overflow: hidden; }
  #__next { height: 100%; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes rise { from{opacity:0;transform:translateY(7px);} to{opacity:1;transform:translateY(0);} }
  @keyframes growBar { from{transform:scaleX(0);} to{transform:scaleX(1);} }
  @media (prefers-reduced-motion: reduce){ *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;} }
  input::placeholder { color: var(--text-faint) !important; }
  select option { background: var(--bg-inset); color: var(--text-primary); }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  input[type=range] { -webkit-appearance: none; height: 4px; border-radius: 2px; background: var(--bg-inset); outline: none; cursor: pointer; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); cursor: pointer; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .mi-root { font-family: 'Inter', sans-serif; background: var(--bg-root); color: var(--text-primary); width: 100%; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

  /* ── TOP BAR (identical vocabulary to dashboard/analytics) ── */
  .mi-nav { background: var(--bg-elevated); border-bottom: 1px solid var(--border); height: clamp(40px,4.4vh,50px); padding: 0 clamp(16px,2vw,32px); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .mi-logo { font-family: 'Inter', sans-serif; font-weight: 700; font-size: clamp(15px,1.15vw,20px); letter-spacing: -.3px; color: var(--text-primary); }
  .mi-logo span { color: var(--accent); }
  .mi-tab { padding: 5px 12px; border-radius: 6px; font-size: clamp(10px,.78vw,13px); color: var(--text-muted); border: none; background: none; cursor: pointer; font-family: 'Inter', sans-serif; transition: color .15s, background .15s; }
  .mi-tab:hover { color: var(--text-secondary); }
  .mi-tab.active { color: var(--text-primary); background: var(--bg-inset); }

  /* ── PAGE HEADER ── */
  .mi-ph { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: clamp(10px,1.2vh,18px) clamp(16px,2vw,32px) clamp(6px,.7vh,10px); max-width: 1600px; width: 100%; margin: 0 auto; }
  .mi-ph-title { font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(16px,1.5vw,24px); letter-spacing: -.3px; color: var(--text-primary); line-height: 1.15; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .mi-chip { font-size: clamp(9px,.68vw,11px); font-weight: 700; padding: 2px 9px; border-radius: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
  .mi-chip.neutral { background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border); }
  .mi-chip.good { background: color-mix(in srgb, var(--color-green) 12%, transparent); color: var(--color-green); border: 1px solid color-mix(in srgb, var(--color-green) 25%, transparent); }
  .mi-chip.warn { background: color-mix(in srgb, var(--color-amber) 12%, transparent); color: var(--color-amber); border: 1px solid color-mix(in srgb, var(--color-amber) 25%, transparent); }
  .mi-chip.bad { background: color-mix(in srgb, var(--color-red) 12%, transparent); color: var(--color-red); border: 1px solid color-mix(in srgb, var(--color-red) 25%, transparent); }
  .mi-btn-p { display: flex; align-items: center; gap: 6px; background: var(--accent); border: none; border-radius: 7px; padding: clamp(5px,.55vh,8px) clamp(12px,1vw,18px); font-size: clamp(10px,.74vw,12px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: filter .15s; }
  .mi-btn-p:hover { filter: brightness(1.1); }
  .mi-btn-g { display: flex; align-items: center; gap: 6px; background: none; border: 1px solid var(--border); border-radius: 7px; padding: clamp(5px,.55vh,8px) clamp(12px,1vw,18px); font-size: clamp(10px,.74vw,12px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; white-space: nowrap; transition: color .15s, border-color .15s; }
  .mi-btn-g:hover { color: var(--text-primary); border-color: var(--text-faint); }

  /* ── BODY ── */
  .mi-body { display: flex; gap: clamp(10px,1.2vw,18px); padding: clamp(6px,.7vh,10px) clamp(16px,2vw,32px) clamp(10px,1.2vh,16px); flex: 1; min-height: 0; overflow: hidden; max-width: 1600px; width: 100%; margin: 0 auto; }
  .mi-container { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; min-width: 0; animation: rise .35s ease both; }
  .mi-container-hd { padding: clamp(9px,.9vh,14px) clamp(11px,1.1vw,17px); border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mi-container-title { font-size: clamp(11px,.85vw,14px); font-weight: 600; color: var(--text-primary); white-space: nowrap; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; }
  .mi-container-title::after { content: ''; display: block; width: clamp(20px,2.5vw,44px); height: 1px; background: var(--border); }
  .mi-container-count { font-size: clamp(9px,.65vw,11px); color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mi-container-controls { display: flex; align-items: center; gap: 7px; flex: 1; justify-content: flex-end; }
  .mi-search { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; padding: clamp(4px,.4vh,6px) clamp(9px,.8vw,13px); font-size: clamp(10px,.75vw,12px); color: var(--text-primary); width: clamp(120px,13vw,200px); outline: none; font-family: 'Inter', sans-serif; transition: border-color .15s; }
  .mi-search:focus { border-color: var(--accent); }
  .mi-sort-sel { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; padding: clamp(4px,.4vh,6px) clamp(7px,.6vw,11px); font-size: clamp(9px,.68vw,11px); color: var(--text-muted); font-family: 'Inter', sans-serif; outline: none; cursor: pointer; }
  .mi-view-toggle { display: flex; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 2px; gap: 2px; flex-shrink: 0; }
  .mi-toggle-btn { background: none; border: none; cursor: pointer; padding: clamp(3px,.35vh,5px) clamp(8px,.7vw,11px); color: var(--text-muted); border-radius: 4px; transition: color .15s, background .15s; display: flex; align-items: center; justify-content: center; }
  .mi-toggle-btn.active { background: var(--bg-inset); color: var(--text-primary); }
  .mi-toggle-btn svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

  /* ── CARDS (grid view — the default) ── */
  .mi-grid-wrap { flex: 1; overflow-y: auto; padding: clamp(9px,.9vw,14px); min-width: 0; }
  .mi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(180px,15vw,230px), 1fr)); gap: clamp(8px,.8vw,13px); }
  .mi-card { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; padding: clamp(11px,1.05vw,16px); cursor: pointer; transition: border-color .15s, transform .15s, background .15s; position: relative; min-width: 0; overflow: hidden; animation: rise .3s ease both; }
  .mi-card:hover { border-color: var(--text-faint); transform: translateY(-1px); }
  .mi-card.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 4%, var(--bg-elevated)); }
  .mi-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 3px; }
  .mi-card-name { font-size: clamp(12px,.95vw,15px); font-weight: 600; color: var(--text-primary); letter-spacing: -.01em; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; min-width: 0; }
  .mi-card-status { display: flex; align-items: center; gap: 4px; font-size: clamp(8px,.6vw,10px); font-weight: 600; color: var(--text-faint); flex-shrink: 0; padding-top: 2px; }
  .mi-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .mi-card-sub { font-size: clamp(8px,.64vw,10px); color: var(--text-faint); margin-bottom: clamp(9px,.9vh,14px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mi-card-nums { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: clamp(8px,.8vh,12px); }
  .mi-num-lbl { font-size: clamp(8px,.58vw,9px); color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; margin-bottom: 3px; }
  .mi-num-val { font-size: clamp(12px,.95vw,15px); font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.02em; color: var(--text-primary); }
  .mi-margin-bar { padding-top: clamp(8px,.8vh,11px); border-top: 1px dotted var(--border-subtle); }
  .mi-margin-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
  .mi-margin-lbl { font-size: clamp(8px,.58vw,9px); color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  .mi-margin-val { font-size: clamp(12px,.95vw,15px); font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .mi-track { background: var(--bg-inset); border-radius: 4px; height: clamp(5px,.5vh,7px); overflow: hidden; }
  .mi-fill { height: 100%; border-radius: 4px; transform-origin: left center; animation: growBar .5s cubic-bezier(.25,.8,.35,1) both; }
  .mi-est-badge { font-size: clamp(7px,.55vw,9px); font-weight: 700; padding: 1px 6px; border-radius: 8px; background: color-mix(in srgb, var(--color-amber) 12%, transparent); color: var(--color-amber); border: 1px solid color-mix(in srgb, var(--color-amber) 22%, transparent); white-space: nowrap; }

  /* ── LIST VIEW ── */
  .mi-list-head { display: grid; grid-template-columns: 2fr 1fr 1fr 1.4fr; gap: 8px; padding: clamp(7px,.7vh,11px) clamp(12px,1.2vw,18px); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .mi-list-th { font-size: clamp(8px,.62vw,10px); font-weight: 600; color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; cursor: pointer; display: flex; align-items: center; gap: 3px; user-select: none; transition: color .15s; }
  .mi-list-th:hover { color: var(--text-secondary); }
  .mi-list-th.active { color: var(--accent); }
  .mi-list-body { flex: 1; overflow-y: auto; }
  .mi-list-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1.4fr; gap: 8px; padding: clamp(8px,.8vh,12px) clamp(12px,1.2vw,18px); border-bottom: 1px dotted var(--border-subtle); cursor: pointer; transition: background .15s; align-items: center; border-left: 2px solid transparent; }
  .mi-list-row:hover { background: var(--bg-elevated); }
  .mi-list-row.selected { background: color-mix(in srgb, var(--accent) 5%, transparent); border-left-color: var(--accent); }
  .mi-list-td { font-size: clamp(10px,.76vw,13px); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mi-list-td.name { color: var(--text-primary); font-weight: 500; display: flex; align-items: center; gap: 7px; }
  .mi-list-td.num { font-weight: 600; color: var(--text-secondary); }
  .mi-list-margin { display: flex; align-items: center; gap: 8px; }
  .mi-list-margin-track { flex: 1; background: var(--bg-inset); border-radius: 3px; height: 5px; overflow: hidden; }
  .mi-list-margin-fill { height: 100%; border-radius: 3px; }
  .mi-list-margin-val { font-size: clamp(10px,.74vw,12px); font-weight: 700; flex-shrink: 0; width: 44px; text-align: right; font-variant-numeric: tabular-nums; }

  /* ── DETAIL PANEL ── */
  .mi-detail { width: clamp(320px,38vw,540px); background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; position: relative; animation: rise .35s ease both; animation-delay: .08s; }
  .mi-detail-hd { padding: clamp(9px,.9vh,14px) clamp(11px,1.1vw,17px); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .mi-detail-hd-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; gap: 8px; }
  .mi-detail-title { font-size: clamp(12px,1vw,16px); font-weight: 600; letter-spacing: -.01em; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .mi-close-btn { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; font-size: clamp(8px,.62vw,10px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: color .15s, border-color .15s; white-space: nowrap; flex-shrink: 0; }
  .mi-close-btn:hover { color: var(--text-primary); border-color: var(--text-faint); }
  .mi-view-tabs { display: flex; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 2px; gap: 2px; }
  .mi-vtab { flex: 1; padding: clamp(4px,.4vh,6px); border-radius: 4px; font-size: clamp(9px,.68vw,11px); font-weight: 600; cursor: pointer; border: none; font-family: 'Inter', sans-serif; color: var(--text-muted); background: transparent; text-align: center; transition: color .15s, background .15s; }
  .mi-vtab.active { background: var(--bg-inset); color: var(--text-primary); }
  .mi-detail-body { flex: 1; overflow-y: auto; padding: clamp(10px,1vw,15px); display: flex; flex-direction: column; gap: clamp(8px,.85vh,13px); font-family: 'Inter', sans-serif; }

  /* recipe components */
  .mi-comp { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; margin-bottom: 6px; }
  .mi-comp:last-child { margin-bottom: 0; }
  .mi-comp-hd { padding: clamp(7px,.7vh,10px) clamp(9px,.9vw,13px); display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background .15s; }
  .mi-comp-hd:hover { background: var(--bg-elevated); }
  .mi-comp-name { font-size: clamp(10px,.8vw,13px); font-weight: 600; color: var(--text-primary); }
  .mi-comp-sub { font-size: clamp(8px,.6vw,10px); color: var(--text-faint); margin-top: 1px; }
  .mi-comp-cost { font-size: clamp(10px,.8vw,13px); font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
  .mi-comp-pct { font-size: clamp(8px,.6vw,10px); color: var(--text-faint); margin-top: 1px; font-variant-numeric: tabular-nums; }
  .mi-comp-ings { background: var(--bg-elevated); border-top: 1px solid var(--border-subtle); padding: clamp(5px,.5vh,8px) clamp(9px,.9vw,13px); }
  .mi-comp-ing-row { display: flex; align-items: center; padding: clamp(4px,.45vh,7px) 0; border-bottom: 1px dotted var(--border-subtle); }
  .mi-comp-ing-row:last-child { border-bottom: none; }
  .mi-comp-ing-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-right: 7px; }
  .mi-comp-ing-name { font-size: clamp(9px,.7vw,11px); color: var(--text-primary); flex: 1; }
  .mi-comp-ing-qty { font-size: clamp(8px,.62vw,10px); color: var(--text-faint); margin: 0 8px; font-variant-numeric: tabular-nums; }
  .mi-comp-ing-cost { font-size: clamp(9px,.7vw,11px); font-weight: 600; color: var(--text-muted); font-variant-numeric: tabular-nums; }

  /* optimize tab */
  .mi-opt-compare { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px,.6vw,10px); }
  .mi-opt-card { border-radius: 8px; padding: clamp(9px,.85vw,13px); font-family: 'Inter', sans-serif; }
  .mi-opt-orig { background: var(--bg-surface); border: 1px solid var(--border-subtle); }
  .mi-opt-new { background: color-mix(in srgb, var(--color-green) 4%, var(--bg-surface)); border: 1px solid color-mix(in srgb, var(--color-green) 20%, transparent); }
  .mi-opt-card-title { font-size: clamp(8px,.62vw,10px); font-weight: 700; color: var(--text-faint); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }
  .mi-opt-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; }
  .mi-opt-row:last-child { margin-bottom: 0; padding-top: 7px; border-top: 1px dotted var(--border-subtle); }
  .mi-opt-label { font-size: clamp(9px,.7vw,11px); color: var(--text-muted); }
  .mi-opt-val { font-size: clamp(10px,.8vw,13px); font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .mi-opt-price-input { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 5px; padding: 3px 8px; font-size: clamp(9px,.7vw,11px); color: var(--text-primary); width: clamp(55px,5.5vw,80px); text-align: right; outline: none; font-family: 'Inter', sans-serif; font-variant-numeric: tabular-nums; }
  .mi-opt-price-input:focus { border-color: var(--accent); }
  .mi-opt-comp { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: clamp(9px,.85vw,13px); margin-bottom: 7px; font-family: 'Inter', sans-serif; }
  .mi-opt-comp:last-child { margin-bottom: 0; }
  .mi-opt-comp-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .mi-opt-comp-name { font-size: clamp(10px,.8vw,13px); font-weight: 600; color: var(--text-primary); }
  .mi-opt-cost { font-size: clamp(10px,.8vw,13px); font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
  .mi-opt-slider-wrap { display: flex; align-items: center; gap: 8px; }
  .mi-opt-slider-lbl { font-size: clamp(8px,.6vw,10px); color: var(--text-faint); flex-shrink: 0; width: clamp(50px,5vw,70px); }
  .mi-opt-pct { font-size: clamp(9px,.7vw,11px); font-weight: 700; color: var(--accent); width: 38px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .mi-opt-reset { background: none; border: 1px solid var(--border); border-radius: 5px; padding: 3px 9px; font-size: clamp(8px,.62vw,10px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: color .15s, border-color .15s; }
  .mi-opt-reset:hover { color: var(--text-primary); border-color: var(--text-faint); }

  /* edit tab */
  .mi-edit-input { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 5px; padding: 5px 8px; font-size: clamp(9px,.7vw,11px); color: var(--text-primary); width: 100%; outline: none; font-family: 'Inter', sans-serif; }
  .mi-edit-input:focus { border-color: var(--accent); }
  .mi-edit-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 3px; transition: color .15s; line-height: 1; }
  .mi-edit-del:hover { color: var(--color-red); }
  .mi-edit-add-ing { background: none; border: 1px dashed var(--border); border-radius: 5px; padding: 6px 10px; font-size: clamp(8px,.62vw,10px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; width: 100%; margin: 6px 0 4px; transition: color .15s, border-color .15s; }
  .mi-edit-add-ing:hover { border-color: var(--accent); color: var(--accent); }
  .mi-edit-add-comp { background: none; border: 1px dashed var(--border); border-radius: 8px; padding: 10px; font-size: clamp(9px,.7vw,11px); color: var(--text-muted); cursor: pointer; font-family: 'Inter', sans-serif; width: 100%; transition: color .15s, border-color .15s; text-align: center; }
  .mi-edit-add-comp:hover { border-color: var(--accent); color: var(--accent); }
  .mi-edit-save { background: var(--accent); border: none; border-radius: 7px; padding: clamp(8px,.8vh,11px) clamp(12px,1.1vw,18px); font-size: clamp(10px,.78vw,13px); font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; transition: filter .15s; width: 100%; margin-top: 4px; }
  .mi-edit-save:hover { filter: brightness(1.1); }
  .mi-edit-save:disabled { background: var(--border); color: var(--text-muted); cursor: not-allowed; filter: none; }
  .mi-ing-search-wrap { position: relative; }
  .mi-ing-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 50; background: var(--bg-inset); border: 1px solid var(--text-faint); border-radius: 6px; max-height: 140px; overflow-y: auto; margin-top: 2px; box-shadow: 0 8px 20px rgba(0,0,0,.4); }
  .mi-ing-option { padding: 6px 9px; font-size: clamp(9px,.7vw,11px); color: var(--text-primary); cursor: pointer; border-bottom: 1px solid var(--border); font-family: 'Inter', sans-serif; }
  .mi-ing-option:last-child { border-bottom: none; }
  .mi-ing-option:hover { background: var(--border); }
  .mi-ing-option-sub { font-size: clamp(7px,.58vw,9px); color: var(--text-muted); margin-top: 1px; }

  /* overview (no selection) */
  .mi-ov-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(7px,.7vw,11px); }
  .mi-ov-w { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 9px; padding: clamp(9px,.9vw,14px); }
  .mi-ov-wf { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 9px; padding: clamp(9px,.9vw,14px); }
  .mi-ov-lbl { font-size: clamp(10px,.78vw,13px); font-weight: 600; color: var(--text-primary); letter-spacing: -.01em; margin-bottom: clamp(7px,.7vh,11px); }
  .mi-ov-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: clamp(4px,.45vh,7px) 0; border-bottom: 1px dotted var(--border-subtle); cursor: pointer; }
  .mi-ov-item:last-child { border-bottom: none; }
  .mi-ov-name { font-size: clamp(9px,.72vw,12px); color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mi-ov-item:hover .mi-ov-name { color: var(--text-primary); }
  .mi-ov-val { font-size: clamp(9px,.72vw,12px); font-weight: 700; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .mi-hint { font-size: clamp(8px,.64vw,10px); color: var(--text-faint); text-align: center; padding: clamp(5px,.5vh,8px); border: 1px dashed var(--border); border-radius: 7px; }

  /* ── DETAIL PANEL v2: heroes, spectrum, plate split, ladder ── */
  .dp-hero { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; padding: clamp(11px,1.05vw,16px); display: flex; flex-direction: column; gap: clamp(8px,.8vh,12px); }
  .dp-hero.tinted { border-color: color-mix(in srgb, var(--accent) 18%, var(--border-subtle)); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 3.5%, var(--bg-elevated)) 0%, var(--bg-elevated) 55%); }
  .dp-lbl { font-size: clamp(8px,.6vw,10px); color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
  .dp-big { font-size: clamp(22px,2vw,32px); font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.03em; line-height: 1; }
  .dp-sub { font-size: clamp(9px,.68vw,11px); color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .dp-split { display: flex; height: clamp(13px,1.2vh,17px); border-radius: 8px; overflow: hidden; background: var(--bg-inset); }
  .dp-split div { transform-origin: left center; animation: growBar .55s cubic-bezier(.25,.8,.35,1) both; }
  .dp-split-legend { display: flex; justify-content: space-between; font-size: clamp(8px,.62vw,10px); color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .dp-spectrum { position: relative; height: clamp(44px,5vh,58px); margin-top: clamp(2px,.2vh,4px); }
  .dp-spectrum-axis { position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: var(--bg-inset); border-radius: 1px; }
  .dp-spectrum-target { position: absolute; top: 6px; bottom: 14px; width: 1px; background: var(--text-faint); opacity: .8; }
  .dp-spectrum-target::after { content: 'target 60%'; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); font-size: 8px; color: var(--text-faint); padding-top: 2px; white-space: nowrap; }
  .dp-dot { position: absolute; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%,-50%); cursor: pointer; border: 1.5px solid var(--bg-elevated); transition: transform .12s; padding: 0; }
  .dp-dot:hover { transform: translate(-50%,-50%) scale(1.6); z-index: 2; }
  .dp-axis-cap { display: flex; justify-content: space-between; font-size: clamp(7px,.55vw,9px); color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .dp-stack { display: flex; height: clamp(9px,.9vh,12px); border-radius: 6px; overflow: hidden; background: var(--bg-inset); margin-bottom: clamp(7px,.7vh,10px); }
  .dp-stack div { transform-origin: left center; animation: growBar .55s cubic-bezier(.25,.8,.35,1) both; }
  .dp-ladder-row { display: flex; align-items: baseline; gap: 10px; padding: clamp(6px,.55vh,9px) clamp(8px,.75vw,11px); border-radius: 8px; border: 1px solid transparent; }
  .dp-ladder-row.current { border-color: color-mix(in srgb, var(--accent) 35%, transparent); background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .dp-ladder-name { flex: 1; font-size: clamp(9px,.7vw,11px); color: var(--text-muted); }
  .dp-ladder-row.current .dp-ladder-name { color: var(--accent); font-weight: 600; }
  .dp-ladder-val { font-size: clamp(11px,.85vw,14px); font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .dp-ladder-delta { font-size: clamp(8px,.6vw,10px); color: var(--text-faint); font-variant-numeric: tabular-nums; width: 64px; text-align: right; }
  .dp-delta-chip { font-size: clamp(10px,.74vw,12px); font-weight: 700; padding: 3px 10px; border-radius: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dp-delta-chip.up { background: color-mix(in srgb, var(--color-green) 12%, transparent); color: var(--color-green); border: 1px solid color-mix(in srgb, var(--color-green) 25%, transparent); }
  .dp-delta-chip.dn { background: color-mix(in srgb, var(--color-red) 12%, transparent); color: var(--color-red); border: 1px solid color-mix(in srgb, var(--color-red) 25%, transparent); }
  .dp-delta-chip.flat { background: var(--bg-inset); color: var(--text-muted); border: 1px solid var(--border-subtle); }

  .cs-complete { color: var(--color-green); }
  .cs-incomplete { color: var(--color-red); }
  .cs-partial { color: var(--color-amber); }
`;

// single-hue ramp for component cost shares — rank = intensity, no rainbow
const compShade = (i) => `color-mix(in srgb, var(--accent) ${Math.max(18, 85 - i * 16)}%, var(--bg-inset))`;

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
  const [displayMode, setDisplayMode] = useState('grid'); // cards are the default
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
  const [reviewData, setReviewData] = useState(null); // { dishes, ingredientLibrary }

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
  }, [router]);

  const { tourProps } = useTour('menu-items', restaurantId);

  useEffect(() => {
    if (!router.isReady || !isTour) return;
    fetchSampleData().then(sample => { if (sample) { setMenuItems(sample.menuItems); setLoading(false); } });
  }, [router.isReady, isTour]);

  useEffect(() => {
    if (selectedItemData && detailTab === 'edit') initEditComponents(selectedItemData);
  }, [selectedItemData]);

  async function init() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/client/login'); return; }
      setUserEmail(user.email || '');
      const { data: profile } = await supabase.from('profiles').select('restaurant_id, full_name').eq('id', user.id).single();
      if (!profile?.restaurant_id) { setLoading(false); return; }
      setRestaurantId(profile.restaurant_id);
      setUserName(profile.full_name ? profile.full_name.trim().split(' ')[0] : 'User');
    } catch (err) {
      console.error('[menu-items] init error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMenuItems() {
    setLoading(true);
    const { data } = await supabase.from('menu_items').select(`
      *, menu_item_ingredients(quantity, ingredients(id, name, unit, last_price)),
      menu_item_components(id, name, cost, component_ingredients(id, quantity, unit, ingredients:ingredient_id(id, name, last_price, unit, last_ordered_at, is_estimated)))
    `).eq('restaurant_id', restaurantId).order('name').limit(500);
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
        if (unitCost > 0) { try { const calc = typeof calculateStandardizedCost === 'function' ? calculateStandardizedCost(ci.quantity, ci.unit, unitCost, ing?.unit) : null; totalCost = (calc !== null && calc !== undefined && !isNaN(calc)) ? calc : 0; } catch { totalCost = 0; } }
        return { id: ci.id, ingredientId: ing?.id, name: ing?.name || 'Unknown', quantity: ci.quantity, unit: ci.unit, unitCost, standardUnit: ing?.unit || 'unit', totalCost, hasPrice: unitCost > 0, isEstimated: ing?.is_estimated === true };
      });
      const calculatedCost = processedIngs.reduce((s, i) => s + i.totalCost, 0);
      return { id: c.id, name: c.name, storedCost: c.cost || 0, calculatedCost: calculatedCost, ingredients: processedIngs, ingredientCount: processedIngs.length };
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

  const filtered = useMemo(() =>
    menuItems
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
      }),
  [menuItems, searchTerm, sortBy, sortOrder]);

  const { itemsWithMargins, avgMargin, belowTarget, lowMargin, topMargin, noData, bucket, maxBucket } = useMemo(() => {
    const itemsWithMargins = menuItems.filter(i => getMarginNum(i.price, i.cost) !== null);
    const avgMargin = itemsWithMargins.length > 0 ? itemsWithMargins.reduce((s, i) => s + getMarginNum(i.price, i.cost), 0) / itemsWithMargins.length : 0;
    const belowTarget = itemsWithMargins.filter(i => getMarginNum(i.price, i.cost) < LOW_MARGIN_THRESHOLD).length;
    const lowMargin = itemsWithMargins.filter(i => getMarginNum(i.price, i.cost) < LOW_MARGIN_THRESHOLD).slice(0, 3);
    const topMargin = [...itemsWithMargins].sort((a, b) => getMarginNum(b.price, b.cost) - getMarginNum(a.price, a.cost)).slice(0, 5);
    const noData = menuItems.filter(i => !i.price || !i.cost).slice(0, 2);
    const bucket = (lo, hi) => itemsWithMargins.filter(i => { const m = getMarginNum(i.price, i.cost); return m >= lo && m < hi; }).length;
    const maxBucket = Math.max(bucket(0, 40), bucket(40, 60), bucket(60, 75), bucket(75, 100), 1);
    return { itemsWithMargins, avgMargin, belowTarget, lowMargin, topMargin, noData, bucket, maxBucket };
  }, [menuItems]);

  function getMultiplier(id) { return multipliers[id] ?? 1.0; }
  function setMultiplier(id, val) { setMultipliers(prev => ({ ...prev, [id]: Math.max(0, Math.min(2, val)) })); }

  const { totalCost, profitMargin, optimizedCost, effectivePrice, optimizedMargin } = useMemo(() => {
    const totalCost = selectedItemData
      ? selectedItemData.components.length > 0
        ? (() => {
          const compSum = selectedItemData.components.reduce((s, c) => s + (c.calculatedCost || c.storedCost || 0), 0);
          const stored = parseFloat(selectedItemData.item?.cost || 0);
          return (stored > 0 && compSum > stored * 3) ? stored : compSum;
        })()
        : selectedItemData.ingredients.length > 0
          ? selectedItemData.ingredients.reduce((s, i) => s + (parseFloat(i.ingredients?.last_price || 0) * parseFloat(i.quantity || 0)), 0)
          : parseFloat(selectedItemData.item?.cost || 0)
      : 0;
    const profitMargin = selectedItemData ? getMarginNum(selectedItemData.item?.price, totalCost) : null;
    const optimizedCost = selectedItemData
      ? selectedItemData.components.length > 0
        ? selectedItemData.components.reduce((s, c) => s + (c.calculatedCost || c.storedCost || 0) * (multipliers[c.id] ?? 1.0), 0)
        : totalCost * (multipliers['all'] ?? 1.0)
      : 0;
    const effectivePrice = parseFloat(optimizedPrice ?? selectedItemData?.item?.price ?? 0);
    const optimizedMargin = effectivePrice > 0 ? ((effectivePrice - optimizedCost) / effectivePrice) * 100 : null;
    return { totalCost, profitMargin, optimizedCost, effectivePrice, optimizedMargin };
  }, [selectedItemData, multipliers, optimizedPrice]);

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

    function calcIngCost(ing) {
      const unitCost = parseFloat(ing.unitCost || 0);
      if (unitCost === 0) return 0;
      try {
        const calc = typeof calculateStandardizedCost === 'function'
          ? calculateStandardizedCost(ing.quantity, ing.unit, unitCost, ing.standardUnit || ing.unit)
          : null;
        return (calc !== null && calc !== undefined && !isNaN(calc)) ? calc : parseFloat(ing.quantity || 0) * unitCost;
      } catch { return parseFloat(ing.quantity || 0) * unitCost; }
    }

    // ── Step 1: Validate everything before writing anything ──────────────────
    const validationErrors = [];
    for (const comp of editComponents) {
      if (!comp.name?.trim()) validationErrors.push(`A component is missing a name`);
      for (const ing of comp.ingredients) {
        if (!ing.ingredientId) validationErrors.push(`"${ing.name || 'Unnamed ingredient'}" has no ingredient selected`);
      }
    }
    if (validationErrors.length > 0) {
      setEditSaveMsg({ type: 'error', text: validationErrors[0] });
      setEditSaving(false);
      return;
    }

    try {
      // ── Step 2: Write components and ingredients — stop immediately on any failure ──
      for (const comp of editComponents) {
        let componentId = comp.id;
        const compCost = comp.ingredients.reduce((s, i) => s + calcIngCost(i), 0);

        if (comp.isNew) {
          const { data: newComp, error } = await supabase
            .from('menu_item_components')
            .insert({ menu_item_id: menuItemId, name: comp.name, cost: Math.round(compCost * 10000) / 10000 })
            .select('id')
            .single();
          if (error) throw new Error(`Failed to create component "${comp.name}": ${error.message}`);
          componentId = newComp.id;
        } else {
          const { error } = await supabase
            .from('menu_item_components')
            .update({ name: comp.name, cost: Math.round(compCost * 10000) / 10000 })
            .eq('id', componentId);
          if (error) throw new Error(`Failed to update component "${comp.name}": ${error.message}`);
        }

        for (const ing of comp.ingredients) {
          // Update ingredient last_price if real (non-estimated) cost provided
          if (!ing.isEstimated && ing.unitCost > 0) {
            const { error } = await supabase
              .from('ingredients')
              .update({ last_price: ing.unitCost, is_estimated: false })
              .eq('id', ing.ingredientId);
            if (error) throw new Error(`Failed to update price for "${ing.name}": ${error.message}`);
          }

          if (ing.isNew) {
            const { error } = await supabase
              .from('component_ingredients')
              .insert({ component_id: componentId, ingredient_id: ing.ingredientId, quantity: parseFloat(ing.quantity || 0), unit: ing.unit });
            if (error) throw new Error(`Failed to add ingredient "${ing.name}": ${error.message}`);
          } else {
            const { error } = await supabase
              .from('component_ingredients')
              .update({ quantity: parseFloat(ing.quantity || 0), unit: ing.unit })
              .eq('id', ing.ciId);
            if (error) throw new Error(`Failed to update ingredient "${ing.name}": ${error.message}`);
          }
        }
      }

      // ── Step 3: Update menu item total cost using calcIngCost consistently ──
      const newTotalCost = editComponents.reduce((s, c) =>
        s + c.ingredients.reduce((ss, i) => ss + calcIngCost(i), 0), 0);

      const { error: costError } = await supabase
        .from('menu_items')
        .update({ cost: Math.round(newTotalCost * 100) / 100 })
        .eq('id', menuItemId);
      if (costError) throw new Error(`Failed to update menu item cost: ${costError.message}`);

      // ── Step 4: Success ──────────────────────────────────────────────────────
      setEditSaveMsg({ type: 'success', text: 'Saved successfully' });
      setEditDirty(false);
      await fetchItemDetail(menuItemId);
      await fetchMenuItems();

    } catch (err) {
      console.error('[saveItemEdits]', err);
      setEditSaveMsg({ type: 'error', text: err.message || 'An unexpected error occurred. Please try again.' });
    } finally {
      setEditSaving(false);
    }
  }

  // ── Detail tab renderers (desktop) ───────────────────────────────────────

  function renderDetailsTab() {
    if (!selectedItemData) return null;
    const inc = getIncompleteIngredients(selectedItemData);
    const price = parseFloat(selectedItemData.item?.price || 0);
    const profit = price - totalCost;
    const mc = getMarginColor(profitMargin);
    const costPct = price > 0 ? Math.max(0, Math.min(100, (totalCost / price) * 100)) : 0;
    const isEst = hasEstimatedCosts(selectedItemData.item);
    const ingCount = getIngredientCount(menuItems.find(i => i.id === selectedItem) || {});
    // pricing ladder: cost-target prices with the current price slotted in place
    const ladder = totalCost > 0 ? [
      { label: 'Premium · 20% food cost', value: totalCost / 0.20 },
      { label: 'Recommended · 25% food cost', value: totalCost / 0.25 },
      { label: 'Break-even · 30% food cost', value: totalCost / 0.30 },
      ...(price > 0 ? [{ label: 'Current menu price', value: price, current: true }] : []),
    ].sort((a, b) => b.value - a.value) : [];
    return (
      <>
        {/* THE PLATE: what one sale of this dish is worth */}
        <div className="dp-hero tinted">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div className="dp-lbl">Menu price</div>
              <div className="dp-big" style={{ color: 'var(--text-primary)' }}>{price > 0 ? formatCurrency(price) : '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="dp-lbl">Margin{isEst && <span style={{ color: 'var(--color-amber)', textTransform: 'none' }}> ~est</span>}</div>
              <div className="dp-big" style={{ color: mc }}>{profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—'}</div>
            </div>
          </div>
          {price > 0 && totalCost > 0 ? (
            <>
              <div className="dp-split" role="img" aria-label="Cost vs profit share of the menu price">
                <div title={`Cost ${formatCurrency(totalCost)}`} style={{ width: `${costPct}%`, background: 'var(--bg-inset)', borderRight: '1px solid var(--border)' }} />
                <div title={`Profit ${formatCurrency(profit)}`} style={{ width: `${100 - costPct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${mc} 55%, transparent), ${mc})` }} />
              </div>
              <div className="dp-split-legend">
                <span>Cost <strong style={{ color: 'var(--text-secondary)' }}>{formatCurrency(totalCost)}</strong></span>
                <span>Profit <strong style={{ color: mc }}>{formatCurrency(profit)}</strong> / plate</span>
              </div>
            </>
          ) : (
            <div className="dp-sub">{price === 0 ? 'No menu price on file yet.' : 'No cost data yet — build the recipe to see plate economics.'}</div>
          )}
          <div className="dp-sub" style={{ color: 'var(--text-faint)' }}>{ingCount} ingredient{ingCount !== 1 ? 's' : ''} in the recipe</div>
        </div>

        {/* PRICING LADDER: where the current price sits among the targets */}
        {ladder.length > 0 && (
          <div style={S.wf}>
            <div style={S.wlbl}>Pricing Ladder<Rule /></div>
            {ladder.map((r) => (
              <div key={r.label} className={`dp-ladder-row${r.current ? ' current' : ''}`}>
                <span className="dp-ladder-name">{r.label}</span>
                <span className="dp-ladder-val">{formatCurrency(r.value)}</span>
                <span className="dp-ladder-delta">{r.current ? '● here' : price > 0 ? `${r.value >= price ? '+' : '−'}${formatCurrency(Math.abs(r.value - price)).replace('$', '$')}` : ''}</span>
              </div>
            ))}
          </div>
        )}
        {selectedItemData.components.length > 0 && (
          <div style={S.wf}>
            <div style={S.wlbl}>Where the Cost Goes<Rule /></div>
            {totalCost > 0 && (
              <div className="dp-stack" role="img" aria-label="Component share of total cost">
                {[...selectedItemData.components]
                  .sort((a, b) => (b.calculatedCost || b.storedCost || 0) - (a.calculatedCost || a.storedCost || 0))
                  .map((c, i) => {
                    const cc = c.calculatedCost || c.storedCost || 0;
                    return <div key={c.id} title={`${c.name} — ${((cc / totalCost) * 100).toFixed(0)}%`} style={{ width: `${Math.max(1, (cc / totalCost) * 100)}%`, background: compShade(i), animationDelay: `${i * 0.06}s` }} />;
                  })}
              </div>
            )}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 9, paddingTop: 9, borderTop: '1px dotted var(--border-subtle)' }}>
              <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-muted)' }}>Total Food Cost</div>
              <div style={{ fontSize: 'clamp(13px,1.1vw,17px)', fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalCost)}</div>
            </div>
          </div>
        )}
        {selectedItemData.costHistory.length > 0 && (
          <div style={S.wf}>
            <div style={S.wlbl}>Cost Change History<Rule /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'clamp(55px,5vw,70px) 1fr 1fr 1fr', gap: 5, padding: '0 clamp(8px,.7vw,10px) clamp(5px,.5vh,7px)', marginBottom: 2 }}>
              {['Date','Previous','New','Change'].map(h => <div key={h} style={{ fontSize: 'clamp(8px,.58vw,9px)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</div>)}
            </div>
            {selectedItemData.costHistory.slice(0, 6).map(r => {
              const change = parseFloat(r.new_cost || 0) - parseFloat(r.old_cost || 0);
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'clamp(55px,5vw,70px) 1fr 1fr 1fr', gap: 5, padding: 'clamp(5px,.5vh,8px) clamp(8px,.7vw,10px)', borderTop: '1px dotted var(--border-subtle)', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-faint)' }}>{formatDate(r.created_at)}</div>
                  <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-muted)' }}>{formatCurrency(r.old_cost)}</div>
                  <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-primary)' }}>{formatCurrency(r.new_cost)}</div>
                  <div style={{ fontSize: 'clamp(9px,.7vw,11px)', fontWeight: 700, color: change > 0 ? 'var(--color-red)' : 'var(--color-green)' }}>{change > 0 ? '+' : ''}{formatCurrency(change)}</div>
                </div>
              );
            })}
          </div>
        )}
        {inc.length > 0 && (
          <div style={{ ...S.wf, borderColor: 'color-mix(in srgb, var(--color-red) 20%, transparent)' }}>
            <div style={{ ...S.wlbl, color: 'var(--color-red)' }}>Why Incomplete?<Rule /></div>
            <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-muted)', marginBottom: 8 }}>{inc.length} ingredient{inc.length !== 1 ? 's are' : ' is'} missing a price.</div>
            {inc.map((ing, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 'clamp(4px,.4vh,6px) 0', borderBottom: '1px dotted var(--border-subtle)' }}>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ing.name}</div>{ing.component && <div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-faint)' }}>in {ing.component}</div>}</div>
                <span style={{ fontSize: 'clamp(8px,.58vw,9px)', padding: '1px 7px', borderRadius: 8, background: 'color-mix(in srgb, var(--color-red) 10%, transparent)', color: 'var(--color-red)', whiteSpace: 'nowrap', flexShrink: 0 }}>{ing.reason}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  function renderOptimizeTab() {
    if (!selectedItemData) return null;
    const delta = optimizedMargin !== null && profitMargin !== null ? optimizedMargin - profitMargin : null;
    const deltaCls = delta === null || Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'dn';
    return (
      <>
        {/* OUTCOME: the scenario's margin, front and center */}
        <div className="dp-hero tinted">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div className="dp-lbl">Scenario margin</div>
              <div className="dp-big" style={{ color: getMarginColor(optimizedMargin) }}>{optimizedMargin !== null ? `${optimizedMargin.toFixed(1)}%` : '—'}</div>
            </div>
            <span className={`dp-delta-chip ${deltaCls}`}>
              {delta === null ? '—' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} pts`}
            </span>
          </div>
          <div className="dp-sub">
            Cost {formatCurrency(totalCost)} → <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(optimizedCost)}</strong>
            {'  ·  '}Price {formatCurrency(selectedItemData.item?.price)} → <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(effectivePrice)}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 8, borderTop: '1px dotted var(--border-subtle)' }}>
            <span className="dp-lbl" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 'clamp(9px,.7vw,11px)' }}>Try a new menu price</span>
            <input className="mi-opt-price-input" type="number" step="0.01" min="0"
              value={optimizedPrice ?? selectedItemData.item?.price ?? ''}
              onChange={e => setOptimizedPrice(parseFloat(e.target.value) || null)} />
          </div>
        </div>
        <div style={S.wf}>
          <div style={{ ...S.wlbl, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Adjust Portions<Rule /></span>
            <button className="mi-opt-reset" onClick={() => { setMultipliers({}); setOptimizedPrice(null); }}>Reset</button>
          </div>
          {selectedItemData.components.length > 0 ? selectedItemData.components.map(c => {
            const m = getMultiplier(c.id);
            return (
              <div key={c.id} className="mi-opt-comp">
                <div className="mi-opt-comp-hd"><div><div className="mi-opt-comp-name">{c.name}</div><div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-faint)' }}>{c.ingredientCount} ingredients</div></div><div className="mi-opt-cost">{formatCurrency((c.calculatedCost || c.storedCost || 0) * m)}</div></div>
                <div className="mi-opt-slider-wrap">
                  <div className="mi-opt-slider-lbl">Portion</div>
                  <input type="range" style={{ flex: 1, background: `linear-gradient(to right,var(--accent) 0%,var(--accent) ${m * 50}%,var(--bg-inset) ${m * 50}%,var(--bg-inset) 100%)` }} min="0" max="2" step="0.01" value={m} onChange={e => setMultiplier(c.id, parseFloat(e.target.value))} />
                  <div className="mi-opt-pct">{Math.round(m * 100)}%</div>
                </div>
              </div>
            );
          }) : (
            <div className="mi-opt-comp">
              <div className="mi-opt-comp-hd"><div><div className="mi-opt-comp-name">Recipe Portion</div><div style={{ fontSize: 'clamp(8px,.6vw,10px)', color: 'var(--text-faint)' }}>{selectedItemData.ingredients.length} ingredients</div></div><div className="mi-opt-cost">{formatCurrency(totalCost * getMultiplier('all'))}</div></div>
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
          <div style={S.wlbl}>Components<Rule /></div>
          {editComponents.length === 0 && <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-muted)', padding: '4px 0' }}>No components yet. Add one below.</div>}
          {editComponents.map((comp, compIdx) => {
            const compCost = comp.ingredients.reduce((s, i) => s + (parseFloat(i.quantity || 0) * parseFloat(i.unitCost || 0)), 0);
            const isExpanded = editingCompIdx === compIdx;
            return (
              <div key={comp.id} style={{ marginBottom: 6 }}>
                <div onClick={() => setEditingCompIdx(isExpanded ? null : compIdx)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'clamp(8px,.75vh,11px) clamp(9px,.8vw,13px)', background: 'var(--bg-surface)', border: `1px solid ${isExpanded ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: isExpanded ? '8px 8px 0 0' : 8, cursor: 'pointer', transition: 'border-color .15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 'clamp(10px,.8vw,13px)', fontWeight: 600, color: isExpanded ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comp.name || 'Unnamed'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-faint)' }}>{comp.ingredients.length} ing.</span>
                    <span style={{ fontSize: 'clamp(9px,.7vw,11px)', fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(compCost)}</span>
                    <span style={{ fontSize: 10, color: isExpanded ? 'var(--accent)' : 'var(--text-muted)' }}>{isExpanded ? '▴' : '▾'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 'clamp(9px,.85vw,13px)', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <div>
                      <div style={{ fontSize: 'clamp(8px,.58vw,9px)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 4 }}>Component Name</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="mi-edit-input" style={{ flex: 1 }} value={comp.name} onChange={e => updateEditComponentName(compIdx, e.target.value)} />
                        <button onClick={() => { removeEditComponent(compIdx); setEditingCompIdx(null); }} style={{ background: 'color-mix(in srgb, var(--color-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-red) 20%, transparent)', borderRadius: 5, padding: '4px 11px', fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--color-red)', cursor: 'pointer', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap' }}>Remove</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 62px 48px auto', gap: 5 }}>
                      {['Ingredient','Qty','Unit','Cost',''].map(h => <div key={h} style={{ fontSize: 'clamp(8px,.55vw,9px)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>{h}</div>)}
                    </div>
                    {comp.ingredients.length === 0 && <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-muted)', fontStyle: 'italic' }}>No ingredients. Add one below.</div>}
                    {comp.ingredients.map((ing, ingIdx) => {
                      const key = `${compIdx}-${ingIdx}`;
                      const searchVal = ingSearch[key] ?? ing.name;
                      const isOpen = ingDropdownOpen[key] || false;
                      const filteredLib = ingredientLibrary.filter(lib => lib.name.toLowerCase().includes((ingSearch[key] || '').toLowerCase())).slice(0, 8);
                      const ingCost = parseFloat(ing.quantity || 0) * parseFloat(ing.unitCost || 0);
                      return (
                        <div key={ing.ciId} style={{ display: 'grid', gridTemplateColumns: '1fr 62px 62px 48px auto', gap: 5, alignItems: 'center' }}>
                          <div className="mi-ing-search-wrap">
                            <input className="mi-edit-input" value={searchVal} style={{ borderColor: ing.isEstimated ? 'color-mix(in srgb, var(--color-amber) 35%, transparent)' : 'var(--border)' }} placeholder="Search..." onChange={e => { setIngSearch(prev => ({ ...prev, [key]: e.target.value })); setIngDropdownOpen(prev => ({ ...prev, [key]: true })); }} onFocus={() => setIngDropdownOpen(prev => ({ ...prev, [key]: true }))} onBlur={() => setTimeout(() => setIngDropdownOpen(prev => ({ ...prev, [key]: false })), 150)} />
                            {isOpen && filteredLib.length > 0 && (
                              <div className="mi-ing-dropdown">
                                {filteredLib.map(lib => <div key={lib.id} className="mi-ing-option" onMouseDown={() => selectLibraryIngredient(compIdx, ingIdx, lib)}>{lib.name}<div className="mi-ing-option-sub">{lib.unit} · {lib.last_price ? formatCurrency(lib.last_price) : 'no price'}{lib.is_estimated ? ' ~est' : ''}</div></div>)}
                              </div>
                            )}
                          </div>
                          <input className="mi-edit-input" type="number" min="0" step="0.01" value={ing.quantity} onChange={e => updateEditIngredient(compIdx, ingIdx, 'quantity', e.target.value)} />
                          <input className="mi-edit-input" value={ing.unit} onChange={e => updateEditIngredient(compIdx, ingIdx, 'unit', e.target.value)} />
                          <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(ingCost)}</div>
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
        {editSaveMsg && <div style={{ fontSize: 'clamp(9px,.7vw,11px)', padding: '8px 10px', borderRadius: 7, textAlign: 'center', background: editSaveMsg.type === 'success' ? 'color-mix(in srgb, var(--color-green) 10%, transparent)' : 'color-mix(in srgb, var(--color-red) 10%, transparent)', color: editSaveMsg.type === 'success' ? 'var(--color-green)' : 'var(--color-red)', border: `1px solid ${editSaveMsg.type === 'success' ? 'color-mix(in srgb, var(--color-green) 20%, transparent)' : 'color-mix(in srgb, var(--color-red) 20%, transparent)'}` }}>{editSaveMsg.text}</div>}
        <button className="mi-edit-save" onClick={saveItemEdits} disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</button>
      </>
    );
  }

  // ── Card + list renderers ────────────────────────────────────────────────

  function renderGridItem(item, idx) {
    const margin = getMarginNum(item.price, item.cost);
    const mc = getMarginColor(margin);
    const status = getStatus(item);
    const ingCount = getIngredientCount(item);
    const isSelected = selectedItem === item.id;
    return (
      <div key={item.id} className={`mi-card${isSelected ? ' selected' : ''}`} style={{ animationDelay: `${Math.min(idx * 0.02, 0.3)}s` }} onClick={() => guardEditNavigation(() => selectItem(item.id))}>
        <div className="mi-card-top">
          <div className="mi-card-name">{item.name || 'Unnamed'}</div>
          <div className="mi-card-status" title={status.label}>
            <span className="mi-status-dot" style={{ background: status.color }} />{status.label}
          </div>
        </div>
        <div className="mi-card-sub">
          {item.category && item.category !== 'uncategorized' ? `${item.category} · ` : ''}{ingCount} ingredient{ingCount !== 1 ? 's' : ''}
          {hasEstimatedCosts(item) && <span className="mi-est-badge" style={{ marginLeft: 6 }}>~est</span>}
        </div>
        <div className="mi-card-nums">
          <div><div className="mi-num-lbl">Price</div><div className="mi-num-val">{item.price ? formatCurrency(item.price) : <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>—</span>}</div></div>
          <div style={{ textAlign: 'right' }}><div className="mi-num-lbl">Cost</div><div className="mi-num-val" style={{ color: 'var(--text-secondary)' }}>{item.cost ? formatCurrency(item.cost) : <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>—</span>}</div></div>
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
    const status = getStatus(item);
    const isSelected = selectedItem === item.id;
    return (
      <div key={item.id} className={`mi-list-row${isSelected ? ' selected' : ''}`} onClick={() => guardEditNavigation(() => selectItem(item.id))}>
        <div className="mi-list-td name">
          <span className="mi-status-dot" style={{ background: status.color, flexShrink: 0 }} title={status.label} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || 'Unnamed'}</span>
          {hasEstimatedCosts(item) && <span className="mi-est-badge" style={{ flexShrink: 0 }}>~est</span>}
        </div>
        <div className="mi-list-td num" style={{ color: item.price ? 'var(--text-primary)' : 'var(--text-faint)' }}>{item.price ? formatCurrency(item.price) : '—'}</div>
        <div className="mi-list-td num" style={{ color: item.cost ? 'var(--text-secondary)' : 'var(--text-faint)' }}>{item.cost ? formatCurrency(item.cost) : '—'}</div>
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
          .mob2-root { font-family:'Inter',sans-serif; background:var(--bg-root); color:var(--text-primary); width:100%; height:100dvh; display:flex; flex-direction:column; overflow:hidden; }
          .mob2-header { background:var(--bg-elevated); border-bottom:1px solid var(--border); padding:10px 16px; padding-top:max(10px,env(safe-area-inset-top)); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
          .mob2-logo { font-family:'Inter',sans-serif; font-size:18px; font-weight:700; color:var(--text-primary); letter-spacing:-.3px; }
          .mob2-logo span { color:var(--accent); }
          .mob2-subbar { background:var(--bg-surface); border-bottom:1px solid var(--border); padding:10px 16px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
          .mob2-tabs { background:var(--bg-elevated); border-bottom:1px solid var(--border); display:flex; overflow-x:auto; flex-shrink:0; -webkit-overflow-scrolling:touch; }
          .mob2-tabs::-webkit-scrollbar { display:none; }
          .mob2-tab { flex-shrink:0; padding:10px 14px; font-size:12px; font-weight:500; color:var(--text-muted); border:none; background:none; cursor:pointer; font-family:'Inter',sans-serif; border-bottom:2px solid transparent; white-space:nowrap; -webkit-tap-highlight-color:transparent; display:flex; align-items:center; gap:5px; }
          .mob2-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
          .mob2-tab-badge { background:var(--accent); color:#0a0908; font-size:9px; font-weight:700; border-radius:8px; padding:1px 5px; font-variant-numeric:tabular-nums; }
          .mob2-search { padding:10px 16px; background:var(--bg-root); border-bottom:1px solid var(--border); flex-shrink:0; }
          .mob2-search-input { width:100%; background:var(--bg-surface); border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:14px; color:var(--text-primary); outline:none; font-family:'Inter',sans-serif; }
          .mob2-scroll { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
          .mob2-scroll::-webkit-scrollbar { display:none; }
          .mob2-content { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; }
          .mob2-content::-webkit-scrollbar { display:none; }
          .mob2-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:14px; flex-shrink:0; }
          .mob2-card-title { font-size:13px; font-weight:600; color:var(--text-primary); letter-spacing:-.01em; margin-bottom:12px; }
          .mob2-menu-row { display:flex; align-items:center; padding:13px 16px; border-bottom:1px dotted var(--border-subtle); cursor:pointer; gap:12px; -webkit-tap-highlight-color:transparent; }
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
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-.01em' }}>Menu Engineering</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{menuItems.length} items · {avgMargin.toFixed(1)}% avg margin</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {belowTarget > 0 && <span className="mi-chip bad" style={{ alignSelf: 'center' }}>{belowTarget} below target</span>}
              <span className={`mi-chip ${avgMargin >= 60 ? 'good' : avgMargin >= 40 ? 'neutral' : 'warn'}`} style={{ alignSelf: 'center' }}>{avgMargin.toFixed(1)}%</span>
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
                        {!searchTerm && <button onClick={() => setShowImportModal(true)} className="mi-btn-p" style={{ padding: '10px 24px', fontSize: 13 }}>↑ Import Your Menu</button>}
                      </div>
                    ) : filtered.map(item => {
                      const margin = getMarginNum(item.price, item.cost);
                      const mc = getMarginColor(margin);
                      const status = getStatus(item);
                      const ingCount = getIngredientCount(item);
                      return (
                        <div key={item.id} className="mob2-menu-row" onClick={() => selectItem(item.id)}>
                          <div className="mi-status-dot" style={{ background: status.color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>{item.name || 'Unnamed'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{ingCount} ingredient{ingCount !== 1 ? 's' : ''} · {item.price ? formatCurrency(item.price) : 'No price'}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: mc, fontVariantNumeric: 'tabular-nums' }}>{margin !== null ? `${margin.toFixed(1)}%` : '—'}</div>
                            <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>margin</div>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { l: 'Total Items', v: menuItems.length, c: 'var(--text-primary)' },
                      { l: 'Avg Margin', v: `${avgMargin.toFixed(1)}%`, c: avgMargin >= 60 ? 'var(--color-green)' : avgMargin >= 40 ? 'var(--accent)' : 'var(--color-amber)' },
                      { l: 'Below Target', v: belowTarget, c: belowTarget > 0 ? 'var(--color-red)' : 'var(--color-green)' },
                      { l: 'No Cost Data', v: noData.length, c: noData.length > 0 ? 'var(--color-amber)' : 'var(--color-green)' },
                    ].map(({ l, v, c }) => (
                      <div key={l} className="mob2-card" style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 6 }}>{l}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: c, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mob2-card">
                    <div className="mob2-card-title">Top Margin Items</div>
                    {topMargin.length > 0 ? topMargin.map(item => {
                      const m = getMarginNum(item.price, item.cost);
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px dotted var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { setMobTab('menu'); selectItem(item.id); }}>
                          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: getMarginColor(m), fontVariantNumeric: 'tabular-nums' }}>{m?.toFixed(1)}%</div>
                        </div>
                      );
                    }) : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No data yet</div>}
                  </div>

                  <div className="mob2-card">
                    <div className="mob2-card-title">Needs Attention</div>
                    {lowMargin.length === 0 && noData.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--color-green)' }}>All items on target ✓</div>
                    ) : [...lowMargin, ...noData].map(item => {
                      const m = getMarginNum(item.price, item.cost);
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px dotted var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { setMobTab('menu'); selectItem(item.id); }}>
                          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          <span className={`mi-chip ${m !== null ? 'bad' : 'warn'}`}>{m !== null ? `${m.toFixed(1)}%` : 'No cost'}</span>
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
                  <div className="mob2-card">
                    <div className="mob2-card-title">Margin Distribution</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
                      {[{ lo: 0, hi: 40, label: '<40%', c: 'var(--color-red)' }, { lo: 40, hi: 60, label: '40–60%', c: 'var(--color-amber)' }, { lo: 60, hi: 75, label: '60–75%', c: 'var(--accent)' }, { lo: 75, hi: 101, label: '>75%', c: 'var(--color-green)' }].map(({ lo, hi, label, c }) => {
                        const count = bucket(lo, hi);
                        return (
                          <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
                            <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                              <div style={{ width: '100%', height: `${Math.max(5, (count / maxBucket) * 100)}%`, background: c, opacity: .8, borderRadius: '4px 4px 0 0' }} />
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center' }}>{label}</div>
                            <div style={{ fontSize: 12, color: c, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mob2-card">
                    <div className="mob2-card-title">All Items by Margin</div>
                    {[...itemsWithMargins].sort((a, b) => getMarginNum(b.price, b.cost) - getMarginNum(a.price, a.cost)).map((item, i) => {
                      const m = getMarginNum(item.price, item.cost);
                      const mc = getMarginColor(m);
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px dotted var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { setMobTab('menu'); selectItem(item.id); }}>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', width: 20, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                            <div style={{ marginTop: 4, height: 5, background: 'var(--bg-inset)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.max(0, Math.min(100, m || 0))}%`, height: '100%', background: mc, borderRadius: 3 }} />
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: mc, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{m?.toFixed(1)}%</div>
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
              <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>{selectedItemData.item?.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', flexShrink: 0 }}>
                <span className="mi-status-dot" style={{ background: getStatus(selectedItemData.item || {}).color }} />
                {getStatus(selectedItemData.item || {}).label}
              </div>
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
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[
                          { l: 'Menu Price', v: selectedItemData.item?.price ? formatCurrency(selectedItemData.item.price) : '—', c: 'var(--accent)' },
                          { l: 'Total Cost', v: formatCurrency(totalCost), c: 'var(--text-primary)' },
                          { l: 'Profit Margin', v: profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—', c: getMarginColor(profitMargin) },
                          { l: 'Ingredients', v: getIngredientCount(menuItems.find(i => i.id === selectedItem) || {}), c: 'var(--text-primary)' },
                        ].map(({ l, v, c }) => (
                          <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                            <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: c, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      {totalCost > 0 && (
                        <div className="mob2-card">
                          <div className="mob2-card-title">Pricing Recommendations</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            {[{ l: '30% cost', v: formatCurrency(totalCost / 0.30) }, { l: '25% cost', v: formatCurrency(totalCost / 0.25), highlight: true }, { l: '20% cost', v: formatCurrency(totalCost / 0.20) }].map(({ l, v, highlight }) => (
                              <div key={l} style={{ background: 'var(--bg-elevated)', border: `1px solid ${highlight ? 'color-mix(in srgb, var(--color-green) 30%, transparent)' : 'var(--border-subtle)'}`, borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? 'var(--color-green)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedItemData.components.length > 0 && (
                        <div className="mob2-card">
                          <div className="mob2-card-title">Recipe</div>
                          {selectedItemData.components.map(c => (
                            <div key={c.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', cursor: 'pointer' }} onClick={() => toggleComp(c.id)}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{c.ingredientCount} ingredients</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.calculatedCost)}</div>
                                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{expandedComponents.has(c.id) ? '▴' : '▾'}</div>
                                </div>
                              </div>
                              {expandedComponents.has(c.id) && (
                                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '8px 12px' }}>
                                  {c.ingredients.map(ing => (
                                    <div key={ing.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dotted var(--border-subtle)' }}>
                                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: ing.hasPrice ? 'var(--color-green)' : 'var(--color-red)', flexShrink: 0 }} />
                                      <div style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>{ing.name}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{ing.quantity} {ing.unit}</div>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: ing.isEstimated ? 'var(--color-amber)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(ing.totalCost)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px dotted var(--border-subtle)' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Food Cost</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalCost)}</div>
                          </div>
                        </div>
                      )}

                      {(() => { const inc = getIncompleteIngredients(selectedItemData); return inc.length > 0 ? (
                        <div style={{ background: 'color-mix(in srgb, var(--color-red) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-red) 20%, transparent)', borderRadius: 10, padding: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-red)', marginBottom: 8 }}>{inc.length} ingredient{inc.length !== 1 ? 's are' : ' is'} missing a price</div>
                          {inc.map((ing, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0', borderBottom: '1px dotted var(--border-subtle)' }}>{ing.name}{ing.component ? ` · in ${ing.component}` : ''}</div>)}
                        </div>
                      ) : null; })()}
                    </>
                  )}

                  {/* Optimize tab */}
                  {detailTab === 'optimize' && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="mi-opt-card mi-opt-orig">
                          <div className="mi-opt-card-title">Original</div>
                          {[{ l: 'Cost', v: formatCurrency(totalCost) }, { l: 'Price', v: formatCurrency(selectedItemData.item?.price) }, { l: 'Margin', v: profitMargin !== null ? `${profitMargin.toFixed(1)}%` : '—', c: getMarginColor(profitMargin) }].map(({ l, v, c }) => (
                            <div key={l} className="mi-opt-row">
                              <span className="mi-opt-label">{l}</span>
                              <span className="mi-opt-val" style={{ color: c || 'var(--text-primary)' }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mi-opt-card mi-opt-new">
                          <div className="mi-opt-card-title" style={{ color: 'var(--color-green)' }}>Optimized</div>
                          <div className="mi-opt-row"><span className="mi-opt-label">Cost</span><span className="mi-opt-val">{formatCurrency(optimizedCost)}</span></div>
                          <div className="mi-opt-row" style={{ borderTop: 'none', paddingTop: 0 }}>
                            <span className="mi-opt-label">Price</span>
                            <input className="mi-opt-price-input" type="number" step="0.01" min="0" value={optimizedPrice ?? selectedItemData.item?.price ?? ''} onChange={e => setOptimizedPrice(parseFloat(e.target.value) || null)} />
                          </div>
                          <div className="mi-opt-row"><span className="mi-opt-label">Margin</span><span className="mi-opt-val" style={{ color: getMarginColor(optimizedMargin) }}>{optimizedMargin !== null ? `${optimizedMargin.toFixed(1)}%` : '—'}</span></div>
                        </div>
                      </div>

                      <div className="mob2-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div className="mob2-card-title" style={{ marginBottom: 0 }}>Adjust Portions</div>
                          <button onClick={() => { setMultipliers({}); setOptimizedPrice(null); }} className="mi-opt-reset">Reset</button>
                        </div>
                        {selectedItemData.components.length > 0 ? selectedItemData.components.map(c => {
                          const m = getMultiplier(c.id);
                          return (
                            <div key={c.id} style={{ marginBottom: 14 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency((c.calculatedCost || c.storedCost || 0) * m)}</div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <input type="range" style={{ flex: 1, background: `linear-gradient(to right,var(--accent) 0%,var(--accent) ${m * 50}%,var(--bg-inset) ${m * 50}%,var(--bg-inset) 100%)` }} min="0" max="2" step="0.01" value={m} onChange={e => setMultiplier(c.id, parseFloat(e.target.value))} />
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(m * 100)}%</div>
                              </div>
                            </div>
                          );
                        }) : (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Recipe Portion</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalCost * getMultiplier('all'))}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <input type="range" style={{ flex: 1 }} min="0" max="2" step="0.01" value={getMultiplier('all')} onChange={e => setMultiplier('all', parseFloat(e.target.value))} />
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(getMultiplier('all') * 100)}%</div>
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

        {showImportModal && (
          <MenuImportModal
            restaurantId={restaurantId}
            onClose={() => setShowImportModal(false)}
            onImported={() => { setShowImportModal(false); fetchMenuItems(); }}
            onReviewReady={({ dishes, ingredientLibrary }) => {
              setShowImportModal(false);
              setReviewData({ dishes, ingredientLibrary });
            }}
          />
        )}
        {tourProps && <TourOverlay {...tourProps} />}
        <TourDataBanner />
        {reviewData && (
          <ParseReviewModal
            dishes={reviewData.dishes}
            ingredientLibrary={reviewData.ingredientLibrary}
            restaurantId={restaurantId}
            onCommitted={() => { setReviewData(null); fetchMenuItems(); }}
            onClose={() => setReviewData(null)}
          />
        )}
      </>
    );
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Menu Items — OptiMenu</title></Head>
      <style>{CSS}</style>
      <div className="mi-root">

        {/* ── TOP BAR ── */}
        <div className="mi-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(12px,1.6vw,28px)' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,.9vw,14px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'clamp(9px,.62vw,11px)', color: 'var(--accent)' }}>
              <div style={{ width: 5, height: 5, background: 'var(--accent)', borderRadius: '50%', animation: 'blink 2s infinite' }} />Active
            </div>
            <ProfileDropdown userName={userName} userEmail={userEmail} isMobile={false} />
          </div>
        </div>

        {/* ── PAGE HEADER ── */}
        <div className="mi-ph">
          <div className="mi-ph-title">
            Menu Engineering
            <span className="mi-chip neutral">{menuItems.length} items</span>
            <span className={`mi-chip ${avgMargin >= 60 ? 'good' : avgMargin >= 40 ? 'neutral' : 'warn'}`}>{avgMargin.toFixed(1)}% avg margin</span>
            {belowTarget > 0 && <span className="mi-chip bad">{belowTarget} below target</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,.9vw,14px)', flexWrap: 'wrap' }}>
            <button className="mi-btn-g" onClick={() => setShowImportModal(true)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import Menu
            </button>
            <button className="mi-btn-p">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Item
            </button>
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
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                  <div className="mi-container-title">Menu Items</div>
                  <div className="mi-container-count">{filtered.length} shown</div>
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
                    <button className={`mi-toggle-btn${displayMode === 'grid' ? ' active' : ''}`} onClick={() => setDisplayMode('grid')} title="Card view">
                      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    </button>
                    <button className={`mi-toggle-btn${displayMode === 'list' ? ' active' : ''}`} onClick={() => setDisplayMode('list')} title="List view">
                      <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              {displayMode === 'list' && (
                <div className="mi-list-head">
                  {[['name','Name'],['price','Price'],['cost','Cost'],['margin','Margin']].map(([col, label]) => (
                    <div key={col} className={`mi-list-th${sortBy === col ? ' active' : ''}`}
                      onClick={() => { if (sortBy === col) setSortOrder(o => o === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortOrder('asc'); } }}>
                      {label}{sortBy === col ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}
                    </div>
                  ))}
                </div>
              )}

              {displayMode === 'grid' ? (
                <div className="mi-grid-wrap">
                  {filtered.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
                      <div style={{ fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-muted)', fontWeight: 500 }}>{searchTerm ? `No results for "${searchTerm}"` : 'No menu items yet'}</div>
                      {!searchTerm && <button className="mi-btn-p" style={{ padding: '10px 24px', fontSize: 13 }} onClick={() => setShowImportModal(true)}>↑ Import Your Menu</button>}
                    </div>
                  ) : <div className="mi-grid">{filtered.map((item, idx) => renderGridItem(item, idx))}</div>}
                </div>
              ) : (
                <div className="mi-list-body">
                  {filtered.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, fontSize: 'clamp(11px,.85vw,14px)', color: 'var(--text-muted)' }}>{searchTerm ? `No results for "${searchTerm}"` : 'No menu items yet'}</div>
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
                        onClick={() => { setDetailTab('edit'); initEditComponents(selectedItemData); fetchIngredientLibrary(); }}>Edit</button>
                    </>
                  ) : <button className="mi-vtab active" style={{ cursor: 'default' }}>Overview</button>}
                </div>
              </div>

              {!selectedItem && (() => {
                const laggards = [...itemsWithMargins].sort((a, b) => getMarginNum(a.price, a.cost) - getMarginNum(b.price, b.cost)).slice(0, 5);
                const missing = menuItems.filter(i => !i.price || !i.cost);
                const avgC = avgMargin >= 70 ? 'var(--color-green)' : avgMargin >= 60 ? 'var(--accent)' : avgMargin >= 40 ? 'var(--color-amber)' : 'var(--color-red)';
                return (
                  <div className="mi-detail-body">
                    {/* MENU HEALTH: the whole menu on one axis */}
                    <div className="dp-hero tinted">
                      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
                        <div>
                          <div className="dp-lbl">Average margin</div>
                          <div className="dp-big" style={{ color: avgC }}>{avgMargin.toFixed(1)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="dp-lbl">On target</div>
                          <div className="dp-big" style={{ color: 'var(--text-primary)', fontSize: 'clamp(18px,1.6vw,26px)' }}>
                            {itemsWithMargins.length - belowTarget}<span style={{ color: 'var(--text-faint)', fontWeight: 400, fontSize: '.65em' }}> / {itemsWithMargins.length}</span>
                          </div>
                        </div>
                      </div>
                      <MarginSpectrum items={itemsWithMargins} onSelect={selectItem} avgMargin={avgMargin} />
                      <div className="dp-sub" style={{ color: 'var(--text-faint)', textAlign: 'center' }}>every dot is a dish — click one to open it</div>
                    </div>

                    {/* LEADERS / LAGGARDS */}
                    <div className="mi-ov-row">
                      <div className="mi-ov-w">
                        <div className="mi-ov-lbl">Leaders</div>
                        {topMargin.length > 0 ? topMargin.map(i => { const m = getMarginNum(i.price, i.cost); return <div key={i.id} className="mi-ov-item" onClick={() => selectItem(i.id)}><span className="mi-ov-name">{i.name}</span><span className="mi-ov-val" style={{ color: getMarginColor(m) }}>{m?.toFixed(1)}%</span></div>; }) : <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-muted)' }}>No data yet</div>}
                      </div>
                      <div className="mi-ov-w">
                        <div className="mi-ov-lbl">Laggards</div>
                        {laggards.length > 0 ? laggards.map(i => { const m = getMarginNum(i.price, i.cost); return <div key={i.id} className="mi-ov-item" onClick={() => selectItem(i.id)}><span className="mi-ov-name">{i.name}</span><span className="mi-ov-val" style={{ color: getMarginColor(m) }}>{m?.toFixed(1)}%</span></div>; }) : <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--color-green)' }}>All items on target ✓</div>}
                      </div>
                    </div>

                    {/* MISSING DATA */}
                    {missing.length > 0 && (
                      <div style={S.wf}>
                        <div style={{ ...S.wlbl, color: 'var(--color-amber)' }}>Missing Data<Rule /></div>
                        <div style={{ fontSize: 'clamp(9px,.7vw,11px)', color: 'var(--text-muted)', marginBottom: 7 }}>
                          {missing.length} item{missing.length !== 1 ? 's have' : ' has'} no price or cost — they're invisible to margin analysis.
                        </div>
                        {missing.slice(0, 4).map(i => (
                          <div key={i.id} className="mi-ov-item" onClick={() => selectItem(i.id)}>
                            <span className="mi-ov-name">{i.name}</span>
                            <span className="mi-chip warn">{!i.price ? 'No price' : 'No cost'}</span>
                          </div>
                        ))}
                        {missing.length > 4 && <div style={{ fontSize: 'clamp(8px,.62vw,10px)', color: 'var(--text-faint)', paddingTop: 5 }}>+ {missing.length - 4} more</div>}
                      </div>
                    )}

                    <div className="mi-hint">Click any menu item to see its plate economics →</div>
                  </div>
                );
              })()}

              {selectedItem && (
                <div className="mi-detail-body">
                  {detailLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'clamp(10px,.76vw,12px)' }}>
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
                <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--bg-root) 75%, transparent)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, borderRadius: 12 }}>
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '26px', width: 'min(300px,90%)', display: 'flex', flexDirection: 'column', gap: 20, animation: 'rise .2s ease both' }}>
                    <div>
                      <div style={{ fontSize: 'clamp(14px,1.1vw,17px)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, letterSpacing: '-.01em' }}>Leave without saving?</div>
                      <div style={{ fontSize: 'clamp(11px,.82vw,13px)', color: 'var(--text-muted)', lineHeight: 1.5 }}>Your unsaved changes will be lost.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowUnsavedModal(false)} className="mi-btn-g">Stay</button>
                      <button onClick={() => { setShowUnsavedModal(false); setEditDirty(false); unsavedCallback?.(); }} style={{ background: 'var(--color-red)', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 'clamp(10px,.76vw,13px)', color: '#fff', cursor: 'pointer', fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>Leave</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showImportModal && (
          <MenuImportModal
            restaurantId={restaurantId}
            onClose={() => setShowImportModal(false)}
            onImported={() => { setShowImportModal(false); fetchMenuItems(); }}
            onReviewReady={({ dishes, ingredientLibrary }) => {
              setShowImportModal(false);
              setReviewData({ dishes, ingredientLibrary });
            }}
          />
        )}
      </div>
      {tourProps && <TourOverlay {...tourProps} />}
      <TourDataBanner />
      {reviewData && (
        <ParseReviewModal
          dishes={reviewData.dishes}
          ingredientLibrary={reviewData.ingredientLibrary}
          restaurantId={restaurantId}
          onCommitted={() => {
            setReviewData(null);
            fetchMenuItems();
          }}
          onClose={() => setReviewData(null)}
        />
      )}
    </>
  );
}