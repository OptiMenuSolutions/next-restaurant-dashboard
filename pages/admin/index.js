// pages/admin/index.js
// Today: the greeting, four numbers and the rail of to-dos.
// The rail is two rows of five. Past 10 tickets, 9 show and the last spot
// becomes "See all", which opens All tickets.
// Today's plan, last night's jobs and coming-up deadlines join this page
// when Calendar, Jobs & health and Expenses & deadlines are built.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import NoteDialog from '../../components/admin/NoteDialog';
import Ticket from '../../components/admin/Ticket';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState } from '../../components/client/ClientChrome';
import { Chip } from '../../components/admin/ui';

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const TONE = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };
const JOB_RUN = {
  ok: ['RAN OK', 'var(--green-tint)', 'var(--green)'],
  partial: ['PROBLEMS', 'var(--amber-tint)', 'var(--amber)'],
  failed: ['FAILED', 'var(--red-tint)', 'var(--red)'],
  missed: ['DID NOT RUN', 'var(--red-tint)', 'var(--red)'],
  waiting: ['NOT YET', 'var(--panel)', 'var(--muted)'],
  none: ['NOT TRACKED', 'var(--panel)', 'var(--muted)'],
};

function TodayPage() {
  const router = useRouter();
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/today');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load Today');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);

  useEffect(() => { load(); }, [load]);

  // ⌘K "Add a note" lands here with ?note=1.
  useEffect(() => {
    if (router.query.note === '1') {
      setNoteOpen(true);
      router.replace('/admin', undefined, { shallow: true });
    }
  }, [router]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const tickets = data?.tickets || [];
  const n = tickets.length;
  const over = n > 10;
  const shown = over ? tickets.slice(0, 9) : tickets;
  const railLine = `${WORDS[n] || n} ${n === 1 ? 'ticket' : 'tickets'} on the rail.`;

  return (
    <>
      <PageHead kicker={data?.dateLabel || ' '} title={data?.greeting || 'Today'} sub={data ? railLine : 'Loading…'}>
        <button type="button" className="om-btn" onClick={() => setNoteOpen(true)}>Add note</button>
      </PageHead>

      <section aria-label="Key numbers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {(data?.kpis || [0, 1, 2, 3].map(() => null)).map((k, i) => (
          <div key={i} style={{ padding: '16px 20px', borderRight: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 104 }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k?.label || ' '}</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: (k && TONE[k.tone]) || 'var(--text)' }}>{k ? k.value : '·'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{k?.sub || ''}</div>
          </div>
        ))}
      </section>

      <section aria-labelledby="rail" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 id="rail" style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>On the rail</h2>
          <Link href="/admin/tickets" style={{ fontSize: 12.5, fontWeight: 700 }}>All tickets</Link>
        </div>
        {data?.ticketError && (
          <div style={{ background: 'var(--amber-tint)', color: 'var(--amber)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
            The rail could not refresh: {data.ticketError}. Showing what was saved last.
          </div>
        )}
        <div style={{ background: 'var(--panel)', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
          {data && n === 0 ? (
            <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Nothing on the rail. Nice.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 14, minWidth: 1156 }}>
              {shown.map((t) => <Ticket key={t.id} t={t} />)}
              {over && (
                <Link href="/admin/tickets" style={{ border: '1.5px dashed var(--line)', borderRadius: 6, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 6, minHeight: 180, color: 'var(--text)', background: 'var(--shell)' }}>
                  <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em' }}>+{n - 9}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-deep)' }}>See all {n} tickets →</span>
                </Link>
              )}
              {!data && [0, 1, 2, 3, 4].map((i) => (
                <div key={i} style={{ minHeight: 180, borderRadius: 4, background: 'var(--line-soft)' }} />
              ))}
            </div>
          )}
        </div>
      </section>

      {data?.jobs && (
        <section aria-labelledby="jobs" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 id="jobs" style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>Last night’s jobs</h2>
            <Link href="/admin/health" style={{ fontSize: 12.5, fontWeight: 700 }}>Jobs & health</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {data.jobs.map((j) => {
              const [label, bg, fg] = JOB_RUN[j.status] || JOB_RUN.none;
              return (
                <Link key={j.key} href="/admin/health" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--text)', background: 'var(--shell)' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{j.time}</span>
                    <Chip bg={bg} fg={fg}>{label}</Chip>
                  </span>
                  <b style={{ fontSize: 14 }}>{j.name}</b>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{j.summary || (j.status === 'waiting' ? 'Runs later this morning' : j.status === 'none' ? 'Recording starts with tonight’s run' : 'No run recorded today')}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {noteOpen && <NoteDialog onClose={() => setNoteOpen(false)} onSaved={() => { setNoteOpen(false); load(); }} />}
    </>
  );
}

export default function Page() {
  return (
    <AdminShell section="Today" sub="Today" title="Today">
      <TodayPage />
    </AdminShell>
  );
}