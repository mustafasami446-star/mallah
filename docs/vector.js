'use strict';
/* الملاح — خرائط العراق المتجهة بدون إنترنت (العراق كاملًا أو خريطة لكل محافظة)
   + اختيار المحافظة من خريطة العراق + تحديث الخرائط والتطبيق + البحث المحلي */

const ORIGIN = 'https://appassets.androidplatform.net';
const UPDATE_BASE = 'https://raw.githubusercontent.com/mustafasami446-star/mallah/main/updates/';
const VEC_ATTR = '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps';
const FULL_ID = 'iraq';

/* where the map packs live: the Android app's native store, or the browser's store (web version) */
const PK = (NATIVE && Android.mapInfo) ? {
  kind: 'native', ready: Promise.resolve(),
  info: () => JSON.parse(Android.mapInfo()),
  download: (id, u, s) => Android.mapDownload(id, u, s), importFile: () => Android.mapImport(),
  cancel: () => Android.mapCancel(), remove: async (id) => Android.mapDelete(id),
  async readSlice(id, o, l, signal) {
    const r = await fetch(ORIGIN + '/map/slice?p=' + encodeURIComponent(id) + '&o=' + o + '&l=' + l, { signal });
    if (!r.ok) throw new Error('map read ' + r.status); return r.arrayBuffer();
  },
  async file(id, name) { const r = await fetch(ORIGIN + '/files/map/' + id + '/' + name); if (!r.ok) throw new Error(r.status); return r.blob(); },
  fileBase: (id) => ORIGIN + '/files/map/' + id + '/'
} : (window.WebPack || null);

let packState = readPackInfo();     // {busy, busyId, packs: [{id, version, name, size}]}
let vecLibs = null;                 // promise of loaded libraries
let vecLayer = null, vecDark = false, vecMaxZ = 14;

function readPackInfo() {
  if (!PK) return { packs: [] };
  try { const i = PK.info(); i.packs = i.packs || []; return i; } catch (e) { return { packs: [] }; }
}
const packs = () => packState.packs;
const hasPack = (id) => packs().some((p) => p.id === id);
const packOf = (id) => packs().find((p) => p.id === id);
function fmtVer(v) { return v ? String(v).slice(0, 10) : '—'; }

/* ---------------- provinces (outlines bundled in provinces.js) ---------------- */
const PROVS = (window.PROVINCES && PROVINCES.features) || [];
const provFeat = (id) => PROVS.find((f) => f.properties.id === id);
function provName(id) {
  if (id === FULL_ID) return 'العراق كاملًا';
  const f = provFeat(id); if (f) return f.properties.name;
  const p = packOf(id) || remotePack(id); return (p && p.name) || id;
}
function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeom(lng, lat, g) {
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  return polys.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
}
function provinceAt(lat, lng) { const f = PROVS.find((x) => inGeom(lng, lat, x.geometry)); return f ? f.properties.id : null; }
function suggestedProv() {
  if (me) { const id = provinceAt(me.lat, me.lng); if (id) return id; }
  const c = map.getCenter(); return provinceAt(c.lat, c.lng);
}
/* is this spot on one of the installed maps? (outside Iraq: don't nag) */
function covered(lat, lng) { if (hasPack(FULL_ID)) return true; const id = provinceAt(lat, lng); return !id || hasPack(id); }

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
    maplibregl.addProtocol('mallahv', routeTile);
    // web version: fonts and symbols come from the browser's store
    if (PK && PK.kind === 'web') maplibregl.addProtocol('mallahfile', async (params) => {
      const rest = decodeURIComponent(params.url.replace('mallahfile://', '')), s = rest.indexOf('/');
      return { data: await (await PK.file(rest.slice(0, s), rest.slice(s + 1))).arrayBuffer() };
    });
  })();
  return vecLibs;
}
/* tiles are read from the map packs on the phone through the app's local server */
class PackSource {
  constructor(id, key) { this.id = id; this.key = key; }
  getKey() { return this.key; }
  async getBytes(offset, length, signal) { return { data: await PK.readSlice(this.id, offset, length, signal) }; }
}
/* one archive per installed pack; a tile is taken from the first pack that has it
   (provinces overlap a little at their borders, and all of them hold the whole country at low zoom) */
