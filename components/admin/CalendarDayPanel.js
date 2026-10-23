// components/admin/CalendarDayPanel.js
// The selected day on the admin calendar: hours worked with what was done,
// separate notes, and events with a start and end time. Each has its own add
// button, and every entry has its own edit and delete.

import { useEffect, useRef, useState } from 'react';
import { MONO } from '../client/ClientChrome';
import { Confirm } from './AdminShell';

export const TIME_CATEGORIES = ['Development', 'Certification', 'Sales', 'Support', 'Admin', 'Other'];
export const hoursText = (h) => `${Number(Number(h || 0).toFixed(2))}h`;

// One color per kind of thing on a day. The calendar's chips, its legend and
// the day panel's sections all use these, so a color means the same everywhere.
// bg/fg are the chip colors; tint/line are the panel section's box and stripe.
export const CAL = {
  event:    { bg: 'rgba(47,111,179,0.14)', fg: '#2f6fb3', label: 'Scheduled' },
  note:     { bg: 'rgba(196,138,28,0.16)', fg: '#a8740f', label: 'Notes' },
  time:     { bg: 'rgba(124,92,214,0.14)', fg: '#7c5cd6', label: 'Time' },
  deadline: { bg: 'var(--text)', fg: 'var(--shell)', label: 'Deadlines', tint: 'rgba(128,128,128,0.10)', line: 'var(--text)' },
  sales:    { bg: 'var(--green-tint)', fg: 'var(--green)', label: 'Sales' },
  activity: { bg: 'var(--accent-tint)', fg: 'var(--accent-deep)', label: 'Platform activity' },
  bad:      { bg: 'var(--red-tint)', fg: 'var(--red)', label: 'Problems' },
};

