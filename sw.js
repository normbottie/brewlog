/* Brewlog service worker — app shell cached, map tiles cached opportunistically. */

const VERSION = 'brewlog-v2';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './vendor/leaflet.css',
  './vendor/leaflet.js',
  './vendor/images/marker-icon.png',
  './vendor/images/marker-shadow.png',
  './js/app.js',
  './js/idb.js',
  './js/store.js',
  './js/supabase.js',
  './js/imaging.js',
  './js/radar.js',
  './js/ui.js',
  './js/seed.js',
  './js/places.js',
  './js/auth.js',
  './js/views/beans.js',
  './js/views/bean-detail.js',
  './js/views/bean-edit.js',
  './js/views/cafes.js',
  './js/views/cafe-detail.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // never cache API traffic
  if (/supabase\.co|googleapis\.com|api\.openai\.com|nominatim|overpass/.test(url.hostname)) return;

  // map tiles: cache-first, capped
  if (/tile\.openstreetmap\.org$|basemaps\.cartocdn\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok) {
            cache.put(request, res.clone());
            trimCache(TILES, 400);
          }
          return res;
        } catch {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // app shell: network-first so updates land, falling back to cache offline
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) {
    for (const k of keys.slice(0, keys.length - max)) await cache.delete(k);
  }
}
