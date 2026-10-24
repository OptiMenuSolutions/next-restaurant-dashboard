import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SupportRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    const thread = typeof router.query.thread === 'string'
      ? router.query.thread
      : '';

    router.replace({
      pathname: '/client/profile',
      query: {
        tab: 'support',
        ...(thread ? { thread } : {}),
      },
    });
  }, [router.isReady, router.query.thread, router]);

  return null;
}