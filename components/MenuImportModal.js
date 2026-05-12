// components/MenuImportModal.js
// Wired to the new async two-route parse system:
//   POST /api/menu/parse-menu-start  → { job_id, status: 'pass1_complete' }
//   POST /api/menu/parse-menu-finish → { success, dishes, count, save_results }
//   GET  /api/menu/job-status?job_id → { status }

import React, { useState, useRef, useCallback } from 'react';

const CSS = `
  @keyframes mim-spin { to { transform: rotate(360deg); } }
  @keyframes mim-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes mim-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

  .mim-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.8); z-index: 200;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    animation: mim-fadein .2s ease;
  }
  .mim-box {
    background: var(--bg-surface, #13120f);
    border: 1px solid var(--border, #2a2620);
    border-radius: 14px; width: 100%; max-width: 600px;
    max-height: 88vh; display: flex; flex-direction: column;
    overflow: hidden; font-family: 'Inter', sans-serif;
  }
  .mim-hd {
    padding: 16px 20px; border-bottom: 1px solid var(--border, #2a2620);
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
  }
  .mim-title {
    font-family: 'Playfair Display', serif; font-size: 17px;
    color: var(--text-primary, #e8e2d8);
  }
  .mim-close {
    background: none; border: 1px solid var(--border, #2a2620); border-radius: 6px;
    padding: 4px 10px; font-size: 11px; color: var(--text-muted, #6a6560);
    cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s;
  }
  .mim-close:hover { color: var(--text-primary, #e8e2d8); border-color: #3a3630; }
  .mim-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }

  /* Drop zone */
  .mim-drop {
    border: 2px dashed var(--border, #2a2620); border-radius: 10px;
    padding: 36px 20px; text-align: center; cursor: pointer; transition: all .2s;
  }
  .mim-drop:hover, .mim-drop.drag {
    border-color: var(--accent, #02a4ba);
    background: rgba(2,164,186,.04);
  }
  .mim-drop-icon {
    margin: 0 auto 14px; width: 44px; height: 44px; border-radius: 50%;
    background: rgba(2,164,186,.08); border: 1px solid rgba(2,164,186,.2);
    display: flex; align-items: center; justify-content: center;
  }
  .mim-drop-icon svg { width: 20px; height: 20px; stroke: var(--accent, #02a4ba); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mim-drop-title { font-size: 14px; font-weight: 600; color: var(--text-primary, #e8e2d8); margin-bottom: 5px; }
  .mim-drop-sub { font-size: 11px; color: var(--text-muted, #6a6560); }
  .mim-drop-sub span { color: var(--accent, #02a4ba); cursor: pointer; }

  /* File list */
  .mim-file-list { display: flex; flex-direction: column; gap: 6px; }
  .mim-file-row {
    display: flex; align-items: center; gap: 10px;
    background: var(--bg-elevated, #1a1915); border: 1px solid var(--border, #2a2620);
    border-radius: 7px; padding: 8px 12px;
  }
  .mim-file-icon { font-size: 16px; flex-shrink: 0; }
  .mim-file-name { flex: 1; font-size: 12px; color: var(--text-primary, #e8e2d8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mim-file-size { font-size: 11px; color: var(--text-muted, #6a6560); flex-shrink: 0; }
  .mim-file-del {
    background: none; border: none; cursor: pointer; padding: 2px 4px;
    color: var(--text-muted, #6a6560); border-radius: 3px; transition: color .15s; font-size: 13px; line-height: 1;
  }
  .mim-file-del:hover { color: #c04040; }

  /* Progress */
  .mim-progress { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 20px 0; }
  .mim-spinner {
    width: 36px; height: 36px; border: 3px solid var(--border, #2a2620);
    border-top-color: var(--accent, #02a4ba); border-radius: 50%;
    animation: mim-spin .8s linear infinite;
  }
  .mim-progress-steps { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 320px; }
  .mim-step {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px;
    border-radius: 8px; border: 1px solid var(--border, #2a2620);
    background: var(--bg-elevated, #1a1915); transition: all .3s;
  }
  .mim-step.active { border-color: var(--accent, #02a4ba); background: rgba(2,164,186,.06); }
  .mim-step.done { border-color: rgba(42,138,90,.3); background: rgba(42,138,90,.06); }
  .mim-step-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    background: var(--border, #2a2620); transition: background .3s;
  }
  .mim-step.active .mim-step-dot { background: var(--accent, #02a4ba); animation: mim-pulse 1.2s ease infinite; }
  .mim-step.done .mim-step-dot { background: #2a8a5a; }
  .mim-step-label { font-size: 12px; color: var(--text-muted, #6a6560); transition: color .3s; }
  .mim-step.active .mim-step-label { color: var(--text-primary, #e8e2d8); font-weight: 500; }
  .mim-step.done .mim-step-label { color: #2a8a5a; }
  .mim-step-check { margin-left: auto; font-size: 12px; color: #2a8a5a; }

  /* Success */
  .mim-success { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px 0; }
  .mim-success-icon {
    width: 52px; height: 52px; border-radius: 50%;
    background: rgba(42,138,90,.1); border: 1px solid rgba(42,138,90,.3);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; color: #2a8a5a;
  }
  .mim-success-title { font-size: 16px; font-weight: 600; color: var(--text-primary, #e8e2d8); }
  .mim-success-sub { font-size: 12px; color: var(--text-muted, #6a6560); text-align: center; line-height: 1.6; }
  .mim-success-stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%;
  }
  .mim-stat {
    background: var(--bg-elevated, #1a1915); border: 1px solid var(--border, #2a2620);
    border-radius: 8px; padding: 10px; text-align: center;
  }
  .mim-stat-val { font-size: 20px; font-weight: 700; color: var(--accent, #02a4ba); }
  .mim-stat-lbl { font-size: 10px; color: var(--text-muted, #6a6560); text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }

  /* Error */
  .mim-error {
    background: rgba(192,64,64,.08); border: 1px solid rgba(192,64,64,.2);
    border-radius: 8px; padding: 12px 14px;
    font-size: 12px; color: #c04040; line-height: 1.5;
  }

  /* Footer */
  .mim-footer {
    padding: 14px 20px; border-top: 1px solid var(--border, #2a2620);
    display: flex; gap: 8px; justify-content: flex-end; flex-shrink: 0;
  }
  .mim-btn {
    border-radius: 7px; padding: 8px 18px; font-size: 13px; font-weight: 600;
    cursor: pointer; font-family: 'Inter', sans-serif; transition: all .2s; border: none;
  }
  .mim-btn-primary { background: var(--accent, #02a4ba); color: #0a0908; }
  .mim-btn-primary:hover { background: #01bcd4; }
  .mim-btn-primary:disabled { background: var(--border, #2a2620); color: var(--text-muted, #6a6560); cursor: not-allowed; }
  .mim-btn-ghost {
    background: none; color: var(--text-muted, #6a6560);
    border: 1px solid var(--border, #2a2620);
  }
  .mim-btn-ghost:hover { color: var(--text-primary, #e8e2d8); border-color: #3a3630; }
`;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Polls job-status until done or error. Returns final status string.
async function pollJobStatus(jobId, onStepChange, signal) {
  while (true) {
    if (signal?.aborted) throw new Error('Cancelled');
    await new Promise(r => setTimeout(r, 2500));
    const res = await fetch(`/api/menu/job-status?job_id=${jobId}`);
    const data = await res.json();
    onStepChange(data.status);
    if (data.status === 'pass1_complete' || data.status === 'complete' || data.status === 'error') {
      return data;
    }
  }
}

