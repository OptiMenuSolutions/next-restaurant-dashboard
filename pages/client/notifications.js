import { useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../../lib/supabaseClient';
import { useGuardedAccount } from '../../lib/useAccount';
import { MONO, useIsMobile } from '../../components/client/ClientChrome';
import ClientPage, { PageTitle } from '../../components/client/ClientPage';
import {
  useClientNotifications,
  refreshClientNotifications,
} from '../../components/client/NotificationBell';

export default function NotificationsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [limit, setLimit] = useState(30);
  const [filter, setFilter] = useState('all');
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

  const loadError = accountError ? (accountError.message || String(accountError)) : error?.message;
  const waiting = accountLoading || loading;
  const buttonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    padding: '0 16px',
    border: '1px solid var(--line)',
    borderRadius: 20,
    background: 'var(--shell)',
    color: 'var(--text)',
    font: "600 13px 'Manrope', sans-serif",
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  const KINDS = {
    price_alert: ['var(--amber-tint, #fbf3e2)', 'var(--amber)', <><path d="M5 16l5-5 3 3 6-7" /><path d="M14 7h5v5" /></>],
    low_margin: ['var(--red-tint, #fbeceb)', 'var(--red)', <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.01" /></>],
    support_reply: ['var(--accent-tint)', 'var(--accent-deep)', <path d="M4 5h16v11H9l-5 4z" />],
  };
  const fallbackKind = ['var(--panel)', 'var(--muted)', <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const shown = filter === 'unread' ? items.filter((n) => !n.read_at) : items;
  const groups = [
    ['Today', shown.filter((n) => new Date(n.created_at) >= startOfToday)],
    ['Earlier', shown.filter((n) => new Date(n.created_at) < startOfToday)],
  ].filter(([, list]) => list.length);

  function when(value) {
    const d = new Date(value);
    return d >= startOfToday
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toUpperCase()
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  }

  const markAll = (
    <button
      type="button"
      disabled={busy || !unread}
      onClick={markAllRead}
      style={{ ...buttonStyle, opacity: busy || !unread ? 0.5 : 1 }}
    >
      Mark all read
    </button>
  );

  return (
    <ClientPage
      title="Notifications"
      account={account}
      maxWidth={860}
      phoneBack={{ label: 'Back', onBack: goBack, title: 'Notifications' }}
    >
      <PageTitle
        kicker="Account"
        title="Notifications"
        isPhone={isMobile}
        sub={unread ? `${unread} unread` : 'All caught up'}
      >
        {markAll}
        {!isMobile && (
          <a href="/client/profile?tab=notifications" style={{ ...buttonStyle, textDecoration: 'none' }}>
            Notification settings
          </a>
        )}
      </PageTitle>

      {waiting && <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>Loading notifications…</p>}

      {loadError && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--red-tint, #fbeceb)', color: 'var(--red)', fontSize: 13.5 }}>
          <span style={{ flex: '1 1 220px' }}>{loadError}</span>
          <button type="button" onClick={() => router.reload()} style={buttonStyle}>
            Try again
          </button>
        </div>
      )}

      {saveError && (
        <p role="alert" style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--red-tint, #fbeceb)', color: 'var(--red)', fontSize: 13, overflowWrap: 'anywhere' }}>
          {saveError}
        </p>
      )}

      {!waiting && !loadError && account && (
        <>
          <div role="group" aria-label="Filter notifications" style={{ display: 'flex', maxWidth: isMobile ? 'none' : 380, background: 'var(--shell)', border: '1px solid var(--line)', borderRadius: 10, padding: 3, gap: 2 }}>
            {[
              ['all', `All · ${total}`],
              ['unread', `Unread · ${unread}`],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                style={{ flex: 1, minHeight: 34, border: 0, borderRadius: 8, cursor: 'pointer', font: "600 12.5px 'Manrope', sans-serif", background: filter === key ? 'var(--accent-tint)' : 'transparent', color: filter === key ? 'var(--accent-deep)' : 'var(--muted)' }}
              >
                {label}
              </button>
            ))}
          </div>

          {groups.length === 0 && (
            <section style={{ padding: '22px 20px', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--shell)' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </h2>
              <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>
                Price changes, low margins and support replies appear here.
              </p>
            </section>
          )}

          {groups.map(([label, list]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', padding: '4px 2px 0' }}>
                {label}
              </div>
              <section style={{ background: 'var(--shell)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
                {list.map((notification, index) => {
                  const [bg, fg, icon] = KINDS[notification.kind] || fallbackKind;
                  const isUnread = !notification.read_at;
                  return (
                    <button
                      key={notification.id}
                      type="button"
                      disabled={busy}
                      onClick={() => openNotification(notification)}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                        textAlign: 'left',
                        padding: isMobile ? 14 : '16px 18px',
                        border: 0,
                        borderTop: index ? '1px solid var(--line-soft)' : 0,
                        background: 'var(--shell)',
                        color: 'var(--text)',
                        fontFamily: "'Manrope', sans-serif",
                        cursor: notification.href ? 'pointer' : 'default',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      <span style={{ width: 36, height: 36, borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                          <span style={{ fontSize: 14, fontWeight: isUnread ? 800 : 600 }}>{notification.title}</span>
                          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{when(notification.created_at)}</span>
                        </span>
                        {notification.body && (
                          <span style={{ display: 'block', marginTop: 3, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {notification.body}
                          </span>
                        )}
                      </span>
                      {isUnread ? (
                        <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: 6 }} />
                      ) : (
                        <span aria-hidden="true" style={{ width: 8, flexShrink: 0 }} />
                      )}
                    </button>
                  );
                })}
              </section>
            </div>
          ))}

          {items.length < total && (
            <button type="button" disabled={busy} onClick={() => setLimit((n) => n + 30)} style={{ ...buttonStyle, alignSelf: 'center' }}>
              Load more
            </button>
          )}
        </>
      )}
    </ClientPage>
  );
}