let archives = [];
function syncArchives() {
  const old = new Map(archives.map((a) => [a.key, a]));
  const list = packs().slice().sort((a, b) => (a.id === FULL_ID ? -1 : b.id === FULL_ID ? 1 : 0));
  archives = list.map((p) => {
    const key = 'mallah-' + p.id + '-' + p.version + '-' + p.size;
    return old.get(key) || { key, id: p.id, pm: new pmtiles.PMTiles(new PackSource(p.id, key)) };
  });
}
async function routeTile(params, abort) {
  const m = /^mallahv:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
  if (!m) return { data: new Uint8Array(0) };
  const z = +m[1], x = +m[2], y = +m[3], signal = abort && abort.signal;
  for (const a of archives) {
    try {
      const r = await a.pm.getZxy(z, x, y, signal);
      if (r && r.data) return { data: new Uint8Array(r.data) };
    } catch (e) { if (signal && signal.aborted) throw e; }
  }
  return { data: new Uint8Array(0) };                 // outside the downloaded maps: an empty tile
}
async function readMaxZoom() {
  let z = 0;
  for (const a of archives) { try { z = Math.max(z, (await a.pm.getHeader()).maxZoom); } catch (e) {} }
  vecMaxZ = z || 14;
}
function fontPack() { return hasPack(FULL_ID) ? FULL_ID : (packs()[0] || {}).id; }
function vecStyle(dark) {
  const flavor = basemaps.namedFlavor(dark ? 'dark' : 'light'), base = PK.fileBase(fontPack());
  return {
    version: 8,
    glyphs: base + 'fonts/{fontstack}/{range}.pbf',
    sprite: base + 'sprites/' + (dark ? 'dark' : 'light'),
    sources: { protomaps: { type: 'vector', tiles: ['mallahv://{z}/{x}/{y}'], minzoom: 0, maxzoom: vecMaxZ, attribution: VEC_ATTR } },
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
    loadLibs().then(async () => {
      if (!this._alive) return;
      syncArchives(); await readMaxZoom();
      if (!this._alive) return;
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
      checkCoverage();
    }).catch((e) => { console.error(e); toast('تعذّر تشغيل الخريطة المتجهة على هذا الهاتف — تم التحويل إلى الخريطة العادية', 5000); setLayer('esri'); });
  },
  onRemove() {
    this._alive = false;
    document.body.classList.remove('vec-on');
    if (this._gl) { this._gl.remove(); this._gl = null; }
    if (this._div) { this._div.remove(); this._div = null; }
    if (vecLayer === this) vecLayer = null;
    checkCoverage();
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
  setDark(d) { if (this._gl) { this._gl.setStyle(vecStyle(d)); vecDark = d; } },
  /* the set of installed packs changed: start over with fresh tiles */
  async reload() {
    if (!this._gl) return;
    syncArchives(); await readMaxZoom();
    if (this._gl) this._gl.setStyle(vecStyle(vecDark), { diff: false });
  }
});
function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
function enableVecLayer() {
  if (!packs().length || !webglOk()) { delete LAYERS.vec; OFFLINE_LAYER = 'esri'; renderLayerMenu(); return false; }
  LAYERS.vec = { name: hasPack(FULL_ID) ? '🇮🇶 خريطة العراق (بدون إنترنت)' : '🗺 خرائطي المنزّلة (بدون إنترنت)', make: () => new VecLayer() };
  // show it first in the layer menu
  const ordered = { vec: LAYERS.vec }; Object.keys(LAYERS).forEach((k) => { if (k !== 'vec') ordered[k] = LAYERS[k]; });
  Object.keys(LAYERS).forEach((k) => delete LAYERS[k]); Object.assign(LAYERS, ordered);
  OFFLINE_LAYER = 'vec';
  renderLayerMenu();
  return true;
}
window.onNightChange = (n) => { if (vecLayer) vecLayer.setDark(n); };

/* the set of installed packs changed (download, import, delete) */
function refreshPacks() {
  packState = readPackInfo();
  const had = !!LAYERS.vec;
  enableVecLayer();
  places = null; loadPlaces();
  if (!packs().length && layerKey === 'vec') setLayer('osm');
  else if (vecLayer) vecLayer.reload();
  else if (!had && packs().length) { store.set('layer', 'vec'); setLayer('vec'); }
  renderPacks();
}

