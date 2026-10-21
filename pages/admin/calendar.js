// pages/admin/calendar.js
// Calendar: a month of your plans (events and day notes), deadlines, sales
// touches and follow-ups, and what the platform did. Click a day to see it
// all, write the day's note and add events. Today's events show on Today.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Card } from '../../components/admin/ui';

const KIND = {
  plan: ['var(--panel)', 'var(--text)', 'Your plans'],
  deadline: ['var(--text)', 'var(--shell)', 'Deadlines'],
  sales: ['var(--green-tint)', 'var(--green)', 'Sales'],
  activity: ['var(--accent-tint)', 'var(--accent-deep)', 'Platform activity'],
  bad: ['var(--red-tint)', 'var(--red)', 'Problems'],
};
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const fmt = (d, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(d + 'T12:00:00Z'));
function time12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? ' AM' : ' PM'}`;
}

function chipsFor(d) {
  if (!d) return [];
  const out = [];
  if (d.note) out.push(['plan', d.note.split('\n')[0]]);
  for (const e of d.events) out.push(['plan', `${e.time ? time12(e.time) + ' ' : ''}${e.title}`]);
  for (const x of d.deadlines) out.push(['deadline', `${x.done ? '✓ ' : ''}${x.title}`]);
  for (const s of d.sales) out.push(['sales', s.text]);
  const bad = d.activity.filter((a) => a.tone === 'bad');
  if (bad.length) out.push(['bad', bad.length === 1 ? bad[0].text.split(':')[0] : `${bad.length} job problems`]);
  const other = d.activity.length - bad.length;
  if (other) out.push(['activity', `${other} thing${other === 1 ? '' : 's'} happened`]);
  return out;
}

function CalendarPage() {
  const { adminFetch } = useAdminFetch();
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState('');
  const [ev, setEv] = useState({ time: '', title: '' });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch(`/api/admin/sales/calendar${month ? `?month=${month}` : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the calendar');
      setData(json);
      setSel((s) => (s && s.slice(0, 7) === json.month ? s : json.today.slice(0, 7) === json.month ? json.today : json.first));
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch, month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setNote(data?.days?.[sel]?.note || ''); setEv({ time: '', title: '' }); }, [sel, data]);

  const post = async (body, ok) => {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/sales/calendar', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      if (ok) setFlash(ok);
      await load();
      return true;
    } catch (e) {
      setFlash(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading the calendar…" />;

  const lead = new Date(data.first + 'T12:00:00Z').getUTCDay();
  const count = Number(data.last.slice(8));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${data.month}-${String(i + 1).padStart(2, '0')}`)];
  const d = data.days[sel] || { note: '', events: [], deadlines: [], sales: [], activity: [] };
  const isToday = sel === data.today;

  return (
    <>
      <PageHead kicker="CALENDAR" title={fmt(data.first, { month: 'long', year: 'numeric' })}>
        <button type="button" className="om-btn" aria-label="Previous month" onClick={() => setMonth(shift(data.month, -1))}>‹</button>
        <button type="button" className="om-btn" onClick={() => { setMonth(data.today.slice(0, 7)); setSel(data.today); }}>Today</button>
        <button type="button" className="om-btn" aria-label="Next month" onClick={() => setMonth(shift(data.month, 1))}>›</button>
      </PageHead>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {Object.values(KIND).map(([bg, , label]) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: bg, border: '1px solid var(--line)' }} />{label}
          </span>
        ))}
      </div>
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 620px', minWidth: 0, overflowX: 'auto' }}>
          <div role="grid" aria-label="Month" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(92px, 1fr))', gap: 4, minWidth: 660 }}>
            {DOW.map((w) => <div key={w} style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)', padding: '4px 6px' }}>{w}</div>)}
            {cells.map((c, i) => {
              if (!c) return <div key={`b${i}`} style={{ minHeight: 104, borderRadius: 8, background: 'var(--panel)', opacity: 0.5 }} />;
              const chips = chipsFor(data.days[c]);
              const on = c === sel;
              return (
                <button key={c} type="button" aria-pressed={on} aria-label={fmt(c, { weekday: 'long', month: 'long', day: 'numeric' })} onClick={() => setSel(c)}
                  style={{ minHeight: 104, borderRadius: 8, border: '1px solid var(--line)', background: on ? 'var(--accent-tint)' : 'var(--shell)', boxShadow: on ? 'inset 0 0 0 2px var(--accent)' : 'none', padding: 6, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--text)', minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: c === data.today ? 'var(--accent-deep)' : 'var(--text)' }}>{Number(c.slice(8))}{c === data.today ? ' · today' : ''}</span>
                  {chips.slice(0, 3).map(([k, text], j) => (
                    <span key={j} style={{ fontSize: 10.5, fontWeight: 600, background: KIND[k][0], color: KIND[k][1], borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
                  ))}
                  {chips.length > 3 && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+{chips.length - 3} more</span>}
                </button>
              );
            })}
          </div>
        </div>

        <Card title={fmt(sel, { month: 'long', day: 'numeric' })} style={{ flex: '1 1 320px' }} right={<span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>{fmt(sel, { weekday: 'long' }).toUpperCase()}{isToday ? ' · TODAY' : ''}</span>}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 4 }}>DAY NOTES</div>
            <textarea className="om-field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What matters today" style={{ padding: 8, resize: 'vertical' }} />
            <button type="button" className="om-btn" style={{ marginTop: 6, minHeight: 30 }} disabled={busy || note === (d.note || '')} onClick={() => post({ action: 'note', day: sel, note }, 'Note saved.')}>Save note</button>
          </div>

          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 4 }}>SCHEDULED</div>
            {d.events.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing scheduled.</div>}
            {d.events.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13.5 }}>
                <span style={{ fontFamily: MONO, fontSize: 12, width: 66, color: 'var(--muted)' }}>{time12(e.time) || 'Any time'}</span>
                <span style={{ flex: 1 }}>{e.title}</span>
                <button type="button" aria-label={`Remove ${e.title}`} disabled={busy} onClick={() => post({ action: 'event-delete', id: e.id })} style={{ border: 0, background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input className="om-field" type="time" aria-label="Time" value={ev.time} onChange={(e) => setEv({ ...ev, time: e.target.value })} style={{ width: 120 }} />
              <input className="om-field" aria-label="What" placeholder="Add an event" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })}
                onKeyDown={async (e) => { if (e.key === 'Enter' && ev.title.trim() && await post({ action: 'event', day: sel, ...ev })) setEv({ time: '', title: '' }); }} />
              <button type="button" className="om-pri" disabled={busy || !ev.title.trim()} onClick={async () => { if (await post({ action: 'event', day: sel, ...ev })) setEv({ time: '', title: '' }); }}>Add</button>
            </div>
          </div>

          {d.deadlines.length > 0 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 4 }}>DEADLINES</div>
              {d.deadlines.map((x) => <div key={x.id} style={{ fontSize: 13.5, padding: '4px 0', textDecoration: x.done ? 'line-through' : 'none', color: x.done ? 'var(--muted)' : 'var(--text)' }}>{x.title}</div>)}
              <Link href="/admin/finances" style={{ fontSize: 12.5, color: 'var(--accent-deep)' }}>Expenses & deadlines</Link>
            </div>
          )}

          {d.sales.length > 0 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 4 }}>SALES</div>
              {d.sales.map((s) => (
                <div key={s.id} style={{ fontSize: 13.5, padding: '4px 0' }}>
                  <b style={{ color: s.due ? 'var(--green)' : 'var(--text)' }}>{s.text}</b>
                  {s.detail && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>{s.detail}</span>}
                </div>
              ))}
              <Link href="/admin/pipeline" style={{ fontSize: 12.5, color: 'var(--accent-deep)' }}>Pipeline</Link>
            </div>
          )}

          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 4 }}>PLATFORM ACTIVITY</div>
            {d.activity.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing logged.</div>}
            {d.activity.map((a, i) => <div key={i} style={{ fontSize: 13, padding: '3px 0', color: a.tone === 'bad' ? 'var(--red)' : 'var(--text)' }}>{a.text}</div>)}
          </div>
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <AdminShell section="Sales" sub="Calendar" title="Calendar">
      <CalendarPage />
    </AdminShell>
  );
}