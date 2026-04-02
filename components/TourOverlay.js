// components/TourOverlay.js
// Custom spotlight tour — smooth morphing spotlight, tooltip bubble, interactive steps.
// Drop this component into any page and it handles everything.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';

// ─── Tour step definitions ────────────────────────────────────────────────────
// Each step:
//   selector: CSS selector of element to spotlight (null = center screen)
//   title: tooltip title
//   text: tooltip body
//   placement: 'bottom' | 'top' | 'left' | 'right' | 'center' (default auto)
//   interactive: if true, user must click the spotlighted element to advance
//   nextPage: URL to navigate to after this step (advances tour to next page)
//   padding: extra spotlight padding (default 12)

export const TOUR_STEPS = {
  dashboard: [
    {
      selector: null,
      title: 'Welcome to OptiMenu 👋',
      text: "You're in. Let's take 2 minutes to show you around so you can get the most out of the platform.",
      placement: 'center',
    },
    {
      selector: '.mi-sbar, .mob-stats, [class*="sbar"], [class*="stat"]',
      title: 'Your Key Numbers',
      text: 'These metrics update in real time as you add data — total spend, invoice count, ingredient costs, and menu margins at a glance.',
      placement: 'bottom',
      padding: 16,
    },
    {
      selector: '.mi-nav, .mob-header',
      title: 'Navigate the App',
      text: "Five sections: Dashboard, Invoices, Ingredients, Menu Items, and Analytics. Each one builds on the last. Let's visit them.",
      placement: 'bottom',
      nextPage: '/client/invoices?tour=true',
    },
  ],

  invoices: [
    {
      selector: '.mi-ph, .mob-titlebar',
      title: 'Invoice Tracking',
      text: "Upload your supplier invoices here. OptiMenu reads the line items and automatically updates your ingredient costs — no manual entry needed.",
      placement: 'bottom',
    },
    {
      selector: '.mi-add-btn, .mob-add-btn',
      title: 'Add Your First Invoice',
      text: "Click this after the tour to upload a PDF or photo of any supplier invoice. Claude extracts the items and prices in under 30 seconds.",
      placement: 'bottom',
      nextPage: '/client/ingredients?tour=true',
    },
  ],

  ingredients: [
    {
      selector: '.mi-ph, .mob-titlebar',
      title: 'Ingredient Cost Tracking',
      text: 'Every ingredient from your invoices appears here with its current cost per unit. When a supplier raises prices, this updates automatically.',
      placement: 'bottom',
    },
    {
      selector: '.mi-grid-wrap, .mi-body',
      title: 'Your Ingredient Library',
      text: 'Ingredients link directly to your menu items. When costs change, your menu margins recalculate instantly — you always know your true food cost.',
      placement: 'top',
      nextPage: '/client/menu-items?tour=true',
    },
  ],

  'menu-items': [
    {
      selector: '.mi-ph, .mob-titlebar',
      title: 'Menu Engineering',
      text: "This is where the magic happens. Every dish on your menu lives here with its food cost, price, and profit margin calculated automatically.",
      placement: 'bottom',
    },
    {
      selector: '#menu-import-btn',
      title: "Import Your Menu Now ↑",
      text: "Click the Import Menu button right now. Upload a photo or PDF of your existing menu and Claude will extract every dish name and price automatically.",
      placement: 'bottom',
      interactive: true,
      padding: 8,
    },
    {
      selector: '.mi-grid, .mi-grid-wrap',
      title: 'Your Menu Items',
      text: "Each card shows the dish's price, food cost, and margin. Green = healthy margin, red = needs attention. Click any card for a full breakdown and optimizer.",
      placement: 'top',
      nextPage: '/client/analytics?tour=true',
    },
  ],

  analytics: [
    {
      selector: '.mi-ph, .mob-titlebar',
      title: 'Sales Analytics',
      text: "Connect your POS or upload a CSV export to unlock sales data. OptiMenu crosses sales velocity with ingredient costs to find your best opportunities.",
      placement: 'bottom',
    },
    {
      selector: null,
      title: "You're all set! 🎉",
      text: "That's the full tour. Start by importing your menu, then add your first invoice. OptiMenu gets smarter the more data you add.",
      placement: 'center',
    },
  ],
};

