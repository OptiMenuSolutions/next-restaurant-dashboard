import { useEffect, useRef, useState } from 'react';
import supabase from '../../lib/supabaseClient';
import { PROJECTION_HOLIDAYS } from '../../lib/projections/calendar.js';
import { claimOptionalProjectionHoliday, projectionCalendarRequest, projectionHolidayDateLabel } from '../../lib/projections/calendarClient.js';

export default function ProjectionHolidayPrompt({ restaurantId, today, enabled }) {
  const [prompt, setPrompt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState({});
  const dialog = useRef(null);
  useEffect(() => {
    if (!enabled || !restaurantId || !today) return;
    let cancelled = false;
    claimOptionalProjectionHoliday(supabase, `${restaurantId}:${today}`)
      .then(result => {
        if (!cancelled) {
          setAnswers({}); setError('');
          setPrompt(result.prompt ? { ...result.prompt, scope: `${restaurantId}:${today}` } : null);
        }
      })
      .catch(() => {}); // An optional question never interrupts the dashboard.
    return () => { cancelled = true; };
  }, [enabled, restaurantId, today]);
  useEffect(() => {
    if (!prompt || !enabled) return;
    const previous = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => previous?.focus?.();
  }, [prompt, enabled]);
  async function respond() {
    const responses = prompt.holidays.filter(row => answers[row.business_date]).map(row => ({
      business_date: row.business_date, expected_revision: row.revision, answer: answers[row.business_date],
    }));
    if (saving || !responses.length) return;
    setSaving(true); setError('');
    try {
      await projectionCalendarRequest(supabase, '/api/projections/holiday', {
        action: 'answer', responses,
      });
      setPrompt(null);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  function dismiss() {
    setPrompt(null); setError('');
    projectionCalendarRequest(supabase, '/api/projections/holiday',
      { action: 'dismiss' }).catch(() => {});
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
        style={{ width: 'min(100%, 480px)', maxHeight: '85vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: 'var(--shell, white)', color: 'var(--text, #111819)' }}>
        <h2 id="projection-holiday-title" style={{ margin: '0 0 10px', fontSize: 20 }}>Upcoming holiday hours</h2>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>Optional—answer any dates you know to help us plan around your holiday hours.</p>
        {prompt.holidays.map(row => (
          <fieldset key={row.business_date} style={{ border: 0, padding: 0, margin: '18px 0' }}>
            <legend style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
              {PROJECTION_HOLIDAYS[row.holiday_key]} · {projectionHolidayDateLabel(row.business_date)}
            </legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[['open', 'Open'], ['closed', 'Closed'], ['early_close', 'Closing early']].map(([value, label]) => (
                <button key={value} type="button" disabled={saving} aria-pressed={answers[row.business_date] === value}
                  style={{ ...button, borderColor: answers[row.business_date] === value ? 'var(--teal, #009eae)' : 'var(--line, #d8dfe0)' }}
                  onClick={() => setAnswers(current => ({ ...current,
                    [row.business_date]: current[row.business_date] === value ? '' : value,
                  }))}>{label}</button>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="button" onClick={respond} style={button}
          disabled={saving || !prompt.holidays.some(row => answers[row.business_date])}>
          {saving ? 'Saving…' : 'Save answers'}
        </button>
        {error && <p role="status" style={{ fontSize: 13 }}>{error}</p>}
        <button type="button" onClick={dismiss} style={{ ...button, marginTop: 16, border: 'none' }}>Not now</button>
      </div>
    </div>
  );
}