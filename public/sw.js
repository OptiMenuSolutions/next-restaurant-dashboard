// public/sw.js
// OptiMenu Service Worker — cache-first for static assets, network-first for API/data

const CACHE_NAME = 'optimenu-v1';

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/client/dashboard',
  '/client/invoices',
  '/client/ingredients',
  '/client/menu-items',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ── Install: pre-cache static assets ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        // Don't fail install if some pre-cache URLs 404 (e.g. during first deploy)
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    })
  );
  // Activate immediately without waiting for old SW to become idle
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ── Fetch: routing strategy ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Supabase API calls — always network, never cache auth/data
  if (url.hostname.includes('supabase.co')) return;

  // Skip Next.js internal routes and HMR
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;
  if (url.pathname.startsWith('/__nextjs')) return;

  // Skip Vercel analytics
  if (url.hostname.includes('vercel-insights.com') || url.hostname.includes('va.vercel-scripts.com')) return;

  // ── Strategy 1: Cache-first for static assets (JS, CSS, fonts, images) ──
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Strategy 2: Network-first for page navigation and API routes ──
  // Falls back to cache if offline, shows offline page if nothing cached
  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && request.mode === 'navigate') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then(cached => {
            if (cached) return cached;
            // Offline fallback — return cached dashboard if available
            return caches.match('/client/dashboard');
          });
        })
    );
    return;
  }

  // ── Default: network with cache fallback ──
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Push notifications (future use) ───────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    data: { url: data.url || '/client/dashboard' },
    vibrate: [100, 50, 100],
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'OptiMenu', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});