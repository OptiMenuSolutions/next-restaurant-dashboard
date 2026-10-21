// pages/admin/ingredients.js
// Ingredient library. Switch between:
//   Global ingredients   the shared list the menu and invoice parsers match
//                        against. Click one to see its price over the last
//                        13 weeks, what each restaurant pays, and to edit its
//                        unit, reference price and aliases.
//   One restaurant       that restaurant's own ingredients, which global each
//                        is linked to, and what they pay against the reference.
//
// The old Global Ingredients page now lives at /admin/old/ingredients.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead, Dialog } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState, SearchIcon } from '../../components/client/ClientChrome';
import { Chip, Pills, th, td, money, shortDate } from '../../components/admin/ui';

const UNITS = ['oz', 'fl oz', 'each', 'lb', 'g', 'kg', 'ml', 'l', 'gal', 'qt', 'bunch', 'head', 'slice', 'sheet', 'sprig', 'bag', 'case', 'box'];
const STATUS = {
  INVOICE: ['var(--green-tint)', 'var(--green)'],
  APPROVED: ['var(--accent-tint)', 'var(--accent-deep)'],
  'AI GUESS': ['var(--amber-tint)', 'var(--amber)'],
  'NO PRICE': ['var(--red-tint)', 'var(--red)'],
};
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
const PAGE_CSS = `.om-app{--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4}
.om-app[data-theme="dark"],html[data-om-theme="dark"] .om-app{--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181}
.om-row{cursor:pointer}
.om-row:hover td{background:var(--panel)}
.om-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}`;

const per = (p, unit) => (p == null ? '—' : `${money(p)} / ${unit}`);
function diffText(price, unit, g) {
  if (price == null || !g || g.reference_price == null || !(g.reference_price > 0)) return null;
  if ((g.reference_unit || g.unit) !== unit) return null;
  const d = price / g.reference_price - 1;
  return { d, text: Math.abs(d) < 0.005 ? 'Same' : `${d > 0 ? '+' : ''}${Math.round(d * 100)}%` };
}
const diffColor = (d) => (d == null ? 'var(--muted)' : d > 0.05 ? 'var(--red)' : d < -0.05 ? 'var(--green)' : 'var(--muted)');

