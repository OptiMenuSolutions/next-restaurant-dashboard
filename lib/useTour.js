// lib/useTour.js
// Shepherd.js tour hook — import and call on each page that participates in the tour.
// Usage: useTour('menu-items', restaurantId)
// The tour is triggered by ?tour=true in the URL and advances between pages automatically.

import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Tour step definitions per page
const TOUR_STEPS = {
  dashboard: [
    {
      id: 'dash-welcome',
      attachTo: { element: '.mi-logo, .db', on: 'bottom' },
      title: 'Welcome to OptiMenu 👋',
      text: "Let's take a quick tour so you can get the most out of the platform. This is your Dashboard — your daily command center.",
      buttons: ['next'],
    },
    {
      id: 'dash-stats',
      attachTo: { element: '.db-stats, .wbar-stats, .mi-sbar', on: 'bottom' },
      title: 'Key Metrics at a Glance',
      text: 'These cards show your most important numbers — total spend, invoice count, ingredient costs, and menu margins. They update in real time as you add data.',
      buttons: ['back', 'next'],
    },
    {
      id: 'dash-nav',
      attachTo: { element: '.mi-nav, .pr-nav', on: 'bottom' },
      title: 'Navigate the App',
      text: "Use the top nav to move between pages. We'll visit Invoices, Ingredients, Menu Items, and Analytics — each one builds on the last.",
      buttons: ['back', 'next'],
      advanceTo: '/client/invoices?tour=true',
    },
  ],

  invoices: [
    {
      id: 'inv-intro',
      attachTo: { element: '.mi-ph-title, .mob-page-title', on: 'bottom' },
      title: 'Invoice Tracking',
      text: 'Upload your supplier invoices here. OptiMenu reads the line items and automatically updates your ingredient costs — no manual entry needed.',
      buttons: ['next'],
    },
    {
      id: 'inv-add',
      attachTo: { element: '.mi-add-btn', on: 'bottom' },
      title: 'Add Your First Invoice',
      text: "Click here to upload a PDF or photo of any supplier invoice. Claude will extract the items and prices. Try it after the tour — it takes under 30 seconds.",
      buttons: ['back', 'next'],
      advanceTo: '/client/ingredients?tour=true',
    },
  ],

  ingredients: [
    {
      id: 'ing-intro',
      attachTo: { element: '.mi-ph-title, .mob-page-title', on: 'bottom' },
      title: 'Ingredient Cost Tracking',
      text: 'Every ingredient from your invoices appears here with its current cost per unit. When a supplier raises prices, this updates automatically.',
      buttons: ['next'],
    },
    {
      id: 'ing-list',
      attachTo: { element: '.mi-grid-wrap, .mi-body', on: 'top' },
      title: 'Your Ingredient Library',
      text: 'Ingredients are linked to your menu items. When costs change, your menu margins recalculate instantly — you always know your true food cost.',
      buttons: ['back', 'next'],
      advanceTo: '/client/menu-items?tour=true',
    },
  ],

  'menu-items': [
    {
      id: 'menu-intro',
      attachTo: { element: '.mi-ph-title, .mob-page-title', on: 'bottom' },
      title: 'Menu Engineering',
      text: "This is where the magic happens. Every dish on your menu lives here with its food cost, price, and profit margin calculated automatically.",
      buttons: ['next'],
    },
    {
      id: 'menu-import',
      attachTo: { element: '#menu-import-btn', on: 'bottom' },
      title: "Import Your Menu — Let's Do It Now",
      text: "Upload a photo or PDF of your existing menu and Claude will extract every dish name and price automatically. Click Import Menu to try it right now.",
      buttons: ['back', 'next'],
      highlight: '#menu-import-btn',
    },
    {
      id: 'menu-cards',
      attachTo: { element: '.mi-grid', on: 'top' },
      title: 'Your Menu Items',
      text: "Each card shows the dish's price, food cost, and margin. Green = healthy margin, red = needs attention. Click any card for a full breakdown.",
      buttons: ['back', 'next'],
      advanceTo: '/client/analytics?tour=true',
    },
  ],

  analytics: [
    {
      id: 'analytics-intro',
      attachTo: { element: '.mi-ph-title, .mob-page-title', on: 'bottom' },
      title: 'Sales Analytics',
      text: "Connect your POS system or upload a CSV export to unlock sales data. OptiMenu crosses sales velocity with ingredient costs to find your best opportunities.",
      buttons: ['next'],
    },
    {
      id: 'analytics-recs',
      attachTo: { element: '.dish-recs, .mi-body', on: 'top' },
      title: 'Daily AI Dish Recommendations',
      text: "Every day, OptiMenu recommends three dishes for your wait staff to push — based on margin, inventory risk, and sales trends. No more guessing.",
      buttons: ['back', 'next'],
    },
    {
      id: 'analytics-done',
      attachTo: null,
      title: "You're all set! 🎉",
      text: "That's the full tour. Start by importing your menu, then add your first invoice. OptiMenu gets smarter the more data you add. Questions? Hit Support in the profile menu.",
      buttons: ['done'],
    },
  ],
};

