import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useGuardedAccount } from '../../lib/useAccount';
import {
  Shell,
  FONT_LINKS,
  MONO,
  useTheme,
} from '../../components/client/ClientChrome';
import {
  useClientNotifications,
  refreshClientNotifications,
} from '../../components/client/NotificationBell';

export default function NotificationsPage() {
  const router = useRouter();
  const [theme] = useTheme();
  const [limit, setLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  const {
    account,
    loading: accountLoading,
    error: accountError,
  } = useGuardedAccount();

  const {
    userId,
    items,
    total,
    unread,
    loading,
    error,
    refresh,
  } = useClientNotifications(limit);

  function goBack() {
    const from = typeof router.query.from === 'string' ? router.query.from : '';
    const safeFrom =
      from.startsWith('/client/') &&
      !from.startsWith('/client/notifications') &&
      !from.includes('\\');

    if (safeFrom && window.history.length > 1) {
      router.back();
    } else {
      router.replace('/client/dashboard');
    }
  }

  async function markAllRead() {
    if (!userId || busy) return;

    setBusy(true);
    setSaveError('');

    try {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('user_id', userId)
        .is('read_at', null)
        .lte('created_at', now);

      if (updateError) throw updateError;
      await refreshClientNotifications();
    } catch (err) {
      setSaveError(err.message || 'Could not mark notifications read.');
    } finally {
      setBusy(false);
    }
  }

  async function openNotification(notification) {
    if (!userId || busy) return;

    setBusy(true);
    setSaveError('');

    try {
      if (!notification.read_at) {
        const { error: updateError } = await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', notification.id)
          .eq('user_id', userId)
          .select('id')
          .single();

        if (updateError) throw updateError;
        await refreshClientNotifications();
      }

      if (notification.href) {
        const destination = new URL(notification.href, window.location.origin);
        if (
          destination.origin !== window.location.origin ||
          !destination.pathname.startsWith('/client/')
        ) {
          throw new Error('This notification destination is unavailable.');
        }

        await router.push(
          destination.pathname + destination.search + destination.hash
        );
      }
    } catch (err) {
      setSaveError(err.message || 'Could not open this notification.');
    } finally {
      setBusy(false);
    }
  }

  const loadError = accountError || error?.message;
  const waiting = accountLoading || loading;
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
    <Shell
      theme={theme}
      style={{
        position: 'fixed',
        inset: 0,
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--panel)',
      }}
    >
      <Head>
        <title>Notifications · OptiMenu</title>
        {FONT_LINKS}
      </Head>

      <header
        style={{
          flexShrink: 0,
          padding: 'calc(8px + env(safe-area-inset-top, 0px)) 16px 8px',
          background: 'var(--shell)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={goBack} style={buttonStyle}>
            ‹ Back
          </button>
          <h1 style={{ flex: 1, margin: 0, fontSize: 20, fontWeight: 800 }}>
            Notifications
          </h1>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '16px 16px calc(24px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {waiting && <p role="status">Loading notifications…</p>}

          {loadError && (
            <div role="alert">
              <p style={{ color: 'var(--red)' }}>{loadError}</p>
              <button type="button" onClick={() => router.reload()} style={buttonStyle}>
                Try again
              </button>
            </div>
          )}

          {saveError && (
            <p role="alert" style={{ margin: 0, color: 'var(--red)', overflowWrap: 'anywhere' }}>
              {saveError}
            </p>
          )}

          {!waiting && !loadError && account && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {unread ? `${unread} unread` : 'All caught up'}
                </span>
                <button
                  type="button"
                  disabled={busy || !unread}
                  onClick={markAllRead}
                  style={{ ...buttonStyle, opacity: busy || !unread ? 0.5 : 1 }}
                >
                  Mark all read
                </button>
              </div>

              {items.length === 0 && (
                <div style={{ padding: 24, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--shell)' }}>
                  <strong>No notifications yet</strong>
                  <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--muted)' }}>
                    Your account updates will appear here.
                  </p>
                </div>
              )}

              {items.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  disabled={busy}
                  onClick={() => openNotification(notification)}
                  style={{
                    width: '100%',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    textAlign: 'left',
                    padding: 14,
                    border: '1px solid var(--line)',
                    borderLeft: `3px solid ${notification.read_at ? 'var(--line)' : 'var(--accent-deep)'}`,
                    borderRadius: 12,
                    background: notification.read_at ? 'var(--shell)' : 'var(--accent-tint)',
                    color: 'var(--text)',
                    fontFamily: "'Manrope', sans-serif",
                    cursor: 'pointer',
                    overflowWrap: 'anywhere',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>
                    {notification.title}
                  </span>
                  {notification.body && (
                    <span style={{ display: 'block', marginTop: 5, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {notification.body}
                    </span>
                  )}
                  <span style={{ display: 'block', marginTop: 9, fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)' }}>
                    {new Date(notification.created_at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {notification.read_at ? ' · Read' : ' · Unread'}
                    {notification.href ? ' · Open ›' : ''}
                  </span>
                </button>
              ))}

              {items.length < total && (
                <button type="button" disabled={busy} onClick={() => setLimit((n) => n + 30)} style={buttonStyle}>
                  Load more
                </button>
              )}

              <button type="button" disabled={busy} onClick={() => refresh()} style={buttonStyle}>
                Refresh
              </button>
            </>
          )}
        </div>
      </main>
    </Shell>
  );
}