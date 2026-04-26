/* NutriTrack Service Worker */
const CACHE = 'nutritrack-v3';
const SHELL = [
  './',
  './static/css/style.css',
  './static/js/db.js',
  './static/js/groq.js',
  './static/js/app.js',
  './static/icons/icon-192.png',
  './static/icons/icon-512.png',
  './static/manifest.json',
];

// Install: cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for external APIs (Groq), cache-first for everything else
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Let external API calls (Groq) go through network directly — no caching
  if (url.hostname !== self.location.hostname) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for all local assets (app shell, JS, CSS, icons)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // If offline and not cached, return a minimal offline page for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
