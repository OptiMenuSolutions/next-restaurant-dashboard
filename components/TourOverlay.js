// components/TourOverlay.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { seedSampleData, clearSampleData } from '../lib/seedSampleData';

const MenuImportModal = dynamic(() => import('./MenuImportModal'), { ssr: false });

const SS_KEY = 'optimenu_tour_step';
const SEED_KEY = 'optimenu_tour_seeded';

const PAGE_STEPS = {
  dashboard: [
    { selector: null, title: 'Welcome to OptiMenu 👋', text: "We've loaded sample Chick-fil-A data so you can see what a fully populated account looks like. Let's take a 2-minute tour." },
    { selector: '.db-wbar', placement: 'bottom', padding: 10, title: 'Your Key Metrics', text: 'These five numbers give you a real-time pulse — invoices, ingredients, menu items, average margin, and year-to-date spend.' },
    { selector: '.db-panel', placement: 'right', padding: 8, title: 'AI Profit Score', text: 'This score reflects your overall financial health based on margin quality, invoice coverage, and ingredient pricing completeness.' },
    { selector: null, nav: true, title: 'Next: Invoices', text: 'Click "Take me there" to see invoice tracking with sample supplier data.', nextPage: '/client/invoices', nextKey: 'invoices' },
  ],
  invoices: [
    { selector: '.mi-ph', placement: 'bottom', padding: 10, title: 'Invoice Tracking', text: "Sample invoices from Chick-fil-A's real supplier network. Upload your own and OptiMenu reads every line item automatically." },
    { selector: '.mi-add-btn', placement: 'bottom', padding: 8, title: 'Add an Invoice', text: 'Upload a PDF or photo of any supplier invoice. Claude extracts items and prices in under 30 seconds.' },
    { selector: null, nav: true, title: 'Next: Ingredients', text: 'Click "Take me there" to see ingredient cost tracking.', nextPage: '/client/ingredients', nextKey: 'ingredients' },
  ],
  ingredients: [
    { selector: '.mi-ph', placement: 'bottom', padding: 10, title: 'Ingredient Cost Tracking', text: '24 core Chick-fil-A ingredients with real market costs. Populates automatically from your invoices.' },
    { selector: '.mi-grid-wrap', placement: 'top', padding: 8, title: 'Live Cost Updates', text: 'Every ingredient links to your menu items. When a supplier raises prices, your margins recalculate instantly.' },
    { selector: null, nav: true, title: 'Next: Menu Items', text: 'Click "Take me there" to see menu engineering.', nextPage: '/client/menu-items', nextKey: 'menu-items' },
  ],
  'menu-items': [
    { selector: '.mi-sbar', placement: 'bottom', padding: 10, title: 'Menu Engineering', text: '30 Chick-fil-A menu items with real prices and food costs. Waffle Fries run 83% margin.' },
    { selector: '.mi-grid', placement: 'top', padding: 8, title: 'Margin at a Glance', text: 'Green = healthy margin. Red = needs attention. Click any card for a full breakdown and pricing optimizer.' },
    { selector: null, nav: true, title: 'Next: Analytics', text: 'Click "Take me there" to see sales analytics.', nextPage: '/client/analytics', nextKey: 'analytics' },
  ],
  analytics: [
    { selector: '.an-ph', placement: 'bottom', padding: 10, title: 'Sales Analytics', text: 'Upload a CSV from your POS and OptiMenu maps sales velocity against ingredient costs.' },
    { selector: null, nav: true, title: 'Back to Dashboard', text: 'Last stop — click "Take me there" to finish and import your real menu.', nextPage: '/client/dashboard', nextKey: 'final' },
  ],
  final: [
    { selector: null, title: 'One Last Step 🎉', text: 'The sample data will be cleared. Upload a photo or PDF of your real menu and Claude will extract every dish automatically.' },
    { selector: null, modal: true, title: 'Import Your Menu', text: 'Upload your menu now to complete the tour.' },
  ],
};

function getSpotRect(selector, pad = 12) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}

function getTTPos(spot, placement, tw, th) {
  const vw = window.innerWidth, vh = window.innerHeight, g = 16;
  if (!spot) return { left: (vw - tw) / 2, top: (vh - th) / 2 };
  const { x, y, w, h } = spot;
  let left, top;
  if (placement === 'bottom') { left = x + w / 2 - tw / 2; top = y + h + g; }
  else if (placement === 'top') { left = x + w / 2 - tw / 2; top = y - th - g; }
  else if (placement === 'right') { left = x + w + g; top = y + h / 2 - th / 2; }
  else { left = x + w / 2 - tw / 2; top = y + h + g; }
  if (top + th > vh - 60) top = y - th - g;
  if (top < 10) top = y + h + g;
  return {
    left: Math.max(16, Math.min(vw - tw - 16, left)),
    top: Math.max(10, Math.min(vh - th - 70, top)),
  };
}

