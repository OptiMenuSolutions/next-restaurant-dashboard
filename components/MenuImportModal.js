// components/MenuImportModal.js
import React, { useState, useRef } from 'react';

const MODAL_CSS = `
  .mim-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 200;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .mim-box {
    background: #13120f; border: 1px solid #2a2620; border-radius: 14px;
    width: 100%; max-width: 680px; max-height: 85vh; display: flex; flex-direction: column;
    overflow: hidden; font-family: 'Inter', sans-serif;
  }
  .mim-hd {
    padding: 18px 20px; border-bottom: 1px solid #2a2620;
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
  }
  .mim-title { font-family: 'Playfair Display', serif; font-size: 18px; color: #e8e2d8; }
  .mim-close {
    background: none; border: 1px solid #2a2620; border-radius: 6px;
    padding: 4px 10px; font-size: 12px; color: #4a453e; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: all .15s;
  }
  .mim-close:hover { color: #e8e2d8; border-color: #3a3630; }
  .mim-body { flex: 1; overflow-y: auto; padding: 20px; }

  /* DROP ZONE */
  .mim-drop {
    border: 2px dashed #2a2620; border-radius: 10px; padding: 32px 20px;
    text-align: center; cursor: pointer; transition: all .2s;
  }
  .mim-drop:hover, .mim-drop.drag { border-color: #02a4ba; background: rgba(2,164,186,.04); }
  .mim-drop-icon {
    margin: 0 auto 14px; width: 48px; height: 48px; border-radius: 50%;
    background: rgba(2,164,186,.08); border: 1px solid rgba(2,164,186,.2);
    display: flex; align-items: center; justify-content: center;
  }
  .mim-drop-icon svg { width: 22px; height: 22px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mim-drop-title { font-size: 15px; font-weight: 600; color: #e8e2d8; margin-bottom: 6px; }
  .mim-drop-sub { font-size: 12px; color: #4a453e; margin-bottom: 16px; line-height: 1.5; }
  .mim-drop-btn {
    background: #02a4ba; border: none; border-radius: 7px; padding: 9px 20px;
    font-size: 13px; font-weight: 600; color: #0a0908; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: background .2s;
  }
  .mim-drop-btn:hover { background: #01bcd4; }

  /* FILE LIST */
  .mim-file-list { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
  .mim-file-row {
    display: flex; align-items: center; gap: 10px;
    background: #0f0e0c; border: 1px solid #2a2620; border-radius: 8px;
    padding: 9px 12px;
  }
  .mim-file-icon { flex-shrink: 0; }
  .mim-file-icon svg { width: 14px; height: 14px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mim-file-name { flex: 1; font-size: 12px; color: #e8e2d8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mim-file-size { font-size: 11px; color: #4a453e; flex-shrink: 0; }
  .mim-file-remove {
    background: none; border: none; color: #3a3630; cursor: pointer;
    font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 3px;
    transition: color .15s; flex-shrink: 0;
  }
  .mim-file-remove:hover { color: #c04040; }
  .mim-add-more {
    margin-top: 10px; background: none; border: 1px dashed #2a2620; border-radius: 7px;
    padding: 8px; width: 100%; font-size: 12px; color: #4a453e; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: all .15s; text-align: center;
  }
  .mim-add-more:hover { border-color: #02a4ba; color: #02a4ba; }

  /* PROGRESS */
  .mim-progress { text-align: center; padding: 32px 0; }
  .mim-spinner {
    width: 32px; height: 32px; border: 3px solid #2a2620; border-top-color: #02a4ba;
    border-radius: 50%; animation: mimSpin .7s linear infinite; margin: 0 auto 16px;
  }
  @keyframes mimSpin { to { transform: rotate(360deg); } }
  .mim-progress-label { font-size: 14px; color: #9a9086; margin-bottom: 6px; font-weight: 500; }
  .mim-progress-sub { font-size: 12px; color: #4a453e; line-height: 1.6; }
  .mim-progress-steps { margin-top: 20px; display: flex; flex-direction: column; gap: 8px; text-align: left; max-width: 320px; margin-left: auto; margin-right: auto; }
  .mim-step { display: flex; align-items: center; gap: 10px; font-size: 12px; }
  .mim-step-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .mim-step-dot.done { background: #2a8a5a; }
  .mim-step-dot.active { background: #02a4ba; animation: mimPulse 1s ease-in-out infinite; }
  .mim-step-dot.pending { background: #2a2620; }
  @keyframes mimPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .mim-step-label { color: #6b6358; }
  .mim-step-label.active { color: #e8e2d8; }
  .mim-step-label.done { color: #2a8a5a; }

  /* ESTIMATED COST NOTICE */
  .mim-est-notice {
    display: flex; align-items: flex-start; gap: 10px;
    background: rgba(212,160,32,.06); border: 1px solid rgba(212,160,32,.2);
    border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; font-size: 12px; color: #d4a020; line-height: 1.55;
  }
  .mim-est-notice-icon { flex-shrink: 0; margin-top: 1px; }

  /* RESULTS */
  .mim-results-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
  .mim-result-stat { background: #0f0e0c; border: 1px solid #1a1915; border-radius: 8px; padding: 12px; text-align: center; }
  .mim-result-val { font-family: 'Playfair Display', serif; font-size: 22px; line-height: 1; margin-bottom: 4px; }
  .mim-result-lbl { font-size: 10px; color: #4a453e; text-transform: uppercase; letter-spacing: .5px; }

  .mim-dish-list { display: flex; flex-direction: column; gap: 6px; }
  .mim-dish-row {
    background: #0f0e0c; border: 1px solid #1a1915; border-radius: 7px;
    padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  }
  .mim-dish-name { font-size: 13px; color: #e8e2d8; font-weight: 500; flex: 1; }
  .mim-dish-meta { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
  .mim-dish-price { font-size: 12px; color: #02a4ba; font-weight: 600; }
  .mim-dish-cost { font-size: 11px; color: #6b6358; }
  .mim-dish-cat { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(2,164,186,.08); color: #02a4ba; border: 1px solid rgba(2,164,186,.15); }
  .mim-dish-margin { font-size: 11px; font-weight: 600; }

  .mim-save-errors { margin-top: 14px; background: rgba(192,64,64,.06); border: 1px solid rgba(192,64,64,.15); border-radius: 8px; padding: 10px 14px; }
  .mim-save-errors-title { font-size: 11px; font-weight: 600; color: #c04040; margin-bottom: 6px; }
  .mim-save-errors li { font-size: 11px; color: #9a4040; margin-left: 14px; margin-bottom: 3px; }

  /* ERROR */
  .mim-error {
    font-size: 12px; color: #c04040; margin-top: 12px; padding: 10px 14px;
    background: rgba(192,64,64,.08); border: 1px solid rgba(192,64,64,.2); border-radius: 7px;
  }

  /* FOOTER */
  .mim-ft {
    padding: 14px 20px; border-top: 1px solid #2a2620;
    display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0; gap: 10px;
  }
  .mim-ft-left { font-size: 12px; color: #4a453e; }
  .mim-ft-right { display: flex; gap: 10px; }
  .mim-btn-ghost {
    background: none; border: 1px solid #2a2620; border-radius: 7px;
    padding: 9px 16px; font-size: 13px; color: #4a453e; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: all .15s;
  }
  .mim-btn-ghost:hover { color: #9a9086; border-color: #3a3630; }
  .mim-btn-primary {
    background: #02a4ba; border: none; border-radius: 7px; padding: 9px 20px;
    font-size: 13px; font-weight: 600; color: #0a0908; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: background .2s;
  }
  .mim-btn-primary:hover { background: #01bcd4; }
  .mim-btn-primary:disabled { background: #2a2620; color: #4a453e; cursor: not-allowed; }
`;

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function StepIndicator({ steps, currentStep }) {
  return (
    <div className="mim-progress-steps">
      {steps.map((label, i) => {
        const state = i < currentStep ? 'done' : i === currentStep ? 'active' : 'pending';
        return (
          <div key={label} className="mim-step">
            <div className={`mim-step-dot ${state}`} />
            <div className={`mim-step-label ${state}`}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

const PARSE_STEPS = [
  'Reading menu images',
  'Building ingredient library',
  'Classifying dishes',
  'Building recipes',
  'Saving to your account',
];

export default function MenuImportModal({ restaurantId, onClose, onImported }) {
  const [stage, setStage] = useState('upload'); // upload | parsing | results
  const [dragging, setDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]); // Array of File objects
  const [parseStep, setParseStep] = useState(0);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();
  const stepTimerRef = useRef(null);

  // ── File management ──────────────────────────────────────────────────────────

  function validateAndAddFiles(incoming) {
    const newFiles = [];
    const errors = [];

    for (const file of incoming) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`"${file.name}" is not a supported type (JPG, PNG, WEBP, or PDF).`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`"${file.name}" exceeds the 20MB limit.`);
        continue;
      }
      // Deduplicate by name + size
      const isDupe = selectedFiles.some(f => f.name === file.name && f.size === file.size);
      if (!isDupe) newFiles.push(file);
    }

    if (errors.length > 0) setError(errors.join(' '));
    else setError('');

    setSelectedFiles(prev => [...prev, ...newFiles]);
  }

  function removeFile(idx) {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
    setError('');
  }

  function handleInputChange(e) {
    validateAndAddFiles(Array.from(e.target.files));
    // Reset input so the same file can be re-added after removal
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    validateAndAddFiles(Array.from(e.dataTransfer.files));
  }

  // ── Step animation ───────────────────────────────────────────────────────────

  function startStepAnimation(fileCount) {
    setParseStep(0);
    let step = 0;
    // Scale delay slightly for multiple files since there's more image data to process
    const base = fileCount > 1 ? 10000 : 8000;
    const delays = [base, base + 2000, base + 2000, base, 2000];
    function advance() {
      step++;
      if (step < PARSE_STEPS.length) {
        setParseStep(step);
        if (step < delays.length) {
          stepTimerRef.current = setTimeout(advance, delays[step]);
        }
      }
    }
    stepTimerRef.current = setTimeout(advance, delays[0]);
  }

  function clearStepAnimation() {
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (selectedFiles.length === 0) {
      setError('Please add at least one file.');
      return;
    }
    if (!restaurantId) {
      setError('Restaurant not found. Please refresh and try again.');
      return;
    }

    setError('');
    setResults(null);
    setStage('parsing');
    startStepAnimation(selectedFiles.length);

    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append('file', file); // multiple values under the same key
    }
    formData.append('restaurant_id', restaurantId);

    try {
      const res = await fetch('/api/menu/parse-menu', { method: 'POST', body: formData });
      const data = await res.json();

      clearStepAnimation();
      setParseStep(PARSE_STEPS.length - 1);

      if (!res.ok) throw new Error(data.error || 'Parse failed');
      if (!data.dishes || data.dishes.length === 0) {
        setError('No menu items found. Try clearer photos or a different page.');
        setStage('upload');
        return;
      }

      setResults(data);
      setStage('results');
    } catch (err) {
      clearStepAnimation();
      setError(err.message || 'Something went wrong. Please try again.');
      setStage('upload');
    }
  }

  // ── Reset / done ─────────────────────────────────────────────────────────────

  function reset() {
    clearStepAnimation();
    setStage('upload');
    setResults(null);
    setError('');
    setParseStep(0);
    setSelectedFiles([]);
  }

  function handleDone() {
    onImported(results?.count || 0);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{MODAL_CSS}</style>
      <div className="mim-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="mim-box">

          {/* HEADER */}
          <div className="mim-hd">
            <div className="mim-title">Import Menu</div>
            <button className="mim-close" onClick={onClose}>✕ Close</button>
          </div>

          {/* BODY */}
          <div className="mim-body">

            {/* ── UPLOAD ── */}
            {stage === 'upload' && (
              <>
                {/* Drop zone — always visible so more files can be added */}
                <div
                  className={`mim-drop${dragging ? ' drag' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="mim-drop-icon">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <div className="mim-drop-title">
                    {selectedFiles.length === 0 ? 'Upload your menu' : 'Drop more files to add them'}
                  </div>
                  <div className="mim-drop-sub">
                    Upload one file per menu section, or your full menu at once.<br />
                    Supports JPG, PNG, WEBP, and PDF — up to 20MB each.<br />
                    All files are merged and parsed together into one menu.
                  </div>
                  <button className="mim-drop-btn" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
                    {selectedFiles.length === 0 ? 'Choose Files' : 'Add More Files'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleInputChange}
                  />
                </div>

                {/* Selected file list */}
                {selectedFiles.length > 0 && (
                  <div className="mim-file-list">
                    {selectedFiles.map((file, idx) => (
                      <div key={`${file.name}-${file.size}-${idx}`} className="mim-file-row">
                        <div className="mim-file-icon"><FileIcon /></div>
                        <div className="mim-file-name">{file.name}</div>
                        <div className="mim-file-size">{formatBytes(file.size)}</div>
                        <button className="mim-file-remove" onClick={() => removeFile(idx)} title="Remove">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {error && <div className="mim-error">⚠ {error}</div>}
              </>
            )}

            {/* ── PARSING ── */}
            {stage === 'parsing' && (
              <div className="mim-progress">
                <div className="mim-spinner" />
                <div className="mim-progress-label">
                  Claude is reading your menu{selectedFiles.length > 1 ? ` (${selectedFiles.length} files)` : ''}...
                </div>
                <div className="mim-progress-sub">
                  Extracting dishes, building ingredient library, and estimating recipe costs.<br />
                  Large menus can take 45–90 seconds.
                </div>
                <StepIndicator steps={PARSE_STEPS} currentStep={parseStep} />
              </div>
            )}

            {/* ── RESULTS ── */}
            {stage === 'results' && results && (
              <>
                <div className="mim-est-notice">
                  <div className="mim-est-notice-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4a020" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <strong>Ingredient costs are estimates.</strong> Claude built a full recipe breakdown using typical wholesale prices. These will update automatically once you upload invoices.
                  </div>
                </div>

                <div className="mim-results-grid">
                  <div className="mim-result-stat">
                    <div className="mim-result-val" style={{ color: '#02a4ba' }}>{results.count}</div>
                    <div className="mim-result-lbl">Dishes Imported</div>
                  </div>
                  <div className="mim-result-stat">
                    <div className="mim-result-val" style={{ color: '#2a8a5a' }}>{results.save_results?.ingredients_created ?? 0}</div>
                    <div className="mim-result-lbl">Ingredients Added</div>
                  </div>
                  <div className="mim-result-stat">
                    <div className="mim-result-val" style={{ color: '#d4a020' }}>{results.save_results?.components_created ?? 0}</div>
                    <div className="mim-result-lbl">Components Built</div>
                  </div>
                </div>

                <div className="mim-dish-list">
                  {results.dishes.map((dish, i) => {
                    const margin = dish.estimated_margin;
                    return (
                      <div key={i} className="mim-dish-row">
                        <div className="mim-dish-name">{dish.name}</div>
                        <div className="mim-dish-meta">
                          {dish.price !== null && (
                            <div className="mim-dish-price">{formatCurrency(dish.price)}</div>
                          )}
                          <div className="mim-dish-cost">~{formatCurrency(dish.total_estimated_cost)} cost</div>
                          {margin !== null && (
                            <div className="mim-dish-margin" style={{ color: getMarginColor(margin) }}>
                              {margin}%
                            </div>
                          )}
                          <div className="mim-dish-cat">{dish.category}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {results.save_results?.errors?.length > 0 && (
                  <div className="mim-save-errors">
                    <div className="mim-save-errors-title">
                      {results.save_results.errors.length} item{results.save_results.errors.length !== 1 ? 's' : ''} had issues saving:
                    </div>
                    <ul>
                      {results.save_results.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                      {results.save_results.errors.length > 5 && (
                        <li>...and {results.save_results.errors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            )}

          </div>

          {/* FOOTER */}
          {stage === 'upload' && selectedFiles.length > 0 && (
            <div className="mim-ft">
              <div className="mim-ft-left">
                {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
              </div>
              <div className="mim-ft-right">
                <button className="mim-btn-ghost" onClick={reset}>Clear All</button>
                <button className="mim-btn-primary" onClick={handleSubmit}>
                  Parse {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {stage === 'results' && results && (
            <div className="mim-ft">
              <div className="mim-ft-left">
                {results.save_results?.ingredients_reused > 0 && (
                  <span>{results.save_results.ingredients_reused} ingredient{results.save_results.ingredients_reused !== 1 ? 's' : ''} matched existing records</span>
                )}
              </div>
              <div className="mim-ft-right">
                <button className="mim-btn-ghost" onClick={reset}>← Re-upload</button>
                <button className="mim-btn-primary" onClick={handleDone}>
                  Done — View Menu Items
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}