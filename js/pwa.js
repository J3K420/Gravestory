// ── PWA SERVICE WORKER + INSTALL PROMPT ─────────────────────────
// Self-contained PWA bootstrap. Two side-effects at load time:
//   1. Conditional service worker registration (https only).
//   2. beforeinstallprompt listener — captures the deferred event
//      for later use by the install banner.
//
// Stage-4 timing-lesson audit: this module runs in <head>, before
// HTML parsing reaches <body>. Verified safe:
//   - The SW registration does no DOM reads at load time (only
//     navigator.serviceWorker.register with a blob URL).
//   - The beforeinstallprompt listener registers on window; the
//     event itself only fires after the page is fully loaded by
//     browser guarantee, and the only DOM read (#install-banner)
//     happens inside a 3000ms setTimeout after that, so DOM is
//     unambiguously parsed by the time getElementById runs.
// No DOMContentLoaded guard needed.
//
// Module-level state:
//   - deferredPrompt (captured beforeinstallprompt event; null
//     until the browser fires it).

// ── PWA SERVICE WORKER ───────────────────────────────────────────
// Only register service worker when hosted on https:// (not local files)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const swCode = `
    const CACHE = 'gravestory-v12
';
    const TILE_CACHE = 'gravestory-tiles-v1';
    const OFFLINE_URLS = ['/'];
    self.addEventListener('install', e => {
      e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS))
      );
      self.skipWaiting();
    });
    self.addEventListener('activate', e => {
      e.waitUntil(
        caches.keys().then(keys =>
          Promise.all(keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k)))
        )
      );
      self.clients.claim();
    });
    self.addEventListener('fetch', e => {
      if (e.request.method !== 'GET') return;
      const url = e.request.url;
      // CACHE-FIRST for map tiles — tiles never change, so cache hits should win immediately.
      // This eliminates pop-in and flicker during zoom/pan because tiles render from disk, not network.
      const isTile = url.includes('tile.openstreetmap.org') || url.includes('/tile/');
      if (isTile) {
        e.respondWith(
          caches.open(TILE_CACHE).then(cache =>
            cache.match(e.request).then(cached => {
              if (cached) return cached;
              return fetch(e.request).then(r => {
                if (r.ok) cache.put(e.request, r.clone());
                return r;
              });
            })
          )
        );
        return;
      }
      // NETWORK-FIRST for everything else — keep app fresh, fall back to cache offline.
      e.respondWith(
        fetch(e.request)
          .then(r => {
            const clone = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
            return r;
          })
          .catch(() => caches.match(e.request))
      );
    });
  `;
  const blob = new Blob([swCode], { type: 'application/javascript' });
  const swUrl = URL.createObjectURL(blob);
  navigator.serviceWorker.register(swUrl)
    .then(() => console.log('✅ GraveStory PWA ready'))
    .catch(err => console.log('SW skipped:', err));
}

// ── ADD TO HOME SCREEN PROMPT ─────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show install banner after a short delay
  setTimeout(showInstallBanner, 3000);
});

function showInstallBanner() {
  if (!deferredPrompt) return;
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.remove('hidden');
}

function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(choice => {
    deferredPrompt = null;
    document.getElementById('install-banner').classList.add('hidden');
  });
}

function dismissInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.add('hidden');
  deferredPrompt = null;
}
