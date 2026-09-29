/* Pocket Logic service worker — caches the whole (tiny) app so it runs fully offline.
 * Bump VERSION whenever a cached file changes. */
const VERSION = 'pocket-logic-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/core.js',
  './js/games/flow.js',
  './js/games/nonogram.js',
  './js/games/bridges.js',
  './js/games/beacons.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first (instant + offline), refreshing the cache in the background when online.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      if (cached) { event.waitUntil(network); return cached; }
      return network;
    }),
  );
});
