// lib/useTour.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export function useTour(page, restaurantId) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [tourPage, setTourPage] = useState(page);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.tour !== 'true') return;
    if (!restaurantId) return;
    try { if (localStorage.getItem('optimenu_tour_done') === '1') return; } catch {}

    let resolvedPage = page;
    try {
      const stored = sessionStorage.getItem(SS_KEY);
      if (stored && STEP_TO_PAGE[stored]) resolvedPage = STEP_TO_PAGE[stored];
    } catch {}

    const shouldActivate =
      resolvedPage === page ||
      (page === 'dashboard' && resolvedPage === 'final');
    if (!shouldActivate) return;

    const tp = (resolvedPage === 'final' && page === 'dashboard') ? 'final' : page;
    setTourPage(tp);
    const t = setTimeout(() => setActive(true), 400);
    return () => clearTimeout(t);
  }, [router.isReady, router.query.tour, restaurantId, page]);

  function handleDone() {
    setActive(false);
    try {
      localStorage.setItem('optimenu_tour_done', '1');
      sessionStorage.removeItem(SS_KEY);
      sessionStorage.removeItem('optimenu_tour_spot');
    } catch {}
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url.toString());
  }

  const tourProps = active && restaurantId
    ? { page: tourPage, restaurantId, onDone: handleDone }
    : null;

  return { tourProps };
}

export function restartTour(router) {
  try {
    localStorage.removeItem('optimenu_tour_done');
    sessionStorage.removeItem(SS_KEY);
    sessionStorage.removeItem('optimenu_tour_spot');
  } catch {}
  router.push('/client/dashboard?tour=true');
}