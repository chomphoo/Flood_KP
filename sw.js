// Service worker – Flood KP (installable PWA + offline copy of the latest data).
// build-site.mjs replaces __BUILD__ with a build id so each deployment refreshes the app shell.
const VERSION = '__BUILD__';
const SHELL = `floodkp-shell-${VERSION}`;
const DATA = 'floodkp-data';
const SHELL_FILES = [
  './',
  'index.html',
  'stats.html',
  'about.html',
  'manifest.webmanifest',
  'assets/css/style.css',
  'assets/js/app.js',
  'assets/js/common.js',
  'assets/js/extras.js',
  'assets/js/stats.js',
  'assets/vendor/leaflet/leaflet.css',
  'assets/vendor/leaflet/leaflet.js',
  'assets/icon.svg',
  'assets/icons/icon-192.png',
  'data/static/amphoe.geojson',
  'data/static/province.geojson',
  'data/static/gazetteer.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(SHELL_FILES.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('floodkp-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Network first; on failure serve the cached copy and mark it with x-sw-cache. */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (!hit) throw err;
    const headers = new Headers(hit.headers);
    headers.set('x-sw-cache', '1');
    return new Response(await hit.blob(), { status: 200, headers });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles, fonts, APIs: browser default
  const p = url.pathname;
  if (p.includes('/data/live/') || p.includes('/data/risk/') || p.includes('/data/stats/')) {
    e.respondWith(networkFirst(req, DATA));
  } else if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL).catch(() => caches.match('index.html')));
  } else {
    // App files: always try the network first so a new deployment shows immediately; cache = offline fallback.
    e.respondWith(networkFirst(req, SHELL));
  }
});

// Clicking a local notification focuses (or opens) the site.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => 'focus' in c);
      return win ? win.focus() : self.clients.openWindow('./');
    }),
  );
});
