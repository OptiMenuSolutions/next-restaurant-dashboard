// pages/admin/testimonials.js
// Testimonials: quotes saved from the Support inbox (or added here), with
// whether you have asked to use them and whether they said yes, plus proof
// points from Tonight's Dish results. Ask before anything goes on the website.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell, { PageHead, Dialog, Confirm } from '../../components/admin/AdminShell';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Chip, Pills, Card, shortDate } from '../../components/admin/ui';

const ST = {
  'not asked': ['NOT ASKED', 'var(--panel)', 'var(--muted)'],
  asked: ['ASKED · WAITING', 'var(--amber-tint)', 'var(--amber)'],
  yes: ['OK TO USE', 'var(--green-tint)', 'var(--green)'],
  no: ['SAID NO', 'var(--red-tint)', 'var(--red)'],
};

function askText(q) {
  const first = String(q.person || '').split(/[\s,]+/)[0] || 'there';
  return `Hi ${first}, you mentioned this a little while back:\n\n“${q.quote}”\n\nWould you be OK with me putting that on the OptiMenu website, with your name and ${q.restaurant || 'your restaurant'}? Totally fine to say no.\n\nNick`;
}

function TestimonialsPage() {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/sales/testimonials');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load testimonials');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  const post = async (body, ok) => {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/sales/testimonials', { method: 'POST', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      if (ok) setFlash(ok);
      await load();
      return true;
    } catch (e) {
      setFlash(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); setFlash(ok); } catch { setFlash('Your browser blocked the clipboard.'); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading testimonials…" />;

  const n = (k) => data.quotes.filter((q) => q.permission === k).length;
  const quotes = data.quotes.filter((q) => filter === 'all' || q.permission === filter);

  return (
    <>
      <PageHead kicker="SALES" title="Testimonials" sub="Quotes saved from the Support inbox, and results you can point to. Ask before anything goes on the website.">
        <button type="button" className="om-pri" onClick={() => setEdit({})}>Add a quote</button>
      </PageHead>
      <Pills label="Filter" value={filter} onChange={setFilter} options={[
        { key: 'all', label: 'All', n: data.quotes.length }, { key: 'not asked', label: 'Not asked', n: n('not asked') },
        { key: 'asked', label: 'Waiting', n: n('asked') }, { key: 'yes', label: 'OK to use', n: n('yes') }, { key: 'no', label: 'Said no', n: n('no') },
      ]} />
      {flash && <div role="status" style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}>{flash}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {quotes.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>No quotes here yet. In the Support inbox, use Save as testimonial on a message.</div>}
        {quotes.map((q) => {
          const [label, bg, fg] = q.on_website ? ['ON THE WEBSITE', 'var(--green-tint)', 'var(--green)'] : ST[q.permission] || ST['not asked'];
          return (
            <article key={q.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>{shortDate(q.created_at).toUpperCase()}{q.thread_id ? ' · SUPPORT' : ' · ADDED BY HAND'}</span>
                <Chip bg={bg} fg={fg}>{label}</Chip>
              </div>
              <blockquote style={{ margin: 0, fontSize: 15, lineHeight: 1.5, fontWeight: 600 }}>“{q.quote}”</blockquote>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {[q.person, q.restaurant].filter(Boolean).join(', ') || 'No name yet'}
                {q.thread_id && <> · <Link href={`/admin/support?thread=${q.thread_id}`} style={{ color: 'var(--accent-deep)' }}>Open the message</Link></>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {q.permission === 'not asked' && <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={busy} onClick={async () => { await copy(askText(q), 'Copied a request you can send them. Marked as asked.'); post({ action: 'permission', id: q.id, permission: 'asked' }); }}>Ask permission</button>}
                {q.permission === 'asked' && <>
                  <button type="button" className="om-pri" style={{ minHeight: 30 }} disabled={busy} onClick={() => post({ action: 'permission', id: q.id, permission: 'yes' })}>They said yes</button>
                  <button type="button" className="om-btn" style={{ minHeight: 30 }} disabled={busy} onClick={() => post({ action: 'permission', id: q.id, permission: 'no' })}>They said no</button>
                </>}
                {q.permission === 'yes' && (
                  <button type="button" aria-pressed={!!q.on_website} className="om-btn" style={{ minHeight: 30, borderColor: q.on_website ? 'var(--green)' : 'var(--line)', color: q.on_website ? 'var(--green)' : 'var(--text)' }} disabled={busy}
                    onClick={() => post({ action: 'website', id: q.id, on: !q.on_website })}>{q.on_website ? 'On the website ✓' : 'Mark as on the website'}</button>
                )}
                <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => copy(`“${q.quote}”${q.person ? ` (${[q.person, q.restaurant].filter(Boolean).join(', ')})` : ''}`, 'Quote copied.')}>Copy quote</button>
                <button type="button" className="om-btn" style={{ minHeight: 30 }} onClick={() => setEdit(q)}>Edit</button>
              </div>
            </article>
          );
        })}
      </div>

      <Card title="Proof points">
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -4 }}>Tonight’s Dish picks that sold at least 15% above a typical night for that weekday, last 30 nights. A restaurant’s name stays hidden until one of its quotes is OK to use.</div>
        {data.proofError && <div style={{ fontSize: 13, color: 'var(--red)' }}>{data.proofError}</div>}
        {data.proof.length === 0 && !data.proofError && <div style={{ fontSize: 13, color: 'var(--muted)' }}>None yet. These need POS sales and a few weeks of picks.</div>}
        {data.proof.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--line-soft)' }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: 'var(--green)', width: 64 }}>+{Math.round(p.lift * 100)}%</span>
            <span style={{ flex: 1, fontSize: 13.5 }}>{p.text}</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)' }}>{shortDate(p.when)}</span>
            <button type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} onClick={() => copy(p.text, 'Copied.')}>Copy</button>
          </div>
        ))}
      </Card>

      {edit && <EditDialog q={edit} restaurants={data.restaurants} busy={busy} onClose={() => setEdit(null)} post={post} />}
    </>
  );
}

