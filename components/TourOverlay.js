// components/TourOverlay.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { seedSampleData, clearSampleData } from '../lib/seedSampleData';

const MenuImportModal = dynamic(() => import('./MenuImportModal'), { ssr: false });

const PAGE_STEPS = {
  dashboard: [
    { type:'info', selector:null, placement:'center', title:'Welcome to OptiMenu 👋', text:"We've loaded sample Chick-fil-A data so you can see what a fully populated account looks like. Let's take a 2-minute tour." },
    { type:'info', selector:'.db-wbar', placement:'bottom', padding:10, title:'Your Key Metrics', text:'These five numbers give you a real-time pulse — invoices, ingredients, menu items, average margin, and year-to-date spend. All update automatically as you add data.' },
    { type:'info', selector:'.db-panel', placement:'right', padding:8, title:'AI Profit Score', text:'This score reflects your overall financial health based on margin quality, invoice coverage, and ingredient pricing completeness.' },
    { type:'nav', selector:'.db-tab', selectorFilter:'Invoices', placement:'bottom', padding:6, title:'Next: Invoices', text:'Click "Take me there" to see how invoice tracking works with sample supplier data loaded in.', nextPage:'/client/invoices', nextStepKey:'invoices' },
  ],
  invoices: [
    { type:'info', selector:'.mi-ph', placement:'bottom', padding:10, title:'Invoice Tracking', text:"These are sample invoices from Chick-fil-A's real supplier network — Tyson Foods, Golden State Foods, and more. Upload your own and OptiMenu reads every line item automatically." },
    { type:'info', selector:'.mi-add-btn', placement:'bottom', padding:8, title:'Add an Invoice', text:'Upload a PDF or photo of any supplier invoice. Claude extracts items and prices in under 30 seconds.' },
    { type:'nav', selector:'.mi-tab', selectorFilter:'Ingredients', placement:'bottom', padding:6, title:'Next: Ingredients', text:'Click "Take me there" to see how invoice data flows into your ingredient costs.', nextPage:'/client/ingredients', nextStepKey:'ingredients' },
  ],
  ingredients: [
    { type:'info', selector:'.mi-ph', placement:'bottom', padding:10, title:'Ingredient Cost Tracking', text:'These are 24 core Chick-fil-A ingredients with real market costs. When you upload invoices, this list populates automatically.' },
    { type:'info', selector:'.mi-grid-wrap', placement:'top', padding:8, title:'Live Cost Updates', text:'Every ingredient links to your menu items. When a supplier raises prices, your menu margins recalculate instantly.' },
    { type:'nav', selector:'.mi-tab', selectorFilter:'Menu Items', placement:'bottom', padding:6, title:'Next: Menu Items', text:'Click "Take me there" to see how ingredient costs power your menu engineering.', nextPage:'/client/menu-items', nextStepKey:'menu-items' },
  ],
  'menu-items': [
    { type:'info', selector:'.mi-sbar', placement:'bottom', padding:10, title:'Menu Engineering', text:'30 Chick-fil-A menu items with real prices and food costs. Waffle Fries run 83% margin. Every card shows exactly where your money is made.' },
    { type:'info', selector:'.mi-grid', placement:'top', padding:8, title:'Margin at a Glance', text:'Green = healthy margin. Red = needs attention. Click any card for a full ingredient breakdown and pricing optimizer.' },
    { type:'nav', selector:'.mi-tab', selectorFilter:'Analytics', placement:'bottom', padding:6, title:'Next: Analytics', text:'Click "Take me there" to see how sales data and AI recommendations work.', nextPage:'/client/analytics', nextStepKey:'analytics' },
  ],
  analytics: [
    { type:'info', selector:'.an-ph', placement:'bottom', padding:10, title:'Sales Analytics', text:'Upload a CSV from your POS and OptiMenu maps sales velocity against ingredient costs. See which dishes are moving and which are sitting.' },
    { type:'nav', selector:null, placement:'center', title:'Back to Dashboard', text:'Last stop — click "Take me there" to finish the tour and import your real menu.', nextPage:'/client/dashboard', nextStepKey:'final' },
  ],
  final: [
    { type:'info', selector:null, placement:'center', title:"One Last Step 🎉", text:"The sample data will be cleared. Now import YOUR real menu — upload a photo or PDF and Claude will extract every dish automatically." },
    { type:'modal', selector:'#menu-import-btn', placement:'bottom', title:'Import Your Menu', text:'Upload a photo or PDF of your menu. Claude reads it and pulls out every dish. You can edit before importing.' },
  ],
};

const SS_KEY = 'optimenu_tour_step';

function getEl(selector, filterText) {
  if (!selector) return null;
  if (filterText) {
    const els = document.querySelectorAll(selector);
    for (const el of els) { if (el.textContent.trim().includes(filterText)) return el; }
    return null;
  }
  return document.querySelector(selector);
}

function spotRect(selector, filterText, pad = 12) {
  const el = getEl(selector, filterText);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}

