// components/admin/NoteDialog.js
// "Add note": puts a hand-written ticket on the rail. Used on Today and
// All tickets.

import { useState } from 'react';
import { Dialog } from './AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

export default function NoteDialog({ onClose, onSaved }) {
  const { adminFetch } = useAdminFetch();
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setErr('');
    try {
      const res = await adminFetch('/api/admin/tickets', { method: 'POST', body: JSON.stringify({ action: 'note', title, meta }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      onSaved();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  return (
    <Dialog title="Add a note" sub="It goes on the rail and stays until you mark it done." onClose={onClose}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 }}>
        What needs doing
        <input className="om-field" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }} placeholder="Ask Shift4 about kitchen printers" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 }}>
        Detail (optional)
        <input className="om-field" value={meta} maxLength={300} onChange={(e) => setMeta(e.target.value)} />
      </label>
      {err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" onClick={save} disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Add to the rail'}</button>
      </div>
    </Dialog>
  );
}