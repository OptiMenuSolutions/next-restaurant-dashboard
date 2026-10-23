// pages/admin/support.js
// Support inbox. Left: conversations, newest activity first. Middle: the
// conversation, with saved replies and a box that replies by email, logs an
// answer they sent by email, or adds a private note. Right: the restaurant,
// so you can see what they are dealing with while you answer.
//
// /admin/support?restaurant=<id> opens with that restaurant filtered and a
// new message ready to write.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell, { Dialog } from '../../components/admin/AdminShell';
import useIsPhone from '../../lib/admin/useIsPhone';
import { useAdminFetch } from '../../lib/admin/useAdminFetch';
import { MONO, ErrorState, LoadingState } from '../../components/client/ClientChrome';
import { Dot, StatusChip, Chip, Pills, shortDate, HEALTH_WORD } from '../../components/admin/ui';

const KINDS = ['general', 'bug', 'feature', 'invoice', 'billing', 'praise', 'other'];
const STATUS = { new: ['NEEDS YOU', 'var(--accent-tint)', 'var(--accent-deep)'], waiting: ['WAITING ON THEM', 'var(--amber-tint)', 'var(--amber)'], done: ['DONE', 'var(--panel)', 'var(--muted)'] };
const MODES = [['reply', 'Reply'], ['their-reply', 'Log their reply'], ['note', 'Private note']];

const when = (ts) => {
  const d = new Date(ts);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
};
const stamp = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));

