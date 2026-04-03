// components/TourOverlay.js
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import MenuImportModal from './MenuImportModal';

const SS_KEY   = 'optimenu_tour_step';
const SPOT_KEY = 'optimenu_tour_spot';

// ─── Tour steps ───────────────────────────────────────────────────────────────
//
// Step types:
//   selector + no clickTarget  → spotlight + Next button advances
//   clickTarget                → spotlight element, user must click it to advance
//   nav: true                  → "Take me there" navigates to nextPage
//   finishTour: true           → marks tour done before navigating (prevents restart)
//   modal: true                → opens MenuImportModal

const PAGE_STEPS = {
  dashboard: [
    {
      selector: null,
      title: 'Welcome to OptiMenu 👋',
      text: "We've loaded sample Chick-fil-A data so you can see what a fully populated account looks like. Let's take a 2-minute tour.",
    },
    {
      // Highlights the 4 main dashboard cards below the welcome bar
      selector: '.db-grid-wrap',
      placement: 'top',
      padding: 6,
      title: 'Your Dashboard',
      text: 'AI recommendations, menu margin analysis, recent invoices, monthly spending, and top ingredient costs — all at a glance.',
    },
    {
      selector: '.db-panel',
      placement: 'right',
      padding: 8,
      title: 'AI Profit Score',
      text: 'This score reflects your overall financial health based on margin quality, invoice coverage, and ingredient pricing completeness.',
    },
    {
      selector: null,
      nav: true,
      title: 'Next: Invoices',
      text: 'Click "Take me there" to see invoice tracking with sample supplier data.',
      nextPage: '/client/invoices',
      nextKey: 'invoices',
    },
  ],
  invoices: [
    {
      selector: '.inv-upload-btn',
      placement: 'bottom',
      padding: 8,
      title: 'Add an Invoice',
      text: 'Upload a PDF or photo of any supplier invoice. Claude extracts items and prices in under 30 seconds.',
    },
    {
      selector: '.inv-list',
      placement: 'right',
      padding: 8,
      title: 'Invoice Tracking',
      text: "Sample invoices from Chick-fil-A's real supplier network. Upload your own and OptiMenu reads every line item automatically.",
    },
    {
      selector: '.inv-detail',
      placement: 'left',
      padding: 8,
      title: 'Invoice Overview',
      text: 'Monthly spend trends, processing breakdown, and top suppliers by spend. Click any invoice row to see full line-item detail.',
    },
    {
      selector: null,
      nav: true,
      title: 'Next: Ingredients',
      text: 'Click "Take me there" to see ingredient cost tracking.',
      nextPage: '/client/ingredients',
      nextKey: 'ingredients',
    },
  ],
  ingredients: [
    {
      // Step 1: highlight the full list panel
      selector: '.ing-list',
      placement: 'right',
      padding: 8,
      title: 'Ingredient List',
      text: '24 core Chick-fil-A ingredients with real market costs. Click any ingredient to see its price history.',
    },
    {
      // Step 2: highlight the overview panel (no ingredient selected yet)
      selector: '.ing-detail',
      placement: 'left',
      padding: 8,
      title: 'Ingredient Overview',
      text: 'This panel shows your most expensive ingredients, price trends, and a watch list of rising costs.',
    },
    {
      // Step 3: ask the user to click an ingredient row
      selector: '.ing-row',
      placement: 'bottom',
      padding: 6,
      clickTarget: '.ing-row',
      title: 'Click an Ingredient',
      text: 'Click this ingredient to see its individual price history, purchase records, and which menu items it affects.',
    },
    {
      // Step 4: after clicking, the detail panel shows ingredient-specific data
      selector: '.ing-detail',
      placement: 'left',
      padding: 8,
      title: 'Live Cost Updates',
      text: 'Every ingredient links to your menu items. When a supplier raises prices, your margins recalculate instantly across every dish that uses it.',
    },
    {
      selector: null,
      nav: true,
      title: 'Next: Menu Items',
      text: 'Click "Take me there" to see menu engineering.',
      nextPage: '/client/menu-items',
      nextKey: 'menu-items',
    },
  ],
  'menu-items': [
    {
      // Step 1: highlight the full card grid
      selector: '.mi-grid-wrap',
      placement: 'right',
      padding: 8,
      title: 'Menu Item Cards',
      text: '30 Chick-fil-A menu items with real prices and food costs. Green = healthy margin, red = needs attention.',
    },
    {
      // Step 2: highlight the detail panel (overview state, no item selected)
      selector: '.mi-detail',
      placement: 'left',
      padding: 8,
      title: 'Menu Overview',
      text: 'Top margin items, items that need attention, and a margin distribution chart across your whole menu.',
    },
    {
      // Step 3: ask user to click a menu card
      selector: '.mi-card',
      placement: 'bottom',
      padding: 6,
      clickTarget: '.mi-card',
      title: 'Click a Menu Item',
      text: 'Click this card to see a full ingredient-level cost breakdown and pricing recommendations.',
    },
    {
      // Step 4: detail panel now shows item-specific data
      selector: '.mi-detail',
      placement: 'left',
      padding: 8,
      title: 'Item Deep Dive',
      text: 'Ingredient-level cost breakdown, pricing recommendations at 30/25/20% food cost targets, and a what-if optimizer for portion sizes.',
    },
    {
      selector: null,
      nav: true,
      title: 'Next: Analytics',
      text: 'Click "Take me there" to see sales analytics.',
      nextPage: '/client/analytics',
      nextKey: 'analytics',
    },
  ],
  analytics: [
    {
      // Step 1: highlight just the upload zone
      selector: '.an-upload-zone',
      placement: 'bottom',
      padding: 8,
      title: 'Upload POS Data',
      text: 'Export a CSV from your POS system — Toast, Square, Clover, Lightspeed — and drop it here. OptiMenu maps sales velocity against ingredient costs.',
    },
    {
      // Step 2: dish recommendations card
      selector: '.an-card',
      placement: 'bottom',
      padding: 8,
      title: "Today's Dish Recommendations",
      text: 'Claude analyzes your margins, inventory, and sales velocity to tell you exactly which dishes to push each day and why.',
    },
    {
      // Step 3: highlight the stats bar
      selector: '.an-sbar',
      placement: 'bottom',
      padding: 6,
      title: 'Sales at a Glance',
      text: 'Days of data, total revenue, average daily revenue, and your top seller — updated every time you sync your POS.',
    },
    {
      // Step 4: import menu modal as final step
      selector: null,
      modal: true,
      title: 'Import Your Menu',
      text: "Last step — upload a photo or PDF of your real menu and Claude will extract every dish automatically. You're almost ready to go.",
    },
  ],
  // final page kept for backwards compatibility but no longer used in main flow
  final: [
    {
      selector: null,
      title: 'You\'re all set 🎉',
      text: 'Your menu is imported. OptiMenu is ready to help you run a more profitable kitchen.',
    },
  ],
};

