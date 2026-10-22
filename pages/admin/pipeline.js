// pages/admin/pipeline.js
// Sales pipeline. Drag a card to move it, or open it to change the stage,
// log a touch and set the next follow-up. Logging a touch on a Lead moves it
// to Contacted; logging a Demo moves it to Demo done. Lost keeps the 3 most
// recent losses; older ones sit in the archive below with the reasons.
// Prospects on a POS OptiMenu does not support yet wait off the board.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AdminShell, { PageHead, Dialog, Confirm } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Pills, Card, th, td, shortDate } from '../../components/admin/ui';

const STAGES = ['Lead', 'Contacted', 'Demo done', 'Setting up', 'Live', 'Lost'];
const SUPPORTED = ['shift4', 'square'];
const REASONS = ['Price', 'POS not supported', 'Not interested', 'Went quiet', 'Chose another tool', 'Other'];
const KINDS = ['Call', 'Email', 'Visit', 'Demo', 'Text'];
const POS_LIST = ['Shift4', 'Square', 'Toast', 'Clover', 'Lightspeed', 'SpotOn', 'Unknown'];

const waiting = (p) => p.stage !== 'Lost' && p.stage !== 'Live' && p.pos && p.pos !== 'Unknown' && !SUPPORTED.includes(p.pos.toLowerCase());
function dueInfo(p, today) {
  if (p.stage === 'Lost') return { text: p.lost_at ? shortDate(p.lost_at) : '', hot: false };
  if (!p.due_on) return { text: '—', hot: false };
  if (p.due_on < today) return { text: `${shortDate(p.due_on)} · LATE`, hot: true };
  if (p.due_on === today) return { text: 'Today', hot: true };
  return { text: shortDate(p.due_on), hot: false };
}

