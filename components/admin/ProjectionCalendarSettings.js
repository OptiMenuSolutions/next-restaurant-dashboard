import { useEffect, useState } from 'react';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';

export default function ProjectionCalendarSettings({ restaurantId }) {
  const { adminFetch } = useAdminFetch();
  const [current, setCurrent] = useState(null);
  const [concept, setConcept] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setCurrent(null); setError('');
    adminFetch(`/api/admin/projection-calendar?restaurantId=${encodeURIComponent(restaurantId)}`)
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Could not load projection settings.');
        if (!cancelled) { setCurrent(value); setConcept(value.settings.concept_type || ''); }
      }).catch(failure => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
  }, [restaurantId, adminFetch]);
  async function save() {
    setSaving(true); setError('');
    try {
      const response = await adminFetch(`/api/admin/projection-calendar?restaurantId=${encodeURIComponent(restaurantId)}`, {
        method: 'PUT', body: JSON.stringify({ expected_revision: current.revision,
          settings: { ...current.settings, concept_type: concept || null } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save projection settings.');
      setCurrent({ ...current, revision: result.revision, settings: { ...current.settings, concept_type: concept || null } });
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  return (
    <section aria-label="Projection calendar settings" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 18 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Projection concept</h3>
      <label>Style of restaurant
        <select value={concept} onChange={event => setConcept(event.target.value)} disabled={!current || saving}
          style={{ display: 'block', width: '100%', minHeight: 44, margin: '6px 0 12px', padding: 8 }}>
          <option value="">Full service default — not explicitly configured</option>
          <option value="full_service">Full service</option>
          <option value="bar_pub">Bar / pub</option>
          <option value="quick_service">Quick service</option>
        </select>
      </label>
      <button type="button" className="om-pri" onClick={save} disabled={!current || saving}>{saving ? 'Saving…' : 'Save concept'}</button>
      {error && <p role="status">{error}</p>}
    </section>
  );
}