// lib/useTour.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

const TourOverlay = dynamic(() => import('../components/TourOverlay'), { ssr: false });

export function useTour(page, restaurantId) {
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

  // Also listen for optimenu-refresh event to re-trigger data fetching on pages
  useEffect(() => {
    const handler = () => {
      // Pages can listen for this event to refetch data after sample data is seeded
      window.dispatchEvent(new CustomEvent('optimenu-data-refresh'));
    };
    window.addEventListener('optimenu-refresh', handler);
    return () => window.removeEventListener('optimenu-refresh', handler);
  }, []);

  function handleDone() {
    setActive(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    url.searchParams.delete('step');
    window.history.replaceState({}, '', url.toString());
  }

  function TourComponent() {
    if (!active) return null;
    return <TourOverlay page={page} restaurantId={restaurantId} onDone={handleDone} />;
  }

  return { TourComponent, tourActive: active };
}

// Helper to restart the tour — call this from the profile page
export function restartTour(router) {
  try { localStorage.removeItem('optimenu_tour_done'); } catch {}
  router.push('/client/dashboard?tour=true');
}