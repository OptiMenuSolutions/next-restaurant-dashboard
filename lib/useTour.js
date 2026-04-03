// lib/useTour.js
// Imports ONLY from lib — never from components.
// TourOverlay imports ONLY from lib — never from useTour.
// This keeps the dependency graph acyclic and prevents build errors.

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { seedSampleData, clearSampleData } from './seedSampleData';

const SS_KEY   = 'optimenu_tour_step';
const SEED_KEY = 'optimenu_tour_seeded';

const STEP_TO_PAGE = {
  dashboard:    'dashboard',
  invoices:     'invoices',
  ingredients:  'ingredients',
  'menu-items': 'menu-items',
  analytics:    'analytics',
  final:        'final',
};

export function useTour(page, restaurantId) {
  const router = useRouter();
  const [active, setActive]           = useState(false);
  const [tourPage, setTourPage]       = useState(page);
  // Increments after seeding completes — pages watch this to trigger a refetch
  const [seedVersion, setSeedVersion] = useState(0);
  const seeding = useRef(false);

  useEffect(() => {
    if (!router.isReady)              return;
    if (router.query.tour !== 'true') return;
    if (!restaurantId)                return;
    try { if (localStorage.getItem('optimenu_tour_done') === '1') return; } catch {}

    // Resolve which page/step we're on
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

    // Check whether seeding already happened earlier in this tour session
    const alreadySeeded = (() => {
      try { return sessionStorage.getItem(SEED_KEY) === '1'; } catch { return false; }
    })();

    if (alreadySeeded || page === 'final') {
      // Data is already in the DB — activate immediately
      const t = setTimeout(() => setActive(true), 400);
      return () => clearTimeout(t);
    }

    if (seeding.current) return;
    seeding.current = true;

    // Seed FIRST, then activate — tour won't appear until rows are in Supabase
    seedSampleData(restaurantId).then((result) => {
      seeding.current = false;
      if (result.success) {
        try { sessionStorage.setItem(SEED_KEY, '1'); } catch {}
        // Tell all pages to refetch
        setSeedVersion(v => v + 1);
        window.dispatchEvent(new CustomEvent('optimenu-tour-seeded'));
      } else {
        console.error('[tour] Seed failed:', result.error);
      }
      // Short delay so the refetch can start before the overlay appears
      setTimeout(() => setActive(true), 600);
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.tour, restaurantId, page]);

  // onDone is passed to TourOverlay — it calls clearSampleData then cleans up
  async function handleDone() {
    setActive(false);
    try {
      localStorage.setItem('optimenu_tour_done', '1');
      sessionStorage.removeItem(SS_KEY);
      sessionStorage.removeItem(SEED_KEY);
      sessionStorage.removeItem('optimenu_tour_spot');
    } catch {}
    if (restaurantId) await clearSampleData(restaurantId);
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url.toString());
  }

  const tourProps = active && restaurantId
    ? { page: tourPage, restaurantId, onDone: handleDone }
    : null;

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