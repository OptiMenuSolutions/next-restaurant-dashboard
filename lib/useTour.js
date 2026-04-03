// lib/useTour.js
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { seedSampleData } from './seedSampleData';

const SS_KEY = 'optimenu_tour_step';
const SEED_KEY = 'optimenu_tour_seeded';

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
  // Increments every time sample data finishes seeding — pages watch this to refetch
  const [seedVersion, setSeedVersion] = useState(0);
  const seeding = useRef(false);

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

    const tp = resolvedPage === 'final' && page === 'dashboard' ? 'final' : page;
    setTourPage(tp);

    // Seed sample data if not already done, then activate the tour
    const alreadySeeded = (() => {
      try { return sessionStorage.getItem(SEED_KEY) === '1'; } catch { return false; }
    })();

    if (alreadySeeded || page === 'final') {
      // Data already seeded on a previous page — activate immediately
      const t = setTimeout(() => setActive(true), 400);
      return () => clearTimeout(t);
    }

    if (seeding.current) return; // already seeding
    seeding.current = true;

    // Seed first, then activate — this is the key fix.
    // The tour overlay doesn't show until data is in the DB.
    seedSampleData(restaurantId).then((result) => {
      seeding.current = false;
      if (result.success) {
        try { sessionStorage.setItem(SEED_KEY, '1'); } catch {}
        // Bump version so pages know to refetch
        setSeedVersion(v => v + 1);
        // Also fire the legacy event for dashboard's existing listener
        window.dispatchEvent(new CustomEvent('optimenu-tour-seeded'));
      } else {
        console.error('[tour] Seeding failed, activating anyway:', result.error);
      }
      // Activate after a short delay to let refetch complete
      setTimeout(() => setActive(true), 600);
    });

  }, [router.isReady, router.query.tour, restaurantId, page]);

  function handleDone() {
    setActive(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url.toString());
  }

  const tourProps = active && restaurantId
    ? { page: tourPage, restaurantId, onDone: handleDone }
    : null;

  // seedVersion increments after seeding — pages use this in a useEffect dep array
  // to know when to refetch their data
  return { tourProps, seedVersion };
}

export function restartTour(router) {
  try {
    localStorage.removeItem('optimenu_tour_done');
    sessionStorage.removeItem(SS_KEY);
    sessionStorage.removeItem(SEED_KEY);
    sessionStorage.removeItem('optimenu_tour_spot');
  } catch {}
  router.push('/client/dashboard?tour=true');
}