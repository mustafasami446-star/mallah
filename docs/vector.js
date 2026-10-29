'use strict';
/* الملاح — خريطة العراق المتجهة (تعمل بدون إنترنت) + تحديث الخريطة والتطبيق + البحث المحلي */

const ORIGIN = 'https://appassets.androidplatform.net';
const UPDATE_BASE = 'https://raw.githubusercontent.com/mustafasami446-star/mallah/main/updates/';
const VEC_ATTR = '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps';

/* where the map pack lives: the Android app's native store, or the browser's store (web version) */
const PK = (NATIVE && Android.mapInfo) ? {
  kind: 'native', ready: Promise.resolve(),
  info: () => JSON.parse(Android.mapInfo()),
  download: (u, s) => Android.mapDownload(u, s), importFile: () => Android.mapImport(),
  cancel: () => Android.mapCancel(), remove: async () => Android.mapDelete(),
  async readSlice(o, l, signal) { const r = await fetch(ORIGIN + '/map/slice?o=' + o + '&l=' + l, { signal }); if (!r.ok) throw new Error('map read ' + r.status); return r.arrayBuffer(); },
  async file(name) { const r = await fetch(ORIGIN + '/files/map/' + name); if (!r.ok) throw new Error(r.status); return r.blob(); },
  fileBase: ORIGIN + '/files/map/'
} : (window.WebPack ? Object.assign(window.WebPack, { fileBase: 'mallahfile://' }) : null);
let pack = readPackInfo();          // {installed, version, size, busy}
let vecLibs = null;                 // promise of loaded libraries
let vecLayer = null, vecProtocolKey = null, vecDark = false;

function readPackInfo() {
  if (!PK) return { installed: false };
  try { return PK.info(); } catch (e) { return { installed: false }; }
}
function fmtVer(v) { return v ? String(v).slice(0, 10) : '—'; }

/* ---------------- libraries (loaded only when the vector map is used) ---------------- */
function loadCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
function loadLibs() {
  if (vecLibs) return vecLibs;
  vecLibs = (async () => {
    loadCss('lib/maplibre-gl.css');
    await loadScript('lib/maplibre-gl.js');
    await loadScript('lib/pmtiles.js');
    await loadScript('lib/basemaps.js');
    // Arabic shaping: hand the plugin to the map's workers as a blob so it never needs the network
    try {
      const txt = await (await fetch('lib/mapbox-gl-rtl-text.js')).text();
      await maplibregl.setRTLTextPlugin(URL.createObjectURL(new Blob([txt], { type: 'text/javascript' })), false);
    } catch (e) { console.warn('rtl plugin', e); }
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    // web version: fonts and symbols come from the browser's store
    if (PK && PK.kind === 'web') maplibregl.addProtocol('mallahfile', async (params) => {
      const name = decodeURIComponent(params.url.replace('mallahfile://', ''));
      return { data: await (await PK.file(name)).arrayBuffer() };
    });
    return protocol;
  })();
  return vecLibs;
}
/* tiles are read from the map pack on the phone through the app's local server */
class PackSource {
  constructor(key) { this.key = key; }
  getKey() { return this.key; }
  async getBytes(offset, length, signal) { return { data: await PK.readSlice(offset, length, signal) }; }
}
function vecStyle(dark) {
  const flavor = basemaps.namedFlavor(dark ? 'dark' : 'light');
  return {
    version: 8,
    glyphs: PK.fileBase + 'fonts/{fontstack}/{range}.pbf',
    sprite: PK.fileBase + 'sprites/' + (dark ? 'dark' : 'light'),
    sources: { protomaps: { type: 'vector', url: 'pmtiles://' + vecProtocolKey, attribution: VEC_ATTR } },
    layers: basemaps.layers('protomaps', flavor, { lang: 'ar' })
  };
}
/* The vector map is drawn by MapLibre in its own full-screen canvas *behind* the Leaflet map,
   and follows Leaflet's camera: every pan/pinch frame jumps, and Leaflet's zoom animation is
   mirrored by an equally timed MapLibre animation. Nothing is stretched or resized while zooming,
   so there are no blank strips or flashes. */