export default function MenuImportModal({ restaurantId, onClose, onImported, onReviewReady }) {
  const [files, setFiles] = useState([]);
  const [stage, setStage] = useState('idle'); // idle | running | done | error
  const [jobStatus, setJobStatus] = useState(''); // tracks current step label
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const addFiles = useCallback((incoming) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const valid = Array.from(incoming).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return allowed.includes(f.type) || ext === 'pdf';
    });
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !existing.has(f.name))];
    });
  }, []);

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    addFiles(e.dataTransfer.files);
  }

  // Step label → human readable
  function stepLabel(status) {
    if (status === 'processing') return 'Scanning menu...';
    if (status === 'pass1_complete') return 'Building recipes...';
    if (status === 'processing_pass2') return 'Building recipes...';
    if (status === 'complete') return 'Complete';
    return 'Processing...';
  }

  // Which steps are active/done
  function stepState(status) {
    const steps = [
      { id: 'upload', label: 'Uploading files' },
      { id: 'pass1', label: 'Scanning menu & ingredients' },
      { id: 'pass2', label: 'Building recipes' },
      { id: 'saving', label: 'Saving to your account' },
    ];
    const idx = ['upload', 'pass1', 'pass2', 'saving'].indexOf(
      status === 'processing' ? 'pass1' :
      status === 'pass1_complete' ? 'pass2' :
      status === 'processing_pass2' ? 'pass2' :
      status === 'complete' ? 'saving' : 'upload'
    );
    return steps.map((s, i) => ({
      ...s,
      state: i < idx ? 'done' : i === idx ? 'active' : 'pending',
    }));
  }

  async function handleImport() {
    if (files.length === 0) return;
    setStage('running');
    setError('');
    setJobStatus('processing');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append('restaurant_id', restaurantId);
      files.forEach(f => formData.append('file', f));

      const res = await fetch('/api/menu/parse-menu?review=true', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to import menu.');
      }

      setJobStatus('complete');
      if (data.review && onReviewReady) {
        // Hand off to ParseReviewModal — don't show success screen
        onReviewReady({ dishes: data.dishes, ingredientLibrary: data.ingredient_library });
      } else {
        setResult(data);
        setStage('done');
      }

    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Something went wrong. Please try again.');
      setStage('error');
    }
  }

  function handleClose() {
    abortRef.current?.abort();
    onClose();
  }

  function handleDone() {
    onImported();
  }

  const steps = stepState(jobStatus);

  return (
    <>
      <style>{CSS}</style>
      <div className="mim-overlay" onClick={e => e.target === e.currentTarget && stage !== 'running' && handleClose()}>
        <div className="mim-box">

          {/* Header */}
          <div className="mim-hd">
            <div className="mim-title">Import Menu</div>
            {stage !== 'running' && (
              <button className="mim-close" onClick={handleClose}>✕ Close</button>
            )}
          </div>

          {/* Body */}
          <div className="mim-body">

            {/* ── IDLE: file picker ── */}
            {(stage === 'idle' || stage === 'error') && (
              <>
                <div
                  className={`mim-drop${drag ? ' drag' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                >
                  <div className="mim-drop-icon">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <div className="mim-drop-title">Drop your menu files here</div>
                  <div className="mim-drop-sub">or <span>browse to upload</span> · JPG, PNG, WEBP, PDF</div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.pdf,image/*,application/pdf"
                    style={{ display: 'none' }}
                    onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                  />
                </div>

                {files.length > 0 && (
                  <div className="mim-file-list">
                    {files.map((f, i) => (
                      <div key={i} className="mim-file-row">
                        <span className="mim-file-icon">{f.type === 'application/pdf' || f.name.endsWith('.pdf') ? '📄' : '🖼️'}</span>
                        <span className="mim-file-name">{f.name}</span>
                        <span className="mim-file-size">{formatBytes(f.size)}</span>
                        <button className="mim-file-del" onClick={() => removeFile(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {stage === 'error' && error && (
                  <div className="mim-error">⚠ {error}</div>
                )}
              </>
            )}

            {/* ── RUNNING: progress steps ── */}
            {stage === 'running' && (
              <div className="mim-progress">
                <div className="mim-spinner" />
                <div className="mim-progress-steps">
                  {steps.map(s => (
                    <div key={s.id} className={`mim-step ${s.state}`}>
                      <div className="mim-step-dot" />
                      <div className="mim-step-label">{s.label}</div>
                      {s.state === 'done' && <div className="mim-step-check">✓</div>}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted, #6a6560)', marginTop: 4 }}>
                  This may take 60–90 seconds for large menus
                </div>
              </div>
            )}

            {/* ── DONE: results ── */}
            {stage === 'done' && result && (
              <div className="mim-success">
                <div className="mim-success-icon">✓</div>
                <div className="mim-success-title">Menu imported successfully</div>
                <div className="mim-success-stats">
                  <div className="mim-stat">
                    <div className="mim-stat-val">{result.save_results?.menu_items_created ?? result.count ?? 0}</div>
                    <div className="mim-stat-lbl">Dishes</div>
                  </div>
                  <div className="mim-stat">
                    <div className="mim-stat-val">{result.save_results?.ingredients_created ?? 0}</div>
                    <div className="mim-stat-lbl">New Ingredients</div>
                  </div>
                  <div className="mim-stat">
                    <div className="mim-stat-val">{result.save_results?.components_created ?? 0}</div>
                    <div className="mim-stat-lbl">Components</div>
                  </div>
                </div>
                {result.summary?.categories?.length > 0 && (
                  <div className="mim-success-sub">
                    Categories: {result.summary.categories.join(', ')}
                    {result.summary.avg_estimated_margin && (
                      <><br />Avg estimated margin: {result.summary.avg_estimated_margin}%</>
                    )}
                  </div>
                )}
                {result.truncated && (
                  <div className="mim-error" style={{ marginTop: 0 }}>
                    ⚠ Some items may have been cut off due to menu size. Consider splitting large menus into sections.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mim-footer">
            {stage === 'idle' && (
              <>
                <button className="mim-btn mim-btn-ghost" onClick={handleClose}>Cancel</button>
                <button
                  className="mim-btn mim-btn-primary"
                  disabled={files.length === 0}
                  onClick={handleImport}
                >
                  Import {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'Menu'}
                </button>
              </>
            )}
            {stage === 'running' && (
              <button className="mim-btn mim-btn-ghost" onClick={handleClose}>Cancel</button>
            )}
            {stage === 'error' && (
              <>
                <button className="mim-btn mim-btn-ghost" onClick={handleClose}>Cancel</button>
                <button className="mim-btn mim-btn-primary" onClick={() => { setStage('idle'); setError(''); }}>Try Again</button>
              </>
            )}
            {stage === 'done' && (
              <button className="mim-btn mim-btn-primary" onClick={handleDone}>View Menu Items</button>
            )}
          </div>

        </div>
      </div>
    </>
  );
}