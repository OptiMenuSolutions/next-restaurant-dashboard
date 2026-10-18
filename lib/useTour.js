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
import { PAGE_STEPS, PAGE_ORDER, totalSteps, pageOffset, getSpot, getTooltipPos, roundedRectHole } from './tourSteps';

const DONE_KEY = 'optimenu_tour_done';
const STEP_KEY = 'optimenu_tour_step';
const STEP_INDEX_KEY = 'optimenu_tour_step_index';
const TT_WIDTH = 340;
const TT_HEIGHT = 180;

// While the tour runs, the page does not scroll under the user's finger,
// mouse wheel or trackpad. The tour itself can still scroll a step's target
// into view (scrollIntoView works on overflow:hidden areas), and taps still
// pass through on tap-to-continue steps.
const LOCK_CSS =
  'html.om-tour-lock,html.om-tour-lock body{overflow:hidden!important;overscroll-behavior:none}' +
  'html.om-tour-lock .om-mscroll{overflow:hidden!important;overscroll-behavior:none}';
const blockScroll = (e) => e.preventDefault();
function lockScroll() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('om-tour-lock')) {
    const s = document.createElement('style');
    s.id = 'om-tour-lock';
    s.textContent = LOCK_CSS;
    document.head.appendChild(s);
  }
  document.documentElement.classList.add('om-tour-lock');
  document.addEventListener('touchmove', blockScroll, { passive: false });
  document.addEventListener('wheel', blockScroll, { passive: false });
}
function unlockScroll() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.remove('om-tour-lock');
  document.removeEventListener('touchmove', blockScroll);
  document.removeEventListener('wheel', blockScroll);
}