const ZOOM_MS = 250;                                                  // Leaflet's zoom transition
const leafletEase = (t) => 1 - Math.pow(1 - t, 3);                   // close to cubic-bezier(0,0,.25,1)
const VecLayer = L.Layer.extend({
  options: { maxZoom: 21, minZoom: 3 },
  onAdd(m) {
    this._m = m; this._alive = true;
    document.body.classList.add('vec-on');
    loadLibs().then((protocol) => {
      if (!this._alive) return;
      const key = 'mallah-' + (pack.version || 'x');
      if (vecProtocolKey !== key) { protocol.add(new pmtiles.PMTiles(new PackSource(key))); vecProtocolKey = key; }
      vecDark = document.body.classList.contains('night');
      this._div = document.createElement('div');
      this._div.id = 'glmap';
      document.body.insertBefore(this._div, $('map'));
      const c = m.getCenter();
      this._gl = new maplibregl.Map({
        container: this._div, style: vecStyle(vecDark), interactive: false, attributionControl: false,
        center: [c.lng, c.lat], zoom: m.getZoom() - 1, maxZoom: 21, fadeDuration: 0,
        renderWorldCopies: false, pixelRatio: Math.min(2, window.devicePixelRatio || 1)
      });
      this._gl.on('error', (e) => console.warn('vec', e && e.error && e.error.message));
      vecLayer = this;
    }).catch((e) => { console.error(e); toast('تعذّر تشغيل الخريطة المتجهة على هذا الهاتف — تم التحويل إلى الخريطة العادية', 5000); setLayer('esri'); });
  },
  onRemove() {
    this._alive = false;
    document.body.classList.remove('vec-on');
    if (this._gl) { this._gl.remove(); this._gl = null; }
    if (this._div) { this._div.remove(); this._div = null; }
    if (vecLayer === this) vecLayer = null;
  },
  getEvents() { return { move: this._sync, zoom: this._sync, zoomanim: this._anim, resize: this._resize, viewreset: this._sync }; },
  _sync() {
    if (!this._gl || this._animating) return;
    const c = this._m.getCenter();
    this._gl.jumpTo({ center: [c.lng, c.lat], zoom: this._m.getZoom() - 1 });
  },
  _anim(e) {
    if (!this._gl) return;
    this._animating = true;
    clearTimeout(this._animT);
    this._gl.easeTo({ center: [e.center.lng, e.center.lat], zoom: e.zoom - 1, duration: ZOOM_MS, easing: leafletEase });
    this._animT = setTimeout(() => { this._animating = false; this._sync(); }, ZOOM_MS + 20);
  },
  _resize() { if (this._gl) { this._gl.resize(); this._sync(); } },
  getAttribution() { return VEC_ATTR; },
  setDark(d) { if (this._gl) { this._gl.setStyle(vecStyle(d)); vecDark = d; } }
});
function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
function enableVecLayer() {
  if (!pack.installed || !webglOk()) { delete LAYERS.vec; OFFLINE_LAYER = 'esri'; renderLayerMenu(); return false; }
  LAYERS.vec = { name: '🇮🇶 خريطة العراق (بدون إنترنت)', make: () => new VecLayer() };
  // show it first in the layer menu
  const ordered = { vec: LAYERS.vec }; Object.keys(LAYERS).forEach((k) => { if (k !== 'vec') ordered[k] = LAYERS[k]; });
  Object.keys(LAYERS).forEach((k) => delete LAYERS[k]); Object.assign(LAYERS, ordered);
  OFFLINE_LAYER = 'vec';
  renderLayerMenu();
  return true;
}
window.onNightChange = (n) => { if (vecLayer) vecLayer.setDark(n); };

