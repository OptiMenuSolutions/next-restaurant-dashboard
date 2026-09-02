// components/ParseReviewModal.js
// Dish-by-dish review overlay that fires after MenuImportModal parse completes.
// Receives: { dishes, ingredient_library, restaurant_id }
// On commit: POSTs to /api/menu/commit-reviewed-menu, then calls onCommitted()

import React, { useState, useCallback, useRef } from 'react';
import supabase from '../lib/supabaseClient';

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap');
  @keyframes prm-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes prm-spin { to { transform: rotate(360deg); } }

  .prm-overlay {
    position: fixed; inset: 0; background: rgba(17,24,25,.5);
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    z-index: 300; display: flex; align-items: center; justify-content: center;
    padding: 24px; animation: prm-fadein .2s ease;
  }
  .prm-shell {
    width: 100%; max-width: 860px; height: 90vh; max-height: 780px;
    display: flex; flex-direction: column;
    background: var(--shell, #fff); border: 1px solid var(--line, #d8dfe0);
    border-radius: 14px; overflow: hidden;
    font-family: 'Manrope', sans-serif;
    box-shadow: 0 24px 64px rgba(17,24,25,.22);
  }

  /* ── Top bar ── */
  .prm-topbar {
    background: var(--shell, #fff); border-bottom: 1px solid var(--line, #d8dfe0);
    padding: 11px 24px; display: flex; align-items: center;
    justify-content: space-between; flex-shrink: 0; gap: 16px;
  }
  .prm-logo { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--accent-deep, #03808f); }
  .prm-topbar-meta { font-size: 12px; color: var(--muted, #4b585b); text-align: center; }
  .prm-topbar-meta strong { color: var(--text, #111819); font-weight: 700; }
  .prm-prog-wrap { width: 200px; background: var(--line, #d8dfe0); height: 3px; border-radius: 2px; overflow: hidden; margin: 5px auto 0; }
  .prm-prog-fill { height: 100%; background: var(--accent, #02a4ba); border-radius: 2px; transition: width .35s; }
  .prm-discard-btn {
    background: none; border: 1px solid var(--line, #d8dfe0); border-radius: 6px;
    padding: 5px 12px; font-size: 11px; color: var(--muted, #4b585b); cursor: pointer;
    font-family: 'Manrope', sans-serif; font-weight: 600; transition: all .15s; white-space: nowrap; flex-shrink: 0;
  }
  .prm-discard-btn:hover { border-color: #c4473e; color: #c4473e; }

  /* ── Body ── */
  .prm-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }

  /* ── Sidebar ── */
  .prm-sidebar {
    width: 200px; background: #f7f8f8; border-right: 1px solid var(--line, #d8dfe0);
    overflow-y: auto; flex-shrink: 0;
  }
  .prm-sidebar::-webkit-scrollbar { width: 2px; }
  .prm-sidebar::-webkit-scrollbar-thumb { background: var(--line, #d8dfe0); border-radius: 2px; }
  .prm-sb-section { border-bottom: 1px solid var(--line, #d8dfe0); padding: 6px 0 8px; }
  .prm-sb-cat {
    font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 600; color: var(--muted, #4b585b);
    text-transform: uppercase; letter-spacing: .1em; padding: 6px 14px 4px;
  }
  .prm-sb-item {
    display: flex; align-items: center; gap: 7px; padding: 5px 14px;
    font-size: 12.5px; color: var(--text, #111819); cursor: pointer; transition: all .1s;
    border-left: 2px solid transparent;
  }
  .prm-sb-item:hover { background: #eef1f1; }
  .prm-sb-item.active { background: #e8f7f9; color: var(--accent-deep, #03808f); border-left-color: var(--accent, #02a4ba); font-weight: 700; }
  .prm-sb-item.confirmed { color: #2f8a4e; }
  .prm-sb-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--line, #d8dfe0); flex-shrink: 0; transition: background .15s; }
  .prm-sb-dot.active { background: var(--accent, #02a4ba); }
  .prm-sb-dot.confirmed { background: #2f8a4e; }
  .prm-sb-check { font-size: 9px; color: #2f8a4e; margin-left: auto; flex-shrink: 0; }

  /* ── Main ── */
  .prm-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .prm-scroll { flex: 1; overflow-y: auto; padding: 22px 28px 16px; }
  .prm-scroll::-webkit-scrollbar { width: 3px; }
  .prm-scroll::-webkit-scrollbar-thumb { background: var(--line, #d8dfe0); border-radius: 2px; }

  /* ── Dish header ── */
  .prm-dish-hd { margin-bottom: 16px; }
  .prm-dish-title {
    font-family: 'Manrope', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: -.03em;
    color: var(--text, #111819); margin-bottom: 10px; line-height: 1.2;
  }
  .prm-dish-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .prm-badge {
    font-size: 10px; font-weight: 700; padding: 3px 9px;
    border-radius: 4px; letter-spacing: .02em; white-space: nowrap;
  }
  .prm-badge-price { background: #e8f7f9; color: var(--accent-deep, #03808f); border: 1px solid #bfe8ec; }
  .prm-badge-margin-ok { background: #eaf6ee; color: #2f8a4e; border: 1px solid #cbe9d4; }
  .prm-badge-margin-warn { background: #faeae8; color: #c4473e; border: 1px solid #f0c9c4; }

  /* Category text input */
  .prm-cat-input {
    background: transparent; border: none; outline: none;
    font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 600;
    color: var(--muted, #4b585b); padding: 0; width: auto; min-width: 60px; max-width: 180px;
    border-bottom: 1px dashed var(--line, #d8dfe0); transition: border-color .15s;
  }
  .prm-cat-input:focus { color: var(--text, #111819); border-bottom-color: var(--accent, #02a4ba); }

  /* Warning */
  .prm-warn {
    background: #faeae8; border: 1px solid #f0c9c4; border-radius: 6px;
    padding: 9px 14px; font-size: 12px; color: #c4473e;
    margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
  }

  /* ── Component block ── */
  .prm-comp {
    background: var(--shell, #fff); border: 1px solid var(--line, #d8dfe0);
    border-radius: 8px; margin-bottom: 10px; overflow: visible;
  }
  .prm-comp-hd {
    display: flex; align-items: center; gap: 8px; padding: 9px 14px;
    background: #f7f8f8; border-bottom: 1px solid var(--line, #d8dfe0);
    border-radius: 8px 8px 0 0;
  }
  .prm-comp-name-input {
    background: transparent; border: none; outline: none;
    font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; font-weight: 600;
    color: var(--accent-deep, #03808f); text-transform: uppercase; letter-spacing: .09em; flex: 1; min-width: 0;
  }
  .prm-comp-name-input:focus { background: #fff; padding: 2px 6px; border-radius: 3px; }
  .prm-comp-cost { font-size: 11px; color: var(--muted, #4b585b); font-weight: 600; white-space: nowrap; }
  .prm-purchased-btn {
    background: none; border: 1px solid var(--line, #d8dfe0); border-radius: 4px;
    font-size: 9px; font-weight: 700; color: var(--muted, #4b585b); cursor: pointer;
    padding: 2px 8px; font-family: 'Manrope', sans-serif; white-space: nowrap;
    letter-spacing: .04em; transition: all .15s; flex-shrink: 0; text-transform: uppercase;
  }
  .prm-purchased-btn:hover { border-color: #b8860b; color: #96690a; }
  .prm-purchased-btn.active { border-color: #b8860b; color: #fff; background: #b8860b; }
  .prm-comp-del {
    background: none; border: none; color: var(--line, #d8dfe0); cursor: pointer;
    font-size: 14px; padding: 0 2px; line-height: 1; transition: color .15s; flex-shrink: 0;
  }
  .prm-comp-del:hover { color: #c4473e; }

  /* Purchased state */
  .prm-purchased-row {
    display: flex; align-items: center; gap: 12px; padding: 11px 14px;
    background: #fdf6e8; border-top: 1px solid #f0e0b8; flex-wrap: wrap;
  }
  .prm-purchased-label { font-size: 11px; color: #96690a; font-style: italic; flex: 1; min-width: 160px; }
  .prm-purchased-inputs { display: flex; align-items: center; gap: 8px; }
  .prm-purchased-field-lbl { font-size: 9px; color: #96690a; text-transform: uppercase; letter-spacing: .08em; }
  .prm-purchased-cost-input {
    background: #fff; border: 1px solid #f0e0b8; border-radius: 4px;
    padding: 5px 8px; font-size: 12px; color: var(--text, #111819); width: 84px;
    text-align: right; outline: none; font-family: 'Manrope', sans-serif;
    -moz-appearance: textfield; appearance: textfield;
  }
  .prm-purchased-cost-input::-webkit-inner-spin-button,
  .prm-purchased-cost-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .prm-purchased-cost-input:focus { border-color: #b8860b; }
  .prm-purchased-unit-input {
    background: #fff; border: 1px solid #f0e0b8; border-radius: 4px;
    padding: 5px 8px; font-size: 12px; color: var(--muted, #4b585b); width: 60px;
    text-align: center; outline: none; font-family: 'Manrope', sans-serif;
  }
  .prm-purchased-unit-input:focus { border-color: #b8860b; }

  /* Ingredient table */
  .prm-col-hd {
    display: grid; grid-template-columns: 1fr 70px 60px 24px;
    gap: 8px; padding: 7px 14px 4px;
    font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 600; color: var(--muted, #4b585b);
    text-transform: uppercase; letter-spacing: .09em;
  }
  .prm-ing-row {
    display: grid; grid-template-columns: 1fr 70px 60px 24px;
    gap: 8px; align-items: center; padding: 7px 14px;
    border-bottom: 1px solid var(--line, #d8dfe0); position: relative;
  }
  .prm-ing-row:last-child { border-bottom: none; }
  .prm-ing-wrap { position: relative; }
  .prm-ing-input {
    background: transparent; border: none; outline: none;
    font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 500;
    color: var(--text, #111819); width: 100%;
  }
  .prm-ing-input:focus { color: var(--text, #111819); }
  .prm-ing-input::placeholder { color: #a7b0b1; font-size: 12px; }
  .prm-qty-input {
    background: transparent; border: none; outline: none;
    font-family: 'Manrope', sans-serif; font-size: 12px; color: var(--muted, #4b585b);
    text-align: right; width: 100%;
    -moz-appearance: textfield; appearance: textfield;
  }
  .prm-qty-input::-webkit-inner-spin-button,
  .prm-qty-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .prm-qty-input:focus { color: var(--text, #111819); }
  .prm-unit-input {
    background: transparent; border: none; outline: none;
    font-family: 'Manrope', sans-serif; font-size: 12px; color: var(--muted, #4b585b);
    text-align: right; width: 100%; cursor: pointer;
    appearance: none; -webkit-appearance: none;
  }
  .prm-unit-input:focus { color: var(--text, #111819); }
  .prm-unit-select {
    background: transparent; border: none; outline: none;
    font-family: 'Manrope', sans-serif; font-size: 12px; color: var(--muted, #4b585b);
    text-align: right; width: 100%; cursor: pointer;
    appearance: none; -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='4' viewBox='0 0 6 4'%3E%3Cpath d='M0 0l3 4 3-4z' fill='%234b585b'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 2px center;
    padding-right: 12px;
  }
  .prm-unit-select:focus { color: var(--text, #111819); }
  .prm-unit-select option { background: #fff; color: var(--text, #111819); }
  .prm-ing-del {
    background: none; border: none; color: var(--line, #d8dfe0); cursor: pointer;
    font-size: 13px; padding: 0; line-height: 1; transition: color .15s;
    display: flex; align-items: center; justify-content: center;
  }
  .prm-ing-del:hover { color: #c4473e; }
  .prm-unit-warn { font-size: 9px; color: #b8860b; margin-left: 2px; cursor: help; }

  /* Autocomplete */
  .prm-ac-dropdown {
    position: absolute; top: calc(100% + 3px); left: -14px; right: -14px;
    background: #fff; border: 1px solid var(--accent, #02a4ba);
    border-radius: 6px; z-index: 200; overflow: hidden;
    box-shadow: 0 6px 20px rgba(17,24,25,.15);
    max-height: 220px; overflow-y: auto;
  }
  .prm-ac-dropdown::-webkit-scrollbar { width: 2px; }
  .prm-ac-dropdown::-webkit-scrollbar-thumb { background: var(--accent, #02a4ba); }
  .prm-ac-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 14px; cursor: pointer; transition: background .1s;
    border-bottom: 1px solid var(--line, #d8dfe0);
  }
  .prm-ac-item:last-child { border-bottom: none; }
  .prm-ac-item:hover { background: #e8f7f9; }
  .prm-ac-name { font-size: 13px; color: var(--text, #111819); font-weight: 600; }
  .prm-ac-meta { font-size: 10px; color: var(--muted, #4b585b); }

  /* Add buttons */
  .prm-add-ing {
    background: none; border: none; color: #a7b0b1; cursor: pointer;
    font-size: 11px; font-family: 'Manrope', sans-serif; font-weight: 600;
    padding: 7px 14px; display: flex; align-items: center; gap: 5px;
    transition: color .15s; width: 100%; border-top: 1px solid var(--line, #d8dfe0);
  }
  .prm-add-ing:hover { color: var(--accent, #02a4ba); }
  .prm-add-comp {
    width: 100%; background: none; border: 1px dashed var(--line, #d8dfe0);
    border-radius: 8px; padding: 10px; font-size: 11px; color: #a7b0b1;
    font-weight: 600; font-family: 'Manrope', sans-serif; cursor: pointer;
    margin-bottom: 16px; transition: all .15s;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .prm-add-comp:hover { border-color: var(--accent, #02a4ba); color: var(--accent, #02a4ba); background: #e8f7f9; }

  /* ── Footer ── */
  .prm-footer {
    background: var(--shell, #fff); border-top: 1px solid var(--line, #d8dfe0);
    padding: 12px 24px; display: flex; align-items: center;
    justify-content: space-between; flex-shrink: 0; gap: 12px;
  }
  .prm-nav { display: flex; gap: 6px; }
  .prm-btn {
    font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 700;
    padding: 7px 16px; border-radius: 6px; cursor: pointer;
    transition: all .15s; border: none; white-space: nowrap;
  }
  .prm-btn-ghost { background: transparent; border: 1px solid var(--line, #d8dfe0); color: var(--muted, #4b585b); }
  .prm-btn-ghost:hover { border-color: #a7b0b1; color: var(--text, #111819); }
  .prm-btn-ghost:disabled { opacity: .35; cursor: default; }
  .prm-btn-confirm { background: var(--accent, #02a4ba); color: #fff; font-weight: 700; font-size: 13px; }
  .prm-btn-confirm:hover { background: var(--accent-deep, #03808f); }
  .prm-btn-commit {
    background: #eaf6ee; color: #227a41; font-weight: 700;
    font-size: 13px; padding: 8px 20px; border: 1px solid #bfe4c9;
  }
  .prm-btn-commit:hover { background: #d9f0e0; }
  .prm-btn-commit:disabled { background: #f2f4f4; color: #a7b0b1; border-color: var(--line, #d8dfe0); cursor: default; }
  .prm-confirmed-tag {
    display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;
    color: #227a41; padding: 5px 12px; background: #eaf6ee;
    border-radius: 6px; border: 1px solid #bfe4c9;
  }

  /* ── Commit screen ── */
  .prm-commit-screen {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; flex: 1; padding: 48px 24px; text-align: center;
  }
  .prm-commit-icon {
    width: 60px; height: 60px; border-radius: 50%;
    background: #eaf6ee; border: 1px solid #bfe4c9;
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; margin-bottom: 18px; color: #227a41;
  }
  .prm-commit-title {
    font-family: 'Manrope', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: -.03em;
    color: var(--text, #111819); margin-bottom: 8px;
  }
  .prm-commit-sub { font-size: 13px; color: var(--muted, #4b585b); margin-bottom: 24px; line-height: 1.7; max-width: 400px; }
  .prm-commit-summary {
    background: #f7f8f8; border: 1px solid var(--line, #d8dfe0); border-radius: 10px;
    padding: 16px 20px; width: 100%; max-width: 380px; margin-bottom: 24px; text-align: left;
  }
  .prm-summary-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--line, #d8dfe0);
  }
  .prm-summary-row:last-child { border-bottom: none; }
  .prm-summary-row .lbl { color: var(--muted, #4b585b); }
  .prm-summary-row .val { color: var(--text, #111819); font-weight: 700; }
  .prm-summary-row .val.warn { color: #c4473e; }
  .prm-commit-err {
    background: #faeae8; border: 1px solid #f0c9c4; border-radius: 6px;
    padding: 10px 16px; font-size: 12px; color: #c4473e;
    margin-bottom: 16px; max-width: 380px; width: 100%;
  }
  .prm-spinner {
    width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.4);
    border-top-color: #fff; border-radius: 50%;
    animation: prm-spin .7s linear infinite;
    display: inline-block; margin-right: 8px; vertical-align: middle;
  }
`;

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function margin(dish) {
  if (!dish.price || !dish.total_estimated_cost) return null;
  return ((dish.price - dish.total_estimated_cost) / dish.price * 100);
}

function compCost(comp) {
  return (comp.ingredients || []).reduce((s, i) => s + (i.quantity || 0) * (i.estimated_unit_cost || 0), 0);
}

// Convert a per-unit cost when the unit changes.
// Returns { newCost, converted } — converted=false means we couldn't auto-convert.
const UNIT_TO_BASE_OZ = { oz: 1, lb: 16, g: 0.035274, kg: 35.274 };
const UNIT_TO_BASE_FLOZ = { 'fl_oz': 1, oz: 1, cup: 8, ml: 0.033814, l: 33.814 };

function convertUnitCost(oldUnit, newUnit, oldCost) {
  if (!oldUnit || !newUnit || oldUnit === newUnit) return { newCost: oldCost, converted: true };
  const ou = oldUnit.toLowerCase().trim();
  const nu = newUnit.toLowerCase().trim();

  // Weight family
  if (UNIT_TO_BASE_OZ[ou] !== undefined && UNIT_TO_BASE_OZ[nu] !== undefined) {
    const costPerOz = oldCost / UNIT_TO_BASE_OZ[ou];
    return { newCost: Math.round(costPerOz * UNIT_TO_BASE_OZ[nu] * 10000) / 10000, converted: true };
  }
  // Volume family
  if (UNIT_TO_BASE_FLOZ[ou] !== undefined && UNIT_TO_BASE_FLOZ[nu] !== undefined) {
    const costPerFloz = oldCost / UNIT_TO_BASE_FLOZ[ou];
    return { newCost: Math.round(costPerFloz * UNIT_TO_BASE_FLOZ[nu] * 10000) / 10000, converted: true };
  }
  // Cannot convert (e.g. each → lb, bunch → oz)
  return { newCost: oldCost, converted: false };
}

export default function ParseReviewModal({ dishes: rawDishes, ingredientLibrary, restaurantId, onCommitted, onClose }) {
  const [dishes, setDishes] = useState(() => deepClone(rawDishes));
  const [confirmed, setConfirmed] = useState(() => new Array(rawDishes.length).fill(false));
  const [current, setCurrent] = useState(0);
  const [view, setView] = useState('review');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [acSearch, setAcSearch] = useState({});
  const [acOpen, setAcOpen] = useState({});
  const acTimers = useRef({});
  const acMouseDown = useRef(false);
  // unitWarnings: set of keys `${dishIdx}-${ci}-${ii}` where unit conversion wasn't possible
  const [unitWarnings, setUnitWarnings] = useState(new Set());

  const allConfirmed = confirmed.every(Boolean);
  const sidebarCategories = [...new Set(dishes.map(d => d.category))];

  // ── Sidebar ──────────────────────────────────────────────────────────────

  function renderSidebar() {
    return sidebarCategories.map(cat => (
      <div key={cat} className="prm-sb-section">
        <div className="prm-sb-cat">{cat}</div>
        {dishes.map((d, i) => {
          if (d.category !== cat) return null;
          const isActive = i === current && view === 'review';
          const isDone = confirmed[i];
          return (
            <div key={i} className={`prm-sb-item${isActive ? ' active' : ''}${isDone ? ' confirmed' : ''}`}
              onClick={() => { setCurrent(i); setView('review'); setAcSearch({}); setAcOpen({}); }}>
              <div className={`prm-sb-dot${isActive ? ' active' : ''}${isDone ? ' confirmed' : ''}`} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              {isDone && <span className="prm-sb-check">✓</span>}
            </div>
          );
        })}
      </div>
    ));
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const unconfirm = useCallback((idx) => {
    setConfirmed(prev => { const n = [...prev]; n[idx] = false; return n; });
  }, []);

  function updateCategory(val) {
    setDishes(prev => { const d = deepClone(prev); d[current].category = val; return d; });
    unconfirm(current);
  }

  function updateCompName(ci, val) {
    setDishes(prev => { const d = deepClone(prev); d[current].components[ci].name = val; return d; });
    unconfirm(current);
  }

  function updateIng(ci, ii, field, val) {
    if (field === 'unit') {
      setDishes(prev => {
        const d = deepClone(prev);
        const ing = d[current].components[ci].ingredients[ii];
        const { newCost, converted } = convertUnitCost(ing.unit, val, ing.estimated_unit_cost);
        ing.unit = val;
        ing.estimated_unit_cost = newCost;
        const warnKey = `${current}-${ci}-${ii}`;
        setUnitWarnings(ws => {
          const s = new Set(ws);
          converted ? s.delete(warnKey) : s.add(warnKey);
          return s;
        });
        return d;
      });
    } else {
      setDishes(prev => { const d = deepClone(prev); d[current].components[ci].ingredients[ii][field] = val; return d; });
      if (field === 'estimated_unit_cost') {
        setUnitWarnings(prev => { const s = new Set(prev); s.delete(`${current}-${ci}-${ii}`); return s; });
      }
    }
    unconfirm(current);
  }

  function deleteIng(ci, ii) {
    setDishes(prev => { const d = deepClone(prev); d[current].components[ci].ingredients.splice(ii, 1); return d; });
    unconfirm(current);
  }

  function deleteComp(ci) {
    setDishes(prev => { const d = deepClone(prev); d[current].components.splice(ci, 1); return d; });
    unconfirm(current);
  }

  function addIng(ci) {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components[ci].ingredients.push({ name: '', unit: 'oz', quantity: 1, estimated_unit_cost: 0 });
      return d;
    });
    unconfirm(current);
  }

  function addComp() {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components.push({ name: 'New Component', ingredients: [{ name: '', unit: 'oz', quantity: 1, estimated_unit_cost: 0 }] });
      return d;
    });
    unconfirm(current);
  }

  function markPurchased(ci) {
    setDishes(prev => {
      const d = deepClone(prev);
      const comp = d[current].components[ci];
      if (comp.purchased) {
        comp.purchased = false;
        if (comp._savedIngredients) { comp.ingredients = comp._savedIngredients; comp._savedIngredients = undefined; }
        if (!comp.ingredients.length) comp.ingredients = [{ name: '', unit: 'oz', quantity: 1, estimated_unit_cost: 0 }];
      } else {
        comp._savedIngredients = deepClone(comp.ingredients);
        comp.purchased = true;
        comp.ingredients = [{
          name: comp.name,
          unit: 'each',
          quantity: 1,
          estimated_unit_cost: comp.ingredients.reduce((s, i) => s + (i.quantity || 0) * (i.estimated_unit_cost || 0), 0),
        }];
      }
      return d;
    });
    unconfirm(current);
  }

  // ── Autocomplete ──────────────────────────────────────────────────────────

  function getAcResults(query) {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    return (ingredientLibrary || []).filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
  }

  function selectAcItem(ci, ii, lib) {
    const key = `${ci}-${ii}`;
    setDishes(prev => {
      const d = deepClone(prev);
      const ing = d[current].components[ci].ingredients[ii];
      ing.name = lib.name;
      ing.unit = lib.unit;
      ing.estimated_unit_cost = lib.estimated_unit_cost || 0;
      return d;
    });
    setAcOpen(prev => ({ ...prev, [key]: false }));
    setAcSearch(prev => { const n = { ...prev }; delete n[key]; return n; });
    unconfirm(current);
  }

  function handleIngNameChange(ci, ii, val) {
    const key = `${ci}-${ii}`;
    setDishes(prev => { const d = deepClone(prev); d[current].components[ci].ingredients[ii].name = val; return d; });
    setAcSearch(prev => ({ ...prev, [key]: val }));
    setAcOpen(prev => ({ ...prev, [key]: true }));
    unconfirm(current);
  }

  function closeAc(key) {
    acTimers.current[key] = setTimeout(() => {
      setAcOpen(prev => ({ ...prev, [key]: false }));
    }, 200);
  }

  function cancelCloseAc(key) {
    clearTimeout(acTimers.current[key]);
    acMouseDown.current = false;
  }

  // ── Confirm / commit ──────────────────────────────────────────────────────

  function confirmDish() {
    setConfirmed(prev => { const n = [...prev]; n[current] = true; return n; });
    if (current < dishes.length - 1) { setCurrent(c => c + 1); setAcSearch({}); setAcOpen({}); }
  }

  function removeDish() {
    setDishes(prev => prev.filter((_, i) => i !== current));
    setConfirmed(prev => prev.filter((_, i) => i !== current));
    setAcSearch({});
    setAcOpen({});
    setCurrent(c => Math.min(c, dishes.length - 2));
  }

  async function handleCommit() {
    setCommitting(true); setCommitError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/menu/commit-reviewed-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ restaurant_id: restaurantId, dishes, ingredient_library: ingredientLibrary }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Commit failed');
      onCommitted(data);
    } catch (err) {
      setCommitError(err.message);
      setCommitting(false);
    }
  }

  // ── Render dish ───────────────────────────────────────────────────────────

  function renderDish() {
    const dish = dishes[current];
    const mgn = margin(dish);
    const losing = mgn !== null && mgn < 0;

    return (
      <>
        <div className="prm-dish-hd">
          <div className="prm-dish-title">{dish.name}</div>
          <div className="prm-dish-meta">
            <input
              className="prm-cat-input"
              value={dish.category}
              onChange={e => updateCategory(e.target.value)}
              size={Math.max(8, dish.category.length)}
            />
            {dish.price && <span className="prm-badge prm-badge-price">${dish.price.toFixed(2)}</span>}
            {mgn !== null && (
              <span className={`prm-badge ${losing ? 'prm-badge-margin-warn' : 'prm-badge-margin-ok'}`}>
                {losing ? '⚠ ' : ''}{mgn.toFixed(1)}% margin
              </span>
            )}
          </div>
        </div>

        {losing && (
          <div className="prm-warn">
            ⚠ Cost (${dish.total_estimated_cost?.toFixed(2)}) exceeds price — losing ${Math.abs(dish.total_estimated_cost - dish.price).toFixed(2)}/order
          </div>
        )}

        {dish.components.map((comp, ci) => {
          const cost = compCost(comp);
          const isPurchased = comp.purchased === true;
          const purchasedIng = isPurchased ? comp.ingredients[0] : null;
          return (
            <div key={ci} className="prm-comp">
              <div className="prm-comp-hd">
                <input className="prm-comp-name-input" value={comp.name} onChange={e => updateCompName(ci, e.target.value)} />
                <span className="prm-comp-cost">${cost.toFixed(2)}</span>
                <button className={`prm-purchased-btn${isPurchased ? ' active' : ''}`} onClick={() => markPurchased(ci)}>
                  {isPurchased ? '✓ Finished Good' : 'Purchased as Finished Good'}
                </button>
                <button className="prm-comp-del" onClick={() => deleteComp(ci)}>✕</button>
              </div>

              {isPurchased ? (
                <div className="prm-purchased-row">
                  <span className="prm-purchased-label">Purchased as finished product — matches invoice line item</span>
                  <div className="prm-purchased-inputs">
                    <span className="prm-purchased-field-lbl">Unit</span>
                    <select
                      className="prm-unit-select"
                      style={{ background: '#fff', border: '1px solid #f0e0b8', borderRadius: 4, padding: '5px 20px 5px 8px', width: 80, color: 'var(--muted, #4b585b)' }}
                      value={purchasedIng.unit}
                      onChange={e => updateIng(ci, 0, 'unit', e.target.value)}
                    >
                      <optgroup label="Weight">
                        <option value="oz">oz</option>
                        <option value="lb">lb</option>
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                      </optgroup>
                      <optgroup label="Volume">
                        <option value="fl_oz">fl oz</option>
                        <option value="cup">cup</option>
                        <option value="ml">ml</option>
                        <option value="l">l</option>
                      </optgroup>
                      <optgroup label="Count">
                        <option value="each">each</option>
                        <option value="bunch">bunch</option>
                        <option value="slice">slice</option>
                        <option value="sprig">sprig</option>
                        <option value="sheet">sheet</option>
                      </optgroup>
                    </select>
                    <span className="prm-purchased-field-lbl">Cost/$</span>
                    <input className="prm-purchased-cost-input" type="number" step="0.01" min="0"
                      value={purchasedIng.estimated_unit_cost}
                      onChange={e => updateIng(ci, 0, 'estimated_unit_cost', parseFloat(e.target.value) || 0)} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="prm-col-hd">
                    <span>Ingredient</span>
                    <span style={{ textAlign: 'right' }}>Qty</span>
                    <span style={{ textAlign: 'right' }}>Unit</span>
                    <span />
                  </div>
                  {comp.ingredients.map((ing, ii) => {
                    const key = `${ci}-${ii}`;
                    const displayVal = key in acSearch ? acSearch[key] : ing.name;
                    const acResults = getAcResults(displayVal);
                    const isOpen = !!acOpen[key] && acResults.length > 0;
                    return (
                      <div key={ii} className="prm-ing-row">
                        <div className="prm-ing-wrap">
                          <input
                            className="prm-ing-input"
                            value={displayVal}
                            placeholder="Search ingredient library..."
                            onChange={e => handleIngNameChange(ci, ii, e.target.value)}
                            onFocus={() => { setAcSearch(prev => ({ ...prev, [key]: ing.name })); setAcOpen(prev => ({ ...prev, [key]: true })); }}
                            onBlur={() => closeAc(key)}
                          />
                          {isOpen && (
                            <div
                              className="prm-ac-dropdown"
                              onMouseDown={() => { acMouseDown.current = true; }}
                              onMouseUp={() => { acMouseDown.current = false; }}
                            >
                              {acResults.map((lib, ri) => (
                                <div
                                  key={ri}
                                  className="prm-ac-item"
                                  onMouseDown={() => cancelCloseAc(key)}
                                  onClick={() => selectAcItem(ci, ii, lib)}
                                >
                                  <span className="prm-ac-name">{lib.name}</span>
                                  <span className="prm-ac-meta">{lib.unit} · ${lib.estimated_unit_cost?.toFixed(2) ?? '—'}/{lib.unit}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <input className="prm-qty-input" type="number" step="0.01" min="0" value={ing.quantity}
                          onChange={e => updateIng(ci, ii, 'quantity', parseFloat(e.target.value) || 0)} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                          <select
                            className="prm-unit-select"
                            value={ing.unit}
                            onChange={e => updateIng(ci, ii, 'unit', e.target.value)}
                          >
                            <optgroup label="Weight">
                              <option value="oz">oz</option>
                              <option value="lb">lb</option>
                              <option value="g">g</option>
                              <option value="kg">kg</option>
                            </optgroup>
                            <optgroup label="Volume">
                              <option value="fl_oz">fl oz</option>
                              <option value="cup">cup</option>
                              <option value="ml">ml</option>
                              <option value="l">l</option>
                            </optgroup>
                            <optgroup label="Count">
                              <option value="each">each</option>
                              <option value="bunch">bunch</option>
                              <option value="sprig">sprig</option>
                              <option value="sheet">sheet</option>
                            </optgroup>
                          </select>
                          {unitWarnings.has(`${current}-${ci}-${ii}`) && (
                            <span className="prm-unit-warn" title="Unit conversion not possible — verify cost manually">⚠</span>
                          )}
                        </div>
                        <button className="prm-ing-del" onClick={() => deleteIng(ci, ii)}>✕</button>
                      </div>
                    );
                  })}
                  <button className="prm-add-ing" onClick={() => addIng(ci)}>+ Add ingredient</button>
                </>
              )}
            </div>
          );
        })}

        <button className="prm-add-comp" onClick={addComp}>+ Add component</button>
      </>
    );
  }

  // ── Commit screen ─────────────────────────────────────────────────────────

  function renderCommitScreen() {
    const totalComps = dishes.reduce((s, d) => s + d.components.length, 0);
    const totalIngs = dishes.reduce((s, d) => s + d.components.reduce((ss, c) => ss + c.ingredients.length, 0), 0);
    const losing = dishes.filter(d => { const m = margin(d); return m !== null && m < 0; });
    return (
      <div className="prm-commit-screen">
        <div className="prm-commit-icon">✓</div>
        <div className="prm-commit-title">All dishes reviewed</div>
        <div className="prm-commit-sub">
          Review the summary below, then commit to your database.<br />
          This writes all dishes, components, and ingredients to Supabase.
        </div>
        <div className="prm-commit-summary">
          <div className="prm-summary-row"><span className="lbl">Dishes</span><span className="val">{dishes.length}</span></div>
          <div className="prm-summary-row"><span className="lbl">Components</span><span className="val">{totalComps}</span></div>
          <div className="prm-summary-row"><span className="lbl">Ingredients</span><span className="val">{totalIngs}</span></div>
          <div className="prm-summary-row">
            <span className="lbl">Losing money</span>
            <span className={`val${losing.length > 0 ? ' warn' : ''}`}>
              {losing.length > 0 ? `${losing.length} — ${losing.map(d => d.name).join(', ')}` : 'None ✓'}
            </span>
          </div>
        </div>
        {commitError && <div className="prm-commit-err">⚠ {commitError}</div>}
        <button className="prm-btn prm-btn-confirm" style={{ fontSize: 14, padding: '11px 32px' }}
          onClick={handleCommit} disabled={committing}>
          {committing ? <><span className="prm-spinner" />Saving...</> : 'Save to Menu'}
        </button>
        <button className="prm-btn prm-btn-ghost" style={{ marginTop: 10 }}
          onClick={() => setView('review')} disabled={committing}>
          ← Back to review
        </button>
      </div>
    );
  }

  // ── Shell ─────────────────────────────────────────────────────────────────

  const confirmedCount = confirmed.filter(Boolean).length;
  const pct = Math.round((confirmedCount / dishes.length) * 100);

  return (
    <>
      <style>{CSS}</style>
      <div className="prm-overlay">
        <div className="prm-shell">
          <div className="prm-topbar">
            <div className="prm-logo">Parse Review</div>
            <div>
              <div className="prm-topbar-meta">
                <strong>{confirmedCount}</strong> of <strong>{dishes.length}</strong> dishes confirmed
              </div>
              <div className="prm-prog-wrap">
                <div className="prm-prog-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <button className="prm-discard-btn" onClick={onClose}>✕ Discard & close</button>
          </div>

          <div className="prm-body">
            <div className="prm-sidebar">{renderSidebar()}</div>
            <div className="prm-main">
              {view === 'commit' ? renderCommitScreen() : (
                <>
                  <div className="prm-scroll">{renderDish()}</div>
                  <div className="prm-footer">
                    <div className="prm-nav">
                      <button className="prm-btn prm-btn-ghost" onClick={() => { setCurrent(c => c - 1); setAcSearch({}); setAcOpen({}); }} disabled={current === 0}>← Prev</button>
                      <button className="prm-btn prm-btn-ghost" onClick={() => { setCurrent(c => c + 1); setAcSearch({}); setAcOpen({}); }} disabled={current === dishes.length - 1}>Next →</button>
                      <button className="prm-btn prm-btn-ghost" style={{ color: '#c4473e', borderColor: '#f0c9c4' }} onClick={removeDish}>Remove dish</button>
                    </div>
                    {confirmed[current]
                      ? <div className="prm-confirmed-tag">✓ Confirmed</div>
                      : <button className="prm-btn prm-btn-confirm" onClick={confirmDish}>Confirm dish →</button>
                    }
                    <button className="prm-btn prm-btn-commit" onClick={() => setView('commit')} disabled={!allConfirmed}>
                      {allConfirmed ? 'Review & Commit →' : `${confirmedCount}/${dishes.length} confirmed`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}