// ─── Helper: get element rect with padding ────────────────────────────────────

function getSpotlightRect(selector, padding = 12) {
  if (!selector) return null;
  // Try multiple selectors (comma-separated fallbacks)
  const selectors = selector.split(',').map(s => s.trim());
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          x: rect.left - padding,
          y: rect.top - padding,
          w: rect.width + padding * 2,
          h: rect.height + padding * 2,
          el,
        };
      }
    }
  }
  return null;
}

// ─── Helper: compute tooltip position ────────────────────────────────────────

function getTooltipStyle(spotRect, placement, tooltipW = 320, tooltipH = 160) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 16;

  if (!spotRect || placement === 'center') {
    return {
      left: Math.max(16, (vw - tooltipW) / 2),
      top: Math.max(16, (vh - tooltipH) / 2),
    };
  }

  const { x, y, w, h } = spotRect;
  let left, top;

  if (placement === 'bottom') {
    left = x + w / 2 - tooltipW / 2;
    top = y + h + gap;
  } else if (placement === 'top') {
    left = x + w / 2 - tooltipW / 2;
    top = y - tooltipH - gap;
  } else if (placement === 'right') {
    left = x + w + gap;
    top = y + h / 2 - tooltipH / 2;
  } else if (placement === 'left') {
    left = x - tooltipW - gap;
    top = y + h / 2 - tooltipH / 2;
  } else {
    // auto: prefer bottom, fall back to top
    left = x + w / 2 - tooltipW / 2;
    top = y + h + gap;
    if (top + tooltipH > vh - 16) top = y - tooltipH - gap;
  }

  // Clamp to viewport
  left = Math.max(16, Math.min(vw - tooltipW - 16, left));
  top = Math.max(16, Math.min(vh - tooltipH - 60, top));

  return { left, top };
}

// ─── Main TourOverlay component ───────────────────────────────────────────────