/* ---------------- map pack panel ---------------- */
let remoteMap = null, remoteApp = null;
function renderPackCard() {
  const c = $('packCard'); if (!c) return;
  pack = Object.assign(readPackInfo(), packBusyState ? { busy: true } : {});
  let status, btns = '';
  if (!PK) { c.innerHTML = '<h3>خريطة العراق الكاملة</h3><div class="item"><div class="grow s">متصفحك لا يدعم حفظ الخريطة. جرّب Chrome أو Edge أو Safari حديث.</div></div>'; return; }
  const newer = remoteMap && (!pack.installed || remoteMap.version > pack.version);
  if (packBusyState) {
    status = `<div class="t">${packBusyState.label}</div><div class="s" id="packInfo">${packBusyState.info || ''}</div><div class="bar"><i id="packBar" style="width:${packBusyState.pct || 0}%"></i></div>`;
    btns = '<button class="chip del" id="packCancel">إيقاف</button>';
  } else if (pack.installed) {
    status = `<div class="t">🇮🇶 خريطة العراق الكاملة <span class="ok">✓ مثبّتة</span></div><div class="s">الإصدار ${fmtVer(pack.version)} · ${fmtMB(pack.size || 0)}${newer ? ' · <span class="warnTxt">يتوفر تحديث ' + fmtVer(remoteMap.version) + '</span>' : ''}</div>`;
    btns = (newer ? '<button class="chip go" id="packGet">⬇ تحديث</button>' : '') + '<button class="chip" id="packMore">⋯</button>';
  } else {
    status = `<div class="t">🇮🇶 خريطة العراق الكاملة</div><div class="s">كل المدن والطرق بأسماء عربية، والبحث بدون إنترنت${remoteMap ? ' · ' + fmtMB(remoteMap.size) : ''}</div>`;
    btns = '<button class="chip go" id="packGet">⬇ تنزيل</button><button class="chip" id="packImp">📁 من ملف</button>';
  }
  c.innerHTML = '<h3>الخريطة الأساسية</h3><div class="item"><div class="grow">' + status + '</div>' + btns + '</div>';
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('packGet', () => startPackDownload());
  on('packImp', () => importPack());
  on('packCancel', () => PK.cancel());
  on('packMore', () => actionSheet('خريطة العراق — ' + fmtVer(pack.version), [
    { label: '🔄 البحث عن تحديث', fn: () => checkUpdates(true) },
    { label: '📁 تثبيت من ملف (أرسله لك زميل)', fn: () => importPack() },
    { label: '🗑 حذف الخريطة من الهاتف', cls: 'danger', fn: () => {
      if (!confirm('حذف خريطة العراق؟ ستحتاج لتنزيلها من جديد للعمل بدون إنترنت.')) return;
      if (layerKey === 'vec') setLayer('osm');
      PK.remove().then(() => { pack = readPackInfo(); enableVecLayer(); places = null; renderPackCard(); });
    } }
  ]));
}
let packBusyState = null;
function connType() { try { return (navigator.connection && navigator.connection.type) || ''; } catch (e) { return ''; } }
async function startPackDownload() {
  if (!PK) return;
  if (navigator.onLine === false) { toast('تحتاج اتصالًا بالإنترنت للتنزيل. يمكنك التثبيت من ملف بدلًا من ذلك.'); return; }
  if (!remoteMap) { await checkUpdates(true); if (!remoteMap) { toast('تعذّر الوصول إلى خادم الخرائط، حاول لاحقًا'); return; } }
  const go = () => {
    if (!PK.download(remoteMap.url, remoteMap.size || 0)) { toast('يوجد تنزيل قيد التنفيذ'); return; }
    packBusyState = { label: '⬇ جارٍ تنزيل خريطة العراق', info: '', pct: 0 }; renderPackCard();
  };
  if (connType() === 'cellular') actionSheet('أنت متصل ببيانات الهاتف — حجم الخريطة ' + fmtMB(remoteMap.size), [{ label: '⬇ تنزيل رغم ذلك', fn: go }]);
  else go();
}
function importPack() {
  if (!PK) return;
  toast('اختر ملف الخريطة (mallah-iraq-map.zip)', 3500);
  packBusyState = { label: '📁 جارٍ نسخ ملف الخريطة', info: '', pct: 0 };
  PK.importFile(); renderPackCard();
}
window.onMapPackProgress = (phase, done, total) => {
  if (!packBusyState) packBusyState = { label: '' };
  if (phase === 'install') { packBusyState.label = '⚙️ جارٍ تجهيز الخريطة…'; packBusyState.info = ''; packBusyState.pct = 100; }
  else {
    packBusyState.pct = total ? Math.floor(done * 100 / total) : 0;
    packBusyState.info = fmtMB(done) + (total ? ' / ' + fmtMB(total) + ' · ' + packBusyState.pct + '%' : '');
  }
  const bar = $('packBar'), inf = $('packInfo');
  if (bar && inf && phase !== 'install') { bar.style.width = packBusyState.pct + '%'; inf.textContent = packBusyState.info; } else renderPackCard();
};
window.onMapPackDone = (ok, msg) => {
  packBusyState = null;
  pack = readPackInfo();
  if (ok) {
    enableVecLayer(); places = null; loadPlaces();
    store.set('layer', 'vec'); setLayer('vec');
    toast('✓ تم تثبيت خريطة العراق — تعمل الآن بدون إنترنت', 4500); say('تم تثبيت خريطة العراق');
  } else if (msg === 'cancelled') toast(PK && PK.kind === 'web' ? 'تم الإيقاف' : 'تم إيقاف التنزيل — يمكنك المتابعة لاحقًا من نفس النقطة');
  else if (msg === 'direct') {
    // web: GitHub does not let a web page download the file directly — let the browser save it, then install it
    actionSheet('نزّل ملف الخريطة أولًا، ثم ثبّته من الملف', [
      { label: '⬇ ١) تنزيل الملف (' + fmtMB(remoteMap ? remoteMap.size : 0) + ')', fn: () => openExt(remoteMap.url) },
      { label: '📁 ٢) تثبيت الملف بعد اكتمال التنزيل', fn: () => importPack() }
    ]);
  }
  else toast('تعذّر تثبيت الخريطة: ' + (msg || 'خطأ غير معروف'), 5000);
  renderPackCard();
};

