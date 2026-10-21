// pages/admin/restaurants/[id].js
// One restaurant. The health box up top says why its dot is that color and
// links to the fix. Tabs: Overview, Activity, Menu, Invoices, Billing.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { Confirm } from '../../../components/admin/AdminShell';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../../components/client/ClientChrome';
import { Dot, StatusChip, Chip, Pills, Card, th, td, money, shortDate, HEALTH_WORD, DOT } from '../../../components/admin/ui';

const TABS = ['Overview', 'Activity', 'Menu', 'Invoices', 'Billing'];
const STEP_NAMES = ['Menu parsed', 'First invoice', 'POS connected', 'Tags placed', 'Scanner added'];

const ago = (ts) => {
  if (!ts) return 'Never';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
};
const monthYear = (ts) => new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(ts));

function useLoad(url) {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!url) return;
    setError('');
    try {
      const res = await adminFetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [url, adminFetch]);
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}

function RestaurantPage({ id }) {
  const { adminFetch } = useAdminFetch();
  const [tab, setTab] = useState('Overview');
  const { data, error, load } = useLoad(`/api/admin/restaurant/${id}`);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState('');

  async function act(body) {
    const res = await adminFetch(`/api/admin/restaurant/${id}/action`, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not save');
    return json;
  }

  async function runDish() {
    setRunning(true);
    setFlash('');
    try {
      const json = await act({ action: 'run-dish' });
      setFlash(`Tonight’s Dish picked: ${json.picks.join(', ')}`);
      load();
    } catch (e) {
      setFlash(e.message);
    } finally {
      setRunning(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading restaurant…" />;

  const r = data.restaurant;
  const bad = data.checks.filter((c) => !c.ok);

  return (
    <>
      <Link href="/admin/restaurants" style={{ fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>← All restaurants</Link>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flex: '1 1 360px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Dot level={r.health.level} size={12} />
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{r.name}</h1>
            <StatusChip status={r.status} />
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>
            {[r.town, r.owner ? `Owner ${r.owner.name}` : 'No owner login yet', `Joined ${monthYear(r.created_at)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.staffPreview
            ? <a className="om-btn" href={data.staffPreview} target="_blank" rel="noopener noreferrer">Open staff page ↗</a>
            : <button type="button" className="om-btn" disabled>No staff page yet</button>}
          <Link className="om-btn" href={`/admin/support?restaurant=${r.id}`}>Message</Link>
          <button type="button" className="om-btn" onClick={runDish} disabled={running || r.status === 'CLOSED'}>{running ? 'Running…' : 'Run Tonight’s Dish now'}</button>
          <Link className="om-btn" href="/admin/view-as">View as this restaurant</Link>
        </div>
      </div>
      {flash && <div style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <section aria-labelledby="health" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, border: `1.5px solid ${DOT[r.health.level]}`, borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ flex: '0 1 260px' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>HEALTH · CHECKED {data.checkedAt.toUpperCase()}</div>
          <h2 id="health" style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dot level={r.health.level} size={11} />{HEALTH_WORD[r.health.level]}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            {r.health.level === 'gray' ? r.health.reasons[0] : bad.length ? `${bad.length} check${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} you.` : 'Every check passed.'}
          </p>
        </div>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column' }}>
          {data.checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none', fontSize: 13.5 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: c.ok ? 'var(--green)' : DOT[r.health.level] }} />
              <span style={{ flex: 1 }}>{c.t}</span>
              {c.act && (c.href === '#run-dish'
                ? <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={runDish} disabled={running}>{c.act}</button>
                : <Link href={c.href} style={{ fontSize: 12.5, fontWeight: 700 }}>{c.act} →</Link>)}
            </div>
          ))}
        </div>
      </section>

      <div role="tablist" aria-label="Restaurant sections" style={{ display: 'flex', gap: 22, borderBottom: '1px solid var(--line)' }}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            style={{ padding: '10px 0', border: 0, background: 'none', cursor: 'pointer', font: `${tab === t ? 700 : 500} 13.5px 'Manrope', sans-serif`, color: tab === t ? 'var(--text)' : 'var(--muted)', borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview data={data} act={act} reload={load} />}
      {tab === 'Activity' && <Activity id={id} />}
      {tab === 'Menu' && <Menu id={id} />}
      {tab === 'Invoices' && <Invoices id={id} />}
      {tab === 'Billing' && <Billing r={r} />}
    </>
  );
}

function Overview({ data, act, reload }) {
  const r = data.restaurant;
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState(null);
  const addr = r.address || {};
  const fullAddress = [addr.line1, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
  const week = r.views.reduce((a, b) => a + b, 0);

  async function saveNote() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await act({ action: 'note', body: note });
      setNote('');
      reload();
    } finally {
      setSaving(false);
    }
  }

  const stats = [
    ['LAST INVOICE', ago(r.lastInvoice), `${r.invoiceCount} in all · ${r.unreviewedCount} to check`],
    ['POS', r.conn ? (r.conn.status === 'connected' ? `Synced ${ago(r.conn.last_synced_at).toLowerCase()}` : r.conn.status) : 'Not connected', r.conn?.last_error || (r.conn ? r.conn.provider : 'No POS yet')],
    ['TONIGHT’S DISH', r.hasDishToday ? 'Ran today' : r.lastDish ? `Last ${shortDate(r.lastDish.date)}` : 'Not running', r.lastDish?.title || ''],
    ['STAFF PAGE', `${week} views`, `last 7 days · ${r.views[6]} yesterday`],
    ['MENU', `${r.menuCount} items`, 'Active on their menu'],
  ];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '2 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="Data">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            {stats.map(([k, v, s]) => (
              <div key={k}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k}</div>
                <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{v}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s}>{s}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Setup">
          {r.setup.map((ok, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, padding: '4px 0' }}>
              <span style={{ width: 20, fontWeight: 800, color: ok ? 'var(--green)' : 'var(--faint)' }}>{ok ? '✓' : '○'}</span>
              <span style={{ fontWeight: 600, width: 140 }}>{STEP_NAMES[i]}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                {i === 0 && (ok ? `${r.menuCount} items` : 'No menu yet')}
                {i === 1 && (ok ? `${r.invoiceCount} invoices` : 'No invoices yet')}
                {i === 2 && (r.conn ? `${r.conn.provider || 'POS'} · ${r.conn.status}` : 'Not connected')}
                {i === 3 && (r.tags.length ? r.tags.map((t) => `${t.label}${t.spot ? ' · ' + t.spot : ' · not placed'}`).join(', ') : 'No tags yet')}
                {i === 4 && (r.scanners.length ? r.scanners.map((s) => s.name).join(', ') : 'No scanner yet')}
              </span>
            </div>
          ))}
        </Card>

        <Card title="Tonight’s Dish · last 5 nights" right={<span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>TOP PICK vs TYPICAL SALES</span>}>
          {data.dishes.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No picks yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
              {data.dishes.map((d, i) => (
                <article key={i} style={{ background: 'var(--paper)', color: 'var(--ink)', borderRadius: 4, padding: '10px 12px', fontFamily: MONO, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--ink-soft)' }}>{d.date.toUpperCase()}</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13.5, fontWeight: 800, lineHeight: 1.3 }}>{d.dish}</div>
                  {d.why && <div title={d.why} style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--ink-soft)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.why}</div>}
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 'auto' }}>{d.lift}</div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="Notes">
          <textarea className="om-field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note about this restaurant" aria-label="New note" style={{ padding: '8px 10px', resize: 'vertical' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="om-pri" onClick={saveNote} disabled={saving || !note.trim()}>{saving ? 'Saving…' : 'Save note'}</button>
          </div>
          {data.notes.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{n.when} · {n.by}</span>
                <button type="button" onClick={() => setDel(n)} aria-label="Delete note"
                  style={{ border: 0, background: 'none', padding: 0, color: 'var(--muted)', cursor: 'pointer', font: "600 12px 'Manrope', sans-serif" }}>Delete</button>
              </div>
              <div style={{ fontSize: 13.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{n.body}</div>
            </div>
          ))}
          {del && (
            <Confirm title="Delete this note?" sub={del.body.length > 140 ? `${del.body.slice(0, 140)}…` : del.body}
              yes="Delete note" danger busy={saving} onClose={() => setDel(null)}
              onYes={async () => {
                setSaving(true);
                try { await act({ action: 'delete-note', noteId: del.id }); setDel(null); reload(); } finally { setSaving(false); }
              }} />
          )}
        </Card>

        <Card title="Address" right={fullAddress && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 700 }}>Open in Google Maps ↗</a>}>
          {fullAddress ? (
            <>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                {addr.line1}{addr.line1 && <br />}{[addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
              </div>
              <iframe title={`Map of ${r.name}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(fullAddress)}&z=15&output=embed`}
                loading="lazy" referrerPolicy="no-referrer-when-downgrade" style={{ width: '100%', height: 220, border: 0, borderRadius: 10 }} />
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No shipping address yet. It comes from the owner's onboarding.</div>
          )}
        </Card>

        <Card title="People & scanners">
          {r.people.length === 0 && r.scanners.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No one yet.</div>}
          {r.people.map((p, i) => (
            <Person key={'p' + i} name={p.name} sub={p.email} role="OWNER" />
          ))}
          {r.scanners.map((s, i) => (
            <Person key={'s' + i} name={s.name} sub={`Joined ${shortDate(s.joined_at)} · seen ${ago(s.last_seen_at).toLowerCase()}`} role="SCANNER" />
          ))}
        </Card>

        <Card title="Account">
          {[
            ['Created', shortDate(r.created_at) + ', ' + new Date(r.created_at).getFullYear()],
            ['Plan', r.subscription_status ? r.subscription_status.replace(/_/g, ' ') : 'No plan'],
            ['Food cost target', r.target_food_cost != null ? `${r.target_food_cost}%` : 'Not set'],
            ['Tags', r.tags.length ? r.tags.map((t) => t.label).join(', ') : 'None'],
            ['Closed', r.deactivated_at ? shortDate(r.deactivated_at) : 'No'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, borderTop: '1px solid var(--line-soft)', paddingTop: 7 }}>
              <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Person({ name, sub, role }) {
  const ini = String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-tint)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{ini}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{name}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      </span>
      <Chip>{role}</Chip>
    </div>
  );
}

const KIND_COLOR = { INVOICE: 'var(--accent-deep)', SCAN: 'var(--accent-deep)', DISH: 'var(--green)', STAFF: 'var(--muted)', ADMIN: 'var(--amber)', NOTE: 'var(--amber)', MENU: 'var(--accent-deep)' };

function Activity({ id }) {
  const { data, error, load } = useLoad(`/api/admin/restaurant/${id}?part=activity`);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading activity…" />;
  return (
    <section aria-label="Activity" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '6px 18px' }}>
      {data.activity.length === 0 && <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13.5 }}>Nothing in the last 60 days.</div>}
      {data.activity.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, padding: '9px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none', fontSize: 13.5, alignItems: 'baseline' }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)', width: 130, flexShrink: 0 }}>{a.when}</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', color: KIND_COLOR[a.kind], width: 66, flexShrink: 0 }}>{a.kind}</span>
          <span style={{ flex: 1 }}>{a.text}</span>
        </div>
      ))}
    </section>
  );
}

function Menu({ id }) {
  const { data, error, load } = useLoad(`/api/admin/restaurant/${id}?part=menu`);
  const [f, setF] = useState('ALL');
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading menu…" />;

  const rows = data.menu;
  const priced = rows.filter((m) => m.cost != null);
  const over = priced.filter((m) => m.pct > data.target);
  const waiting = rows.filter((m) => m.recipe !== 'PRICED');
  const shown = f === 'OVER' ? over : f === 'WAITING' ? waiting : rows;
  const avg = priced.length ? priced.reduce((a, m) => a + m.pct, 0) / priced.length : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section aria-label="Menu summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {[
          ['ITEMS', rows.length, `${priced.length} fully priced`],
          ['AVG FOOD COST', avg != null ? `${avg.toFixed(1)}%` : '—', `Target ${data.target}%`],
          ['OVER TARGET', over.length, 'Priced dishes above target'],
          ['WAITING ON PRICES', waiting.length, 'No recipe or costs to approve'],
        ].map(([k, v, s]) => (
          <div key={k} style={{ padding: '14px 18px', borderRight: '1px solid var(--line-soft)' }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{v}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s}</div>
          </div>
        ))}
      </section>
      <Pills label="Filter dishes" value={f} onChange={setF} options={[
        { key: 'ALL', label: 'All', n: rows.length },
        { key: 'OVER', label: 'Over target', n: over.length },
        { key: 'WAITING', label: 'Waiting on prices', n: waiting.length },
      ]} />
      <section style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ ...th, paddingLeft: 18 }}>ITEM</th>
              <th style={{ ...th, textAlign: 'right' }}>PRICE</th>
              <th style={{ ...th, textAlign: 'right' }}>PLATE COST</th>
              <th style={{ ...th, textAlign: 'right' }}>FOOD COST</th>
              <th style={{ ...th, textAlign: 'right' }}>MARGIN</th>
              <th style={th}>RECIPE</th>
              <th style={{ ...th, textAlign: 'right' }}>SOLD · 7 DAYS</th>
              <th style={{ ...th, textAlign: 'right', paddingRight: 18 }}>PICKED · 30 DAYS</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td style={{ ...td, paddingLeft: 18, maxWidth: 300 }}>
                  <span title={m.name} style={{ display: 'block', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.cat}</span>
                </td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(m.price)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(m.cost)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, color: m.pct > data.target ? 'var(--red)' : 'var(--text)' }}>{m.pct != null ? `${m.pct.toFixed(1)}%` : '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(m.margin)}</td>
                <td style={td}><Chip bg={m.recipe === 'PRICED' ? 'var(--green-tint)' : m.recipe === 'NO RECIPE' ? 'var(--panel)' : 'var(--amber-tint)'} fg={m.recipe === 'PRICED' ? 'var(--green)' : m.recipe === 'NO RECIPE' ? 'var(--muted)' : 'var(--amber)'}>{m.recipe}</Chip></td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{m.sold == null ? '—' : Math.round(m.sold)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, paddingRight: 18 }}>{m.picked || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>Plate cost only uses invoice prices and approved estimates, the same rule the owner sees. Picked counts how often Tonight’s Dish chose the dish in the last 30 days.</p>
    </div>
  );
}

function Invoices({ id }) {
  const { data, error, load } = useLoad(`/api/admin/restaurant/${id}?part=invoices`);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading invoices…" />;
  const list = data.invoices;
  const toCheck = list.filter((i) => !i.reviewed).length;
  const month = new Date().toISOString().slice(0, 7);
  const spend = list.filter((i) => String(i.date || '').startsWith(month)).reduce((a, i) => a + (i.total || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {[
          ['INVOICES', list.length, 'Real ones, samples left out'],
          ['TO CHECK', toCheck, 'Not reviewed by you yet'],
          ['COULD NOT READ', list.filter((i) => i.parse === 'failed').length, 'Parse failed'],
          ['SPEND THIS MONTH', money(spend, 0), 'From invoice totals'],
        ].map(([k, v, s]) => (
          <div key={k} style={{ padding: '14px 18px', borderRight: '1px solid var(--line-soft)' }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{v}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s}</div>
          </div>
        ))}
      </section>
      <section style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ ...th, paddingLeft: 18 }}>DATE</th>
              <th style={th}>VENDOR</th>
              <th style={th}>NUMBER</th>
              <th style={{ ...th, textAlign: 'right' }}>LINES</th>
              <th style={{ ...th, textAlign: 'right' }}>TOTAL</th>
              <th style={th}>UPLOADED</th>
              <th style={th}>YOUR REVIEW</th>
              <th style={{ ...th, paddingRight: 18 }}><span style={{ position: 'absolute', left: -9999 }}>Open</span></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No invoices yet.</td></tr>}
            {list.map((i) => (
              <tr key={i.id}>
                <td style={{ ...td, paddingLeft: 18, fontFamily: MONO, fontSize: 12 }}>{shortDate(i.date)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{i.vendor}</td>
                <td style={{ ...td, fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{i.number || '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{i.lines ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(i.total)}</td>
                <td style={{ ...td, fontSize: 12, color: 'var(--muted)' }}>{i.uploaded}</td>
                <td style={td}>
                  {i.parse === 'failed'
                    ? <Chip bg="var(--red-tint)" fg="var(--red)">COULD NOT READ</Chip>
                    : i.reviewed ? <Chip bg="var(--green-tint)" fg="var(--green)">REVIEWED</Chip> : <Chip bg="var(--accent-tint)" fg="var(--accent-deep)">TO CHECK</Chip>}
                </td>
                <td style={{ ...td, paddingRight: 18 }}><Link href={`/admin/review?restaurant=${id}`} style={{ fontWeight: 700, fontSize: 12.5 }}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Billing({ r }) {
  return (
    <Card title="Billing">
      {[
        ['Plan', r.subscription_status ? r.subscription_status.replace(/_/g, ' ') : 'No plan'],
        ['Stripe customer', r.stripe_customer_id || 'Not created yet'],
        ['Stripe subscription', r.stripe_subscription_id || 'None'],
      ].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
          <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, fontFamily: MONO, fontSize: 12.5 }}>{v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {r.stripe_customer_id && <a className="om-btn" href={`https://dashboard.stripe.com/customers/${r.stripe_customer_id}`} target="_blank" rel="noopener noreferrer">Open in Stripe ↗</a>}
        <Link className="om-pri" href={`/admin/billing/${r.id}`}>Open client billing →</Link>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>What they paid, what they cost you month by month, payments and billing actions are on the client billing page.</p>
    </Card>
  );
}

export default function Page() {
  const router = useRouter();
  const { id } = router.query;
  return (
    <AdminShell section="Restaurants" sub="All restaurants" title="Restaurant">
      {id ? <RestaurantPage id={id} /> : <LoadingState />}
    </AdminShell>
  );
}