export function useTour(pageKey) {
  const router = useRouter();
  const steps = PAGE_STEPS[pageKey] || [];
  // A step can carry a `phone` override (different target or wording) for the
  // phone layouts. The step count stays the same on every device, so the
  // progress dots and counter still line up.
  const stepAt = (i) => {
    const s = steps[i];
    if (!s || !s.phone || typeof window === 'undefined' || window.innerWidth > 900) return s;
    return { ...s, ...s.phone };
  };

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
    const step = stepAt(idx);
    if (!step) return;
    clearRetry();
    let tries = 0;

    // Phones: ask the screen to show the view this step needs (list, detail,
    // a tab) before measuring, so going Back after a tap lands cleanly.
    // Forward steps are a no-op because the view already matches.
    if (step.view && window.innerWidth <= 900) {
      try { window.dispatchEvent(new CustomEvent('optimenu-tour-view', { detail: { page: pageKey, view: step.view } })); } catch {}
    }

    const attempt = () => {
      // Phones: bring the target to the middle of the screen first, since the
      // phone layouts scroll and it may be below the fold.
      if (step.selector && window.innerWidth <= 900) {
        try {
          const el = document.querySelector(step.selector);
          if (el) {
            const tall = el.getBoundingClientRect().height > window.innerHeight * 0.55;
            el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' });
          }
        } catch {}
      }
      const spot = getSpot(step.selector, step.padding || 12);
      // Target not on screen yet (still rendering): retry for about 2 seconds,
      // then show the step without a highlight rather than hang.
      if (step.selector && !spot && tries < 10) {
        tries += 1;
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

  // Re-measures the current step's highlight without scrolling, resetting
  // the fade, or re-arming the click handler. Kept in a ref so the scroll and
  // resize listeners always call the latest version.
  const remeasureRef = useRef(() => {});
  remeasureRef.current = () => {
    const step = stepAt(tourIdxRef.current);
    if (!step) return;
    const spot = getSpot(step.selector, step.padding || 12);
    if (step.selector && !spot) return;
    setTourSpot(spot);
    setTourTtPos(getTooltipPos(spot, TT_WIDTH, TT_HEIGHT));
  };

  const done = useCallback(() => {
    clearClickHandler();
    if (resizeHandler.current) {
      window.removeEventListener('resize', resizeHandler.current);
      window.removeEventListener('scroll', resizeHandler.current, true);
      resizeHandler.current = null;
    }
    unlockScroll();
    localStorage.setItem(DONE_KEY, '1');
    sessionStorage.removeItem(STEP_KEY);
    setTourOn(false);
    // dashboard.js's data effect already includes a fresh tourActive read
    // in its dependency array and self-heals on its own; the other four
    // pages (invoices/ingredients/menu-items/analytics) fetch once on
    // mount and never re-check, so tell them explicitly the tour ended.
    try { window.dispatchEvent(new Event('optimenu-tour-ended')); } catch {}
  }, []);

  const goNext = useCallback(() => {
    const step = stepAt(tourIdxRef.current);
    if (!step) return;
    if (step.finish) { done(); return; }
    if (step.nav) {
      sessionStorage.setItem(STEP_KEY, step.nextKey);
      sessionStorage.removeItem(STEP_INDEX_KEY); // forward nav always starts a page at step 0
      router.push(`/client/${step.nextKey}?tour=true`);
      return;
    }
    positionStep(tourIdxRef.current + 1);
  }, [steps, done, positionStep, router]);

  const goBack = useCallback(() => {
    if (tourIdxRef.current > 0) { positionStep(tourIdxRef.current - 1); return; }
    const pageIdx = PAGE_ORDER.indexOf(pageKey);
    if (pageIdx <= 0) return; // already the very first step of the whole tour
    const prevPage = PAGE_ORDER[pageIdx - 1];
    sessionStorage.setItem(STEP_KEY, prevPage);
    sessionStorage.setItem(STEP_INDEX_KEY, String(PAGE_STEPS[prevPage].length - 1));
    router.push(`/client/${prevPage}?tour=true`);
  }, [pageKey, positionStep, router]);

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

    const storedIdxRaw = sessionStorage.getItem(STEP_INDEX_KEY);
    sessionStorage.removeItem(STEP_INDEX_KEY);
    const storedIdx = parseInt(storedIdxRaw, 10);
    const startIdx = Number.isFinite(storedIdx) && storedIdx >= 0 && storedIdx < steps.length ? storedIdx : 0;

    setTourOn(true);
    lockScroll();
    const startTimeout = setTimeout(() => positionStep(startIdx), 300);
    // Resizes and scrolls only re-measure the highlight so it follows its
    // element; they never re-scroll the page. Capture mode also catches
    // scrolling inside the phone layouts' own scroll areas.
    let frame = null;
    const onMove = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = null; remeasureRef.current(); });
    };
    resizeHandler.current = onMove;
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);

    return () => {
      clearTimeout(startTimeout);
      clearRetry();
      clearClickHandler();
      if (resizeHandler.current) {
        window.removeEventListener('resize', resizeHandler.current);
        window.removeEventListener('scroll', resizeHandler.current, true);
        resizeHandler.current = null;
      }
      if (frame) cancelAnimationFrame(frame);
      unlockScroll();
      if (visibleTimeout.current) clearTimeout(visibleTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, pageKey]);

  // Computed render values for TourOverlay — mirrors the original's
  // _tourVals(), recomputed fresh each render from current state.
  if (!tourOn) return { active: false };

  const step = stepAt(tourIdx) || steps[0];
  const spot = tourSpot;
  const ttPos = tourTtPos || { left: 100, top: 100 };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const clipPath = spot
    ? `M0,0 H${vw} V${vh} H0 Z ${roundedRectHole(spot.x, spot.y, spot.w, spot.h, 10)}`
    : `M0,0 H${vw} V${vh} H0 Z`;
  // A tap-to-continue step whose target never appeared falls back to a
  // normal step, so the Next button shows instead of leaving no way forward.
  const isClick = !!step.clickTarget && !!spot;
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
    showBack: !(pageKey === PAGE_ORDER[0] && tourIdx === 0),
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
