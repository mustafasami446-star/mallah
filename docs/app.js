'use strict';
/* الملاح — Leaflet + OSRM + Nominatim navigation inside an Android WebView */

const NATIVE = typeof window.Android !== 'undefined';
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------------- map & layers ---------------- */
const LAYERS = {
  osm: { name: 'OpenStreetMap (عربي)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opt: { maxZoom: 19, attribution: '© OpenStreetMap contributors' } },
  esri: { name: 'خريطة الشوارع (تعمل بدون إنترنت)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}?blankTile=false',
    opt: { maxZoom: 19, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' } },
  sat: { name: 'قمر صناعي', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',
    opt: { maxZoom: 19, attribution: 'Imagery © Esri' } }
};
const lastView = store.get('view', { lat: 33.3152, lng: 44.3661, z: 12 });
const map = L.map('map', { zoomControl: false, attributionControl: true, tap: true, preferCanvas: false, minZoom: 3, maxZoom: 20, fadeAnimation: false })
  .setView([lastView.lat, lastView.lng], lastView.z);
let underLayer = null;
let baseLayer = null, layerKey = store.get('layer', 'osm');
const TILE_BASE = (NATIVE && Android.getTileBase) ? Android.getTileBase() : null;
let OFFLINE_LAYER = 'esri'; const OFFLINE_MAX_Z = 16;
/* Tiles: try the phone's offline copy first, then the internet, then a zoomed-in parent tile from the offline copy */
const CachedLayer = L.TileLayer.extend({
  createTile: function (coords, done) {
    // a plain <img> tile (Leaflet keeps the previous zoom level visible until these load, so no blank squares)
    const tile = document.createElement('img');
    tile.alt = ''; tile.setAttribute('role', 'presentation'); tile.decoding = 'async';
    const key = this.options.cacheKey, z = coords.z, x = coords.x, y = coords.y;
    const local = (zz, xx, yy) => TILE_BASE + '/' + key + '/' + zz + '/' + xx + '/' + yy + '.png';
    const c = [];
    // only ask the phone for a tile when a downloaded area covers it (saves a wasted round-trip per tile)
    const have = (zz, xx, yy) => TILE_BASE && zz <= OFFLINE_MAX_Z && downloadedAreas().some((a) =>
      (a.layer || 'esri') === key && zz >= a.minZ && zz <= a.maxZ && xx >= lon2x(a.w, zz) && xx <= lon2x(a.e, zz) && yy >= lat2y(a.n, zz) && yy <= lat2y(a.s, zz));
    if (have(z, x, y)) c.push({ src: local(z, x, y) });
    if (navigator.onLine !== false) c.push({ src: this.getTileUrl(coords) });
    // when a zoom level has no data, show an enlarged part of a lower-zoom tile instead of a placeholder
    for (let dz = 1; dz <= 6; dz++) {
      const pz = z - dz; if (pz < 0) break;
      const qx = x >> dz, qy = y >> dz, size = 256 >> dz, crop = { sx: (x - (qx << dz)) * size, sy: (y - (qy << dz)) * size, size };
      if (have(pz, qx, qy)) c.push(Object.assign({ src: local(pz, qx, qy) }, crop));
      if (navigator.onLine !== false) c.push(Object.assign({ src: L.Util.template(this._url, L.extend({ r: '', s: this._getSubdomain({ x: qx, y: qy }), x: qx, y: qy, z: pz }, this.options)) }, crop));
    }
    let i = 0, finished = false;
    const finish = (err) => { if (!finished) { finished = true; done(err, tile); } };
    const next = () => {
      if (i >= c.length) { finish(new Error('no tile')); return; }
      const t = c[i++];
      if (!t.size) {                      // a whole tile: load it straight into the <img>
        tile.onload = () => finish(null);
        tile.onerror = next;
        tile.src = t.src;
        return;
      }
      const img = new Image();            // part of a parent tile: cut it out, then show it
      if (!(TILE_BASE && t.src.startsWith(TILE_BASE))) img.crossOrigin = 'anonymous';   // network tiles need CORS to be cut
      img.onload = () => {
        try {
          const px = Math.min(2, window.devicePixelRatio || 1) * 256, cv = document.createElement('canvas');
          cv.width = cv.height = px;
          cv.getContext('2d').drawImage(img, t.sx * img.width / 256, t.sy * img.height / 256, t.size * img.width / 256, t.size * img.height / 256, 0, 0, px, px);
          tile.onload = () => finish(null); tile.onerror = next;
          tile.src = cv.toDataURL('image/png');
        } catch (e) { next(); }
      };
      img.onerror = next;
      img.src = t.src;
    };
    next();
    return tile;
  }
});
function setLayer(k, temp) {
  if (!LAYERS[k]) { k = 'osm'; temp = true; }      // a layer that isn't available (yet) must not overwrite the saved choice
  if (baseLayer) map.removeLayer(baseLayer);
  if (underLayer) { map.removeLayer(underLayer); underLayer = null; }
  let lay;
  if (LAYERS[k].make) lay = LAYERS[k].make();
  else {
    // keep old tiles on screen while zooming and load the new ones afterwards; past the source's last level, enlarge it
    const o = Object.assign({ cacheKey: k, keepBuffer: 4, updateWhenZooming: false }, LAYERS[k].opt);
    o.maxNativeZoom = o.maxZoom; o.maxZoom = 20;
    lay = new CachedLayer(LAYERS[k].url, o);
    // a coarse copy underneath (a few big tiles enlarged): when zooming out, the surroundings are already
    // covered by a softer picture instead of empty space, until the sharp tiles arrive
    if (!map.getPane('underPane')) { map.createPane('underPane').style.zIndex = 150; map.getPane('underPane').style.pointerEvents = 'none'; }
    underLayer = new CachedLayer(LAYERS[k].url, Object.assign({}, o, { pane: 'underPane', maxNativeZoom: Math.min(9, o.maxNativeZoom), keepBuffer: 6, updateWhenIdle: false, updateWhenZooming: true, attribution: '' })).addTo(map);
  }
  baseLayer = lay.addTo(map);
  layerKey = k; if (!temp) store.set('layer', k); renderLayerMenu();
}
function renderLayerMenu() {
  const m = $('layerMenu'); m.innerHTML = '';
  Object.keys(LAYERS).forEach((k) => {
    const b = document.createElement('button');
    b.textContent = LAYERS[k].name; if (k === layerKey) b.className = 'sel';
    b.onclick = () => { setLayer(k); m.classList.add('hidden'); };
    m.appendChild(b);
  });
  const sep = document.createElement('div'); sep.className = 'sep'; sep.textContent = 'الوضع الليلي'; m.appendChild(sep);
  const seg = document.createElement('div'); seg.className = 'seg';
  [['auto', 'تلقائي'], ['on', 'تشغيل'], ['off', 'إيقاف']].forEach(([v, t]) => {
    const b = document.createElement('button'); b.textContent = t;
    if ((typeof nightMode !== 'undefined' ? nightMode : 'auto') === v) b.className = 'sel';
    b.onclick = (e) => { e.stopPropagation(); setNightMode(v); };
    seg.appendChild(b);
  });
  m.appendChild(seg);
  document.body.classList.toggle('layer-sat', layerKey === 'sat');
  document.body.classList.toggle('layer-vec', layerKey === 'vec');
}
setLayer(layerKey, true);
/* map credits: shown when the app opens, folded into a small (i) after 5 s or when the map is touched,
   and shown again for 5 s when (i) is tapped — as the OpenStreetMap attribution guidelines allow */
map.attributionControl.setPrefix(false);
let attrT = 0;
function attrShow(ms) { document.body.classList.remove('attr-min'); clearTimeout(attrT); attrT = setTimeout(attrHide, ms || 5000); }
function attrHide() { clearTimeout(attrT); document.body.classList.add('attr-min'); }
attrShow(5000);
map.once('movestart zoomstart', attrHide);
$('attrBtn').onclick = (e) => { e.stopPropagation(); attrShow(5000); };
map.on('moveend', () => { const c = map.getCenter(); store.set('view', { lat: c.lat, lng: c.lng, z: map.getZoom() }); });

/* ---------------- helpers ---------------- */
let toastT = 0;
function toast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = 0; }, ms || 2600);
}
function loading(on) { $('loading').classList.toggle('hidden', !on); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDist(m) {
  if (m == null || isNaN(m)) return '—';
  if (m < 50) return Math.max(0, Math.round(m / 5) * 5) + ' م';
  if (m < 1000) return Math.round(m / 10) * 10 + ' م';
  if (m < 10000) return (m / 1000).toFixed(1).replace('.0', '') + ' كم';
  return Math.round(m / 1000) + ' كم';
}
function spokenDist(m) {
  if (m < 1000) { const r = m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50; return r + ' متر'; }
  const k = Math.round(m / 100) / 10; return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + ' كيلومتر';
}
function fmtDur(s) {
  if (s == null || isNaN(s)) return '—';
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return min + ' د';
  const h = Math.floor(min / 60), mm = min % 60;
  return h + ' س' + (mm ? ' ' + mm + ' د' : '');
}
function clock(d) { return d.toLocaleTimeString('ar-IQ-u-nu-latn', { hour: 'numeric', minute: '2-digit' }); }
const R = 6371008.8, rad = Math.PI / 180;
function hav(a, b) { // a,b = [lat,lng]
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function bearing(a, b) {
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
  const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
async function getJSON(url, timeoutMs) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Accept-Language': 'ar,en' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------------- icons ---------------- */
const ARROW = (deg) => `<svg viewBox="0 0 48 48"><g transform="rotate(${deg} 24 24)"><path d="M24 6l11 13h-7v19h-8V19h-7z" fill="#fff"/></g></svg>`;
const UTURN = '<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M32 42V20a8 8 0 0 0-16 0v6"/><path d="M9 21l7 8 7-8"/></svg>';
const ROUND = (n) => `<svg viewBox="0 0 48 48"><circle cx="24" cy="26" r="10" fill="none" stroke="#fff" stroke-width="5"/><path d="M24 4l8 9h-5v5h-6v-5h-5z" fill="#fff"/>${n ? `<text x="24" y="31" font-size="13" font-weight="800" text-anchor="middle" fill="#fff">${n}</text>` : ''}</svg>`;
const FLAG = '<svg viewBox="0 0 48 48"><path d="M12 44V6" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M14 7h24l-6 8 6 8H14z" fill="#fff"/></svg>';
const PIN = (c) => `<svg viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8 1 16.7 1 28.5 17 43 17 43s16-14.5 16-26.3C33 8 25.8 1 17 1z" fill="${c}" stroke="#fff" stroke-width="2"/><circle cx="17" cy="16.5" r="6" fill="#fff"/></svg>`;
const SPK_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const SPK_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
const MOD_DEG = { 'straight': 0, 'slight right': 45, 'right': 90, 'sharp right': 135, 'uturn': 180, 'sharp left': -135, 'left': -90, 'slight left': -45 };
function stepIcon(st) {
  const m = st.maneuver || {}; const t = m.type, mod = m.modifier;
  if (t === 'arrive') return FLAG;
  if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') return ROUND(m.exit || '');
  if (mod === 'uturn') return UTURN;
  if (t === 'depart') return ARROW(0);
  return ARROW(MOD_DEG[mod] != null ? MOD_DEG[mod] : 0);
}

/* ---------------- Arabic instructions ---------------- */
const MOD_AR = {
  'left': 'يسارًا', 'right': 'يمينًا', 'slight left': 'قليلًا إلى اليسار', 'slight right': 'قليلًا إلى اليمين',
  'sharp left': 'بحدة إلى اليسار', 'sharp right': 'بحدة إلى اليمين', 'straight': 'مباشرة', 'uturn': 'للخلف'
};
const ORD = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
function roadOf(st) { return (st.name && st.name.trim()) || (st.ref && st.ref.trim()) || ''; }
function instruction(st) {
  const m = st.maneuver || {}; const mod = m.modifier; const md = MOD_AR[mod] || '';
  const road = roadOf(st); const onto = road ? ' إلى ' + road : '';
  const side = mod && mod.indexOf('left') >= 0 ? 'اليسار' : (mod && mod.indexOf('right') >= 0 ? 'اليمين' : '');
  switch (m.type) {
    case 'depart': return 'انطلق' + (road ? ' على ' + road : '');
    case 'arrive': return 'وصلت إلى وجهتك' + (side ? '، على ' + side : '');
    case 'turn': return mod === 'uturn' ? 'استدر للخلف' + (road ? ' على ' + road : '') : (mod === 'straight' ? 'تابع مباشرة' + onto : 'انعطف ' + md + onto);
    case 'new name': return 'تابع' + (road ? ' على ' + road : ' مباشرة');
    case 'continue': return mod === 'uturn' ? 'استدر للخلف' : (mod && mod !== 'straight' ? 'تابع ' + md + onto : 'تابع مباشرة' + onto);
    case 'merge': return 'اندمج ' + (side ? 'إلى ' + side : '') + onto;
    case 'on ramp': return 'اسلك المنحدر ' + (side ? 'على ' + side : '') + onto;
    case 'off ramp': return 'اسلك المخرج ' + (side ? 'على ' + side : '') + onto;
    case 'fork': return 'عند التفرع، الزم ' + (side || 'المسار الأوسط') + onto;
    case 'end of road': return 'في نهاية الطريق انعطف ' + md + onto;
    case 'use lane': return 'الزم المسار ' + (md || 'المناسب');
    case 'roundabout': case 'rotary':
      return m.exit ? 'عند الدوار، اسلك المخرج ' + (ORD[m.exit] || ('رقم ' + m.exit)) + onto : 'ادخل الدوار' + onto;
    case 'roundabout turn': return 'عند الدوار انعطف ' + md + onto;
    case 'exit roundabout': case 'exit rotary': return 'اخرج من الدوار' + onto;
    default: return md ? 'تابع ' + md + onto : 'تابع' + onto;
  }
}

/* ---------------- location ---------------- */
let me = null;            // {lat,lng,acc,heading,speed,t}
let meMarker = null, accCircle = null, follow = true, gotFirstFix = false;
function meIcon(nav, heading) {
  const h = heading == null ? null : heading;
  const arrow = nav
    ? `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#2563eb" stroke="#fff" stroke-width="3"/><path d="M20 8l8 21-8-5-8 5z" fill="#fff"/></svg>`
    : (h == null ? '' : `<svg viewBox="0 0 48 48" width="48" height="48"><path d="M24 2l7 12H17z" fill="#2563eb" opacity=".85"/></svg>`);
  return L.divIcon({
    className: '', iconSize: nav ? [40, 40] : [28, 28], iconAnchor: nav ? [20, 20] : [14, 14],
    html: `<div class="me${nav ? ' nav' : ''}"><div class="hd" style="transform:rotate(${h || 0}deg)">${arrow}</div><div class="dot"></div></div>`
  });
}
let iconMode = null;
function updateMeMarker() {
  if (!me) return;
  const ll = [me.lat, me.lng]; const nav = !!(navState || directState);
  const key = (nav ? 'n' : 'p') + (me.heading == null ? '0' : '1');
  if (!meMarker) {
    meMarker = L.marker(ll, { icon: meIcon(nav, me.heading), zIndexOffset: 1000, interactive: false }).addTo(map);
    accCircle = L.circle(ll, { radius: me.acc || 0, color: '#2563eb', weight: 1, opacity: .4, fillOpacity: .08, interactive: false }).addTo(map);
    iconMode = key;
  } else {
    meMarker.setLatLng(ll); accCircle.setLatLng(ll); accCircle.setRadius(nav ? 0 : (me.acc || 0));
    if (key !== iconMode) { meMarker.setIcon(meIcon(nav, me.heading)); iconMode = key; }
    else {
      const hd = meMarker.getElement() && meMarker.getElement().querySelector('.hd');
      if (hd) hd.style.transform = 'rotate(' + (me.heading || 0) + 'deg)';
    }
  }
}
window.onNativeLocation = function (lat, lng, acc, head, speed) {
  const prev = me;
  let h = head;
  if (h == null && prev) {
    const d = hav([prev.lat, prev.lng], [lat, lng]);
    if (d > 4) h = bearing([prev.lat, prev.lng], [lat, lng]); else h = prev.heading;
  }
  me = { lat, lng, acc: acc || 0, heading: h, speed: speed, t: Date.now() };
  $('gpsBanner').classList.add('hidden');
  updateMeMarker();
  if (!gotFirstFix) {
    gotFirstFix = true;
    if (!dest) map.setView([lat, lng], 16);
  } else if (follow && !dest && !navState) {
    map.panTo([lat, lng], { animate: true });
  }
  if (typeof onOpsLocation === 'function') onOpsLocation();
  if (navState) onNavLocation();
  else if (directState) onDirectLocation();
  else if (dest && waitingForFix) { waitingForFix = false; computeAllModes(); }
};
let waitingForFix = false;
window.onGpsStatus = function (s) {
  const b = $('gpsBanner');
  if (s === 'on') { b.classList.add('hidden'); return; }
  const msg = { disabled: 'خدمة الموقع (GPS) متوقفة. شغّلها لتحديد موقعك.', denied: 'لم يُمنح إذن الموقع. اسمح به من إعدادات التطبيق.', error: 'تعذّر تشغيل تحديد الموقع.' }[s] || 'تعذّر تحديد الموقع.';
  $('gpsMsg').textContent = msg; b.classList.remove('hidden');
  $('gpsBtn').classList.toggle('hidden', !NATIVE);
};
$('gpsBtn').onclick = () => { if (NATIVE) Android.openLocationSettings(); };
function startLocation() {
  if (NATIVE) { Android.startGps(); return; }
  if (!navigator.geolocation) { onGpsStatus('error'); return; }
  navigator.geolocation.watchPosition(
    (p) => onNativeLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy,
      (p.coords.heading == null || isNaN(p.coords.heading)) ? null : p.coords.heading, p.coords.speed),
    (e) => onGpsStatus(e.code === 1 ? 'denied' : 'error'),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function setFollow(on) {
  follow = on; $('locBtn').classList.toggle('on', on);
}
map.on('dragstart', () => setFollow(false));
$('locBtn').onclick = () => {
  if (!me) { toast('جارٍ تحديد موقعك…'); startLocation(); return; }
  setFollow(true);
  map.setView([me.lat, me.lng], navState ? 17 : Math.max(map.getZoom(), 16));
};
$('layersBtn').onclick = (e) => { e.stopPropagation(); $('layerMenu').classList.toggle('hidden'); };
map.on('click', () => $('layerMenu').classList.add('hidden'));

/* ---------------- search ---------------- */
const qEl = $('q'), resEl = $('results');
let recents = store.get('recents', []);
function showRecents() {
  const home = favs.find((f) => f.kind === 'home'), work = favs.find((f) => f.kind === 'work');
  const others = favs.filter((f) => f.kind === 'other');
  let h = '';   // home / work chips live on the home sheet itself
  if (others.length) h += '<div class="secTitle">المفضلة</div>' + others.map((f) =>
    `<div class="res" data-f="${f.id}"><div class="ic">⭐</div><div><div class="t">${esc(f.name)}</div><div class="s">${esc(f.sub || '')}</div></div></div>`).join('');
  if (recents.length) h += '<div class="secTitle">الأماكن الأخيرة</div>' + recents.map((r, i) =>
    `<div class="res" data-r="${i}"><div class="ic">🕘</div><div><div class="t">${esc(r.name)}</div><div class="s">${esc(r.sub || '')}</div></div></div>`).join('');
  resEl.innerHTML = h;
  if (!h) { resEl.classList.add('hidden'); return; }
  resEl.classList.remove('hidden');
  resEl.querySelectorAll('[data-q]').forEach((el) => {
    el.onclick = () => {
      const f = favs.find((x) => x.kind === el.dataset.q);
      if (f) { closeSearch(); goFav(f); }
      else toast('اختر المكان من البحث أو بالضغط المطوّل على الخريطة، ثم اضغط «☆ حفظ في المفضلة»', 4500);
    };
  });
  resEl.querySelectorAll('[data-f]').forEach((el) => { el.onclick = () => { closeSearch(); goFav(favs.find((x) => x.id === el.dataset.f)); }; });
  resEl.querySelectorAll('[data-r]').forEach((el) => { el.onclick = () => { const r = recents[+el.dataset.r]; closeSearch(); setDestination(r.lat, r.lng, r.name, r.sub); }; });
}
function addRecent(p) {
  recents = [p].concat(recents.filter((r) => Math.abs(r.lat - p.lat) > 1e-5 || Math.abs(r.lng - p.lng) > 1e-5)).slice(0, 8);
  store.set('recents', recents);
}
function closeSearch() { resEl.classList.add('hidden'); qEl.blur(); }
qEl.addEventListener('focus', () => { if (!qEl.value.trim()) showRecents(); });
qEl.addEventListener('input', () => {
  $('clearQ').classList.toggle('hidden', !qEl.value);
  if (!qEl.value.trim()) { showRecents(); return; }
  const h = sitesResultsHtml(qEl.value.trim());
  if (h) { resEl.innerHTML = h + '<div class="secTitle">اضغط بحث للبحث في الخريطة أيضًا</div>'; resEl.classList.remove('hidden'); bindSiteResults(); }
});
$('clearQ').onclick = () => { qEl.value = ''; $('clearQ').classList.add('hidden'); qEl.focus(); showRecents(); };
function splitName(item) {
  const full = item.display_name || '';
  const parts = full.split('،').join(',').split(',').map((s) => s.trim()).filter(Boolean);
  const name = item.name || parts[0] || full;
  const sub = parts.filter((p) => p !== name).slice(0, 4).join('، ');
  return { name, sub };
}
let searchSeq = 0;
$('searchBar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = qEl.value.trim(); if (!q) return;
  // coordinates in any format: decimal, DMS, UTM
  const pc = parseCoords(q);
  if (pc) { closeSearch(); setDestination(pc.lat, pc.lng, 'إحداثيات', fmtCoord(pc.lat, pc.lng)); return; }
  const seq = ++searchSeq;
  const siteHtml = sitesResultsHtml(q);
  if (navigator.onLine === false) {
    resEl.innerHTML = siteHtml || '<div class="secTitle">لا يوجد اتصال. البحث بالاسم يحتاج إنترنت؛ يمكنك كتابة إحداثيات أو البحث في مواقع العمل.</div>';
    resEl.classList.remove('hidden'); bindSiteResults(); return;
  }
  resEl.innerHTML = siteHtml + '<div class="secTitle">جارٍ البحث…</div>'; resEl.classList.remove('hidden'); bindSiteResults();
  const c = me ? { lat: me.lat, lng: me.lng } : map.getCenter();
  const vb = [c.lng - 1.5, c.lat + 1.5, c.lng + 1.5, c.lat - 1.5].map((v) => v.toFixed(4)).join(',');
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=10&accept-language=ar,en'
    + '&viewbox=' + vb + '&q=' + encodeURIComponent(q);
  try {
    const data = await getJSON(url);
    if (seq !== searchSeq) return;
    if (!data.length) { resEl.innerHTML = siteHtml + '<div class="secTitle">لا توجد نتائج في الخريطة. جرّب كتابة الاسم بطريقة أخرى.</div>'; bindSiteResults(); return; }
    if (me) data.sort((a, b) => hav([me.lat, me.lng], [+a.lat, +a.lon]) - hav([me.lat, me.lng], [+b.lat, +b.lon]));
    resEl.innerHTML = siteHtml + (siteHtml ? '<div class="secTitle">نتائج الخريطة</div>' : '') + data.map((it, i) => {
      const n = splitName(it);
      const d = me ? fmtDist(hav([me.lat, me.lng], [+it.lat, +it.lon])) : '';
      return `<div class="res" data-i="${i}"><div class="ic">📍</div><div style="flex:1;min-width:0"><div class="t">${esc(n.name)}</div><div class="s">${esc(n.sub)}</div></div><div class="s" style="flex:none">${d}</div></div>`;
    }).join('');
    resEl.querySelectorAll('[data-i]').forEach((el) => {
      el.onclick = () => { const it = data[+el.dataset.i]; const n = splitName(it); closeSearch(); setDestination(+it.lat, +it.lon, n.name, n.sub); };
    });
    bindSiteResults();
  } catch (err) {
    if (seq === searchSeq) { resEl.innerHTML = siteHtml + '<div class="secTitle">تعذّر البحث في الخريطة. تحقّق من اتصال الإنترنت.</div>'; bindSiteResults(); }
  }
});

/* long-press (or right click) on the map sets a destination */
map.on('contextmenu', async (e) => {
  if (navState || window.measActive) return;
  closeSearch();
  const { lat, lng } = e.latlng;
  setDestination(lat, lng, 'نقطة محددة', lat.toFixed(5) + ', ' + lng.toFixed(5), true);
  try {
    const r = await getJSON('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ar,en&lat=' + lat + '&lon=' + lng, 10000);
    if (dest && dest.lat === lat && dest.lng === lng && r && r.display_name) {
      const n = splitName(r); dest.name = n.name; dest.sub = n.sub;
      $('destName').textContent = n.name; $('destSub').textContent = n.sub;
    }
  } catch (err) { /* keep coordinates */ }
});

/* ---------------- destination & routing ---------------- */
let routeNetErr = false;
let dest = null, destMarker = null, mode = store.get('mode', 'car');
let routes = {}, routeLayer = null, routeCasing = null, routeSeq = 0;
const ENDPOINTS = {
  car: ['https://routing.openstreetmap.de/routed-car/route/v1/driving/', 'https://router.project-osrm.org/route/v1/driving/'],
  bike: ['https://routing.openstreetmap.de/routed-bike/route/v1/driving/'],
  foot: ['https://routing.openstreetmap.de/routed-foot/route/v1/driving/']
};
function selectModeBtn() { document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('sel', b.dataset.m === mode)); }
selectModeBtn();
document.querySelectorAll('.mode').forEach((b) => {
  b.onclick = () => { mode = b.dataset.m; store.set('mode', mode); selectModeBtn(); showRoute(); };
});
function setDestination(lat, lng, name, sub, skipRecent) {
  dest = { lat, lng, name, sub };
  if (!skipRecent) addRecent({ lat, lng, name, sub });
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'pin', html: PIN('#ef4444'), iconSize: [34, 44], iconAnchor: [17, 43] }) }).addTo(map);
  $('destName').textContent = name; $('destSub').textContent = sub || '';
  updateFavBtn(); fieldSheetUpdate();
  $('sheet').classList.remove('hidden');
  fabsAboveSheet();
  setFollow(false);
  routes = {}; document.querySelectorAll('.mode b').forEach((b) => { b.textContent = '—'; });
  if (!me) {
    $('routeInfo').innerHTML = '<span class="small">بانتظار تحديد موقعك لحساب المسار…</span>';
    $('startBtn').disabled = true;
    map.setView([lat, lng], 16);
    waitingForFix = true;
    startLocation();
    return;
  }
  if (navigator.onLine === false) { useSavedOrWarn(); return; }
  computeAllModes();
}
function useSavedOrWarn() {
  const sr = findSavedFor(dest);
  if (sr) { applySaved(sr, false); toast('لا يوجد اتصال — تم استخدام مسار محفوظ لهذه الوجهة'); return; }
  $('routeInfo').innerHTML = '<span class="small warnTxt">لا يوجد اتصال بالإنترنت لحساب مسار جديد. استخدم مسارًا محفوظًا، أو «🧭 اتجاه مباشر» الذي يعمل بدون إنترنت.</span>';
  $('startBtn').disabled = true; $('saveRouteBtn').disabled = true;
}
function fabsAboveSheet() {
  requestAnimationFrame(() => { const h = $('sheet').offsetHeight; if (h && !$('sheet').classList.contains('hidden')) $('fabs').style.bottom = (h + 14) + 'px'; });
}
function clearDestination() {
  dest = null; routes = {};
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  clearRouteLayer();
  $('sheet').classList.add('hidden');
  $('fabs').style.bottom = '';
}
$('closeSheet').onclick = clearDestination;
function clearRouteLayer() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (routeCasing) { map.removeLayer(routeCasing); routeCasing = null; }
}
async function fetchRoute(m, from, to) {
  const coords = from[1].toFixed(6) + ',' + from[0].toFixed(6) + ';' + to[1].toFixed(6) + ',' + to[0].toFixed(6);
  const q = '?overview=full&geometries=geojson&steps=true&alternatives=false';
  let lastErr = null;
  for (const base of ENDPOINTS[m]) {
    try {
      const j = await getJSON(base + coords + q, 20000);
      if (j.code === 'Ok' && j.routes && j.routes.length) { const r = prepRoute(j.routes[0]); r.gap = hav(r.pts[r.pts.length - 1], to); return r; }
      lastErr = new Error(j.code || 'NoRoute');
      if (j.code === 'NoRoute') break;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('NoRoute');
}
function prepRoute(r) {
  const pts = r.geometry.coordinates.map((c) => [c[1], c[0]]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
  const steps = [];
  r.legs.forEach((leg) => leg.steps.forEach((s) => steps.push(s)));
  // where along the line each step begins
  let from = 0;
  steps.forEach((s) => {
    const loc = [s.maneuver.location[1], s.maneuver.location[0]];
    let best = from, bd = Infinity;
    for (let i = from; i < pts.length; i++) {
      const d = hav(pts[i], loc);
      if (d < bd) { bd = d; best = i; }
      if (bd < 1 || (d > bd + 500 && i > best + 60)) break;
    }
    s._at = cum[best]; s._idx = best; from = best;
    s._text = instruction(s);
  });
  return { pts, cum, total: cum[cum.length - 1], duration: r.duration, distance: r.distance, steps };
}
async function computeAllModes() {
  if (!dest || !me) return;
  const seq = ++routeSeq;
  const from = [me.lat, me.lng], to = [dest.lat, dest.lng];
  $('routeInfo').innerHTML = '<span class="small">جارٍ حساب المسار…</span>';
  $('startBtn').disabled = true;
  const order = [mode].concat(['car', 'bike', 'foot'].filter((x) => x !== mode));
  for (const m of order) {
    fetchRoute(m, from, to).then((r) => {
      if (seq !== routeSeq) return;
      routes[m] = r;
      const b = document.querySelector('.mode b[data-t="' + m + '"]'); if (b) b.textContent = fmtDur(r.duration);
      if (m === mode) showRoute(true);
    }).catch(() => {
      if (seq !== routeSeq) return;
      routes[m] = null; routeNetErr = true;
      const b = document.querySelector('.mode b[data-t="' + m + '"]'); if (b) b.textContent = '×';
      if (m === mode) showRoute(true);
    });
  }
}
function drawRoute(r) {
  clearRouteLayer();
  routeCasing = L.polyline(r.pts, { color: '#0b3a8a', weight: 11, opacity: .55, lineJoin: 'round', interactive: false }).addTo(map);
  routeLayer = L.polyline(r.pts, { color: mode === 'foot' ? '#7c3aed' : (mode === 'bike' ? '#0891b2' : '#2563eb'), weight: 7, opacity: .95, lineJoin: 'round', interactive: false, dashArray: mode === 'foot' ? '2 10' : null, lineCap: 'round' }).addTo(map);
}
function showRoute(fit) {
  if (!dest) return;
  if (!(mode in routes)) { $('routeInfo').innerHTML = '<span class="small">جارٍ حساب المسار…</span>'; $('startBtn').disabled = true; clearRouteLayer(); if (me) computeAllModes(); return; }
  const r = routes[mode];
  if (!r) {
    clearRouteLayer(); $('startBtn').disabled = true; $('saveRouteBtn').disabled = true;
    if (navigator.onLine === false) { useSavedOrWarn(); return; }
    $('routeInfo').innerHTML = '<span class="small warnTxt">تعذّر حساب مسار بهذه الوسيلة. تحقّق من الاتصال أو جرّب وسيلة أخرى.</span>'; return;
  }
  drawRoute(r);
  const arrive = new Date(Date.now() + r.duration * 1000);
  $('routeInfo').innerHTML = `<span class="big">${fmtDur(r.duration)}</span><span class="small">${fmtDist(r.distance)} · الوصول ${clock(arrive)}</span>`
    + ((r.gap || 0) > 50 ? `<div class="small warnTxt" style="flex-basis:100%">🧭 آخر ${fmtDist(r.gap)} بدون طريق مرسوم — سيتحوّل التطبيق إلى البوصلة تلقائيًا</div>` : '');
  $('startBtn').disabled = false; $('saveRouteBtn').disabled = false;
  fabsAboveSheet();
  if (fit !== false) {
    const b = L.latLngBounds(r.pts);
    map.fitBounds(b, { paddingTopLeft: [80, 90], paddingBottomRight: [30, Math.max(300, $('sheet').offsetHeight + 20)] });
  }
}

/* ---------------- steps panel ---------------- */
function openSteps(r, fromIdx) {
  if (!r) return;
  $('stepsList').innerHTML = r.steps.map((s, i) => {
    if (i < (fromIdx || 0)) return '';
    const len = (i + 1 < r.steps.length ? r.steps[i + 1]._at : r.total) - s._at;
    return `<div class="step"><div class="a">${stepIcon(s).replace(/#fff/g, '#93c5fd')}</div><div class="x">${esc(s._text)}</div><div class="d">${s.maneuver.type === 'arrive' ? '' : fmtDist(len)}</div></div>`;
  }).join('');
  $('stepsPanel').classList.remove('hidden');
}
$('stepsBtn').onclick = () => openSteps(routes[mode]);
$('navStepsBtn').onclick = () => navState && openSteps(navState.r, navState.stepIdx);
$('stepsClose').onclick = () => $('stepsPanel').classList.add('hidden');

/* ---------------- turn-by-turn navigation ---------------- */
let navState = null;
let muted = store.get('muted', false);
function renderMute() { $('muteBtn').innerHTML = muted ? SPK_OFF : SPK_ON; }
renderMute();
$('muteBtn').onclick = () => { muted = !muted; store.set('muted', muted); renderMute(); toast(muted ? 'تم كتم الإرشاد الصوتي' : 'تم تشغيل الإرشاد الصوتي'); };
function say(text) {
  if (muted || !text) return;
  if (NATIVE) { try { Android.speak(text); } catch (e) {} return; }
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'ar'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
function thresholds() {
  if (mode === 'foot') return { far: 0, near: 60, now: 15, arrive: 15, off: 30 };
  if (mode === 'bike') return { far: 0, near: 120, now: 25, arrive: 20, off: 35 };
  return { far: 1000, near: 250, now: 45, arrive: 30, off: 45 };
}
$('startBtn').onclick = () => {
  const r = routes[mode]; if (!r || !me) return;
  navState = { r, stepIdx: 0, said: {}, offCount: 0, lastReroute: 0, along: 0, segIdx: 0, rerouting: false };
  if (NATIVE) try { Android.setNavigating(true); } catch (e) {}
  $('sheet').classList.add('hidden'); $('searchWrap').classList.add('hidden'); $('fabs').style.bottom = 'calc(110px + env(safe-area-inset-bottom))';
  $('layersBtn').parentElement.classList.add('hidden');
  $('navTop').classList.remove('hidden'); $('navBottom').classList.remove('hidden'); $('speed').classList.remove('hidden');
  iconMode = null; updateMeMarker();
  setFollow(true); map.setView([me.lat, me.lng], 17);
  const first = r.steps[0];
  say(first ? first._text : 'انطلق');
  onNavLocation();
};
function endNav(arrived, handoff) {
  if (!navState) return;
  navState = null;
  if (NATIVE) try { Android.setNavigating(false); } catch (e) {}
  $('navTop').classList.add('hidden'); $('navBottom').classList.add('hidden'); $('speed').classList.add('hidden');
  $('searchWrap').classList.remove('hidden'); $('layersBtn').parentElement.classList.remove('hidden');
  iconMode = null; updateMeMarker();
  if (handoff) return;
  if (arrived) { const at = dest; clearDestination(); toast('وصلت إلى وجهتك 🎉', 4000); if (typeof onArrived === 'function') onArrived(at); }
  else if (dest) { $('sheet').classList.remove('hidden'); fabsAboveSheet(); showRoute(); }
  else $('fabs').style.bottom = '';
}
$('endBtn').onclick = () => { if (directState) endDirect(false); else endNav(false); };

function project(r, p, startIdx) {
  // nearest point on polyline to p; search a window ahead of the last position first
  const lat0 = p[0] * rad, kx = Math.cos(lat0) * R * rad, ky = R * rad;
  function scan(a, b) {
    let best = { d: Infinity, i: 0, t: 0 };
    for (let i = Math.max(0, a); i < Math.min(r.pts.length - 1, b); i++) {
      const A = r.pts[i], B = r.pts[i + 1];
      const ax = (A[1] - p[1]) * kx, ay = (A[0] - p[0]) * ky, bx = (B[1] - p[1]) * kx, by = (B[0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const x = ax + t * dx, y = ay + t * dy, d = Math.sqrt(x * x + y * y);
      if (d < best.d) best = { d, i, t };
    }
    return best;
  }
  let b = scan(startIdx - 5, startIdx + 400);
  if (b.d > 60) { const g = scan(0, r.pts.length); if (g.d < b.d) b = g; }
  const segLen = r.cum[b.i + 1] - r.cum[b.i];
  return { off: b.d, idx: b.i, along: r.cum[b.i] + b.t * segLen };
}
async function reroute() {
  if (!navState || navState.rerouting || !dest || !me) return;
  navState.rerouting = true; navState.lastReroute = Date.now();
  say('جارٍ إعادة حساب المسار'); toast('جارٍ إعادة حساب المسار…');
  try {
    const r = await fetchRoute(mode, [me.lat, me.lng], [dest.lat, dest.lng]);
    if (!navState) return;
    routes[mode] = r;
    navState.r = r; navState.stepIdx = 0; navState.said = {}; navState.offCount = 0; navState.segIdx = 0;
    drawRoute(r); onNavLocation();
  } catch (e) {
    toast('تعذّرت إعادة حساب المسار، سنحاول مجددًا');
  } finally { if (navState) navState.rerouting = false; }
}
function onNavLocation() {
  const s = navState; if (!s || !me) return;
  const r = s.r, th = thresholds();
  const pr = project(r, [me.lat, me.lng], s.segIdx);
  s.segIdx = pr.idx; s.along = pr.along;

  // off-route detection
  const tol = Math.max(th.off, (me.acc || 0) * 1.2);
  if (pr.off > tol) s.offCount++; else s.offCount = 0;
  if (s.offCount >= 3 && Date.now() - s.lastReroute > 12000) {
    if (s.r.custom) {
      s.lastReroute = Date.now() + 18000;
      say('أنت خارج المسار المسجل، عد إليه'); toast('خارج المسار المسجل — عد إلى الخط', 4000);
    } else if (navigator.onLine === false) {
      s.lastReroute = Date.now() + 18000; // remind every ~30 s
      say('أنت خارج المسار، عد إلى المسار المحدد'); toast('خارج المسار — لا يوجد اتصال لإعادة الحساب، عد إلى الخط الأزرق', 4000);
    } else reroute();
  }

  // speed
  const kmh = me.speed != null && me.speed >= 0 ? Math.round(me.speed * 3.6) : 0;
  $('spdVal').textContent = kmh;

  // current/next step
  let k = 0;
  for (let i = 0; i < r.steps.length; i++) if (r.steps[i]._at <= s.along + 8) k = i;
  if (k < s.stepIdx) k = s.stepIdx; // never move backwards
  s.stepIdx = k;
  const next = r.steps[k + 1] || r.steps[k];
  const remain = Math.max(0, r.total - s.along);
  const toNext = r.steps[k + 1] ? Math.max(0, next._at - s.along) : remain;

  $('navArrow').innerHTML = stepIcon(next);
  $('navDist').textContent = fmtDist(toNext);
  $('navText').textContent = next._text;
  const after = r.steps[k + 2];
  if (after && after._at - next._at < 150 && next.maneuver.type !== 'arrive') {
    $('navThen').innerHTML = 'ثم ' + stepIcon(after) + '<span>' + esc(after._text) + '</span>';
    $('navThen').classList.remove('hidden');
  } else $('navThen').classList.add('hidden');

  const secs = r.total > 0 ? r.duration * (remain / r.total) : 0;
  $('navEta').textContent = 'الوصول ' + clock(new Date(Date.now() + secs * 1000));
  $('navRemain').textContent = fmtDur(secs) + ' · ' + fmtDist(remain);

  // voice prompts
  const key = k + 1;
  const said = s.said[key] || (s.said[key] = {});
  if (next.maneuver.type === 'arrive') {
    const toDest = dest ? hav([me.lat, me.lng], [dest.lat, dest.lng]) : remain;
    if (dest && (r.gap || 0) > 50 && remain <= th.arrive + 10 && toDest > 30) {
      const d0 = { lat: dest.lat, lng: dest.lng, name: dest.name };
      endNav(false, true);
      say('انتهى الطريق. تابع مباشرة نحو الهدف، المسافة ' + spokenDist(toDest) + ' باتجاه ' + cardinal(bearing([me.lat, me.lng], [d0.lat, d0.lng])));
      startDirect(d0, true); return;
    }
    if (toDest <= Math.max(th.arrive, Math.min(me.acc || 0, 40)) || (remain <= th.arrive && pr.off <= tol)) { say('لقد وصلت إلى وجهتك'); endNav(true); return; }
    if (remain <= th.near && !said.near) { said.near = true; say('بعد ' + spokenDist(remain) + ((r.gap || 0) > 50 ? '، ينتهي الطريق وتتابع بالبوصلة' : '، ستصل إلى وجهتك')); }
  } else {
    if (th.far && toNext <= th.far && toNext > th.far * 0.6 && !said.far) { said.far = true; say('بعد ' + spokenDist(toNext) + '، ' + next._text); }
    else if (toNext <= th.near && toNext > th.now * 1.5 && !said.near) { said.near = true; said.far = true; say('بعد ' + spokenDist(toNext) + '، ' + next._text); }
    else if (toNext <= th.now && !said.now) { said.now = said.near = said.far = true; say('الآن، ' + next._text); }
  }

  // camera
  if (follow) map.panTo([me.lat, me.lng], { animate: true, duration: 0.6 });
}

/* ---------------- back button ---------------- */
window.handleBack = function () {
  if (!$('modal').classList.contains('hidden')) { closeModal(); return true; }
  if (typeof guideHandleBack === 'function' && guideHandleBack()) return true;
  if (typeof measHandleBack === 'function' && measHandleBack()) return true;
  if (typeof opsHandleBack === 'function' && opsHandleBack()) return true;
  if (fieldHandleBack()) return true;
  if (typeof vecHandleBack === 'function' && vecHandleBack()) return true;
  for (const id of ['mapsPanel', 'savedPanel', 'favPanel']) if (!$(id).classList.contains('hidden')) { $(id).classList.add('hidden'); return true; }
  if (!$('menuDrop').classList.contains('hidden')) { $('menuDrop').classList.add('hidden'); return true; }
  if (!$('stepsPanel').classList.contains('hidden')) { $('stepsPanel').classList.add('hidden'); return true; }
  if (!$('layerMenu').classList.contains('hidden')) { $('layerMenu').classList.add('hidden'); return true; }
  if (typeof homeHandleBack === 'function' && homeHandleBack()) return true;
  if (!resEl.classList.contains('hidden')) { closeSearch(); return true; }
  if (navState) { endNav(false); return true; }
  if (dest) { clearDestination(); return true; }
  return false;
};

/* ---------------- menu & panels ---------------- */
$('menuBtn').onclick = (e) => { e.stopPropagation(); $('menuDrop').classList.toggle('hidden'); resEl.classList.add('hidden'); };
document.addEventListener('click', (e) => { if (!e.target.closest('#menuDrop') && !e.target.closest('#menuBtn')) $('menuDrop').classList.add('hidden'); });
$('openMaps').onclick = () => { $('menuDrop').classList.add('hidden'); renderMaps(); $('mapsPanel').classList.remove('hidden'); };
$('openSaved').onclick = () => { $('menuDrop').classList.add('hidden'); renderSaved(); $('savedPanel').classList.remove('hidden'); };
document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => $(b.dataset.close).classList.add('hidden'); });

/* ---------------- connectivity ---------------- */
function onConn() {
  const off = navigator.onLine === false;
  $('offBadge').classList.toggle('hidden', !off);
  if (off && layerKey !== OFFLINE_LAYER) { setLayer(OFFLINE_LAYER, true); toast('بدون اتصال: تم التحويل إلى الخريطة المنزّلة'); }
  else if (!off && store.get('layer', 'osm') !== layerKey) setLayer(store.get('layer', 'osm'));
  else if (baseLayer && baseLayer.redraw) baseLayer.redraw();
}
window.addEventListener('online', onConn); window.addEventListener('offline', onConn);

/* ---------------- offline maps ---------------- */
const CITIES = [
  ['basra', 'البصرة', 30.5085, 47.7804, 16], ['zubair', 'الزبير', 30.3892, 47.7024, 7], ['qasr', 'أم قصر', 30.0362, 47.9195, 6],
  ['faw', 'الفاو', 29.9750, 48.4720, 5], ['baghdad', 'بغداد', 33.3152, 44.3661, 22], ['mosul', 'الموصل', 36.3350, 43.1189, 14],
  ['erbil', 'أربيل', 36.1912, 44.0092, 14], ['najaf', 'النجف', 32.0259, 44.3462, 10], ['karbala', 'كربلاء', 32.6160, 44.0249, 9],
  ['sulay', 'السليمانية', 35.5613, 45.4302, 11], ['kirkuk', 'كركوك', 35.4681, 44.3922, 11], ['nasiriya', 'الناصرية', 31.0439, 46.2575, 9],
  ['amara', 'العمارة', 31.8356, 47.1440, 8], ['hilla', 'الحلة', 32.4637, 44.4199, 9], ['diwaniya', 'الديوانية', 31.9929, 44.9255, 8],
  ['kut', 'الكوت', 32.5128, 45.8182, 8], ['ramadi', 'الرمادي', 33.4206, 43.3078, 9], ['baqubah', 'بعقوبة', 33.7466, 44.6437, 7],
  ['samawa', 'السماوة', 31.3099, 45.2802, 7], ['tikrit', 'تكريت', 34.5960, 43.6770, 7], ['duhok', 'دهوك', 36.8670, 42.9500, 9]
].map((c) => ({ id: c[0], name: c[1], lat: c[2], lng: c[3], r: c[4] }));
const IRAQ = { id: 'iraq', name: 'العراق — خريطة عامة', s: 29.0, w: 38.7, n: 37.4, e: 48.7, minZ: 5, maxZ: 10 };
const KB_PER_TILE = 20, CITY_MIN_Z = 10;
function cityBox(c) {
  const dLat = c.r / 111.32, dLng = c.r / (111.32 * Math.cos(c.lat * rad));
  return { s: c.lat - dLat, w: c.lng - dLng, n: c.lat + dLat, e: c.lng + dLng };
}
function downloadedAreas() { try { return areas; } catch (e) { return []; } }   // safe before 'areas' is initialised
function lon2x(lon, z) { return Math.max(0, Math.min((1 << z) - 1, Math.floor((lon + 180) / 360 * (1 << z)))); }
function lat2y(lat, z) { const r = lat * rad; return Math.max(0, Math.min((1 << z) - 1, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z)))); }
function tileCount(b, z0, z1) { let n = 0; for (let z = z0; z <= z1; z++) n += (lon2x(b.e, z) - lon2x(b.w, z) + 1) * (lat2y(b.s, z) - lat2y(b.n, z) + 1); return n; }
function fmtMB(bytes) { const mb = bytes / 1048576; return mb < 10 ? mb.toFixed(1) + ' م.ب' : Math.round(mb) + ' م.ب'; }
let areas = store.get('areas', []);
let dlQueue = [], dlCur = null;
function saveAreas() { store.set('areas', areas); }
(function migrateOldAreas() {
  const old = areas.filter((x) => (x.layer || 'voyager') === 'voyager');
  if (!old.length) return;
  if (NATIVE && Android.deleteArea) old.forEach((x) => Android.deleteArea('old' + x.id.replace(/[^A-Za-z0-9]/g, ''), x.s, x.w, x.n, x.e, x.minZ, x.maxZ, 'voyager', ''));
  old.forEach((x) => { x.layer = OFFLINE_LAYER; x.complete = false; x.bytes = 0; x.tiles = 0; });
  saveAreas();
  setTimeout(() => toast('تم تغيير مصدر الخرائط. افتح «الخرائط بدون إنترنت» واضغط «استئناف» لإعادة تنزيلها.', 6000), 1500);
})();
function queueDownload(a) {
  if (!NATIVE || !Android.downloadArea) { toast('تنزيل الخرائط متاح داخل تطبيق الهاتف فقط'); return; }
  if (navigator.onLine === false) { toast('تحتاج اتصالًا بالإنترنت لتنزيل الخريطة'); return; }
  let ex = areas.find((x) => x.id === a.id);
  if (!ex) { ex = Object.assign({ bytes: 0, tiles: 0, failed: 0, complete: false, date: Date.now(), layer: OFFLINE_LAYER }, a); areas.push(ex); }
  else { ex.complete = false; }
  saveAreas();
  if (dlCur && dlCur.id === a.id) return;
  if (!dlQueue.some((q) => q.id === a.id)) dlQueue.push(ex);
  pumpQueue(); renderMaps();
}
function pumpQueue() {
  if (dlCur || !dlQueue.length) return;
  const a = dlQueue.shift();
  const L0 = LAYERS[OFFLINE_LAYER];
  const ok = Android.downloadArea(a.id, a.s, a.w, a.n, a.e, a.minZ, a.maxZ, L0.url, L0.opt.subdomains || '', OFFLINE_LAYER);
  if (!ok) { dlQueue.unshift(a); setTimeout(pumpQueue, 1500); return; }
  dlCur = { id: a.id, name: a.name, done: 0, total: tileCount(a, a.minZ, a.maxZ), failed: 0, bytes: 0 };
  renderDl();
}
function renderDl() {
  const c = $('dlCard');
  if (!dlCur) { c.classList.add('hidden'); return; }
  c.classList.remove('hidden');
  const pct = dlCur.total ? Math.floor(dlCur.done * 100 / dlCur.total) : 0;
  $('dlName').textContent = dlCur.name + (dlQueue.length ? ' (+' + dlQueue.length + ' في الانتظار)' : '');
  $('dlInfo').textContent = pct + '% · ' + dlCur.done + ' / ' + dlCur.total + ' مربع · ' + fmtMB(dlCur.bytes) + (dlCur.failed ? ' · فشل ' + dlCur.failed : '');
  $('dlBar').style.width = pct + '%';
}
window.onDownloadProgress = function (id, done, total, failed, bytes) {
  if (!dlCur || dlCur.id !== id) return;
  Object.assign(dlCur, { done, total, failed, bytes }); renderDl();
};
function finishDl(id, done, total, failed, bytes, cancelled) {
  const a = areas.find((x) => x.id === id);
  if (a) {
    a.bytes = bytes; a.tiles = done - failed; a.failed = failed; a.date = Date.now();
    a.complete = !cancelled && done >= total && failed <= Math.max(3, total * 0.01);
    saveAreas();
  }
  const name = dlCur ? dlCur.name : '';
  dlCur = null;
  if (cancelled) { dlQueue = []; toast('تم إيقاف التنزيل — يمكنك استئنافه لاحقًا'); }
  else toast(a && a.complete ? 'اكتمل تنزيل خريطة ' + name + ' (' + fmtMB(bytes) + ')' : 'انتهى التنزيل مع بعض النواقص — اضغط «استئناف» لإكماله', 4000);
  renderDl(); renderMaps(); pumpQueue();
}
window.onDownloadDone = (id, d, t, f, b) => finishDl(id, d, t, f, b, false);
window.onDownloadCancelled = (id, d, t, f, b) => finishDl(id, d, t, f, b, true);
$('dlCancel').onclick = () => { if (NATIVE) Android.cancelDownload(); };
function deleteArea(id) {
  const a = areas.find((x) => x.id === id); if (!a) return;
  if (dlCur && dlCur.id === id) { toast('أوقف التنزيل أولًا'); return; }
  if (!confirm('حذف خريطة ' + a.name + ' من الهاتف؟')) return;
  dlQueue = dlQueue.filter((q) => q.id !== id);
  areas = areas.filter((x) => x.id !== id); saveAreas();
  const keep = areas.map((k) => [k.s, k.w, k.n, k.e, k.minZ, k.maxZ].map((v) => (+v).toFixed(6)).join(',')).join(';');
  if (NATIVE && Android.deleteArea) Android.deleteArea(id, a.s, a.w, a.n, a.e, a.minZ, a.maxZ, a.layer || OFFLINE_LAYER, keep);
  renderMaps();
}
window.onAreaDeleted = (id) => { if (String(id).indexOf('old') === 0) return; toast('تم حذف الخريطة وتحرير المساحة'); if (baseLayer && baseLayer.redraw) baseLayer.redraw(); };
function renderMaps() {
  const list = $('areasList');
  if (!areas.length) list.innerHTML = '<div class="item"><div class="grow s">لا توجد خرائط منزّلة بعد.</div></div>';
  else {
    const total = areas.reduce((t, a) => t + (a.bytes || 0), 0);
    list.innerHTML = areas.map((a) => {
      const busy = (dlCur && dlCur.id === a.id) || dlQueue.some((q) => q.id === a.id);
      const st = busy ? '<span class="warnTxt">جارٍ التنزيل…</span>' : (a.complete ? '<span class="ok">✓ جاهزة بدون إنترنت</span>' : '<span class="warnTxt">غير مكتملة</span>');
      return `<div class="item"><div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${st} · ${fmtMB(a.bytes || 0)}</div></div>
        <button class="chip" data-show="${a.id}">عرض</button>
        ${a.complete || busy ? '' : `<button class="chip go" data-resume="${a.id}">استئناف</button>`}
        <button class="chip del" data-del="${a.id}">حذف</button></div>`;
    }).join('') + `<div class="item"><div class="grow s">المساحة المستخدمة: ${fmtMB(total)}</div></div>`;
  }
  list.querySelectorAll('[data-show]').forEach((b) => { b.onclick = () => { const a = areas.find((x) => x.id === b.dataset.show); $('mapsPanel').classList.add('hidden'); setFollow(false); map.fitBounds([[a.s, a.w], [a.n, a.e]]); }; });
  list.querySelectorAll('[data-resume]').forEach((b) => { b.onclick = () => queueDownload(areas.find((x) => x.id === b.dataset.resume)); });
  list.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteArea(b.dataset.del); });

  const items = [IRAQ].concat(CITIES.map((c) => Object.assign({ id: c.id, name: c.name, minZ: CITY_MIN_Z, maxZ: OFFLINE_MAX_Z }, cityBox(c))));
  $('citiesList').innerHTML = items.map((c) => {
    const have = areas.some((a) => a.id === c.id);
    const n = tileCount(c, c.minZ, c.maxZ);
    const hint = c.id === 'iraq' ? 'مستحسن: يعرض كل العراق عند التصغير' : 'حتى مستوى الشوارع';
    return `<div class="item"><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">حوالي ${fmtMB(n * KB_PER_TILE * 1024)} · ${hint}</div></div>
      <button class="chip ${have ? '' : 'go'}" data-dl="${c.id}" ${have ? 'disabled' : ''}>${have ? '✓ منزّلة' : 'تنزيل'}</button></div>`;
  }).join('');
  $('citiesList').querySelectorAll('[data-dl]').forEach((b) => {
    b.onclick = () => { const c = items.find((x) => x.id === b.dataset.dl); queueDownload(c); };
  });
  renderDl();
}
$('dlView').onclick = () => {
  const b = map.getBounds(), z = map.getZoom();
  const box = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
  const minZ = Math.max(5, Math.min(z, 12) - 2), maxZ = OFFLINE_MAX_Z;
  const n = tileCount(box, minZ, maxZ);
  if (n > 40000) { toast('المنطقة كبيرة جدًا (' + fmtMB(n * KB_PER_TILE * 1024) + '). قرّب الخريطة أكثر ثم حاول.', 4500); return; }
  const c = map.getCenter();
  const name = 'منطقة ' + c.lat.toFixed(2) + '، ' + c.lng.toFixed(2);
  if (!confirm('تنزيل المنطقة الظاهرة؟ الحجم التقريبي ' + fmtMB(n * KB_PER_TILE * 1024))) return;
  queueDownload(Object.assign({ id: 'v' + Date.now().toString(36), name, minZ, maxZ }, box));
};

