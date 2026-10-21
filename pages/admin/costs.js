// pages/admin/costs.js
// Cost approvals. Every AI cost guess from menu parsing that a dish uses,
// with what to check it against. Hover the guess to see where it came from.
// Approve (at the guess or your own price) or skip. Skipped items stay a
// missing price until a real invoice prices them.
//
// When the same ingredient is waiting at other restaurants, approving asks
// whether to use the price there too: restaurants in the same state start
// checked, the rest start unchecked.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead, Dialog } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Pills, th, td, money } from '../../components/admin/ui';

const MOVE = { STEADY: ['var(--green-tint)', 'var(--green)'], MODERATE: ['var(--amber-tint)', 'var(--amber)'], SWINGS: ['var(--red-tint)', 'var(--red)'] };
const TIP_CSS = `.om-tip{position:relative;cursor:help;border-bottom:1px dotted var(--muted);outline:none}
.om-tipbox{display:none;position:absolute;z-index:20;left:0;top:calc(100% + 6px);width:280px;background:var(--text);color:var(--shell);font:500 12px/1.5 Manrope,sans-serif;padding:10px 12px;border-radius:8px;white-space:normal}
.om-tipbox b{display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;opacity:.7;margin-bottom:3px}
.om-tip:hover .om-tipbox,.om-tip:focus .om-tipbox{display:block}`;

function CostsPage() {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('all');
  const [mine, setMine] = useState({});
  const [busy, setBusy] = useState(null);
  const [share, setShare] = useState(null); // { row, price }
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/costs');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load cost approvals');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body, key) => {
    setBusy(key);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/costs', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      await load();
      return json;
    } catch (e) {
      setFlash(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }, [adminFetch, load]);

  const rows = useMemo(() => (data?.pending || []).filter((r) => from === 'all' || r.restaurant_id === from), [data, from]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading cost approvals…" />;

  const priceFor = (r) => (mine[r.id] != null ? mine[r.id] : r.guess != null ? r.guess.toFixed(2) : '');
  const steady = rows.filter((r) => r.move === 'STEADY' && r.guess);

  async function approve(r) {
    const price = Number(priceFor(r));
    if (!(price > 0)) { setFlash(`Enter a price for ${r.name}`); return; }
    if (r.others.length) { setShare({ row: r, price }); return; }
    await post({ action: 'approve', ingredientId: r.id, price }, r.id);
  }

  async function bulk(list, label) {
    if (!list.length) return;
    if (!window.confirm(`${label}: approve ${list.length} item${list.length === 1 ? '' : 's'} at the AI guess?`)) return;
    const json = await post({ action: 'approve-bulk', ingredientIds: list.map((r) => r.id) }, 'bulk');
    if (json) setFlash(`Approved ${json.approved}.`);
  }

  return (
    <>
      <style>{TIP_CSS}</style>
      <PageHead kicker="DATA QUALITY" title="Cost approvals" sub="AI cost guesses from menu parsing. Owners never see them until you approve. A real invoice price replaces any of them the moment one comes in.">
        <button type="button" className="om-btn" disabled={!steady.length || busy} onClick={() => bulk(steady, 'Steady-price items')}>Approve {steady.length} steady-price item{steady.length === 1 ? '' : 's'}</button>
        <button type="button" className="om-pri" disabled={!rows.length || busy} onClick={() => bulk(rows.filter((r) => r.guess), 'Everything shown')}>Approve {rows.length} at the guess</button>
      </PageHead>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>FROM</span>
        <Pills label="Filter by restaurant" value={from} onChange={setFrom}
          options={[{ key: 'all', label: 'All', n: data.pending.length }, ...data.from.map((f) => ({ key: f.id, label: f.name, n: f.n }))]} />
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{data.approvedToday.length} APPROVED TODAY · {data.pending.length} LEFT</span>
      </div>
      {flash && <div style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <section aria-label="Estimates" style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1060 }}>
          <thead>
            <tr>
              <th style={{ ...th, paddingLeft: 18 }}>INGREDIENT</th>
              <th style={th}>RESTAURANT</th>
              <th style={{ ...th, textAlign: 'right' }}>USED IN</th>
              <th style={th}>PRICE MOVES</th>
              <th style={th}>CHECK AGAINST</th>
              <th style={th}>AI GUESS</th>
              <th style={th}>YOUR PRICE</th>
              <th style={{ ...th, paddingRight: 18 }}>DECISION</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Nothing waiting. Every guess in use is approved or skipped.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, paddingLeft: 18 }}>
                  <span style={{ display: 'block', fontWeight: 700 }}>{r.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>per {r.unit}</span>
                  {r.others.length > 0 && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--accent-deep)' }}>Also waiting at {r.others.length} more</span>}
                </td>
                <td style={td}><Link href={`/admin/restaurants/${r.restaurant_id}`} style={{ color: 'var(--text)' }}>{r.restaurant}</Link>{r.state && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}> · {r.state}</span>}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{r.dishes} dish{r.dishes === 1 ? '' : 'es'}</td>
                <td style={td}>{r.move ? <Chip bg={MOVE[r.move][0]} fg={MOVE[r.move][1]}>{r.move}</Chip> : <span style={{ fontSize: 12, color: 'var(--muted)' }}>No history</span>}</td>
                <td style={{ ...td, fontSize: 12.5 }}>
                  {r.library ? <><span style={{ fontFamily: MONO }}>{money(r.library.price)}/{r.library.unit}</span><span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{r.library.where}{r.library.date ? ` · ${r.library.date}` : ''}</span></> : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
                <td style={td}>
                  <span className="om-tip" tabIndex={0} aria-label={`${r.guess != null ? money(r.guess) : 'No guess'}. ${r.why}`} style={{ fontFamily: MONO }}>
                    {r.guess != null ? money(r.guess) : '—'}
                    <span className="om-tipbox" role="tooltip"><b>WHERE THIS GUESS CAME FROM</b>{r.why}</span>
                  </span>
                  {r.warn && <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--amber)' }}>{r.warn}</span>}
                </td>
                <td style={td}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontFamily: MONO, color: 'var(--muted)' }}>$</span>
                    <span style={{ position: 'absolute', left: -9999 }}>Price for {r.name}</span>
                    <input inputMode="decimal" value={priceFor(r)} onChange={(e) => setMine({ ...mine, [r.id]: e.target.value })}
                      style={{ width: 78, minHeight: 32, border: '1px solid var(--line)', borderRadius: 6, padding: '0 7px', background: 'var(--shell)', color: 'var(--text)', fontFamily: MONO, fontSize: 12.5 }} />
                  </label>
                </td>
                <td style={{ ...td, paddingRight: 18, whiteSpace: 'nowrap' }}>
                  <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={!!busy} onClick={() => post({ action: 'skip', ingredientId: r.id }, r.id)}>Skip</button>{' '}
                  <button type="button" className="om-pri" style={{ minHeight: 30 }} disabled={!!busy} onClick={() => approve(r)}>{busy === r.id ? '…' : 'Approve'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <Done title="Approved today" items={data.approvedToday} right={(x) => `${money(x.price)}/${x.unit}`} onUndo={(x) => post({ action: 'undo', ingredientId: x.id }, x.id)} busy={busy} />
        <Done title="Skipped · missing price until an invoice" items={data.skipped} right={() => 'SKIPPED'} onUndo={(x) => post({ action: 'undo', ingredientId: x.id }, x.id)} busy={busy} />
      </div>

      {share && <ShareDialog share={share} restaurants={data.restaurants} busy={busy === 'share'}
        onClose={() => setShare(null)}
        onSave={async (alsoIds) => { const ok = await post({ action: 'approve', ingredientId: share.row.id, price: share.price, alsoIds }, 'share'); if (ok) setShare(null); }}
        onSetState={async (restaurantId, state) => { if (await post({ action: 'set-state', restaurantId, state }, 'state')) { setShare(null); setFlash('State saved. Click Approve again and same-state restaurants start checked.'); } }} />}
    </>
  );
}