/* ---------------- updates: map and app ---------------- */
async function fetchJson(url) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status); return r.json();
}
function appVersion() { try { const [n, c] = Android.appVersion().split('|'); return { name: n, code: +c }; } catch (e) { return { name: '', code: 0 }; } }
async function checkUpdates(manual) {
  if (navigator.onLine === false) { if (manual) toast('لا يوجد اتصال بالإنترنت'); return; }
  try { remoteMap = await fetchJson(UPDATE_BASE + 'map.json'); } catch (e) { if (manual) toast('تعذّر التحقق من التحديثات'); }
  try { remoteApp = await fetchJson(UPDATE_BASE + 'app.json'); } catch (e) {}
  store.set('updCheckT', Date.now());
  renderPackCard();
  if (manual && remoteMap && pack.installed && !(remoteMap.version > pack.version)) toast('خريطتك هي الأحدث ✓');
  offerUpdates(manual);
}
function offerUpdates(manual) {
  if (navState || directState || window.measActive) return;
  if (!$('modal').classList.contains('hidden') || document.querySelector('.panel:not(.hidden)')) { if (!manual) return; }
  const av = appVersion();
  if (NATIVE && remoteApp && remoteApp.versionCode > av.code && store.get('appOffered', 0) !== remoteApp.versionCode) {
    store.set('appOffered', remoteApp.versionCode);
    actionSheet('🆕 إصدار جديد من الملاح: ' + remoteApp.versionName + (remoteApp.notes ? ' — ' + remoteApp.notes : ''), [
      { label: '⬇ تنزيل التحديث (' + fmtMB(remoteApp.size || 0) + ')', fn: () => openExt(remoteApp.url) }
    ]);
    return;
  }
  if (remoteMap && PK && !pack.busy) {
    const newer = !pack.installed || remoteMap.version > pack.version;
    const key = (pack.installed ? 'u' : 'i') + remoteMap.version;
    if (newer && store.get('mapOffered', '') !== key) {
      store.set('mapOffered', key);
      actionSheet(pack.installed ? '🗺 تحديث خريطة العراق متوفر (' + fmtVer(remoteMap.version) + ')'
        : '🗺 نزّل خريطة العراق الكاملة لتعمل بدون إنترنت، بأسماء عربية وبحث محلي', [
        { label: '⬇ تنزيل الآن (' + fmtMB(remoteMap.size) + ')', fn: () => startPackDownload() }
      ]);
    }
  }
}

/* ---------------- offline place search ---------------- */
let places = null, placesLoading = null, lastPlaceHits = [];
const PLACE_ICON = { city: '🏙', town: '🏘', village: '🏡', suburb: '📍', neighbourhood: '📍', quarter: '📍', hamlet: '🏡', locality: '📍',
  hospital: '🏥', clinic: '🏥', pharmacy: '💊', fuel: '⛽', mosque: '🕌', church: '⛪', school: '🏫', university: '🎓', college: '🎓',
  police: '🚓', bank: '🏦', restaurant: '🍽', cafe: '☕', hotel: '🏨', marketplace: '🛒', supermarket: '🛒', park: '🌳', stadium: '🏟',
  airport: '✈️', bus_station: '🚌', government: '🏛', townhall: '🏛', museum: '🏛' };