export default function TourOverlay({ page, restaurantId, onDone }) {
  const router = useRouter();
  const steps = PAGE_STEPS[page] || [];
  const [idx, setIdx] = useState(0);
  const [spot, setSpot] = useState(null);
  const [ttPos, setTtPos] = useState({ left: 0, top: 0 });
  const [visible, setVisible] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const ttRef = useRef();
  const idxRef = useRef(0);
  const timers = useRef([]);

  const step = steps[idx];
  const isLast = idx === steps.length - 1;

  function addTimer(fn, ms) {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  }

  // Clear all timers on unmount
  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  // ── Seed once per tour session ─────────────────────────────────────────────
  useEffect(() => {
    if (!restaurantId || page === 'final') return;
    if (sessionStorage.getItem(SEED_KEY)) return;
    sessionStorage.setItem(SEED_KEY, '1');
    seedSampleData(restaurantId).then(() => {
      window.dispatchEvent(new CustomEvent('optimenu-tour-seeded'));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps — run once on mount only

  // ── Measure spotlight ─────────────────────────────────────────────────────
  function doMeasure(stepObj) {
    if (!stepObj) return;
    const s = stepObj.selector ? getSpotRect(stepObj.selector, stepObj.padding) : null;
    setSpot(s);
    const tw = ttRef.current?.offsetWidth || 340;
    const th = ttRef.current?.offsetHeight || 200;
    setTtPos(getTTPos(s, stepObj.placement, tw, th));
  }

  // Run measure when idx changes — delay on first step only
  useEffect(() => {
    setVisible(false);
    const currentStep = steps[idx];
    const delay = idx === 0 ? 700 : 200;
    addTimer(() => {
      doMeasure(currentStep);
      addTimer(() => setVisible(true), 100);
    }, delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]); // only idx — no callbacks in deps

  // Auto-open modal
  useEffect(() => {
    if (step?.modal) {
      addTimer(() => setShowModal(true), 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // ── Navigation ────────────────────────────────────────────────────────────
  function goNext() {
    if (step?.modal) { setShowModal(true); return; }
    if (step?.nav && step.nextPage) {
      try { sessionStorage.setItem(SS_KEY, step.nextKey); } catch {}
      router.push(`${step.nextPage}?tour=true`);
      return;
    }
    if (isLast) { finish(); return; }
    setVisible(false);
    addTimer(() => {
      idxRef.current = idx + 1;
      setIdx(idx + 1);
    }, 150);
  }

  function goBack() {
    if (idx === 0) return;
    setVisible(false);
    addTimer(() => {
      idxRef.current = idx - 1;
      setIdx(idx - 1);
    }, 150);
  }

  async function finish() {
    setVisible(false);
    setShowModal(false);
    try {
      localStorage.setItem('optimenu_tour_done', '1');
      sessionStorage.removeItem(SS_KEY);
      sessionStorage.removeItem(SEED_KEY);
    } catch {}
    if (restaurantId) await clearSampleData(restaurantId);
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url.toString());
    onDone?.();
  }

  if (!step) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const clip = spot
    ? `M0,0 H${vw} V${vh} H0 Z M${spot.x},${spot.y} h${spot.w} v${spot.h} h-${spot.w} Z`
    : `M0,0 H${vw} V${vh} H0 Z`;

  const allKeys = ['dashboard','invoices','ingredients','menu-items','analytics','final'];
  const pageOffset = allKeys.slice(0, allKeys.indexOf(page))
    .reduce((s, k) => s + (PAGE_STEPS[k]?.length || 0), 0);
  const globalIdx = pageOffset + idx + 1;
  const total = Object.values(PAGE_STEPS).reduce((s, a) => s + a.length, 0);

  // When modal is showing, hide the overlay so import modal is fully visible
  if (showModal) {
    return (
      <MenuImportModal
        restaurantId={restaurantId}
        onClose={finish}
        onImported={finish}
      />
    );
  }

  return (
    <>
      <style>{`
        @keyframes t-fade{from{opacity:0}to{opacity:1}}
        @keyframes t-up{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
        @keyframes t-ring{0%{box-shadow:0 0 0 0 rgba(2,164,186,.5)}60%{box-shadow:0 0 0 10px rgba(2,164,186,0)}100%{box-shadow:0 0 0 0 rgba(2,164,186,0)}}
        @keyframes t-blink{0%,100%{opacity:1}50%{opacity:.3}}
        .t-root{position:fixed;inset:0;z-index:9998;pointer-events:none;animation:t-fade .3s ease both;}
        .t-svg{position:absolute;inset:0;width:100%;height:100%;}
        .t-svg path{fill:rgba(0,0,0,.75);fill-rule:evenodd;transition:d .5s cubic-bezier(.4,0,.2,1);}
        .t-ring{position:absolute;border-radius:10px;pointer-events:none;border:2px solid #02a4ba;
          animation:t-ring 2s ease infinite;
          transition:left .5s cubic-bezier(.4,0,.2,1),top .5s cubic-bezier(.4,0,.2,1),
                     width .5s cubic-bezier(.4,0,.2,1),height .5s cubic-bezier(.4,0,.2,1);}
        .t-tt{position:fixed;width:340px;background:#13120f;border:1px solid #3a3630;border-radius:14px;
          box-shadow:0 24px 64px rgba(0,0,0,.8),0 0 0 1px rgba(2,164,186,.12);
          font-family:'Inter',sans-serif;pointer-events:all;z-index:9999;}
        .t-tt.vis{animation:t-up .25s cubic-bezier(.4,0,.2,1) both;}
        .t-body{padding:18px 20px 14px;}
        .t-ey{font-size:10px;font-weight:600;color:#02a4ba;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;}
        .t-ti{font-family:'Playfair Display',serif;font-size:17px;color:#e8e2d8;line-height:1.25;margin-bottom:8px;}
        .t-tx{font-size:13px;color:#6b6358;line-height:1.65;}
        .t-ft{display:flex;align-items:center;gap:8px;padding:11px 20px;border-top:1px solid #2a2620;}
        .t-skip{background:none;border:none;cursor:pointer;font-size:11px;color:#3a3630;font-family:'Inter',sans-serif;padding:5px 8px;border-radius:5px;transition:color .15s;margin-right:auto;}
        .t-skip:hover{color:#6b6358;}
        .t-back{background:none;border:1px solid #2a2620;border-radius:8px;padding:7px 14px;font-size:12px;color:#4a453e;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;}
        .t-back:hover{color:#9a9086;border-color:#3a3630;}
        .t-next{background:#02a4ba;border:none;border-radius:8px;padding:7px 18px;font-size:12px;font-weight:600;color:#0a0908;cursor:pointer;font-family:'Inter',sans-serif;transition:background .15s;}
        .t-next:hover{background:#01bcd4;}
        .t-prog{position:fixed;bottom:20px;right:20px;z-index:10000;pointer-events:none;
          background:#13120f;border:1px solid #2a2620;border-radius:20px;padding:5px 12px;
          display:flex;align-items:center;gap:8px;font-size:11px;color:#4a453e;font-family:'Inter',sans-serif;}
        .t-dots{display:flex;gap:4px;}
        .t-dot{width:5px;height:5px;border-radius:50%;background:#2a2620;transition:all .2s;}
        .t-dot.active{background:#02a4ba;transform:scale(1.4);}
        .t-dot.done{background:rgba(2,164,186,.35);}
        .t-badge{position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:10000;pointer-events:none;
          background:rgba(212,160,32,.1);border:1px solid rgba(212,160,32,.25);border-radius:20px;
          padding:5px 14px;font-size:11px;color:#d4a020;font-family:'Inter',sans-serif;
          display:flex;align-items:center;gap:6px;}
        .t-badge-dot{width:5px;height:5px;border-radius:50%;background:#d4a020;animation:t-blink 1.8s ease infinite;}
      `}</style>

      <div className="t-root">
        <svg className="t-svg" viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none">
          <path d={clip} />
        </svg>

        {spot && (
          <div className="t-ring"
            style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} />
        )}

        {page !== 'final' && (
          <div className="t-badge">
            <div className="t-badge-dot" />
            Showing sample Chick-fil-A data
          </div>
        )}

        <div ref={ttRef} className={`t-tt${visible ? ' vis' : ''}`}
          style={{ left: ttPos.left, top: ttPos.top }}>
          <div className="t-body">
            <div className="t-ey">
              {page === 'final' ? 'Final Step' : `${page.replace('-', ' ')} · Step ${idx + 1} of ${steps.length}`}
            </div>
            <div className="t-ti">{step.title}</div>
            <div className="t-tx">{step.text}</div>
          </div>
          <div className="t-ft">
            <button className="t-skip" onClick={finish}>Skip tour</button>
            {idx > 0 && !step.nav && !step.modal && (
              <button className="t-back" onClick={goBack}>← Back</button>
            )}
            <button className="t-next" onClick={goNext}>
              {step.nav ? 'Take me there →' : step.modal ? 'Import Menu ↑' : isLast ? '✓ Done' : 'Next →'}
            </button>
          </div>
        </div>

        <div className="t-prog">
          <div className="t-dots">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className={`t-dot${i === globalIdx - 1 ? ' active' : i < globalIdx - 1 ? ' done' : ''}`} />
            ))}
          </div>
          <span>{globalIdx} / {total}</span>
        </div>
      </div>
    </>
  );
}