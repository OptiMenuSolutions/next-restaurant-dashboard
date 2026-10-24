import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import supabase from '../../lib/supabaseClient';
import { useAccount } from '../../lib/useAccount';

export default function SupportConversations({ onOpen, selectedId }) {
  const { data: account } = useAccount();

  return (
    <ConversationList
      key={account?.user?.id || 'pending'}
      userId={account?.user?.id || null}
      onOpen={onOpen}
      selectedId={selectedId}
    />
  );
}

function ConversationList({ userId, onOpen, selectedId }) {
  const [open, setOpen] = useState(false);

  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite(
    (index, previous) => {
      if (!open || !userId || (previous && !previous.nextCursor)) return null;
      const cursor = previous?.nextCursor;
      return ['client-support-list', userId, cursor?.at || '', cursor?.id || ''];
    },
    async ([, , beforeAt, beforeId]) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in again.');

      const query = beforeAt
        ? `?beforeAt=${encodeURIComponent(beforeAt)}&beforeId=${encodeURIComponent(beforeId)}`
        : '';

      const response = await fetch(`/api/support-conversations${query}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(json.threads)) {
        throw new Error(json.error || 'Could not load conversations.');
      }
      return json;
    },
    {
      refreshInterval: open ? 10000 : 0,
      revalidateOnFocus: true,
      revalidateAll: true,
      persistSize: false,
    }
  );

  const unique = new Map();
  for (const page of data || []) {
    for (const thread of page.threads) {
      if (!unique.has(thread.id)) unique.set(thread.id, thread);
    }
  }
  const threads = [...unique.values()];
  const hasMore = !!data?.[data.length - 1]?.nextCursor;
  const loadingMore = !!data && size > data.length;

  const buttonStyle = {
    width: '100%',
    minHeight: 44,
    padding: '10px 12px',
    border: '1px solid var(--line)',
    borderRadius: 8,
    background: 'var(--shell)',
    color: 'var(--accent-deep)',
    font: "700 13px 'Manrope', sans-serif",
    cursor: 'pointer',
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        disabled={!userId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={buttonStyle}
      >
        {open ? 'Hide conversations' : 'Open conversations'}
      </button>

      {open && (
        <div style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
          {!data && !error && (
            <p role="status" style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>
              Loading conversations…
            </p>
          )}

          {error && (
            <div role="alert" style={{ padding: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>{error.message}</p>
              <button type="button" onClick={() => mutate().catch(() => {})} style={buttonStyle}>
                Try again
              </button>
            </div>
          )}

          {data && !error && threads.length === 0 && (
            <p style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>
              No conversations yet.
            </p>
          )}

          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => onOpen(thread.id)}
              style={{
                display: 'block',
                width: '100%',
                minWidth: 0,
                padding: '12px 14px',
                textAlign: 'left',
                border: 0,
                borderBottom: '1px solid var(--line-soft)',
                background: selectedId === thread.id ? 'var(--accent-tint)' : 'var(--shell)',
                color: 'var(--text)',
                fontFamily: "'Manrope', sans-serif",
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {thread.subject || 'Support conversation'}
              </span>
              <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
                {thread.preview
                  ? `${thread.direction === 'out' ? 'OptiMenu: ' : 'You: '}${thread.preview}`
                  : 'No messages yet'}
              </span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--faint)', marginTop: 6 }}>
                {new Date(thread.last_message_at).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}
                {' · '}
                {thread.status === 'done'
                  ? 'Closed'
                  : thread.direction === 'out' ? 'OptiMenu replied' : 'Waiting for OptiMenu'}
              </span>
            </button>
          ))}

          {hasMore && (
            <button
              type="button"
              disabled={loadingMore || isValidating}
              onClick={() => setSize(size + 1)}
              style={buttonStyle}
            >
              {loadingMore ? 'Loading…' : 'Load more conversations'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}