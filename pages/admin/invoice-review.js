// pages/admin/invoice-review.js
// Admin invoice review inbox.
// Step 1: Review and edit all line item numbers (qty, unit, cost) across every unreviewed invoice.
// Step 2: Review and edit ingredient matches for every line item, including auto-matched ones.
// Mark reviewed per invoice — reviewed invoices drop out of the queue.

import { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n == null || n === '') return '—';
  const v = parseFloat(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const [y, m, day] = d.split('T')[0].split('-');
    return new Date(+y, +m - 1, +day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function timeAgo(d) {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

// ─── Inline number input ──────────────────────────────────────────────────────

function NumInput({ value, onChange, prefix, suffix, width = 80 }) {
  const [local, setLocal] = useState(value != null ? String(value) : '');

  useEffect(() => {
    setLocal(value != null ? String(value) : '');
  }, [value]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      {prefix && <span style={{ fontSize: 10, color: '#5a6080' }}>{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={local}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          setLocal(raw);
        }}
        onBlur={() => {
          const parsed = parseFloat(local);
          if (!isNaN(parsed)) onChange(parsed);
          else { setLocal(value != null ? String(value) : ''); }
        }}
        style={{
          width,
          background: '#0f1115',
          border: '1px solid #1e2028',
          borderRadius: 4,
          padding: '3px 6px',
          fontSize: 11,
          color: '#e4e6f0',
          fontFamily: "'DM Mono', monospace",
          outline: 'none',
          textAlign: 'right',
        }}
      />
      {suffix && <span style={{ fontSize: 10, color: '#5a6080' }}>{suffix}</span>}
    </div>
  );
}

// ─── Text input ───────────────────────────────────────────────────────────────

function TxtInput({ value, onChange, width = 60 }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => setLocal(value || ''), [value]);
  return (
    <input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => onChange(local)}
      style={{
        width,
        background: '#0f1115',
        border: '1px solid #1e2028',
        borderRadius: 4,
        padding: '3px 6px',
        fontSize: 11,
        color: '#e4e6f0',
        fontFamily: "'Inter', sans-serif",
        outline: 'none',
      }}
    />
  );
}

// ─── Ingredient picker ────────────────────────────────────────────────────────
// Searchable dropdown scoped to a restaurant's ingredient library.

function IngredientPicker({ value, ingredientName, candidates, onChange }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  const current = candidates.find(c => c.id === value);

  const filtered = query
    ? candidates.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : candidates;

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 200 }}>
      <button
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        style={{
          width: '100%',
          background: value ? 'rgba(2,164,186,0.08)' : '#0f1115',
          border: `1px solid ${value ? 'rgba(2,164,186,0.3)' : '#1e2028'}`,
          borderRadius: 5,
          padding: '4px 8px',
          fontSize: 11,
          color: value ? '#02a4ba' : '#5a6080',
          fontFamily: "'Inter', sans-serif",
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {current ? current.name : 'Unlinked'}
        </span>
        <span style={{ fontSize: 9, color: '#3a3e50', flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 50,
          width: 280,
          background: '#111318',
          border: '1px solid #1e2028',
          borderRadius: 7,
          marginTop: 3,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #1e2028' }}>
            <input
              autoFocus
              placeholder="Search ingredients…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%',
                background: '#0f1115',
                border: '1px solid #1e2028',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                color: '#e4e6f0',
                fontFamily: "'Inter', sans-serif",
                outline: 'none',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {/* Unlink option */}
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              style={{
                width: '100%', padding: '7px 10px', background: 'none',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                fontSize: 11, color: '#5a6080', fontFamily: "'Inter', sans-serif",
                borderBottom: '1px solid #1a1d24',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1a1d24'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              — Unlinked
            </button>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px', fontSize: 11, color: '#3a3e50', textAlign: 'center' }}>No matches</div>
            ) : filtered.map(ing => (
              <button
                key={ing.id}
                onClick={() => { onChange(ing.id, ing.name); setOpen(false); }}
                style={{
                  width: '100%', padding: '7px 10px', background: ing.id === value ? 'rgba(2,164,186,0.08)' : 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontFamily: "'Inter', sans-serif", borderBottom: '1px solid #1a1d24',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#1a1d24'}
                onMouseLeave={e => e.currentTarget.style.background = ing.id === value ? 'rgba(2,164,186,0.08)' : 'none'}
              >
                <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: ing.id === value ? 600 : 400 }}>{ing.name}</div>
                <div style={{ fontSize: 9, color: '#4a5068', marginTop: 1 }}>
                  {ing.unit}{ing.last_price ? ` · last $${parseFloat(ing.last_price).toFixed(4)}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Invoice card ─────────────────────────────────────────────────────────────
// Renders one invoice with all its line items, editable in the current step.

function InvoiceCard({ invoice, ingredients, step, onSave, onMarkReviewed, saving, marking, expanded, onToggle }) {

  // Local editable copy of line items
  const [items, setItems] = useState(invoice.line_items.map(i => ({ ...i })));
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Reset if invoice changes (e.g. after a reload)
  useEffect(() => {
    setItems(invoice.line_items.map(i => ({ ...i })));
    setDirty(false);
  }, [invoice.id]);

  function updateItem(id, updates) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...updates } : it));
    setDirty(true);
    setSaveError(null);
  }

  async function handleSave() {
    setSaveError(null);
    const err = await onSave(invoice.id, invoice.restaurant_id, items);
    if (err) setSaveError(err);
    else setDirty(false);
  }

  const hasChanges = dirty;

  return (
    <div style={c.card}>
      {/* Invoice header — always visible, click to expand/collapse */}
      <div style={{ ...c.cardHd, cursor: 'pointer', userSelect: 'none' }} onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: '#3a3e50', flexShrink: 0, width: 12, textAlign: 'center' }}>
            {expanded ? '▼' : '▶'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e4e6f0' }}>
              {invoice.supplier || 'Unknown Supplier'}
              {invoice.number && <span style={{ fontSize: 10, color: '#5a6080', marginLeft: 8, fontFamily: "'DM Mono', monospace" }}>#{invoice.number}</span>}
            </div>
            <div style={{ fontSize: 10, color: '#5a6080', marginTop: 2 }}>
              {fmtDate(invoice.date)} · {items.length} item{items.length !== 1 ? 's' : ''}
              {invoice.files?.length > 0 && (
                <span style={{ marginLeft: 10 }}>
                  {invoice.files.map((f) => (
                    <a
                      key={f.file_url}
                      href={f.file_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: '#02a4ba', textDecoration: 'none', marginRight: 8 }}
                    >
                      {invoice.files.length > 1 ? `Page ${f.page_number} →` : 'View invoice →'}
                    </a>
                  ))}
                </span>
              )}
            </div>
          </div>
          {invoice.amount && (
            <div style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 700, color: '#3de8a0', fontFamily: "'DM Mono', monospace" }}>
              {fmt$(invoice.amount)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {saveError && (
            <span style={{ fontSize: 10, color: '#e85454' }}>{saveError}</span>
          )}
          {hasChanges && expanded && (
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...c.btnPrimary, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          )}
          {step === 'matches' && !hasChanges && expanded && (
            <button
              onClick={() => onMarkReviewed(invoice.id)}
              disabled={marking}
              style={{ ...c.btnReviewed, opacity: marking ? 0.6 : 1 }}
            >
              {marking ? 'Marking…' : '✓ Mark Reviewed'}
            </button>
          )}
        </div>
      </div>

      {/* ── STEP 1: Numbers — only shown when expanded ── */}
      {expanded && step === 'numbers' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={c.table}>
            <thead>
              <tr>
                {['Item', 'Qty', 'Unit', 'Unit Cost', 'Line Total', 'Original Qty', 'Original Cost', 'Δ Qty', 'Δ Cost'].map(h => (
                  <th key={h} style={c.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const qtyChanged  = item.quantity  !== item.original_quantity  && item.original_quantity  != null;
                const costChanged = item.unit_cost  !== item.original_price     && item.original_price     != null;
                return (
                  <tr key={item.id} style={c.row}>
                    <td style={{ ...c.td, maxWidth: 200 }}>
                      <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.item_name || '—'}
                      </div>
                    </td>
                    <td style={c.td}>
                      <NumInput
                        value={item.quantity}
                        onChange={v => updateItem(item.id, { quantity: v })}
                        width={70}
                      />
                    </td>
                    <td style={c.td}>
                      <TxtInput
                        value={item.unit || ''}
                        onChange={v => updateItem(item.id, { unit: v })}
                        width={52}
                      />
                    </td>
                    <td style={c.td}>
                      <NumInput
                        value={item.unit_cost}
                        onChange={v => updateItem(item.id, { unit_cost: v })}
                        prefix="$"
                        width={80}
                      />
                    </td>
                    <td style={c.td}>
                      <NumInput
                        value={item.amount}
                        onChange={v => updateItem(item.id, { amount: v })}
                        prefix="$"
                        width={80}
                      />
                    </td>
                    <td style={{ ...c.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#5a6080' }}>
                      {item.original_quantity ?? '—'}
                    </td>
                    <td style={{ ...c.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#5a6080' }}>
                      {item.original_price != null ? fmt$(item.original_price) : '—'}
                    </td>
                    <td style={{ ...c.td, fontFamily: "'DM Mono', monospace", fontSize: 10 }}>
                      {qtyChanged
                        ? <span style={{ color: '#f5a623' }}>{((item.quantity || 0) - (item.original_quantity || 0)).toFixed(2)}</span>
                        : <span style={{ color: '#3a3e50' }}>—</span>}
                    </td>
                    <td style={{ ...c.td, fontFamily: "'DM Mono', monospace", fontSize: 10 }}>
                      {costChanged
                        ? <span style={{ color: '#f5a623' }}>{fmt$((item.unit_cost || 0) - (item.original_price || 0))}</span>
                        : <span style={{ color: '#3a3e50' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── STEP 2: Matches — only shown when expanded ── */}
      {expanded && step === 'matches' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={c.table}>
            <thead>
              <tr>
                {['Item', 'Qty', 'Unit', 'Unit Cost', 'Linked Ingredient', 'Status'].map(h => (
                  <th key={h} style={c.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isLinked   = !!item.ingredient_id;
                const isChanged  = item.ingredient_id !== invoice.line_items.find(o => o.id === item.id)?.ingredient_id;
                return (
                  <tr key={item.id} style={c.row}>
                    <td style={{ ...c.td, maxWidth: 200 }}>
                      <div style={{ fontSize: 11, color: '#e4e6f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.item_name || '—'}
                      </div>
                    </td>
                    <td style={{ ...c.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#7880a0' }}>
                      {item.quantity != null ? `${item.quantity} ${item.unit || ''}`.trim() : '—'}
                    </td>
                    <td style={{ ...c.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#7880a0' }}>
                      {item.unit || '—'}
                    </td>
                    <td style={{ ...c.td, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#3de8a0' }}>
                      {item.unit_cost != null ? fmt$(item.unit_cost) : '—'}
                    </td>
                    <td style={c.td}>
                      <IngredientPicker
                        value={item.ingredient_id}
                        ingredientName={item.item_name}
                        candidates={ingredients}
                        onChange={(id, name) => {
                          updateItem(item.id, {
                            ingredient_id: id || null,
                            linked_ingredient_name: name || null,
                          });
                        }}
                      />
                    </td>
                    <td style={c.td}>
                      {isChanged ? (
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(245,166,35,0.12)', color: '#f5a623', border: '1px solid rgba(245,166,35,0.25)' }}>
                          changed
                        </span>
                      ) : isLinked ? (
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(61,232,160,0.08)', color: '#3de8a0', border: '1px solid rgba(61,232,160,0.2)' }}>
                          linked
                        </span>
                      ) : (
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(90,96,128,0.12)', color: '#5a6080', border: '1px solid #1e2028' }}>
                          unlinked
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── Main page ────────────────────────────────────────────────────────────────

export default function InvoiceReviewPage() {
  const { adminFetch } = useAdminFetch();
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep]       = useState('numbers'); // 'numbers' | 'matches'
  const [savingId,  setSavingId]  = useState(null);
  const [markingId, setMarkingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast]         = useState(null); // { msg, type }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    setLoading(true);
    try {
      const res  = await adminFetch('/api/admin/invoice-review');
      const json = await res.json();
      setGroups(json.groups || []);
    } catch (err) {
      showToast('Failed to load invoices: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Total counts for the header bar
  const totalInvoices = groups.reduce((s, g) => s + g.invoices.length, 0);
  const totalItems    = groups.reduce((s, g) => s + g.invoices.reduce((ss, inv) => ss + inv.line_items.length, 0), 0);

  async function handleSave(invoiceId, restaurantId, items) {
    setSavingId(invoiceId);
    try {
      const res  = await adminFetch('/api/admin/invoice-review/save-items', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: invoiceId, restaurant_id: restaurantId, items }),
      });
      const json = await res.json();
      if (!res.ok) return json.error || 'Save failed';
      if (json.errors?.length) showToast(`Saved with ${json.errors.length} warning(s)`, 'warn');
      else showToast('Changes saved');
      return null;
    } catch (err) {
      return err.message;
    } finally {
      setSavingId(null);
    }
  }

  async function handleMarkReviewed(invoiceId) {
    setMarkingId(invoiceId);
    try {
      const res  = await adminFetch('/api/admin/invoice-review/mark-reviewed', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error || 'Failed to mark reviewed', 'error'); return; }

      showToast('Invoice marked as reviewed');

      // Remove invoice from local state — it drops out of the queue
      setGroups(prev => prev
        .map(g => ({
          ...g,
          invoices: g.invoices.filter(inv => inv.id !== invoiceId),
        }))
        .filter(g => g.invoices.length > 0)
      );
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <AdminLayout title="Invoice Review">
      <div style={p.page}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={p.title}>Invoice Review</h1>
            <p style={p.subtitle}>
              {loading ? 'Loading…' : totalInvoices === 0
                ? 'All caught up — no unreviewed invoices.'
                : `${totalInvoices} unreviewed invoice${totalInvoices !== 1 ? 's' : ''} · ${totalItems} line item${totalItems !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Step toggle */}
          <div style={p.stepToggle}>
            <button
              onClick={() => setStep('numbers')}
              style={{ ...p.stepBtn, ...(step === 'numbers' ? p.stepBtnActive : {}) }}
            >
              1 · Numbers
            </button>
            <button
              onClick={() => setStep('matches')}
              style={{ ...p.stepBtn, ...(step === 'matches' ? p.stepBtnActive : {}) }}
            >
              2 · Matches
            </button>
          </div>
        </div>

        {/* ── Step description ── */}
        <div style={p.stepDesc}>
          {step === 'numbers'
            ? 'Review and correct quantities, units, and costs. Changes are highlighted against what Claude originally parsed.'
            : 'Review ingredient links for every line item. Auto-matched items are shown — you can reassign or unlink any of them.'}
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div style={p.center}>
            <div style={p.spinner} />
            <span style={{ color: '#3a3e50', fontSize: 12 }}>Loading invoices…</span>
          </div>
        ) : groups.length === 0 ? (
          <div style={p.center}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#3de8a0' }}>All invoices reviewed</div>
            <div style={{ fontSize: 11, color: '#3a3e50', marginTop: 4 }}>New invoices will appear here after they're uploaded.</div>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.restaurant_id}>
              {/* Restaurant header */}
              <div style={p.restaurantHd}>
                <div style={p.restaurantName}>{group.restaurant_name}</div>
                <div style={p.restaurantMeta}>
                  {group.invoices.length} invoice{group.invoices.length !== 1 ? 's' : ''} · {group.ingredients.length} ingredients in library
                </div>
              </div>

              {/* Invoice cards */}
              {group.invoices.map(invoice => (
                <InvoiceCard
                  key={invoice.id}
                  invoice={invoice}
                  ingredients={group.ingredients}
                  step={step}
                  onSave={handleSave}
                  onMarkReviewed={handleMarkReviewed}
                  saving={savingId === invoice.id}
                  marking={markingId === invoice.id}
                  expanded={expandedId === invoice.id}
                  onToggle={() => setExpandedId(prev => prev === invoice.id ? null : invoice.id)}
                />
              ))}
            </div>
          ))
        )}

        {/* ── Toast ── */}
        {toast && (
          <div style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: toast.type === 'error' ? '#1a0e0e'
              : toast.type === 'warn' ? '#1a1400'
              : '#0e1a14',
            border: `1px solid ${toast.type === 'error' ? 'rgba(232,84,84,0.4)'
              : toast.type === 'warn' ? 'rgba(245,166,35,0.4)'
              : 'rgba(61,232,160,0.3)'}`,
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 12,
            color: toast.type === 'error' ? '#e85454'
              : toast.type === 'warn' ? '#f5a623'
              : '#3de8a0',
            fontFamily: "'Inter', sans-serif",
            zIndex: 100,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}>
            {toast.msg}
          </div>
        )}

      </div>
    </AdminLayout>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const p = {
  page:         { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Inter', sans-serif", minHeight: 0 },
  title:        { fontSize: 22, fontWeight: 700, color: '#e4e6f0', letterSpacing: '-0.5px', fontFamily: "'Playfair Display', serif", margin: 0 },
  subtitle:     { fontSize: 11, color: '#5a6080', marginTop: 4 },
  stepToggle:   { display: 'flex', background: '#111318', border: '1px solid #1e2028', borderRadius: 8, padding: 3, gap: 2, flexShrink: 0 },
  stepBtn:      { padding: '6px 16px', fontSize: 11, fontWeight: 500, borderRadius: 6, border: 'none', background: 'none', color: '#5a6080', cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'all 0.15s', whiteSpace: 'nowrap' },
  stepBtnActive:{ background: '#1a1d24', color: '#02a4ba', border: '1px solid rgba(2,164,186,0.2)' },
  stepDesc:     { fontSize: 11, color: '#4a5068', background: '#111318', border: '1px solid #1e2028', borderRadius: 6, padding: '8px 12px' },
  restaurantHd: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, marginTop: 8 },
  restaurantName:{ fontSize: 13, fontWeight: 700, color: '#e4e6f0' },
  restaurantMeta:{ fontSize: 10, color: '#3a3e50' },
  center:       { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 60, color: '#5a6080' },
  spinner:      { width: 18, height: 18, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};

const c = {
  card:    { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, overflow: 'hidden', marginBottom: 10 },
  cardHd:  { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #1a1d24', background: '#0f1115' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 11 },
  th:      { fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #1a1d24', background: '#0d0f13', whiteSpace: 'nowrap' },
  td:      { padding: '8px 12px', borderBottom: '1px solid #0f1115', verticalAlign: 'middle' },
  row:     { transition: 'background 0.1s' },
  btnPrimary: {
    background: 'rgba(2,164,186,0.12)',
    border: '1px solid rgba(2,164,186,0.3)',
    borderRadius: 6,
    padding: '5px 14px',
    fontSize: 11,
    fontWeight: 600,
    color: '#02a4ba',
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    whiteSpace: 'nowrap',
  },
  btnReviewed: {
    background: 'rgba(61,232,160,0.08)',
    border: '1px solid rgba(61,232,160,0.25)',
    borderRadius: 6,
    padding: '5px 14px',
    fontSize: 11,
    fontWeight: 600,
    color: '#3de8a0',
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    whiteSpace: 'nowrap',
  },
};