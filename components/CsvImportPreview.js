// components/CsvImportPreview.js
// Shown after /api/pos/analyze-csv returns — lets the restaurant see (and,
// if it's wrong, fix) the detected POS system and column mapping before
// anything gets written to pos_sales. Column detection is plain keyword
// matching with no confidence signal, unlike the AI invoice parser, so this
// checkpoint exists specifically because silent auto-import felt too risky
// for numbers that feed OptiScore and recommendations directly.

import { useState } from 'react';

const FIELD_LABELS = {
  item_name: 'Item name',
  sale_date: 'Sale date',
  quantity_sold: 'Quantity sold',
  revenue: 'Revenue',
  unit_price: 'Unit price',
  category: 'Category',
  hour_of_day: 'Hour of day',
  voids: 'Voids',
  comps: 'Comps',
};
const POS_SYSTEMS = ['toast', 'square', 'clover', 'lightspeed', 'other'];

export default function CsvImportPreview({ analysis, onConfirm, onCancel }) {
  const [posSystem, setPosSystem] = useState(analysis.posSystem);
  const [columnMapping, setColumnMapping] = useState(analysis.columnMapping);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const setField = (field, column) => {
    setColumnMapping((prev) => ({ ...prev, [field]: column || null }));
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await onConfirm({ posSystem, columnMapping });
    } catch (err) {
      setError(err.message || 'Import failed.');
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(17,24,25,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--shell,#fff)', border: '1px solid var(--line,#d8dfe0)', borderRadius: 14, boxShadow: '0 24px 60px rgba(17,24,25,0.25)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line-soft,#eef1f2)' }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-deep,#03808f)', marginBottom: 6 }}>
            Review before importing
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text,#111819)' }}>
            {analysis.usableRows} of {analysis.totalRows} rows ready
            {analysis.dateFrom && analysis.dateTo ? ` · ${analysis.dateFrom} to ${analysis.dateTo}` : ''}
          </div>
          {analysis.possibleOverlapRows > 0 && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--amber-tint,#fbf3e6)', border: '1px solid var(--amber,#c1871c)', fontSize: 12.5, color: 'var(--amber,#c1871c)' }}>
              {analysis.possibleOverlapRows} existing row(s) already cover part of this date range for this POS system — check you're not double-importing.
            </div>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 22px' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--muted,#4b585b)', marginBottom: 5 }}>Detected POS system</label>
            <select value={posSystem} onChange={(e) => setPosSystem(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line,#d8dfe0)', fontSize: 13.5 }}>
              {POS_SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted,#4b585b)', marginBottom: 8 }}>Column mapping — fix any that look wrong</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field}>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--faint,#78868a)', marginBottom: 3 }}>{label}</label>
                <select
                  value={columnMapping[field] || ''}
                  onChange={(e) => setField(field, e.target.value)}
                  style={{ width: '100%', padding: '7px 8px', borderRadius: 7, border: '1px solid var(--line,#d8dfe0)', fontSize: 12.5 }}
                >
                  <option value="">— none —</option>
                  {analysis.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {analysis.preview.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted,#4b585b)', marginBottom: 8 }}>Preview (first {analysis.preview.length} rows)</div>
              <div style={{ border: '1px solid var(--line-soft,#eef1f2)', borderRadius: 8, overflow: 'hidden' }}>
                {analysis.preview.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 10px', fontSize: 12, borderBottom: i < analysis.preview.length - 1 ? '1px solid var(--line-soft,#eef1f2)' : 'none' }}>
                    <span style={{ fontWeight: 600 }}>{r.item_name}</span>
                    <span style={{ color: 'var(--faint,#78868a)' }}>{r.sale_date} · qty {r.quantity_sold} · ${r.revenue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 14, padding: '10px 13px', borderRadius: 8, fontSize: 12.5, background: 'var(--red-tint,#faeae8)', border: '1px solid var(--red,#c4473e)', color: 'var(--red,#c4473e)' }}>{error}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '14px 22px', borderTop: '1px solid var(--line-soft,#eef1f2)' }}>
          <button type="button" onClick={onCancel} disabled={submitting} style={{ flex: 1, padding: 11, borderRadius: 8, border: '1px solid var(--line,#d8dfe0)', background: 'none', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={submitting} style={{ flex: 2, padding: 11, borderRadius: 8, border: 'none', background: 'var(--accent,#02a4ba)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Importing…' : `Import ${analysis.usableRows} rows`}
          </button>
        </div>
      </div>
    </div>
  );
}