/* ---------------- remote list of maps (updates/map.json) ---------------- */
let remoteMap = null, remoteApp = null;
function normRemote(m) {
  if (!m) return null;
  if (!Array.isArray(m.packs)) m.packs = [{ id: FULL_ID, name: 'العراق كاملًا', url: m.url, size: m.size }];
  return m;
}
function remotePack(id) { return remoteMap ? remoteMap.packs.find((p) => p.id === id) : null; }
const remoteVer = (id) => { const r = remotePack(id); return r ? (r.version || remoteMap.version) : ''; };
const isNewer = (p) => !!(remoteMap && p && remotePack(p.id) && remoteVer(p.id) > (p.version || ''));

/* ---------------- downloads: one at a time, the rest wait in line ---------------- */
let packQueue = [], packBusyState = null, lastReq = null;
function connType() { try { return (navigator.connection && navigator.connection.type) || ''; } catch (e) { return ''; } }
async function queuePacks(ids) {
  if (!PK) return;
  if (navigator.onLine === false) { toast('تحتاج اتصالًا بالإنترنت للتنزيل. يمكنك التثبيت من ملف بدلًا من ذلك.'); return; }
  if (!remoteMap) { await checkUpdates(true, true); if (!remoteMap) { toast('تعذّر الوصول إلى خادم الخرائط، حاول لاحقًا'); return; } }
  const items = ids.map(remotePack).filter(Boolean);
  if (!items.length) { toast('هذه الخريطة غير متوفرة على الخادم بعد'); return; }
  const total = items.reduce((s, p) => s + (p.size || 0), 0);
  const go = () => {
    items.forEach((p) => { if (!packQueue.includes(p.id) && !(packBusyState && packBusyState.id === p.id)) packQueue.push(p.id); });
    pumpQueue(); renderPacks();
  };
  if (connType() === 'cellular' && total > 30 * 1048576) actionSheet('أنت متصل ببيانات الهاتف — الحجم ' + fmtMB(total), [{ label: '⬇ تنزيل رغم ذلك', fn: go }]);
  else go();
}
function pumpQueue() {
  if (packBusyState || readPackInfo().busy) return;
  const id = packQueue.shift(); if (!id) return;
  const r = remotePack(id); if (!r) { pumpQueue(); return; }
  lastReq = r;
  if (!PK.download(id, r.url, r.size || 0)) { packQueue.unshift(id); toast('يوجد تنزيل قيد التنفيذ'); return; }
  packBusyState = { id, label: '⬇ جارٍ تنزيل خريطة ' + provName(id), info: '', pct: 0 };
  renderPacks();
}
function importPack() {
  if (!PK) return;
  toast('اختر ملف الخريطة (mallah-….zip)', 3500);
  packBusyState = { id: '', label: '📁 جارٍ نسخ ملف الخريطة', info: '', pct: 0 };
  PK.importFile(); renderPacks();
}
function removePack(id) {
  if (!confirm('حذف خريطة ' + provName(id) + ' من الهاتف؟ ستحتاج لتنزيلها من جديد للعمل بدون إنترنت هناك.')) return;
  const last = packs().length === 1;
  if (last && layerKey === 'vec') setLayer('osm');
  PK.remove(id).then(refreshPacks);
}
window.onMapPackProgress = (phase, done, total, id) => {
  if (!packBusyState) packBusyState = { id: id || '', label: '' };
  if (id && !packBusyState.id) packBusyState.id = id;
  if (phase === 'install') { packBusyState.label = '⚙️ جارٍ تجهيز خريطة ' + (packBusyState.id ? provName(packBusyState.id) : '') + '…'; packBusyState.info = ''; packBusyState.pct = 100; }
  else {
    packBusyState.pct = total ? Math.floor(done * 100 / total) : 0;
    packBusyState.info = fmtMB(done) + (total ? ' / ' + fmtMB(total) + ' · ' + packBusyState.pct + '%' : '');
  }
  const bars = document.querySelectorAll('.packBar i'), infs = document.querySelectorAll('.packInfo');
  if (bars.length && phase !== 'install') { bars.forEach((b) => { b.style.width = packBusyState.pct + '%'; }); infs.forEach((i) => { i.textContent = packBusyState.info; }); }
  else renderPacks();
};
window.onMapPackDone = (ok, msg, id) => {
  packBusyState = null;
  if (ok) {
    const first = !LAYERS.vec;
    refreshPacks();
    if (!first && layerKey !== 'vec') { store.set('layer', 'vec'); setLayer('vec'); }
    toast('✓ تم تثبيت خريطة ' + provName(id) + ' — تعمل الآن بدون إنترنت', 4500); say('تم تثبيت خريطة ' + provName(id));
    if (id === FULL_ID) {
      const extra = packs().filter((p) => p.id !== FULL_ID);
      if (extra.length && !packQueue.length) setTimeout(() => actionSheet('خريطة العراق الكاملة تغني عن خرائط المحافظات المنزّلة (' + extra.map((p) => provName(p.id)).join('، ') + ')', [
        { label: '🗑 حذفها لتوفير ' + fmtMB(extra.reduce((s, p) => s + (p.size || 0), 0)), fn: () => { Promise.all(extra.map((p) => PK.remove(p.id))).then(refreshPacks); } }
      ]), 1200);
    }
    pumpQueue();
  } else if (msg === 'cancelled') {
    packQueue = [];
    toast(PK && PK.kind === 'web' ? 'تم الإيقاف' : 'تم إيقاف التنزيل — يمكنك المتابعة لاحقًا من نفس النقطة');
  } else if (msg === 'direct') {
    // web: GitHub does not let a web page download the file directly — let the browser save it, then install it
    packQueue = [];
    const r = lastReq || remotePack(id) || {};
    actionSheet('نزّل ملف خريطة ' + provName(r.id || id) + ' أولًا، ثم ثبّته من الملف', [
      { label: '⬇ ١) تنزيل الملف (' + fmtMB(r.size || 0) + ')', fn: () => openExt(r.url) },
      { label: '📁 ٢) تثبيت الملف بعد اكتمال التنزيل', fn: () => importPack() }
    ]);
  } else {
    toast('تعذّر تثبيت خريطة ' + (id ? provName(id) : '') + ': ' + (msg || 'خطأ غير معروف'), 5000);
    setTimeout(pumpQueue, 1500);
  }
  packState = readPackInfo();
  renderPacks();
};

