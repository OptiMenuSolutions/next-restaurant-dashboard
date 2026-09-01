// lib/tourSteps.js
// Shared guided-tour step data + geometry helpers, ported from the Claude
// Design prototype's tour-engine.js. PAGE_FILES (which pointed at .dc.html
// filenames) is dropped — PAGE_ORDER's keys already match this app's real
// route slugs (/client/dashboard, /client/invoices, etc.) directly, so no
// filename mapping is needed.

export const PAGE_STEPS = {
  dashboard: [
    { selector: null, title: 'Welcome to your dashboard', text: "This is what a fully set-up account looks like \u2014 sample data, real math. Two minutes to see how it fits your kitchen." },
    { selector: '[data-tour="db-grid-wrap"]', padding: 6, title: "Every night's pass, printed for you", text: "Tonight's push list, OptiScore, waste risk, and the week in review \u2014 the exact page your kitchen checks before service." },
    { selector: '[data-tour="db-panel"]', padding: 8, title: 'One number for the whole business', text: 'OptiScore rolls up margin quality, invoice coverage, and pricing accuracy into a single score you can watch move week to week.' },
    { selector: null, nav: true, title: 'See where the numbers start', text: "Every dish's cost traces back to an invoice. Take a look.", nextKey: 'invoices' },
  ],
  invoices: [
    { selector: '[data-tour="inv-list"]', padding: 8, title: 'Upload once, read forever', text: 'Drop in a photo or PDF and OptiMenu reads the supplier, the date, and every line item \u2014 no retyping.' },
    { selector: '[data-tour="inv-detail"]', padding: 8, title: 'Line items become ingredient prices', text: 'Each item links straight to your ingredient list, so a price change shows up everywhere it matters.' },
    { selector: '[data-tour="inv-row"]', padding: 6, clickTarget: true, title: 'Try it \u2014 click a row', text: 'Open any invoice to see the full read-out on the right.' },
    { selector: null, nav: true, title: 'Where those prices land', text: "Take a look at what your ingredients actually cost.", nextKey: 'ingredients' },
  ],
  ingredients: [
    { selector: '[data-tour="ing-list"]', padding: 8, title: 'Prices that update themselves', text: "Every ingredient here is priced from what you actually paid \u2014 not a guess, and never stale." },
    { selector: '[data-tour="ing-detail"]', padding: 8, title: 'Watch costs before they hurt margin', text: 'Price history, purchase records, and every dish an ingredient touches \u2014 in one place.' },
    { selector: '[data-tour="ing-row"]', padding: 6, clickTarget: true, title: 'Click an ingredient', text: 'See its full price history and purchase trail.' },
    { selector: null, nav: true, title: 'Now put it on a plate', text: 'Here\u2019s what those prices mean for your menu.', nextKey: 'menu-items' },
  ],
  'menu-items': [
    { selector: '[data-tour="mi-grid-wrap"]', padding: 8, title: 'Your menu, costed in real time', text: "Every dish priced at today's ingredient costs. Green margin is healthy, red needs a look." },
    { selector: '[data-tour="mi-detail"]', padding: 8, title: 'Know which dishes are slipping', text: 'Top and bottom performers, and how the whole menu is trending since your prices moved.' },
    { selector: '[data-tour="mi-card"]', padding: 6, clickTarget: true, title: 'Click a dish', text: 'See the full ingredient breakdown behind its margin.' },
    { selector: null, nav: true, title: 'Last stop: what actually sold', text: 'Costs are half the story. Here\u2019s the sales side.', nextKey: 'analytics' },
  ],
  analytics: [
    { selector: '[data-tour="an-trend"]', padding: 10, title: 'What sold, and what it earned', text: 'Sync your POS and OptiMenu matches every sale to its true cost \u2014 automatically, every night.' },
    { selector: '[data-tour="an-matrix"]', padding: 8, title: 'Find your stars, and your dogs', text: 'Every dish plotted by volume and margin, so you know exactly what to push tonight and what to cut.' },
    { selector: '[data-tour="an-kpis"]', padding: 6, title: 'The whole business, at a glance', text: 'Net sales, plates sold, food cost, and margin \u2014 refreshed every time you sync.' },
    { selector: null, finish: true, title: "That's OptiMenu", text: 'Everything you just saw runs on your own numbers from day one. Your kitchen, minus the guesswork.' },
  ],
};

export const PAGE_ORDER = ['dashboard', 'invoices', 'ingredients', 'menu-items', 'analytics'];

export function totalSteps() {
  return PAGE_ORDER.reduce((s, k) => s + PAGE_STEPS[k].length, 0);
}
export function pageOffset(page) {
  return PAGE_ORDER.slice(0, PAGE_ORDER.indexOf(page)).reduce((s, k) => s + PAGE_STEPS[k].length, 0);
}
export function getSpot(selector, pad) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}
export function getTooltipPos(spot, ttW, ttH) {
  const vw = window.innerWidth, vh = window.innerHeight, g = 16;
  let left, top;
  if (!spot) {
    left = Math.max(16, (vw - ttW) / 2);
    top = Math.max(16, (vh - ttH) / 2);
  } else {
    const { x, y, w, h } = spot;
    left = x + w / 2 - ttW / 2;
    top = y + h + g;
    if (top + ttH > vh - 60) top = y - ttH - g;
    if (top < 10) top = y + h + g;
    left = Math.max(16, Math.min(vw - ttW - 16, left));
    top = Math.max(10, Math.min(vh - ttH - 70, top));
  }
  return { left, top };
}