export default function TourOverlay({ page, onDone }) {
  const router = useRouter();
  const steps = TOUR_STEPS[page] || [];
  const [stepIdx, setStepIdx] = useState(0);
  const [spotRect, setSpotRect] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const [visible, setVisible] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const rafRef = useRef();
  const tooltipRef = useRef();

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  const isInteractive = step?.interactive;

  // ── Measure and position ──────────────────────────────────────────────────

  const measure = useCallback(() => {
    if (!step) return;
    const rect = step.selector ? getSpotlightRect(step.selector, step.padding) : null;
    setSpotRect(rect);

    const tooltipW = tooltipRef.current?.offsetWidth || 320;
    const tooltipH = tooltipRef.current?.offsetHeight || 160;
    const pos = getTooltipStyle(rect, step.placement, tooltipW, tooltipH);
    setTooltipPos(pos);
  }, [step]);

  // Re-measure on resize
  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  // Measure when step changes
  useEffect(() => {
    setTooltipVisible(false);
    // Small delay so DOM has settled
    const t1 = setTimeout(() => {
      measure();
      setVisible(true);
    }, 80);
    const t2 = setTimeout(() => setTooltipVisible(true), 220);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [stepIdx, measure]);

  // Initial mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  // ── Interactive step: listen for click on target element ─────────────────

  useEffect(() => {
    if (!isInteractive || !step?.selector) return;
    const selectors = step.selector.split(',').map(s => s.trim());
    const handlers = [];

    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        const handler = () => advance();
        el.addEventListener('click', handler);
        handlers.push({ el, handler });
      }
    });

    return () => handlers.forEach(({ el, handler }) => el.removeEventListener('click', handler));
  }, [stepIdx, isInteractive, step]);

  // ── Navigation ────────────────────────────────────────────────────────────

  function advance() {
    if (step?.nextPage) {
      // Store that tour is in progress so next page picks it up
      try { sessionStorage.setItem('optimenu_tour_page', String(stepIdx)); } catch {}
      router.push(step.nextPage);
      return;
    }

    if (isLast) {
      finish();
      return;
    }

    setTooltipVisible(false);
    setTimeout(() => setStepIdx(i => i + 1), 150);
  }

  function back() {
    if (stepIdx === 0) return;
    setTooltipVisible(false);
    setTimeout(() => setStepIdx(i => i - 1), 150);
  }

  function finish() {
    setVisible(false);
    setTooltipVisible(false);
    try { localStorage.setItem('optimenu_tour_done', '1'); } catch {}
    setTimeout(() => onDone?.(), 300);
  }

  if (!step || !visible) return null;

  // ── SVG spotlight mask ────────────────────────────────────────────────────
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

  const clipPath = spotRect
    ? `M0,0 H${vw} V${vh} H0 Z M${spotRect.x},${spotRect.y} h${spotRect.w} v${spotRect.h} h-${spotRect.w} Z`
    : `M0,0 H${vw} V${vh} H0 Z`;

  return (
    <>
      <style>{`
        @keyframes tour-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tour-tooltip-in { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes tour-pulse-ring {
          0% { box-shadow: 0 0 0 0 rgba(2,164,186,.5); }
          70% { box-shadow: 0 0 0 10px rgba(2,164,186,0); }
          100% { box-shadow: 0 0 0 0 rgba(2,164,186,0); }
        }

        .tour-overlay-root {
          position: fixed; inset: 0; z-index: 9999;
          pointer-events: none;
          animation: tour-fade-in .3s ease both;
        }

        .tour-svg-mask {
          position: absolute; inset: 0; width: 100%; height: 100%;
          transition: none;
        }

        .tour-svg-mask path {
          transition: d .45s cubic-bezier(.4,0,.2,1);
          fill: rgba(0,0,0,.75);
          fill-rule: evenodd;
        }

        .tour-spotlight-border {
          position: absolute;
          border: 2px solid #02a4ba;
          border-radius: 10px;
          pointer-events: none;
          transition: left .45s cubic-bezier(.4,0,.2,1),
                      top .45s cubic-bezier(.4,0,.2,1),
                      width .45s cubic-bezier(.4,0,.2,1),
                      height .45s cubic-bezier(.4,0,.2,1),
                      opacity .2s ease;
          animation: tour-pulse-ring 2s ease-in-out infinite;
          box-shadow: 0 0 0 1px rgba(2,164,186,.2), inset 0 0 0 1px rgba(2,164,186,.1);
        }

        .tour-tooltip {
          position: fixed;
          width: 320px;
          background: #13120f;
          border: 1px solid #3a3630;
          border-radius: 14px;
          box-shadow: 0 20px 60px rgba(0,0,0,.7), 0 0 0 1px rgba(2,164,186,.12);
          font-family: 'Inter', sans-serif;
          pointer-events: all;
          transition: left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1);
          z-index: 10000;
        }

        .tour-tooltip.tt-visible {
          animation: tour-tooltip-in .25s cubic-bezier(.4,0,.2,1) both;
        }

        .tour-tt-inner { padding: 20px 20px 16px; }

        .tour-tt-eyebrow {
          font-size: 10px; font-weight: 600; color: #02a4ba;
          text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 7px;
        }

        .tour-tt-title {
          font-family: 'Playfair Display', serif;
          font-size: 17px; color: #e8e2d8; line-height: 1.25; margin-bottom: 9px;
        }

        .tour-tt-text {
          font-size: 13px; color: #6b6358; line-height: 1.65;
        }

        .tour-tt-interactive {
          display: flex; align-items: center; gap: 7px;
          margin-top: 12px; padding: 9px 12px;
          background: rgba(2,164,186,.07);
          border: 1px solid rgba(2,164,186,.2);
          border-radius: 8px;
          font-size: 12px; color: #02a4ba; font-weight: 500;
        }

        .tour-tt-interactive svg { width: 14px; height: 14px; stroke: #02a4ba; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }

        .tour-tt-footer {
          display: flex; align-items: center; justify-content: flex-end;
          gap: 8px; padding: 12px 20px;
          border-top: 1px solid #2a2620;
        }

        .tour-btn-skip {
          background: none; border: none; cursor: pointer;
          font-size: 12px; color: #3a3630; font-family: 'Inter', sans-serif;
          padding: 6px 10px; border-radius: 6px; transition: color .15s;
          margin-right: auto;
        }
        .tour-btn-skip:hover { color: #6b6358; }

        .tour-btn-back {
          background: none; border: 1px solid #2a2620; border-radius: 8px;
          padding: 8px 14px; font-size: 12px; color: #4a453e; cursor: pointer;
          font-family: 'Inter', sans-serif; transition: all .15s;
        }
        .tour-btn-back:hover { color: #9a9086; border-color: #3a3630; }

        .tour-btn-next {
          background: #02a4ba; border: none; border-radius: 8px;
          padding: 8px 18px; font-size: 12px; font-weight: 600;
          color: #0a0908; cursor: pointer; font-family: 'Inter', sans-serif;
          transition: background .15s; display: flex; align-items: center; gap: 6px;
        }
        .tour-btn-next:hover { background: #01bcd4; }
        .tour-btn-next.disabled { opacity: .4; cursor: not-allowed; }
        .tour-btn-next.disabled:hover { background: #02a4ba; }

        .tour-progress {
          position: fixed; bottom: 24px; right: 24px;
          background: #13120f; border: 1px solid #2a2620;
          border-radius: 20px; padding: 6px 14px;
          font-size: 11px; color: #4a453e;
          font-family: 'Inter', sans-serif;
          pointer-events: none; z-index: 10001;
          display: flex; align-items: center; gap: 8px;
        }

        .tour-progress-dots { display: flex; gap: 5px; }
        .tour-progress-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #2a2620; transition: background .2s, transform .2s;
        }
        .tour-progress-dot.active { background: #02a4ba; transform: scale(1.3); }
        .tour-progress-dot.done { background: rgba(2,164,186,.4); }
      `}</style>

      <div className="tour-overlay-root">

        {/* SVG mask — the dark overlay with cutout */}
        <svg className="tour-svg-mask" viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none">
          <path d={clipPath} />
        </svg>

        {/* Spotlight border ring */}
        {spotRect && (
          <div
            className="tour-spotlight-border"
            style={{
              left: spotRect.x,
              top: spotRect.y,
              width: spotRect.w,
              height: spotRect.h,
            }}
          />
        )}

        {/* Tooltip bubble */}
        <div
          ref={tooltipRef}
          className={`tour-tooltip${tooltipVisible ? ' tt-visible' : ''}`}
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="tour-tt-inner">
            <div className="tour-tt-eyebrow">
              {page.charAt(0).toUpperCase() + page.slice(1).replace('-', ' ')} Tour
            </div>
            <div className="tour-tt-title">{step.title}</div>
            <div className="tour-tt-text">{step.text}</div>

            {isInteractive && (
              <div className="tour-tt-interactive">
                <svg viewBox="0 0 24 24"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/></svg>
                Click the highlighted button to continue
              </div>
            )}
          </div>

          <div className="tour-tt-footer">
            <button className="tour-btn-skip" onClick={finish}>Skip tour</button>
            {stepIdx > 0 && !isInteractive && (
              <button className="tour-btn-back" onClick={back}>← Back</button>
            )}
            {!isInteractive && (
              <button className="tour-btn-next" onClick={advance}>
                {isLast ? '✓ Done' : step.nextPage ? 'Next Page →' : 'Next →'}
              </button>
            )}
            {isInteractive && (
              <div className="tour-btn-next disabled" style={{ pointerEvents: 'none' }}>
                Waiting for click...
              </div>
            )}
          </div>
        </div>

        {/* Progress indicator — bottom right */}
        <div className="tour-progress">
          <div className="tour-progress-dots">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`tour-progress-dot${i === stepIdx ? ' active' : i < stepIdx ? ' done' : ''}`}
              />
            ))}
          </div>
          <span>{stepIdx + 1} / {steps.length}</span>
        </div>

      </div>
    </>
  );
}