export function useTour(page, restaurantId) {
  const router = useRouter();

  useEffect(() => {
    if (!router.query.tour) return;
    if (typeof window === 'undefined') return;

    let shepherd;
    let tourInstance;

    async function initTour() {
      // Dynamically import Shepherd to avoid SSR issues
      const { default: Shepherd } = await import('shepherd.js');
      await import('shepherd.js/dist/css/shepherd.css');

      const steps = TOUR_STEPS[page];
      if (!steps || steps.length === 0) return;

      tourInstance = new Shepherd.Tour({
        useModalOverlay: true,
        defaultStepOptions: {
          cancelIcon: { enabled: true },
          classes: 'optimenu-tour-step',
          scrollTo: { behavior: 'smooth', block: 'center' },
          modalOverlayOpeningPadding: 8,
          modalOverlayOpeningRadius: 6,
        },
      });

      steps.forEach((step, idx) => {
        const isLast = idx === steps.length - 1;
        const buttons = [];

        if (step.buttons.includes('back') && idx > 0) {
          buttons.push({
            text: '← Back',
            classes: 'tour-btn-back',
            action() { tourInstance.back(); },
          });
        }

        if (step.buttons.includes('next') && !isLast) {
          buttons.push({
            text: step.advanceTo ? 'Next Page →' : 'Next →',
            classes: 'tour-btn-next',
            action() {
              if (step.advanceTo) {
                tourInstance.complete();
                router.push(step.advanceTo);
              } else {
                tourInstance.next();
              }
            },
          });
        }

        if (step.buttons.includes('done') || (step.buttons.includes('next') && isLast && !step.advanceTo)) {
          buttons.push({
            text: '✓ Finish Tour',
            classes: 'tour-btn-next',
            action() {
              tourInstance.complete();
              // Mark tour as seen in localStorage
              try { localStorage.setItem('optimenu_tour_done', '1'); } catch {}
              router.push('/client/dashboard');
            },
          });
        }

        tourInstance.addStep({
          id: step.id,
          title: step.title,
          text: step.text,
          attachTo: step.attachTo?.element ? step.attachTo : undefined,
          buttons,
          when: {
            show() {
              // Pulse highlight the target element if specified
              if (step.highlight) {
                const el = document.querySelector(step.highlight);
                if (el) el.classList.add('tour-highlight-pulse');
              }
            },
            hide() {
              if (step.highlight) {
                const el = document.querySelector(step.highlight);
                if (el) el.classList.remove('tour-highlight-pulse');
              }
            },
          },
        });
      });

      // Small delay to let the page render before starting
      setTimeout(() => tourInstance.start(), 600);
    }

    initTour();

    return () => {
      if (tourInstance) {
        try { tourInstance.complete(); } catch {}
      }
    };
  }, [router.query.tour, page]);
}