// components/TourOverlay.js
// Full custom spotlight tour — morphing spotlight, interactive nav clicks,
// sample data seeding, and menu upload at the end.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { seedSampleData, clearSampleData } from '../lib/seedSampleData';

const MenuImportModal = dynamic(() => import('./MenuImportModal'), { ssr: false });

// ─── Tour steps per page ──────────────────────────────────────────────────────

export const TOUR_STEPS = {
  dashboard: [
    {
      type: 'center',
      title: 'Welcome to OptiMenu 👋',
      text: "We've loaded some sample Chick-fil-A data so you can see exactly what a populated account looks like. Let's take a quick tour — it'll take about 2 minutes.",
      selector: null,
    },
    {
      type: 'spotlight',
      title: 'Your Key Metrics',
      text: 'These five numbers give you a real-time pulse on your restaurant — invoices, ingredients, menu items, average margin, and year-to-date spend.',
      selector: '.db-wbar',
      placement: 'bottom',
      padding: 10,
    },
    {
      type: 'spotlight',
      title: 'AI Profit Score',
      text: 'This score reflects your overall financial health based on margin quality, invoice coverage, and ingredient pricing completeness. The higher, the better.',
      selector: '.db-panel',
      placement: 'right',
      padding: 8,
    },
    {
      type: 'spotlight',
      title: 'AI Recommendations',
      text: 'Every day, OptiMenu analyzes your data and surfaces three actionable insights — what to push, what to fix, and where your margins are slipping.',
      selector: '.db-card',
      placement: 'bottom',
      padding: 8,
    },
    {
      type: 'click',
      title: 'Head to Invoices →',
      text: 'Click the Invoices tab in the navigation bar above to continue the tour.',
      selector: '.db-tab',
      selectorFilter: 'Invoices',
      placement: 'bottom',
      padding: 6,
      nextPage: '/client/invoices?tour=true',
    },
  ],

  invoices: [
    {
      type: 'spotlight',
      title: 'Invoice Tracking',
      text: "Here are sample invoices from Chick-fil-A's real supplier network — Tyson Foods, Golden State Foods, and more. Upload your own invoices and OptiMenu reads every line item automatically.",
      selector: '.mi-ph',
      placement: 'bottom',
      padding: 10,
    },
    {
      type: 'spotlight',
      title: 'Add an Invoice',
      text: 'After the tour, click here to upload a PDF or photo of any supplier invoice. Claude extracts items and prices in under 30 seconds — no manual entry.',
      selector: '.mi-add-btn',
      placement: 'bottom',
      padding: 8,
    },
    {
      type: 'click',
      title: 'Head to Ingredients →',
      text: 'Click the Ingredients tab to see how invoice data flows into your ingredient costs.',
      selector: '.mi-tab',
      selectorFilter: 'Ingredients',
      placement: 'bottom',
      padding: 6,
      nextPage: '/client/ingredients?tour=true',
    },
  ],

  ingredients: [
    {
      type: 'spotlight',
      title: 'Ingredient Cost Tracking',
      text: 'These are 24 core Chick-fil-A ingredients with real market costs. When you upload invoices, this list populates automatically and stays current.',
      selector: '.mi-ph',
      placement: 'bottom',
      padding: 10,
    },
    {
      type: 'spotlight',
      title: 'Live Cost Updates',
      text: 'Every ingredient links directly to your menu items. When a supplier raises their price, your menu margins recalculate instantly.',
      selector: '.mi-grid-wrap',
      placement: 'top',
      padding: 8,
    },
    {
      type: 'click',
      title: 'Head to Menu Items →',
      text: 'Click the Menu Items tab to see how ingredient costs power your menu engineering.',
      selector: '.mi-tab',
      selectorFilter: 'Menu Items',
      placement: 'bottom',
      padding: 6,
      nextPage: '/client/menu-items?tour=true',
    },
  ],

  'menu-items': [
    {
      type: 'spotlight',
      title: 'Menu Engineering',
      text: "These are 30 Chick-fil-A menu items with real prices and food costs. Waffle Fries run 83% margin. Market Salad at 76%. Every card shows exactly where your money is made.",
      selector: '.mi-grid',
      placement: 'top',
      padding: 8,
    },
    {
      type: 'spotlight',
      title: 'Margin at a Glance',
      text: 'Green means healthy margin. Red needs attention. Click any card for a full ingredient breakdown and a pricing optimizer.',
      selector: '.mi-sbar',
      placement: 'bottom',
      padding: 10,
    },
    {
      type: 'click',
      title: 'Head to Analytics →',
      text: 'Click the Analytics tab to see how sales data and AI recommendations work.',
      selector: '.mi-tab',
      selectorFilter: 'Analytics',
      placement: 'bottom',
      padding: 6,
      nextPage: '/client/analytics?tour=true',
    },
  ],

  analytics: [
    {
      type: 'spotlight',
      title: 'Sales Analytics',
      text: 'Upload a CSV from your POS and OptiMenu maps sales velocity against ingredient costs. See exactly which dishes are moving and which are sitting.',
      selector: '.mi-ph',
      placement: 'bottom',
      padding: 10,
    },
    {
      type: 'spotlight',
      title: 'Daily AI Dish Recommendations',
      text: 'Every day, OptiMenu recommends three dishes for your staff to push — based on margin, inventory risk, and sales trends. No more guessing.',
      selector: '.mi-body',
      placement: 'top',
      padding: 8,
    },
    {
      type: 'click',
      title: 'Back to Dashboard →',
      text: "Almost done. Click the Dashboard tab to finish the tour and import your real menu.",
      selector: '.mi-tab',
      selectorFilter: 'Dashboard',
      placement: 'bottom',
      padding: 6,
      nextPage: '/client/dashboard?tour=true&step=final',
    },
  ],

  dashboard_final: [
    {
      type: 'center',
      title: "One Last Step 🎉",
      text: "The sample Chick-fil-A data will be cleared. Now let's import YOUR real menu — upload a photo or PDF and Claude will extract every dish name and price automatically.",
    },
    {
      type: 'modal',
      title: 'Import Your Menu',
      text: 'Upload a photo or PDF of your menu. Claude reads it and pulls out every dish. You can edit before importing.',
      selector: '#menu-import-btn',
      placement: 'bottom',
    },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getElement(selector, filterText) {
  if (!selector) return null;
  if (filterText) {
    const all = document.querySelectorAll(selector);
    for (const el of all) {
      if (el.textContent.trim().includes(filterText)) return el;
    }
    return null;
  }
  return document.querySelector(selector);
}

function getSpotlightRect(selector, filterText, padding = 12) {
  const el = getElement(selector, filterText);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: rect.left - padding,
    y: rect.top - padding,
    w: rect.width + padding * 2,
    h: rect.height + padding * 2,
    el,
  };
}

function getTooltipPos(spotRect, placement, tw = 340, th = 200) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 18;

  if (!spotRect || placement === 'center') {
    return { left: Math.max(16, (vw - tw) / 2), top: Math.max(16, (vh - th) / 2) };
  }

  const { x, y, w, h } = spotRect;
  let left, top;

  if (placement === 'bottom') { left = x + w / 2 - tw / 2; top = y + h + gap; }
  else if (placement === 'top') { left = x + w / 2 - tw / 2; top = y - th - gap; }
  else if (placement === 'right') { left = x + w + gap; top = y + h / 2 - th / 2; }
  else if (placement === 'left') { left = x - tw - gap; top = y + h / 2 - th / 2; }
  else { left = x + w / 2 - tw / 2; top = y + h + gap; }

  if (top + th > vh - 60) top = y - th - gap;
  if (top < 10) top = y + h + gap;
  left = Math.max(16, Math.min(vw - tw - 16, left));
  top = Math.max(10, Math.min(vh - th - 70, top));

  return { left, top };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TourOverlay({ page, restaurantId, onDone }) {
  const router = useRouter();
  const isFinal = page === 'dashboard' && router.query.step === 'final';
  const stepsKey = isFinal ? 'dashboard_final' : page;
  const steps = TOUR_STEPS[stepsKey] || [];

  const [stepIdx, setStepIdx] = useState(0);
  const [spotRect, setSpotRect] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const [visible, setVisible] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const tooltipRef = useRef();

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  // Global step counter across all pages
  const pageOrder = ['dashboard', 'invoices', 'ingredients', 'menu-items', 'analytics', 'dashboard_final'];
  const pageIdx = pageOrder.indexOf(stepsKey);
  const globalOffset = pageOrder.slice(0, Math.max(0, pageIdx))
    .reduce((s, k) => s + (TOUR_STEPS[k]?.length || 0), 0);
  const globalStep = globalOffset + stepIdx + 1;
  const totalSteps = Object.values(TOUR_STEPS).flat().length;

  // ── Seed on first dashboard view ─────────────────────────────────────────

  useEffect(() => {
    if (page === 'dashboard' && !isFinal && restaurantId) {
      seedSampleData(restaurantId).then(() => {
        window.dispatchEvent(new Event('optimenu-refresh'));
      });
    }
  }, [page, isFinal, restaurantId]);

  // ── Measure ───────────────────────────────────────────────────────────────

  const measure = useCallback(() => {
    if (!step) return;
    const rect = step.selector
      ? getSpotlightRect(step.selector, step.selectorFilter, step.padding ?? 12)
      : null;
    setSpotRect(rect);
    const tw = tooltipRef.current?.offsetWidth || 340;
    const th = tooltipRef.current?.offsetHeight || 200;
    setTooltipPos(getTooltipPos(rect, step.placement, tw, th));
  }, [step]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useEffect(() => {
    setTooltipVisible(false);
    const t1 = setTimeout(() => { measure(); setVisible(true); }, 100);
    const t2 = setTimeout(() => setTooltipVisible(true), 260);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [stepIdx, measure]);

  // ── Click listener for interactive steps ─────────────────────────────────

  useEffect(() => {
    if (step?.type !== 'click') return;
    const el = getElement(step.selector, step.selectorFilter);
    if (!el) return;
    const handler = () => {
      if (step.nextPage) {
        try { sessionStorage.setItem('optimenu_tour_active', '1'); } catch {}
      }
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [stepIdx, step]);

  // ── Auto-open modal on modal step ─────────────────────────────────────────

  useEffect(() => {
    if (step?.type === 'modal') setShowImportModal(true);
  }, [stepIdx]);

  // ── Navigation ────────────────────────────────────────────────────────────

  function advance() {
    if (step?.type === 'modal') { setShowImportModal(true); return; }
    if (step?.nextPage) { router.push(step.nextPage); return; }
    if (isLast) { finish(); return; }
    setTooltipVisible(false);
    setTimeout(() => setStepIdx(i => i + 1), 160);
  }

  function back() {
    if (stepIdx === 0) return;
    setTooltipVisible(false);
    setTimeout(() => setStepIdx(i => i - 1), 160);
  }

  async function finish() {
    setVisible(false);
    setTooltipVisible(false);
    try { localStorage.setItem('optimenu_tour_done', '1'); } catch {}
    if (restaurantId) await clearSampleData(restaurantId);
    setTimeout(() => {
      onDone?.();
      const url = new URL(window.location.href);
      url.searchParams.delete('tour');
      url.searchParams.delete('step');
      window.history.replaceState({}, '', url.toString());
      window.dispatchEvent(new Event('optimenu-refresh'));
    }, 300);
  }

  function handleImportComplete() {
    setShowImportModal(false);
    finish();
  }

  if (!step || !visible) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

  const clipPath = spotRect
    ? `M0,0 H${vw} V${vh} H0 Z M${spotRect.x},${spotRect.y} h${spotRect.w} v${spotRect.h} h-${spotRect.w} Z`
    : `M0,0 H${vw} V${vh} H0 Z`;

  const isClickStep = step.type === 'click';
  const isModalStep = step.type === 'modal';

  return (
    <>
      <style>{`
        @keyframes tour-fade { from{opacity:0} to{opacity:1} }
        @keyframes tour-up { from{opacity:0;transform:translateY(10px) scale(.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes tour-ring { 0%{box-shadow:0 0 0 0 rgba(2,164,186,.55)} 60%{box-shadow:0 0 0 10px rgba(2,164,186,0)} 100%{box-shadow:0 0 0 0 rgba(2,164,186,0)} }
        @keyframes tour-click-ring { 0%{box-shadow:0 0 0 0 rgba(212,160,32,.7)} 60%{box-shadow:0 0 0 14px rgba(212,160,32,0)} 100%{box-shadow:0 0 0 0 rgba(212,160,32,0)} }
        @keyframes tour-badge-blink { 0%,100%{opacity:1} 50%{opacity:.4} }

        .tour-root { position:fixed;inset:0;z-index:9998;pointer-events:none;animation:tour-fade .3s ease both; }
        .tour-svg { position:absolute;inset:0;width:100%;height:100%; }
        .tour-svg path { fill:rgba(0,0,0,.72);fill-rule:evenodd;transition:d .5s cubic-bezier(.4,0,.2,1); }

        .tour-border {
          position:absolute;border-radius:10px;pointer-events:none;
          transition:left .5s cubic-bezier(.4,0,.2,1),top .5s cubic-bezier(.4,0,.2,1),
                     width .5s cubic-bezier(.4,0,.2,1),height .5s cubic-bezier(.4,0,.2,1);
        }
        .tour-border.spotlight { border:2px solid #02a4ba;animation:tour-ring 2s ease infinite; }
        .tour-border.clickable { border:2px solid #d4a020;animation:tour-click-ring 1.4s ease infinite; }

        .tour-tooltip {
          position:fixed;width:340px;background:#13120f;
          border:1px solid #3a3630;border-radius:14px;
          box-shadow:0 24px 64px rgba(0,0,0,.75),0 0 0 1px rgba(2,164,186,.1);
          font-family:'Inter',sans-serif;pointer-events:all;z-index:9999;
          transition:left .5s cubic-bezier(.4,0,.2,1),top .5s cubic-bezier(.4,0,.2,1);
        }
        .tour-tooltip.vis { animation:tour-up .25s cubic-bezier(.4,0,.2,1) both; }

        .tour-tt-body { padding:18px 20px 14px; }
        .tour-eyebrow { font-size:10px;font-weight:600;color:#02a4ba;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px; }
        .tour-title { font-family:'Playfair Display',serif;font-size:17px;color:#e8e2d8;line-height:1.25;margin-bottom:8px; }
        .tour-text { font-size:13px;color:#6b6358;line-height:1.65; }

        .tour-hint {
          display:flex;align-items:center;gap:8px;margin-top:12px;
          padding:9px 12px;border-radius:8px;font-size:12px;font-weight:500;
        }
        .tour-hint svg { width:14px;height:14px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0; }
        .tour-hint.click { background:rgba(212,160,32,.07);border:1px solid rgba(212,160,32,.2);color:#d4a020; }
        .tour-hint.click svg { stroke:#d4a020; }
        .tour-hint.upload { background:rgba(2,164,186,.07);border:1px solid rgba(2,164,186,.2);color:#02a4ba; }
        .tour-hint.upload svg { stroke:#02a4ba; }

        .tour-tt-footer { display:flex;align-items:center;gap:8px;padding:11px 20px;border-top:1px solid #2a2620; }
        .tour-skip { background:none;border:none;cursor:pointer;font-size:11px;color:#3a3630;font-family:'Inter',sans-serif;padding:5px 8px;border-radius:5px;transition:color .15s;margin-right:auto; }
        .tour-skip:hover { color:#6b6358; }
        .tour-back { background:none;border:1px solid #2a2620;border-radius:8px;padding:7px 14px;font-size:12px;color:#4a453e;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s; }
        .tour-back:hover { color:#9a9086;border-color:#3a3630; }
        .tour-next { background:#02a4ba;border:none;border-radius:8px;padding:7px 18px;font-size:12px;font-weight:600;color:#0a0908;cursor:pointer;font-family:'Inter',sans-serif;transition:background .15s; }
        .tour-next:hover { background:#01bcd4; }
        .tour-waiting { background:rgba(212,160,32,.1);border:1px solid rgba(212,160,32,.25);border-radius:8px;padding:7px 14px;font-size:12px;color:#d4a020;font-family:'Inter',sans-serif; }

        .tour-progress {
          position:fixed;bottom:20px;right:20px;z-index:10000;pointer-events:none;
          background:#13120f;border:1px solid #2a2620;border-radius:20px;
          padding:5px 12px;display:flex;align-items:center;gap:8px;
          font-size:11px;color:#4a453e;font-family:'Inter',sans-serif;
        }
        .tour-dots { display:flex;gap:4px; }
        .tour-dot { width:5px;height:5px;border-radius:50%;background:#2a2620;transition:all .2s; }
        .tour-dot.active { background:#02a4ba;transform:scale(1.4); }
        .tour-dot.done { background:rgba(2,164,186,.35); }

        .tour-sample-badge {
          position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:10000;pointer-events:none;
          background:rgba(212,160,32,.1);border:1px solid rgba(212,160,32,.25);
          border-radius:20px;padding:5px 14px;font-size:11px;color:#d4a020;
          font-family:'Inter',sans-serif;display:flex;align-items:center;gap:6px;
        }
        .tour-sample-dot { width:5px;height:5px;border-radius:50%;background:#d4a020;animation:tour-badge-blink 1.8s ease infinite; }
      `}</style>

      <div className="tour-root">

        {/* Overlay with cutout */}
        <svg className="tour-svg" viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none">
          <path d={clipPath} />
        </svg>

        {/* Spotlight ring */}
        {spotRect && (
          <div
            className={`tour-border ${isClickStep ? 'clickable' : 'spotlight'}`}
            style={{ left: spotRect.x, top: spotRect.y, width: spotRect.w, height: spotRect.h }}
          />
        )}

        {/* Sample data badge */}
        {!isFinal && (
          <div className="tour-sample-badge">
            <div className="tour-sample-dot" />
            Showing sample Chick-fil-A data
          </div>
        )}

        {/* Tooltip */}
        <div
          ref={tooltipRef}
          className={`tour-tooltip${tooltipVisible ? ' vis' : ''}`}
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="tour-tt-body">
            <div className="tour-eyebrow">
              {isFinal ? 'Final Step' : `${page.charAt(0).toUpperCase() + page.slice(1).replace('-', ' ')} · Step ${stepIdx + 1} of ${steps.length}`}
            </div>
            <div className="tour-title">{step.title}</div>
            <div className="tour-text">{step.text}</div>

            {isClickStep && (
              <div className="tour-hint click">
                <svg viewBox="0 0 24 24"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/></svg>
                Click the highlighted element to continue
              </div>
            )}
            {isModalStep && (
              <div className="tour-hint upload">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload your menu to complete the tour
              </div>
            )}
          </div>

          <div className="tour-tt-footer">
            <button className="tour-skip" onClick={finish}>Skip tour</button>
            {stepIdx > 0 && !isClickStep && !isModalStep && (
              <button className="tour-back" onClick={back}>← Back</button>
            )}
            {!isClickStep && !isModalStep && (
              <button className="tour-next" onClick={advance}>
                {isLast ? '✓ Done' : step.nextPage ? 'Next Page →' : 'Next →'}
              </button>
            )}
            {isClickStep && <div className="tour-waiting">Waiting for click...</div>}
            {isModalStep && (
              <button className="tour-next" onClick={() => setShowImportModal(true)}>
                Open Import ↑
              </button>
            )}
          </div>
        </div>

        {/* Progress dots */}
        <div className="tour-progress">
          <div className="tour-dots">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className={`tour-dot${i === globalStep - 1 ? ' active' : i < globalStep - 1 ? ' done' : ''}`} />
            ))}
          </div>
          <span>{globalStep} / {totalSteps}</span>
        </div>
      </div>

      {/* Menu import modal on final step */}
      {showImportModal && restaurantId && (
        <MenuImportModal
          restaurantId={restaurantId}
          onClose={() => setShowImportModal(false)}
          onImported={handleImportComplete}
        />
      )}
    </>
  );
}