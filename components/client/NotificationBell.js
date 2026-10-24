import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR, { mutate } from 'swr';
import supabase from '../../lib/supabaseClient';
import { useAccount } from '../../lib/useAccount';

export function useClientNotifications(limit = 30) {
  const { data: account, error: accountError } = useAccount();
  const userId = account?.user?.id || null;

  const result = useSWR(
    userId ? ['client-notifications', userId, limit] : null,
    async ([, id, pageSize]) => {
      const [list, unread] = await Promise.all([
        pageSize > 0
          ? supabase
              .from('notifications')
              .select('id, kind, title, body, href, created_at, read_at', { count: 'exact' })
              .eq('user_id', id)
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(0, pageSize - 1)
          : Promise.resolve({ data: [], count: 0, error: null }),
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', id)
          .is('read_at', null),
      ]);

      if (list.error) throw list.error;
      if (unread.error) throw unread.error;

      return {
        items: list.data || [],
        total: list.count || 0,
        unread: unread.count || 0,
      };
    },
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: false,
    }
  );

  return {
    userId,
    items: result.data?.items || [],
    total: result.data?.total || 0,
    unread: result.data?.unread || 0,
    loading: !!userId && !result.data && !result.error,
    error: accountError || result.error,
    refresh: result.mutate,
  };
}

export function refreshClientNotifications() {
  return mutate(
    (key) => Array.isArray(key) && key[0] === 'client-notifications',
    undefined,
    { revalidate: true }
  );
}

export default function NotificationBell({ size = 40, onOpen }) {
  const router = useRouter();
  const { unread, error } = useClientNotifications(0);

  return (
    <Link
      href={{
        pathname: '/client/notifications',
        query: { from: router.asPath },
      }}
      onClick={onOpen}
      aria-label={
        error
          ? 'Notifications'
          : unread
            ? `Notifications, ${unread} unread`
            : 'Notifications'
      }
      title="Notifications"
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--line)',
        borderRadius: '50%',
        background: 'transparent',
        color: 'var(--muted)',
        textDecoration: 'none',
        boxSizing: 'border-box',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
      {!error && unread > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -5,
            right: -6,
            minWidth: 18,
            height: 18,
            padding: '0 4px',
            boxSizing: 'border-box',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent-deep)',
            color: 'var(--shell)',
            border: '2px solid var(--shell)',
            font: "700 10px 'Manrope', sans-serif",
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}