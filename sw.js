const CACHE = 'gravestory-v46';
const TILE_CACHE = 'gravestory-tiles-v1';
self.addEventListener('install', e => {
  // No pre-cache list — network-first fetch handler caches everything on visit.
  // Pre-caching '/' fails on subpath deployments (e.g. GitHub Pages /Gravestory/).
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

  // CACHE-FIRST for map tiles — tiles never change, so cache hits win immediately.
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
