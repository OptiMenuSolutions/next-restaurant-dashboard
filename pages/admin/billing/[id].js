// pages/admin/billing/[id].js
// Client billing: everything money-related for one restaurant. What they
// pay, what they have cost you month by month, payments, one-off costs and
// the billing actions (comp, refund, cancel, email the owner).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { Dialog, Confirm } from '../../../components/admin/AdminShell';
import { useAdminFetch } from '../../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../../components/client/ClientChrome';
import { Chip, Card, th, td, money, shortDate } from '../../../components/admin/ui';

const REASONS = ['Too expensive', 'Not using it enough', 'Closed or sold the restaurant', 'Switched POS', 'Missing a feature they need', 'Other'];
const PAY_TONE = { PAID: 'var(--green)', FAILED: 'var(--red)', DUE: 'var(--amber)', REFUNDED: 'var(--amber)', CREDIT: 'var(--accent-deep)' };
const BILLING_LINK = 'https://www.opti-menu.com/client/billing';

function BillingPage({ id }) {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch(`/api/admin/billing/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load billing');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch, id]);
  useEffect(() => { load(); }, [load]);

  async function act(body) {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch(`/api/admin/billing/${id}/action`, { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      if (json.message) setFlash(json.message);
      setDialog(null);
      await load();
      return true;
    } catch (e) {
      setFlash(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading billing…" />;

  const { restaurant: r, stripe: st, failed, total, months } = data;
  const peak = Math.max(1, ...months.map((m) => Math.max(m.paid, m.cost)));
  const stripeUrl = st.customerId ? `https://dashboard.stripe.com/customers/${st.customerId}` : null;
  const statusChip = failed ? ['PAYMENT FAILED', 'var(--red-tint)', 'var(--red)']
    : st.cancelAtPeriodEnd ? ['CANCELS AT PERIOD END', 'var(--amber-tint)', 'var(--amber)']
    : st.status === 'active' ? ['PAYING', 'var(--green-tint)', 'var(--green)']
    : [String(st.status || r.subscription_status || 'NO PLAN').replace(/_/g, ' ').toUpperCase(), 'var(--panel)', 'var(--muted)'];

  return (
    <>
      <Link href={`/admin/restaurants/${r.id}`} style={{ fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>← {r.name}</Link>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flex: '1 1 360px' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--muted)' }}>CLIENT BILLING</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{r.name}</h1>
            <Chip bg={statusChip[1]} fg={statusChip[2]}>{statusChip[0]}</Chip>
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>
            {data.facts[0][1]} · customer since {shortDate(r.created_at)}, {new Date(r.created_at).getFullYear()} · <Link href={`/admin/restaurants/${r.id}`} style={{ fontWeight: 700 }}>Open restaurant page</Link>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {stripeUrl && <a className="om-btn" href={stripeUrl} target="_blank" rel="noopener noreferrer">Open in Stripe ↗</a>}
          <button type="button" className="om-btn" disabled={busy || !st.subscriptionId || !data.perMonth} onClick={() => setAsk({ title: `Comp a month for ${r.name}?`, sub: `Adds a ${money(data.perMonth)} credit to their Stripe balance. Their next invoice uses it first.`, yes: `Credit ${money(data.perMonth)}`, body: { action: 'comp-month' } })}>Comp a month</button>
          <button type="button" className="om-btn" disabled={busy || !data.refundable.length} onClick={() => setDialog('refund')}>Refund</button>
          {st.subscriptionId && <a className="om-btn" href={`https://dashboard.stripe.com/subscriptions/${st.subscriptionId}`} target="_blank" rel="noopener noreferrer">Change plan ↗</a>}
          <button type="button" className="om-btn" disabled={busy} onClick={() => setDialog('email')}>Email the owner</button>
          <button type="button" className="om-btn" disabled={busy || st.cancelAtPeriodEnd || r.closed} onClick={() => setDialog('cancel')} style={{ color: 'var(--red)' }}>Cancel plan</button>
        </div>
      </div>

      {flash && <div style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}
      {st.subMissing && <div style={{ background: 'var(--panel)', color: 'var(--muted)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>No live Stripe subscription. The subscription ID saved for {r.name} is not in Stripe (often an old test-mode ID), so comp and plan changes are off. Comped accounts look like this.</div>}
      {st.error && <div style={{ background: 'var(--amber-tint)', color: 'var(--amber)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>Stripe could not be read: {st.error}</div>}

      {failed && (
        <div style={{ background: 'var(--red-tint)', borderRadius: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>
            <b style={{ color: 'var(--red)' }}>Payment of {money(failed.amount)} failed on {shortDate(failed.date)}.</b> {failed.why}
            {failed.nextRetry ? ` Stripe retries on its own ${shortDate(failed.nextRetry)}.` : ' No more automatic retries.'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="om-btn" onClick={() => { navigator.clipboard?.writeText(BILLING_LINK); setFlash('Update-card link copied. It opens their Billing page after they sign in.'); }}>Copy update-card link</button>
            <button type="button" className="om-pri" onClick={() => setDialog('email')}>Email the owner</button>
          </div>
        </div>
      )}

      <section aria-label="Client numbers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {[
          ['PAYS YOU / MO', money(data.perMonth), data.facts[0][1], 'var(--text)'],
          ['PAID SO FAR', money(total.paid), `${months.filter((m) => m.paid > 0).length} of ${months.length} months paid`, 'var(--text)'],
          ['COST SO FAR', money(total.cost), 'AI, hosting, fees, one-offs, refunds', 'var(--text)'],
          ['PROFIT SO FAR', money(total.profit), total.paid ? `${Math.round((total.profit / total.paid) * 100)}% margin` : 'No revenue yet', total.profit < 0 ? 'var(--red)' : 'var(--green)'],
          ['OWED NOW', money(data.owed), data.owed ? 'Open invoices' : 'Nothing owed', data.owed ? 'var(--red)' : 'var(--text)'],
        ].map(([k, v, s, c]) => (
          <div key={k} style={{ padding: '14px 18px', borderRight: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s}</div>
          </div>
        ))}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'stretch' }}>
        <Card title="What they paid vs what they cost, by month" style={{ flex: '2 1 560px' }}
          right={<span style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)' }}><Legend c="var(--accent)" t="Paid" /><Legend c="var(--amber)" t="Cost" /></span>}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 170, borderBottom: '1px solid var(--line)', padding: '0 8px', overflowX: 'auto' }}>
            {months.map((m) => (
              <div key={m.key} tabIndex={0} className="om-mbar" aria-label={`${m.label}: paid ${money(m.paid)}, cost ${money(m.cost)}`} style={{ position: 'relative', flex: '1 0 44px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', outline: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
                  <span style={{ width: 18, borderRadius: '3px 3px 0 0', background: 'var(--accent)', height: Math.max(2, (m.paid / peak) * 140) }} />
                  <span style={{ width: 18, borderRadius: '3px 3px 0 0', background: 'var(--amber)', height: Math.max(2, (m.cost / peak) * 140) }} />
                </div>
                <span className="om-tip">
                  <b style={{ display: 'block', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', opacity: 0.75 }}>{m.label.toUpperCase()}</b>
                  Paid {money(m.paid)}<br />Cost {money(m.cost)}<br /><b>Profit {money(m.profit)}</b>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, padding: '0 8px', fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>
            {months.map((m) => <span key={m.key} style={{ flex: '1 0 44px', textAlign: 'center' }}>{m.label.slice(0, 3).toUpperCase()}</span>)}
          </div>
          <style>{'.om-tip{display:none;position:absolute;z-index:5;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);width:160px;background:var(--text);color:var(--shell);font:500 12px/1.5 Manrope,sans-serif;padding:9px 11px;border-radius:8px;pointer-events:none}.om-mbar:hover .om-tip,.om-mbar:focus .om-tip{display:block}'}</style>
        </Card>

        <Card title="Plan and payment" style={{ flex: '1 1 320px' }}>
          {data.facts.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </Card>
      </div>

      <section aria-label="Profit and loss by month" style={{ border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Profit and loss by month</h2>
          <button type="button" className="om-btn" style={{ minHeight: 32 }} onClick={() => exportCsv(r.name, months, total)}>Export CSV</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
          <thead>
            <tr>
              {['MONTH', 'PAID', 'AI', 'HOSTING SHARE', 'STRIPE FEE', 'ONE-OFF COSTS', 'REFUNDS', 'PROFIT', 'MARGIN'].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i ? 'right' : 'left', paddingLeft: i ? 8 : 18, paddingRight: i === 8 ? 18 : 8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...months, { ...total, key: 'total', label: 'Total so far', isTotal: true }].map((m) => (
              <tr key={m.key} style={{ background: m.isTotal ? 'var(--panel)' : 'transparent', fontWeight: m.isTotal ? 700 : 400 }}>
                <td style={{ ...td, paddingLeft: 18 }}>{m.label}</td>
                {[m.paid, -m.ai, -m.host, -m.fee, -m.oneoff, -m.refunds].map((v, i) => (
                  <td key={i} style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, color: i ? 'var(--muted)' : 'var(--text)' }}>{v ? money(v) : '—'}</td>
                ))}
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: m.profit < 0 ? 'var(--red)' : 'var(--green)' }}>{money(m.profit)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, color: 'var(--muted)', paddingRight: 18 }}>{m.paid > 0 ? `${Math.round((m.profit / m.paid) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line-soft)', fontSize: 12, color: 'var(--muted)' }}>
          Hosting share is your monthly hosting cost split across {data.liveCount} live restaurant{data.liveCount === 1 ? '' : 's'} ({money(data.hostShare)} each). Stripe fees are the real fees Stripe took. One-off costs count in the month they were spent.
        </div>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <section style={{ flex: '1 1 520px', minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Payments</h2></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ ...th, paddingLeft: 18 }}>DATE</th><th style={th}>WHAT</th><th style={th}>STATUS</th>
                <th style={{ ...th, textAlign: 'right' }}>AMOUNT</th><th style={{ ...th, textAlign: 'right', paddingRight: 18 }}>RECEIPT</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No payments yet.</td></tr>}
              {data.payments.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...td, paddingLeft: 18, fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{shortDate(p.ts)}</td>
                  <td style={td}>{p.what}</td>
                  <td style={td}><span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', color: PAY_TONE[p.status] || 'var(--muted)' }}>{p.status}</span></td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5 }}>{money(p.amount)}</td>
                  <td style={{ ...td, textAlign: 'right', paddingRight: 18 }}>{p.receipt ? <a href={p.receipt} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, fontSize: 12.5 }}>View</a> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={{ flex: '1 1 420px', minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>One-off costs for this client</h2>
            <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => setDialog('cost')}>Add a cost</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
            <thead>
              <tr><th style={{ ...th, paddingLeft: 18 }}>DATE</th><th style={th}>WHAT</th><th style={{ ...th, textAlign: 'right' }}>AMOUNT</th><th style={{ ...th, paddingRight: 18 }} /></tr>
            </thead>
            <tbody>
              {data.oneoffs.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', padding: 20, color: 'var(--muted)' }}>None yet. Tag kits land here once Tag kits is built.</td></tr>}
              {data.oneoffs.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...td, paddingLeft: 18, fontFamily: MONO, fontSize: 12, color: 'var(--muted)' }}>{shortDate(o.date)}</td>
                  <td style={td}>{o.what}{o.source && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{o.source}</span>}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12.5 }}>{money(o.amount)}</td>
                  <td style={{ ...td, paddingRight: 18, textAlign: 'right' }}>
                    <button type="button" aria-label={`Delete ${o.what}`} onClick={() => setAsk({ title: `Delete ${o.what}?`, sub: `${money(o.amount)} from ${shortDate(o.date)} comes off their costs.`, yes: 'Delete cost', danger: true, body: { action: 'delete-cost', costId: o.id } })} style={{ border: 0, background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {dialog === 'cancel' && <CancelDialog name={r.name} busy={busy} onClose={() => setDialog(null)} onSave={(v) => act({ action: 'cancel', ...v })} />}
      {dialog === 'refund' && <RefundDialog charges={data.refundable} busy={busy} onClose={() => setDialog(null)} onSave={(v) => act({ action: 'refund', ...v })} />}
      {dialog === 'email' && <EmailDialog r={r} owner={data.owner} failed={failed} busy={busy} onClose={() => setDialog(null)} onSave={(v) => act({ action: 'email', ...v })} />}
      {dialog === 'cost' && <CostDialog kitCost={data.kitCost} busy={busy} onClose={() => setDialog(null)} onSave={(v) => act({ action: 'add-cost', ...v })} />}
      {ask && <Confirm title={ask.title} sub={ask.sub} yes={ask.yes} danger={ask.danger} busy={busy} onClose={() => setAsk(null)} onYes={async () => { await act(ask.body); setAsk(null); }} />}
    </>
  );
}

function Legend({ c, t }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{t}</span>;
}

function exportCsv(name, months, total) {
  const head = ['Month', 'Paid', 'AI', 'Hosting share', 'Stripe fee', 'One-off costs', 'Refunds', 'Profit'];
  const line = (m) => [m.label, m.paid, m.ai, m.host, m.fee, m.oneoff, m.refunds, m.profit].map((v, i) => (i ? Number(v).toFixed(2) : `"${v}"`)).join(',');
  const csv = [head.join(','), ...months.map(line), line({ ...total, label: 'Total' })].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-billing.csv`;
  a.click();
}

function Choice({ on, onClick, children }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      style={{ textAlign: 'left', minHeight: 40, padding: '6px 12px', borderRadius: 10, cursor: 'pointer', font: "600 13.5px 'Manrope', sans-serif", color: 'var(--text)', border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--accent-tint)' : 'var(--shell)' }}>
      {children}
    </button>
  );
}

const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 };

function CancelDialog({ name, busy, onClose, onSave }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('end');
  return (
    <Dialog title={`Cancel ${name}?`} sub="Why are they leaving? It feeds the cancellation numbers on Revenue." onClose={onClose}>
      <div role="radiogroup" aria-label="Reason" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {REASONS.map((x) => <Choice key={x} on={reason === x} onClick={() => setReason(x)}>{x}</Choice>)}
      </div>
      <label style={label}>Note (optional)<input className="om-field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did they say?" /></label>
      <div role="radiogroup" aria-label="When" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Choice on={when === 'end'} onClick={() => setWhen('end')}><b style={{ display: 'block' }}>At the end of this period</b><span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>They keep access until their paid month runs out</span></Choice>
        <Choice on={when === 'now'} onClick={() => setWhen('now')}><b style={{ display: 'block' }}>Right away</b><span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Access stops today. Refund separately if needed.</span></Choice>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Keep their plan</button>
        <button type="button" disabled={busy} onClick={() => onSave({ reason, note, when })} style={{ minHeight: 36, padding: '0 16px', borderRadius: 18, border: 0, background: 'var(--red)', font: "700 12.5px 'Manrope', sans-serif", color: '#fff', cursor: 'pointer' }}>{busy ? 'Cancelling…' : 'Cancel plan'}</button>
      </div>
    </Dialog>
  );
}

function RefundDialog({ charges, busy, onClose, onSave }) {
  const [chargeId, setChargeId] = useState(charges[0]?.id);
  const pick = charges.find((c) => c.id === chargeId);
  const [amount, setAmount] = useState(pick ? pick.amount.toFixed(2) : '');
  return (
    <Dialog title="Refund a payment" sub="The money goes back to the card it came from." onClose={onClose}>
      <div role="radiogroup" aria-label="Payment" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {charges.map((c) => (
          <Choice key={c.id} on={chargeId === c.id} onClick={() => { setChargeId(c.id); setAmount(c.amount.toFixed(2)); }}>
            {shortDate(c.date)} · {money(c.amount)} refundable
          </Choice>
        ))}
      </div>
      <label style={label}>Amount<input className="om-field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !pick || !(Number(amount) > 0)} onClick={() => onSave({ chargeId, amount: Number(amount) })}>{busy ? 'Refunding…' : `Refund ${money(Number(amount) || 0)}`}</button>
      </div>
    </Dialog>
  );
}

function EmailDialog({ r, owner, failed, busy, onClose, onSave }) {
  const first = String(owner?.name || '').split(/\s+/)[0] || 'there';
  const [subject, setSubject] = useState(failed ? 'Your OptiMenu payment did not go through' : `OptiMenu · ${r.name}`);
  const [message, setMessage] = useState(failed
    ? `Hi ${first},\n\nYour OptiMenu payment of ${money(failed.amount)} did not go through${failed.why ? ` (${failed.why.replace(/\.$/, '').toLowerCase()})` : ''}. You can update your card here:\n\n${BILLING_LINK}\n\nIf anything looks off, just reply to this email.\n\nThanks,`
    : `Hi ${first},\n\n`);
  return (
    <Dialog title="Email the owner" sub={owner ? `To ${owner.email}` : 'No owner email on file'} onClose={onClose} width={560}>
      <label style={label}>Subject<input className="om-field" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label style={label}>Message<textarea className="om-field" rows={9} value={message} onChange={(e) => setMessage(e.target.value)} style={{ padding: '8px 10px', resize: 'vertical' }} /></label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !owner || !subject.trim() || !message.trim()} onClick={() => onSave({ subject, message })}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </Dialog>
  );
}

function CostDialog({ kitCost, busy, onClose, onSave }) {
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('');
  return (
    <Dialog title="Add a cost" sub="Something you spent on this client. It counts in the month you spent it." onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => { setWhat('Tag kit'); setAmount(String(kitCost)); }}>Tag kit · {money(kitCost)}</button>
        <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => setWhat('Postage')}>Postage</button>
      </div>
      <label style={label}>What<input className="om-field" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Tag kit, postage, a site visit…" /></label>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...label, flex: 1 }}>Amount<input className="om-field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label style={{ ...label, flex: 1 }}>Date<input className="om-field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <label style={label}>Detail (optional)<input className="om-field" value={source} onChange={(e) => setSource(e.target.value)} placeholder="USPS Ground Advantage" /></label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !what.trim() || !(Number(amount) > 0)} onClick={() => onSave({ what, amount: Number(amount), date, source })}>{busy ? 'Saving…' : 'Add cost'}</button>
      </div>
    </Dialog>
  );
}

export default function Page() {
  const { id } = useRouter().query;
  return (
    <AdminShell section="Business" sub="Revenue & billing" title="Client billing">
      {id ? <BillingPage id={id} /> : <LoadingState />}
    </AdminShell>
  );
}