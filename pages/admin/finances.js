// pages/admin/finances.js
// Expenses & deadlines for OptiMenu Solutions LLC: what you spend (with the
// receipt), your monthly run rate, a CSV for taxes, and the dates you
// cannot miss. Repeating deadlines add their next date when marked done.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminShell, { PageHead, Dialog, Confirm } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import useIsPhone from '../../lib/admin/useIsPhone';
import supabase from '../../lib/supabaseClient';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Pills, Card, th, td, money, shortDate } from '../../components/admin/ui';

const CATS = ['Hosting', 'AI', 'Email', 'Software', 'App stores', 'Hardware', 'Shipping', 'Legal & filings', 'Marketing', 'Other'];
const REP = { one_time: 'One time', monthly: 'Monthly', yearly: 'Yearly', usage: 'Usage' };
const DL_REP = { none: 'Once', monthly: 'Every month', yearly: 'Every year' };
const TONE = { late: ['var(--red-tint)', 'var(--red)'], soon: ['var(--amber-tint)', 'var(--amber)'], later: ['var(--panel)', 'var(--muted)'], done: ['var(--green-tint)', 'var(--green)'] };
const monthName = (m) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(new Date(m + '-15T12:00:00Z'));
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

function dueLabel(d, today) {
  if (d.status === 'done') return ['DONE', 'done'];
  if (!d.due_on) return ['NO DATE', 'later'];
  const n = daysBetween(today, d.due_on);
  if (n < 0) return [`LATE · ${shortDate(d.due_on).toUpperCase()}`, 'late'];
  if (n === 0) return ['TODAY', 'soon'];
  if (n === 1) return ['TOMORROW', 'soon'];
  return [shortDate(d.due_on).toUpperCase() + (d.due_on.slice(0, 4) !== today.slice(0, 4) ? ` ${d.due_on.slice(0, 4)}` : ''), n <= 7 ? 'soon' : 'later'];
}