function tooltipPos(spot, placement, tw = 340, th = 180) {
  const vw = window.innerWidth, vh = window.innerHeight, g = 16;
  if (!spot || placement === 'center') return { left: Math.max(16, (vw - tw) / 2), top: Math.max(16, (vh - th) / 2) };
  const { x, y, w, h } = spot;
  let left, top;
  if (placement === 'bottom') { left = x + w / 2 - tw / 2; top = y + h + g; }
  else if (placement === 'top') { left = x + w / 2 - tw / 2; top = y - th - g; }
  else if (placement === 'right') { left = x + w + g; top = y + h / 2 - th / 2; }
  else { left = x + w / 2 - tw / 2; top = y + h + g; }
  if (top + th > vh - 60) top = y - th - g;
  if (top < 10) top = y + h + g;
  left = Math.max(16, Math.min(vw - tw - 16, left));
  top = Math.max(10, Math.min(vh - th - 70, top));
  return { left, top };
}

export default function TourOverlay({ page, restaurantId, onDone }) {
  const router = useRouter();
  const steps = PAGE_STEPS[page] || [];
  const [stepIdx, setStepIdx] = useState(0);
  const [spot, setSpot] = useState(null);
  const [ttPos, setTtPos] = useState({ left: 0, top: 0 });
  const [ttVisible, setTtVisible] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const ttRef = useRef();
  const seededRef = useRef(false);

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  const isNav = step?.type === 'nav';
  const isModal = step?.type === 'modal';

  useEffect(() => {
    if (!restaurantId || seededRef.current || page === 'final') return;
    seededRef.current = true;
    seedSampleData(restaurantId);
  }, [restaurantId, page]);

  const measure = useCallback(() => {
    if (!step) return;
    const s = step.selector ? spotRect(step.selector, step.selectorFilter, step.padding) : null;
    setSpot(s);
    const tw = ttRef.current?.offsetWidth || 340;
    const th = ttRef.current?.offsetHeight || 180;
    setTtPos(tooltipPos(s, step.placement, tw, th));
  }, [step]);

  useEffect(() => { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, [measure]);

  useEffect(() => {
    setTtVisible(false);
    const t1 = setTimeout(() => { measure(); }, 120);
    const t2 = setTimeout(() => setTtVisible(true), 280);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [stepIdx, measure]);

  useEffect(() => { if (step?.type === 'modal') setShowModal(true); }, [stepIdx]);

  function next() {
    if (isModal) { setShowModal(true); return; }
    if (isNav && step.nextPage) {
      try { sessionStorage.setItem(SS_KEY, step.nextStepKey); } catch {}
      router.push(`${step.nextPage}?tour=true`);
      return;
    }
    if (isLast) { finish(); return; }
    setTtVisible(false);
    setTimeout(() => setStepIdx(i => i + 1), 150);
  }

  function back() {
    if (stepIdx === 0) return;
    setTtVisible(false);
    setTimeout(() => setStepIdx(i => i - 1), 150);
  }

  async function finish() {
    setTtVisible(false);
    try { localStorage.setItem('optimenu_tour_done', '1'); sessionStorage.removeItem(SS_KEY); } catch {}
    if (restaurantId) await clearSampleData(restaurantId);
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url.toString());
    onDone?.();
  }

  function handleImported() { setShowModal(false); finish(); }

  if (!step) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const clip = spot
    ? `M0,0 H${vw} V${vh} H0 Z M${spot.x},${spot.y} h${spot.w} v${spot.h} h-${spot.w} Z`
    : `M0,0 H${vw} V${vh} H0 Z`;

  const allKeys = ['dashboard','invoices','ingredients','menu-items','analytics','final'];
  const pageOffset = allKeys.slice(0, allKeys.indexOf(page)).reduce((s,k) => s + (PAGE_STEPS[k]?.length || 0), 0);
  const globalStep = pageOffset + stepIdx + 1;
  const totalSteps = Object.values(PAGE_STEPS).reduce((s, arr) => s + arr.length, 0);

  return (
    <>
      <style>{`
        @keyframes t-fade{from{opacity:0}to{opacity:1}}
        @keyframes t-up{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
        @keyframes t-ring{0%{box-shadow:0 0 0 0 rgba(2,164,186,.55)}60%{box-shadow:0 0 0 10px rgba(2,164,186,0)}100%{box-shadow:0 0 0 0 rgba(2,164,186,0)}}
        @keyframes t-nav-ring{0%{box-shadow:0 0 0 0 rgba(212,160,32,.7)}60%{box-shadow:0 0 0 14px rgba(212,160,32,0)}100%{box-shadow:0 0 0 0 rgba(212,160,32,0)}}
        @keyframes t-blink{0%,100%{opacity:1}50%{opacity:.3}}
        .t-root{position:fixed;inset:0;z-index:9998;pointer-events:none;animation:t-fade .3s ease both;}
        .t-svg{position:absolute;inset:0;width:100%;height:100%;}
        .t-svg path{fill:rgba(0,0,0,.72);fill-rule:evenodd;transition:d .5s cubic-bezier(.4,0,.2,1);}
        .t-ring{position:absolute;border-radius:10px;pointer-events:none;
          transition:left .5s cubic-bezier(.4,0,.2,1),top .5s cubic-bezier(.4,0,.2,1),
                     width .5s cubic-bezier(.4,0,.2,1),height .5s cubic-bezier(.4,0,.2,1);}
        .t-ring.info{border:2px solid #02a4ba;animation:t-ring 2s ease infinite;}
        .t-ring.nav{border:2px solid #d4a020;animation:t-nav-ring 1.4s ease infinite;}
        .t-tt{position:fixed;width:340px;background:#13120f;border:1px solid #3a3630;border-radius:14px;
          box-shadow:0 24px 64px rgba(0,0,0,.75),0 0 0 1px rgba(2,164,186,.1);
          font-family:'Inter',sans-serif;pointer-events:all;z-index:9999;
          transition:left .5s cubic-bezier(.4,0,.2,1),top .5s cubic-bezier(.4,0,.2,1);}
        .t-tt.vis{animation:t-up .25s cubic-bezier(.4,0,.2,1) both;}
        .t-body{padding:18px 20px 14px;}
        .t-ey{font-size:10px;font-weight:600;color:#02a4ba;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;}
        .t-ti{font-family:'Playfair Display',serif;font-size:17px;color:#e8e2d8;line-height:1.25;margin-bottom:8px;}
        .t-tx{font-size:13px;color:#6b6358;line-height:1.65;}
        .t-hint{display:flex;align-items:center;gap:8px;margin-top:12px;padding:9px 12px;border-radius:8px;font-size:12px;font-weight:500;}
        .t-hint.upload{background:rgba(2,164,186,.07);border:1px solid rgba(2,164,186,.2);color:#02a4ba;}
        .t-hint svg{width:14px;height:14px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;}
        .t-hint.upload svg{stroke:#02a4ba;}
        .t-ft{display:flex;align-items:center;gap:8px;padding:11px 20px;border-top:1px solid #2a2620;}
        .t-skip{background:none;border:none;cursor:pointer;font-size:11px;color:#3a3630;font-family:'Inter',sans-serif;padding:5px 8px;border-radius:5px;transition:color .15s;margin-right:auto;}
        .t-skip:hover{color:#6b6358;}
        .t-back{background:none;border:1px solid #2a2620;border-radius:8px;padding:7px 14px;font-size:12px;color:#4a453e;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;}
        .t-back:hover{color:#9a9086;border-color:#3a3630;}
        .t-next{background:#02a4ba;border:none;border-radius:8px;padding:7px 18px;font-size:12px;font-weight:600;color:#0a0908;cursor:pointer;font-family:'Inter',sans-serif;transition:background .15s;}
        .t-next:hover{background:#01bcd4;}
        .t-prog{position:fixed;bottom:20px;right:20px;z-index:10000;pointer-events:none;
          background:#13120f;border:1px solid #2a2620;border-radius:20px;
          padding:5px 12px;display:flex;align-items:center;gap:8px;
          font-size:11px;color:#4a453e;font-family:'Inter',sans-serif;}
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
          <div className={`t-ring ${isNav ? 'nav' : 'info'}`}
            style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} />
        )}

        {page !== 'final' && (
          <div className="t-badge">
            <div className="t-badge-dot" />
            Showing sample Chick-fil-A data
          </div>
        )}

        <div ref={ttRef} className={`t-tt${ttVisible ? ' vis' : ''}`} style={{ left: ttPos.left, top: ttPos.top }}>
          <div className="t-body">
            <div className="t-ey">
              {page === 'final' ? 'Final Step' : `${page.replace('-', ' ')} · Step ${stepIdx + 1} of ${steps.length}`}
            </div>
            <div className="t-ti">{step.title}</div>
            <div className="t-tx">{step.text}</div>
            {isModal && (
              <div className="t-hint upload">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload your menu to complete the tour
              </div>
            )}
          </div>

          <div className="t-ft">
            <button className="t-skip" onClick={finish}>Skip tour</button>
            {stepIdx > 0 && !isNav && !isModal && (
              <button className="t-back" onClick={back}>← Back</button>
            )}
            {!isModal && (
              <button className="t-next" onClick={next}>
                {isNav ? 'Take me there →' : isLast ? '✓ Done' : 'Next →'}
              </button>
            )}
            {isModal && (
              <button className="t-next" onClick={() => setShowModal(true)}>Open Import ↑</button>
            )}
          </div>
        </div>

        <div className="t-prog">
          <div className="t-dots">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className={`t-dot${i === globalStep - 1 ? ' active' : i < globalStep - 1 ? ' done' : ''}`} />
            ))}
          </div>
          <span>{globalStep} / {totalSteps}</span>
        </div>
      </div>

      {showModal && restaurantId && (
        <MenuImportModal
          restaurantId={restaurantId}
          onClose={() => setShowModal(false)}
          onImported={handleImported}
        />
      )}
    </>
  );
}