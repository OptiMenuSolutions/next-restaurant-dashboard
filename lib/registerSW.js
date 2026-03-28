// lib/registerSW.js
// Call this once from pages/_app.js inside a useEffect

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(registration => {
        console.log('[SW] Registered:', registration.scope);

        // Check for updates every 60 seconds
        setInterval(() => registration.update(), 60 * 1000);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — could show a toast here in future
              console.log('[SW] New version available. Refresh to update.');
            }
          });
        });
      })
      .catch(err => {
        console.warn('[SW] Registration failed:', err);
      });
  });
}