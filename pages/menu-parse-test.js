// pages/menu-parse-test.js
// Standalone test harness for the menu parser.
// No auth required, no Supabase writes. Access at /menu-parse-test
// Remove or route-protect this page before going to production.

import React, { useState, useRef } from 'react';

function formatCurrency(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return parseFloat(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getMarginColor(margin) {
  if (margin === null || margin === undefined) return '#4a453e';
  if (margin >= 70) return '#2a8a5a';
  if (margin >= 50) return '#02a4ba';
  if (margin >= 30) return '#d4a020';
  return '#c04040';
}

const CAT_COLORS = ['#02a4ba', '#d4a020', '#2a8a5a', '#c04040', '#9b7ee8', '#e85e8a', '#4a9ede', '#e8a24a'];

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; background: #0a0908; color: #e8e2d8; font-family: 'Inter', sans-serif; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f0e0c; } ::-webkit-scrollbar-thumb { background: #2a2620; border-radius: 2px; }

  .mpt-root { max-width: 1100px; margin: 0 auto; padding: 32px 20px 80px; }

  /* HEADER */
  .mpt-header { margin-bottom: 32px; }
  .mpt-logo { font-family: 'Playfair Display', serif; font-size: 22px; color: #e8e2d8; letter-spacing: -.3px; margin-bottom: 6px; }
  .mpt-logo span { color: #02a4ba; }
  .mpt-title { font-family: 'Playfair Display', serif; font-size: 28px; color: #e8e2d8; margin-bottom: 6px; }
  .mpt-sub { font-size: 13px; color: #4a453e; line-height: 1.6; }
  .mpt-warn { display: inline-flex; align-items: center; gap: 7px; margin-top: 10px; background: rgba(212,160,32,.08); border: 1px solid rgba(212,160,32,.2); border-radius: 8px; padding: 6px 12px; font-size: 12px; color: #d4a020; }
  .mpt-warn-dot { width: 6px; height: 6px; border-radius: 50%; background: #d4a020; flex-shrink: 0; }

  /* UPLOAD ZONE */
  .mpt-upload { background: #13120f; border: 2px dashed #2a2620; border-radius: 12px; padding: 48px 32px; text-align: center; cursor: pointer; transition: all .2s; margin-bottom: 16px; }
  .mpt-upload:hover, .mpt-upload.drag { border-color: #02a4ba; background: rgba(2,164,186,.04); }
  .mpt-upload-icon { width: 56px; height: 56px; border-radius: 50%; background: rgba(2,164,186,.08); border: 1px solid rgba(2,164,186,.2); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
  .mpt-upload-icon svg { width: 26px; height: 26px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mpt-upload-title { font-size: 17px; font-weight: 600; color: #e8e2d8; margin-bottom: 8px; }
  .mpt-upload-sub { font-size: 13px; color: #4a453e; margin-bottom: 20px; line-height: 1.6; }
  .mpt-upload-btn { background: #02a4ba; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif; transition: background .2s; }
  .mpt-upload-btn:hover { background: #01bcd4; }

  /* PARSING STATE */
  .mpt-parsing { background: #13120f; border: 1px solid #2a2620; border-radius: 12px; padding: 60px 32px; text-align: center; margin-bottom: 16px; animation: fadeIn .3s ease; }
  .mpt-spinner { width: 36px; height: 36px; border: 3px solid #2a2620; border-top-color: #02a4ba; border-radius: 50%; animation: spin .7s linear infinite; margin: 0 auto 20px; }
  .mpt-parsing-label { font-size: 16px; color: #9a9086; margin-bottom: 8px; font-weight: 500; }
  .mpt-parsing-sub { font-size: 13px; color: #4a453e; }
  .mpt-parsing-file { font-size: 12px; color: #02a4ba; margin-top: 8px; font-weight: 500; }

  /* ERROR */
  .mpt-error { background: rgba(192,64,64,.08); border: 1px solid rgba(192,64,64,.2); border-radius: 10px; padding: 14px 18px; font-size: 13px; color: #c04040; margin-bottom: 16px; }

  /* SUMMARY BAR */
  .mpt-summary { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; padding: 16px 20px; display: flex; gap: 32px; flex-wrap: wrap; margin-bottom: 20px; animation: fadeIn .3s ease; }
  .mpt-summary-stat { flex-shrink: 0; }
  .mpt-summary-val { font-family: 'Playfair Display', serif; font-size: 22px; line-height: 1; }
  .mpt-summary-lbl { font-size: 10px; color: #4a453e; margin-top: 3px; text-transform: uppercase; letter-spacing: .6px; }
  .mpt-summary-cats { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; flex: 1; }
  .mpt-cat-pill { font-size: 11px; padding: 3px 10px; border-radius: 20px; font-weight: 500; }

  /* FILTER BAR */
  .mpt-filterbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }
  .mpt-filter-btn { background: #13120f; border: 1px solid #2a2620; border-radius: 20px; padding: 5px 14px; font-size: 12px; color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .mpt-filter-btn:hover { color: #9a9086; border-color: #3a3630; }
  .mpt-filter-btn.active { color: #e8e2d8; background: #1a1915; border-color: #3a3630; }
  .mpt-search { background: #13120f; border: 1px solid #2a2620; border-radius: 8px; padding: 7px 12px; font-size: 13px; color: #e8e2d8; outline: none; font-family: 'Inter', sans-serif; width: 220px; margin-left: auto; }
  .mpt-search:focus { border-color: #02a4ba; }
  .mpt-search::placeholder { color: #3a3630; }

  /* RESULTS GRID */
  .mpt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }

  /* DISH CARD */
  .mpt-card { background: #13120f; border: 1px solid #2a2620; border-radius: 10px; overflow: hidden; animation: fadeIn .25s ease; transition: border-color .15s; }
  .mpt-card:hover { border-color: #3a3630; }
  .mpt-card-hd { padding: 14px 16px 12px; border-bottom: 1px solid #1a1915; }
  .mpt-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
  .mpt-card-name { font-size: 15px; font-weight: 600; color: #e8e2d8; line-height: 1.3; flex: 1; }
  .mpt-card-price { font-family: 'Playfair Display', serif; font-size: 17px; color: #02a4ba; flex-shrink: 0; }
  .mpt-card-desc { font-size: 11px; color: #6b6358; line-height: 1.5; margin-bottom: 8px; }
  .mpt-card-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .mpt-card-cat { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: .5px; }
  .mpt-card-cost-row { display: flex; gap: 12px; margin-top: 6px; }
  .mpt-card-cost-item { font-size: 11px; }
  .mpt-card-cost-lbl { color: #4a453e; }
  .mpt-card-cost-val { font-weight: 600; margin-left: 4px; }

  /* COMPONENTS */
  .mpt-comps { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
  .mpt-comp { background: #0f0e0c; border: 1px solid #1a1915; border-radius: 7px; overflow: hidden; }
  .mpt-comp-hd { padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background .15s; user-select: none; }
  .mpt-comp-hd:hover { background: #1a1915; }
  .mpt-comp-name { font-size: 12px; font-weight: 600; color: #9a9086; text-transform: uppercase; letter-spacing: .6px; display: flex; align-items: center; gap: 6px; }
  .mpt-comp-name-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .mpt-comp-cost { font-size: 12px; font-weight: 600; color: #02a4ba; }
  .mpt-comp-chevron { font-size: 10px; color: #3a3630; transition: transform .2s; }
  .mpt-comp-chevron.open { transform: rotate(180deg); }
  .mpt-comp-ings { border-top: 1px solid #1a1915; }
  .mpt-ing-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; padding: 7px 12px; border-bottom: 1px solid #0a0908; align-items: center; }
  .mpt-ing-row:last-child { border-bottom: none; }
  .mpt-ing-name { font-size: 12px; color: #9a9086; }
  .mpt-ing-qty { font-size: 11px; color: #4a453e; text-align: right; white-space: nowrap; }
  .mpt-ing-cost { font-size: 12px; font-weight: 600; color: #6b6358; text-align: right; white-space: nowrap; }

  /* CARD FOOTER */
  .mpt-card-ft { padding: 10px 16px; background: #0f0e0c; border-top: 1px solid #1a1915; display: flex; justify-content: space-between; align-items: center; }
  .mpt-margin-lbl { font-size: 11px; color: #4a453e; }
  .mpt-margin-val { font-size: 13px; font-weight: 700; }
  .mpt-margin-bar-wrap { flex: 1; margin: 0 12px; background: #1a1915; border-radius: 3px; height: 4px; }
  .mpt-margin-bar { height: 4px; border-radius: 3px; }

  /* RESET */
  .mpt-reset-btn { background: none; border: 1px solid #2a2620; border-radius: 8px; padding: 8px 16px; font-size: 13px; color: #4a453e; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
  .mpt-reset-btn:hover { color: #9a9086; border-color: #3a3630; }

  /* EMPTY */
  .mpt-empty { text-align: center; padding: 48px; color: #4a453e; font-size: 14px; }
`;

const COMP_COLORS = ['#02a4ba', '#d4a020', '#2a8a5a', '#9b7ee8', '#e85e8a', '#4a9ede'];

export default function MenuParseTest() {
  const [stage, setStage] = useState('upload'); // upload | parsing | results | error
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [expandedComps, setExpandedComps] = useState({});
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const fileRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setError('Please upload a JPG, PNG, or PDF file.');
      return;
    }
    setError('');
    setFileName(file.name);
    setStage('parsing');
    setResults(null);
    setExpandedComps({});
    setActiveCategory('All');
    setSearch('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/menu/parse-menu-test', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      if (!data.dishes || data.dishes.length === 0) {
        setError('No menu items found. Try a clearer photo or a different page.');
        setStage('upload');
        return;
      }
      setResults(data);
      setStage('results');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setStage('error');
    }
  }

  function toggleComp(dishIdx, compIdx) {
    const key = `${dishIdx}-${compIdx}`;
    setExpandedComps(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function reset() {
    setStage('upload');
    setResults(null);
    setError('');
    setFileName('');
    setExpandedComps({});
    setActiveCategory('All');
    setSearch('');
  }

  const categories = results ? ['All', ...results.summary.categories] : [];

  const filtered = results ? results.dishes.filter(d => {
    const catMatch = activeCategory === 'All' || d.category === activeCategory;
    const searchMatch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || (d.category || '').toLowerCase().includes(search.toLowerCase());
    return catMatch && searchMatch;
  }) : [];

  return (
    <>
      <style>{CSS}</style>
      <div className="mpt-root">

        {/* HEADER */}
        <div className="mpt-header">
          <div className="mpt-logo">Opti<span>Menu</span></div>
          <div className="mpt-title">Menu Parser — Test Harness</div>
          <div className="mpt-sub">
            Upload any menu (PDF or photo) to see what Claude extracts — dish names, prices, categories,
            estimated recipe components, and ingredient cost estimates. Nothing is saved to the database.
          </div>
          <div className="mpt-warn">
            <div className="mpt-warn-dot" />
            Dry run only — no Supabase writes. Remove this page before going to production.
          </div>
        </div>

        {/* UPLOAD */}
        {(stage === 'upload' || stage === 'error') && (
          <>
            <div
              className={`mpt-upload${dragging ? ' drag' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])} />
              <div className="mpt-upload-icon">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <div className="mpt-upload-title">Drop a menu here</div>
              <div className="mpt-upload-sub">
                JPG, PNG, or PDF up to 20MB. Multi-page PDFs supported (up to 6 pages).<br />
                Claude will extract every item and estimate full recipe components and ingredient costs.
              </div>
              <button className="mpt-upload-btn" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
                Choose File
              </button>
            </div>
            {error && <div className="mpt-error">⚠ {error}</div>}
          </>
        )}

        {/* PARSING */}
        {stage === 'parsing' && (
          <div className="mpt-parsing">
            <div className="mpt-spinner" />
            <div className="mpt-parsing-label">Claude is reading your menu...</div>
            <div className="mpt-parsing-sub">Extracting dishes, estimating recipes and ingredient costs. Takes 20–45 seconds.</div>
            {fileName && <div className="mpt-parsing-file">{fileName}</div>}
          </div>
        )}

        {/* RESULTS */}
        {stage === 'results' && results && (
          <>
            {/* Summary bar */}
            <div className="mpt-summary">
              <div className="mpt-summary-stat">
                <div className="mpt-summary-val" style={{ color: '#02a4ba' }}>{results.count}</div>
                <div className="mpt-summary-lbl">Items Found</div>
              </div>
              <div className="mpt-summary-stat">
                <div className="mpt-summary-val" style={{ color: '#2a8a5a' }}>{results.summary.categories.length}</div>
                <div className="mpt-summary-lbl">Categories</div>
              </div>
              <div className="mpt-summary-stat">
                <div className="mpt-summary-val" style={{ color: '#d4a020' }}>{formatCurrency(results.summary.avg_estimated_cost)}</div>
                <div className="mpt-summary-lbl">Avg Est. Cost</div>
              </div>
              {results.summary.avg_estimated_margin !== null && (
                <div className="mpt-summary-stat">
                  <div className="mpt-summary-val" style={{ color: getMarginColor(results.summary.avg_estimated_margin) }}>
                    {results.summary.avg_estimated_margin}%
                  </div>
                  <div className="mpt-summary-lbl">Avg Est. Margin</div>
                </div>
              )}
              <div className="mpt-summary-cats">
                {results.summary.categories.map((cat, i) => (
                  <div key={cat} className="mpt-cat-pill" style={{
                    background: `${CAT_COLORS[i % CAT_COLORS.length]}18`,
                    color: CAT_COLORS[i % CAT_COLORS.length],
                    border: `1px solid ${CAT_COLORS[i % CAT_COLORS.length]}30`,
                  }}>{cat}</div>
                ))}
              </div>
            </div>

            {/* Filter bar */}
            <div className="mpt-filterbar">
              {categories.map(cat => (
                <button key={cat} className={`mpt-filter-btn${activeCategory === cat ? ' active' : ''}`}
                  onClick={() => setActiveCategory(cat)}>
                  {cat}
                </button>
              ))}
              <input className="mpt-search" placeholder="Search dishes..." value={search}
                onChange={e => setSearch(e.target.value)} />
              <button className="mpt-reset-btn" onClick={reset}>↑ New Menu</button>
            </div>

            {/* Grid */}
            {filtered.length === 0 ? (
              <div className="mpt-empty">No dishes match your filter.</div>
            ) : (
              <div className="mpt-grid">
                {filtered.map((dish, dishIdx) => {
                  const catColorIdx = results.summary.categories.indexOf(dish.category) % CAT_COLORS.length;
                  const catColor = CAT_COLORS[catColorIdx < 0 ? 0 : catColorIdx];
                  const globalDishIdx = results.dishes.indexOf(dish);

                  return (
                    <div key={globalDishIdx} className="mpt-card">

                      {/* Card header */}
                      <div className="mpt-card-hd">
                        <div className="mpt-card-top">
                          <div className="mpt-card-name">{dish.name}</div>
                          {dish.price !== null && (
                            <div className="mpt-card-price">{formatCurrency(dish.price)}</div>
                          )}
                        </div>
                        {dish.description && (
                          <div className="mpt-card-desc">{dish.description}</div>
                        )}
                        <div className="mpt-card-meta">
                          <div className="mpt-card-cat" style={{
                            background: `${catColor}18`,
                            color: catColor,
                            border: `1px solid ${catColor}30`,
                          }}>{dish.category}</div>
                        </div>
                        <div className="mpt-card-cost-row">
                          <div className="mpt-card-cost-item">
                            <span className="mpt-card-cost-lbl">Est. Cost</span>
                            <span className="mpt-card-cost-val" style={{ color: '#9a9086' }}>
                              {formatCurrency(dish.total_estimated_cost)}
                            </span>
                          </div>
                          {dish.estimated_margin !== null && (
                            <div className="mpt-card-cost-item">
                              <span className="mpt-card-cost-lbl">Est. Margin</span>
                              <span className="mpt-card-cost-val" style={{ color: getMarginColor(dish.estimated_margin) }}>
                                {dish.estimated_margin}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Components */}
                      {dish.components && dish.components.length > 0 && (
                        <div className="mpt-comps">
                          {dish.components.map((comp, compIdx) => {
                            const key = `${globalDishIdx}-${compIdx}`;
                            const isOpen = expandedComps[key] !== false; // default open
                            const color = COMP_COLORS[compIdx % COMP_COLORS.length];
                            return (
                              <div key={compIdx} className="mpt-comp">
                                <div className="mpt-comp-hd" onClick={() => toggleComp(globalDishIdx, compIdx)}>
                                  <div className="mpt-comp-name">
                                    <div className="mpt-comp-name-dot" style={{ background: color }} />
                                    {comp.name}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div className="mpt-comp-cost">{formatCurrency(comp.component_cost)}</div>
                                    <div className={`mpt-comp-chevron${isOpen ? ' open' : ''}`}>▼</div>
                                  </div>
                                </div>
                                {isOpen && comp.ingredients && comp.ingredients.length > 0 && (
                                  <div className="mpt-comp-ings">
                                    {comp.ingredients.map((ing, ingIdx) => (
                                      <div key={ingIdx} className="mpt-ing-row">
                                        <div className="mpt-ing-name">{ing.name}</div>
                                        <div className="mpt-ing-qty">
                                          {ing.quantity} {ing.unit} @ {formatCurrency(ing.estimated_unit_cost)}/{ing.unit}
                                        </div>
                                        <div className="mpt-ing-cost">{formatCurrency(ing.estimated_total_cost)}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Card footer margin bar */}
                      {dish.estimated_margin !== null && (
                        <div className="mpt-card-ft">
                          <div className="mpt-margin-lbl">Margin</div>
                          <div className="mpt-margin-bar-wrap">
                            <div className="mpt-margin-bar" style={{
                              width: `${Math.max(0, Math.min(100, dish.estimated_margin))}%`,
                              background: getMarginColor(dish.estimated_margin),
                            }} />
                          </div>
                          <div className="mpt-margin-val" style={{ color: getMarginColor(dish.estimated_margin) }}>
                            {dish.estimated_margin}%
                          </div>
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </>
  );
}