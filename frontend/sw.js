// src/sw.js
const CACHE = 'finance-app-v4';
const APP_SHELL = [
  './',
  './index.html',
  './src/main.js',
  './style.css',
  './manifest.webmanifest'
];

globalThis.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(APP_SHELL).catch((err) => {
        console.warn('[ServiceWorker] Error al precachear recursos:', err);
      })
    )
  );
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
  const request = e.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === globalThis.location.origin;

  // No interceptar peticiones a orígenes externos (ej: backend en Render, fuentes de Google, CDNs)
  if (!isSameOrigin) {
    return;
  }

  // Si la petición es de navegación HTML
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Network-First para scripts y estilos propios con fallback a caché
  e.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});