function loadPlaces() {
  if (places || placesLoading || !pack.installed) return placesLoading;
  placesLoading = PK.file('places.tsv').then((b) => b.text()).then((t) => {
    const out = [];
    t.split('\n').forEach((line, i) => {
      if (!i || !line) return;
      const c = line.split('\t'); if (c.length < 4) return;
      const lat = +c[2], lng = +c[3]; if (!isFinite(lat) || !isFinite(lng)) return;
      out.push({ n: c[0], e: c[1] || '', lat, lng, k: c[4] || '', a: c[5] || '', key: normName(c[0]) + '|' + (c[1] || '').toLowerCase().replace(/[\s\-_.]+/g, '') });
    });
    places = out; placesLoading = null; return out;
  }).catch(() => { placesLoading = null; });
  return placesLoading;
}
const BIG = { city: 0, town: 1, suburb: 2, neighbourhood: 2, quarter: 2, village: 3 };
function searchPlaces(q) {
  if (!places) return [];
  const k = normName(q), ke = q.toLowerCase().replace(/[\s\-_.]+/g, '');
  if (k.length < 2 && ke.length < 2) return [];
  const hits = [];
  for (const p of places) {
    const [ar, en] = p.key.split('|');
    let s = -1;
    if (ar === k || en === ke) s = 0;
    else if (ar.startsWith(k) || (ke && en.startsWith(ke))) s = 1;
    else if (ar.includes(k) || (ke.length > 2 && en.includes(ke))) s = 2;
    if (s >= 0) hits.push([s * 10 + (BIG[p.k] != null ? BIG[p.k] : 5), p]);
    if (hits.length > 3000) break;
  }
  const ref = me ? [me.lat, me.lng] : [map.getCenter().lat, map.getCenter().lng];
  hits.sort((a, b) => a[0] - b[0] || hav(ref, [a[1].lat, a[1].lng]) - hav(ref, [b[1].lat, b[1].lng]));
  return hits.slice(0, 12).map((h) => h[1]);
}
function localPlacesHtml(q) {
  lastPlaceHits = searchPlaces(q);
  if (!lastPlaceHits.length) return '';
  return '<div class="secTitle">أماكن من خريطة العراق (بدون إنترنت)</div>' + lastPlaceHits.map((p, i) => {
    const d = me ? fmtDist(hav([me.lat, me.lng], [p.lat, p.lng])) : '';
    return `<div class="res" data-place="${i}"><div class="ic">${PLACE_ICON[p.k] || '📍'}</div><div style="flex:1;min-width:0"><div class="t">${esc(p.n)}</div><div class="s">${esc([p.a, p.e].filter(Boolean).join(' · '))}</div></div><div class="s" style="flex:none">${d}</div></div>`;
  }).join('');
}
/* plug the local places into the existing search (sites + places + online results) */
const _sitesHtml = sitesResultsHtml, _bindSites = bindSiteResults;
sitesResultsHtml = function (q) { return _sitesHtml(q) + localPlacesHtml(q); };
bindSiteResults = function () {
  _bindSites();
  resEl.querySelectorAll('[data-place]').forEach((el) => {
    el.onclick = () => { const p = lastPlaceHits[+el.dataset.place]; if (!p) return; closeSearch(); setDestination(p.lat, p.lng, p.n, [p.a, p.e].filter(Boolean).join(' · ')); };
  });
};

/* ---------------- init ---------------- */
(async function initVector() {
  if (PK) { await PK.ready; pack = readPackInfo(); }
  // the pack card sits at the top of the offline maps panel
  const panel = $('mapsPanel') && $('mapsPanel').querySelector('.panelBody');
  if (panel && !$('packCard')) { const c = document.createElement('div'); c.className = 'card'; c.id = 'packCard'; panel.insertBefore(c, panel.firstChild); }
  const oldOpen = $('openMaps').onclick;
  $('openMaps').onclick = (e) => { oldOpen && oldOpen(e); renderPackCard(); };
  if (enableVecLayer()) {
    loadPlaces();
    const want = store.get('layer', null);
    if (want == null) setLayer('vec');                                   // first start with a map: use it
    else if (want === 'vec' || navigator.onLine === false) setLayer('vec', true);
  }
  // check for map/app updates at most twice a day, a little after start
  if (PK && Date.now() - store.get('updCheckT', 0) > 12 * 3600 * 1000) setTimeout(() => checkUpdates(false), 6000);
})();
