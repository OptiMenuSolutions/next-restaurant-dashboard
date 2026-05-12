// components/ParseReviewModal.js
// Dish-by-dish review overlay that fires after MenuImportModal parse completes.
// Receives: { dishes, ingredient_library, restaurant_id }
// On commit: POSTs to /api/menu/commit-reviewed-menu, then calls onCommitted()

import React, { useState, useCallback } from 'react';

const CSS = `
  @keyframes prm-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes prm-spin { to { transform: rotate(360deg); } }

  .prm-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.85);
    z-index: 300; display: flex; align-items: stretch; justify-content: center;
    animation: prm-fadein .2s ease;
  }

  .prm-shell {
    width: 100%; max-width: 1080px; display: flex; flex-direction: column;
    background: #0a0908; font-family: 'Inter', sans-serif;
  }

  /* Top bar */
  .prm-topbar {
    background: #111110; border-bottom: 1px solid #1e1d1b;
    padding: 12px 24px; display: flex; align-items: center;
    justify-content: space-between; flex-shrink: 0;
  }
  .prm-logo {
    font-family: 'Playfair Display', serif; font-size: 16px;
    color: #02a4ba; letter-spacing: .02em;
  }
  .prm-topbar-center {
    font-size: 12px; color: #6b6560;
  }
  .prm-topbar-center strong { color: #c8c4be; }
  .prm-prog-wrap { width: 180px; background: #1a1917; height: 3px; border-radius: 2px; overflow: hidden; margin-top: 4px; }
  .prm-prog-fill { height: 100%; background: #02a4ba; border-radius: 2px; transition: width .3s; }

  /* Body */
  .prm-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }

  /* Sidebar */
  .prm-sidebar {
    width: 210px; background: #0d0c0b; border-right: 1px solid #1e1d1b;
    overflow-y: auto; flex-shrink: 0;
  }
  .prm-sidebar::-webkit-scrollbar { width: 2px; }
  .prm-sidebar::-webkit-scrollbar-thumb { background: #2a2620; }
  .prm-sb-section { border-bottom: 1px solid #161514; padding: 8px 0; }
  .prm-sb-cat {
    font-size: 9px; font-weight: 600; color: #3a3530;
    text-transform: uppercase; letter-spacing: .12em;
    padding: 4px 14px 5px;
  }
  .prm-sb-item {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 14px; font-size: 11px; color: #6b6560;
    cursor: pointer; transition: all .12s;
    border-left: 2px solid transparent;
  }
  .prm-sb-item:hover { background: #131211; color: #c8c4be; }
  .prm-sb-item.active { background: #131211; color: #02a4ba; border-left-color: #02a4ba; }
  .prm-sb-item.confirmed { color: #3d7a4d; }
  .prm-sb-dot { width: 5px; height: 5px; border-radius: 50%; background: #2a2620; flex-shrink: 0; }
  .prm-sb-dot.active { background: #02a4ba; }
  .prm-sb-dot.confirmed { background: #3d7a4d; }

  /* Main panel */
  .prm-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .prm-scroll { flex: 1; overflow-y: auto; padding: 20px 24px; }
  .prm-scroll::-webkit-scrollbar { width: 2px; }
  .prm-scroll::-webkit-scrollbar-thumb { background: #2a2620; }

  /* Dish header */
  .prm-dish-hd { margin-bottom: 14px; }
  .prm-dish-title {
    font-family: 'Playfair Display', serif; font-size: 20px;
    color: #e8e4df; margin-bottom: 6px;
  }
  .prm-dish-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .prm-badge {
    font-size: 10px; font-weight: 600; padding: 2px 8px;
    border-radius: 4px; letter-spacing: .02em;
  }
  .prm-badge-cat { background: #0d2a2e; color: #02a4ba; }
  .prm-badge-price { background: #0d1f14; color: #5aaa6a; }
  .prm-badge-margin-ok { background: #0d1f14; color: #5aaa6a; }
  .prm-badge-margin-warn { background: #2a1010; color: #cc5555; }
  .prm-badge-archetype { background: #1a1917; color: #6b6560; }

  /* Warning banner */
  .prm-warn {
    background: #1e0e0e; border: 1px solid #3a1818;
    border-radius: 6px; padding: 8px 12px; font-size: 11px;
    color: #cc7777; margin-bottom: 12px;
    display: flex; align-items: center; gap: 8px;
  }

  /* Component block */
  .prm-comp {
    background: #111110; border: 1px solid #1e1d1b;
    border-radius: 7px; margin-bottom: 8px; overflow: hidden;
  }
  .prm-comp-hd {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: #141312;
    border-bottom: 1px solid #1e1d1b;
  }
  .prm-comp-name-input {
    background: transparent; border: none; outline: none;
    font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 700;
    color: #02a4ba; text-transform: uppercase; letter-spacing: .1em;
    flex: 1; min-width: 0;
  }
  .prm-comp-name-input:focus {
    background: #1a1917; padding: 2px 5px; border-radius: 3px;
  }
  .prm-comp-cost { font-size: 10px; color: #4a4540; margin-left: auto; white-space: nowrap; }
  .prm-comp-del {
    background: none; border: none; color: #2a2520; cursor: pointer;
    font-size: 13px; padding: 0 2px; line-height: 1; transition: color .15s;
    flex-shrink: 0;
  }
  .prm-comp-del:hover { color: #cc5555; }

  /* Ingredient rows */
  .prm-col-hd {
    display: grid; grid-template-columns: 1fr 72px 64px 24px;
    gap: 8px; padding: 3px 12px 5px;
    font-size: 9px; color: #3a3530; text-transform: uppercase; letter-spacing: .1em;
  }
  .prm-ing-row {
    display: grid; grid-template-columns: 1fr 72px 64px 24px;
    gap: 8px; align-items: center; padding: 6px 12px;
    border-bottom: 1px solid #161514;
  }
  .prm-ing-row:last-child { border-bottom: none; }
  .prm-ing-input {
    background: transparent; border: none; outline: none;
    font-family: 'Inter', sans-serif; font-size: 12px; color: #c8c4be; width: 100%;
  }
  .prm-ing-input:focus {
    background: #1a1917; padding: 2px 6px; border-radius: 3px; color: #e8e4df;
  }
  .prm-qty-input {
    background: transparent; border: none; outline: none;
    font-family: 'Inter', sans-serif; font-size: 11px; color: #8a8480;
    text-align: right; width: 100%;
  }
  .prm-qty-input:focus {
    background: #1a1917; border-radius: 3px; padding: 2px 4px; color: #c8c4be;
  }
  .prm-unit-input {
    background: transparent; border: none; outline: none;
    font-family: 'Inter', sans-serif; font-size: 11px; color: #5a5550;
    text-align: right; width: 100%;
  }
  .prm-unit-input:focus {
    background: #1a1917; border-radius: 3px; padding: 2px 4px; color: #c8c4be;
  }
  .prm-ing-del {
    background: none; border: none; color: #2a2520; cursor: pointer;
    font-size: 12px; padding: 0; line-height: 1; transition: color .15s;
  }
  .prm-ing-del:hover { color: #cc5555; }
  .prm-add-ing {
    background: none; border: none; color: #2a3a3b; cursor: pointer;
    font-size: 10px; font-family: 'Inter', sans-serif;
    padding: 5px 12px; display: flex; align-items: center; gap: 4px;
    transition: color .15s; width: 100%;
  }
  .prm-add-ing:hover { color: #02a4ba; }

  /* Purchased / finished toggle */
  .prm-purchased-btn {
    background: none; border: 1px solid #2a2520; border-radius: 4px;
    font-size: 9px; font-weight: 600; color: #4a4540; cursor: pointer;
    padding: 2px 7px; font-family: 'Inter', sans-serif; white-space: nowrap;
    letter-spacing: .04em; transition: all .15s; flex-shrink: 0;
  }
  .prm-purchased-btn:hover { border-color: #c08020; color: #c08020; }
  .prm-purchased-btn.active { border-color: #c08020; color: #0a0908; background: #c08020; }
  .prm-purchased-row {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; background: #141008;
    border-top: 1px solid #2a1e08;
  }
  .prm-purchased-label { font-size: 11px; color: #c08020; font-style: italic; flex: 1; }
  .prm-purchased-cost-input {
    background: #1a1408; border: 1px solid #3a2a10; border-radius: 4px;
    padding: 4px 8px; font-size: 11px; color: #c8c4be; width: 80px;
    text-align: right; outline: none; font-family: 'Inter', sans-serif;
  }
  .prm-purchased-cost-input:focus { border-color: #c08020; }
  .prm-purchased-unit-input {
    background: #1a1408; border: 1px solid #3a2a10; border-radius: 4px;
    padding: 4px 8px; font-size: 11px; color: #8a8480; width: 56px;
    text-align: right; outline: none; font-family: 'Inter', sans-serif;
  }
  .prm-purchased-unit-input:focus { border-color: #c08020; }

  /* Add component */
  .prm-add-comp {
    width: 100%; background: none; border: 1px dashed #2a2520;
    border-radius: 7px; padding: 9px; font-size: 11px; color: #3a3530;
    font-family: 'Inter', sans-serif; cursor: pointer; margin-bottom: 16px;
    transition: all .15s; display: flex; align-items: center; justify-content: center; gap: 5px;
  }
  .prm-add-comp:hover { border-color: #02a4ba; color: #02a4ba; }

  /* Footer bar */
  .prm-footer {
    background: #0d0c0b; border-top: 1px solid #1e1d1b;
    padding: 11px 24px; display: flex; align-items: center;
    justify-content: space-between; flex-shrink: 0; gap: 10px;
  }
  .prm-nav { display: flex; gap: 6px; }
  .prm-btn {
    font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500;
    padding: 7px 14px; border-radius: 6px; cursor: pointer;
    transition: all .15s; border: none;
  }
  .prm-btn-ghost {
    background: transparent; border: 1px solid #2a2520; color: #6b6560;
  }
  .prm-btn-ghost:hover { border-color: #3a3530; color: #c8c4be; }
  .prm-btn-ghost:disabled { opacity: .35; cursor: default; }
  .prm-btn-confirm { background: #02a4ba; color: #0a0908; font-weight: 700; }
  .prm-btn-confirm:hover { background: #03b8d0; }
  .prm-btn-commit {
    background: #2d6b3c; color: #e8e4df; font-weight: 700;
    font-size: 13px; padding: 8px 18px;
  }
  .prm-btn-commit:hover { background: #3a8a4e; }
  .prm-btn-commit:disabled { background: #1a2a1e; color: #2a4a30; cursor: default; }
  .prm-confirmed-tag {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; color: #5aaa6a; padding: 4px 10px;
    background: #0d1f14; border-radius: 5px; border: 1px solid #1a3a22;
  }

  /* Commit screen */
  .prm-commit-screen {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; flex: 1; padding: 40px 24px; text-align: center;
  }
  .prm-commit-icon {
    width: 56px; height: 56px; border-radius: 50%;
    background: rgba(45,107,60,.15); border: 1px solid rgba(45,107,60,.3);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; margin-bottom: 16px;
  }
  .prm-commit-title {
    font-family: 'Playfair Display', serif; font-size: 20px;
    color: #e8e4df; margin-bottom: 6px;
  }
  .prm-commit-sub { font-size: 12px; color: #6b6560; margin-bottom: 20px; line-height: 1.6; }
  .prm-commit-summary {
    background: #111110; border: 1px solid #1e1d1b; border-radius: 8px;
    padding: 14px 18px; width: 100%; max-width: 360px; margin-bottom: 20px; text-align: left;
  }
  .prm-summary-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 12px; padding: 5px 0; border-bottom: 1px solid #161514;
  }
  .prm-summary-row:last-child { border-bottom: none; }
  .prm-summary-row .lbl { color: #6b6560; }
  .prm-summary-row .val { color: #c8c4be; font-weight: 600; }
  .prm-summary-row .val.warn { color: #cc5555; }
  .prm-spinner {
    width: 20px; height: 20px; border: 2px solid #1e1d1b;
    border-top-color: #02a4ba; border-radius: 50%;
    animation: prm-spin .7s linear infinite; display: inline-block; margin-right: 8px;
    vertical-align: middle;
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

export default function ParseReviewModal({ dishes: rawDishes, ingredientLibrary, restaurantId, onCommitted, onClose }) {
  const [dishes, setDishes] = useState(() => deepClone(rawDishes));
  const [confirmed, setConfirmed] = useState(() => new Array(rawDishes.length).fill(false));
  const [current, setCurrent] = useState(0);
  const [view, setView] = useState('review'); // 'review' | 'commit'
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');

  const allConfirmed = confirmed.every(Boolean);

  // ── Sidebar ──────────────────────────────────────────────────────────────

  const categories = [...new Set(dishes.map(d => d.category))];

  function renderSidebar() {
    return categories.map(cat => (
      <div key={cat} className="prm-sb-section">
        <div className="prm-sb-cat">{cat}</div>
        {dishes.map((d, i) => {
          if (d.category !== cat) return null;
          const isActive = i === current && view === 'review';
          const isDone = confirmed[i];
          return (
            <div
              key={i}
              className={`prm-sb-item${isActive ? ' active' : ''}${isDone ? ' confirmed' : ''}`}
              onClick={() => { setCurrent(i); setView('review'); }}
            >
              <div className={`prm-sb-dot${isActive ? ' active' : ''}${isDone ? ' confirmed' : ''}`} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              {isDone && <span style={{ fontSize: 10, color: '#3d7a4d' }}>✓</span>}
            </div>
          );
        })}
      </div>
    ));
  }

  // ── Dish mutations ────────────────────────────────────────────────────────

  const unconfirm = useCallback((idx) => {
    setConfirmed(prev => { const n = [...prev]; n[idx] = false; return n; });
  }, []);

  function updateCompName(ci, val) {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components[ci].name = val;
      return d;
    });
    unconfirm(current);
  }

  function updateIng(ci, ii, field, val) {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components[ci].ingredients[ii][field] = val;
      return d;
    });
    unconfirm(current);
  }

  function deleteIng(ci, ii) {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components[ci].ingredients.splice(ii, 1);
      return d;
    });
    unconfirm(current);
  }

  function deleteComp(ci) {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components.splice(ci, 1);
      return d;
    });
    unconfirm(current);
  }

  function addIng(ci) {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components[ci].ingredients.push({ name: 'New Ingredient', unit: 'oz', quantity: 1, estimated_unit_cost: 0 });
      return d;
    });
    unconfirm(current);
  }

  function addComp() {
    setDishes(prev => {
      const d = deepClone(prev);
      d[current].components.push({ name: 'New Component', ingredients: [{ name: 'New Ingredient', unit: 'oz', quantity: 1, estimated_unit_cost: 0 }] });
      return d;
    });
    unconfirm(current);
  }

  function markPurchased(ci) {
    setDishes(prev => {
      const d = deepClone(prev);
      const comp = d[current].components[ci];
      const isCurrentlyPurchased = comp.purchased === true;
      if (isCurrentlyPurchased) {
        // Toggle off — restore scratch ingredients placeholder
        comp.purchased = false;
        comp._savedIngredients = undefined;
        if (!comp.ingredients.length) {
          comp.ingredients = [{ name: 'New Ingredient', unit: 'oz', quantity: 1, estimated_unit_cost: 0 }];
        }
      } else {
        // Toggle on — collapse to single purchased ingredient named after the component
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

  function confirmDish() {
    setConfirmed(prev => { const n = [...prev]; n[current] = true; return n; });
    if (current < dishes.length - 1) setCurrent(c => c + 1);
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  async function handleCommit() {
    setCommitting(true);
    setCommitError('');
    try {
      const res = await fetch('/api/menu/commit-reviewed-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          dishes,
          ingredient_library: ingredientLibrary,
        }),
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
            <span className="prm-badge prm-badge-cat">{dish.category}</span>
            {dish.price && <span className="prm-badge prm-badge-price">${dish.price.toFixed(2)}</span>}
            {mgn !== null && (
              <span className={`prm-badge ${losing ? 'prm-badge-margin-warn' : 'prm-badge-margin-ok'}`}>
                {losing ? '⚠ ' : ''}{mgn.toFixed(1)}% margin
              </span>
            )}
            <span className="prm-badge prm-badge-archetype">{dish.archetype}</span>
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
                <input
                  className="prm-comp-name-input"
                  value={comp.name}
                  onChange={e => updateCompName(ci, e.target.value)}
                />
                <span className="prm-comp-cost">${cost.toFixed(2)}</span>
                <button
                  className={`prm-purchased-btn${isPurchased ? ' active' : ''}`}
                  onClick={() => markPurchased(ci)}
                  title={isPurchased ? 'Switch back to scratch ingredients' : 'Mark as finished/purchased product'}
                >
                  {isPurchased ? '✓ Purchased' : 'Purchased?'}
                </button>
                <button className="prm-comp-del" onClick={() => deleteComp(ci)} title="Remove component">✕</button>
              </div>

              {isPurchased ? (
                <div className="prm-purchased-row">
                  <span className="prm-purchased-label">Purchased as finished product — matches invoice line item</span>
                  <input
                    className="prm-purchased-unit-input"
                    value={purchasedIng.unit}
                    onChange={e => updateIng(ci, 0, 'unit', e.target.value)}
                    title="Unit"
                  />
                  <input
                    className="prm-purchased-cost-input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={purchasedIng.estimated_unit_cost}
                    onChange={e => updateIng(ci, 0, 'estimated_unit_cost', parseFloat(e.target.value) || 0)}
                    title="Unit cost"
                  />
                </div>
              ) : (
                <>
                  <div className="prm-col-hd">
                    <span>Ingredient</span>
                    <span style={{ textAlign: 'right' }}>Qty</span>
                    <span style={{ textAlign: 'right' }}>Unit</span>
                    <span />
                  </div>
                  {comp.ingredients.map((ing, ii) => (
                    <div key={ii} className="prm-ing-row">
                      <input
                        className="prm-ing-input"
                        value={ing.name}
                        onChange={e => updateIng(ci, ii, 'name', e.target.value)}
                      />
                      <input
                        className="prm-qty-input"
                        type="number"
                        step="0.01"
                        min="0"
                        value={ing.quantity}
                        onChange={e => updateIng(ci, ii, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                      <input
                        className="prm-unit-input"
                        value={ing.unit}
                        onChange={e => updateIng(ci, ii, 'unit', e.target.value)}
                      />
                      <button className="prm-ing-del" onClick={() => deleteIng(ci, ii)}>✕</button>
                    </div>
                  ))}
                  <button className="prm-add-ing" onClick={() => addIng(ci)}>+ ingredient</button>
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
          This will write all dishes, components, and ingredients to Supabase.
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
        {commitError && (
          <div style={{ background: '#1e0e0e', border: '1px solid #3a1818', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#cc7777', marginBottom: 16, maxWidth: 360, width: '100%' }}>
            ⚠ {commitError}
          </div>
        )}
        <button
          className="prm-btn prm-btn-commit"
          onClick={handleCommit}
          disabled={committing}
          style={{ fontSize: 14, padding: '10px 28px' }}
        >
          {committing
            ? <><span className="prm-spinner" />Writing to database...</>
            : 'Commit to Supabase'}
        </button>
        <button
          className="prm-btn prm-btn-ghost"
          onClick={() => setView('review')}
          style={{ marginTop: 10 }}
          disabled={committing}
        >
          ← Back to review
        </button>
      </div>
    );
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  const confirmedCount = confirmed.filter(Boolean).length;
  const pct = Math.round((confirmedCount / dishes.length) * 100);

  return (
    <>
      <style>{CSS}</style>
      <div className="prm-overlay">
        <div className="prm-shell">

          {/* Top bar */}
          <div className="prm-topbar">
            <div className="prm-logo">Parse Review</div>
            <div style={{ textAlign: 'center' }}>
              <div className="prm-topbar-center">
                <strong>{confirmedCount}</strong> of <strong>{dishes.length}</strong> dishes confirmed
              </div>
              <div className="prm-prog-wrap">
                <div className="prm-prog-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <button
              className="prm-btn prm-btn-ghost"
              onClick={onClose}
              style={{ fontSize: 11 }}
            >
              ✕ Discard & close
            </button>
          </div>

          {/* Body */}
          <div className="prm-body">
            <div className="prm-sidebar">{renderSidebar()}</div>

            <div className="prm-main">
              {view === 'commit' ? (
                renderCommitScreen()
              ) : (
                <>
                  <div className="prm-scroll">{renderDish()}</div>
                  <div className="prm-footer">
                    <div className="prm-nav">
                      <button
                        className="prm-btn prm-btn-ghost"
                        onClick={() => setCurrent(c => c - 1)}
                        disabled={current === 0}
                      >← Prev</button>
                      <button
                        className="prm-btn prm-btn-ghost"
                        onClick={() => setCurrent(c => c + 1)}
                        disabled={current === dishes.length - 1}
                      >Next →</button>
                    </div>

                    {confirmed[current]
                      ? <div className="prm-confirmed-tag">✓ Confirmed</div>
                      : <button className="prm-btn prm-btn-confirm" onClick={confirmDish}>Confirm dish →</button>
                    }

                    <button
                      className="prm-btn prm-btn-commit"
                      onClick={() => setView('commit')}
                      disabled={!allConfirmed}
                    >
                      {allConfirmed
                        ? 'Review & Commit →'
                        : `${confirmedCount}/${dishes.length} confirmed`}
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