/* ---------------- the card in «الخرائط بدون إنترنت» ---------------- */
function busyRow() {
  if (!packBusyState) return '';
  return `<div class="item"><div class="grow"><div class="t">${packBusyState.label}</div><div class="s packInfo">${packBusyState.info || ''}</div><div class="bar packBar"><i style="width:${packBusyState.pct || 0}%"></i></div></div><button class="chip del" data-pk="cancel">إيقاف</button></div>`;
}
function renderPackCard() {
  const c = $('packCard'); if (!c) return;
  if (!PK) { c.innerHTML = '<h3>خرائط العراق بدون إنترنت</h3><div class="item"><div class="grow s">متصفحك لا يدعم حفظ الخرائط. جرّب Chrome أو Edge أو Safari حديث.</div></div>'; return; }
  let h = '<h3>خرائط العراق بدون إنترنت</h3>' + busyRow();
  packs().forEach((p) => {
    if (packBusyState && packBusyState.id === p.id) return;
    const nw = isNewer(p);
    h += `<div class="item"><div class="grow"><div class="t">${p.id === FULL_ID ? '🇮🇶' : '🗺'} ${esc(provName(p.id))} <span class="ok">✓</span></div><div class="s">الإصدار ${fmtVer(p.version)} · ${fmtMB(p.size || 0)}${nw ? ' · <span class="warnTxt">يتوفر تحديث</span>' : ''}</div></div>`
      + (nw ? `<button class="chip go" data-pk="upd" data-id="${p.id}">⬇ تحديث</button>` : '') + `<button class="chip" data-pk="more" data-id="${p.id}">⋯</button></div>`;
  });
  if (packQueue.length) h += `<div class="item"><div class="grow s">⏳ في الانتظار: ${packQueue.map((id) => esc(provName(id))).join('، ')}</div></div>`;
  if (!packs().length && !packBusyState) h += '<div class="item"><div class="grow s">نزّل خريطة محافظتك (بين 7 و 23 م.ب) أو العراق كاملًا، لتعمل الخريطة والبحث بأسماء عربية بدون إنترنت.</div></div>';
  h += `<div class="item"><button class="chip go grow" data-pk="pick" style="justify-content:center">🗺 ${packs().length ? 'إضافة محافظة أخرى' : 'اختر محافظتك'}</button><button class="chip" data-pk="imp">📁 من ملف</button></div>`;
  c.innerHTML = h;
  bindPackButtons(c);
}
function bindPackButtons(root) {
  root.querySelectorAll('[data-pk]').forEach((b) => {
    const id = b.dataset.id;
    b.onclick = () => {
      switch (b.dataset.pk) {
        case 'cancel': PK.cancel(); break;
        case 'upd': queuePacks([id]); break;
        case 'get': queuePacks([id]); break;
        case 'del': removePack(id); break;
        case 'imp': importPack(); break;
        case 'pick': openPicker(); break;
        case 'show': showProvince(id); break;
        case 'more': actionSheet('خريطة ' + provName(id) + ' — ' + fmtVer((packOf(id) || {}).version), [
          { label: '🔄 البحث عن تحديث', fn: () => checkUpdates(true) },
          { label: '🗺 عرضها على الخريطة', fn: () => showProvince(id) },
          { label: '🗑 حذف الخريطة من الهاتف', cls: 'danger', fn: () => removePack(id) }
        ]); break;
      }
    };
  });
}
function renderPacks() { renderPackCard(); renderPicker(); checkCoverage(); }

