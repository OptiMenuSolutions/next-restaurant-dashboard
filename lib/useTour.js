// lib/useTour.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import TourOverlay from '../components/TourOverlay';

const SS_KEY = 'optimenu_tour_step';

const STEP_TO_PAGE = {
  dashboard: 'dashboard',
  invoices: 'invoices',
  ingredients: 'ingredients',
  'menu-items': 'menu-items',
  analytics: 'analytics',
  final: 'final',
};

export function useTour(page, restaurantId) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [tourPage, setTourPage] = useState(page);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.tour !== 'true') return;
    try { if (localStorage.getItem('optimenu_tour_done') === '1') return; } catch {}

    let resolvedPage = page;
    try {
      const stored = sessionStorage.getItem(SS_KEY);
      if (stored && STEP_TO_PAGE[stored]) resolvedPage = STEP_TO_PAGE[stored];
    } catch {}

    if (resolvedPage === page || (page === 'dashboard' && resolvedPage === 'final')) {
      const tp = (resolvedPage === 'final' && page === 'dashboard') ? 'final' : page;
      setTourPage(tp);
      const t = setTimeout(() => setActive(true), 600);
      return () => clearTimeout(t);
    }
  }, [router.isReady, router.query.tour, page]);

  function handleDone() {
    setActive(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url.toString());
  }

  // Return props instead of a component function — caller renders <TourOverlay> directly
  const tourProps = active && restaurantId
    ? { page: tourPage, restaurantId, onDone: handleDone }
    : null;

  return { tourProps };
}

export function restartTour(router) {
  try {
    localStorage.removeItem('optimenu_tour_done');
    sessionStorage.removeItem(SS_KEY);
    sessionStorage.removeItem('optimenu_tour_seeded');
  } catch {}
  router.push('/client/dashboard?tour=true');
}