export function Section({ kind, title, right, children, innerRef }) {
  const k = CAL[kind];
  const line = k.line || k.fg;
  return (
    <div ref={innerRef} style={{ background: k.tint || k.bg, borderLeft: `3px solid ${line}`, borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', fontWeight: 700, color: line, display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span>{title}</span>{right}
      </div>
      {children}
    </div>
  );
}

const label = { fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' };
const row = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13.5 };
const editBtn = { border: 0, background: 'none', padding: 0, color: 'var(--accent-deep)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 };
const xBtn = { border: 0, background: 'none', padding: '0 2px', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 };

function t12(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

function Actions({ onEdit, onDelete, busy, what }) {
  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
      <button type="button" style={editBtn} disabled={busy} onClick={onEdit}>Edit</button>
      <button type="button" style={xBtn} aria-label={`Delete ${what}`} disabled={busy} onClick={onDelete}>×</button>
    </span>
  );
}

export default function CalendarDayPanel({ day, d, busy, post, openTime, onTimeShown }) {
  const [mode, setMode] = useState(null); // 'note' | 'event' | 'time'
  const [edit, setEdit] = useState(null); // id of the entry being edited
  const [form, setForm] = useState({});
  const [del, setDel] = useState(null);
  const timeRef = useRef(null);

  function open(m, item) {
    setMode(m);
    setEdit(item?.id || null);
    if (m === 'note') setForm({ note: item?.note || '' });
    if (m === 'event') setForm({ title: item?.title || '', allDay: item ? !item.time : false, time: hhmm(item?.time), end_time: hhmm(item?.end_time), details: item?.details || '' });
    if (m === 'time') setForm({ hours: item ? String(item.hours) : '', categories: item?.categories || [], description: item?.description || '' });
  }
  const close = () => { setMode(null); setEdit(null); };
  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm((f) => ({ ...f, [k]: v })); };

  useEffect(() => { close(); }, [day]);
  useEffect(() => {
    if (!openTime) return;
    if (d.time.length) timeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else open('time');
    onTimeShown?.();
  }, [openTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const badRange = mode === 'event' && !form.allDay && form.time && form.end_time && form.end_time <= form.time;
  const canSave = mode === 'note' ? !!form.note?.trim()
    : mode === 'event' ? !!form.title?.trim() && (form.allDay || !!form.time) && !badRange
    : mode === 'time' ? Number(form.hours) > 0 && Number(form.hours) <= 24
    : false;

  async function save() {
    if (!canSave || busy) return;
    const body = mode === 'note' ? { action: 'note', id: edit, day, note: form.note }
      : mode === 'event' ? { action: 'event', id: edit, day, title: form.title, time: form.allDay ? '' : form.time, end_time: form.allDay ? '' : form.end_time, details: form.details }
      : { action: 'time', id: edit, day, hours: form.hours, categories: TIME_CATEGORIES.filter((c) => form.categories.includes(c)), description: form.description };
    const done = { note: edit ? 'Note updated.' : 'Note added.', event: edit ? 'Event updated.' : 'Event added.', time: edit ? 'Time updated.' : 'Time logged.' }[mode];
    if (await post(body, done)) close();
  }
  const onKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape') close();
  };

  const total = d.time.reduce((s, t) => s + Number(t.hours || 0), 0);
  const addBtn = (m, text) => (
    <button type="button" className="om-btn" aria-pressed={mode === m && !edit} onClick={() => (mode === m && !edit ? close() : open(m))}
      style={{ minHeight: 32, flex: '1 1 0', fontWeight: 700, color: CAL[m].fg, borderColor: CAL[m].fg, background: mode === m && !edit ? CAL[m].bg : undefined }}>{text}</button>
  );

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        {addBtn('note', '+ Note')}
        {addBtn('event', '+ Event')}
        {addBtn('time', '+ Log time')}
      </div>

      {mode && (
        <div onKeyDown={onKey} style={{ border: `1px solid ${CAL[mode].fg}`, borderLeft: `3px solid ${CAL[mode].fg}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--panel)' }}>
          <div style={{ ...label, fontWeight: 700, color: CAL[mode].fg }}>{{ note: edit ? 'EDIT NOTE' : 'NEW NOTE', event: edit ? 'EDIT EVENT' : 'NEW EVENT', time: edit ? 'EDIT TIME' : 'LOG TIME' }[mode]}</div>

          {mode === 'note' && (
            <textarea className="om-field" rows={3} autoFocus value={form.note} onChange={set('note')} placeholder="Write a note" style={{ padding: 8, resize: 'vertical' }} />
          )}

          {mode === 'event' && (
            <>
              <input className="om-field" autoFocus placeholder="What is it?" value={form.title} onChange={set('title')} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.allDay} onChange={set('allDay')} /> All day
              </label>
              {!form.allDay && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input className="om-field" type="time" aria-label="Starts" value={form.time} onChange={set('time')} style={{ flex: 1 }} />
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>to</span>
                  <input className="om-field" type="time" aria-label="Ends" value={form.end_time} onChange={set('end_time')} style={{ flex: 1 }} />
                </div>
              )}
              {badRange && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>The end time is before the start.</div>}
              <textarea className="om-field" rows={2} placeholder="Details (optional)" value={form.details} onChange={set('details')} style={{ padding: 8, resize: 'vertical' }} />
            </>
          )}

          {mode === 'time' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="om-field" type="number" inputMode="decimal" min="0.25" max="24" step="0.25" autoFocus aria-label="Hours" placeholder="0" value={form.hours} onChange={set('hours')} style={{ width: 96 }} />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>hours</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TIME_CATEGORIES.map((c) => {
                  const on = form.categories.includes(c);
                  return (
                    <button key={c} type="button" aria-pressed={on} onClick={() => setForm((f) => ({ ...f, categories: on ? f.categories.filter((x) => x !== c) : [...f.categories, c] }))}
                      style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '3px 10px', fontSize: 12.5, cursor: 'pointer', background: on ? 'var(--accent-tint)' : 'var(--shell)', color: on ? 'var(--accent-deep)' : 'var(--text)', fontWeight: on ? 700 : 500 }}>{c}</button>
                  );
                })}
              </div>
              <textarea className="om-field" rows={3} placeholder="What did you work on?" value={form.description} onChange={set('description')} style={{ padding: 8, resize: 'vertical' }} />
            </>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="om-pri" disabled={busy || !canSave} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="om-btn" disabled={busy} onClick={close}>Cancel</button>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>⌘↵ to save · Esc to cancel</span>
          </div>
        </div>
      )}

      <Section kind="time" innerRef={timeRef} title="TIME" right={total > 0 ? <span style={{ color: 'var(--text)' }}>{hoursText(total)}</span> : null}>
        {d.time.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No time logged.</div>}
        {d.time.map((t) => (
          <div key={t.id} style={row}>
            <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, width: 48, flexShrink: 0, color: CAL.time.fg }}>{hoursText(t.hours)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {(t.categories || []).map((c) => (
                <span key={c} style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: CAL.time.fg, background: 'var(--shell)', border: `1px solid ${CAL.time.fg}`, borderRadius: 4, padding: '0 6px', marginRight: 4, marginBottom: 3 }}>{c}</span>
              ))}
              {t.description ? <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{t.description}</span> : <span style={{ display: 'block', color: 'var(--muted)' }}>No description</span>}
            </span>
            <Actions busy={busy} what="this time entry" onEdit={() => open('time', t)}
              onDelete={() => setDel({ body: { action: 'time-delete', id: t.id }, title: 'Delete this time entry?', sub: `${hoursText(t.hours)}${t.description ? ' · ' + t.description.slice(0, 80) : ''}` })} />
          </div>
        ))}
      </Section>

      <Section kind="note" title="NOTES">
        {d.notes.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No notes.</div>}
        {d.notes.map((n) => (
          <div key={n.id} style={row}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' }}>{n.note}</span>
            <Actions busy={busy} what="this note" onEdit={() => open('note', n)}
              onDelete={() => setDel({ body: { action: 'note-delete', id: n.id }, title: 'Delete this note?', sub: n.note.slice(0, 120) })} />
          </div>
        ))}
      </Section>

      <Section kind="event" title="SCHEDULED">
        {d.events.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing scheduled.</div>}
        {d.events.map((e) => (
          <div key={e.id} style={row}>
            <span style={{ fontFamily: MONO, fontSize: 12, width: 70, flexShrink: 0, color: CAL.event.fg, fontWeight: 700, lineHeight: 1.5 }}>
              {e.time ? t12(e.time) : 'All day'}
              {e.time && e.end_time && <><br />{t12(e.end_time)}</>}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{e.title}</span>
              {e.details && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{e.details}</span>}
            </span>
            <Actions busy={busy} what={e.title} onEdit={() => open('event', e)}
              onDelete={() => setDel({ body: { action: 'event-delete', id: e.id }, title: 'Delete this event?', sub: e.title })} />
          </div>
        ))}
      </Section>

      {del && (
        <Confirm title={del.title} sub={del.sub} yes="Delete" danger busy={busy}
          onYes={async () => { if (await post(del.body)) setDel(null); }} onClose={() => setDel(null)} />
      )}
    </>
  );
}