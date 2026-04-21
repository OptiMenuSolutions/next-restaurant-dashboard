// pages/admin/ingredients.js
// Global ingredients library — view, add, edit, delete.

import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

const UNITS = ['lb', 'oz', 'each', 'bunch', 'slice', 'sheet', 'sprig', 'gal', 'qt', 'bag', 'case', 'box', 'g', 'kg', 'ml', 'l'];

function Modal({ title, onClose, children }) {
  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.modal} onClick={e => e.stopPropagation()}>
        <div style={m.modalHeader}>
          <span style={m.modalTitle}>{title}</span>
          <button onClick={onClose} style={m.closeBtn}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function GlobalIngredientsPage() {
  const { adminFetch } = useAdminFetch();
  const [ingredients, setIngredients] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: '', unit: 'lb' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  async function load() {
    try {
      const res = await adminFetch('/api/admin/ingredients');
      const json = await res.json();
      setIngredients(json.ingredients || []);
      setStats(json.stats || {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const method = editItem ? 'PUT' : 'POST';
      const body   = editItem ? { id: editItem.id, ...form } : form;
      const res = await adminFetch('/api/admin/ingredients', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Failed to save');
        return;
      }
      setShowAdd(false);
      setEditItem(null);
      setForm({ name: '', unit: 'lb' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await adminFetch('/api/admin/ingredients', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setDeleteConfirm(null);
      await load();
    } catch (err) {
      console.error(err);
    }
  }

  function openEdit(ing) {
    setEditItem(ing);
    setForm({ name: ing.name, unit: ing.unit });
    setError('');
    setShowAdd(true);
  }

  const filtered = ingredients.filter(ing => {
    const q = search.toLowerCase();
    if (q && !(ing.name || '').toLowerCase().includes(q)) return false;
    if (unitFilter !== 'all' && ing.unit !== unitFilter) return false;
    return true;
  });

  const topUnits = (stats.units || []).slice(0, 6);

  return (
    <AdminLayout title="Global Ingredients">
      <div style={s.page}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Global Ingredients</h1>
            <p style={s.subtitle}>{stats.total || 0} ingredients · used by the menu parser as a reference library</p>
          </div>
          <button style={s.addBtn} onClick={() => { setEditItem(null); setForm({ name: '', unit: 'lb' }); setError(''); setShowAdd(true); }}>
            + Add Ingredient
          </button>
        </div>

        {/* ── Unit Breakdown ── */}
        {topUnits.length > 0 && (
          <div style={s.unitRow}>
            <span style={{ fontSize: 9, color: '#3a3e50' }}>Units:</span>
            {[{ unit: 'all', count: stats.total || 0 }, ...topUnits].map(u => (
              <button
                key={u.unit}
                onClick={() => setUnitFilter(u.unit)}
                style={{
                  ...s.unitChip,
                  borderColor: unitFilter === u.unit ? '#02a4ba' : '#1e2028',
                  color: unitFilter === u.unit ? '#02a4ba' : '#5a6080',
                  background: unitFilter === u.unit ? 'rgba(2,164,186,0.1)' : 'none',
                }}
              >
                {u.unit === 'all' ? 'All' : u.unit}
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9 }}>{u.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Search ── */}
        <input
          style={s.search}
          placeholder="Search ingredients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* ── Table ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Name', 'Unit', ''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={3} style={{ ...s.td, textAlign: 'center', color: '#3a3e50', padding: 32 }}>No ingredients found</td></tr>
                ) : filtered.map(ing => (
                  <tr key={ing.id} style={s.row}>
                    <td style={{ ...s.td, fontSize: 12, fontWeight: 500, color: '#e4e6f0' }}>{ing.name}</td>
                    <td style={s.td}>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#5a6080', background: '#1a1c23', borderRadius: 4, padding: '2px 6px' }}>
                        {ing.unit}
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => openEdit(ing)} style={s.editBtn}>Edit</button>
                        <button onClick={() => setDeleteConfirm(ing)} style={s.deleteBtn}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Add / Edit Modal ── */}
        {showAdd && (
          <Modal title={editItem ? 'Edit Ingredient' : 'Add Ingredient'} onClose={() => { setShowAdd(false); setEditItem(null); }}>
            <div style={m.field}>
              <label style={m.label}>Name</label>
              <input
                style={m.input}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Mozzarella"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>
            <div style={m.field}>
              <label style={m.label}>Unit</label>
              <select style={m.input} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {error && <div style={m.error}>{error}</div>}
            <div style={m.actions}>
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} style={m.cancelBtn}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={m.saveBtn}>
                {saving ? 'Saving…' : editItem ? 'Save Changes' : 'Add Ingredient'}
              </button>
            </div>
          </Modal>
        )}

        {/* ── Delete Confirm Modal ── */}
        {deleteConfirm && (
          <Modal title="Delete Ingredient" onClose={() => setDeleteConfirm(null)}>
            <p style={{ fontSize: 12, color: '#7880a0', margin: '0 0 16px' }}>
              Are you sure you want to delete <strong style={{ color: '#e4e6f0' }}>{deleteConfirm.name}</strong> from the global library?
              This won't affect existing restaurant ingredients.
            </p>
            <div style={m.actions}>
              <button onClick={() => setDeleteConfirm(null)} style={m.cancelBtn}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} style={{ ...m.saveBtn, background: 'rgba(232,84,84,0.15)', borderColor: 'rgba(232,84,84,0.3)', color: '#e85454' }}>
                Delete
              </button>
            </div>
          </Modal>
        )}

      </div>
    </AdminLayout>
  );
}

const s = {
  page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Inter', sans-serif" },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: 700, color: '#e4e6f0', letterSpacing: '-0.5px', fontFamily: "'Playfair Display', serif", margin: 0 },
  subtitle: { fontSize: 10, color: '#3a3e50', marginTop: 3 },
  addBtn: {
    padding: '8px 14px', fontSize: 11, fontWeight: 600,
    background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.3)',
    borderRadius: 6, color: '#02a4ba', cursor: 'pointer', fontFamily: "'Inter', sans-serif",
  },
  unitRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  unitChip: { padding: '4px 10px', fontSize: 10, fontWeight: 500, borderRadius: 20, border: '1px solid', cursor: 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s' },
  search: {
    width: '100%', padding: '7px 12px', fontSize: 11, boxSizing: 'border-box',
    background: '#111318', border: '1px solid #1e2028', borderRadius: 6,
    color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none',
  },
  tableWrap: { background: '#111318', border: '1px solid #1e2028', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '10px 14px', textAlign: 'left', borderBottom: '1px solid #1e2028', background: '#0f1115' },
  td: { padding: '10px 14px', borderBottom: '1px solid #0f1115', verticalAlign: 'middle' },
  row: { transition: 'background 0.1s' },
  editBtn: { fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 5, background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.25)', color: '#02a4ba', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
  deleteBtn: { fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 5, background: 'rgba(232,84,84,0.08)', border: '1px solid rgba(232,84,84,0.2)', color: '#e85454', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};

const m = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#111318', border: '1px solid #1e2028', borderRadius: 10, padding: 20, width: 360, fontFamily: "'Inter', sans-serif" },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 14, fontWeight: 700, color: '#e4e6f0' },
  closeBtn: { background: 'none', border: 'none', color: '#5a6080', fontSize: 18, cursor: 'pointer', lineHeight: 1 },
  field: { marginBottom: 12 },
  label: { display: 'block', fontSize: 9, fontWeight: 700, color: '#3a3e50', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 },
  input: { width: '100%', padding: '8px 10px', fontSize: 12, background: '#0f1115', border: '1px solid #1e2028', borderRadius: 6, color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none', boxSizing: 'border-box' },
  error: { fontSize: 10, color: '#e85454', marginBottom: 10 },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { padding: '7px 14px', fontSize: 11, background: 'none', border: '1px solid #1e2028', borderRadius: 6, color: '#5a6080', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
  saveBtn: { padding: '7px 14px', fontSize: 11, fontWeight: 600, background: 'rgba(2,164,186,0.15)', border: '1px solid rgba(2,164,186,0.3)', borderRadius: 6, color: '#02a4ba', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
};