/* ---------------- saved routes ---------------- */
let saved = store.get('savedRoutes', []);
const MODE_AR = { car: 'سيارة', bike: 'دراجة', foot: 'مشي' };
function packRoute(r) {
  return {
    pts: r.pts.map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]),
    duration: r.duration, distance: r.distance, gap: r.gap || 0,
    steps: r.steps.map((s) => ({ name: s.name || '', ref: s.ref || '', maneuver: { type: s.maneuver.type, modifier: s.maneuver.modifier, exit: s.maneuver.exit, location: s.maneuver.location }, _idx: s._idx }))
  };
}
function unpackRoute(p) {
  const pts = p.pts, cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
  const steps = p.steps.map((s) => Object.assign({}, s, { _at: cum[Math.min(s._idx, cum.length - 1)], _text: instruction(s) }));
  return { pts, cum, total: cum[cum.length - 1], duration: p.duration, distance: p.distance, gap: p.gap || 0, steps };
}
function findSavedFor(d) {
  if (!d) return null;
  const c = saved.filter((r) => hav([r.dest.lat, r.dest.lng], [d.lat, d.lng]) < 150);
  return c.find((r) => r.mode === mode) || c[0] || null;
}
$('saveRouteBtn').onclick = () => {
  const r = routes[mode]; if (!r || !dest) return;
  const from = me ? [me.lat, me.lng] : r.pts[0];
  saved = saved.filter((x) => !(x.mode === mode && hav([x.dest.lat, x.dest.lng], [dest.lat, dest.lng]) < 30 && hav(x.from, from) < 300));
  saved.unshift({ id: Date.now().toString(36), name: dest.name, sub: dest.sub || '', mode, date: Date.now(), dest: { lat: dest.lat, lng: dest.lng }, from, route: packRoute(r) });
  saved = saved.slice(0, 30);
  try { localStorage.setItem('savedRoutes', JSON.stringify(saved)); toast('تم حفظ المسار — يعمل بدون إنترنت'); }
  catch (e) { saved.shift(); toast('لا توجد مساحة كافية لحفظ المسار؛ احذف بعض المسارات القديمة'); }
};
function applySaved(sr, fit) {
  dest = { lat: sr.dest.lat, lng: sr.dest.lng, name: sr.name, sub: sr.sub };
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([dest.lat, dest.lng], { icon: L.divIcon({ className: 'pin', html: PIN('#ef4444'), iconSize: [34, 44], iconAnchor: [17, 43] }) }).addTo(map);
  $('destName').textContent = sr.name; $('destSub').textContent = (sr.sub ? sr.sub + ' · ' : '') + 'مسار محفوظ';
  updateFavBtn(); fieldSheetUpdate();
  $('sheet').classList.remove('hidden');
  fabsAboveSheet();
  routeSeq++; routes = {}; routes[sr.mode] = unpackRoute(sr.route);
  mode = sr.mode; selectModeBtn();
  document.querySelectorAll('.mode b').forEach((b) => { b.textContent = b.dataset.t === mode ? fmtDur(sr.route.duration) : '—'; });
  showRoute(fit);
  if (me) {
    const d = project(routes[mode], [me.lat, me.lng], 0).off;
    if (d > 300) toast('أنت على بعد ' + fmtDist(d) + ' من المسار المحفوظ — توجّه إليه أولًا', 4500);
  }
}
function renderSaved() {
  const l = $('savedList');
  if (!saved.length) { l.innerHTML = '<div class="item"><div class="grow s">لا توجد مسارات محفوظة بعد.</div></div>'; return; }
  l.innerHTML = saved.map((r, i) => `<div class="item"><div class="grow"><div class="t">${esc(r.name)}</div>
    <div class="s">${MODE_AR[r.mode] || ''} · ${fmtDist(r.route.distance)} · ${fmtDur(r.route.duration)} · ${new Date(r.date).toLocaleDateString('ar-IQ-u-nu-latn')}</div></div>
    <button class="chip go" data-use="${i}">فتح</button><button class="chip del" data-rm="${i}">حذف</button></div>`).join('');
  l.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => { if (navState) endNav(false); closeSearch(); $('savedPanel').classList.add('hidden'); applySaved(saved[+b.dataset.use], true); }; });
  l.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { saved.splice(+b.dataset.rm, 1); store.set('savedRoutes', saved); renderSaved(); }; });
}