function FinancesPage() {
  const { adminFetch } = useAdminFetch();
  const isPhone = useIsPhone();
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(null);
  const [cat, setCat] = useState('All');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [expense, setExpense] = useState(null); // {} new, or a row to edit
  const [deadline, setDeadline] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [mobileView, setMobileView] = useState('expenses');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch(`/api/admin/business/finances${year ? `?year=${year}` : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load expenses');
      setData(json);
      setMonth((m) => m || (json.year === json.today.slice(0, 4) ? json.month : `${json.year}-12`));
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch, year]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body) => {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/business/finances', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      if (json.message) setFlash(json.message);
      await load();
      return json;
    } catch (e) {
      setFlash(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [adminFetch, load]);

  const months = useMemo(() => {
    if (!data) return [];
    const last = data.year === data.today.slice(0, 4) ? Number(data.month.slice(5)) : 12;
    return Array.from({ length: last }, (_, i) => `${data.year}-${String(last - i).padStart(2, '0')}`);
  }, [data]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading expenses…" />;

  const inMonth = data.expenses.filter((e) => e.spent_on.slice(0, 7) === month);
  const cats = ['All', ...new Set(inMonth.map((e) => e.category))];
  const shown = inMonth.filter((e) => cat === 'All' || e.category === cat);
  const rateTotal = data.runRate.reduce((a, r) => a + r.perMonth, 0);
  const rateByCat = Object.entries(data.runRate.reduce((m, r) => ({ ...m, [r.category]: (m[r.category] || 0) + r.perMonth }), {})).sort((a, b) => b[1] - a[1]);
  const open = data.deadlines.filter((d) => d.status !== 'done');
  const done = data.deadlines.filter((d) => d.status === 'done').sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
  const nextLabel = data.next ? dueLabel(data.next, data.today)[0] : '—';

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Vendor', 'Category', 'Repeats', 'Amount', 'Receipt', 'Note'], ...[...data.expenses].reverse().map((e) => [e.spent_on, e.vendor, e.category, REP[e.repeats], e.amount.toFixed(2), e.has_receipt ? 'Yes' : 'Missing', e.note || ''])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `optimenu-expenses-${data.year}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const viewReceipt = async (id) => {
    const win = window.open('', '_blank');
    const json = await post({ action: 'receipt-view', id });
    if (json?.url && win) win.location.href = json.url;
    else if (win) win.close();
  };

  if (isPhone) {
    return (
      <>
        <PageHead kicker="BUSINESS · OPTIMENU SOLUTIONS LLC" title="Expenses & deadlines">
          <div role="group" aria-label="Choose year" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="om-btn" aria-label="Previous year" disabled={Number(data.year) <= Number(data.today.slice(0, 4)) - 3} onClick={() => { setData(null); setMonth(null); setCat('All'); setYear(String(Number(data.year) - 1)); }} style={{ width: 40, minHeight: 40, padding: 0, justifyContent: 'center' }}>‹</button>
            <strong style={{ minWidth: 54, textAlign: 'center' }}>{data.year}</strong>
            <button type="button" className="om-btn" aria-label="Next year" disabled={Number(data.year) >= Number(data.today.slice(0, 4))} onClick={() => { setData(null); setMonth(null); setCat('All'); setYear(String(Number(data.year) + 1)); }} style={{ width: 40, minHeight: 40, padding: 0, justifyContent: 'center' }}>›</button>
          </div>
        </PageHead>

        {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}
        {data.stripeError && <div style={{ background: 'var(--red-tint)', color: 'var(--red)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>Stripe did not answer: {data.stripeError}. Plans and money below may be missing.</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <div style={{ minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, padding: 11 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)' }}>SPENT · {monthName(month).toUpperCase()}</div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{money(data.spentMonth)}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{data.countMonth} expense{data.countMonth === 1 ? '' : 's'}</div>
          </div>
          <div style={{ minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, padding: 11 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)' }}>MONTHLY RUN RATE</div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{money(rateTotal)}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Recurring monthly estimate</div>
          </div>
        </div>

        <div role="group" aria-label="Choose expenses or deadlines" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, padding: 4, borderRadius: 12, background: 'var(--panel)' }}>
          {[
            ['expenses', 'Expenses'],
            ['deadlines', 'Deadlines'],
          ].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={mobileView === key} onClick={() => setMobileView(key)} style={{ minHeight: 42, border: 0, borderRadius: 9, background: mobileView === key ? 'var(--text)' : 'transparent', color: mobileView === key ? 'var(--shell)' : 'var(--muted)', font: "700 14px 'Manrope',sans-serif" }}>
              {label}
            </button>
          ))}
        </div>

        {mobileView === 'expenses' ? (
          <>
            <button type="button" className="om-pri" onClick={() => setExpense({})} style={{ width: '100%', minHeight: 44, justifyContent: 'center' }}>+ Expense</button>

            <div style={{ display: 'grid', gap: 8 }}>
              <div role="group" aria-label="Choose month" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: '1px solid var(--line)', borderRadius: 12, padding: '6px 8px' }}>
                <button type="button" className="om-btn" aria-label="Previous month" disabled={months.indexOf(month) >= months.length - 1} onClick={() => { setMonth(months[months.indexOf(month) + 1]); setCat('All'); }} style={{ width: 40, minHeight: 40, padding: 0, justifyContent: 'center' }}>‹</button>
                <strong style={{ minWidth: 0, textAlign: 'center' }}>{monthName(month)} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {inMonth.length}</span></strong>
                <button type="button" className="om-btn" aria-label="Next month" disabled={months.indexOf(month) <= 0} onClick={() => { setMonth(months[months.indexOf(month) - 1]); setCat('All'); }} style={{ width: 40, minHeight: 40, padding: 0, justifyContent: 'center' }}>›</button>
              </div>
              {cats.length > 2 && <Pills label="Category" value={cat} onChange={setCat} options={cats.map((c) => ({ key: c, label: c }))} />}
            </div>

            {shown.length === 0 && <Card><div style={{ color: 'var(--muted)', fontSize: 13 }}>No expenses logged for {monthName(month)}.</div></Card>}
            {shown.map((e) => (
              <Card key={e.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{e.vendor}</strong>
                    <div style={{ marginTop: 3, fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                      {shortDate(e.spent_on)} · {e.category} · {REP[e.repeats]}
                    </div>
                    {e.note && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{e.note}</div>}
                  </div>
                  <strong style={{ flexShrink: 0, fontFamily: MONO }}>{money(e.amount)}</strong>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {e.has_receipt
                    ? <button type="button" className="om-btn" onClick={() => viewReceipt(e.id)}>📎 Receipt</button>
                    : <button type="button" className="om-btn" aria-label={`Add receipt for ${e.vendor}`} onClick={() => setExpense({ ...e, pickReceipt: true })} style={{ color: 'var(--amber)' }}>! Add receipt</button>}
                  {e.repeats !== 'one_time' && <button type="button" className="om-btn" onClick={() => setExpense({ ...e, id: null, spent_on: data.today, receipt_path: null, has_receipt: false, again: true })}>Log again</button>}
                  <button type="button" className="om-btn" onClick={() => setExpense(e)}>Edit</button>
                </div>
              </Card>
            ))}
            {shown.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 2px', fontWeight: 800 }}>
                <span>Total</span><span style={{ fontFamily: MONO }}>{money(shown.reduce((a, e) => a + e.amount, 0))}</span>
              </div>
            )}

            <button type="button" className="om-btn" onClick={exportCsv} disabled={!data.expenses.length} style={{ width: '100%', minHeight: 44, justifyContent: 'center' }}>Export CSV for taxes</button>
          </>
        ) : (
          <>
            <Card title="Deadlines" right={<button type="button" className="om-btn" onClick={() => setDeadline({})}>Add deadline</button>}>
              {open.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing coming up.</div>}
              {open.map((d) => {
                const [label, tone] = dueLabel(d, data.today);
                return (
                  <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
                    <input type="checkbox" aria-label={`Mark ${d.title} done`} disabled={busy} onChange={() => post({ action: 'deadline-done', id: d.id })} style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }} />
                    <button type="button" onClick={() => setDeadline(d)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', font: "500 13.5px 'Manrope',sans-serif" }}>
                      <b style={{ overflowWrap: 'anywhere' }}>{d.title}</b>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{[d.note, d.repeats !== 'none' ? DL_REP[d.repeats] : null].filter(Boolean).join(' · ')}</span>
                    </button>
                    <Chip bg={TONE[tone][0]} fg={TONE[tone][1]}>{label}</Chip>
                  </div>
                );
              })}
              {done.length > 0 && (
                <>
                  <button type="button" onClick={() => setShowDone(!showDone)} style={{ border: 0, background: 'none', padding: '8px 0 0', textAlign: 'left', cursor: 'pointer', color: 'var(--accent-deep)', font: "600 12.5px 'Manrope',sans-serif" }}>{showDone ? 'Hide' : 'Show'} done ({done.length})</button>
                  {showDone && done.slice(0, 20).map((d) => (
                    <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13, color: 'var(--muted)' }}>
                      <span style={{ flex: 1, minWidth: 0, textDecoration: 'line-through', overflowWrap: 'anywhere' }}>{d.title}</span>
                      <button type="button" className="om-btn" disabled={busy} onClick={() => post({ action: 'deadline-reopen', id: d.id })}>Reopen</button>
                    </div>
                  ))}
                </>
              )}
            </Card>

            <Card title="Monthly run rate" right={<span style={{ fontFamily: MONO, fontWeight: 700 }}>{money(rateTotal)}</span>}>
              {rateByCat.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Log monthly, yearly or usage bills and they add up here.</div>}
              {rateByCat.map(([category, amount]) => (
                <div key={category} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{category} <span style={{ color: 'var(--muted)', fontSize: 12 }}>· {data.runRate.filter((r) => r.category === category).map((r) => r.vendor).join(', ')}</span></span>
                  <span style={{ flexShrink: 0, fontFamily: MONO }}>{money(amount)}</span>
                </div>
              ))}
            </Card>
          </>
        )}

        {expense && <ExpenseDialog e={expense} today={data.today} busy={busy} onClose={() => setExpense(null)} post={post} adminFetch={adminFetch} />}
        {deadline && <DeadlineDialog d={deadline} busy={busy} onClose={() => setDeadline(null)} post={post} />}
      </>
    );
  }

  return (
    <>
      <PageHead kicker="BUSINESS · OPTIMENU SOLUTIONS LLC" title="Expenses & deadlines">
        <select className="om-field" aria-label="Year" style={{ width: 100 }} value={data.year} onChange={(e) => { setData(null); setMonth(null); setCat('All'); setYear(e.target.value); }}>
          {Array.from({ length: 4 }, (_, i) => String(Number(data.today.slice(0, 4)) - i)).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" className="om-btn" onClick={exportCsv} disabled={!data.expenses.length}>Export CSV for taxes</button>
        <button type="button" className="om-pri" onClick={() => setExpense({})}>Add expense</button>
      </PageHead>
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {[
          { k: `SPENT · ${monthName(data.month).toUpperCase()}`, v: money(data.spentMonth), s: `${data.countMonth} expense${data.countMonth === 1 ? '' : 's'}${data.missingMonth ? ` · ${data.missingMonth} receipt${data.missingMonth === 1 ? '' : 's'} missing` : ''}` },
          { k: 'MONTHLY RUN RATE', v: money(rateTotal), s: 'Monthly bills, yearly ones ÷ 12, last month’s usage' },
          { k: `YEAR TO DATE · ${data.year}`, v: money(data.ytd), s: `${data.expenses.length} expenses logged` },
          { k: 'NEXT DEADLINE', v: data.next ? nextLabel.replace(/^LATE · /, 'Late') : 'None', s: data.next ? data.next.title : 'Add one on the right', tone: data.next && dueLabel(data.next, data.today)[1] === 'late' ? 'var(--red)' : undefined },
        ].map((x) => (
          <div key={x.k} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>{x.k}</div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4, color: x.tone || 'var(--text)', textTransform: 'capitalize' }}>{x.v}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{x.s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <Card title={`Expenses · ${monthName(month)} ${data.year}`} style={{ flex: '2 1 560px' }} right={
          <select className="om-field" aria-label="Month" style={{ width: 150, minHeight: 32 }} value={month} onChange={(e) => { setMonth(e.target.value); setCat('All'); }}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)} ({data.expenses.filter((e) => e.spent_on.slice(0, 7) === m).length})</option>)}
          </select>
        }>
          {cats.length > 2 && <Pills label="Category" value={cat} onChange={setCat} options={cats.map((c) => ({ key: c, label: c }))} />}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead><tr><th style={th}>DATE</th><th style={th}>VENDOR</th><th style={th}>CATEGORY</th><th style={th}>REPEATS</th><th style={th}>RECEIPT</th><th style={{ ...th, textAlign: 'right' }}>AMOUNT</th><th style={th} /></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No expenses logged for {monthName(month)}.</td></tr>}
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...td, fontFamily: MONO, fontSize: 12.5 }}>{shortDate(e.spent_on)}</td>
                    <td style={td}><b>{e.vendor}</b>{e.note && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{e.note}</span>}</td>
                    <td style={{ ...td, fontSize: 12.5 }}>{e.category}</td>
                    <td style={{ ...td, fontSize: 12.5, color: 'var(--muted)' }}>{REP[e.repeats]}</td>
                    <td style={td}>
                      {e.has_receipt
                        ? <button type="button" onClick={() => viewReceipt(e.id)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}><Chip bg="var(--green-tint)" fg="var(--green)">ATTACHED ↗</Chip></button>
                        : <button type="button" onClick={() => setExpense(e)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}><Chip bg="var(--red-tint)" fg="var(--red)">MISSING · ADD</Chip></button>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{money(e.amount)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {e.repeats !== 'one_time' && <><button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} onClick={() => setExpense({ ...e, id: null, spent_on: data.today, receipt_path: null, has_receipt: false, again: true })}>Log again</button>{' '}</>}
                      <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} onClick={() => setExpense(e)}>Edit</button>
                    </td>
                  </tr>
                ))}
                {shown.length > 0 && <tr><td colSpan={5} style={{ ...td, fontWeight: 800 }}>Total</td><td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontWeight: 800 }}>{money(shown.reduce((a, e) => a + e.amount, 0))}</td><td style={td} /></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <Card title="Deadlines" right={<button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => setDeadline({})}>Add deadline</button>}>
            {open.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing coming up.</div>}
            {open.map((d) => {
              const [label, tone] = dueLabel(d, data.today);
              return (
                <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <input type="checkbox" aria-label={`Mark ${d.title} done`} disabled={busy} onChange={() => post({ action: 'deadline-done', id: d.id })} style={{ width: 18, height: 18, marginTop: 2 }} />
                  <button type="button" onClick={() => setDeadline(d)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', font: "500 13.5px 'Manrope',sans-serif" }}>
                    <b>{d.title}</b>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{[d.note, d.repeats !== 'none' ? DL_REP[d.repeats] : null].filter(Boolean).join(' · ')}</span>
                  </button>
                  <Chip bg={TONE[tone][0]} fg={TONE[tone][1]}>{label}</Chip>
                </div>
              );
            })}
            {done.length > 0 && (
              <>
                <button type="button" onClick={() => setShowDone(!showDone)} style={{ border: 0, background: 'none', padding: '6px 0 0', textAlign: 'left', cursor: 'pointer', color: 'var(--accent-deep)', font: "600 12.5px 'Manrope',sans-serif" }}>{showDone ? 'Hide' : 'Show'} done ({done.length})</button>
                {showDone && done.slice(0, 20).map((d) => (
                  <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13, color: 'var(--muted)' }}>
                    <span style={{ flex: 1, textDecoration: 'line-through' }}>{d.title}</span>
                    <button type="button" className="om-btn" style={{ minHeight: 26, fontSize: 11.5 }} disabled={busy} onClick={() => post({ action: 'deadline-reopen', id: d.id })}>Reopen</button>
                  </div>
                ))}
              </>
            )}
          </Card>

          <Card title="Monthly run rate" right={<span style={{ fontFamily: MONO, fontWeight: 700 }}>{money(rateTotal)}</span>}>
            {rateByCat.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Log monthly, yearly or usage bills and they add up here.</div>}
            {rateByCat.map(([c, amt]) => (
              <div key={c}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{c} <span style={{ color: 'var(--muted)', fontSize: 12 }}>· {data.runRate.filter((r) => r.category === c).map((r) => r.vendor).join(', ')}</span></span>
                  <span style={{ fontFamily: MONO }}>{money(amt)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--panel)', marginTop: 4 }}>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--accent-deep)', width: `${rateTotal ? (amt / rateTotal) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      {expense && <ExpenseDialog e={expense} today={data.today} busy={busy} onClose={() => setExpense(null)} post={post} adminFetch={adminFetch} />}
      {deadline && <DeadlineDialog d={deadline} busy={busy} onClose={() => setDeadline(null)} post={post} />}
    </>
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

function ExpenseDialog({ e, today, busy, onClose, post, adminFetch }) {
  const isPhone = useIsPhone();
  const receiptInput = useRef(null);
  const [f, setF] = useState({ spent_on: e.spent_on || today, vendor: e.vendor || '', category: e.category || 'Hosting', repeats: e.repeats || 'one_time', amount: e.amount != null ? String(e.amount) : '', note: e.note || '' });
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!e.pickReceipt) return undefined;
    const timer = setTimeout(() => receiptInput.current?.click(), 0);
    return () => clearTimeout(timer);
  }, [e.pickReceipt]);

  const save = async () => {
    setErr('');
    let receipt_path = e.receipt_path || null;
    if (file) {
      setUploading(true);
      try {
        const res = await adminFetch('/api/admin/business/finances', { method: 'POST', body: JSON.stringify({ action: 'receipt-upload', name: file.name }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not start the upload');
        const { error } = await supabase.storage.from('admin-receipts').uploadToSignedUrl(json.path, json.token, file);
        if (error) throw new Error(error.message);
        receipt_path = json.path;
      } catch (x) {
        setErr(`Receipt upload failed: ${x.message}`);
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    const ok = await post({ action: 'expense-save', id: e.id || undefined, ...f, receipt_path });
    if (ok) onClose();
  };

  return (
    <Dialog title={e.id ? 'Edit expense' : e.again ? `Log ${e.vendor} again` : 'Add an expense'} onClose={onClose} width={520}>
      <div style={{ display: isPhone ? 'grid' : 'flex', gridTemplateColumns: isPhone ? 'minmax(0, 1fr)' : undefined, gap: 10 }}>
        <Field label="Date"><input className="om-field" type="date" value={f.spent_on} onChange={(x) => set('spent_on', x.target.value)} /></Field>
        <Field label="Amount"><input className="om-field" inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(x) => set('amount', x.target.value)} /></Field>
      </div>
      <Field label="Vendor"><input className="om-field" autoFocus={!e.id} value={f.vendor} onChange={(x) => set('vendor', x.target.value)} placeholder="e.g. Vercel" /></Field>
      <div style={{ display: isPhone ? 'grid' : 'flex', gridTemplateColumns: isPhone ? 'minmax(0, 1fr)' : undefined, gap: 10 }}>
        <Field label="Category">
          <input className="om-field" list="om-cats" value={f.category} onChange={(x) => set('category', x.target.value)} />
          <datalist id="om-cats">{CATS.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Repeats">
          <select className="om-field" value={f.repeats} onChange={(x) => set('repeats', x.target.value)}>
            {Object.entries(REP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Note (optional)"><input className="om-field" value={f.note} onChange={(x) => set('note', x.target.value)} /></Field>
      <Field label={e.receipt_path ? 'Receipt (attached; pick a file to replace it)' : 'Take photo or choose a receipt'}>
        <input ref={receiptInput} type="file" accept="image/*,application/pdf" capture={isPhone ? 'environment' : undefined} onChange={(x) => setFile(x.target.files?.[0] || null)} />
      </Field>
      {err && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: isPhone ? 'column-reverse' : 'row', justifyContent: 'space-between', alignItems: isPhone ? 'stretch' : 'center', gap: 8 }}>
        {e.id
          ? <button type="button" className="om-btn" style={isPhone ? { width: '100%', minHeight: 44, justifyContent: 'center', color: 'var(--red)' } : { color: 'var(--red)' }} disabled={busy} onClick={() => setAskDel(true)}>Delete</button>
          : <span />}
        <span style={{ display: 'flex', flexDirection: isPhone ? 'column-reverse' : 'row', gap: 8, width: isPhone ? '100%' : undefined }}>
          <button type="button" className="om-btn" onClick={onClose} style={isPhone ? { width: '100%', minHeight: 44, justifyContent: 'center' } : undefined}>Cancel</button>
          <button type="button" className="om-pri" disabled={busy || uploading || !f.vendor.trim() || f.amount === ''} onClick={save} style={isPhone ? { width: '100%', minHeight: 44, justifyContent: 'center' } : undefined}>{uploading ? 'Uploading…' : busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      {askDel && <Confirm title={`Delete ${e.vendor} ${money(e.amount)}?`} sub="The expense and its receipt are removed." yes="Delete expense" danger busy={busy} onClose={() => setAskDel(false)} onYes={async () => { if (await post({ action: 'expense-delete', id: e.id })) onClose(); setAskDel(false); }} />}
    </Dialog>
  );
}

function DeadlineDialog({ d, busy, onClose, post }) {
  const [f, setF] = useState({ title: d.title || '', note: d.note || '', due_on: d.due_on || '', repeats: d.repeats || 'none' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [askDel, setAskDel] = useState(false);
  return (
    <Dialog title={d.id ? 'Edit deadline' : 'Add a deadline'} sub="Shows on Today when it is a week away." onClose={onClose}>
      <Field label="What"><input className="om-field" autoFocus value={f.title} onChange={(x) => set('title', x.target.value)} placeholder="e.g. NJ annual report" /></Field>
      <Field label="Note (optional)"><input className="om-field" value={f.note} onChange={(x) => set('note', x.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Due"><input className="om-field" type="date" value={f.due_on} onChange={(x) => set('due_on', x.target.value)} /></Field>
        <Field label="Repeats">
          <select className="om-field" value={f.repeats} onChange={(x) => set('repeats', x.target.value)}>
            {Object.entries(DL_REP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        {d.id ? <button type="button" className="om-btn" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => setAskDel(true)}>Delete</button> : <span />}
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="om-pri" disabled={busy || !f.title.trim()} onClick={async () => { if (await post({ action: 'deadline-save', id: d.id || undefined, ...f })) onClose(); }}>{busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      {askDel && <Confirm title={`Delete ${d.title}?`} sub={d.repeats !== 'none' ? 'Its future repeats stop too.' : undefined} yes="Delete deadline" danger busy={busy} onClose={() => setAskDel(false)} onYes={async () => { if (await post({ action: 'deadline-delete', id: d.id })) onClose(); setAskDel(false); }} />}
    </Dialog>
  );
}

export default function Page() {
  return (
    <AdminShell section="Business" sub="Expenses & deadlines" title="Expenses & deadlines">
      <FinancesPage />
    </AdminShell>
  );
}