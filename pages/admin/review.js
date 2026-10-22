// pages/admin/review.js
// Review queue. Two tabs:
//   Scanned invoices: the invoice photo next to its lines. Fix any number,
//     change the ingredient match (it sticks for future invoices with the
//     same product name), then mark it reviewed.
//   Menu parses: dishes the menu reader created, split into components with
//     their ingredients. Fix quantities, units and ingredients, then mark
//     them checked.
// /admin/review?restaurant=<id> opens on that restaurant's invoices.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { PageHead, Confirm } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, money, shortDate } from '../../components/admin/ui';

// Each panel is at most one screen tall and scrolls on its own, so a long
// queue or a long invoice never stretches the page.
const PANE_H = 'max(460px, calc(100vh - 300px))';

function useApi() {
  const { adminFetch } = useAdminFetch();
  return useCallback(async (url, body) => {
    const res = await adminFetch(url, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Something went wrong');
    return json;
  }, [adminFetch]);
}

function ReviewPage() {
  const router = useRouter();
  const [tab, setTab] = useState('invoices');
  useEffect(() => { if (router.query.tab === 'menus') setTab('menus'); }, [router.query.tab]);

  return (
    <>
      <PageHead kicker="DATA QUALITY" title="Review queue" sub="Check what the AI read before owners lean on it. Fixes here update prices and dish costs right away." />
      <div role="tablist" aria-label="What to review" style={{ display: 'flex', gap: 22, borderBottom: '1px solid var(--line)' }}>
        {[['invoices', 'Scanned invoices'], ['menus', 'Menu parses']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            style={{ padding: '10px 0', border: 0, background: 'none', cursor: 'pointer', font: `${tab === k ? 700 : 500} 13.5px 'Manrope', sans-serif`, color: tab === k ? 'var(--text)' : 'var(--muted)', borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`, marginBottom: -1 }}>{l}</button>
        ))}
      </div>
      {tab === 'invoices' ? <Invoices initialRestaurant={typeof router.query.restaurant === 'string' ? router.query.restaurant : null} /> : <Menus />}
    </>
  );
}

// ── Scanned invoices ──────────────────────────────────────────────────────────

function Invoices({ initialRestaurant }) {
  const api = useApi();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const json = await api('/api/admin/review/invoices');
      setList(json.invoices);
      setOpenId((cur) => {
        if (cur && json.invoices.some((i) => i.id === cur)) return cur;
        const first = json.invoices.find((i) => !initialRestaurant || i.restaurant_id === initialRestaurant) || json.invoices[0];
        return first ? first.id : null;
      });
    } catch (e) {
      setError(e.message);
    }
  }, [api, initialRestaurant]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!list) return <LoadingState label="Loading invoices…" />;
  if (!list.length) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Every invoice is reviewed. Nice.</div>;

  const groups = [];
  for (const i of list) {
    let g = groups.find((x) => x.id === i.restaurant_id);
    if (!g) groups.push((g = { id: i.restaurant_id, name: i.restaurant, items: [] }));
    g.items.push(i);
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <section aria-label="Invoices to review" style={{ flex: '0 1 250px', minWidth: 220, border: '1px solid var(--line)', borderRadius: 12, overflowY: 'auto', maxHeight: PANE_H }}>
        {groups.map((g) => (
          <div key={g.id}>
            <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '9px 14px', background: 'var(--panel)', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>{g.name.toUpperCase()} · {g.items.length}</div>
            {g.items.map((i) => {
              const on = i.id === openId;
              return (
                <button key={i.id} type="button" onClick={() => setOpenId(i.id)}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 0, borderTop: '1px solid var(--line-soft)', cursor: 'pointer', background: on ? 'var(--accent-tint)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--accent)' : 'none', color: 'var(--text)', fontFamily: "'Manrope', sans-serif" }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{i.supplier || 'Unknown supplier'}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{shortDate(i.date || i.created_at)} · {i.lines} lines · {money(i.total)}</span>
                  {i.parse_status === 'failed' && <span style={{ fontSize: 11.5, color: 'var(--red)', fontWeight: 700 }}>Could not be read</span>}
                </button>
              );
            })}
          </div>
        ))}
      </section>
      {openId ? <InvoiceEditor key={openId} id={openId} onDone={load} /> : null}
    </div>
  );
}

const cell = { padding: '7px 6px', borderTop: '1px solid var(--line-soft)', verticalAlign: 'top' };
const inp = (w) => ({ width: w, minHeight: 32, border: '1px solid var(--line)', borderRadius: 6, padding: '0 7px', background: 'var(--shell)', color: 'var(--text)', fontFamily: MONO, fontSize: 12.5 });

function InvoiceEditor({ id, onDone }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [page, setPage] = useState(0);
  const [calc, setCalc] = useState(null);
  const [sel, setSel] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const json = await api(`/api/admin/review/invoices?id=${id}`);
      setData(json);
      setLines(json.lines.map((l) => ({ ...l })));
    } catch (e) {
      setError(e.message);
    }
  }, [api, id]);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    if (!data) return [];
    return lines.filter((l) => {
      const o = data.lines.find((x) => x.id === l.id);
      return o && ['quantity', 'unit', 'unit_cost', 'amount', 'ingredient_id'].some((k) => String(o[k] ?? '') !== String(l[k] ?? ''));
    });
  }, [lines, data]);

  const set = (lineId, patch) => setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));

  async function save(reviewed) {
    setBusy(true);
    setFlash('');
    try {
      const json = await api('/api/admin/review/invoices', { action: reviewed ? 'reviewed' : 'save', invoiceId: id, lines: dirty });
      if (json.errors?.length) setFlash(`Saved with ${json.errors.length} problem(s): ${json.errors[0]}`);
      if (reviewed) await onDone();
      else { await load(); if (!json.errors?.length) setFlash(`Saved. ${json.changed} line(s) fixed, ${json.relinked} rematched.`); }
    } catch (e) {
      setFlash(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div style={{ flex: '1 1 600px' }}><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div style={{ flex: '1 1 600px', display: 'flex' }}><LoadingState label="Loading invoice…" /></div>;

  const inv = data.invoice;
  const pg = data.pages[page];
  const sum = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  return (
    <>
      <section aria-label="Invoice photo" style={{ flex: '1 1 340px', minWidth: 280, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignSelf: 'stretch', maxHeight: PANE_H }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {data.pages.length > 1 && data.pages.map((p, i) => (
            <button key={i} type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12, background: i === page ? 'var(--accent-tint)' : undefined }} onClick={() => setPage(i)}>Page {p.page || i + 1}</button>
          ))}
          {pg && <a href={pg.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700 }}>Open full size ↗</a>}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', background: 'var(--panel)' }}>
          {!pg && <div style={{ padding: 30, color: 'var(--muted)', fontSize: 13.5 }}>No photo on file for this invoice.</div>}
          {pg && pg.kind === 'pdf' && <iframe title="Invoice" src={pg.url} style={{ width: '100%', minHeight: 400, border: 0 }} />}
          {pg && pg.kind === 'image' && <PhotoViewer key={pg.url} url={pg.url} alt={`Invoice page ${pg.page || page + 1}`} />}
        </div>
      </section>

      <section aria-label="Invoice lines" style={{ flex: '2 1 560px', minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, display: 'flex', flexDirection: 'column', maxHeight: PANE_H, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: '1 1 220px' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{inv.supplier || 'Unknown supplier'}{inv.number && <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>#{inv.number}</span>}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              <Link href={`/admin/restaurants/${inv.restaurant_id}`} style={{ fontWeight: 700 }}>{inv.restaurant}</Link> · {shortDate(inv.date || inv.created_at)} · invoice total {money(inv.total)} · lines add to {money(sum)}
              {inv.total && Math.abs(sum - Number(inv.total)) > 0.5 && <b style={{ color: 'var(--amber)' }}> · off by {money(Math.abs(sum - Number(inv.total)))}</b>}
            </div>
          </div>
          <button type="button" className="om-btn" disabled={busy || !dirty.length} onClick={() => save(false)}>Save {dirty.length ? `(${dirty.length})` : ''}</button>
          <button type="button" className="om-pri" disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : dirty.length ? 'Save and mark reviewed' : 'Mark reviewed'}</button>
        </div>
        {flash && <div style={{ padding: '8px 16px', fontSize: 13, background: 'var(--accent-tint)' }}>{flash}</div>}
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--muted)', textAlign: 'left', background: 'var(--panel)' }}>
                <th style={{ padding: '8px 6px 8px 14px', fontWeight: 500 }}>ITEM</th>
                <th style={{ padding: 8, fontWeight: 500 }}>QTY</th>
                <th style={{ padding: 8, fontWeight: 500 }}>UNIT</th>
                <th style={{ padding: 8, fontWeight: 500 }}>UNIT COST</th>
                <th style={{ padding: 8, fontWeight: 500 }}>TOTAL</th>
                <th style={{ padding: '8px 14px 8px 6px', fontWeight: 500 }}>MATCHES INGREDIENT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const o = data.lines.find((x) => x.id === l.id);
                const changed = (k) => String(o?.[k] ?? '') !== String(l[k] ?? '');
                const ring = (k) => (changed(k) ? { borderColor: 'var(--accent)', background: 'var(--accent-tint)' } : {});
                return (
                  <Fragment key={l.id}>
                  <tr onClick={() => setSel(l.id)} onFocusCapture={() => setSel(l.id)} style={{ background: sel === l.id ? 'var(--panel)' : undefined }}>
                    <td style={{ ...cell, paddingLeft: 14, maxWidth: 220 }}>
                      <div style={{ fontWeight: 700 }}>{l.item_name || '—'}</div>
                      {(sel === l.id || calc === l.id) && (
                        <button type="button" onClick={() => setCalc(calc === l.id ? null : l.id)} aria-expanded={calc === l.id}
                          style={{ border: 0, background: 'none', padding: 0, margin: '2px 0', color: 'var(--accent-deep)', font: "700 11.5px 'Manrope', sans-serif", cursor: 'pointer' }}>Case math</button>
                      )}
                      {l.edited && <div style={{ fontSize: 11, color: 'var(--muted)' }}>AI read {l.original_quantity ?? '—'} at {money(l.original_price)}</div>}
                      {o?.checks.map((c, i) => <div key={i} style={{ fontSize: 11.5, color: c.tone === 'amber' ? 'var(--amber)' : 'var(--muted)', fontWeight: c.tone === 'amber' ? 700 : 500 }}>{c.text}</div>)}
                    </td>
                    <td style={cell}><input aria-label="Quantity" inputMode="decimal" value={l.quantity ?? ''} onChange={(e) => set(l.id, { quantity: e.target.value })} style={{ ...inp(64), ...ring('quantity') }} /></td>
                    <td style={cell}><input aria-label="Unit" value={l.unit ?? ''} onChange={(e) => set(l.id, { unit: e.target.value })} style={{ ...inp(64), ...ring('unit') }} /></td>
                    <td style={cell}><input aria-label="Unit cost" inputMode="decimal" value={l.unit_cost ?? ''} onChange={(e) => set(l.id, { unit_cost: e.target.value })} style={{ ...inp(78), ...ring('unit_cost') }} /></td>
                    <td style={cell}><input aria-label="Line total" inputMode="decimal" value={l.amount ?? ''} onChange={(e) => set(l.id, { amount: e.target.value })} style={{ ...inp(78), ...ring('amount') }} /></td>
                    <td style={{ ...cell, paddingRight: 14 }}>
                      <select aria-label="Ingredient" value={l.ingredient_id || ''} onChange={(e) => set(l.id, { ingredient_id: e.target.value || null })}
                        className="om-field" style={{ minHeight: 32, fontSize: 12.5, maxWidth: 240, ...ring('ingredient_id') }}>
                        <option value="">Not matched</option>
                        {o?.suggestions?.length > 0 && (
                          <optgroup label="Suggested">{o.suggestions.map((s) => <option key={'s' + s.id} value={s.id}>{s.name}</option>)}</optgroup>
                        )}
                        <optgroup label="All ingredients">{data.ingredients.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}</optgroup>
                      </select>
                      {changed('ingredient_id') && o?.ingredient_id && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Future invoices with this item name will match it too.</div>}
                    </td>
                  </tr>
                  {calc === l.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '0 14px 10px' }}>
                        <CaseCalc line={l} onClose={() => setCalc(null)} onUse={(patch) => { set(l.id, patch); setCalc(null); }} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}


// ── Invoice photo viewer ──────────────────────────────────────────────────────
// Drag to move, scroll to go up and down, pinch or Ctrl + scroll to zoom,
// double-click to reset. Rotate turns the page a quarter turn.

function PhotoViewer({ url, alt }) {
  const box = useRef(null);
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [boxW, setBoxW] = useState(0);
  const [ratio, setRatio] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const clampZ = (v) => Math.min(6, Math.max(0.5, v));

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) setZoom((z) => clampZ(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      else setOff((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel); };
  }, []);

  // A sideways page is shrunk to fit the panel width and lifted to the top.
  const sideways = rot % 180 !== 0;
  const fit = sideways && ratio ? Math.min(1, 1 / ratio) : 1;
  const lift = sideways && ratio ? -((boxW * ratio) / 2 - (boxW * fit) / 2) : 0;
  const reset = () => { setZoom(1); setOff({ x: 0, y: 0 }); };

  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX - off.x, y: e.clientY - off.y };
    setDragging(true);
  };
  const move = (e) => { if (drag.current) setOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const up = () => { drag.current = null; setDragging(false); };

  const btn = { minWidth: 32, height: 30, padding: '0 9px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--shell)', color: 'var(--text)', font: "700 13px 'Manrope', sans-serif", cursor: 'pointer' };

  return (
    <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={reset}
      style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}>
      <img src={url} alt={alt} draggable={false} onLoad={(e) => setRatio(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
        style={{ width: '100%', display: 'block', transformOrigin: 'center center', transform: `translate(${off.x}px, ${off.y + lift}px) scale(${zoom * fit}) rotate(${rot}deg)`, transition: dragging ? 'none' : 'transform .12s ease-out' }} />
      <div onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', alignItems: 'center', gap: 6, padding: 6, borderRadius: 10, background: 'var(--shell)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)', cursor: 'default' }}>
        <button type="button" aria-label="Zoom out" style={btn} onClick={() => setZoom((z) => clampZ(z / 1.25))}>−</button>
        <span style={{ fontFamily: MONO, fontSize: 11.5, width: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" style={btn} onClick={() => setZoom((z) => clampZ(z * 1.25))}>+</button>
        <button type="button" aria-label="Rotate a quarter turn" title="Rotate" style={btn} onClick={() => { setRot((r) => (r + 90) % 360); setOff({ x: 0, y: 0 }); }}>↻</button>
        <button type="button" style={btn} onClick={reset}>Fit</button>
      </div>
    </div>
  );
}

// ── Case math ─────────────────────────────────────────────────────────────────
// For a line priced by the case: cases bought × what each case holds gives the
// quantity, and the case price ÷ what it holds gives the unit cost.

function CaseCalc({ line, onUse, onClose }) {
  const [cases, setCases] = useState(String(line.quantity ?? ''));
  const [per, setPer] = useState('');
  const [unit, setUnit] = useState(line.unit || '');
  const [price, setPrice] = useState(String(line.unit_cost ?? ''));
  const c = Number(cases), n = Number(per), p = Number(price), u = unit.trim();
  const ok = c > 0 && n > 0 && p > 0 && !!u;
  const r = (v, d) => String(Math.round(v * 10 ** d) / 10 ** d);
  const lab = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, padding: '10px 12px', background: 'var(--panel)', borderRadius: 8 }}>
      <label style={lab}>Cases bought<input inputMode="decimal" value={cases} onChange={(e) => setCases(e.target.value)} style={inp(70)} /></label>
      <label style={lab}>Each case holds
        <span style={{ display: 'flex', gap: 5 }}>
          <input autoFocus aria-label="Amount per case" inputMode="decimal" placeholder="6" value={per} onChange={(e) => setPer(e.target.value)} style={inp(60)} />
          <input aria-label="Unit inside the case" placeholder="dz" value={unit} onChange={(e) => setUnit(e.target.value)} style={inp(60)} />
        </span>
      </label>
      <label style={lab}>Price per case $<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={inp(84)} /></label>
      <div style={{ flex: '1 1 220px', fontSize: 12.5, lineHeight: 1.5, paddingBottom: 6 }}>
        {ok
          ? <>Quantity <b>{r(c * n, 3)} {u}</b> · unit cost <b>${r(p / n, 4)}/{u}</b> · total <b>{money(c * p)}</b></>
          : <span style={{ color: 'var(--muted)' }}>Fill in all four to see the math.</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="om-btn" style={{ minHeight: 32 }} onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" style={{ minHeight: 32 }} disabled={!ok}
          onClick={() => onUse({ quantity: r(c * n, 3), unit: u, unit_cost: r(p / n, 4), amount: r(c * p, 2) })}>Use these</button>
      </div>
    </div>
  );
}

// ── Menu parses ───────────────────────────────────────────────────────────────

function Menus() {
  const api = useApi();
  const [list, setList] = useState(null);
  const [rid, setRid] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const json = await api('/api/admin/review/menus');
      setList(json.restaurants);
      setRid((cur) => (cur && json.restaurants.some((r) => r.id === cur) ? cur : json.restaurants[0]?.id || null));
    } catch (e) {
      setError(e.message);
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!list) return <LoadingState label="Loading menus…" />;
  if (!list.length) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Every parsed dish is checked.</div>;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <section aria-label="Restaurants" style={{ flex: '0 1 250px', minWidth: 220, border: '1px solid var(--line)', borderRadius: 12, overflowY: 'auto', maxHeight: PANE_H }}>
        {list.map((r) => {
          const on = r.id === rid;
          return (
            <button key={r.id} type="button" onClick={() => setRid(r.id)}
              style={{ width: '100%', textAlign: 'left', padding: '11px 14px', border: 0, borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', background: on ? 'var(--accent-tint)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--accent)' : 'none', color: 'var(--text)', fontFamily: "'Manrope', sans-serif" }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{r.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{r.dishes} dish{r.dishes === 1 ? '' : 'es'} to check · since {shortDate(r.oldest)}</span>
            </button>
          );
        })}
      </section>
      {rid && <MenuDishes key={rid} rid={rid} onChanged={load} />}
    </div>
  );
}

function MenuDishes({ rid, onChanged }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [askAll, setAskAll] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setData(await api(`/api/admin/review/menus?restaurant=${rid}`)); } catch (e) { setError(e.message); }
  }, [api, rid]);
  useEffect(() => { load(); }, [load]);

  async function checkAll() {
    setBusy(true);
    try { await api('/api/admin/review/menus', { action: 'checked', dishIds: data.dishes.map((d) => d.id) }); setAskAll(false); await onChanged(); } finally { setBusy(false); }
  }

  if (error) return <div style={{ flex: '1 1 600px' }}><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div style={{ flex: '1 1 600px', display: 'flex' }}><LoadingState label="Loading dishes…" /></div>;

  const unsure = (d) => d.waiting > 0 || !d.components.length || d.components.some((c) => !c.lines.length);
  const shown = filter === 'unsure' ? data.dishes.filter(unsure) : data.dishes;

  return (
    <div style={{ flex: '1 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, flex: '1 1 auto' }}>{data.restaurant?.name} · {data.dishes.length} dishes</h2>
        <select className="om-field" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto', minHeight: 34 }}>
          <option value="all">All dishes</option>
          <option value="unsure">Unsure only ({data.dishes.filter(unsure).length})</option>
        </select>
        <button type="button" className="om-btn" disabled={busy} onClick={() => setAskAll(true)}>Mark all checked</button>
      </div>
      {shown.map((d) => <DishCard key={d.id} dish={d} ingredients={data.ingredients} api={api} onSaved={load} onChecked={async () => { await load(); await onChanged(); }} />)}
      {askAll && <Confirm title={`Mark all ${data.dishes.length} dishes checked?`} sub="They leave Menu parses without another look. Check the unsure ones first if you have not." yes={`Mark ${data.dishes.length} checked`} busy={busy} onClose={() => setAskAll(false)} onYes={checkAll} />}
    </div>
  );
}

function DishCard({ dish, ingredients, api, onSaved, onChecked }) {
  const [comps, setComps] = useState(dish.components);
  const [removed, setRemoved] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Start over from the saved recipe whenever it reloads.
  useEffect(() => { setComps(dish.components); setRemoved([]); }, [dish]);
  const dirty = removed.length > 0 || comps.some((c, i) => c.lines.some((l) => l.isNew || JSON.stringify(l) !== JSON.stringify(dish.components[i]?.lines.find((x) => x.id === l.id))));

  const setLine = (ci, li, patch) => setComps((cs) => cs.map((c, i) => (i !== ci ? c : { ...c, lines: c.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) })));
  const removeLine = (ci, li) => {
    const l = comps[ci].lines[li];
    if (!l.isNew) setRemoved((r) => [...r, l.id]);
    setComps((cs) => cs.map((c, i) => (i !== ci ? c : { ...c, lines: c.lines.filter((_, j) => j !== li) })));
  };
  const addLine = (ci) => setComps((cs) => cs.map((c, i) => (i !== ci ? c : { ...c, lines: [...c.lines, { id: `new-${Date.now()}`, isNew: true, quantity: 1, unit: 'oz', ingredient_id: ingredients[0]?.id || '' }] })));

  async function save(thenCheck) {
    setBusy(true);
    setErr('');
    try {
      if (dirty) {
        const all = comps.flatMap((c) => c.lines.map((l) => ({ ...l, component_id: c.id })));
        await api('/api/admin/review/menus', {
          action: 'save', dishId: dish.id, removed,
          lines: all.filter((l) => !l.isNew).map(({ id, quantity, unit, ingredient_id }) => ({ id, quantity, unit, ingredient_id })),
          added: all.filter((l) => l.isNew && l.ingredient_id).map(({ component_id, quantity, unit, ingredient_id }) => ({ component_id, quantity, unit, ingredient_id })),
        });
      }
      if (thenCheck) { await api('/api/admin/review/menus', { action: 'checked', dishIds: [dish.id] }); await onChecked(); }
      else { setRemoved([]); await onSaved(); }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pct = dish.price > 0 && dish.cost > 0 ? (dish.cost / dish.price) * 100 : null;

  return (
    <article style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, flex: '1 1 260px' }}>{dish.name}</h3>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{dish.category}</span>
        <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{money(dish.price)} · plate {money(dish.cost)}{pct != null ? ` · ${pct.toFixed(0)}%` : ''}</span>
        {dish.waiting > 0 && <Chip bg="var(--amber-tint)" fg="var(--amber)">{dish.waiting} PRICE{dish.waiting === 1 ? '' : 'S'} UNAPPROVED</Chip>}
      </div>
      {dish.description && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{dish.description}</div>}
      {comps.length === 0 && <div style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 700 }}>No components. The reader found no recipe for this dish.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {comps.map((c, ci) => (
          <div key={c.id} style={{ background: 'var(--panel)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800 }}>
              <span>{c.name}</span><span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 12 }}>{money(c.cost)}</span>
            </div>
            {c.lines.map((l, li) => (
              <div key={l.id} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <input aria-label="Quantity" inputMode="decimal" value={l.quantity ?? ''} onChange={(e) => setLine(ci, li, { quantity: e.target.value })} style={inp(54)} />
                <input aria-label="Unit" value={l.unit ?? ''} onChange={(e) => setLine(ci, li, { unit: e.target.value })} style={inp(50)} />
                <select aria-label="Ingredient" className="om-field" value={l.ingredient_id || ''} onChange={(e) => setLine(ci, li, { ingredient_id: e.target.value })} style={{ minHeight: 32, fontSize: 12.5, flex: 1, minWidth: 0 }}>
                  {ingredients.map((g) => <option key={g.id} value={g.id}>{g.name}{g.priced ? '' : ' · unpriced'}</option>)}
                </select>
                <button type="button" aria-label="Remove line" onClick={() => removeLine(ci, li)} style={{ border: 0, background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => addLine(ci)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', color: 'var(--accent-deep)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>+ Add ingredient</button>
          </div>
        ))}
      </div>
      {err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {dirty && <button type="button" className="om-btn" disabled={busy} onClick={() => save(false)}>Save recipe</button>}
        <button type="button" className="om-pri" disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : dirty ? 'Save and mark checked' : 'Looks right'}</button>
      </div>
    </article>
  );
}

export default function Page() {
  return (
    <AdminShell section="Data quality" sub="Review queue" title="Review queue">
      <ReviewPage />
    </AdminShell>
  );
}