// lib/useTour.js
// React port of the guided-tour state machine found inline (duplicated per
// page) inside the Claude Design .dc.html comps. Same behavior, one shared
// implementation instead of five copies: ?tour=true starts it, progress
// persists across page navigation via sessionStorage, completion persists
// via localStorage, click-target steps advance on clicking the highlighted
// element, and cross-page steps navigate via Next's router instead of a
// raw page reload.
//
// Usage: const tour = useTour('dashboard'); then pass `tour` to <TourOverlay />.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { PAGE_STEPS, PAGE_ORDER, totalSteps, pageOffset, getSpot, getTooltipPos } from './tourSteps';

const DONE_KEY = 'optimenu_tour_done';
const STEP_KEY = 'optimenu_tour_step';
const TT_WIDTH = 340;
const TT_HEIGHT = 180;

export function useTour(pageKey) {
  const router = useRouter();
  const steps = PAGE_STEPS[pageKey] || [];

  const [tourOn, setTourOn] = useState(false);
  const [tourIdx, setTourIdx] = useState(0);
  const [tourSpot, setTourSpot] = useState(null);
  const [tourTtPos, setTourTtPos] = useState(null);
  const [tourVisible, setTourVisible] = useState(false);

  // Refs mirror the latest state for use inside event handlers/timeouts,
  // which otherwise close over whatever tourIdx/tourSpot were at the time
  // the handler was attached (the original class component didn't have
  // this problem — `this.state` is always current).
  const tourIdxRef = useRef(0);
  useEffect(() => { tourIdxRef.current = tourIdx; }, [tourIdx]);
  const tourSpotRef = useRef(null);
  useEffect(() => { tourSpotRef.current = tourSpot; }, [tourSpot]);

  const retryTimeout = useRef(null);
  const visibleTimeout = useRef(null);
  const clickHandler = useRef(null);
  const resizeHandler = useRef(null);

  const clearRetry = () => { if (retryTimeout.current) clearTimeout(retryTimeout.current); };
  const clearClickHandler = () => {
    if (clickHandler.current) {
      document.removeEventListener('click', clickHandler.current);
      clickHandler.current = null;
    }
  };

  const positionStep = useCallback((idx) => {
    const step = steps[idx];
    if (!step) return;
    clearRetry();

    const attempt = () => {
      const spot = getSpot(step.selector, step.padding || 12);
      if (step.selector && !spot) {
        retryTimeout.current = setTimeout(attempt, 200);
        return;
      }
      const ttPos = getTooltipPos(spot, TT_WIDTH, TT_HEIGHT);
      setTourIdx(idx);
      setTourSpot(spot);
      setTourTtPos(ttPos);
      setTourVisible(false);
      if (visibleTimeout.current) clearTimeout(visibleTimeout.current);
      visibleTimeout.current = setTimeout(() => setTourVisible(true), 60);
    };
    attempt();

    clearClickHandler();
    if (step.clickTarget) {
      setTimeout(() => {
        const handler = (e) => {
          const sp = tourSpotRef.current;
          if (!sp) return;
          if (e.clientX >= sp.x && e.clientX <= sp.x + sp.w && e.clientY >= sp.y && e.clientY <= sp.y + sp.h) {
            clearClickHandler();
            setTimeout(() => positionStep(idx + 1), 400);
          }
        };
        clickHandler.current = handler;
        document.addEventListener('click', handler);
      }, 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  const done = useCallback(() => {
    clearClickHandler();
    if (resizeHandler.current) {
      window.removeEventListener('resize', resizeHandler.current);
      resizeHandler.current = null;
    }
    localStorage.setItem(DONE_KEY, '1');
    sessionStorage.removeItem(STEP_KEY);
    setTourOn(false);
  }, []);

  const goNext = useCallback(() => {
    const step = steps[tourIdxRef.current];
    if (!step) return;
    if (step.finish) { done(); return; }
    if (step.nav) {
      sessionStorage.setItem(STEP_KEY, step.nextKey);
      router.push(`/client/${step.nextKey}?tour=true`);
      return;
    }
    positionStep(tourIdxRef.current + 1);
  }, [steps, done, positionStep, router]);

  const goBack = useCallback(() => {
    if (tourIdxRef.current > 0) positionStep(tourIdxRef.current - 1);
  }, [positionStep]);

  // Auto-start: only if ?tour=true, not already completed, and — for a
  // fresh start with no stored step — only on the tour's first page. A
  // stored step means the tour is resuming after a nav step, and only
  // resumes on the page it was told to resume on.
  useEffect(() => {
    if (!router.isReady) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tour') !== 'true') return;
    if (localStorage.getItem(DONE_KEY) === '1') return;
    const stored = sessionStorage.getItem(STEP_KEY);
    if (stored ? stored !== pageKey : pageKey !== PAGE_ORDER[0]) return;

    setTourOn(true);
    const startTimeout = setTimeout(() => positionStep(0), 300);
    const onResize = () => positionStep(tourIdxRef.current);
    resizeHandler.current = onResize;
    window.addEventListener('resize', onResize);

    return () => {
      clearTimeout(startTimeout);
      clearRetry();
      clearClickHandler();
      if (resizeHandler.current) {
        window.removeEventListener('resize', resizeHandler.current);
        resizeHandler.current = null;
      }
      if (visibleTimeout.current) clearTimeout(visibleTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, pageKey]);

  // Computed render values for TourOverlay — mirrors the original's
  // _tourVals(), recomputed fresh each render from current state.
  if (!tourOn) return { active: false };

  const step = steps[tourIdx] || steps[0];
  const spot = tourSpot;
  const ttPos = tourTtPos || { left: 100, top: 100 };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const clipPath = spot
    ? `M0,0 H${vw} V${vh} H0 Z M${spot.x},${spot.y} h${spot.w} v${spot.h} h-${spot.w} Z`
    : `M0,0 H${vw} V${vh} H0 Z`;
  const isClick = !!step.clickTarget;
  const total = totalSteps();
  const globalIdx = pageOffset(pageKey) + tourIdx + 1;
  const nextLabel = step.nav ? 'Take me there \u2192' : isClick ? 'Skip \u2192' : step.finish ? '\u2713 Done' : 'Next \u2192';

  return {
    active: true,
    vw, vh,
    clipPath,
    hasSpot: !!spot,
    ringLeft: spot ? spot.x : 0,
    ringTop: spot ? spot.y : 0,
    ringWidth: spot ? spot.w : 0,
    ringHeight: spot ? spot.h : 0,
    ringBorder: isClick ? '2px solid var(--amber)' : '2px solid var(--accent)',
    ringGlow: isClick
      ? '0 0 0 4px color-mix(in srgb, var(--amber) 20%, transparent)'
      : '0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent)',
    pointerEvents: isClick ? 'none' : 'all',
    ttLeft: ttPos.left,
    ttTop: ttPos.top,
    ttOpacity: tourVisible ? 1 : 0,
    eyebrow: pageKey.replace('-', ' ') + ' \u00b7 step ' + (tourIdx + 1) + ' of ' + steps.length + (isClick ? ' \u00b7 click to continue' : ''),
    eyebrowColor: isClick ? 'var(--amber)' : 'var(--accent-deep)',
    title: step.title,
    text: step.text,
    isClick,
    showBack: tourIdx > 0 && !step.nav && !step.finish && !isClick,
    goBack,
    goNext,
    skip: done,
    nextLabel,
    nextBg: isClick ? 'none' : 'var(--accent)',
    nextBorder: isClick ? '1px solid var(--line)' : 'none',
    nextColor: isClick ? 'var(--muted)' : '#fff',
    dots: Array.from({ length: total }, (_, i) => ({
      bg: i === globalIdx - 1
        ? 'var(--accent)'
        : i < globalIdx - 1
          ? 'color-mix(in srgb, var(--accent) 40%, var(--line))'
          : 'var(--line)',
      w: i === globalIdx - 1 ? '16px' : '6px',
    })),
    progress: globalIdx + ' / ' + total,
  };
}
