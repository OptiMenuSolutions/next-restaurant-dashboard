// pages/admin/calendar.js
// Calendar: a month of your plans (events and notes), hours worked, deadlines,
// sales touches and follow-ups, and what the platform did. Each day shows its
// hours in the corner; click it to see the work. The panel on the right adds
// notes, events and time for the selected day. Today's events show on Today.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Card } from '../../components/admin/ui';
import CalendarDayPanel, { hoursText, CAL, Section } from '../../components/admin/CalendarDayPanel';

// Chip colors come from the day panel so the calendar and the panel match.
const KIND = Object.fromEntries(Object.entries(CAL).map(([k, v]) => [k, [v.bg, v.fg, v.label]]));
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
  for (const e of d.events) out.push(['event', `${e.time ? time12(e.time) + ' ' : ''}${e.title}`]);
  for (const n of d.notes || []) out.push(['note', n.note.split('\n')[0]]);
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
  const [timeFor, setTimeFor] = useState(null); // day whose hours pill was clicked
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
  const d = data.days[sel] || { notes: [], events: [], time: [], hours: 0, deadlines: [], sales: [], activity: [] };
  const isToday = sel === data.today;
  const monthHours = Object.entries(data.days)
    .filter(([k]) => k >= data.first && k <= data.last)
    .reduce((s, [, v]) => s + (v.hours || 0), 0);

  return (
    <>
      <PageHead kicker="CALENDAR" title={fmt(data.first, { month: 'long', year: 'numeric' })}>
        <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: '0.08em', color: 'var(--muted)', alignSelf: 'center', marginRight: 6 }}>
          {hoursText(monthHours)} IN {fmt(data.first, { month: 'long' }).toUpperCase()}
        </span>
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
              const hrs = data.days[c]?.hours || 0;
              return (
                <div key={c} role="button" tabIndex={0} aria-pressed={on} aria-label={fmt(c, { weekday: 'long', month: 'long', day: 'numeric' })} onClick={() => setSel(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(c); } }}
                  style={{ minHeight: 104, borderRadius: 8, border: '1px solid var(--line)', background: on ? 'var(--accent-tint)' : 'var(--shell)', boxShadow: on ? 'inset 0 0 0 2px var(--accent)' : 'none', padding: 6, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--text)', minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: c === data.today ? 'var(--accent-deep)' : 'var(--text)', whiteSpace: 'nowrap' }}>{Number(c.slice(8))}{c === data.today ? ' · today' : ''}</span>
                    {hrs > 0 && (
                      <button type="button" title="See what you worked on" aria-label={`${hoursText(hrs)} worked. See what you worked on`}
                        onClick={(e) => { e.stopPropagation(); setSel(c); setTimeFor(c); }}
                        style={{ border: 0, borderRadius: 999, padding: '1px 7px', background: CAL.time.fg, color: '#fff', fontFamily: MONO, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', lineHeight: 1.6, flexShrink: 0 }}>
                        {hoursText(hrs)}
                      </button>
                    )}
                  </span>
                  {chips.slice(0, 3).map(([k, text], j) => (
                    <span key={j} style={{ fontSize: 10.5, fontWeight: 600, background: KIND[k][0], color: KIND[k][1], borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
                  ))}
                  {chips.length > 3 && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+{chips.length - 3} more</span>}
                </div>
              );
            })}
          </div>
        </div>

        <Card title={fmt(sel, { month: 'long', day: 'numeric' })} style={{ flex: '1 1 320px' }} right={<span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>{fmt(sel, { weekday: 'long' }).toUpperCase()}{isToday ? ' · TODAY' : ''}</span>}>
          <CalendarDayPanel day={sel} d={d} busy={busy} post={post} openTime={timeFor === sel} onTimeShown={() => setTimeFor(null)} />

          {d.deadlines.length > 0 && (
            <Section kind="deadline" title="DEADLINES">
              {d.deadlines.map((x) => <div key={x.id} style={{ fontSize: 13.5, padding: '4px 0', textDecoration: x.done ? 'line-through' : 'none', color: x.done ? 'var(--muted)' : 'var(--text)' }}>{x.title}</div>)}
              <Link href="/admin/finances" style={{ fontSize: 12.5, color: 'var(--accent-deep)' }}>Expenses & deadlines</Link>
            </Section>
          )}

          {d.sales.length > 0 && (
            <Section kind="sales" title="SALES">
              {d.sales.map((s) => (
                <div key={s.id} style={{ fontSize: 13.5, padding: '4px 0' }}>
                  <b style={{ color: s.due ? 'var(--green)' : 'var(--text)' }}>{s.text}</b>
                  {s.detail && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>{s.detail}</span>}
                </div>
              ))}
              <Link href="/admin/pipeline" style={{ fontSize: 12.5, color: 'var(--green)' }}>Pipeline</Link>
            </Section>
          )}

          <Section kind={d.activity.some((a) => a.tone === 'bad') ? 'bad' : 'activity'} title="PLATFORM ACTIVITY">
            {d.activity.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing logged.</div>}
            {d.activity.map((a, i) => <div key={i} style={{ fontSize: 13, padding: '3px 0', color: a.tone === 'bad' ? 'var(--red)' : 'var(--text)', fontWeight: a.tone === 'bad' ? 600 : 400 }}>{a.text}</div>)}
          </Section>
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