/* ---------------- generic action sheet ---------------- */
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').querySelector('.mbg').onclick = closeModal;
function actionSheet(title, items) {
  $('mTitle').textContent = title;
  const box = $('mBtns'); box.innerHTML = '';
  items.concat([{ label: 'إلغاء', cls: 'cancel' }]).forEach((it) => {
    const b = document.createElement('button');
    b.innerHTML = it.label; if (it.cls) b.className = it.cls;
    b.onclick = () => { closeModal(); if (it.fn) it.fn(); };
    box.appendChild(b);
  });
  $('modal').classList.remove('hidden');
}

/* ---------------- favorites ---------------- */
let favs = store.get('favs', []);
const KIND_AR = { home: 'البيت', work: 'العمل' };
function saveFavs() { store.set('favs', favs); }
function favAt(lat, lng) { return favs.find((f) => hav([f.lat, f.lng], [lat, lng]) < 30); }
function updateFavBtn() {
  const b = $('favBtn'); if (!dest) return;
  const f = favAt(dest.lat, dest.lng);
  b.classList.toggle('on', !!f);
  b.textContent = f ? '★ ' + (KIND_AR[f.kind] || 'في المفضلة') : '☆ حفظ في المفضلة';
}
function setFav(kind, name) {
  if (!dest) return;
  if (kind !== 'other') favs = favs.filter((f) => f.kind !== kind);
  favs = favs.filter((f) => hav([f.lat, f.lng], [dest.lat, dest.lng]) >= 30);
  favs.push({ id: Date.now().toString(36), kind, name: name || KIND_AR[kind] || dest.name, sub: dest.sub || '', lat: dest.lat, lng: dest.lng });
  saveFavs(); updateFavBtn();
  toast(kind === 'other' ? 'تمت الإضافة إلى المفضلة' : 'تم تعيين ' + KIND_AR[kind]);
}
$('favBtn').onclick = () => {
  if (!dest) return;
  const f = favAt(dest.lat, dest.lng);
  const items = [
    { label: '🏠 تعيين كالبيت', fn: () => setFav('home') },
    { label: '💼 تعيين كالعمل', fn: () => setFav('work') },
    { label: '⭐ حفظ باسم…', fn: () => { const n = prompt('اسم المكان', dest.name); if (n && n.trim()) setFav('other', n.trim()); } }
  ];
  if (f) items.push({ label: '🗑 إزالة من المفضلة', cls: 'danger', fn: () => { favs = favs.filter((x) => x !== f); saveFavs(); updateFavBtn(); toast('تمت الإزالة من المفضلة'); } });
  actionSheet(dest.name, items);
};
function goFav(f) {
  if (!f) return;
  if (navigator.onLine === false) {
    const sr = findSavedFor(f);
    if (sr) { applySaved(sr, true); return; }
  }
  setDestination(f.lat, f.lng, f.kind === 'other' ? f.name : (KIND_AR[f.kind] + (f.name && f.name !== KIND_AR[f.kind] ? ' — ' + f.name : '')), f.sub, true);
}
function renderFavs() {
  const l = $('favList');
  if (!favs.length) { l.innerHTML = '<div class="item"><div class="grow s">لا توجد أماكن مفضلة بعد.</div></div>'; return; }
  const order = { home: 0, work: 1, other: 2 };
  const list = favs.slice().sort((a, b) => order[a.kind] - order[b.kind]);
  l.innerHTML = list.map((f) => `<div class="item"><div style="font-size:20px">${f.kind === 'home' ? '🏠' : f.kind === 'work' ? '💼' : '⭐'}</div>
    <div class="grow"><div class="t">${esc(f.kind === 'other' ? f.name : KIND_AR[f.kind])}</div><div class="s">${f.sub ? esc(f.sub) : '<span dir="ltr" style="unicode-bidi:isolate">' + f.lat.toFixed(5) + ', ' + f.lng.toFixed(5) + '</span>'}</div></div>
    <button class="chip go" data-go="${f.id}">انتقال</button><button class="chip" data-more="${f.id}">⋯</button></div>`).join('');
  l.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { $('favPanel').classList.add('hidden'); goFav(favs.find((x) => x.id === b.dataset.go)); }; });
  l.querySelectorAll('[data-more]').forEach((b) => {
    b.onclick = () => {
      const f = favs.find((x) => x.id === b.dataset.more);
      actionSheet(f.kind === 'other' ? f.name : KIND_AR[f.kind], [
        { label: '↗ مشاركة المكان', fn: () => shareMenu('📍 ' + (f.kind === 'other' ? f.name : KIND_AR[f.kind]), f.lat, f.lng) },
        { label: '✏️ إعادة التسمية', fn: () => { const n = prompt('الاسم الجديد', f.name); if (n && n.trim()) { f.name = n.trim(); if (f.kind !== 'other') f.kind = 'other'; saveFavs(); renderFavs(); } } },
        { label: '🗑 حذف', cls: 'danger', fn: () => { favs = favs.filter((x) => x !== f); saveFavs(); renderFavs(); } }
      ]);
    };
  });
}
$('openFavs').onclick = () => { $('menuDrop').classList.add('hidden'); renderFavs(); $('favPanel').classList.remove('hidden'); };