function LibraryPage() {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('global');
  const [restId, setRestId] = useState('');
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // 'add' | 'import'

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/library');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the library');
      setData(json);
      setRestId((r) => r || json.restaurants[0]?.id || '');
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body) => {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/library', { method: 'POST', body: JSON.stringify(body) });
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

  const globalsById = useMemo(() => new Map((data?.globals || []).map((g) => [g.id, g])), [data]);

  const globalRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.globals || []).filter((g) => {
      if (s && !g.name.toLowerCase().includes(s) && !g.aliases.some((a) => a.toLowerCase().includes(s))) return false;
      if (filter === 'noref') return g.reference_price == null;
      if (filter === 'unused') return g.restaurants === 0;
      return true;
    });
  }, [data, q, filter]);

  const restItems = useMemo(() => (data?.items || []).filter((x) => x.restaurant_id === restId), [data, restId]);
  const restRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return restItems.filter((x) => {
      if (s && !x.name.toLowerCase().includes(s) && !(x.link?.name || '').toLowerCase().includes(s)) return false;
      if (filter === 'unlinked') return !x.link;
      if (filter === 'noprice') return x.status === 'NO PRICE' || x.status === 'AI GUESS';
      return true;
    }).sort((a, b) => b.dishes - a.dishes || a.name.localeCompare(b.name));
  }, [restItems, q, filter]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading the ingredient library…" />;

  const isGlobal = scope === 'global';
  const switchScope = (s) => { setScope(s); setSel(null); setFilter('all'); setQ(''); };
  const selGlobal = isGlobal ? globalsById.get(sel) || null : null;
  const selItem = !isGlobal ? restItems.find((x) => x.id === sel) || null : null;

  const linkedCount = data.items.filter((x) => x.link).length;
  const heads = isGlobal
    ? [[data.globals.length, 'global ingredients'], [data.globals.filter((g) => g.reference_price == null).length, 'with no reference price'], [data.globals.filter((g) => g.restaurants === 0).length, 'not used by any restaurant'], [linkedCount, 'restaurant ingredients linked']]
    : [[restItems.length, 'ingredients'], [restItems.filter((x) => !x.link).length, 'not linked to a global'], [restItems.filter((x) => x.status === 'NO PRICE' || x.status === 'AI GUESS').length, 'with no price the owner sees'], [restItems.filter((x) => x.status === 'INVOICE').length, 'priced from invoices']];

  return (
    <>
      <style>{PAGE_CSS}</style>
      <PageHead kicker="DATA QUALITY" title="Ingredient library"
        sub={isGlobal ? 'The shared list the menu and invoice readers match against, and what restaurants really pay.' : 'One restaurant’s own ingredients, what they pay, and which global each one is linked to.'}>
        {isGlobal && <button type="button" className="om-btn" onClick={() => setDialog('import')}>Import CSV</button>}
        {isGlobal && <button type="button" className="om-pri" onClick={() => setDialog('add')}>Add global ingredient</button>}
      </PageHead>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <div role="group" aria-label="Library view" style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 19, overflow: 'hidden' }}>
          {[['global', 'Global ingredients'], ['restaurant', 'One restaurant']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={scope === k} onClick={() => switchScope(k)}
              style={{ minHeight: 36, padding: '0 16px', border: 0, cursor: 'pointer', font: "700 12.5px 'Manrope',sans-serif", background: scope === k ? 'var(--text)' : 'var(--shell)', color: scope === k ? 'var(--shell)' : 'var(--text)' }}>{l}</button>
          ))}
        </div>
        {!isGlobal && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>RESTAURANT</span>
            <select className="om-field" style={{ width: 240 }} value={restId} onChange={(e) => { setRestId(e.target.value); setSel(null); }}>
              {data.restaurants.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.n})</option>)}
            </select>
          </label>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {heads.map(([n, label]) => (
          <div key={label} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>{n}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
          <span style={{ position: 'absolute', left: -9999 }}>Search ingredients</span>
          <span aria-hidden="true" style={{ position: 'absolute', left: 11, top: 11, color: 'var(--muted)' }}><SearchIcon /></span>
          <input className="om-field" style={{ paddingLeft: 34 }} placeholder={isGlobal ? 'Search names and aliases' : 'Search ingredients'} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Pills label="Filter" value={filter} onChange={setFilter}
          options={isGlobal
            ? [{ key: 'all', label: 'All' }, { key: 'noref', label: 'No reference price' }, { key: 'unused', label: 'Not used yet' }]
            : [{ key: 'all', label: 'All' }, { key: 'unlinked', label: 'Not linked' }, { key: 'noprice', label: 'No price shown' }]} />
      </div>
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <section aria-label="Ingredients" style={{ flex: '1 1 560px', minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
          {isGlobal ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead><tr>
                <th style={{ ...th, paddingLeft: 18 }}>GLOBAL INGREDIENT</th>
                <th style={th}>REFERENCE PRICE</th>
                <th style={th}>AVG PAID</th>
                <th style={th}>RESTAURANTS</th>
                <th style={{ ...th, paddingRight: 18 }}>SHELF LIFE</th>
              </tr></thead>
              <tbody>
                {globalRows.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>No global ingredients match.</td></tr>}
                {globalRows.slice(0, 400).map((g) => {
                  const on = g.id === sel;
                  return (
                    <tr key={g.id} className="om-row" tabIndex={0} aria-selected={on} onClick={() => setSel(g.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(g.id); }}
                      style={{ background: on ? 'var(--accent-tint)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--accent)' : 'none' }}>
                      <td style={{ ...td, paddingLeft: 18 }}>
                        <span style={{ display: 'block', fontWeight: 700 }}>{g.name}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>per {g.unit}{g.aliases.length ? ` · ${g.aliases.length} alias${g.aliases.length === 1 ? '' : 'es'}` : ''}</span>
                      </td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 12.5 }}>{g.reference_price == null ? <span style={{ color: 'var(--red)' }}>None</span> : per(g.reference_price, g.reference_unit || g.unit)}</td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 12.5 }}>{g.avgPaid ? <>{per(g.avgPaid.price, g.avgPaid.unit)}<span style={{ display: 'block', fontFamily: 'inherit', fontSize: 11, color: 'var(--muted)' }}>{g.avgPaid.n} invoice-priced</span></> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td style={td}>{g.restaurants ? `${g.restaurants}` : <span style={{ color: 'var(--muted)' }}>None yet</span>}</td>
                      <td style={{ ...td, paddingRight: 18, fontFamily: MONO, fontSize: 12.5 }}>{g.shelfLife} days</td>
                    </tr>
                  );
                })}
                {globalRows.length > 400 && <tr><td colSpan={5} style={{ ...td, color: 'var(--muted)', textAlign: 'center' }}>Showing 400 of {globalRows.length}. Search to narrow it down.</td></tr>}
              </tbody>
            </table>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
              <thead><tr>
                <th style={{ ...th, paddingLeft: 18 }}>THEIR INGREDIENT</th>
                <th style={th}>LINKED TO GLOBAL</th>
                <th style={th}>THEY PAY</th>
                <th style={th}>VS REFERENCE</th>
                <th style={{ ...th, paddingRight: 18 }}>LAST BOUGHT</th>
              </tr></thead>
              <tbody>
                {restRows.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>No ingredients match.</td></tr>}
                {restRows.map((x) => {
                  const on = x.id === sel;
                  const g = x.link ? globalsById.get(x.link.id) : null;
                  const df = diffText(x.status === 'INVOICE' || x.status === 'APPROVED' ? x.price : null, x.unit, g);
                  return (
                    <tr key={x.id} className="om-row" tabIndex={0} aria-selected={on} onClick={() => setSel(x.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(x.id); }}
                      style={{ background: on ? 'var(--accent-tint)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--accent)' : 'none' }}>
                      <td style={{ ...td, paddingLeft: 18 }}>
                        <span style={{ display: 'block', fontWeight: 700 }}>{x.name}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{x.dishes ? `Used in ${x.dishes} dish${x.dishes === 1 ? '' : 'es'}` : 'Not used in a dish'}</span>
                      </td>
                      <td style={td}>{x.link ? x.link.name : <span style={{ color: 'var(--amber)', fontWeight: 700 }}>Not linked yet</span>}</td>
                      <td style={{ ...td, fontSize: 12.5 }}>
                        <span style={{ fontFamily: MONO }}>{per(x.price, x.unit)}</span>{' '}
                        <Chip bg={STATUS[x.status][0]} fg={STATUS[x.status][1]}>{x.status}</Chip>
                      </td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 12.5, color: diffColor(df?.d) }}>{df ? df.text : '—'}</td>
                      <td style={{ ...td, paddingRight: 18, fontSize: 12.5 }}>{x.last ? shortDate(x.last) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside aria-label="Details" style={{ flex: '0 1 420px', minWidth: 300, border: '1px solid var(--line)', borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 90 }}>
          {isGlobal && selGlobal && <GlobalPanel key={selGlobal.id} g={selGlobal} items={data.items.filter((x) => x.link?.id === selGlobal.id)} busy={busy} post={post} onDeleted={() => setSel(null)} />}
          {!isGlobal && selItem && <ItemPanel key={selItem.id} x={selItem} g={selItem.link ? globalsById.get(selItem.link.id) : null} globals={data.globals} busy={busy} post={post} />}
          {!(selGlobal || selItem) && <div style={{ color: 'var(--muted)', fontSize: 13.5, padding: '30px 0', textAlign: 'center' }}>Click an ingredient to see its price history and details.</div>}
        </aside>
      </div>

      {dialog === 'add' && <AddDialog busy={busy} onClose={() => setDialog(null)} onSave={async (row) => { const r = await post({ action: 'create', ...row }); if (r) { setDialog(null); setScope('global'); setSel(r.id); setFlash(`Added ${row.name}.`); } }} />}
      {dialog === 'import' && <ImportDialog busy={busy} onClose={() => setDialog(null)} onImport={async (rows) => { const r = await post({ action: 'import', rows }); if (r) { setDialog(null); setFlash(`Added ${r.added}. Skipped ${r.skipped} (already in the library or missing a name or unit).`); } }} />}
    </>
  );
}

function useHistory(ids) {
  const { adminFetch } = useAdminFetch();
  const [h, setH] = useState(null);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    setH(null);
    if (!key) { setH({ weeks: [], series: [] }); return undefined; }
    adminFetch(`/api/admin/library?history=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setH(j.series ? j : { weeks: [], series: [], error: j.error }); })
      .catch((e) => { if (alive) setH({ weeks: [], series: [], error: e.message }); });
    return () => { alive = false; };
  }, [adminFetch, key]);
  return h;
}

function Kicker({ children }) {
  return <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{children}</div>;
}

function GlobalPanel({ g, items, busy, post, onDeleted }) {
  const [form, setForm] = useState({ name: g.name, unit: g.unit, reference_price: g.reference_price != null ? String(g.reference_price) : '', reference_unit: g.reference_unit || g.unit, aliases: g.aliases });
  const [alias, setAlias] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hist = useHistory(items.map((x) => x.id));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Draw only series in the most common unit, so the lines compare.
  const units = {};
  for (const s of hist?.series || []) units[s.unit] = (units[s.unit] || 0) + 1;
  const unit = Object.keys(units).sort((a, b) => units[b] - units[a])[0];
  const drawn = (hist?.series || []).filter((s) => s.unit === unit);
  const left = (hist?.series || []).length - drawn.length;
  const ref = g.reference_price != null && (g.reference_unit || g.unit) === unit ? g.reference_price : null;

  const addAlias = () => {
    const t = alias.trim();
    if (t && !form.aliases.some((a) => a.toLowerCase() === t.toLowerCase())) set('aliases', [...form.aliases, t]);
    setAlias('');
  };
  const pays = [...items].sort((a, b) => a.restaurant.localeCompare(b.restaurant));

  return (
    <>
      <div>
        <Kicker>GLOBAL INGREDIENT</Kicker>
        <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{g.name}</h2>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{g.restaurants ? `Linked by ${g.restaurants} restaurant${g.restaurants === 1 ? '' : 's'} · in ${g.dishes} dish${g.dishes === 1 ? '' : 'es'}` : 'No restaurant uses it yet'}</div>
      </div>

      <PriceChart title={`Price paid, last ${hist?.weeks?.length || 13} weeks`} hist={hist} series={drawn} unit={unit} reference={ref}
        empty={g.reference_price == null ? 'No invoice prices in the last year, and no reference price.' : `No invoice prices in the last year. Reference is ${per(g.reference_price, g.reference_unit || g.unit)}.`}
        note={left > 0 ? `${left} restaurant${left === 1 ? '' : 's'} priced in a different unit, not drawn.` : ''} />

      <div>
        <Kicker>WHAT EACH RESTAURANT PAYS</Kicker>
        {pays.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>No restaurant ingredient is linked to it yet.</div>}
        {pays.map((x) => {
          const df = diffText(x.status === 'INVOICE' || x.status === 'APPROVED' ? x.price : null, x.unit, g);
          return (
            <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{x.restaurant}</b>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
                  {x.name} · {x.status === 'INVOICE' ? `invoice${x.last ? ' · ' + shortDate(x.last) : ''}` : x.status === 'APPROVED' ? 'approved price, no invoice yet' : x.status === 'AI GUESS' ? 'AI guess, owner does not see it' : 'no price'}
                </span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{per(x.price, x.unit)}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, width: 48, textAlign: 'right', color: diffColor(df?.d) }}>{df ? df.text : ''}</span>
            </div>
          );
        })}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); post({ action: 'update', id: g.id, ...form }); }} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <Field label="Name"><input className="om-field" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Base unit"><UnitSelect value={form.unit} onChange={(v) => set('unit', v)} /></Field>
          <Field label="Shelf life">
            <div style={{ minHeight: 38, display: 'flex', alignItems: 'center', fontFamily: MONO, fontSize: 13 }}>{g.shelfLife} days</div>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <Field label="Reference price">
            <input className="om-field" inputMode="decimal" placeholder="None" value={form.reference_price} onChange={(e) => set('reference_price', e.target.value)} />
          </Field>
          <Field label="Per"><UnitSelect value={form.reference_unit} onChange={(v) => set('reference_unit', v)} /></Field>
        </div>
        {g.avgPaid && (
          <button type="button" className="om-btn" style={{ alignSelf: 'flex-start' }}
            onClick={() => setForm((f) => ({ ...f, reference_price: g.avgPaid.price.toFixed(2), reference_unit: g.avgPaid.unit }))}>
            Use average paid ({per(g.avgPaid.price, g.avgPaid.unit)})
          </button>
        )}
        <Field label="Aliases (names it goes by on menus and invoices)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {form.aliases.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>None yet.</span>}
            {form.aliases.map((a) => (
              <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--line)', borderRadius: 6, padding: '2px 4px 2px 8px', fontFamily: MONO, fontSize: 11.5 }}>
                {a}
                <button type="button" aria-label={`Remove alias ${a}`} onClick={() => set('aliases', form.aliases.filter((x) => x !== a))}
                  style={{ border: 0, background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 3px' }}>×</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input className="om-field" placeholder="Add an alias" value={alias} onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }} />
            <button type="button" className="om-btn" onClick={addAlias} disabled={!alias.trim()}>Add</button>
          </div>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
          {confirmDelete
            ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>Delete it?
                <button type="button" className="om-btn" style={{ color: 'var(--red)' }} disabled={busy} onClick={async () => { if (await post({ action: 'delete', id: g.id })) onDeleted(); }}>Yes, delete</button>
                <button type="button" className="om-btn" onClick={() => setConfirmDelete(false)}>No</button>
              </span>
            : <button type="button" className="om-btn" style={{ color: 'var(--red)' }} onClick={() => setConfirmDelete(true)}>Delete</button>}
          <button type="submit" className="om-pri" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </>
  );
}

function ItemPanel({ x, g, globals, busy, post }) {
  const hist = useHistory([x.id]);
  const [pick, setPick] = useState('');
  const df = diffText(x.status === 'INVOICE' || x.status === 'APPROVED' ? x.price : null, x.unit, g);
  const options = useMemo(() => [...globals].sort((a, b) => a.name.localeCompare(b.name)), [globals]);
  return (
    <>
      <div>
        <Kicker>{x.restaurant.toUpperCase()}</Kicker>
        <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{x.name}</h2>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {per(x.price, x.unit)} · <Chip bg={STATUS[x.status][0]} fg={STATUS[x.status][1]}>{x.status}</Chip>
          {df && <span style={{ color: diffColor(df.d) }}> · {df.text} vs reference</span>}
        </div>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Kicker>LINKED TO GLOBAL</Kicker>
        {x.link ? (
          <div style={{ fontSize: 13.5 }}>
            <b>{x.link.name}</b>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
              {x.link.via === 'name' ? 'Same name as the global.' : x.link.via === 'alias' ? `Through the alias “${x.link.alias}”.` : `Through its invoice line “${x.link.phrase}”${x.link.alias ? `, an alias of the global` : ''}.`}
            </span>
          </div>
        ) : <div style={{ fontSize: 13.5, color: 'var(--amber)', fontWeight: 700 }}>Not linked yet</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="om-field" aria-label="Link to a global ingredient" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{x.link ? 'Change link to…' : 'Link to…'}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.unit})</option>)}
          </select>
          <button type="button" className="om-pri" disabled={!pick || busy} onClick={() => post({ action: 'link', globalId: pick, name: x.name })}>Link</button>
        </div>
        {x.link && x.link.via !== 'name' && x.link.alias && (
          <button type="button" className="om-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => post({ action: 'unlink', globalId: x.link.id, alias: x.link.alias })}>
            Unlink (removes the alias “{x.link.alias}”)
          </button>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Linking adds “{x.name}” as an alias on the global, so the menu and invoice readers learn it too.</div>
      </div>

      <PriceChart title={`What they paid, last ${hist?.weeks?.length || 13} weeks`} hist={hist} series={hist?.series || []} unit={x.unit} reference={g && (g.reference_unit || g.unit) === x.unit ? g.reference_price : null}
        empty={x.status === 'INVOICE' ? 'No invoices in the last year that compare in this unit.' : 'No invoice prices yet.'} />

      <div>
        <Kicker>ON THEIR INVOICES AS</Kicker>
        {x.phrases.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Not on an invoice yet.</div>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>{x.phrases.map((p) => <span key={p} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px', fontFamily: MONO, fontSize: 11.5 }}>{p}</span>)}</div>}
      </div>
      <Link href={`/admin/restaurants/${x.restaurant_id}`} className="om-btn" style={{ alignSelf: 'flex-start' }}>Open {x.restaurant}</Link>
    </>
  );
}

// Weekly price lines with a hover crosshair. One line per restaurant,
// a dashed line for the reference price when it is in the same unit.
function PriceChart({ title, hist, series, unit, reference, empty, note }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const W = 380, H = 150, L = 46, R = 10, T = 10, B = 22;
  const shown = series.slice(0, SERIES.length);
  const vals = shown.flatMap((s) => s.points.filter((p) => p != null));
  if (reference != null) vals.push(reference);

  let body;
  if (!hist) body = <div style={{ fontSize: 13, color: 'var(--muted)', padding: '24px 0' }}>Loading prices…</div>;
  else if (hist.error) body = <div style={{ fontSize: 13, color: 'var(--red)' }}>{hist.error}</div>;
  else if (!shown.length) body = <div style={{ fontSize: 13, color: 'var(--muted)', padding: '18px 0' }}>{empty}</div>;
  else {
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
    lo = Math.max(0, lo - pad); hi += pad;
    const n = hist.weeks.length;
    const x = (i) => L + (i * (W - L - R)) / (n - 1);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const paths = shown.map((s) => {
      let d = '', pen = false;
      s.points.forEach((p, i) => { if (p == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`; pen = true; });
      return d;
    });
    const onMove = (e) => {
      const r = box.current.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
      setHover(i >= 0 && i < n ? i : null);
    };
    const tipLeft = hover != null ? `${Math.min(70, Math.max(0, (x(hover) / W) * 100 - 15))}%` : 0;
    body = (
      <div style={{ position: 'relative' }}>
        <svg ref={box} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}, per ${unit}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth="1" />
              <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">{money(v)}</text>
            </g>
          ))}
          <text x={L} y={H - 6} fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">{shortDate(hist.weeks[0]).toUpperCase()}</text>
          <text x={W - R} y={H - 6} textAnchor="end" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="var(--muted)">THIS WEEK</text>
          {reference != null && <line x1={L} x2={W - R} y1={y(reference)} y2={y(reference)} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 4" />}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line)" strokeWidth="1" />}
          {paths.map((d, k) => <path key={k} d={d} fill="none" stroke={SERIES[k]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
          {shown.map((s, k) => s.points.map((p, i) => (p == null ? null : (
            <circle key={`${k}-${i}`} cx={x(i)} cy={y(p)} r={hover === i ? 4.5 : 3} fill={SERIES[k]} stroke="var(--shell)" strokeWidth="2" />
          ))))}
          <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
        </svg>
        {hover != null && (
          <div style={{ position: 'absolute', top: 0, left: tipLeft, pointerEvents: 'none', background: 'var(--text)', color: 'var(--shell)', borderRadius: 8, padding: '8px 10px', fontSize: 12, minWidth: 150, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ fontFamily: MONO, fontSize: 10, opacity: 0.75, marginBottom: 3 }}>WEEK OF {shortDate(hist.weeks[hover]).toUpperCase()}</div>
            {shown.map((s, k) => (
              <div key={s.ingredientId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: SERIES[k], flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{s.restaurant}</span>
                <span style={{ fontFamily: MONO }}>{s.points[hover] == null ? 'no invoice' : money(s.points[hover])}</span>
              </div>
            ))}
            {reference != null && <div style={{ opacity: 0.75, marginTop: 2 }}>Reference {money(reference)}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Kicker>{title.toUpperCase()}</Kicker>
        {unit && shown.length > 0 && <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)' }}>PER {unit.toUpperCase()}</span>}
      </div>
      {body}
      {shown.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12 }}>
          {shown.map((s, k) => (
            <span key={s.ingredientId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: SERIES[k] }} />{s.restaurant}
            </span>
          ))}
          {reference != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, borderTop: '2px dashed var(--muted)' }} />Reference</span>}
        </div>
      )}
      {shown.length === 1 && reference != null && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Dashed line: reference price {money(reference)}.</div>}
      {series.length > SERIES.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{series.length - SERIES.length} more restaurants not drawn. All are listed below.</div>}
      {note && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{note}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

function UnitSelect({ value, onChange }) {
  const list = UNITS.includes(value) || !value ? UNITS : [value, ...UNITS];
  return (
    <select className="om-field" value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((u) => <option key={u} value={u}>{u}</option>)}
    </select>
  );
}

function AddDialog({ busy, onClose, onSave }) {
  const [f, setF] = useState({ name: '', unit: 'oz', reference_price: '', reference_unit: 'oz', aliases: [] });
  return (
    <Dialog title="Add a global ingredient" sub="The menu and invoice readers will match against it from the next parse." onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSave({ ...f, reference_unit: f.unit }); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Name"><input className="om-field" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Shredded mozzarella" /></Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Base unit"><UnitSelect value={f.unit} onChange={(v) => setF({ ...f, unit: v })} /></Field>
          <Field label="Reference price (optional)"><input className="om-field" inputMode="decimal" value={f.reference_price} onChange={(e) => setF({ ...f, reference_price: e.target.value })} placeholder={`per ${f.unit}`} /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="om-pri" disabled={busy || !f.name.trim()}>{busy ? 'Adding…' : 'Add ingredient'}</button>
        </div>
      </form>
    </Dialog>
  );
}

// CSV with columns name, unit, reference price (optional). A header row is fine.
function parseCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = [];
    let cur = '', quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') { if (quoted && raw[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
      else if (c === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    const [name, unit, price] = cells.map((s) => s.trim());
    if (/^name$/i.test(name || '')) continue;
    rows.push({ name, unit, reference_price: price ? price.replace(/[$,]/g, '') : '' });
  }
  return rows;
}

function ImportDialog({ busy, onClose, onImport }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  return (
    <Dialog title="Import global ingredients" sub="A CSV with the columns name, unit and reference price (the price is optional). Names already in the library are skipped." onClose={onClose}>
      <input type="file" accept=".csv,text/csv" aria-label="CSV file"
        onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setFileName(file.name); setRows(parseCsv(await file.text())); }} />
      {rows && (
        <div style={{ fontSize: 13 }}>
          <b>{rows.length}</b> row{rows.length === 1 ? '' : 's'} in {fileName}.
          {rows.slice(0, 5).map((r, i) => <div key={i} style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{r.name || '(no name)'} · {r.unit || '(no unit)'}{r.reference_price ? ` · $${r.reference_price}` : ''}</div>)}
          {rows.length > 5 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>and {rows.length - 5} more</div>}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !rows?.length} onClick={() => onImport(rows)}>{busy ? 'Importing…' : `Import ${rows?.length || ''}`}</button>
      </div>
    </Dialog>
  );
}

export default function Page() {
  return (
    <AdminShell section="Data quality" sub="Ingredient library" title="Ingredient library">
      <LibraryPage />
    </AdminShell>
  );
}