function EditDialog({ q, restaurants, busy, onClose, post }) {
  const [f, setF] = useState({ quote: q.quote || '', person: q.person || '', restaurant_id: q.restaurant_id || '' });
  const [askDel, setAskDel] = useState(false);
  const label = (t) => <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>{t}</span>;
  return (
    <Dialog title={q.id ? 'Edit quote' : 'Add a quote'} onClose={onClose} width={540}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{label('QUOTE')}<textarea className="om-field" rows={4} autoFocus value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} style={{ padding: 8, resize: 'vertical' }} /></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{label('WHO SAID IT')}<input className="om-field" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} placeholder="Name, role" /></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{label('RESTAURANT')}
        <select className="om-field" value={f.restaurant_id} onChange={(e) => setF({ ...f, restaurant_id: e.target.value })}>
          <option value="">None</option>
          {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        {q.id ? <button type="button" className="om-btn" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => setAskDel(true)}>Delete</button> : <span />}
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="om-pri" disabled={busy || !f.quote.trim()} onClick={async () => { if (await post({ action: 'save', id: q.id || undefined, ...f })) onClose(); }}>{busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      {askDel && <Confirm title="Delete this quote?" sub={q.quote.length > 120 ? `${q.quote.slice(0, 120)}…` : q.quote} yes="Delete quote" danger busy={busy} onClose={() => setAskDel(false)} onYes={async () => { if (await post({ action: 'delete', id: q.id })) onClose(); setAskDel(false); }} />}
    </Dialog>
  );
}

export default function Page() {
  return (
    <AdminShell section="Sales" sub="Testimonials" title="Testimonials">
      <TestimonialsPage />
    </AdminShell>
  );
}