function SupportPage() {
  const router = useRouter();
  const isPhone = useIsPhone();
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('new');
  const [q, setQ] = useState('');
  const [restFilter, setRestFilter] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [startOpen, setStartOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch('/api/admin/support');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the inbox');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  // Coming from a restaurant's Message button.
  useEffect(() => {
    if (typeof router.query.restaurant === 'string') {
      setRestFilter(router.query.restaurant);
      setFilter('all');
      setStartOpen(true);
    }
  }, [router.query.restaurant]);

  const threads = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.threads || []).filter((t) =>
      (filter === 'all' || t.status === filter) &&
      (!restFilter || t.restaurant_id === restFilter) &&
      (!term || [t.subject, t.restaurant_name, t.preview].some((x) => String(x || '').toLowerCase().includes(term))));
  }, [data, filter, q, restFilter]);

  // Open the first thread in view when nothing is open.
  useEffect(() => {
    if (typeof router.query.thread === 'string') {
      setOpenId(router.query.thread);
    } else if (!isPhone && !openId && threads.length) {
      setOpenId(threads[0].id);
    }
  }, [threads, openId, isPhone, router.query.thread]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading inbox…" />;

  const restName = restFilter ? (data.restaurants.find((r) => r.id === restFilter)?.name || 'This restaurant') : null;

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--muted)' }}>RESTAURANTS</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Support inbox</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>Messages owners send from the app land here. Your replies go out by email from nick@opti-menu.com.</p>
        </div>
        <button type="button" className="om-pri" onClick={() => setStartOpen(true)}>New message</button>
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', flexWrap: 'wrap', minHeight: 560 }}>
        {/* Thread list */}
        <section aria-label="Conversations" style={{ flex: '1 1 300px', maxWidth: 380, minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--line)' }}>
            <input type="search" className="om-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages" style={{ borderRadius: 18 }} />
            <Pills label="Filter by status" value={filter} onChange={(k) => { setFilter(k); setOpenId(null); }} options={[
              { key: 'new', label: 'Needs you', n: data.counts.new },
              { key: 'waiting', label: 'Waiting', n: data.counts.waiting },
              { key: 'done', label: 'Done', n: data.counts.done },
              ...(!isPhone ? [{ key: 'all', label: 'All', n: data.counts.all }] : []),
            ]} />
            {restName && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <Chip bg="var(--accent-tint)" fg="var(--accent-deep)">{restName.toUpperCase()}</Chip>
                <button type="button" onClick={() => { setRestFilter(null); router.replace('/admin/support', undefined, { shallow: true }); }} style={{ border: 0, background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12.5 }}>Show everyone</button>
              </div>
            )}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {threads.length === 0 && <div style={{ padding: 20, fontSize: 13.5, color: 'var(--muted)' }}>Nothing here.</div>}
            {threads.map((t) => {
              const on = t.id === openId;
              return (
                <button key={t.id} type="button" onClick={() => {
                  setOpenId(t.id);
                  if (isPhone) router.push({ pathname: '/admin/support', query: { thread: t.id } }, undefined, { shallow: true });
                }}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: isPhone ? 14 : '11px 14px', border: 0, borderBottom: isPhone ? 0 : '1px solid var(--line-soft)', borderRadius: isPhone ? 12 : 0, cursor: 'pointer', background: isPhone ? 'var(--panel)' : on ? 'var(--accent-tint)' : 'transparent', boxShadow: on && !isPhone ? 'inset 3px 0 0 var(--accent)' : 'none', color: 'var(--text)', fontFamily: "'Manrope', sans-serif" }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.restaurant_name}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {isPhone && <StatusChip status={t.status} />}
                      <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--muted)' }}>{when(t.last_message_at)}</span>
                    </span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: t.status === 'new' ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject || '(no subject)'}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.preview}</span>
                </button>
              );
            })}
          </div>
        </section>

        {openId
          ? <Thread key={openId} id={openId} replies={data.replies} onChanged={load} />
          : <div style={{ flex: '3 1 560px', border: '1px solid var(--line)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Pick a conversation.</div>}
      </div>

      {startOpen && (
        <StartDialog restaurants={data.restaurants} initial={restFilter} onClose={() => setStartOpen(false)}
          onSent={async (threadId) => { setStartOpen(false); await load(); setFilter('all'); setOpenId(threadId); }} />
      )}
    </>
  );
}

function Thread({ id, replies, onChanged }) {
  const { adminFetch } = useAdminFetch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('reply');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [quoteOpen, setQuoteOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminFetch(`/api/admin/support?thread=${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the conversation');
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [adminFetch, id]);
  useEffect(() => { load(); }, [load]);

  async function act(payload) {
    setBusy(true);
    setFlash('');
    try {
      const res = await adminFetch('/api/admin/support/action', { method: 'POST', body: JSON.stringify({ threadId: id, ...payload }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save');
      if (json.message) setFlash(json.message);
      await Promise.all([load(), onChanged()]);
      return true;
    } catch (e) {
      setFlash(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const ok = await act({ action: mode, body, email });
    if (ok) setBody('');
  }

  function applySaved(r) {
    const first = data?.owner?.first || 'there';
    setMode('reply');
    setBody(r.body.replace(/\{name\}/g, first));
    adminFetch('/api/admin/support/action', { method: 'POST', body: JSON.stringify({ action: 'used-reply', replyId: r.id }) }).catch(() => {});
  }

  if (error) return <div style={{ flex: '3 1 560px' }}><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div style={{ flex: '3 1 560px', display: 'flex' }}><LoadingState label="Loading…" /></div>;

  const t = data.thread;
  const r = data.restaurant;
  const [sLabel, sBg, sFg] = STATUS[t.status] || STATUS.new;
  const firstIn = data.messages.find((m) => m.direction === 'in');

  return (
    <>
      <section aria-label="Conversation" style={{ flex: '3 1 520px', minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{t.subject || '(no subject)'}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
              {r ? r.name : 'No restaurant'}{data.owner ? ` · ${data.owner.name} · ${data.owner.email}` : ' · no owner email'}
            </div>
          </div>
          <Chip bg={sBg} fg={sFg}>{sLabel}</Chip>
          <select className="om-field" aria-label="Type" value={t.kind} onChange={(e) => act({ action: 'kind', kind: e.target.value })} style={{ width: 'auto', minHeight: 32 }}>
            {KINDS.map((k) => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
          </select>
          {t.status !== 'done'
            ? <button type="button" className="om-btn" disabled={busy} onClick={() => act({ action: 'status', status: 'done' })}>Mark done</button>
            : <button type="button" className="om-btn" disabled={busy} onClick={() => act({ action: 'status', status: 'new' })}>Reopen</button>}
          {firstIn && (
            <button type="button" className="om-btn" disabled={busy || data.hasTestimonial} onClick={() => setQuoteOpen(true)}>
              {data.hasTestimonial ? 'Saved as testimonial ✓' : 'Save as testimonial'}
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--panel)', minHeight: 260 }}>
          {data.messages.map((m) => {
            const out = m.direction === 'out';
            const note = m.direction === 'note';
            return (
              <div key={m.id} style={{ alignSelf: out ? 'flex-end' : note ? 'center' : 'flex-start', maxWidth: note ? '90%' : '78%' }}>
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)', marginBottom: 3, textAlign: out ? 'right' : 'left' }}>
                  {note ? `PRIVATE NOTE · ${m.author || ''}` : out ? `${m.author || 'You'}${m.emailed ? ' · emailed' : ' · not emailed'}` : (data.owner?.name || 'Owner')} · {stamp(m.created_at)}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55, padding: '10px 13px', borderRadius: 12,
                  background: out ? 'var(--accent-tint)' : note ? 'var(--amber-tint)' : 'var(--shell)',
                  border: `1px solid ${out ? 'transparent' : note ? 'transparent' : 'var(--line)'}` }}>
                  {m.body}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div role="tablist" aria-label="What to add" style={{ display: 'flex', gap: 14 }}>
            {MODES.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                style={{ border: 0, background: 'none', padding: '4px 0', cursor: 'pointer', font: `${mode === k ? 700 : 500} 13px 'Manrope', sans-serif`, color: mode === k ? 'var(--text)' : 'var(--muted)', borderBottom: `2px solid ${mode === k ? 'var(--accent)' : 'transparent'}` }}>{l}</button>
            ))}
          </div>
          {mode === 'reply' && replies.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {replies.map((x) => <button key={x.id} type="button" className="om-btn" style={{ minHeight: 28, fontSize: 12 }} onClick={() => applySaved(x)}>{x.label}</button>)}
            </div>
          )}
          <textarea className="om-field" rows={4} value={body} onChange={(e) => setBody(e.target.value)} style={{ padding: '8px 10px', resize: 'vertical' }}
            aria-label={mode === 'reply' ? 'Your reply' : mode === 'note' ? 'Private note' : 'Their reply'}
            placeholder={mode === 'reply' ? `Reply to ${data.owner?.first || 'the owner'}…` : mode === 'note' ? 'Only you see this' : 'Paste what they wrote back by email'} />
          {flash && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{flash}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {mode === 'reply'
              ? <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email it to {data.owner?.email || 'the owner'}</label>
              : <span />}
            <button type="button" className="om-pri" disabled={busy || !body.trim()} onClick={send}>
              {busy ? 'Saving…' : mode === 'reply' ? (email ? 'Send' : 'Save reply') : mode === 'note' ? 'Add note' : 'Add their reply'}
            </button>
          </div>
        </div>
      </section>

      <aside aria-label="Restaurant" style={{ flex: '1 1 240px', maxWidth: 300, minWidth: 0, border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, alignSelf: 'flex-start' }}>
        {!r ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Not tied to a restaurant.</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Dot level={r.health.level} />
              <Link href={`/admin/restaurants/${r.id}`} style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{r.name}</Link>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><StatusChip status={r.status} /></div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{HEALTH_WORD[r.health.level]}{r.health.reasons.length && r.health.level !== 'green' ? ` · ${r.health.reasons[0]}` : ''}</div>
            {[
              ['Setup', r.setupDone === 5 ? 'Fully set up' : `${r.setupDone} of 5 · next: ${r.nextStep}`],
              ['POS', r.pos],
              ['Last invoice', shortDate(r.lastInvoice)],
              ['Tonight’s Dish', r.lastDish ? shortDate(r.lastDish.date) : 'Not running'],
              ['Staff page', `${r.views} views this week`],
              ['Plan', r.plan ? r.plan.replace(/_/g, ' ') : 'No plan'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
                <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <Link className="om-btn" href={`/admin/restaurants/${r.id}`} style={{ minHeight: 30 }}>Restaurant</Link>
              <Link className="om-btn" href={`/admin/billing/${r.id}`} style={{ minHeight: 30 }}>Billing</Link>
            </div>
          </>
        )}
      </aside>

      {quoteOpen && (
        <QuoteDialog initial={firstIn?.body || ''} person={data.owner ? `${data.owner.name}, ${r?.name || ''}` : r?.name || ''} busy={busy}
          onClose={() => setQuoteOpen(false)} onSave={async (v) => { if (await act({ action: 'testimonial', ...v })) setQuoteOpen(false); }} />
      )}
    </>
  );
}

const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 };

function QuoteDialog({ initial, person, busy, onClose, onSave }) {
  const [quote, setQuote] = useState(initial);
  const [who, setWho] = useState(person);
  return (
    <Dialog title="Save as testimonial" sub="Trim it to the part worth quoting. It goes on Testimonials as not yet asked." onClose={onClose} width={540}>
      <label style={label}>Quote<textarea className="om-field" rows={5} value={quote} onChange={(e) => setQuote(e.target.value)} style={{ padding: '8px 10px', resize: 'vertical' }} /></label>
      <label style={label}>Who said it<input className="om-field" value={who} onChange={(e) => setWho(e.target.value)} /></label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !quote.trim()} onClick={() => onSave({ quote, person: who })}>Save</button>
      </div>
    </Dialog>
  );
}

function StartDialog({ restaurants, initial, onClose, onSent }) {
  const { adminFetch } = useAdminFetch();
  const [restaurantId, setRestaurantId] = useState(initial || restaurants[0]?.id || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function send() {
    setBusy(true);
    setErr('');
    try {
      const res = await adminFetch('/api/admin/support/action', { method: 'POST', body: JSON.stringify({ action: 'start', restaurantId, subject, body }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not send');
      onSent(json.threadId);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="New message" sub="Emailed to the owner from nick@opti-menu.com. Their reply comes back to your inbox." onClose={onClose} width={560}>
      <label style={label}>Restaurant
        <select className="om-field" value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
          {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label style={label}>Subject<input className="om-field" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label style={label}>Message<textarea className="om-field" rows={8} value={body} onChange={(e) => setBody(e.target.value)} style={{ padding: '8px 10px', resize: 'vertical' }} /></label>
      {err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="om-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="om-pri" disabled={busy || !restaurantId || !subject.trim() || !body.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </Dialog>
  );
}

export default function Page() {
  return (
    <AdminShell section="Restaurants" sub="Support inbox" title="Support inbox">
      <SupportPage />
    </AdminShell>
  );
}