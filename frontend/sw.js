const CACHE = 'finance-app-v2';
const ASSETS = ['./', './index.html', './app.js', './manifest.webmanifest'];

globalThis.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  globalThis.skipWaiting();
});

globalThis.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
  );
  globalThis.clients.claim();
});

globalThis.addEventListener('fetch', (e) => {
  e.respondWith(
    caches
      .match(e.request)
      .then(
        (r) => r || fetch(e.request).catch(() => caches.match('./index.html'))
      )
  );
});
