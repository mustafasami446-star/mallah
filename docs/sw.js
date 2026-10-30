/* الملاح — keeps the app's own files on the device so it opens without internet */
const CACHE = 'mallah-4.6-202610300812';
const FILES = ['./', "app.js","apple-touch-icon.png","ar.js","areas-data.js","areas.js","field.js","fonts/plex-arabic-400.woff2","fonts/plex-arabic-600.woff2","fonts/plex-arabic-700.woff2","fonts/plex-latin-400.woff2","fonts/plex-latin-600.woff2","fonts/plex-latin-700.woff2","guide.js","home.js","icon-192.png","icon-512.png","icon-maskable.png","index.html","lib/basemaps.js","lib/leaflet-rotate.js","lib/leaflet.css","lib/leaflet.js","lib/mapbox-gl-rtl-text.js","lib/maplibre-gl.css","lib/maplibre-gl.js","lib/pmtiles.js","lib/world.js","lib/xlsx.full.min.js","logo.svg","manifest.webmanifest","measure.js","onboard.js","ops.js","pack-web.js","provinces.js","vecov.js","vector.js","web.js"];
self.addEventListener('install', (e) => {
  self.skipWaiting();                                                          // a new version takes over by itself
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));   // fresh copies, never the browser's old ones
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mallah-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;     // maps, search, routing: straight to the network
  if (e.request.mode === 'navigate') {                                         // the page: newest when online, saved copy when not
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
