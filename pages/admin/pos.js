// pages/admin/pos.js
// POS connections: every restaurant's POS link, its status, what came in
// each of the last 7 days (click a day to see its tickets), how much of the
// POS menu is matched to dishes, and the recent sync job runs.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AdminShell, { PageHead } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Pills, Card, th, td, money, shortDate } from '../../components/admin/ui';

const CONN = {
  connected: ['CONNECTED', 'var(--green-tint)', 'var(--green)'],
  error: ['ERROR · NOT SYNCING', 'var(--red-tint)', 'var(--red)'],
  disconnected: ['DISCONNECTED', 'var(--panel)', 'var(--muted)'],
};
const RUN = { ok: ['RAN OK', 'var(--green-tint)', 'var(--green)'], partial: ['PROBLEMS', 'var(--amber-tint)', 'var(--amber)'], failed: ['FAILED', 'var(--red-tint)', 'var(--red)'] };
const TOKEN = { ok: 'var(--muted)', muted: 'var(--muted)', warn: 'var(--amber)', bad: 'var(--red)' };
const clock = (ts) => (ts ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) : '—');
const dow = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(d + 'T12:00:00Z'));

function PosPage() {
  const { adminFetch } = useAdminFetch();
  const router = useRouter();
  const isPhone = useIsPhone();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState('');
  const [pick, setPick] = useState(null); // { conn, date }

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/platform/pos');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load POS connections');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  const post = async (url, body, key) => {
    setBusy(key);
    setFlash('');
    try {
      const res = await adminFetch(url, { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not do that');
      setFlash(json.message || 'Done.');
      await load();
    } catch (e) {
      setFlash(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading POS connections…" />;

  const routeConn = data.connections.find((c) => c.restaurant_id === String(router.query.restaurant || ''));
  const routeDay = String(router.query.day || '');

  if (isPhone && routeConn && routeDay) {
    return (
      <DayTickets
        key={`${routeConn.id}|${routeDay}`}
        conn={routeConn}
        date={routeDay}
        phone
        onClose={() => router.push('/admin/pos', undefined, { shallow: true })}
      />
    );
  }

  return (
    <>
      <PageHead kicker="PLATFORM" title="POS connections" sub="Every restaurant’s POS link and what came in each day. Click a day to see its tickets.">
        <button type="button" className="om-pri" disabled={!!busy} onClick={() => post('/api/admin/platform/jobs', { action: 'run', job: 'sync-all-pos' }, 'sync')}>{busy === 'sync' ? 'Syncing…' : 'Sync all now'}</button>
      </PageHead>
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      {isPhone && (
        <PhoneConnections
          connections={data.connections}
          busy={busy}
          onRetry={(c) => post('/api/admin/platform/pos', { action: 'retry', id: c.id }, c.id)}
          onPickDay={(c, date) => router.push({ pathname: '/admin/pos', query: { restaurant: c.restaurant_id, day: date } }, undefined, { shallow: true })}
        />
      )}

      <section aria-label="Connected locations" style={{ display: isPhone ? 'none' : undefined, border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1000 }}>
          <thead><tr>
            <th style={{ ...th, paddingLeft: 18 }}>RESTAURANT</th>
            <th style={th}>STATUS</th>
            <th style={th}>TOKEN</th>
            <th style={th}>WHAT CAME IN · CLICK A DAY</th>
            <th style={th}>MENU CHECK</th>
            <th style={{ ...th, paddingRight: 18, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {data.connections.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>No POS connections yet.</td></tr>}
            {data.connections.map((c) => {
              const [label, bg, fg] = CONN[c.status] || [String(c.status || 'unknown').toUpperCase(), 'var(--panel)', 'var(--muted)'];
              return (
                <tr key={c.id}>
                  <td style={{ ...td, paddingLeft: 18 }}>
                    <Link href={`/admin/restaurants/${c.restaurant_id}`} style={{ color: 'var(--text)', fontWeight: 700 }}>{c.restaurant}</Link>
                    <span style={{ display: 'block', fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>{c.provider.toUpperCase()}{c.location ? ` · ${c.location}` : ''}{c.timezone ? ` · ${c.timezone}` : ''}</span>
                  </td>
                  <td style={{ ...td, maxWidth: 240 }}>
                    <Chip bg={bg} fg={fg}>{label}</Chip>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>Last sync {c.last_synced_at ? `${shortDate(c.last_synced_at)}, ${clock(c.last_synced_at)}` : 'never'}</span>
                    {c.last_error && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--red)', wordBreak: 'break-word' }}>{c.last_error}</span>}
                  </td>
                  <td style={{ ...td, fontSize: 12.5, color: TOKEN[c.token.level] }}>{c.token.label}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {c.byDay.map((d) => {
                        const on = pick && pick.conn.id === c.id && pick.date === d.date;
                        return (
                          <button key={d.date} type="button" aria-pressed={on} aria-label={`${shortDate(d.date)}: ${d.n} ${c.unit}`} onClick={() => setPick(on ? null : { conn: c, date: d.date })}
                            style={{ width: 44, padding: '4px 0', borderRadius: 7, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-tint)' : d.n ? 'var(--shell)' : 'var(--panel)', color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--muted)' }}>{dow(d.date).toUpperCase()}</span>
                            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: d.n ? 'var(--text)' : 'var(--muted)' }}>{d.n}</span>
                          </button>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.unit} per day</span>
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    {c.menu ? (
                      <>
                        <span style={{ fontFamily: MONO }}>{c.menu.matched} of {c.menu.items}</span> matched
                        {c.menu.items > c.menu.matched && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--amber)' }}>{c.menu.items - c.menu.matched} POS items not matched to a dish</span>}
                      </>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ ...td, paddingRight: 18, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.status === 'error'
                      ? <button type="button" className="om-pri" style={{ minHeight: 30 }} disabled={!!busy} onClick={() => post('/api/admin/platform/pos', { action: 'retry', id: c.id }, c.id)}>Try again tonight</button>
                      : <Link href={`/admin/restaurants/${c.restaurant_id}`} className="om-btn" style={{ minHeight: 30 }}>Open</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {data.connections.some((c) => c.status === 'error') && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -6 }}>The nightly sync skips a connection in error. “Try again tonight” puts it back so the next sync (or Sync all now) retries it.</div>
      )}

      {pick && <DayTickets key={`${pick.conn.id}|${pick.date}`} conn={pick.conn} date={pick.date} onClose={() => setPick(null)} />}

      <Card title="Recent sync runs" right={<Link href="/admin/health" style={{ fontSize: 12.5, color: 'var(--accent-deep)' }}>Jobs & health</Link>}>
        {data.runs.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No runs recorded yet. They show up after tonight’s jobs.</div>}
        {data.runs.map((r) => {
          const [label, bg, fg] = RUN[r.status] || RUN.ok;
          return (
            <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)', width: 110, flexShrink: 0 }}>{shortDate(r.started_at)}, {clock(r.started_at)}</span>
              <b style={{ width: 120, flexShrink: 0 }}>{r.name}</b>
              <span style={{ flex: 1, minWidth: 0 }}>{r.summary}{r.details.map((d) => <span key={d} style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{d}</span>)}</span>
              <Chip bg={bg} fg={fg}>{label}</Chip>
            </div>
          );
        })}
      </Card>
    </>
  );
}

function PhoneConnections({ connections, busy, onRetry, onPickDay }) {
  if (connections.length === 0) {
    return <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 18, color: 'var(--muted)' }}>No POS connections yet.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {connections.map((c) => {
        const [label, bg, fg] = CONN[c.status] || [String(c.status || 'unknown').toUpperCase(), 'var(--panel)', 'var(--muted)'];
        const tickets7d = c.byDay.reduce((sum, d) => sum + (Number(d.n) || 0), 0);
        const menuMatch = c.menu ? `${c.menu.matched} of ${c.menu.items}` : '—';

        return (
          <section key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14, background: 'var(--panel)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <Link href={`/admin/restaurants/${c.restaurant_id}`} style={{ color: 'var(--text)', fontSize: 16, fontWeight: 800, textDecoration: 'none' }}>{c.restaurant}</Link>
                <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 12.5, overflowWrap: 'anywhere' }}>
                  {c.provider.toUpperCase()}{c.location ? ` · ${c.location}` : ''}{c.timezone ? ` · ${c.timezone}` : ''}
                </div>
              </div>
              <span aria-label={label} style={{ width: 10, height: 10, marginTop: 5, flexShrink: 0, borderRadius: 99, background: fg }} />
            </div>

            <div style={{ marginTop: 10 }}>
              <Chip bg={bg} fg={fg}>{label}</Chip>
              {c.last_error && <div style={{ marginTop: 6, color: 'var(--red)', fontSize: 12, overflowWrap: 'anywhere' }}>{c.last_error}</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
              <div style={{ minWidth: 0, padding: 9, borderRadius: 10, background: 'var(--shell)' }}>
                <div style={{ color: 'var(--muted)', fontFamily: MONO, fontSize: 9.5 }}>TICKETS 7D</div>
                <strong style={{ display: 'block', marginTop: 4, fontSize: 15 }}>{tickets7d}</strong>
              </div>
              <div style={{ minWidth: 0, padding: 9, borderRadius: 10, background: 'var(--shell)' }}>
                <div style={{ color: 'var(--muted)', fontFamily: MONO, fontSize: 9.5 }}>MENU MATCH</div>
                <strong style={{ display: 'block', marginTop: 4, fontSize: 13 }}>{menuMatch}</strong>
              </div>
              <div style={{ minWidth: 0, padding: 9, borderRadius: 10, background: 'var(--shell)' }}>
                <div style={{ color: 'var(--muted)', fontFamily: MONO, fontSize: 9.5 }}>LAST SYNC</div>
                <strong style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  {c.last_synced_at ? `${shortDate(c.last_synced_at)} ${clock(c.last_synced_at)}` : 'Never'}
                </strong>
              </div>
            </div>

            <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 10, color: 'var(--muted)' }}>LAST 7 DAYS · TAP A DAY</div>
            <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
              {c.byDay.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`${shortDate(d.date)}: ${d.n} ${c.unit}`}
                  onClick={() => onPickDay(c, d.date)}
                  style={{ flex: '1 1 0', minWidth: 0, minHeight: 48, padding: '5px 2px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--line)', background: d.n ? 'var(--accent-tint)' : 'var(--shell)', color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--muted)' }}>{dow(d.date).toUpperCase()}</span>
                  <strong style={{ fontFamily: MONO, fontSize: 13 }}>{d.n}</strong>
                </button>
              ))}
            </div>

            {c.status === 'error' && (
              <button type="button" className="om-pri" disabled={!!busy} onClick={() => onRetry(c)} style={{ width: '100%', marginTop: 12 }}>
                {busy === c.id ? 'Retrying…' : 'Try again tonight'}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DayTickets({ conn, date, onClose, phone = false }) {
  const { adminFetch } = useAdminFetch();
  const [d, setD] = useState(null);
  const [only, setOnly] = useState('all');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let alive = true;
    adminFetch(`/api/admin/platform/pos?restaurant=${conn.restaurant_id}&day=${date}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setD(j.tickets ? j : { tickets: [], error: j.error }); })
      .catch((e) => { if (alive) setD({ tickets: [], error: e.message }); });
    return () => { alive = false; };
  }, [adminFetch, conn.restaurant_id, date]);

  const list = (d?.tickets || []).filter((t) => only === 'all' || t.flags.length);
  const total = (d?.tickets || []).reduce((a, t) => a + (Number(t.total_grand) || 0), 0);

  if (phone) {
    return (
      <>
        <PageHead kicker={`${dow(date).toUpperCase()} · ${shortDate(date)}`} title={conn.restaurant} sub="Tickets and totals for this day." />
        {!d && <div style={{ padding: 14, color: 'var(--muted)', fontSize: 13 }}>Loading tickets…</div>}
        {d?.error && <ErrorState message={d.error} />}
        {d && !d.error && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Card title="Day totals">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: 'var(--muted)', fontSize: 13 }}>
                <strong style={{ color: 'var(--text)' }}>{d.tickets.length} ticket{d.tickets.length === 1 ? '' : 's'}</strong>
                <strong style={{ color: 'var(--text)' }}>{money(total)} total</strong>
              </div>
              <div style={{ marginTop: 10 }}>
                <Pills label="Show" value={only} onChange={setOnly} options={[{ key: 'all', label: 'All', n: d.tickets.length }, { key: 'flagged', label: 'Flagged', n: d.tickets.filter((t) => t.flags.length).length }]} />
              </div>
            </Card>

            {d.tickets.length === 0 && (
              <Card>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  No tickets saved for this day. {conn.provider === 'shift4' ? 'If the restaurant was open, check the POS sales job for this night.' : 'This POS sends sales totals only, not tickets.'}
                </div>
              </Card>
            )}

            {list.map((t) => {
              const on = open === t.id;
              return (
                <Card key={t.id}>
                  <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : t.id)} style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', textAlign: 'left', border: 0, padding: 0, background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 14 }}>{on ? '▾' : '▸'} #{t.order_number || t.external_ticket_id}</strong>
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: 12 }}>
                        {t.closed_at ? clock(t.closed_at) : 'Open'} · {t.table_name || t.order_type || 'No table'} · {t.lines.length} items
                      </span>
                    </span>
                    <strong style={{ flexShrink: 0, fontFamily: MONO, fontSize: 13 }}>{money(Number(t.total_grand) || 0)}</strong>
                  </button>
                  {t.flags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>{t.flags.map((f) => <Chip key={f} bg="var(--amber-tint)" fg="var(--amber)">{f}</Chip>)}</div>}
                  {on && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                      {t.lines.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>No lines saved.</div>}
                      {t.lines.map((l) => (
                        <div key={l.id} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 12.5, textDecoration: l.void_reason ? 'line-through' : 'none' }}>
                          <span style={{ width: 32, flexShrink: 0, textAlign: 'right', fontFamily: MONO }}>{Number(l.quantity)}×</span>
                          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                            {l.item_name || '(no name)'}{l.category && <span style={{ color: 'var(--muted)' }}> · {l.category}</span>}{l.void_reason && <span style={{ color: 'var(--red)' }}> · void: {l.void_reason}</span>}{Number(l.discount_amount) > 0 && <span style={{ color: 'var(--amber)' }}> · −{money(Number(l.discount_amount))} discount</span>}
                          </span>
                          <span style={{ flexShrink: 0, fontFamily: MONO }}>{money(Number(l.item_amount) || 0)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 9, marginTop: 7, fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>
                        <span>Items {money(Number(t.total_items) || 0)}</span>
                        {Number(t.total_discounts) > 0 && <span>Discounts −{money(Number(t.total_discounts))}</span>}
                        <span>Tax {money(Number(t.total_tax) || 0)}</span>
                        <span>Tips {money(Number(t.total_tips) || 0)}</span>
                        <strong style={{ color: 'var(--text)' }}>Total {money(Number(t.total_grand) || 0)}</strong>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <Card title={`${conn.restaurant} · ${dow(date)} ${shortDate(date)}`} right={<button type="button" className="om-btn" onClick={onClose}>Close</button>}>
      {!d && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading tickets…</div>}
      {d?.error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{d.error}</div>}
      {d && !d.error && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{d.tickets.length} ticket{d.tickets.length === 1 ? '' : 's'} · {money(total)} total</span>
            <Pills label="Show" value={only} onChange={setOnly} options={[{ key: 'all', label: 'All', n: d.tickets.length }, { key: 'flagged', label: 'Flagged', n: d.tickets.filter((t) => t.flags.length).length }]} />
          </div>
          {d.tickets.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No tickets saved for this day. {conn.provider === 'shift4' ? 'If the restaurant was open, check the POS sales job for this night.' : 'This POS sends sales totals only, not tickets.'}</div>}
          {d.tickets.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                <thead><tr><th style={th}>CHECK</th><th style={th}>CLOSED</th><th style={th}>TABLE</th><th style={{ ...th, textAlign: 'right' }}>ITEMS</th><th style={{ ...th, textAlign: 'right' }}>TOTAL</th><th style={th}>FLAGS</th></tr></thead>
                <tbody>
                  {list.map((t) => {
                    const on = open === t.id;
                    return [
                      <tr key={t.id} className="om-row" tabIndex={0} aria-expanded={on} onClick={() => setOpen(on ? null : t.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(on ? null : t.id); }} style={{ cursor: 'pointer', background: on ? 'var(--accent-tint)' : 'transparent' }}>
                        <td style={{ ...td, fontFamily: MONO }}>{on ? '▾' : '▸'} #{t.order_number || t.external_ticket_id}</td>
                        <td style={{ ...td, fontFamily: MONO, fontSize: 12.5 }}>{t.closed_at ? clock(t.closed_at) : 'open'}</td>
                        <td style={td}>{t.table_name || t.order_type || '—'}{t.guest_count ? <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {t.guest_count} guests</span> : null}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{t.lines.length}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(Number(t.total_grand) || 0)}</td>
                        <td style={td}>{t.flags.map((f) => <span key={f} style={{ marginRight: 4 }}><Chip bg="var(--amber-tint)" fg="var(--amber)">{f}</Chip></span>)}</td>
                      </tr>,
                      on && (
                        <tr key={`${t.id}-lines`}>
                          <td colSpan={6} style={{ ...td, background: 'var(--panel)', padding: '10px 18px' }}>
                            {t.lines.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>No lines saved.</span>}
                            {t.lines.map((l) => (
                              <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '3px 0', textDecoration: l.void_reason ? 'line-through' : 'none' }}>
                                <span style={{ fontFamily: MONO, width: 34, textAlign: 'right' }}>{Number(l.quantity)}×</span>
                                <span style={{ flex: 1 }}>{l.item_name || '(no name)'}{l.category && <span style={{ color: 'var(--muted)' }}> · {l.category}</span>}{l.void_reason && <span style={{ color: 'var(--red)' }}> · void: {l.void_reason}</span>}{Number(l.discount_amount) > 0 && <span style={{ color: 'var(--amber)' }}> · −{money(Number(l.discount_amount))} discount</span>}</span>
                                <span style={{ fontFamily: MONO }}>{money(Number(l.item_amount) || 0)}</span>
                              </div>
                            ))}
                            <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', fontFamily: MONO, fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                              <span>Items {money(Number(t.total_items) || 0)}</span>
                              {Number(t.total_discounts) > 0 && <span>Discounts −{money(Number(t.total_discounts))}</span>}
                              <span>Tax {money(Number(t.total_tax) || 0)}</span>
                              <span>Tips {money(Number(t.total_tips) || 0)}</span>
                              <b style={{ color: 'var(--text)' }}>Total {money(Number(t.total_grand) || 0)}</b>
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function Page() {
  const router = useRouter();
  const isPhone = useIsPhone();
  const phoneDetail = isPhone && router.isReady && router.query.restaurant && router.query.day;

  return (
    <AdminShell
      section="Platform"
      sub="POS connections"
      title="POS connections"
      back={phoneDetail ? { label: 'POS connections', href: '/admin/pos' } : undefined}
    >
      <PosPage />
    </AdminShell>
  );
}