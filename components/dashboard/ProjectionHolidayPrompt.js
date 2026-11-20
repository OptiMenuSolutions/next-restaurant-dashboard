import { useEffect, useRef, useState } from 'react';
import supabase from '../../lib/supabaseClient';
import { PROJECTION_HOLIDAYS } from '../../lib/projections/calendar.js';
import { claimOptionalProjectionHoliday, projectionCalendarRequest } from '../../lib/projections/calendarClient.js';

export default function ProjectionHolidayPrompt({ restaurantId, today, enabled }) {
  const [prompt, setPrompt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    if (!enabled || !restaurantId || !today) return;
    let cancelled = false;
    claimOptionalProjectionHoliday(supabase, `${restaurantId}:${today}`)
      .then(result => { if (!cancelled) setPrompt(result.prompt ? { ...result.prompt, scope: `${restaurantId}:${today}` } : null); })
      .catch(() => {}); // An optional question never interrupts the dashboard.
    return () => { cancelled = true; };
  }, [enabled, restaurantId, today]);
  useEffect(() => {
    if (!prompt || !enabled) return;
    const previous = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => previous?.focus?.();
  }, [prompt, enabled]);
  async function respond(answer) {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await projectionCalendarRequest(supabase, '/api/projections/holiday', {
        action: 'answer', business_date: prompt.business_date, expected_revision: prompt.revision, answer,
      });
      setPrompt(null);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  function dismiss() {
    const date = prompt.business_date;
    setPrompt(null); setError('');
    projectionCalendarRequest(supabase, '/api/projections/holiday',
      { action: 'dismiss', business_date: date }).catch(() => {});
  }
  if (!prompt || !enabled || prompt.scope !== `${restaurantId}:${today}`) return null;
  const button = { padding: '12px 14px', minHeight: 44, border: '1px solid var(--line, #d8dfe0)',
    borderRadius: 8, background: 'var(--shell, white)', color: 'var(--text, #111819)', cursor: 'pointer' };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#11181966', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="projection-holiday-title"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
          if (event.key === 'Tab') {
            const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
            const first = buttons[0], last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        style={{ width: 'min(100%, 420px)', padding: 24, borderRadius: 14, background: 'var(--shell, white)', color: 'var(--text, #111819)' }}>
        <h2 id="projection-holiday-title" style={{ margin: '0 0 10px', fontSize: 20 }}>Open for {PROJECTION_HOLIDAYS[prompt.holiday_key]}?</h2>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>{prompt.business_date}. Optional—this helps us plan around your holiday hours.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[['open', 'Open'], ['closed', 'Closed'], ['early_close', 'Closing early']].map(([value, label]) => (
            <button key={value} type="button" style={button} disabled={saving} onClick={() => respond(value)}>{label}</button>
          ))}
        </div>
        {error && <p role="status" style={{ fontSize: 13 }}>{error}</p>}
        <button type="button" onClick={dismiss} style={{ ...button, marginTop: 16, border: 'none' }}>Not now</button>
      </div>
    </div>
  );
}