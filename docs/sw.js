/* الملاح — keeps the app's own files on the device so it opens without internet */
const CACHE = 'mallah-5.56-202611101550';
const FILES = ['./', "admin/apple-touch-icon.png","admin/icon-192.png","admin/icon-512.png","admin/icon-maskable.png","admin/icon.svg","admin/index.html","admin/manifest.webmanifest","app.js","apple-touch-icon.png","appupdate.js","ar.js","arbaeen.js","areas-data.js","areas.js","areas2.js","areasnav.js","crash.js","describe.js","dialog.js","drive.js","extras.js","field.js","fonts/plex-arabic-400.woff2","fonts/plex-arabic-600.woff2","fonts/plex-arabic-700.woff2","fonts/plex-latin-400.woff2","fonts/plex-latin-600.woff2","fonts/plex-latin-700.woff2","get/index.html","guide.js","home.js","icon-192.png","icon-512.png","icon-maskable.png","index.html","layout.js","lib/basemaps.js","lib/jsQR.min.js","lib/leaflet-rotate.js","lib/leaflet.css","lib/leaflet.js","lib/mapbox-gl-rtl-text.js","lib/maplibre-gl.css","lib/maplibre-gl.js","lib/pmtiles.js","lib/qrcode.min.js","lib/world.js","lib/xlsx.full.min.js","licadmin.js","license.js","logo.svg","manifest.webmanifest","measure.js","onboard.js","ops.js","pack-web.js","pay-qi.jpg","prayer.js","provinces.js","reach.js","remind.js","roads.js","share-card.jpg","team.js","teambg.js","teamchat.js","teamqr.js","teamsms.js","trip.js","trip/index.html","vecov.js","vector.js","weather.js","web.js","whatsnew.js"];
self.addEventListener('install', (e) => {
  self.skipWaiting();                                                          // a new version takes over by itself
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));   // fresh copies, never the browser's old ones
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mallah-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });
/* the adhan notification (sent by the Cloudflare worker at prayer time); tapping it plays the adhan */
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || '🕌 حان وقت الصلاة', {
    body: d.body || 'اضغط لرفع الأذان في الملاح', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'adhan', renotify: true,
    requireInteraction: d.k !== 'test', data: { k: d.k || '' }, lang: 'ar', dir: 'rtl'
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const k = (e.notification.data && e.notification.data.k) || '';
  if (k === 'test') return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes('/mallah/') && !x.url.includes('/admin/'));
    if (c) { c.postMessage({ adhan: k }); return c.focus(); }
    return self.clients.openWindow('./?adhan=' + k);
  }));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;     // maps, search, routing: straight to the network
  if (e.request.mode === 'navigate') {                                         // the page: newest when online, saved copy when not
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