/* ---------------- sharing ---------------- */
function locText(title, lat, lng, extra) {
  return title + (extra ? '\n' + extra : '') + '\nhttps://maps.google.com/?q=' + lat.toFixed(6) + ',' + lng.toFixed(6)
    + '\nالإحداثيات: ' + lat.toFixed(6) + ', ' + lng.toFixed(6);
}
function doShare(text) {
  if (NATIVE && Android.shareText) { Android.shareText(text); return; }
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  try { navigator.clipboard.writeText(text); toast('تم نسخ النص'); } catch (e) { toast(text, 6000); }
}
function doSms(text) {
  if (NATIVE && Android.sendSms) { Android.sendSms(text); return; }
  location.href = 'sms:?&body=' + encodeURIComponent(text);
}
function shareMenu(title, lat, lng, extra, msgTitle) {
  const text = locText(msgTitle || title, lat, lng, extra);
  actionSheet(title, [
    { label: '↗ مشاركة عبر التطبيقات (واتساب، تيليجرام…)', fn: () => doShare(text) },
    { label: '✉️ رسالة SMS — تعمل بدون إنترنت', fn: () => doSms(text) }
  ]);
}
$('shareMe').onclick = () => {
  $('menuDrop').classList.add('hidden');
  if (!me) { toast('لم يُحدَّد موقعك بعد'); startLocation(); return; }
  shareMenu('📍 موقعي الحالي', me.lat, me.lng, me.acc ? 'الدقة: ±' + Math.round(me.acc) + ' م' : '');
};
$('shareDestBtn').onclick = () => { if (dest) shareMenu('📍 ' + dest.name, dest.lat, dest.lng, dest.sub || ''); };
$('navShareBtn').onclick = () => {
  if (directState && me) {
    const t = directState.t, d = hav([me.lat, me.lng], [t.lat, t.lng]);
    shareMenu('🧭 مشاركة', me.lat, me.lng, 'متّجه إلى ' + t.name + ' (المسافة المتبقية ' + fmtDist(d) + ').\nموقعي الآن:', '🧭 أنا في الطريق');
    return;
  }
  if (!navState || !me) return;
  const r = navState.r, remain = Math.max(0, r.total - navState.along);
  const secs = r.total > 0 ? r.duration * (remain / r.total) : 0;
  const extra = 'الوصول المتوقع ' + clock(new Date(Date.now() + secs * 1000))
    + ' (بعد ' + fmtDur(secs) + '، ' + fmtDist(remain) + ').\nموقعي الآن:';
  shareMenu('🚗 مشاركة وقت الوصول', me.lat, me.lng, extra, '🚗 أنا في الطريق إلى ' + (dest ? dest.name : 'الوجهة'));
};

