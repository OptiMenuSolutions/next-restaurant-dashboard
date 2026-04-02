// lib/useTour.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

const TourOverlay = dynamic(() => import('../components/TourOverlay'), { ssr: false });

const SS_KEY = 'optimenu_tour_step';

// Map sessionStorage step keys to page names
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

    // Check if tour should be active
    const hasTourParam = router.query.tour === 'true';
    if (!hasTourParam) return;

    // Check if already completed
    try {
      if (localStorage.getItem('optimenu_tour_done') === '1') return;
    } catch {}

    // Determine which tour page to show based on sessionStorage
    let resolvedPage = page;
    try {
      const stored = sessionStorage.getItem(SS_KEY);
      if (stored && STEP_TO_PAGE[stored]) {
        resolvedPage = STEP_TO_PAGE[stored];
      }
    } catch {}

    // Only activate if this page matches where the tour should be
    if (resolvedPage === page || (page === 'dashboard' && resolvedPage === 'final')) {
      setTourPage(resolvedPage === 'final' && page === 'dashboard' ? 'final' : page);
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

  function TourComponent() {
    if (!active || !restaurantId) return null;
    return (
      <TourOverlay
        page={tourPage}
        restaurantId={restaurantId}
        onDone={handleDone}
      />
    );
  }

  return { TourComponent, tourActive: active };
}

export function restartTour(router) {
  try {
    localStorage.removeItem('optimenu_tour_done');
    sessionStorage.removeItem(SS_KEY);
  } catch {}
  router.push('/client/dashboard?tour=true');
}