function PipelinePage() {
  const router = useRouter();
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [lost, setLost] = useState(null);
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(null);
  const dragId = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/sales/pipeline');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the pipeline');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (router.query.add === '1') { setAdding(true); router.replace('/admin/pipeline', undefined, { shallow: true }); }
  }, [router]);

  const post = useCallback(async (body) => {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/sales/pipeline', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      await load();
      return json;
    } catch (e) {
      setFlash(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [adminFetch, load]);

  const view = useMemo(() => {
    if (!data) return null;
    const ps = data.prospects;
    const lostAll = ps.filter((p) => p.stage === 'Lost').sort((a, b) => String(b.lost_at).localeCompare(String(a.lost_at)));
    const lostShown = new Set(lostAll.slice(0, 3).map((p) => p.id));
    const keep = (p) => !waiting(p) && (p.stage !== 'Lost' || lostShown.has(p.id)) &&
      (filter === 'all' || (filter === 'shift4' && String(p.pos).toLowerCase() === 'shift4') || (filter === 'due' && p.stage !== 'Lost' && p.due_on && p.due_on <= data.today));
    const reasons = {};
    for (const p of lostAll) reasons[p.lost_reason || 'Other'] = (reasons[p.lost_reason || 'Other'] || 0) + 1;
    return {
      columns: STAGES.map((s) => ({ stage: s, cards: ps.filter((p) => p.stage === s && keep(p)).sort((a, b) => (s === 'Lost' ? String(b.lost_at).localeCompare(String(a.lost_at)) : String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')))) })),
      archived: lostAll.slice(3),
      waitingList: ps.filter(waiting),
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
      due: ps.filter((p) => p.stage !== 'Lost' && p.due_on && p.due_on <= data.today).length,
      shift4: ps.filter((p) => String(p.pos).toLowerCase() === 'shift4').length,
    };
  }, [data, filter]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading the pipeline…" />;

  const move = (id, stage) => {
    const p = data.prospects.find((x) => x.id === id);
    if (!p || p.stage === stage) return;
    if (stage === 'Lost') { setLost(p); return; }
    post({ action: 'move', id, stage }).then((r) => { if (r && stage === 'Setting up') setFlash(`${p.name} is setting up. Create their account from the signup page, then link it on their card so the pipeline follows them.`); });
  };
  const current = open ? data.prospects.find((p) => p.id === open) : null;

  return (
    <>
      <PageHead kicker="SALES" title="Pipeline" sub="Drag a card to move it. Click a card to see the prospect and log a touch.">
        <button type="button" className="om-pri" onClick={() => setAdding(true)}>Add prospect</button>
      </PageHead>
      <Pills label="Filter" value={filter} onChange={setFilter} options={[
        { key: 'all', label: 'All', n: data.prospects.filter((p) => !waiting(p)).length },
        { key: 'shift4', label: 'On Shift4', n: view.shift4 },
        { key: 'due', label: 'Due or late', n: view.due },
      ]} />
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(210px, 1fr))', gap: 12, minWidth: 1300 }}>
          {view.columns.map((col) => (
            <section key={col.stage} aria-label={col.stage}
              onDragOver={(e) => { e.preventDefault(); setOver(col.stage); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = dragId.current || e.dataTransfer.getData('text/plain'); dragId.current = null; if (id) move(id, col.stage); }}
              style={{ background: over === col.stage ? 'var(--accent-tint)' : 'var(--panel)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 240 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 4px' }}>
                <b style={{ fontSize: 13.5 }}>{col.stage}</b>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>{col.cards.length}</span>
              </div>
              {col.cards.map((p) => {
                const d = dueInfo(p, data.today);
                const sup = SUPPORTED.includes(String(p.pos).toLowerCase());
                return (
                  <button key={p.id} type="button" draggable onDragStart={(e) => { dragId.current = p.id; try { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; } catch {} }}
                    onClick={() => setOpen(p.id)}
                    style={{ textAlign: 'left', cursor: 'grab', border: '1px solid var(--line)', background: 'var(--shell)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--text)', font: "500 13px 'Manrope',sans-serif" }}>
                    <b style={{ fontSize: 14 }}>{p.name}</b>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{[p.town, p.type].filter(Boolean).join(' · ') || '—'}</span>
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {p.pos && <Chip bg={sup ? 'var(--accent-tint)' : 'var(--amber-tint)'} fg={sup ? 'var(--accent-deep)' : 'var(--amber)'}>{p.pos.toUpperCase()}</Chip>}
                      {p.source && <Chip>{p.source.toUpperCase()}</Chip>}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: d.hot ? 'var(--red)' : 'var(--muted)' }}>{d.text}</span>
                    <span style={{ fontSize: 12.5 }}>{p.stage === 'Lost' ? `Lost: ${p.lost_reason || 'Other'}` : p.next_step || <span style={{ color: 'var(--muted)' }}>No next step</span>}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>

      {view.waitingList.length > 0 && (
        <Card title={`Waiting on POS support · ${view.waitingList.length}`}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Good fits on a POS OptiMenu does not support yet. They stay off the board until you change their POS.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {view.waitingList.map((p) => (
              <button key={p.id} type="button" className="om-btn" onClick={() => setOpen(p.id)}>{p.name} <span style={{ color: 'var(--muted)' }}>· on {p.pos}</span></button>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <Card title={`Archived losses · ${view.archived.length}`} style={{ flex: '2 1 480px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Lost keeps the 3 most recent losses. Older ones move here.</div>
          {view.archived.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><th style={th}>RESTAURANT</th><th style={th}>LOST ON</th><th style={th}>REASON</th><th style={th} /></tr></thead>
              <tbody>
                {view.archived.map((p) => (
                  <tr key={p.id}>
                    <td style={td}><b>{p.name}</b>{p.town && <span style={{ color: 'var(--muted)' }}> · {p.town}</span>}</td>
                    <td style={{ ...td, fontSize: 12.5 }}>{p.lost_at ? shortDate(p.lost_at) : '—'}</td>
                    <td style={{ ...td, fontSize: 12.5 }}>{p.lost_reason}{p.lost_note && <span style={{ display: 'block', color: 'var(--muted)' }}>{p.lost_note}</span>}</td>
                    <td style={{ ...td, textAlign: 'right' }}><button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} disabled={busy} onClick={() => post({ action: 'move', id: p.id, stage: 'Lead' })}>Reopen as lead</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Why we lose" style={{ flex: '1 1 260px' }}>
          {view.reasons.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No losses yet.</div>}
          {view.reasons.map(([r, n]) => (
            <div key={r} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderTop: '1px solid var(--line-soft)' }}><span>{r}</span><span style={{ fontFamily: MONO }}>{n}</span></div>
          ))}
        </Card>
      </div>

      {current && <ProspectPanel key={current.id} p={current} today={data.today} restaurants={data.restaurants} busy={busy} post={post} onClose={() => setOpen(null)} onLost={() => setLost(current)} />}
      {adding && <AddDialog busy={busy} onClose={() => setAdding(false)} onSave={async (f) => { const r = await post({ action: 'save', ...f }); if (r) { setAdding(false); setFlash(`Added ${f.name.trim()} as a Lead.`); } }} />}
      {lost && <LostDialog p={lost} busy={busy} onClose={() => setLost(null)} onSave={async (reason, note) => { if (await post({ action: 'lost', id: lost.id, reason, note })) setLost(null); }} />}
    </>
  );
}

function Field({ label, children, style }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0, ...style }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

function ProspectPanel({ p, today, restaurants, busy, post, onClose, onLost }) {
  const [f, setF] = useState({
    name: p.name || '', town: p.town || '', state: p.state || '', type: p.type || '', pos: p.pos || '', source: p.source || '',
    contact: p.contact || '', phone: p.phone || '', email: p.email || '', seats: p.seats || '', covers: p.covers || '',
    pain: p.pain || '', referred: p.referred || '', notes: p.notes || '', restaurant_id: p.restaurant_id || '',
  });
  const [t, setT] = useState({ kind: 'Call', text: '', happened_on: today, next_step: p.next_step || '', due_on: p.due_on || '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = Object.keys(f).some((k) => (f[k] || '') !== (p[k] || ''));
  const [askDel, setAskDel] = useState(false);
  const linked = restaurants.find((r) => r.id === p.restaurant_id);

  return (
    <Dialog title={p.name} sub={`${p.stage}${p.town ? ` · ${p.town}` : ''}${p.type ? ` · ${p.type}` : ''}`} onClose={onClose} width={900}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <Field label="Stage" style={{ flex: '0 1 200px' }}>
          <select className="om-field" value={p.stage} disabled={busy} onChange={(e) => (e.target.value === 'Lost' ? onLost() : post({ action: 'move', id: p.id, stage: e.target.value }))}>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {p.stage !== 'Lost' && <button type="button" className="om-btn" style={{ color: 'var(--red)' }} onClick={onLost}>Mark lost</button>}
        {linked && <Link href={`/admin/restaurants/${linked.id}`} className="om-btn">Open {linked.name}</Link>}
        <span style={{ flex: 1 }} />
        <button type="button" className="om-btn" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => setAskDel(true)}>Delete</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Name"><input className="om-field" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Type"><input className="om-field" value={f.type} onChange={(e) => set('type', e.target.value)} placeholder="e.g. Seafood" /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Town"><input className="om-field" value={f.town} onChange={(e) => set('town', e.target.value)} /></Field>
            <Field label="State" style={{ flex: '0 0 70px' }}><input className="om-field" maxLength={2} value={f.state} onChange={(e) => set('state', e.target.value.toUpperCase())} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="POS">
              <input className="om-field" list="om-pos" value={f.pos} onChange={(e) => set('pos', e.target.value)} />
              <datalist id="om-pos">{POS_LIST.map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
            <Field label="Source"><input className="om-field" value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="Walk-in, referral…" /></Field>
          </div>
          {f.pos && f.pos !== 'Unknown' && !SUPPORTED.includes(f.pos.toLowerCase()) && <div style={{ fontSize: 12, color: 'var(--amber)' }}>OptiMenu does not connect to {f.pos} yet, so this prospect waits off the board.</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Contact"><input className="om-field" value={f.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Name · role" /></Field>
            <Field label="Phone"><input className="om-field" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          </div>
          <Field label="Email"><input className="om-field" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Seats"><input className="om-field" value={f.seats} onChange={(e) => set('seats', e.target.value)} /></Field>
            <Field label="Covers"><input className="om-field" value={f.covers} onChange={(e) => set('covers', e.target.value)} placeholder="e.g. 140 on weekends" /></Field>
          </div>
          <Field label="Their pain"><input className="om-field" value={f.pain} onChange={(e) => set('pain', e.target.value)} /></Field>
          <Field label="Referred by"><input className="om-field" value={f.referred} onChange={(e) => set('referred', e.target.value)} /></Field>
          <Field label="Owner notes"><textarea className="om-field" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} style={{ padding: 8, resize: 'vertical' }} /></Field>
          <Field label="Their OptiMenu account">
            <select className="om-field" value={f.restaurant_id} onChange={(e) => set('restaurant_id', e.target.value)}>
              <option value="">Not linked</option>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <button type="button" className="om-pri" style={{ alignSelf: 'flex-start' }} disabled={!dirty || busy} onClick={() => post({ action: 'save', id: p.id, ...f })}>{busy ? 'Saving…' : 'Save details'}</button>
        </div>

        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <b style={{ fontSize: 14 }}>Log a touch</b>
            <div role="group" aria-label="Kind" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {KINDS.map((k) => (
                <button key={k} type="button" aria-pressed={t.kind === k} onClick={() => setT({ ...t, kind: k })}
                  style={{ minHeight: 30, padding: '0 11px', borderRadius: 15, cursor: 'pointer', font: "600 12px 'Manrope',sans-serif", border: `1px solid ${t.kind === k ? 'var(--text)' : 'var(--line)'}`, background: t.kind === k ? 'var(--text)' : 'var(--shell)', color: t.kind === k ? 'var(--shell)' : 'var(--text)' }}>{k}</button>
              ))}
            </div>
            <Field label="What happened"><textarea className="om-field" rows={2} value={t.text} onChange={(e) => setT({ ...t, text: e.target.value })} style={{ padding: 8, resize: 'vertical' }} /></Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="When"><input className="om-field" type="date" value={t.happened_on} onChange={(e) => setT({ ...t, happened_on: e.target.value })} /></Field>
              <Field label="Follow up on"><input className="om-field" type="date" value={t.due_on} onChange={(e) => setT({ ...t, due_on: e.target.value })} /></Field>
            </div>
            <Field label="Next step"><input className="om-field" value={t.next_step} onChange={(e) => setT({ ...t, next_step: e.target.value })} /></Field>
            <button type="button" className="om-pri" style={{ alignSelf: 'flex-start' }} disabled={busy || !t.text.trim()}
              onClick={async () => { if (await post({ action: 'touch', id: p.id, ...t })) setT({ ...t, text: '' }); }}>{busy ? 'Saving…' : 'Save touch'}</button>
          </div>
          <div>
            <b style={{ fontSize: 14 }}>History</b>
            {p.touches.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Nothing logged yet.</div>}
            {p.touches.map((x) => (
              <div key={x.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)', width: 50, flexShrink: 0 }}>{shortDate(x.happened_on)}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--accent-deep)', width: 48, flexShrink: 0 }}>{String(x.kind).toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{x.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {askDel && (
        <Confirm title={`Delete ${p.name}?`} sub="Its touches and history go too. This cannot be undone." yes="Delete prospect" danger busy={busy}
          onClose={() => setAskDel(false)}
          onYes={async () => { if (await post({ action: 'delete', id: p.id })) { setAskDel(false); onClose(); } }} />
      )}
    </Dialog>
  );
}

function AddDialog({ busy, onClose, onSave }) {
  const [f, setF] = useState({ name: '', town: '', state: 'NJ', type: '', pos: 'Shift4', source: '', contact: '', phone: '', email: '', next_step: '', due_on: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog title="Add a prospect" sub="Starts as a Lead." onClose={onClose} width={560}>
      <Field label="Restaurant"><input className="om-field" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Town"><input className="om-field" value={f.town} onChange={(e) => set('town', e.target.value)} /></Field>
        <Field label="State" style={{ flex: '0 0 70px' }}><input className="om-field" maxLength={2} value={f.state} onChange={(e) => set('state', e.target.value.toUpperCase())} /></Field>
        <Field label="Type"><input className="om-field" value={f.type} onChange={(e) => set('type', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="POS">
          <input className="om-field" list="om-pos-add" value={f.pos} onChange={(e) => set('pos', e.target.value)} />
          <datalist id="om-pos-add">{POS_LIST.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="Source"><input className="om-field" value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="Walk-in, referral…" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Contact"><input className="om-field" value={f.contact} onChange={(e) => set('contact', e.target.value)} /></Field>
        <Field label="Phone"><input className="om-field" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Next step"><input className="om-field" value={f.next_step} onChange={(e) => set('next_step', e.target.value)} /></Field>
        <Field label="Follow up on" style={{ flex: '0 0 160px' }}><input className="om-field" type="date" value={f.due_on} onChange={(e) => set('due_on', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !f.name.trim()} onClick={() => onSave(f)}>{busy ? 'Adding…' : 'Add prospect'}</button>
      </div>
    </Dialog>
  );
}

function LostDialog({ p, busy, onClose, onSave }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  return (
    <Dialog title={`Why did we lose ${p.name}?`} sub="Pick one. It feeds the why-we-lose tally." onClose={onClose}>
      <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {REASONS.map((r) => (
          <label key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
            <input type="radio" name="lost-reason" checked={reason === r} onChange={() => setReason(r)} /> {r}
          </label>
        ))}
      </div>
      <Field label="Note (optional)"><input className="om-field" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy} onClick={() => onSave(reason, note)}>Mark lost</button>
      </div>
    </Dialog>
  );
}

export default function Page() {
  return (
    <AdminShell section="Sales" sub="Pipeline" title="Pipeline">
      <PipelinePage />
    </AdminShell>
  );
}