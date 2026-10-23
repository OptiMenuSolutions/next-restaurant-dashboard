// pages/admin/tags/index.js
// Tag kits: what is on the shelf, every kit from writing to placed, and
// every live tag with its spot and taps. Start a kit, sell extra tags or log
// a restock from the buttons up top.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead, Dialog, Confirm } from '../../../components/admin/AdminShell';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../../components/client/ClientChrome';
import { Chip, th, td, money, shortDate } from '../../../components/admin/ui';
import useIsPhone from '../../../lib/admin/useIsPhone';

const STAGES = [
  ['Not written', 'var(--shell)', 'var(--line)'],
  ['Written', 'var(--line)', 'var(--line)'],
  ['Packed', 'var(--amber-tint)', 'var(--amber)'],
  ['On the way', 'var(--accent-tint)', 'var(--accent)'],
  ['Delivered', 'var(--accent)', 'var(--accent)'],
  ['Placed and tapped', 'var(--green)', 'var(--green)'],
];
const ITEM_USE = { tags: '3 per plan kit', boxes: '1 per plan kit', foam: '1 per plan kit', cards: '1 per plan kit' };
const KIND = { plan: 'Plan kit', addon: 'Add-on', replacement: 'Replacement' };

function useAct(onDone) {
  const { adminFetch } = useAdminFetch();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = useCallback(async (body) => {
    setBusy(true);
    setErr('');
    try {
      const res = await adminFetch('/api/admin/tags/action', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      if (onDone) await onDone(json);
      return json;
    } catch (e) {
      setErr(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [adminFetch, onDone]);
  return { act, busy, err, setErr };
}

function TagsPage() {
  const isPhone = useIsPhone();
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { type, ... }

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/tags');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load tag kits');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);
  const { act, busy } = useAct(load);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading tag kits…" />;

  return (
    <>
      <PageHead kicker="CUSTOMERS" title="Tag kits" sub="Every plan ships with 3 NFC tags. Extra tags are a paid add-on. Start a kit to write, pack and ship it in one go.">
        <button type="button" className="om-btn" onClick={() => setDialog({ type: 'restock' })}>Log a restock</button>
        <button type="button" className="om-btn" onClick={() => setDialog({ type: 'sell' })}>Sell extra tags</button>
        <button type="button" className="om-pri" onClick={() => setDialog({ type: 'kit', kitId: null })}>Start a kit</button>
      </PageHead>

      <section aria-labelledby="shelf" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 id="shelf" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>On the shelf</h2>
        <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {data.stock.map((s) => {
            const low = s.on_hand <= s.reorder_at;
            const pct = Math.min(100, Math.round((s.on_hand / Math.max(1, s.reorder_at * 3)) * 100));
            return (
              <button key={s.item} type="button" onClick={() => setDialog({ type: 'stock', item: s })} title="Edit count"
                style={{ width: '100%', minWidth: 0, textAlign: 'left', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', background: 'var(--shell)', cursor: 'pointer', color: 'var(--text)', fontFamily: "'Manrope', sans-serif", display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: low ? 'var(--amber)' : 'var(--green)' }}>{low ? 'REORDER' : 'OK'}</span>
                </span>
                <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{s.on_hand}</span>
                <span style={{ height: 5, borderRadius: 3, background: 'var(--line-soft)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: low ? 'var(--amber)' : 'var(--accent)' }} /></span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Reorder at {s.reorder_at} · {ITEM_USE[s.item] || ''}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="kits" style={{ display: isPhone ? 'none' : undefined, border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}><h2 id="kits" style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Kits</h2></div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
          <thead>
            <tr>
              <th style={{ ...th, paddingLeft: 18, width: 200 }}>RESTAURANT</th>
              <th style={{ ...th, width: 110 }}>TAGS</th>
              <th style={th}>EACH TAG</th>
              <th style={th}>PROGRESS</th>
              <th style={{ ...th, paddingRight: 18, width: 170 }}><span style={{ position: 'absolute', left: -9999 }}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.kits.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No kits yet. Start one up top.</td></tr>}
            {data.kits.map((k) => {
              const n = k.tags.length;
              const steps = ['WRITTEN', 'PACKED', k.delivery === 'mail' ? 'MAILED' : 'HANDED OFF', 'DELIVERED', 'PLACED'];
              return (
                <tr key={k.id}>
                  <td style={{ ...td, paddingLeft: 18 }}>
                    <Link href={`/admin/restaurants/${k.restaurant_id}`} style={{ fontWeight: 800, color: 'var(--text)' }}>{k.restaurant}</Link>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{KIND[k.kind]} · {k.delivery === 'mail' ? 'mail' : 'hand delivered'} · {shortDate(k.created_at)}</span>
                  </td>
                  <td style={td}><span style={{ fontWeight: 700 }}>{n}</span></td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {k.tags.map((t) => (
                        <span key={t.id} title={`${t.label}: ${STAGES[t.stage][0]}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 11, border: '1px solid var(--line)', borderRadius: 12, padding: '2px 8px' }}>
                          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: STAGES[t.stage][1], border: `1.5px solid ${STAGES[t.stage][2]}` }} />
                          {t.label}
                          <span style={{ position: 'absolute', left: -9999 }}>{STAGES[t.stage][0]}</span>
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{k.next.text}{k.tracking ? ` · ${k.carrier || ''} ${k.tracking}` : ''}</div>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {steps.map((label, j) => {
                        const done = k.tags.filter((t) => t.stage >= j + 1).length;
                        const full = n && done === n;
                        return (
                          <span key={label} style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', borderRadius: 5, padding: '3px 6px',
                            background: full ? 'var(--accent-tint)' : done ? 'var(--amber-tint)' : 'var(--panel)', color: full ? 'var(--accent-deep)' : done ? 'var(--amber)' : 'var(--muted)' }}>
                            {label}{done ? ` ${full ? '✓' : `${done}/${n}`}` : ''}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ ...td, paddingRight: 18, textAlign: 'right' }}>
                    {k.next.step
                      ? <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => setDialog({ type: 'kit', kitId: k.id })}>Continue kit</button>
                      : k.delivery === 'mail' && k.sent_at && !k.delivered_at
                        ? <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={busy} onClick={() => act({ action: 'delivered', kitId: k.id })}>Mark delivered</button>
                        : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line-soft)', display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
          {STAGES.map(([t, bg, b]) => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: bg, border: `1.5px solid ${b}` }} />{t}</span>)}
        </div>
      </section>

      <section aria-labelledby="field" style={{ display: isPhone ? 'none' : undefined, border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 id="field" style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Tags in the field</h2>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>The first tap on a new tag asks where it is. A tag nobody taps for 3 days turns red.</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
          <thead>
            <tr>
              <th style={{ ...th, paddingLeft: 18 }}>TAG</th><th style={th}>RESTAURANT</th><th style={th}>SPOT</th><th style={th}>LAST TAP</th><th style={th}>TAPS · 7 DAYS</th>
              <th style={{ ...th, paddingRight: 18 }}><span style={{ position: 'absolute', left: -9999 }}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.field.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No live tags yet.</td></tr>}
            {data.field.map((t) => {
              const stale = t.status === 'active' && (!t.last_tap_at || Date.now() - new Date(t.last_tap_at).getTime() > 3 * 86400000);
              const total = t.week.reduce((a, b) => a + b, 0);
              const peak = Math.max(1, ...t.week);
              return (
                <tr key={t.id} style={{ opacity: t.status === 'off' ? 0.55 : 1 }}>
                  <td style={{ ...td, paddingLeft: 18, fontFamily: MONO, fontWeight: 600 }}>{t.label}{t.status === 'off' && <span style={{ marginLeft: 6 }}><Chip>OFF</Chip></span>}</td>
                  <td style={td}>{t.restaurant}</td>
                  <td style={{ ...td, color: t.spot ? 'var(--text)' : 'var(--amber)', fontWeight: t.spot ? 500 : 700 }}>{t.spot || 'Not placed yet'}</td>
                  <td style={{ ...td, color: stale ? 'var(--red)' : 'var(--muted)', fontFamily: MONO, fontSize: 12 }}>{t.last_tap_at ? new Date(t.last_tap_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'}</td>
                  <td style={td}>
                    <div aria-label={`${total} taps in 7 days`} style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22 }}>
                      {t.week.map((n, i) => <span key={i} style={{ width: 6, borderRadius: 1, height: Math.max(2, (n / peak) * 22), background: i === 6 ? 'var(--accent)' : 'var(--line)' }} />)}
                      <span style={{ fontFamily: MONO, fontSize: 12, marginLeft: 6 }}>{total}</span>
                    </div>
                  </td>
                  <td style={{ ...td, paddingRight: 18, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {t.spot && <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} disabled={busy} onClick={() => act({ action: 'clear-spot', tagId: t.id })}>Ask spot again</button>}{' '}
                    <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} disabled={busy} onClick={() => act({ action: 'tag-status', tagId: t.id, status: t.status === 'off' ? 'active' : 'off' })}>{t.status === 'off' ? 'Turn on' : 'Turn off'}</button>{' '}
                    <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} onClick={() => setDialog({ type: 'kit', kitId: null, preset: { restaurantId: t.restaurant_id, kind: 'replacement' } })}>Replace</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-label="Kits in progress" style={{ display: isPhone ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Kits in progress</h2>
        {data.kits.length === 0 && <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, color: 'var(--muted)', fontSize: 13 }}>No kits yet. Start one above.</div>}
        {data.kits.map((k) => {
          const n = k.tags.length;
          const steps = ['Written', 'Packed', k.delivery === 'mail' ? 'Mailed' : 'Handed off', 'Delivered', 'Placed'];
          return (
            <article key={k.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, background: 'var(--shell)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/admin/restaurants/${k.restaurant_id}`} style={{ color: 'var(--text)', fontWeight: 800, textDecoration: 'none' }}>{k.restaurant}</Link>
                  <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 12 }}>{KIND[k.kind]} · {k.delivery === 'mail' ? 'Mail' : 'Hand delivered'} · {shortDate(k.created_at)}</div>
                </div>
                <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{n} tags</span>
              </div>
              <div aria-label="Kit progress" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 4 }}>
                {steps.map((name, i) => {
                  const done = n > 0 && k.tags.filter((t) => t.stage >= i + 1).length === n;
                  return <span key={name} title={name} style={{ height: 6, borderRadius: 4, background: done ? 'var(--accent)' : 'var(--line)' }} />;
                })}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{k.next.text}{k.tracking ? ` · ${k.carrier || ''} ${k.tracking}` : ''}</div>
              {k.next.step
                ? <button type="button" className="om-btn" style={{ minHeight: 40, justifyContent: 'center' }} onClick={() => setDialog({ type: 'kit', kitId: k.id })}>Continue kit</button>
                : k.delivery === 'mail' && k.sent_at && !k.delivered_at
                  ? <button type="button" className="om-btn" style={{ minHeight: 40, justifyContent: 'center' }} disabled={busy} onClick={() => act({ action: 'delivered', kitId: k.id })}>Mark delivered</button>
                  : null}
            </article>
          );
        })}
      </section>

      <section aria-label="Tags in the field" style={{ display: isPhone ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Tags in the field</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5 }}>The first tap on a new tag asks where it is. A tag nobody taps for 3 days turns red.</p>
        {data.field.length === 0 && <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, color: 'var(--muted)', fontSize: 13 }}>No live tags yet.</div>}
        {data.field.map((t) => {
          const stale = t.status === 'active' && (!t.last_tap_at || Date.now() - new Date(t.last_tap_at).getTime() > 3 * 86400000);
          const lastTap = t.last_tap_at ? new Date(t.last_tap_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never';
          return (
            <article key={t.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, background: 'var(--shell)', display: 'flex', flexDirection: 'column', gap: 8, opacity: t.status === 'off' ? 0.55 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontFamily: MONO }}>{t.label}</strong>
                {t.status === 'off' && <Chip>OFF</Chip>}
              </div>
              <div style={{ fontWeight: 700 }}>{t.restaurant}</div>
              <div style={{ color: t.spot ? 'var(--muted)' : 'var(--amber)', fontSize: 13 }}>{t.spot || 'Not placed yet'}</div>
              <div style={{ fontFamily: MONO, fontSize: 11.5, color: stale ? 'var(--red)' : 'var(--muted)' }}>Last tap · {lastTap}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {t.spot && <button type="button" className="om-btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => act({ action: 'clear-spot', tagId: t.id })}>Ask spot again</button>}
                <button type="button" className="om-btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => act({ action: 'tag-status', tagId: t.id, status: t.status === 'off' ? 'active' : 'off' })}>{t.status === 'off' ? 'Turn on' : 'Turn off'}</button>
                <button type="button" className="om-btn" style={{ minHeight: 40 }} onClick={() => setDialog({ type: 'kit', kitId: null, preset: { restaurantId: t.restaurant_id, kind: 'replacement' } })}>Replace</button>
              </div>
            </article>
          );
        })}
      </section>

      {dialog?.type === 'kit' && <KitDialog kitId={dialog.kitId} preset={dialog.preset} data={data} onClose={() => { setDialog(null); load(); }} />}
      {dialog?.type === 'sell' && <SellDialog data={data} onClose={() => setDialog(null)} onMade={(kitId) => { load(); setDialog({ type: 'kit', kitId }); }} />}
      {dialog?.type === 'restock' && <RestockDialog stock={data.stock} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.type === 'stock' && <StockDialog item={dialog.item} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </>
  );
}

const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 };

function Choice({ on, onClick, title, sub }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      style={{ flex: '1 1 180px', textAlign: 'left', minHeight: 44, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: "'Manrope', sans-serif", color: 'var(--text)', border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-tint)' : 'var(--shell)' }}>
      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{title}</span>
      {sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{sub}</span>}
    </button>
  );
}

const WIZ = ['Details', 'Write tags', 'Pack', 'Ship'];
const PACK = ['Each tag has its OM number on the back', 'Tags pressed into the foam insert', 'Intro card in the box', 'Magnets or adhesive pads in the box', 'Box closed'];

function KitDialog({ kitId: startId, preset, data, onClose }) {
  const isPhone = useIsPhone();
  const { adminFetch } = useAdminFetch();
  const [kitId, setKitId] = useState(startId);
  const [kit, setKit] = useState(null);
  const [step, setStep] = useState(startId ? null : 1);
  const [form, setForm] = useState({ restaurantId: preset?.restaurantId || data.restaurants[0]?.id || '', kind: preset?.kind || 'plan', delivery: 'mail', shipTo: '', notes: '' });
  const [pack, setPack] = useState(PACK.map(() => false));
  const [ship, setShip] = useState({ carrier: 'USPS', tracking: '', postage: '' });
  const [shipFrom, setShipFrom] = useState(data.settings.ship_from || '');
  const [askCancel, setAskCancel] = useState(false);

  const loadKit = useCallback(async (id, jump) => {
    const res = await adminFetch(`/api/admin/tags?kit=${id}`);
    const json = await res.json();
    if (res.ok) {
      setKit(json);
      if (jump) setStep(json.next.step || 4);
    }
  }, [adminFetch]);
  const { act, busy, err } = useAct();

  useEffect(() => { if (startId) loadKit(startId, true); }, [startId, loadKit]);

  // While writing, check every few seconds for your test taps.
  useEffect(() => {
    if (step !== 2 || !kitId) return;
    const t = setInterval(() => loadKit(kitId, false), 4000);
    return () => clearInterval(t);
  }, [step, kitId, loadKit]);

  async function create() {
    const json = await act({ action: 'create-kit', ...form });
    if (json) { setKitId(json.kitId); await loadKit(json.kitId, false); setStep(2); }
  }
  async function run(body, nextStep) {
    const json = await act({ kitId, ...body });
    if (json) { await loadKit(kitId, false); if (nextStep) setStep(nextStep); }
    return json;
  }

  const tags = kit?.tags || [];
  const allConfirmed = tags.length > 0 && tags.every((t) => t.confirmed_at);
  const isMail = kit ? kit.kit.delivery === 'mail' : form.delivery === 'mail';
  const title = kit ? `${kit.restaurant?.name || ''} · ${KIND[kit.kit.kind]}` : 'Start a kit';

  return (
    <Dialog title={title} onClose={onClose} width={680} fullScreen>
      {step == null ? <LoadingState /> : (
        <>
          <ol aria-label="Steps" style={{ display: 'flex', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
            {WIZ.map((w, i) => (
              <li key={w} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ height: 4, borderRadius: 2, background: i + 1 <= step ? 'var(--accent)' : 'var(--line)' }} />
                <span style={{ fontSize: 12, fontWeight: i + 1 === step ? 800 : 600, color: i + 1 === step ? 'var(--text)' : 'var(--muted)' }}>{i + 1}. {i === 3 && !isMail ? 'Hand off' : w}</span>
              </li>
            ))}
          </ol>

          {step === 1 && (
            <>
              <label style={label}>Restaurant
                <select className="om-field" value={form.restaurantId} onChange={(e) => setForm({ ...form, restaurantId: e.target.value })}>
                  {data.restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <div role="radiogroup" aria-label="Kit" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Choice on={form.kind === 'plan'} onClick={() => setForm({ ...form, kind: 'plan' })} title="Plan kit" sub={`3 tags, included in the plan · costs you ${money(data.settings.kit_cost)}`} />
                <Choice on={form.kind === 'replacement'} onClick={() => setForm({ ...form, kind: 'replacement' })} title="Replacement tag" sub={`1 tag for a lost or broken one · ${money(data.settings.tag_cost)}`} />
              </div>
              <div role="radiogroup" aria-label="Delivery" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Choice on={form.delivery === 'mail'} onClick={() => setForm({ ...form, delivery: 'mail' })} title="Mail it" sub="Print a 4 × 6 label at the end" />
                <Choice on={form.delivery === 'hand'} onClick={() => setForm({ ...form, delivery: 'hand' })} title="Hand deliver" sub="Bring it on your next visit" />
              </div>
              {form.delivery === 'mail' && (
                <label style={label}>Mail to<textarea className="om-field" rows={3} value={form.shipTo} onChange={(e) => setForm({ ...form, shipTo: e.target.value })} placeholder={'Owner name\nStreet\nTown, NJ 07000'} style={{ padding: '8px 10px' }} /></label>
              )}
              <label style={label}>Note (optional)<input className="om-field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ background: 'var(--panel)', borderRadius: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}>
                <b>For each tag, in the NFC Tools app:</b>
                <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  <li>Write → Add a record → URL, and paste the tag’s link below.</li>
                  <li>Tap Write and hold the tag to the top of your phone.</li>
                  <li>Other → Lock tag, so nobody can rewrite it. This can’t be undone.</li>
                  <li>Tap the tag again with your camera or NFC reader. This page turns it to confirmed on its own.</li>
                  <li>Write the OM number on the back.</li>
                </ol>
              </div>
              {tags.map((t) => {
                const s = t.confirmed_at ? ['CONFIRMED ✓', 'var(--green-tint)', 'var(--green)'] : t.written_at ? ['WAITING FOR TEST TAP', 'var(--amber-tint)', 'var(--amber)'] : ['NOT WRITTEN', 'var(--panel)', 'var(--muted)'];
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                    <span style={{ fontFamily: MONO, fontWeight: 700, width: 70 }}>{t.label}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, flex: '1 1 220px' }}>https://{t.url}</span>
                    <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => navigator.clipboard?.writeText(`https://${t.url}`)}>Copy link</button>
                    {isPhone && t.written_at && !t.confirmed_at ? (
                      <div style={{ flex: '1 1 100%', border: '1px solid var(--amber)', borderRadius: 12, padding: 18, background: 'var(--amber-tint)', textAlign: 'center', color: 'var(--text)' }}>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>Waiting for a tap…</div>
                        <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--muted)' }}>Tap this tag with your phone to confirm it.</div>
                      </div>
                    ) : <Chip bg={s[1]} fg={s[2]}>{s[0]}</Chip>}
                    {!t.written_at && !t.confirmed_at && <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={busy} onClick={() => run({ action: 'mark-written', tagId: t.id })}>I wrote it</button>}
                    {t.written_at && !t.confirmed_at && <button type="button" onClick={() => run({ action: 'confirm', tagId: t.id })} disabled={busy} style={{ border: 0, background: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Confirm without a tap</button>}
                  </div>
                );
              })}
            </>
          )}

          {step === 3 && (
            <>
              {PACK.map((p, i) => (
                <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '6px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none' }}>
                  <input type="checkbox" checked={pack[i]} onChange={() => setPack(pack.map((v, j) => (j === i ? !v : v)))} style={{ width: 18, height: 18 }} />
                  {p}
                  {i === 2 && <a href={`/admin/tags/print/${kitId}?kind=card`} target="_blank" rel="noopener noreferrer" className="om-btn" style={{ minHeight: 28, marginLeft: 'auto', fontSize: 12 }}>Print intro card</a>}
                </label>
              ))}
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>Finishing this step takes the kit’s tags, box, foam and card off the shelf count.</p>
            </>
          )}

          {step === 4 && kit && (
            kit.kit.sent_at ? (
              <div style={{ fontSize: 14 }}>{isMail ? `Mailed ${shortDate(kit.kit.sent_at)}${kit.kit.tracking ? ` · ${kit.kit.carrier || ''} ${kit.kit.tracking}` : ''}. Mark it delivered from the Kits table when it arrives; the tags go live then.` : 'Handed off. The tags are live.'}</div>
            ) : isMail ? (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ ...label, flex: '1 1 240px' }}>From (your return address)
                    <textarea className="om-field" rows={3} value={shipFrom} onChange={(e) => setShipFrom(e.target.value)} onBlur={() => shipFrom !== data.settings.ship_from && act({ action: 'save-setting', key: 'ship_from', value: shipFrom })} style={{ padding: '8px 10px' }} />
                  </label>
                  <div style={{ ...label, flex: '1 1 240px' }}>To
                    <div style={{ whiteSpace: 'pre-wrap', fontWeight: 500, fontSize: 13.5, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', minHeight: 70 }}>{kit.kit.ship_to}</div>
                  </div>
                </div>
                <a href={`/admin/tags/print/${kitId}?kind=label`} target="_blank" rel="noopener noreferrer" className="om-pri" style={{ alignSelf: 'flex-start' }}>Print 4 × 6 label</a>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>This is the address label. Postage is bought separately (Pirate Ship or USPS Click-N-Ship both print 4 × 6), then paste the tracking number and cost here.</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ ...label, flex: '0 1 120px' }}>Carrier
                    <select className="om-field" value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })}>{['USPS', 'UPS', 'FedEx', 'Other'].map((c) => <option key={c}>{c}</option>)}</select>
                  </label>
                  <label style={{ ...label, flex: '1 1 200px' }}>Tracking number<input className="om-field" value={ship.tracking} onChange={(e) => setShip({ ...ship, tracking: e.target.value })} /></label>
                  <label style={{ ...label, flex: '0 1 120px' }}>Postage $<input className="om-field" inputMode="decimal" value={ship.postage} onChange={(e) => setShip({ ...ship, postage: e.target.value })} /></label>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>Bring the box on your next visit. When you hand it over, tap <b>Handed off</b>. The tags go live right away, and the first tap on each one asks staff where it sits.</div>
            )
          )}

          {err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', ...(isPhone ? { position: 'sticky', bottom: 0, marginTop: 'auto', paddingTop: 10, background: 'var(--shell)' } : {}) }}>
            <div>
              {kit && !kit.kit.packed_at && (
                <button type="button" onClick={() => setAskCancel(true)}
                  style={{ border: 0, background: 'none', color: 'var(--red)', fontSize: 12.5, cursor: 'pointer' }}>Cancel kit</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {step > 2 && !(step === 4 && kit?.kit.sent_at) && !(step === 4 && kit?.kit.packed_at) && <button type="button" className="om-btn" onClick={() => setStep(step - 1)}>Back</button>}
              <button type="button" className="om-btn" onClick={onClose}>{step === 4 && kit?.kit.sent_at ? 'Close' : 'Save and close'}</button>
              {step === 1 && <button type="button" className="om-pri" disabled={busy || !form.restaurantId} onClick={create}>{busy ? 'Creating…' : 'Next: write tags'}</button>}
              {step === 2 && <button type="button" className="om-pri" disabled={!allConfirmed} onClick={() => setStep(3)}>{allConfirmed ? 'Next: pack' : 'Confirm every tag to continue'}</button>}
              {step === 3 && <button type="button" className="om-pri" disabled={busy || !pack.every(Boolean)} onClick={() => run({ action: 'pack' }, 4)}>{pack.every(Boolean) ? 'Next: ship' : 'Check everything off'}</button>}
              {step === 4 && kit && !kit.kit.sent_at && (isMail
                ? <button type="button" className="om-pri" disabled={busy} onClick={async () => { if (await run({ action: 'ship', ...ship })) onClose(); }}>Mark mailed</button>
                : <button type="button" className="om-pri" disabled={busy} onClick={async () => { if (await run({ action: 'handoff' })) onClose(); }}>Handed off</button>)}
            </div>
          </div>
        </>
      )}
      {askCancel && <Confirm title="Delete this kit?" sub="Its tags are deleted. Nothing has come off the shelf yet." yes="Delete kit" danger busy={busy} onClose={() => setAskCancel(false)} onYes={async () => { if (await act({ action: 'cancel-kit', kitId })) onClose(); setAskCancel(false); }} />}
    </Dialog>
  );
}

function SellDialog({ data, onClose, onMade }) {
  const [restaurantId, setRestaurantId] = useState(data.restaurants[0]?.id || '');
  const [qty, setQty] = useState(2);
  const [price, setPrice] = useState(data.settings.extra_tag_price != null ? String(data.settings.extra_tag_price) : '');
  const [payment, setPayment] = useState('card');
  const [delivery, setDelivery] = useState('hand');
  const [shipTo, setShipTo] = useState('');
  const { act, busy, err } = useAct();
  const total = qty * (Number(price) || 0);

  async function go() {
    if (String(price) !== String(data.settings.extra_tag_price ?? '')) await act({ action: 'save-setting', key: 'extra_tag_price', value: Number(price) });
    const json = await act({ action: 'sell', restaurantId, qty, price: Number(price), payment, delivery, shipTo });
    if (json) onMade(json.kitId);
  }

  return (
    <Dialog title="Sell extra tags" sub="Creates the tags as an add-on kit, then takes you straight to writing them." onClose={onClose} width={560}>
      <label style={label}>Restaurant
        <select className="om-field" value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
          {data.restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={label}>How many
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="om-btn" aria-label="One fewer" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
            <span style={{ fontSize: 18, fontWeight: 800, minWidth: 24, textAlign: 'center' }}>{qty}</span>
            <button type="button" className="om-btn" aria-label="One more" onClick={() => setQty(Math.min(20, qty + 1))}>+</button>
          </div>
        </div>
        <label style={{ ...label, width: 140 }}>Price per tag $<input className="om-field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Set once" /></label>
        <div style={{ fontSize: 15, fontWeight: 800, paddingBottom: 8 }}>Total {money(total)}</div>
      </div>
      <div role="radiogroup" aria-label="Payment" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Choice on={payment === 'card'} onClick={() => setPayment('card')} title="Charge their card on file" sub="Charged now through Stripe" />
        <Choice on={payment === 'invoice'} onClick={() => setPayment('invoice')} title="Add to their next bill" sub="Shows as a line on next month’s charge" />
        <Choice on={payment === 'paid'} onClick={() => setPayment('paid')} title="Already paid" sub="Cash or check" />
      </div>
      <div role="radiogroup" aria-label="Delivery" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Choice on={delivery === 'hand'} onClick={() => setDelivery('hand')} title="Hand deliver" />
        <Choice on={delivery === 'mail'} onClick={() => setDelivery('mail')} title="Mail it" />
      </div>
      {delivery === 'mail' && <label style={label}>Mail to<textarea className="om-field" rows={3} value={shipTo} onChange={(e) => setShipTo(e.target.value)} style={{ padding: '8px 10px' }} /></label>}
      {err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !restaurantId || price === '' || (delivery === 'mail' && !shipTo.trim())} onClick={go}>
          {busy ? 'Working…' : payment === 'card' ? `Charge ${money(total)} and write tags` : 'Create and write tags'}
        </button>
      </div>
    </Dialog>
  );
}

function RestockDialog({ stock, onClose, onDone }) {
  const [item, setItem] = useState(stock[0]?.item || 'tags');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const { act, busy, err } = useAct(onDone);
  return (
    <Dialog title="Log a restock" sub="Adds to the shelf count. The cost goes on your expenses." onClose={onClose}>
      <label style={label}>Item<select className="om-field" value={item} onChange={(e) => setItem(e.target.value)}>{stock.map((s) => <option key={s.item} value={s.item}>{s.name}</option>)}</select></label>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...label, flex: 1 }}>How many came in<input className="om-field" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label style={{ ...label, flex: 1 }}>Total cost $<input className="om-field" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      </div>
      <label style={label}>Where from (optional)<input className="om-field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Amazon order, supplier…" /></label>
      {err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !(parseInt(qty, 10) > 0)} onClick={() => act({ action: 'restock', item, qty, cost, note })}>Add to shelf</button>
      </div>
    </Dialog>
  );
}

function StockDialog({ item, onClose, onDone }) {
  const [onHand, setOnHand] = useState(String(item.on_hand));
  const [reorderAt, setReorderAt] = useState(String(item.reorder_at));
  const { act, busy, err } = useAct(onDone);
  return (
    <Dialog title={item.name} sub="Fix the count after a hand count. Use Log a restock when new stock comes in." onClose={onClose}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...label, flex: 1 }}>On hand<input className="om-field" inputMode="numeric" value={onHand} onChange={(e) => setOnHand(e.target.value)} /></label>
        <label style={{ ...label, flex: 1 }}>Reorder at<input className="om-field" inputMode="numeric" value={reorderAt} onChange={(e) => setReorderAt(e.target.value)} /></label>
      </div>
      {err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy} onClick={() => act({ action: 'set-stock', item: item.item, onHand, reorderAt })}>Save</button>
      </div>
    </Dialog>
  );
}

export default function Page() {
  return (
    <AdminShell section="Restaurants" sub="Tag kits" title="Tag kits">
      <TagsPage />
    </AdminShell>
  );
}