/* ---------------- night mode ---------------- */
var nightMode = store.get('night', 'auto');
function sunAltitude(date, lat, lng) {
  const d = date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const Lc = M + C + rad * 102.9372 + Math.PI, e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(Lc));
  const ra = Math.atan2(Math.sin(Lc) * Math.cos(e), Math.cos(Lc));
  const H = rad * (280.16 + 360.9856235 * d) - rad * -lng - ra, phi = rad * lat;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
}
function isNightNow() {
  if (nightMode === 'on') return true;
  if (nightMode === 'off') return false;
  const p = me ? [me.lat, me.lng] : [map.getCenter().lat, map.getCenter().lng];
  return sunAltitude(new Date(), p[0], p[1]) < -2;
}
function applyNight() {
  const n = isNightNow(), was = document.body.classList.contains('night');
  document.body.classList.toggle('night', n);
  if (n !== was && window.onNightChange) window.onNightChange(n);
}
function setNightMode(v) { nightMode = v; store.set('night', v); applyNight(); renderLayerMenu(); toast({ auto: 'الوضع الليلي: تلقائي حسب الغروب', on: 'الوضع الليلي: مُفعّل', off: 'الوضع الليلي: متوقف' }[v]); }
setInterval(applyNight, 60000);
applyNight(); renderLayerMenu();

/* ---------------- start ---------------- */
onConn();
startLocation();
setTimeout(() => { if (!dest && !navState && !window.measActive && !document.querySelector('.panel:not(.hidden)') && $('modal').classList.contains('hidden')) toast('ابحث عن مكان أو اضغط مطولًا على الخريطة لاختيار وجهة', 4500); }, 1200);
