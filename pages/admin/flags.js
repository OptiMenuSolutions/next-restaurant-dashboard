// pages/admin/flags.js
// Feature flags management — toggle features on/off across the app.

import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

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

function Toggle({ enabled, onChange, loading }) {
  return (
    <button
      onClick={onChange}
      disabled={loading}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none',
        background: enabled ? '#02a4ba' : '#1e2028',
        cursor: loading ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        opacity: loading ? 0.6 : 1,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%',
        background: '#e4e6f0',
        position: 'absolute', top: 3,
        left: enabled ? 21 : 3,
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

export default function FeatureFlagsPage() {
  const { adminFetch } = useAdminFetch();
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ key: '', label: '', description: '', enabled: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch] = useState('');

  async function load() {
    try {
      const res = await adminFetch('/api/admin/flags');
      const json = await res.json();
      setFlags(json.flags || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleToggle(flag) {
    setToggling(t => ({ ...t, [flag.id]: true }));
    try {
      const res = await adminFetch('/api/admin/flags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: flag.id, enabled: !flag.enabled }),
      });
      if (res.ok) {
        setFlags(prev => prev.map(f => f.id === flag.id ? { ...f, enabled: !f.enabled } : f));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setToggling(t => ({ ...t, [flag.id]: false }));
    }
  }

  async function handleSave() {
    if (!form.key.trim() || !form.label.trim()) { setError('Key and label are required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Failed to save');
        return;
      }
      setShowAdd(false);
      setForm({ key: '', label: '', description: '', enabled: false });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await adminFetch('/api/admin/flags', {
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

  const filtered = flags.filter(f => {
    const q = search.toLowerCase();
    return !q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q);
  });

  const enabledCount  = flags.filter(f => f.enabled).length;
  const disabledCount = flags.filter(f => !f.enabled).length;

  return (
    <AdminLayout title="Feature Flags">
      <div style={s.page}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Feature Flags</h1>
            <p style={s.subtitle}>
              {enabledCount} enabled · {disabledCount} disabled · changes take effect immediately
            </p>
          </div>
          <button style={s.addBtn} onClick={() => { setForm({ key: '', label: '', description: '', enabled: false }); setError(''); setShowAdd(true); }}>
            + New Flag
          </button>
        </div>

        {/* ── Search ── */}
        <input
          style={s.search}
          placeholder="Search flags…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* ── Flags List ── */}
        {loading ? (
          <div style={s.center}><div style={s.spinner} /><span style={{ color: '#3a3e50', fontSize: 12 }}>Loading…</span></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.length === 0 ? (
              <div style={{ ...s.center, padding: 40 }}><span style={{ color: '#3a3e50', fontSize: 12 }}>No flags found</span></div>
            ) : filtered.map(flag => (
              <div
                key={flag.id}
                style={{
                  ...s.flagRow,
                  borderColor: flag.enabled ? 'rgba(2,164,186,0.2)' : '#1e2028',
                  background: flag.enabled ? 'rgba(2,164,186,0.03)' : '#111318',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e4e6f0' }}>{flag.label}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#3a3e50', background: '#1a1c23', padding: '2px 6px', borderRadius: 4 }}>
                      {flag.key}
                    </span>
                  </div>
                  {flag.description && (
                    <p style={{ fontSize: 10, color: '#5a6080', margin: 0 }}>{flag.description}</p>
                  )}
                  <p style={{ fontSize: 8, color: '#3a3e50', margin: '4px 0 0', fontFamily: "'DM Mono', monospace" }}>
                    updated {new Date(flag.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: flag.enabled ? '#02a4ba' : '#3a3e50', fontWeight: 600 }}>
                    {flag.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Toggle
                    enabled={flag.enabled}
                    onChange={() => handleToggle(flag)}
                    loading={!!toggling[flag.id]}
                  />
                  <button onClick={() => setDeleteConfirm(flag)} style={s.deleteBtn}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Add Modal ── */}
        {showAdd && (
          <Modal title="New Feature Flag" onClose={() => setShowAdd(false)}>
            <div style={m.field}>
              <label style={m.label}>Label <span style={{ color: '#3a3e50' }}>(human readable)</span></label>
              <input
                style={m.input}
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Invoice Parsing"
                autoFocus
              />
            </div>
            <div style={m.field}>
              <label style={m.label}>Key <span style={{ color: '#3a3e50' }}>(used in code)</span></label>
              <input
                style={m.input}
                value={form.key}
                onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                placeholder="e.g. invoice_parsing"
              />
            </div>
            <div style={m.field}>
              <label style={m.label}>Description <span style={{ color: '#3a3e50' }}>(optional)</span></label>
              <input
                style={m.input}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What does this flag control?"
              />
            </div>
            <div style={m.field}>
              <label style={{ ...m.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                />
                Enable immediately
              </label>
            </div>
            {error && <div style={m.error}>{error}</div>}
            <div style={m.actions}>
              <button onClick={() => setShowAdd(false)} style={m.cancelBtn}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={m.saveBtn}>
                {saving ? 'Creating…' : 'Create Flag'}
              </button>
            </div>
          </Modal>
        )}

        {/* ── Delete Confirm ── */}
        {deleteConfirm && (
          <Modal title="Delete Flag" onClose={() => setDeleteConfirm(null)}>
            <p style={{ fontSize: 12, color: '#7880a0', margin: '0 0 16px' }}>
              Are you sure you want to delete <strong style={{ color: '#e4e6f0' }}>{deleteConfirm.label}</strong>?
              Any code checking <code style={{ fontFamily: "'DM Mono', monospace", color: '#02a4ba' }}>{deleteConfirm.key}</code> will need to be updated.
            </p>
            <div style={m.actions}>
              <button onClick={() => setDeleteConfirm(null)} style={m.cancelBtn}>Cancel</button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                style={{ ...m.saveBtn, background: 'rgba(232,84,84,0.15)', borderColor: 'rgba(232,84,84,0.3)', color: '#e85454' }}
              >
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
  addBtn: { padding: '8px 14px', fontSize: 11, fontWeight: 600, background: 'rgba(2,164,186,0.1)', border: '1px solid rgba(2,164,186,0.3)', borderRadius: 6, color: '#02a4ba', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
  search: { width: '100%', padding: '7px 12px', fontSize: 11, boxSizing: 'border-box', background: '#111318', border: '1px solid #1e2028', borderRadius: 6, color: '#e4e6f0', fontFamily: "'Inter', sans-serif", outline: 'none' },
  flagRow: { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 8, border: '1px solid', transition: 'border-color 0.2s, background 0.2s' },
  deleteBtn: { fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 5, background: 'rgba(232,84,84,0.08)', border: '1px solid rgba(232,84,84,0.2)', color: '#e85454', cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 },
  spinner: { width: 16, height: 16, border: '2px solid #1e2028', borderTopColor: '#02a4ba', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};

const m = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#111318', border: '1px solid #1e2028', borderRadius: 10, padding: 20, width: 400, fontFamily: "'Inter', sans-serif" },
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