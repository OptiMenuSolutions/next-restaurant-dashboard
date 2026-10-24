import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import supabase from '../../lib/supabaseClient';
import { useGuardedAccount } from '../../lib/useAccount';
import { Shell, useTheme } from './ClientChrome';
import { refreshClientNotifications } from './NotificationBell';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function supportRequest(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');

  const res = await fetch(url, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Could not connect to support.');
  return json;
}

export default function SupportConversation({ onClose }) {
  const router = useRouter();
  const { account, loading, error } = useGuardedAccount({
    requireSubscription: false,
    requireOnboarding: false,
    requirePaymentCurrent: false,
  });
  const threadId = typeof router.query.thread === 'string' ? router.query.thread : '';

  return (
    <Conversation
      key={`${account?.user?.id || 'pending'}:${threadId}`}
      threadId={threadId}
      userId={account?.user?.id || null}
      accountLoading={loading || !router.isReady}
      accountError={error}
      onClose={onClose}
    />
  );
}

function Conversation({ threadId, userId, accountLoading, accountError, onClose }) {
  const [theme] = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [older, setOlder] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const pendingMessage = useRef(null);
  const scroll = useRef(null);
  const nearBottom = useRef(true);
  const validThread = UUID.test(threadId);
  const endpoint = `/api/support?thread=${encodeURIComponent(threadId)}`;

  const { data, error, mutate } = useSWR(
    userId && validThread ? ['client-support', userId, threadId] : null,
    () => supportRequest(endpoint),
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: false,
    }
  );

  const messages = useMemo(() => {
    const byId = new Map(
      [...older, ...(data?.messages || [])].map((message) => [message.id, message])
    );
    return [...byId.values()].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
  }, [older, data?.messages]);

  const lastId = messages[messages.length - 1]?.id;
  const nextCursor = historyCursor === undefined ? data?.nextCursor : historyCursor;

  useEffect(() => {
    if (nearBottom.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [lastId]);

  useEffect(() => {
    if (!userId || !lastId) return;
    supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('kind', 'support_reply')
      .eq('href', `/client/support?thread=${threadId}`)
      .is('read_at', null)
      .then(({ error: readError }) => {
        if (!readError) refreshClientNotifications();
      })
      .catch(() => {});
  }, [userId, threadId, lastId]);

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setSendError('');
    const oldHeight = scroll.current?.scrollHeight || 0;
    nearBottom.current = false;

    try {
      const json = await supportRequest(
        `${endpoint}&before=${encodeURIComponent(nextCursor)}`
      );
      setOlder((previous) => [...json.messages, ...previous]);
      setHistoryCursor(json.nextCursor);
      requestAnimationFrame(() => {
        if (scroll.current) {
          scroll.current.scrollTop += scroll.current.scrollHeight - oldHeight;
        }
      });
    } catch (err) {
      setSendError(err.message);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending || !data) return;

    setSending(true);
    setSendError('');

    try {
      if (pendingMessage.current?.body !== body) {
        pendingMessage.current = { id: crypto.randomUUID(), body };
      }

      const json = await supportRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          messageId: pendingMessage.current.id,
          body,
        }),
      });
      if (!json.message?.id) throw new Error('Could not confirm your reply. Please try again.');

      nearBottom.current = true;
      await mutate(
        (current) => current && {
          ...current,
          thread: { ...current.thread, status: 'new' },
          messages: [
            ...current.messages.filter((m) => m.id !== json.message.id),
            json.message,
          ],
        },
        { revalidate: false }
      );
      setDraft('');
      pendingMessage.current = null;
      mutate().catch(() => {});
    } catch (err) {
      setSendError(err.message || 'Could not send your reply. Your text has been kept.');
    } finally {
      setSending(false);
    }
  }

  const loadError = accountError || error?.message ||
    (!accountLoading && !validThread ? 'Invalid conversation link.' : '');
  const loading = accountLoading || (!!userId && validThread && !data && !error);
  const buttonStyle = {
    minHeight: 44,
    padding: '0 14px',
    border: '1px solid var(--line)',
    borderRadius: 24,
    background: 'var(--shell)',
    color: 'var(--text)',
    font: "700 13px 'Manrope', sans-serif",
    cursor: 'pointer',
  };

  return (
    <Shell theme={theme} style={{ height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--panel)' }}>
      <header style={{ flexShrink: 0, background: 'var(--shell)', borderBottom: '1px solid var(--line)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>OptiMenu support</div>
            <h2 style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 800, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {data?.thread?.subject || 'Conversation'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close conversation"
            onClick={onClose}
            style={{ width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: '50%', background: 'transparent', color: 'var(--muted)', fontSize: 24, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      </header>

      <main
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          if (element) {
            nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          }
        }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 16 }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading && <p role="status">Loading conversation…</p>}
          {loadError && (
            <div role="alert">
              <p style={{ color: 'var(--red)' }}>{loadError}</p>
              <button type="button" onClick={() => mutate()} style={buttonStyle}>Try again</button>
            </div>
          )}
          {nextCursor && (
            <button type="button" disabled={loadingOlder} onClick={loadOlder} style={buttonStyle}>
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {messages.map((message) => {
            const fromClient = message.direction === 'in';
            return (
              <div key={message.id} style={{ alignSelf: fromClient ? 'flex-end' : 'flex-start', maxWidth: '88%', minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textAlign: fromClient ? 'right' : 'left' }}>
                  {fromClient ? 'Your restaurant' : 'OptiMenu'}
                </div>
                <div style={{ padding: '11px 14px', borderRadius: 14, border: '1px solid var(--line)', background: fromClient ? 'var(--accent-tint)' : 'var(--shell)', color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.55 }}>
                  {message.body}
                </div>
                <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--muted)', textAlign: fromClient ? 'right' : 'left' }}>
                  {new Date(message.created_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <form onSubmit={send} style={{ flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--shell)', padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sendError && <div role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>{sendError}</div>}
          <textarea
            aria-label="Your reply"
            placeholder="Write a reply…"
            rows={3}
            maxLength={5000}
            value={draft}
            disabled={sending || !data}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 72, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--shell)', color: 'var(--text)', font: "500 16px 'Manrope', sans-serif", resize: 'none' }}
          />
          <button type="submit" disabled={sending || !draft.trim() || !data} style={{ ...buttonStyle, background: 'var(--accent-deep)', color: 'var(--shell)', border: 0, opacity: sending || !draft.trim() || !data ? 0.5 : 1 }}>
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </form>
    </Shell>
  );
}