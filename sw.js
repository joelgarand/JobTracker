const CACHE_NAME = 'jobtracker-v22';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js'
];

// Install event: cache core assets for offline use
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event: network-first with cache fallback for app assets
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      // Cache successful GET responses for future offline use
      if (event.request.method === 'GET' && networkResponse.status === 200) {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
      }
      return networkResponse;
    }).catch(() => {
      // Network failed: try cache
      return caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // No cache available: return offline message in German
        if (event.request.mode === 'navigate') {
          return new Response(
            '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>JobTracker - Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a1a;color:#e0e0e0;padding:24px;text-align:center}.offline-container{max-width:320px}.offline-icon{font-size:64px;margin-bottom:16px}h1{font-size:20px;font-weight:600;margin-bottom:8px;color:#4ecca3}p{font-size:15px;color:#a0a0b0;line-height:1.4}</style></head><body><div class="offline-container"><div class="offline-icon">📡</div><h1>Nicht verfügbar</h1><p>JobTracker benötigt eine Internetverbindung beim ersten Laden. Bitte stelle eine Verbindung her und versuche es erneut.</p></div></body></html>',
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }
          );
        }
        return new Response('Offline – nicht verfügbar', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