function Done({ title, items, right, onUndo, busy }) {
  return (
    <section style={{ flex: '1 1 420px', minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, padding: '14px 18px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800 }}>{title}</h2>
      {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>None.</div>}
      {items.map((x) => (
        <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13.5 }}>
          <span style={{ flex: 1, minWidth: 0 }}><b>{x.name}</b> <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>· {x.restaurant}</span></span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{right(x)}</span>
          <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} disabled={!!busy} onClick={() => onUndo(x)}>Undo</button>
        </div>
      ))}
    </section>
  );
}

function ShareDialog({ share, busy, onClose, onSave, onSetState }) {
  const { row, price } = share;
  const [picked, setPicked] = useState(() => Object.fromEntries(row.others.map((o) => [o.ingredientId, o.sameState && o.sameUnit])));
  const n = Object.values(picked).filter(Boolean).length;
  return (
    <Dialog title={`Approve ${row.name} at ${money(price)}/${row.unit}`} sub={`For ${row.restaurant}${row.state ? ` (${row.state})` : ''}. The same ingredient is waiting at these restaurants too. Same-state ones start checked.`} onClose={onClose} width={600}>
      {!row.state && (
        <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>
          {row.restaurant} has no state set, so nothing starts checked. Set it:{' '}
          <StateInput onSave={(s) => onSetState(row.restaurant_id, s)} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {row.others.map((o) => (
          <label key={o.ingredientId} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${picked[o.ingredientId] ? 'var(--accent)' : 'var(--line)'}`, background: picked[o.ingredientId] ? 'var(--accent-tint)' : 'var(--shell)', borderRadius: 10, padding: '9px 12px', opacity: o.sameUnit ? 1 : 0.6 }}>
            <input type="checkbox" disabled={!o.sameUnit} checked={!!picked[o.ingredientId]} onChange={(e) => setPicked({ ...picked, [o.ingredientId]: e.target.checked })} style={{ width: 18, height: 18 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13.5 }}>{o.restaurant}</b>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
                {o.state || 'No state set'}{o.sameState ? ' · same state' : ''} · their guess {o.guess != null ? `${money(o.guess)}/${o.unit}` : 'none'}
                {!o.sameUnit && ` · priced per ${o.unit}, not ${row.unit}, so approve it on its own row`}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-btn" disabled={busy} onClick={() => onSave([])}>Only {row.restaurant}</button>
        <button type="button" className="om-pri" disabled={busy || !n} onClick={() => onSave(Object.keys(picked).filter((k) => picked[k]))}>{busy ? 'Saving…' : `Approve for ${n + 1} restaurants`}</button>
      </div>
    </Dialog>
  );
}

function StateInput({ onSave }) {
  const [v, setV] = useState('');
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input aria-label="State" value={v} maxLength={2} onChange={(e) => setV(e.target.value.toUpperCase())} placeholder="NJ"
        style={{ width: 48, minHeight: 28, border: '1px solid var(--line)', borderRadius: 6, padding: '0 6px', fontFamily: MONO, background: 'var(--shell)', color: 'var(--text)' }} />
      <button type="button" className="om-btn" style={{ minHeight: 28 }} disabled={v.length !== 2} onClick={() => onSave(v)}>Save</button>
    </span>
  );
}

export default function Page() {
  return (
    <AdminShell section="Data quality" sub="Cost approvals" title="Cost approvals">
      <CostsPage />
    </AdminShell>
  );
}