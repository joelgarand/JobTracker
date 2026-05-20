const CACHE_NAME = 'jobtracker-v25';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js'
];

// Install event: cache core assets for offline use
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Activate immediately without waiting for old SW to finish
  self.skipWaiting();
});

// Activate event: clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Take control of all open tabs immediately
      return self.clients.claim();
    })
  );
});

// Fetch event: network-first with cache fallback
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      // Cache successful GET responses
      if (event.request.method === 'GET' && networkResponse.status === 200) {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
      }
      return networkResponse;
    }).catch(() => {
      return caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        if (event.request.mode === 'navigate') {
          return new Response(
            '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>JobTracker - Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a1a;color:#e0e0e0;padding:24px;text-align:center}.c{max-width:320px}.i{font-size:64px;margin-bottom:16px}h1{font-size:20px;margin-bottom:8px;color:#4ecca3}p{font-size:15px;color:#a0a0b0}</style></head><body><div class="c"><div class="i">📡</div><h1>Offline</h1><p>Keine Internetverbindung. Deine Daten sind sicher gespeichert und verfügbar sobald du wieder online bist.</p></div></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Listen for messages from the app (e.g., force update)
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
