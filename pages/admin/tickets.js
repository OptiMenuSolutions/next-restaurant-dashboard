// pages/admin/tickets.js
// All tickets: everything on the rail, oldest first within each kind, with
// Snooze (until 6 AM tomorrow) and Done. Tickets made from live data close
// on their own once the work behind them is done.

import { useCallback, useEffect, useState } from 'react';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import Ticket, { KIND } from '../../components/admin/Ticket';
import NoteDialog from '../../components/admin/NoteDialog';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState } from '../../components/client/ClientChrome';
import useIsPhone from '../../lib/admin/useIsPhone';
import useIsPhone from '../../lib/admin/useIsPhone';

const FILTERS = ['ALL', 'JOB', 'BILLING', 'SUPPORT', 'REVIEW', 'COSTS', 'NOTE'];
const NICE = { ALL: 'All', JOB: 'Jobs', BILLING: 'Billing', SUPPORT: 'Support', REVIEW: 'Review', COSTS: 'Costs', NOTE: 'Notes' };

function untilLabel(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ts));
}

function TicketsPage() {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [view, setView] = useState('OPEN');
  const [busy, setBusy] = useState(null);
  const isPhone = useIsPhone();
  const [noteOpen, setNoteOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/tickets');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load tickets');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);

  useEffect(() => { load(); }, [load]);

  async function act(id, action, extra = {}) {
    setBusy(id);
    try {
      const res = await adminFetch('/api/admin/tickets', { method: 'POST', body: JSON.stringify({ id, action, ...extra }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  const open = data?.open || [];
  const shown = open.filter((t) => filter === 'ALL' || t.kind === filter);
  const snoozed = data?.snoozed || [];
  const done = data?.doneToday || [];
  const phoneItems = view === 'OPEN' ? open : view === 'SNOOZED' ? snoozed : done;

  return (
    <>
      <PageHead kicker={isPhone ? 'ALL TICKETS' : 'TODAY'} title={isPhone ? 'To-dos' : 'All tickets'}
        sub={isPhone ? undefined : 'Everything waiting on you. A ticket closes itself when the work behind it is done.'}>
        {!isPhone && (
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', color: 'var(--muted)', alignSelf: 'center' }}>
            {open.length} OPEN · {snoozed.length} SNOOZED · {done.length} DONE TODAY
          </span>
        )}
        <button type="button" className="om-btn" onClick={() => setNoteOpen(true)}>Add note</button>
      </PageHead>

      {!isPhone && (
        <div role="group" aria-label="Filter by kind" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((k) => {
            const on = filter === k;
            const count = k === 'ALL' ? open.length : open.filter((t) => t.kind === k).length;
            if (k !== 'ALL' && !count && !on) return null;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setFilter(k)}
                style={{ minHeight: 34, padding: '0 13px', borderRadius: 17, cursor: 'pointer', font: "600 12.5px 'Manrope', sans-serif", border: `1px solid ${on ? 'var(--text)' : 'var(--line)'}`, background: on ? 'var(--text)' : 'var(--shell)', color: on ? 'var(--shell)' : 'var(--text)' }}>
                {NICE[k]} <span style={{ fontFamily: MONO, fontSize: 11, opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {isPhone ? (
        <>
          <div role="tablist" aria-label="Ticket status" style={{ display: 'flex', gap: 4, padding: 4, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)', position: 'sticky', top: 92, zIndex: 80 }}>
            {[['OPEN', `Open ${open.length}`], ['SNOOZED', `Snoozed ${snoozed.length}`], ['DONE', `Done ${done.length}`]].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
                style={{ flex: 1, minWidth: 0, minHeight: 40, border: 0, borderRadius: 10, background: view === key ? 'var(--shell)' : 'transparent', color: view === key ? 'var(--text)' : 'var(--muted)', font: "600 12px 'Manrope', sans-serif" }}>
                {label}
              </button>
            ))}
          </div>
          {!data ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
          ) : phoneItems.length === 0 ? (
            <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Nothing here. Nice.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
              {phoneItems.map((t) => (
                <Ticket key={t.id} t={t} busy={busy === t.id}
                  onSnooze={view === 'OPEN' ? (days) => act(t.id, 'snooze', { days }) : undefined}
                  onDone={() => act(t.id, view === 'OPEN' ? 'done' : 'reopen')}
                  doneLabel={view === 'OPEN' ? 'Done' : view === 'SNOOZED' ? 'Wake up' : 'Reopen'} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ background: 'var(--panel)', borderRadius: 12, padding: 16 }}>
          {!data ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Nothing here. Nice.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
              {shown.map((t) => (
                <Ticket key={t.id} t={t} busy={busy === t.id}
                  onSnooze={() => act(t.id, 'snooze', { days: 1 })}
                  onDone={() => act(t.id, 'done')} />
              ))}
            </div>
          )}
        </div>
      )}

      {!isPhone && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <MiniList title="Snoozed" empty="None." items={snoozed}
            right={(t) => <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>until {untilLabel(t.snoozed_until)}</span>}
            button="Wake up" onButton={(t) => act(t.id, 'reopen')} busy={busy} />
          <MiniList title="Done today" empty="Nothing yet." items={done}
            right={(t) => <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{t.done_reason === 'resolved' ? 'closed itself' : 'by you'}</span>}
            button="Reopen" onButton={(t) => act(t.id, 'reopen')} busy={busy} />
        </div>
      )}

      {noteOpen && <NoteDialog onClose={() => setNoteOpen(false)} onSaved={() => { setNoteOpen(false); load(); }} />}
    </>
  );
}

function MiniList({ title, empty, items, right, button, onButton, busy }) {
  return (
    <section style={{ flex: '1 1 420px', minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, padding: '14px 18px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800 }}>{title}</h2>
      {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)', padding: '6px 0' }}>{empty}</div>}
      {items.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13.5 }}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', color: (KIND[t.kind] || KIND.NOTE).color, width: 64, flexShrink: 0 }}>{t.kind}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
          {right(t)}
          <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={busy === t.id} onClick={() => onButton(t)}>{button}</button>
        </div>
      ))}
    </section>
  );
}

export default function Page() {
  return (
    <AdminShell section="Today" sub="All tickets" title="All tickets">
      <TicketsPage />
    </AdminShell>
  );
}