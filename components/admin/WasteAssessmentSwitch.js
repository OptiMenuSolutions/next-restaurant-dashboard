import React, { useEffect, useRef, useState } from 'react';
import { Card } from './ui';

const auditDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
});

function sourceLabel(source, current, fallback) {
  if (!source) return 'Reader status unavailable';
  if (source.mode === 'legacy') return `${fallback} (${source.reason})`;
  return `${current} · ${source.assessment_date}${source.stale ? ' · stale' : ''}`;
}

function SourceRows({ sources }) {
  return <>
    <dt>Owner dashboard</dt><dd>{sourceLabel(sources.owner_card, 'New card', 'Old card')}</dd>
    <dt>Tonight’s Dish</dt><dd>{sourceLabel(sources.tonight_dish, 'Assessment', 'Old path')}</dd>
  </>;
}

export function WasteAssessmentSwitchDetails({ status, saving, onChange }) {
  const { enabled, projections_enabled, has_compact_assessment, latest_completed, updated_at } = status;
  const loaded = typeof projections_enabled === 'boolean';
  const blocked = !loaded ? 'Load the assessment status before turning On.'
    : !projections_enabled ? 'Projections are disabled.'
    : !has_compact_assessment ? 'No completed compact assessment is available.' : '';

  function toggle() {
    if (saving) return;
    if (!enabled && (blocked ||
        !window.confirm(`Switch ${status.restaurant_name} to the new waste card and Tonight's Dish source?`))) return;
    return onChange(!enabled);
  }

  return <>
    <p><strong>Switch {enabled ? 'On' : 'Off'}</strong></p>
    <button type="button" className={enabled ? 'om-btn' : 'om-pri'} onClick={toggle}
      disabled={saving || (!enabled && !!blocked)}
      aria-describedby={!enabled && blocked ? 'waste-switch-blocked' : undefined}>
      {saving ? 'Saving…' : enabled ? 'Turn Off' : 'Turn On'}
    </button>
    {!enabled && blocked && <p id="waste-switch-blocked">{blocked}</p>}
    {loaded && <>
      <dl>
        <dt>Projections</dt><dd>{projections_enabled ? 'Enabled' : 'Disabled'}</dd>
        <dt>Latest completed assessment</dt>
        <dd>{latest_completed ? `${latest_completed.assessment_date} · ${latest_completed.compact
          ? 'Compact (schema version 2)' : 'Non-compact'}` : 'None'}</dd>
        <SourceRows sources={status} />
      </dl>
      {!enabled && status.if_enabled && <>
        <h3>If turned On</h3>
        <dl><SourceRows sources={status.if_enabled} /></dl>
      </>}
      {updated_at ? <p>
        Last changed <time dateTime={updated_at}>{auditDate.format(new Date(updated_at))} ET</time> by{' '}
        {status.updated_by_email ? `${status.updated_by_email} (${status.updated_by})` : status.updated_by}.
      </p> : <p>No switch changes recorded.</p>}
    </>}
  </>;
}

async function checkedReply(response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Waste card request failed.');
  return result;
}

export default function WasteAssessmentSwitch({ restaurantId, adminFetch, refresh }) {
  const endpoint = `/api/admin/projections/waste-assessment-switch?${new URLSearchParams({ restaurantId })}`;
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [readError, setReadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const sequence = useRef(0);

  useEffect(() => {
    const current = ++sequence.current;
    const controller = new AbortController();
    setReadError('');
    adminFetch(endpoint, { signal: controller.signal })
      .then(checkedReply)
      .then(result => {
        if (!controller.signal.aborted && current === sequence.current) setStatus(result);
      })
      .catch(error => {
        if (!controller.signal.aborted && current === sequence.current) setReadError(error.message);
      });
    return () => controller.abort();
  }, [adminFetch, endpoint, refresh, retry]);

  async function save(enabled) {
    setSaving(true);
    setSaveError('');
    try {
      const result = await checkedReply(await adminFetch(endpoint, {
        method: 'PUT', body: JSON.stringify({ enabled }),
      }));
      // Discard any GET started before the save. Show the saved state while
      // the next GET collects the new audit fields and consumer status.
      ++sequence.current;
      setStatus({ enabled: result.enabled });
      setRetry(value => value + 1);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return <Card title="Waste card and Tonight’s Dish">
    {!status && !readError && <p role="status">Loading waste assessment status…</p>}
    {status && <WasteAssessmentSwitchDetails status={status} saving={saving} onChange={save} />}
    {readError && <p role="alert">{readError}{' '}
      <button type="button" className="om-btn" onClick={() => setRetry(value => value + 1)}>Try again</button>
    </p>}
    {saveError && <p role="alert">{saveError}</p>}
  </Card>;
}