/* ---------------- the province picker: a map of Iraq to tap ---------------- */
let pickSel = null;
const SVG_W = 1000;
let svgProj = null;
function projector() {
  if (svgProj) return svgProj;
  let w = 180, e = -180, s = 90, n = -90;
  PROVS.forEach((f) => {
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    polys.forEach((p) => p[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
  });
  const k = Math.cos((s + n) / 2 * Math.PI / 180), sc = SVG_W / ((e - w) * k);
  svgProj = { w, n, k, sc, h: Math.ceil((n - s) * sc), p: (x, y) => [((x - w) * k * sc).toFixed(1), ((n - y) * sc).toFixed(1)] };
  return svgProj;
}
function buildSvg() {
  const P = projector();
  let paths = '', labels = '';
  PROVS.forEach((f) => {
    const g = f.geometry, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const d = polys.map((poly) => poly.map((ring) => 'M' + ring.map((c) => P.p(c[0], c[1]).join(',')).join('L') + 'Z').join('')).join('');
    paths += `<path class="pv" data-prov="${f.properties.id}" d="${d}"/>`;
    const [lx, ly] = P.p(f.properties.label[0], f.properties.label[1]);
    const small = ['halabja', 'baghdad', 'karbala'].includes(f.properties.id);
    labels += `<text class="pvl${small ? ' sm' : ''}" x="${lx}" y="${ly}">${esc(f.properties.name)}</text>`;
  });
  return `<svg id="provSvg" viewBox="-8 -8 ${SVG_W + 16} ${P.h + 16}" xmlns="http://www.w3.org/2000/svg">${paths}<g id="provMe"></g>${labels}</svg>`;
}
function ensurePicker() {
  if ($('provPanel')) return;
  const el = document.createElement('div');
  el.id = 'provPanel'; el.className = 'panel hidden';
  el.innerHTML = `<div class="panelHead"><button class="iconBtn" id="provClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button><h2>خرائط المحافظات</h2></div>
  <div class="panelBody" id="provBody">
    <div class="provHint">اضغط على محافظتك في الخريطة أو اخترها من القائمة</div>
    <div id="provMapWrap">${buildSvg()}</div>
    <div class="card" id="provSel"></div>
    <div class="card"><h3>كل الخرائط</h3><div id="provList"></div></div>
    <div class="note">كل خريطة محافظة تعمل وحدها: فيها المحافظة بكل شوارعها وأماكنها للبحث، ومعها العراق كله بتفاصيل عامة. يمكنك تنزيل أكثر من محافظة، أو العراق كاملًا مرة واحدة. الخرائط تُحدَّث كل ثلاثة أشهر من OpenStreetMap.</div>
  </div>`;
  document.body.appendChild(el);
  $('provClose').onclick = () => el.classList.add('hidden');
  $('provSvg').addEventListener('click', (e) => {
    const t = e.target.closest('[data-prov]');
    if (t) { pickSel = t.dataset.prov; renderPicker(); }
  });
}
function openPicker(sel) {
  ensurePicker();
  pickSel = sel || pickSel || suggestedProv() || (packs()[0] && packs()[0].id) || null;
  $('provPanel').classList.remove('hidden');
  $('provBody').scrollTop = 0;
  renderPicker();
  if (!remoteMap && navigator.onLine !== false) checkUpdates(true, true);
}
function statusOf(id) {
  if (packBusyState && packBusyState.id === id) return 'busy';
  if (packQueue.includes(id)) return 'queued';
  const p = packOf(id);
  if (p) return isNewer(p) ? 'old' : 'inst';
  return 'none';
}
const sizeOf = (id) => { const r = remotePack(id), p = packOf(id); return r ? r.size : p ? p.size : 0; };
function selCardHtml(id) {
  const st = statusOf(id), r = remotePack(id), p = packOf(id), here = id !== FULL_ID && me && provinceAt(me.lat, me.lng) === id;
  const bits = [];
  if (sizeOf(id)) bits.push(fmtMB(sizeOf(id)));
  if (r && r.places) bits.push(r.places.toLocaleString('en') + ' مكان للبحث');
  if (id === FULL_ID) bits.push('كل المحافظات');
  if (p) bits.push('<span class="ok">✓ مثبّتة</span> · الإصدار ' + fmtVer(p.version));
  if (st === 'old') bits.push('<span class="warnTxt">يتوفر تحديث ' + fmtVer(remoteVer(id)) + '</span>');
  let btns = '';
  if (st === 'busy') return busyRow();
  if (st === 'queued') btns = '<button class="chip" disabled>⏳ في الانتظار</button>';
  else if (st === 'none') btns = `<button class="chip go" data-pk="get" data-id="${id}">⬇ تنزيل</button>`;
  else btns = (st === 'old' ? `<button class="chip go" data-pk="upd" data-id="${id}">⬇ تحديث</button>` : `<button class="chip" data-pk="show" data-id="${id}">عرض</button>`) + `<button class="chip del" data-pk="del" data-id="${id}">حذف</button>`;
  const offline = st === 'none' && !remoteMap ? `<div class="s">${navigator.onLine === false ? 'لا يوجد اتصال بالإنترنت الآن' : 'جارٍ جلب قائمة الخرائط…'}</div>` : '';
  return `<div class="item"><div class="grow"><div class="t">${id === FULL_ID ? '🇮🇶' : '🗺'} ${esc(provName(id))}${here ? ' <span class="hereTag">📍 أنت هنا</span>' : ''}</div><div class="s">${bits.join(' · ')}</div>${offline}</div>${btns}</div>`;
}
function renderPicker() {
  const panel = $('provPanel'); if (!panel || panel.classList.contains('hidden')) return;
  // the map
  panel.querySelectorAll('.pv').forEach((el) => {
    const id = el.dataset.prov, st = statusOf(id), full = hasPack(FULL_ID);
    el.classList.toggle('inst', st === 'inst' || st === 'old' || (full && st === 'none'));
    el.classList.toggle('busy', st === 'busy' || st === 'queued');
    el.classList.toggle('sel', id === pickSel);
  });
  const meG = $('provMe');
  if (meG) {
    if (me) { const [x, y] = projector().p(me.lng, me.lat); meG.innerHTML = `<circle class="pvMe" cx="${x}" cy="${y}" r="9"/>`; } else meG.innerHTML = '';
  }
  // the selected map
  $('provSel').innerHTML = pickSel ? selCardHtml(pickSel) : '<div class="item"><div class="grow s">اختر محافظة من الخريطة</div></div>';
  bindPackButtons($('provSel'));
  // all maps
  const here = suggestedProv();
  const ids = PROVS.map((f) => f.properties.id).sort((a, b) => provName(a).localeCompare(provName(b), 'ar'));
  const rows = [FULL_ID].concat(ids).map((id) => {
    const st = statusOf(id), sz = sizeOf(id);
    const tag = { inst: '<span class="ok">✓ مثبّتة</span>', old: '<span class="warnTxt">تحديث</span>', busy: '<span class="warnTxt">⬇ جارٍ…</span>', queued: '⏳', none: '' }[st];
    return `<div class="res provRow${id === pickSel ? ' on' : ''}" data-pick="${id}"><div class="ic">${id === FULL_ID ? '🇮🇶' : '🗺'}</div><div style="flex:1;min-width:0"><div class="t">${esc(provName(id))}${id === here ? ' <span class="hereTag">📍</span>' : ''}</div><div class="s">${sz ? fmtMB(sz) : ''}${id === FULL_ID ? (sz ? ' · ' : '') + 'كل المحافظات في ملف واحد' : ''}</div></div><div class="s" style="flex:none">${tag}</div></div>`;
  });
  $('provList').innerHTML = rows.join('');
  $('provList').querySelectorAll('[data-pick]').forEach((el) => {
    el.onclick = () => { pickSel = el.dataset.pick; renderPicker(); $('provBody').scrollTo({ top: 0, behavior: 'smooth' }); };
  });
}
function showProvince(id) {
  ['provPanel', 'mapsPanel'].forEach((p) => { const el = $(p); if (el) el.classList.add('hidden'); });
  const f = provFeat(id);
  if (f) {
    let w = 180, e = -180, s = 90, n = -90;
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    polys.forEach((p) => p[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
    map.fitBounds([[s, w], [n, e]], { padding: [30, 30] });
  } else map.fitBounds([[29.06, 38.79], [37.39, 48.8]]);
  if (LAYERS.vec && layerKey !== 'vec') setLayer('vec');
}

/* ---------------- outside the downloaded maps: say so, and offer that province ---------------- */
function checkCoverage() {
  let hint = $('covHint');
  const show = (txt, id) => {
    if (!hint) { hint = document.createElement('button'); hint.id = 'covHint'; document.body.appendChild(hint); }
    hint.innerHTML = txt; hint.onclick = () => openPicker(id); hint.classList.remove('hidden');
    document.body.classList.add('cov-hint');
  };
  const hide = () => { if (hint) hint.classList.add('hidden'); document.body.classList.remove('cov-hint'); };
  if (!vecLayer || !packs().length || map.getZoom() < 9) return hide();
  const c = map.getCenter();
  if (covered(c.lat, c.lng)) return hide();
  const id = provinceAt(c.lat, c.lng);
  show(`خارج خرائطك المنزّلة · <b>نزّل خريطة ${esc(provName(id))}</b> ‹`, id);
}
map.on('moveend zoomend', checkCoverage);

/* ---------------- updates: maps and app ---------------- */
async function fetchJson(url) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status); return r.json();
}
function appVersion() { try { const [n, c] = Android.appVersion().split('|'); return { name: n, code: +c }; } catch (e) { return { name: '', code: 0 }; } }
async function checkUpdates(manual, quiet) {
  if (navigator.onLine === false) { if (manual && !quiet) toast('لا يوجد اتصال بالإنترنت'); return; }
  try { remoteMap = normRemote(await fetchJson(UPDATE_BASE + 'map.json')); } catch (e) { if (manual && !quiet) toast('تعذّر التحقق من التحديثات'); }
  try { remoteApp = await fetchJson(UPDATE_BASE + 'app.json'); } catch (e) {}
  store.set('updCheckT', Date.now());
  renderPacks();
  if (quiet) return;
  if (manual && remoteMap && packs().length && !packs().some(isNewer)) toast('خرائطك هي الأحدث ✓');
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
  if (!remoteMap || !PK || packBusyState || readPackInfo().busy) return;
  const old = packs().filter(isNewer);
  if (packs().length) {
    const key = 'u' + old.map((p) => p.id + remoteVer(p.id)).join(',');
    if (old.length && store.get('mapOffered', '') !== key) {
      store.set('mapOffered', key);
      const size = old.reduce((s, p) => s + sizeOf(p.id), 0);
      actionSheet('🗺 تحديث خرائطك متوفر (' + fmtVer(remoteMap.version) + '): ' + old.map((p) => provName(p.id)).join('، '), [
        { label: '⬇ تحديث الآن (' + fmtMB(size) + ')', fn: () => queuePacks(old.map((p) => p.id)) }
      ]);
    }
    return;
  }
  const key = 'i' + remoteMap.version;
  if (store.get('mapOffered', '') === key) return;
  store.set('mapOffered', key);
  const sug = suggestedProv(), r = sug && remotePack(sug);
  const items = [];
  if (r) items.push({ label: '⬇ نزّل خريطة ' + provName(sug) + ' (' + fmtMB(r.size) + ')', fn: () => queuePacks([sug]) });
  else if (remotePack(FULL_ID)) items.push({ label: '⬇ نزّل خريطة العراق كاملًا (' + fmtMB(remotePack(FULL_ID).size) + ')', fn: () => queuePacks([FULL_ID]) });
  items.push({ label: '🗺 اختر محافظة أخرى أو العراق كاملًا', fn: () => openPicker(sug) });
  actionSheet('🗺 نزّل خريطة محافظتك لتعمل بدون إنترنت، بأسماء عربية وبحث محلي', items);
}

/* ---------------- offline place search (merged from every installed map) ---------------- */
let places = null, placesLoading = null, lastPlaceHits = [];
const PLACE_ICON = { city: '🏙', town: '🏘', village: '🏡', suburb: '📍', neighbourhood: '📍', quarter: '📍', hamlet: '🏡', locality: '📍',
  hospital: '🏥', clinic: '🏥', pharmacy: '💊', fuel: '⛽', mosque: '🕌', church: '⛪', school: '🏫', university: '🎓', college: '🎓',
  police: '🚓', bank: '🏦', restaurant: '🍽', cafe: '☕', hotel: '🏨', marketplace: '🛒', supermarket: '🛒', park: '🌳', stadium: '🏟',
  airport: '✈️', bus_station: '🚌', government: '🏛', townhall: '🏛', museum: '🏛' };
function loadPlaces() {
  if (places || placesLoading || !packs().length) return placesLoading;
  const ids = packs().map((p) => p.id);
  placesLoading = Promise.all(ids.map((id) => PK.file(id, 'places.tsv').then((b) => b.text()).catch(() => ''))).then((texts) => {
    const out = [], seen = new Set();
    texts.forEach((t) => t.split('\n').forEach((line, i) => {
      if (!i || !line) return;
      const c = line.split('\t'); if (c.length < 4) return;
      const lat = +c[2], lng = +c[3]; if (!isFinite(lat) || !isFinite(lng)) return;
      const dk = c[0] + '|' + lat.toFixed(4) + '|' + lng.toFixed(4);
      if (seen.has(dk)) return; seen.add(dk);
      out.push({ n: c[0], e: c[1] || '', lat, lng, k: c[4] || '', a: c[5] || '', key: normName(c[0]) + '|' + (c[1] || '').toLowerCase().replace(/[\s\-_.]+/g, '') });
    }));
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
  return '<div class="secTitle">أماكن من خرائطك المنزّلة (بدون إنترنت)</div>' + lastPlaceHits.map((p, i) => {
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
function vecHandleBack() {
  const p = $('provPanel');
  if (p && !p.classList.contains('hidden')) { p.classList.add('hidden'); return true; }
  return false;
}

/* ---------------- init ---------------- */
(async function initVector() {
  if (PK) { await PK.ready; packState = readPackInfo(); }
  // the packs card sits at the top of the offline maps panel
  const panel = $('mapsPanel') && $('mapsPanel').querySelector('.panelBody');
  if (panel && !$('packCard')) { const c = document.createElement('div'); c.className = 'card'; c.id = 'packCard'; panel.insertBefore(c, panel.firstChild); }
  const oldOpen = $('openMaps').onclick;
  $('openMaps').onclick = (e) => { oldOpen && oldOpen(e); renderPackCard(); if (PK && !remoteMap && navigator.onLine !== false) checkUpdates(true, true); };
  if (enableVecLayer()) {
    loadPlaces();
    const want = store.get('layer', null);
    if (want == null) setLayer('vec');                                   // first start with a map: use it
    else if (want === 'vec' || navigator.onLine === false) setLayer('vec', true);
  }
  // check for map/app updates at most twice a day, a little after start
  if (PK && Date.now() - store.get('updCheckT', 0) > 12 * 3600 * 1000) setTimeout(() => checkUpdates(false), 6000);
})();