const TRANSITION_MS = 400;
const EASE = 'cubic-bezier(.4,0,.2,1)';
const TYPE_SPEED = 16;

// ─── Typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(text, active) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  const charIdx = useRef(0);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!active || !text) {
      setDisplayed(''); setDone(false); charIdx.current = 0; return;
    }
    setDisplayed(''); setDone(false); charIdx.current = 0;
    function tick() {
      charIdx.current += 1;
      setDisplayed(text.slice(0, charIdx.current));
      if (charIdx.current < text.length) {
        timer.current = setTimeout(tick, TYPE_SPEED);
      } else { setDone(true); }
    }
    timer.current = setTimeout(tick, TYPE_SPEED);
    return () => clearTimeout(timer.current);
  }, [text, active]);

  return { displayed, done };
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function getSpot(selector, pad) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}

function getTooltipPos(spot, ttW, ttH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const g = 16;
  let left, top;
  if (!spot) {
    left = Math.max(16, (vw - ttW) / 2);
    top  = Math.max(16, (vh - ttH) / 2);
  } else {
    const { x, y, w, h } = spot;
    left = x + w / 2 - ttW / 2;
    top  = y + h + g;
    if (top + ttH > vh - 60) top = y - ttH - g;
    if (top < 10)            top = y + h + g;
    left = Math.max(16, Math.min(vw - ttW - 16, left));
    top  = Math.max(10, Math.min(vh - ttH - 70, top));
  }
  return { left, top };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TourOverlay({ page, restaurantId, onDone }) {
  const router = useRouter();
  const steps  = PAGE_STEPS[page] || [];

  const [idx,        setIdx]       = useState(0);
  const [spot,       setSpot]      = useState(null);
  const [ttPos,      setTtPos]     = useState(null);
  const [ttVisible,  setTtVisible] = useState(false);
  const [typeActive, setTypeActive]= useState(false);
  const [showModal,  setShowModal] = useState(false);
  const [ready,      setReady]     = useState(false);

  const ttRef    = useRef(null);
  const timers   = useRef([]);
  const retryRef = useRef(null);
  const prevIdx  = useRef(-1);

  const step   = steps[idx];
  const isLast = idx === steps.length - 1;
  const { displayed, done: typeDone } = useTypewriter(step?.text || '', typeActive);

  function after(fn, ms) {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  }
  function clearAll() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (retryRef.current) { clearInterval(retryRef.current); retryRef.current = null; }
  }

  useEffect(() => () => clearAll(), []);

  // On mount: restore cross-page spotlight position, then glide to first step
  useEffect(() => {
    let fromSpot = null;
    try {
      const s = sessionStorage.getItem(SPOT_KEY);
      if (s) { fromSpot = JSON.parse(s); sessionStorage.removeItem(SPOT_KEY); }
    } catch {}
    if (fromSpot) {
      setSpot(fromSpot);
      setTtPos(getTooltipPos(fromSpot, 340, 180));
      setReady(true);
      after(() => positionStep(0, true), 60);
    } else {
      setReady(true);
      after(() => positionStep(0, false), 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-position when idx changes
  useEffect(() => {
    if (!ready) return;
    if (prevIdx.current === -1) { prevIdx.current = 0; return; }
    if (prevIdx.current === idx) return;
    prevIdx.current = idx;
    positionStep(idx, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, ready]);

  // For click-to-advance steps, listen for clicks on the target element
  useEffect(() => {
    if (!step?.clickTarget || !ready) return;

    function handleClick(e) {
      const target = document.querySelector(step.clickTarget);
      if (target && (target === e.target || target.contains(e.target))) {
        // Give the page a moment to update its state after the click
        after(() => setIdx(i => i + 1), 400);
      }
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.clickTarget, ready]);

  function positionStep(stepIdx, animate) {
    clearAll();
    const s = steps[stepIdx];
    if (!s) return;
    let attempts = 0;

    function tryPlace() {
      attempts++;
      const ttEl = ttRef.current;
      const ttW  = ttEl?.offsetWidth  || 340;
      const ttH  = ttEl?.offsetHeight || 180;
      const newSpot  = getSpot(s.selector, s.padding || 12);
      if (s.selector && !newSpot && attempts < 20) return;
      clearAll();
      const newTtPos = getTooltipPos(newSpot, ttW, ttH);

      if (!animate) {
        setSpot(newSpot); setTtPos(newTtPos);
        after(() => { setTtVisible(true); after(() => setTypeActive(true), 80); }, 80);
      } else {
        setTtVisible(false); setTypeActive(false);
        after(() => {
          setSpot(newSpot); setTtPos(newTtPos);
          after(() => {
            setTtVisible(true);
            after(() => setTypeActive(true), 60);
          }, Math.round(TRANSITION_MS * 0.65));
        }, 80);
      }
    }

    after(() => {
      tryPlace();
      if (s.selector) retryRef.current = setInterval(tryPlace, 250);
    }, animate ? 60 : 0);
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  function goNext() {
    if (step?.modal) { setShowModal(true); return; }
    if (step?.clickTarget) {
      // Click-to-advance steps — the click listener handles advancement
      // But if user clicks "Next" button instead, also advance
      setIdx(i => i + 1);
      return;
    }
    if (step?.nav && step.nextPage) {
      if (spot) {
        try { sessionStorage.setItem(SPOT_KEY, JSON.stringify(spot)); } catch {}
      }
      if (step.finishTour) {
        try {
          localStorage.setItem('optimenu_tour_done', '1');
          sessionStorage.removeItem(SS_KEY);
        } catch {}
        router.push(step.nextPage);
      } else {
        try { sessionStorage.setItem(SS_KEY, step.nextKey); } catch {}
        router.push(`${step.nextPage}?tour=true`);
      }
      return;
    }
    if (isLast) { onDone?.(); return; }
    setIdx(i => i + 1);
  }

  function goBack() {
    if (idx === 0) return;
    setIdx(i => i - 1);
  }

  function handleSkip() {
    setTtVisible(false);
    setTypeActive(false);
    clearAll();
    onDone?.();
  }

  if (showModal) {
    return <MenuImportModal restaurantId={restaurantId} onClose={onDone} onImported={onDone} />;
  }

  if (!step || !ttPos || !ready) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth  : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

  const clip = spot
    ? `M0,0 H${vw} V${vh} H0 Z M${spot.x},${spot.y} h${spot.w} v${spot.h} h-${spot.w} Z`
    : `M0,0 H${vw} V${vh} H0 Z`;

  const allKeys    = ['dashboard','invoices','ingredients','menu-items','analytics','final'];
  const pageOffset = allKeys
    .slice(0, allKeys.indexOf(page))
    .reduce((s, k) => s + (PAGE_STEPS[k]?.length || 0), 0);
  const globalIdx  = pageOffset + idx + 1;
  const total      = Object.values(PAGE_STEPS).reduce((s, a) => s + a.length, 0);

  // For click-to-advance steps, change button label
  const nextLabel = step.modal
    ? 'Import Menu ↑'
    : step.nav
    ? 'Take me there →'
    : step.clickTarget
    ? 'Click to continue ↑'
    : isLast
    ? '✓ Done'
    : 'Next →';

  return (
    <>
      <style>{`
        @keyframes t-ring  { 0%{box-shadow:0 0 0 0 rgba(2,164,186,.5)} 60%{box-shadow:0 0 0 10px rgba(2,164,186,0)} 100%{box-shadow:0 0 0 0 rgba(2,164,186,0)} }
        @keyframes t-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes t-cur   { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes t-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.08);opacity:.8} }

        .t-root{position:fixed;inset:0;z-index:9998;pointer-events:none;}
        .t-svg{position:absolute;inset:0;width:100%;height:100%;}
        .t-svg path{fill:rgba(0,0,0,.78);fill-rule:evenodd;transition:d ${TRANSITION_MS}ms ${EASE};}

        .t-ring{
          position:absolute;border-radius:10px;pointer-events:none;
          border:2px solid #02a4ba;animation:t-ring 2s ease infinite;
          transition:left ${TRANSITION_MS}ms ${EASE},top ${TRANSITION_MS}ms ${EASE},
                      width ${TRANSITION_MS}ms ${EASE},height ${TRANSITION_MS}ms ${EASE};
        }
        /* Pulsing ring for click-to-advance steps */
        .t-ring.clickable{
          border-color:#d4a020;
          animation:t-ring 2s ease infinite, t-pulse 1.5s ease infinite;
          border-width:3px;
        }

        .t-tt{
          position:fixed;width:340px;background:#13120f;
          border:1px solid #3a3630;border-radius:14px;
          box-shadow:0 24px 64px rgba(0,0,0,.85),0 0 0 1px rgba(2,164,186,.12);
          font-family:'Inter',sans-serif;pointer-events:all;z-index:9999;
          transition:left ${TRANSITION_MS}ms ${EASE},top ${TRANSITION_MS}ms ${EASE},opacity .2s ease;
          opacity:0;
        }
        .t-tt.vis{opacity:1;}

        .t-body{padding:18px 20px 14px;}
        .t-ey{font-size:10px;font-weight:600;color:#02a4ba;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;}
        .t-ey.click{color:#d4a020;}
        .t-ti{font-family:'Playfair Display',serif;font-size:17px;color:#e8e2d8;line-height:1.25;margin-bottom:10px;}
        .t-tx{font-size:13px;color:#6b6358;line-height:1.65;min-height:42px;}
        .t-cur{display:inline-block;width:2px;height:12px;background:#02a4ba;margin-left:1px;vertical-align:middle;border-radius:1px;animation:t-cur .6s ease infinite;}
        .t-cur.done{opacity:0;}

        .t-ft{display:flex;align-items:center;gap:8px;padding:11px 20px;border-top:1px solid #2a2620;}
        .t-skip{background:none;border:none;cursor:pointer;font-size:11px;color:#3a3630;font-family:'Inter',sans-serif;padding:5px 8px;border-radius:5px;transition:color .15s;margin-right:auto;}
        .t-skip:hover{color:#6b6358;}
        .t-back{background:none;border:1px solid #2a2620;border-radius:8px;padding:7px 14px;font-size:12px;color:#4a453e;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;}
        .t-back:hover{color:#9a9086;border-color:#3a3630;}
        .t-next{background:#02a4ba;border:none;border-radius:8px;padding:7px 18px;font-size:12px;font-weight:600;color:#0a0908;cursor:pointer;font-family:'Inter',sans-serif;transition:background .15s;}
        .t-next:hover{background:#01bcd4;}
        .t-next.click{background:#d4a020;}
        .t-next.click:hover{background:#e8b422;}

        .t-prog{position:fixed;bottom:20px;right:20px;z-index:10000;pointer-events:none;background:#13120f;border:1px solid #2a2620;border-radius:20px;padding:5px 12px;display:flex;align-items:center;gap:8px;font-size:11px;color:#4a453e;font-family:'Inter',sans-serif;}
        .t-dots{display:flex;gap:4px;}
        .t-dot{width:5px;height:5px;border-radius:50%;background:#2a2620;transition:all .25s;}
        .t-dot.active{background:#02a4ba;transform:scale(1.4);}
        .t-dot.done{background:rgba(2,164,186,.35);}

        .t-badge{position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:10000;pointer-events:none;background:rgba(212,160,32,.1);border:1px solid rgba(212,160,32,.25);border-radius:20px;padding:5px 14px;font-size:11px;color:#d4a020;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:6px;}
        .t-badge-dot{width:5px;height:5px;border-radius:50%;background:#d4a020;animation:t-blink 1.8s ease infinite;}
      `}</style>

      <div className="t-root">
        <svg className="t-svg" viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none">
          <path d={clip} />
        </svg>

        {spot && (
          <div
            className={`t-ring${step?.clickTarget ? ' clickable' : ''}`}
            style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }}
          />
        )}

        {page !== 'final' && (
          <div className="t-badge"><div className="t-badge-dot" />Showing sample Chick-fil-A data</div>
        )}

        <div ref={ttRef} className={`t-tt${ttVisible ? ' vis' : ''}`} style={{ left: ttPos.left, top: ttPos.top }}>
          <div className="t-body">
            <div className={`t-ey${step?.clickTarget ? ' click' : ''}`}>
              {page === 'final'
                ? 'Final Step'
                : step?.clickTarget
                ? `${page.replace('-', ' ')} · Step ${idx + 1} of ${steps.length} · Click to continue`
                : `${page.replace('-', ' ')} · Step ${idx + 1} of ${steps.length}`}
            </div>
            <div className="t-ti">{step.title}</div>
            <div className="t-tx">{displayed}<span className={`t-cur${typeDone ? ' done' : ''}`} /></div>
          </div>
          <div className="t-ft">
            <button className="t-skip" onClick={handleSkip}>Skip tour</button>
            {idx > 0 && !step.nav && !step.modal && !step.clickTarget && (
              <button className="t-back" onClick={goBack}>← Back</button>
            )}
            <button className={`t-next${step?.clickTarget ? ' click' : ''}`} onClick={goNext}>
              {nextLabel}
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