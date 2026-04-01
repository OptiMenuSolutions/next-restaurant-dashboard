// components/MenuImportModal.js
import React, { useState, useRef } from 'react';
import supabase from '../lib/supabaseClient';

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
  .mim-title {
    font-family: 'Playfair Display', serif; font-size: 18px; color: #e8e2d8;
  }
  .mim-close {
    background: none; border: 1px solid #2a2620; border-radius: 6px;
    padding: 4px 10px; font-size: 12px; color: #4a453e; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: all .15s;
  }
  .mim-close:hover { color: #e8e2d8; border-color: #3a3630; }
  .mim-body { flex: 1; overflow-y: auto; padding: 20px; }

  /* DROP ZONE */
  .mim-drop {
    border: 2px dashed #2a2620; border-radius: 10px; padding: 40px 20px;
    text-align: center; cursor: pointer; transition: all .2s;
  }
  .mim-drop:hover, .mim-drop.drag { border-color: #02a4ba; background: rgba(2,164,186,.04); }
  .mim-drop-icon { margin: 0 auto 14px; width: 48px; height: 48px; border-radius: 50%;
    background: rgba(2,164,186,.08); border: 1px solid rgba(2,164,186,.2);
    display: flex; align-items: center; justify-content: center; }
  .mim-drop-icon svg { width: 22px; height: 22px; stroke: #02a4ba; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mim-drop-title { font-size: 15px; font-weight: 600; color: #e8e2d8; margin-bottom: 6px; }
  .mim-drop-sub { font-size: 12px; color: #4a453e; margin-bottom: 16px; line-height: 1.5; }
  .mim-drop-btn {
    background: #02a4ba; border: none; border-radius: 7px; padding: 9px 20px;
    font-size: 13px; font-weight: 600; color: #0a0908; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: background .2s;
  }
  .mim-drop-btn:hover { background: #01bcd4; }

  /* PROGRESS */
  .mim-progress { text-align: center; padding: 32px 0; }
  .mim-spinner { width: 32px; height: 32px; border: 3px solid #2a2620; border-top-color: #02a4ba;
    border-radius: 50%; animation: spin .7s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .mim-progress-label { font-size: 14px; color: #9a9086; margin-bottom: 6px; }
  .mim-progress-sub { font-size: 12px; color: #4a453e; }

  /* REVIEW TABLE */
  .mim-review-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .mim-review-title { font-size: 13px; font-weight: 600; color: #e8e2d8; }
  .mim-review-count { font-size: 12px; color: #4a453e; }
  .mim-table { width: 100%; border-collapse: collapse; }
  .mim-table th {
    font-size: 10px; font-weight: 600; color: #4a453e; text-transform: uppercase;
    letter-spacing: .6px; padding: 0 8px 10px; text-align: left;
  }
  .mim-table td { padding: 5px 8px; border-bottom: 1px solid #1a1915; vertical-align: middle; }
  .mim-table tr:last-child td { border-bottom: none; }
  .mim-input {
    background: #0f0e0c; border: 1px solid #2a2620; border-radius: 6px;
    padding: 6px 10px; font-size: 13px; color: #e8e2d8; outline: none;
    font-family: 'Inter', sans-serif; width: 100%; transition: border-color .15s;
  }
  .mim-input:focus { border-color: #02a4ba; }
  .mim-input.price { width: 80px; }
  .mim-del {
    background: none; border: none; cursor: pointer; padding: 4px;
    color: #3a3630; transition: color .15s; display: flex; align-items: center;
  }
  .mim-del:hover { color: #c04040; }
  .mim-del svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  /* FOOTER */
  .mim-ft {
    padding: 14px 20px; border-top: 1px solid #2a2620; display: flex;
    align-items: center; justify-content: space-between; flex-shrink: 0; gap: 10px;
  }
  .mim-ft-left { font-size: 12px; color: #4a453e; }
  .mim-ft-right { display: flex; gap: 10px; }
  .mim-btn-ghost {
    background: none; border: 1px solid #2a2620; border-radius: 7px;
    padding: 9px 16px; font-size: 13px; color: #4a453e; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: all .15s;
  }
  .mim-btn-ghost:hover { color: #9a9086; border-color: #3a3630; }
  .mim-btn-import {
    background: #02a4ba; border: none; border-radius: 7px; padding: 9px 20px;
    font-size: 13px; font-weight: 600; color: #0a0908; cursor: pointer;
    font-family: 'Inter', sans-serif; transition: background .2s;
    display: flex; align-items: center; gap: 7px;
  }
  .mim-btn-import:hover { background: #01bcd4; }
  .mim-btn-import:disabled { opacity: .5; cursor: not-allowed; }
  .mim-btn-import .mim-btn-spinner {
    width: 14px; height: 14px; border: 2px solid rgba(10,9,8,.3);
    border-top-color: #0a0908; border-radius: 50%; animation: spin .6s linear infinite;
  }
  .mim-error { font-size: 12px; color: #c04040; margin-top: 12px; padding: 10px 14px;
    background: rgba(192,64,64,.08); border: 1px solid rgba(192,64,64,.2); border-radius: 7px; }
  .mim-success { font-size: 13px; color: #2a8a5a; text-align: center; padding: 32px 0; }
  .mim-success-icon { font-size: 32px; margin-bottom: 12px; }
`;

export default function MenuImportModal({ restaurantId, onClose, onImported }) {
  const [stage, setStage] = useState('upload'); // upload | parsing | review | importing | done
  const [dragging, setDragging] = useState(false);
  const [dishes, setDishes] = useState([]);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setError('Please upload a JPG, PNG, or PDF file.');
      return;
    }
    setError('');
    setStage('parsing');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/menu/parse-menu-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      if (!data.dishes || data.dishes.length === 0) {
        setError('No menu items found. Try a clearer photo or a different page.');
        setStage('upload');
        return;
      }
      setDishes(data.dishes.map((d, i) => ({ ...d, _id: i })));
      setStage('review');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setStage('upload');
    }
  }

  function updateDish(id, field, value) {
    setDishes(prev => prev.map(d => d._id === id ? { ...d, [field]: value } : d));
  }

  function removeDish(id) {
    setDishes(prev => prev.filter(d => d._id !== id));
  }

  async function handleImport() {
    if (!restaurantId || dishes.length === 0) return;
    setStage('importing');
    setError('');

    try {
      const rows = dishes
        .filter(d => d.name?.trim())
        .map(d => ({
          restaurant_id: restaurantId,
          name: d.name.trim(),
          price: d.price ? parseFloat(d.price) : null,
          category: d.category || 'Other',
          description: d.description || null,
          cost: null,
        }));

      // Insert in batches of 50
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error: insertErr } = await supabase.from('menu_items').insert(batch);
        if (insertErr) throw insertErr;
      }

      setImportedCount(rows.length);
      setStage('done');
      setTimeout(() => {
        onImported(rows.length);
      }, 1800);
    } catch (err) {
      setError(err.message || 'Import failed. Please try again.');
      setStage('review');
    }
  }

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
                <div
                  className={`mim-drop${dragging ? ' drag' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="mim-drop-icon">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <div className="mim-drop-title">Upload your menu</div>
                  <div className="mim-drop-sub">
                    Take a photo of your printed menu, or export a PDF from your POS.<br />
                    Supports JPG, PNG, and PDF (up to 20MB, multiple pages).
                  </div>
                  <button className="mim-drop-btn" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
                    Choose File
                  </button>
                  <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }}
                    onChange={e => handleFile(e.target.files[0])} />
                </div>
                {error && <div className="mim-error">{error}</div>}
              </>
            )}

            {/* ── PARSING ── */}
            {stage === 'parsing' && (
              <div className="mim-progress">
                <div className="mim-spinner" />
                <div className="mim-progress-label">Reading your menu...</div>
                <div className="mim-progress-sub">Claude is extracting dish names and prices. This takes 15–30 seconds.</div>
              </div>
            )}

            {/* ── REVIEW ── */}
            {stage === 'review' && (
              <>
                <div className="mim-review-hd">
                  <div className="mim-review-title">Review extracted items</div>
                  <div className="mim-review-count">{dishes.length} dishes found — edit or remove before importing</div>
                </div>
                <table className="mim-table">
                  <thead>
                    <tr>
                      <th style={{ width: '38%' }}>Dish Name</th>
                      <th style={{ width: '18%' }}>Price</th>
                      <th style={{ width: '30%' }}>Category</th>
                      <th style={{ width: '14%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dishes.map(d => (
                      <tr key={d._id}>
                        <td>
                          <input className="mim-input" value={d.name} onChange={e => updateDish(d._id, 'name', e.target.value)} />
                        </td>
                        <td>
                          <input className="mim-input price" type="number" step="0.01" min="0"
                            placeholder="—" value={d.price ?? ''} onChange={e => updateDish(d._id, 'price', e.target.value === '' ? null : parseFloat(e.target.value))} />
                        </td>
                        <td>
                          <input className="mim-input" value={d.category} onChange={e => updateDish(d._id, 'category', e.target.value)} />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="mim-del" onClick={() => removeDish(d._id)}>
                            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {error && <div className="mim-error">{error}</div>}
              </>
            )}

            {/* ── IMPORTING ── */}
            {stage === 'importing' && (
              <div className="mim-progress">
                <div className="mim-spinner" />
                <div className="mim-progress-label">Importing {dishes.length} dishes...</div>
                <div className="mim-progress-sub">Adding to your menu. Just a moment.</div>
              </div>
            )}

            {/* ── DONE ── */}
            {stage === 'done' && (
              <div className="mim-success">
                <div className="mim-success-icon">✓</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#e8e2d8', marginBottom: 6 }}>
                  {importedCount} dishes imported!
                </div>
                <div style={{ fontSize: 13, color: '#4a453e' }}>
                  Your menu items are ready. Add ingredients to calculate food costs.
                </div>
              </div>
            )}

          </div>

          {/* FOOTER */}
          {stage === 'review' && (
            <div className="mim-ft">
              <div className="mim-ft-left">{dishes.length} item{dishes.length !== 1 ? 's' : ''} ready to import</div>
              <div className="mim-ft-right">
                <button className="mim-btn-ghost" onClick={() => { setStage('upload'); setDishes([]); setError(''); }}>
                  ← Re-upload
                </button>
                <button className="mim-btn-import" onClick={handleImport} disabled={dishes.length === 0}>
                  Import {dishes.length} Dish{dishes.length !== 1 ? 'es' : ''}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}