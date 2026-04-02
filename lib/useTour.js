// lib/useTour.js
// Drop-in hook for any page that participates in the tour.
// Usage: const { TourComponent } = useTour('dashboard');
// Then render <TourComponent /> anywhere in the JSX.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Dynamically import to avoid SSR issues
const TourOverlay = dynamic(() => import('../components/TourOverlay'), { ssr: false });

export function useTour(page) {
  const router = useRouter();
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.tour !== 'true') return;

    try {
      if (localStorage.getItem('optimenu_tour_done') === '1') return;
    } catch {}

    const t = setTimeout(() => setActive(true), 500);
    return () => clearTimeout(t);
  }, [router.isReady, router.query.tour]);

  function handleDone() {
    setActive(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url.toString());
    if (page !== 'analytics') {
      router.push('/client/dashboard');
    }
  }

  function TourComponent() {
    if (!active) return null;
    return <TourOverlay page={page} onDone={handleDone} />;
  }

  return { TourComponent, tourActive: active };
}