'use strict';
/* الملاح — وضع العمل الميداني: الإحداثيات، مواقع العمل، الاتجاه المباشر (البوصلة) */

/* ================= settings ================= */
const fset = Object.assign({ field: false, pin: null, zone: 38, north: true, fmt: 'dec' }, store.get('fieldSettings', {}));
function saveFset() { store.set('fieldSettings', fset); }
let fieldUnlocked = !fset.pin;
function pinHash(p) { // light lock only (data on the phone is not encrypted)
  let h = 0x811c9dc5; const str = 'mallah:' + p;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}
function sitesAllowed() { return fset.field && fieldUnlocked; }

/* ================= coordinates ================= */
function normDigits(s) {
  return String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/٫/g, '.').replace(/[،؛]/g, ',');
}
const WGS = (() => { const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f); return { a, e2, ep2: e2 / (1 - e2), k0: 0.9996 }; })();
function utmToLatLng(zone, north, E, N) {
  const { a, e2, ep2, k0 } = WGS;
  const x = E - 500000, y = north ? N : N - 10000000;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s1 = Math.sin(p1), c1 = Math.cos(p1), t1 = Math.tan(p1);
  const N1 = a / Math.sqrt(1 - e2 * s1 * s1), T1 = t1 * t1, C1 = ep2 * c1 * c1, R1 = a * (1 - e2) / Math.pow(1 - e2 * s1 * s1, 1.5), D = x / (N1 * k0);
  const lat = p1 - (N1 * t1 / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c1;
  return { lat: lat / rad, lng: (zone - 1) * 6 - 180 + 3 + lon / rad };
}
function latLngToUtm(lat, lng) {
  const { a, e2, ep2, k0 } = WGS;
  const zone = Math.floor((lng + 180) / 6) + 1, lon0 = ((zone - 1) * 6 - 180 + 3) * rad;
  const phi = lat * rad, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * (lng * rad - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let Nn = k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) Nn += 10000000;
  const band = 'CDEFGHJKLMNPQRSTUVWXX'[Math.max(0, Math.min(20, Math.floor((lat + 80) / 8)))];
  return { zone, band, E, N: Nn };
}
function dms(v, pos, neg) {
  const h = v < 0 ? neg : pos; v = Math.abs(v);
  let d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
  if (s >= 59.95) { s = 0; m++; } if (m >= 60) { m = 0; d++; }
  return d + '°' + String(m).padStart(2, '0') + "'" + s.toFixed(1).padStart(4, '0') + '"' + h;
}
function fmtCoord(lat, lng, fmt) {
  fmt = fmt || fset.fmt;
  if (fmt === 'dms') return dms(lat, 'N', 'S') + ' ' + dms(lng, 'E', 'W');
  if (fmt === 'utm') { const u = latLngToUtm(lat, lng); return u.zone + u.band + ' ' + Math.round(u.E) + 'E ' + Math.round(u.N) + 'N'; }
  return lat.toFixed(6) + ', ' + lng.toFixed(6);
}
/* parse one angle like 30.5 / 30°30'12"N / 30 30.2 / -47.5 */
function parseAngle(str) {
  const s = normDigits(str).toUpperCase().trim(); if (!s) return null;
  const nums = s.match(/\d+(?:\.\d+)?/g); if (!nums) return null;
  let v = +nums[0] + (nums[1] ? +nums[1] / 60 : 0) + (nums[2] ? +nums[2] / 3600 : 0);
  if (/^-/.test(s) || /[SWجغ]/.test(s)) v = -v;
  return isFinite(v) ? v : null;
}
const IRAQ_LAT = [28.5, 38], IRAQ_LNG = [38.5, 49];
function inRange(v, r) { return v >= r[0] && v <= r[1]; }
/* parse a full coordinate string in decimal, DMS, DDM or UTM form */
function parseCoords(input) {
  let s = normDigits(input).trim(); if (!s) return null;
  s = s.replace(/شمال/g, 'N').replace(/جنوب/g, 'S').replace(/شرق/g, 'E').replace(/غرب/g, 'W');
  const up = s.toUpperCase();
  if (/[؀-ۿ]/.test(up)) return null;                 // other Arabic text → it is a place name
  if (!/^[\d\s.,°'"′″:;+\-NSEWMZA-Z]+$/.test(up)) return null;
  const nums = (up.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const letters = up.replace(/[^A-Z]/g, '');
  // UTM with zone: "38R 812345 3378901" / "38 N 812345E 3378901N"
  const zm = up.match(/^\s*(\d{1,2})\s*([C-HJ-NP-X])?\b/);
  if (nums.length === 3 && zm && nums[0] >= 1 && nums[0] <= 60 && Math.abs(nums[1]) >= 100000 && Math.abs(nums[2]) >= 1000000) {
    const north = zm[2] ? zm[2] >= 'N' : true;
    const r = utmToLatLng(nums[0], north, nums[1], nums[2]); r.kind = 'utm'; return valid(r);
  }
  // UTM without zone: "812345 3378901" (uses default zone from settings)
  if (nums.length === 2 && Math.abs(nums[0]) >= 100000 && Math.abs(nums[1]) >= 100000) {
    let E = nums[0], N = nums[1];
    if (E >= 1000000 && N < 1000000) { const t = E; E = N; N = t; }
    const r = utmToLatLng(fset.zone, fset.north, E, N); r.kind = 'utm'; return valid(r);
  }
  if (letters.replace(/[NSEWM]/g, '').length) return null;
  let lat, lng;
  if (nums.length === 2) { lat = nums[0]; lng = nums[1]; if (!/[.NSEW°]/.test(up)) return null; }
  else if (nums.length === 4) { lat = sgn(nums[0]) * (Math.abs(nums[0]) + nums[1] / 60); lng = sgn(nums[2]) * (Math.abs(nums[2]) + nums[3] / 60); }
  else if (nums.length === 6) { lat = sgn(nums[0]) * (Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600); lng = sgn(nums[3]) * (Math.abs(nums[3]) + nums[4] / 60 + nums[5] / 3600); }
  else return null;
  const iNS = up.search(/[NS]/), iEW = up.search(/[EW]/);
  let swapped = false;
  if (iNS >= 0 && iEW >= 0 && iEW < iNS) { const t = lat; lat = lng; lng = t; swapped = true; }
  if (/S/.test(up)) lat = -Math.abs(lat);
  if (/W/.test(up)) lng = -Math.abs(lng);
  // no letters and looks like "longitude, latitude" for Iraq → swap
  if (!swapped && iNS < 0 && iEW < 0 && inRange(lat, IRAQ_LNG) && inRange(lng, IRAQ_LAT) && !(inRange(lat, IRAQ_LAT) && inRange(lng, IRAQ_LNG))) { const t = lat; lat = lng; lng = t; }
  return valid({ lat, lng, kind: 'deg' });
  function sgn(v) { return v < 0 || Object.is(v, -0) ? -1 : 1; }
  function valid(r) { return r && isFinite(r.lat) && isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180 ? r : null; }
}

/* ================= sites (work locations) ================= */
let siteSets = store.get('siteSets', []);
function saveSiteSets() {
  try { localStorage.setItem('siteSets', JSON.stringify(siteSets)); return true; }
  catch (e) { toast('لا توجد مساحة كافية لحفظ المواقع'); return false; }
}
function allSites() {
  if (!sitesAllowed()) return [];
  const out = [];
  siteSets.forEach((set) => { if (set.visible !== false) set.sites.forEach((s) => out.push({ n: s[0], lat: s[1], lng: s[2], d: s[3] || '', set: set.name })); });
  return out;
}
const siteRenderer = L.canvas({ padding: 0.8 });
const sitesLayer = L.layerGroup().addTo(map), labelsLayer = L.layerGroup().addTo(map);
function renderSitesOnMap() {
  sitesLayer.clearLayers(); labelsLayer.clearLayers();
  allSites().forEach((s) => {
    L.circleMarker([s.lat, s.lng], { renderer: siteRenderer, radius: 7, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1 })
      .on('click', () => openSite(s)).addTo(sitesLayer);
  });
  renderLabels();
  if (typeof renderZonesOnMap === 'function') { renderZonesOnMap(); updateZoneBanner(); }
}
function renderLabels() {
  labelsLayer.clearLayers();
  if (map.getZoom() < 15 || !sitesAllowed()) return;
  const b = map.getBounds().pad(0.1); let n = 0;
  for (const s of allSites()) {
    if (!b.contains([s.lat, s.lng])) continue;
    if (++n > 150) break;
    L.marker([s.lat, s.lng], { interactive: false, icon: L.divIcon({ className: 'siteLbl', html: '<span>' + esc(s.n) + '</span>', iconSize: [0, 0], iconAnchor: [0, -10] }) }).addTo(labelsLayer);
  }
}
map.on('moveend', renderLabels);
function openSite(s) {
  if (navState || directState || window.measActive) return;
  closeSearch();
  setDestination(s.lat, s.lng, s.n, (s.d ? s.d + ' · ' : '') + s.set, true);
}
function normName(s) {
  return normDigits(s).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\s\-_/.#]+/g, '');
}
let lastSiteHits = [];
function searchSites(q) {
  const k = normName(q); if (!k) return [];
  const hits = [];
  for (const s of allSites()) {
    const n = normName(s.n);
    const score = n === k ? 0 : n.startsWith(k) ? 1 : n.includes(k) ? 2 : normName(s.d).includes(k) ? 3 : -1;
    if (score >= 0) hits.push([score, s]);
  }
  hits.sort((a, b) => a[0] - b[0] || (me ? hav([me.lat, me.lng], [a[1].lat, a[1].lng]) - hav([me.lat, me.lng], [b[1].lat, b[1].lng]) : 0));
  return hits.slice(0, 15).map((h) => h[1]);
}
function sitesResultsHtml(q) {
  lastSiteHits = sitesAllowed() ? searchSites(q) : [];
  if (!lastSiteHits.length) return '';
  return '<div class="secTitle">مواقع العمل</div>' + lastSiteHits.map((s, i) => {
    const d = me ? fmtDist(hav([me.lat, me.lng], [s.lat, s.lng])) : '';
    return `<div class="res" data-site="${i}"><div class="ic" style="background:#4a2511">🛢</div><div style="flex:1;min-width:0"><div class="t">${esc(s.n)}</div><div class="s">${esc((s.d ? s.d + ' · ' : '') + s.set)}</div></div><div class="s" style="flex:none">${d}</div></div>`;
  }).join('');
}
function bindSiteResults() {
  resEl.querySelectorAll('[data-site]').forEach((el) => { el.onclick = () => openSite(lastSiteHits[+el.dataset.site]); });
}

/* ---------- import ---------- */
let imp = null; // {fileName, sheets:{name:rows}, sheet, rows}
$('siteFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  loading(true);
  try { await readSiteFile(f); }
  catch (err) { toast('تعذّرت قراءة الملف: ' + (err && err.message ? err.message : 'صيغة غير مدعومة'), 5000); }
  finally { loading(false); }
});
function readAs(f, kind, enc) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('قراءة'));
    if (kind === 'text') r.readAsText(f, enc || 'utf-8'); else r.readAsArrayBuffer(f);
  });
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('تحميل المكتبة')); document.head.appendChild(s); });
}
async function readSiteFile(f) {
  const name = f.name || 'مواقع', ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'kmz') throw new Error('ملفات KMZ: فكّ ضغطها أولًا واستورد ملف KML الذي بداخلها');
  if (ext === 'kml' || ext === 'gpx') {
    const txt = await readAs(f, 'text');
    const pts = ext === 'kml' ? parseKml(txt) : parseGpx(txt);
    if (!pts.length) throw new Error('لا توجد نقاط في الملف');
    openImport({ fileName: name, direct: pts });
    return;
  }
  let sheets;
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'ods') {
    if (!window.XLSX) await loadScript('lib/xlsx.full.min.js');
    const wb = XLSX.read(new Uint8Array(await readAs(f, 'buf')), { type: 'array' });
    sheets = {};
    wb.SheetNames.forEach((sn) => { const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' }); if (rows.length) sheets[sn] = rows; });
  } else {
    let txt = await readAs(f, 'text');
    if (txt.indexOf('�') >= 0) txt = await readAs(f, 'text', 'windows-1256'); // Arabic Excel CSV
    sheets = { [name]: parseCsv(txt) };
  }
  const names = Object.keys(sheets);
  if (!names.length) throw new Error('الملف فارغ');
  openImport({ fileName: name, sheets, sheet: names[0] });
}
function parseCsv(txt) {
  txt = txt.replace(/^﻿/, '');
  const first = txt.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}
function parseKml(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml'), out = [];
  doc.querySelectorAll('Placemark').forEach((pm) => {
    const c = pm.querySelector('Point coordinates'); if (!c) return;
    const [lng, lat] = c.textContent.trim().split(/[\s,]+/).map(Number);
    const nm = pm.querySelector('name'), ds = pm.querySelector('description');
    if (isFinite(lat) && isFinite(lng)) out.push([nm ? nm.textContent.trim() : 'نقطة', lat, lng, ds ? ds.textContent.replace(/<[^>]+>/g, ' ').trim().slice(0, 120) : '']);
  });
  return out;
}
function parseGpx(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml'), out = [];
  doc.querySelectorAll('wpt').forEach((w) => {
    const lat = +w.getAttribute('lat'), lng = +w.getAttribute('lon'); const nm = w.querySelector('name'), ds = w.querySelector('desc');
    if (isFinite(lat) && isFinite(lng)) out.push([nm ? nm.textContent.trim() : 'نقطة', lat, lng, ds ? ds.textContent.trim().slice(0, 120) : '']);
  });
  return out;
}
const COLS = {
  name: /^(name|id|tag|tag ?no|well|well ?name|valve|site|point|station|code|no|number|اسم|الاسم|رقم|الرقم|الموقع|البئر|الصمام|المحطة|الرمز)$/i,
  lat: /^(lat|latitude|y_?lat|خط ?العرض|عرض)$/i,
  lng: /^(lon|lng|long|longitude|x_?lon|خط ?الطول|طول)$/i,
  east: /^(e|east|easting|x|utm ?e|utm_?x|شرقي|الشرقي)$/i,
  north: /^(n|north|northing|y|utm ?n|utm_?y|شمالي|الشمالي)$/i,
  coord: /^(coord|coords|coordinates|location|position|gps|إحداثيات|الإحداثيات|الاحداثيات)$/i,
  desc: /^(desc|description|type|field|area|notes?|remarks?|الوصف|النوع|الحقل|المنطقة|ملاحظات)$/i
};
function detectColumns(rows) {
  const head = rows[0].map((h) => String(h).trim());
  const find = (re) => head.findIndex((h) => re.test(h.replace(/[()\[\]]/g, '').trim()));
  const m = { name: find(COLS.name), lat: find(COLS.lat), lng: find(COLS.lng), east: find(COLS.east), north: find(COLS.north), coord: find(COLS.coord), desc: find(COLS.desc) };
  // fall back to the values when headers are unclear
  const sample = rows.slice(1, 30);
  const colTest = (fn) => head.findIndex((_, i) => { const v = sample.map((r) => parseFloat(normDigits(r[i] || ''))).filter(isFinite); return v.length >= Math.min(3, sample.length) && v.every(fn); });
  if (m.lat < 0 && m.east < 0 && m.coord < 0) { m.lat = colTest((v) => inRange(v, IRAQ_LAT)); m.lng = colTest((v) => inRange(v, IRAQ_LNG)); }
  if (m.lat < 0 && m.east < 0 && m.coord < 0) { m.east = colTest((v) => v >= 100000 && v < 1000000); m.north = colTest((v) => v >= 1000000 && v < 10000000); }
  if (m.name < 0) m.name = head.findIndex((_, i) => ![m.lat, m.lng, m.east, m.north, m.coord].includes(i));
  m.type = m.coord >= 0 && m.lat < 0 && m.east < 0 ? 'one' : (m.east >= 0 && m.north >= 0 && (m.lat < 0 || m.lng < 0) ? 'utm' : 'deg');
  return m;
}
function openImport(o) {
  imp = o;
  $('impFile').textContent = o.fileName;
  $('impName').value = o.fileName.replace(/\.[^.]+$/, '');
  if (o.direct) {
    $('impTable').classList.add('hidden'); $('impZoneRow').classList.add('hidden');
  } else {
    $('impTable').classList.remove('hidden');
    const sheetSel = $('impSheet'); sheetSel.innerHTML = Object.keys(o.sheets).map((n) => `<option>${esc(n)}</option>`).join('');
    sheetSel.value = o.sheet; $('impSheetRow').classList.toggle('hidden', Object.keys(o.sheets).length < 2);
    setupMapping();
  }
  $('impZone').value = fset.zone; $('impHemi').value = fset.north ? 'N' : 'S';
  previewImport();
  $('importPanel').classList.remove('hidden');
}
function setupMapping() {
  const rows = imp.sheets[imp.sheet];
  const head = rows[0].map((h, i) => String(h).trim() || ('عمود ' + (i + 1)));
  const opts = (none) => (none ? '<option value="-1">— بدون —</option>' : '') + head.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('');
  ['impColName', 'impColLat', 'impColLng', 'impColE', 'impColN', 'impColOne'].forEach((id) => { $(id).innerHTML = opts(false); });
  $('impColDesc').innerHTML = '<option value="-2">كل الأعمدة الأخرى</option>' + opts(true);
  const m = detectColumns(rows);
  const set = (id, v) => { if (v >= 0) $(id).value = String(v); };
  set('impColName', m.name); set('impColLat', m.lat); set('impColLng', m.lng); set('impColE', m.east); set('impColN', m.north); set('impColOne', m.coord);
  $('impColDesc').value = m.desc >= 0 ? String(m.desc) : '-2';
  $('impType').value = m.type;
  showTypeRows();
}
function showTypeRows() {
  const t = $('impType').value;
  $('impDegRows').classList.toggle('hidden', t !== 'deg');
  $('impUtmRows').classList.toggle('hidden', t !== 'utm');
  $('impOneRow').classList.toggle('hidden', t !== 'one');
  $('impZoneRow').classList.toggle('hidden', t !== 'utm');
}
function buildSites() {
  if (imp.direct) return { ok: imp.direct, bad: 0 };
  const rows = imp.sheets[imp.sheet], head = rows[0];
  const t = $('impType').value, g = (id) => +$(id).value;
  const cn = g('impColName'), cd = g('impColDesc'), zone = Math.max(1, Math.min(60, +$('impZone').value || 38)), north = $('impHemi').value === 'N';
  const used = new Set([cn, g('impColLat'), g('impColLng'), g('impColE'), g('impColN'), g('impColOne')]);
  const ok = []; let bad = 0;
  rows.slice(1).forEach((r) => {
    let p = null;
    const tryDeg = () => { const la = parseAngle(r[g('impColLat')] || ''), ln = parseAngle(r[g('impColLng')] || ''); return la != null && ln != null && Math.abs(la) <= 90 && Math.abs(ln) <= 180 ? { lat: la, lng: ln } : null; };
    const tryUtm = () => { const E = parseFloat(normDigits(r[g('impColE')] || '')), N = parseFloat(normDigits(r[g('impColN')] || '')); return isFinite(E) && isFinite(N) && E >= 100000 && E < 1000000 && N > 0 ? utmToLatLng(zone, north, E, N) : null; };
    const tryOne = () => parseCoords(String(r[g('impColOne')] || ''));
    // the chosen type first; rows that use another format in the same file still work
    const order = t === 'deg' ? [tryDeg, tryUtm] : t === 'utm' ? [tryUtm, tryDeg] : [tryOne];
    for (const fn of order) { p = fn(); if (p) break; }
    if (!p || !isFinite(p.lat) || !isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180 || (p.lat === 0 && p.lng === 0)) { bad++; return; }
    const nm = String(r[cn] || '').trim() || ('نقطة ' + (ok.length + 1));
    let d = '';
    if (cd >= 0) d = String(r[cd] || '').trim();
    else if (cd === -2) d = head.map((h, i) => (used.has(i) || !String(r[i] || '').trim() ? '' : (String(h).trim() ? String(h).trim() + ': ' : '') + String(r[i]).trim())).filter(Boolean).join(' · ');
    ok.push([nm, Math.round(p.lat * 1e7) / 1e7, Math.round(p.lng * 1e7) / 1e7, d.slice(0, 160)]);
  });
  return { ok, bad };
}
function previewImport() {
  const { ok, bad } = buildSites();
  $('impCount').innerHTML = `<span class="ok">${ok.length} موقعًا صالحًا</span>` + (bad ? ` · <span class="warnTxt">${bad} صفًا بدون إحداثيات صحيحة</span>` : '');
  $('impPreview').innerHTML = ok.slice(0, 4).map((s) => `<div class="item"><div class="grow"><div class="t">${esc(s[0])}</div><div class="s"><span dir="ltr" style="unicode-bidi:isolate">${fmtCoord(s[1], s[2])}</span>${s[3] ? ' · ' + esc(s[3]) : ''}</div></div></div>`).join('');
  $('impGo').disabled = !ok.length;
}
['impColName', 'impColLat', 'impColLng', 'impColE', 'impColN', 'impColOne', 'impColDesc', 'impZone', 'impHemi'].forEach((id) => $(id).addEventListener('change', previewImport));
$('impType').addEventListener('change', () => { showTypeRows(); previewImport(); });
$('impSheet').addEventListener('change', () => { imp.sheet = $('impSheet').value; setupMapping(); previewImport(); });
$('impGo').onclick = () => {
  const { ok } = buildSites(); if (!ok.length) return;
  const set = { id: Date.now().toString(36), name: $('impName').value.trim() || imp.fileName, date: Date.now(), visible: true, sites: ok };
  siteSets.push(set);
  if (!saveSiteSets()) { siteSets.pop(); return; }
  if ($('impType').value === 'utm') { fset.zone = +$('impZone').value || fset.zone; fset.north = $('impHemi').value === 'N'; saveFset(); }
  $('importPanel').classList.add('hidden');
  renderSitesPanel(); renderSitesOnMap();
  map.fitBounds(L.latLngBounds(ok.map((s) => [s[1], s[2]])).pad(0.1));
  $('sitesPanel').classList.add('hidden');
  toast('تم استيراد ' + ok.length + ' موقعًا', 3500);
};

/* ---------- sites panel ---------- */
function renderSitesPanel() {
  const lockCard = $('sitesLock'), body = $('sitesBody');
  if (!fieldUnlocked) { lockCard.classList.remove('hidden'); body.classList.add('hidden'); return; }
  lockCard.classList.add('hidden'); body.classList.remove('hidden');
  const l = $('setsList');
  if (!siteSets.length) l.innerHTML = '<div class="item"><div class="grow s">لا توجد قوائم مواقع بعد. استورد ملفًا أو أضف موقعك الحالي.</div></div>';
  else l.innerHTML = siteSets.map((s, i) => `<div class="item"><div class="grow"><div class="t">${esc(s.name)}</div><div class="s">${s.sites.length} موقعًا · ${new Date(s.date).toLocaleDateString('ar-IQ-u-nu-latn')}</div></div>
      <button class="chip ${s.visible !== false ? 'go' : ''}" data-vis="${i}">${s.visible !== false ? '👁 ظاهرة' : 'مخفية'}</button><button class="chip" data-setmore="${i}">⋯</button></div>`).join('');
  l.querySelectorAll('[data-vis]').forEach((b) => { b.onclick = () => { const s = siteSets[+b.dataset.vis]; s.visible = s.visible === false; saveSiteSets(); renderSitesPanel(); renderSitesOnMap(); }; });
  l.querySelectorAll('[data-setmore]').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.setmore, s = siteSets[i];
      actionSheet(s.name + ' — ' + s.sites.length + ' موقعًا', [
        { label: '💾 تصدير…', fn: () => exportMenu([s], s.name) },
        { label: '🗺 عرض المواقع على الخريطة', fn: () => { if (!s.sites.length) return; $('sitesPanel').classList.add('hidden'); s.visible = true; saveSiteSets(); renderSitesOnMap(); setFollow(false); map.fitBounds(L.latLngBounds(s.sites.map((x) => [x[1], x[2]])).pad(0.1), { maxZoom: 16 }); } },
        { label: '✏️ إعادة التسمية', fn: () => { const n = prompt('اسم القائمة', s.name); if (n && n.trim()) { s.name = n.trim(); saveSiteSets(); renderSitesPanel(); renderSitesOnMap(); } } },
        { label: '🗑 حذف القائمة', cls: 'danger', fn: () => { if (!confirm('حذف قائمة «' + s.name + '» من الهاتف؟')) return; siteSets.splice(i, 1); saveSiteSets(); renderSitesPanel(); renderSitesOnMap(); } }
      ]);
    };
  });
}

/* ---------- export ---------- */
function exportMenu(sets, baseName) {
  const n = sets.reduce((t, s) => t + s.sites.length, 0);
  if (!n) { toast('لا توجد مواقع لتصديرها'); return; }
  const file = (baseName || 'مواقع').replace(/[\\/:*?"<>|]/g, '_');
  actionSheet('تصدير ' + n + ' موقعًا', [
    { label: '📊 Excel (CSV) — يمكن إعادة استيراده', fn: () => saveTextFile(file + '.csv', 'text/csv', sitesCsv(sets)) },
    { label: '🌍 KML — لـ Google Earth و Google My Maps', fn: () => saveTextFile(file + '.kml', 'application/vnd.google-earth.kml+xml', sitesKml(sets, baseName)) },
    { label: '📍 GPX — لأجهزة GPS والتطبيقات الأخرى', fn: () => saveTextFile(file + '.gpx', 'application/gpx+xml', sitesGpx(sets)) }
  ]);
}
function sitesCsv(sets) {
  const head = ['Name', 'Latitude', 'Longitude', 'UTM_Zone', 'Easting', 'Northing', 'Description', 'List'];
  const rows = [];
  sets.forEach((set) => set.sites.forEach((x) => {
    const u = latLngToUtm(x[1], x[2]);
    rows.push([x[0], x[1].toFixed(7), x[2].toFixed(7), u.zone + u.band, u.E.toFixed(1), u.N.toFixed(1), x[3] || '', set.name]);
  }));
  return [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function sitesKml(sets, name) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xmlEsc(name || 'مواقع العمل') + '</name>\n'
    + sets.map((set) => '<Folder><name>' + xmlEsc(set.name) + '</name>\n' + set.sites.map((x) =>
      '<Placemark><name>' + xmlEsc(x[0]) + '</name>' + (x[3] ? '<description>' + xmlEsc(x[3]) + '</description>' : '')
      + '<Point><coordinates>' + x[2] + ',' + x[1] + ',0</coordinates></Point></Placemark>').join('\n') + '\n</Folder>').join('\n')
    + '\n</Document></kml>\n';
}
function sitesGpx(sets) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mallah Navigator" xmlns="http://www.topografix.com/GPX/1/1">\n'
    + sets.map((set) => set.sites.map((x) => '<wpt lat="' + x[1] + '" lon="' + x[2] + '"><name>' + xmlEsc(x[0]) + '</name>'
      + '<desc>' + xmlEsc((x[3] ? x[3] + ' · ' : '') + set.name) + '</desc></wpt>').join('\n')).join('\n')
    + '\n</gpx>\n';
}
$('expAllBtn').onclick = () => exportMenu(siteSets, 'مواقع العمل ' + new Date().toISOString().slice(0, 10));

/* ---------- add a site from the field ---------- */
function addSite(lat, lng, defName) {
  const finish = (set) => {
    const n = prompt('اسم الموقع أو رقمه', defName || ''); if (n == null || !n.trim()) return;
    const d = prompt('وصف (اختياري)', '') || '';
    set.sites.push([n.trim(), Math.round(lat * 1e7) / 1e7, Math.round(lng * 1e7) / 1e7, d.trim()]);
    set.visible = true;
    if (!saveSiteSets()) { set.sites.pop(); return; }
    renderSitesOnMap(); renderSitesPanel(); if (dest) fieldSheetUpdate();
    toast('تمت إضافة «' + n.trim() + '» إلى ' + set.name);
  };
  const items = siteSets.map((s) => ({ label: '📁 ' + esc(s.name) + ' (' + s.sites.length + ')', fn: () => finish(s) }));
  items.push({ label: '➕ قائمة جديدة…', fn: () => {
    const nm = prompt('اسم القائمة الجديدة', 'مواقع مضافة'); if (!nm || !nm.trim()) return;
    const set = { id: Date.now().toString(36), name: nm.trim(), date: Date.now(), visible: true, sites: [] };
    siteSets.push(set); finish(set);
    if (!set.sites.length) { siteSets = siteSets.filter((x) => x !== set); saveSiteSets(); }
  } });
  actionSheet('إضافة إلى أي قائمة؟', items);
}
$('addHereBtn').onclick = () => {
  if (!me) { toast('لم يُحدَّد موقعك بعد'); startLocation(); return; }
  if ((me.acc || 0) > 30) toast('تنبيه: دقة GPS الحالية ±' + Math.round(me.acc) + ' م', 3500);
  addSite(me.lat, me.lng, '');
};
$('addSiteBtn').onclick = () => { if (dest) addSite(dest.lat, dest.lng, dest.name === 'نقطة محددة' || dest.name === 'إحداثيات' ? '' : dest.name); };
$('openSites').onclick = () => { $('menuDrop').classList.add('hidden'); renderSitesPanel(); $('sitesPanel').classList.remove('hidden'); };
$('impBtn').onclick = () => $('siteFile').click();
$('unlockBtn').onclick = () => tryUnlock();
function tryUnlock() {
  const p = prompt('أدخل رمز القفل');
  if (p == null) return false;
  if (pinHash(p) === fset.pin) { fieldUnlocked = true; renderSitesPanel(); renderSitesOnMap(); toast('تم فتح القفل'); return true; }
  toast('الرمز غير صحيح'); return false;
}

/* ================= settings panel ================= */
function renderSettings() {
  $('setField').checked = fset.field;
  $('setFieldOpts').classList.toggle('hidden', !fset.field);
  $('setFmt').value = fset.fmt; $('setZone').value = fset.zone; $('setHemi').value = fset.north ? 'N' : 'S';
  $('pinState').textContent = fset.pin ? (fieldUnlocked ? 'مفعّل — مفتوح الآن' : 'مفعّل — مقفل') : 'غير مفعّل';
  $('pinSet').textContent = fset.pin ? 'تغيير الرمز' : 'تعيين رمز';
  $('pinOff').classList.toggle('hidden', !fset.pin); $('pinLock').classList.toggle('hidden', !fset.pin || !fieldUnlocked);
  $('openSites').classList.toggle('hidden', !fset.field);
  ['openZones', 'openVisits'].forEach((id) => { const el = $(id); if (el) el.classList.toggle('hidden', !fset.field); });
  if (typeof opsFieldChanged === 'function') opsFieldChanged();
}
$('openSettings').onclick = () => { $('menuDrop').classList.add('hidden'); renderSettings(); $('setPanel').classList.remove('hidden'); };
$('setField').onchange = () => {
  fset.field = $('setField').checked; saveFset();
  if (fset.field && fset.pin) fieldUnlocked = false;
  renderSettings(); renderSitesOnMap(); if (dest) fieldSheetUpdate();
  toast(fset.field ? 'تم تفعيل وضع العمل الميداني' : 'تم إيقاف وضع العمل الميداني');
};
$('setFmt').onchange = () => { fset.fmt = $('setFmt').value; saveFset(); if (dest) fieldSheetUpdate(); };
$('setZone').onchange = () => { fset.zone = Math.max(1, Math.min(60, +$('setZone').value || 38)); saveFset(); renderSettings(); };
$('setHemi').onchange = () => { fset.north = $('setHemi').value === 'N'; saveFset(); };
$('pinSet').onclick = () => {
  if (fset.pin && !fieldUnlocked && !tryUnlock()) return;
  const a = prompt('أدخل رمزًا جديدًا (4 أرقام أو أكثر)'); if (a == null) return;
  if (!/^\S{4,}$/.test(a)) { toast('الرمز قصير جدًا'); return; }
  const b = prompt('أعد إدخال الرمز للتأكيد'); if (b !== a) { toast('الرمزان غير متطابقين'); return; }
  fset.pin = pinHash(a); fieldUnlocked = true; saveFset(); renderSettings(); toast('تم تعيين رمز القفل');
};
$('pinOff').onclick = () => { if (!fieldUnlocked && !tryUnlock()) return; fset.pin = null; fieldUnlocked = true; saveFset(); renderSettings(); toast('تمت إزالة الرمز'); };
$('pinLock').onclick = () => { fieldUnlocked = false; renderSettings(); renderSitesOnMap(); toast('تم قفل مواقع العمل'); };

/* ================= destination sheet additions ================= */
function fieldSheetUpdate() {
  const el = $('destCoords');
  if (!dest || !fset.field) { el.classList.add('hidden'); $('addSiteBtn').classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.textContent = '📐 ' + fmtCoord(dest.lat, dest.lng);
  $('addSiteBtn').classList.toggle('hidden', allSites().some((s) => hav([s.lat, s.lng], [dest.lat, dest.lng]) < 3));
}
$('destCoords').onclick = () => {
  if (!dest) return;
  const formats = ['dec', 'dms', 'utm'];
  actionSheet('الإحداثيات', formats.map((f) => ({ label: '📋 <span dir="ltr" style="unicode-bidi:isolate">' + fmtCoord(dest.lat, dest.lng, f) + '</span>', fn: () => copyText(fmtCoord(dest.lat, dest.lng, f)) })));
};
function copyText(t) {
  try { navigator.clipboard.writeText(t).then(() => toast('تم النسخ'), () => doShare(t)); } catch (e) { doShare(t); }
}
$('directBtn').onclick = () => { if (dest) { if (!me) { toast('بانتظار تحديد موقعك…'); startLocation(); return; } startDirect({ lat: dest.lat, lng: dest.lng, name: dest.name }); } };

/* ================= direct (compass) navigation ================= */
let directState = null;
let devHeading = null, devHeadingT = 0;
const CARD = ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'];
function cardinal(b) { return CARD[Math.round(b / 45) % 8]; }
function onOrient(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null || isNaN(h)) return;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  h = (h + ang + 720) % 360;
  if (devHeading == null) devHeading = h;
  else { let d = ((h - devHeading + 540) % 360) - 180; devHeading = (devHeading + d * 0.25 + 360) % 360; } // smoothing
  devHeadingT = Date.now();
  if (directState) renderDirect();
}
window.addEventListener('deviceorientationabsolute', onOrient, true);
window.addEventListener('deviceorientation', (e) => { if (e.absolute || e.webkitCompassHeading != null) onOrient(e); }, true);
function currentHeading() {
  const moving = me && me.speed != null && me.speed >= 1.5;
  if (moving && me.heading != null) return { h: me.heading, src: 'gps' };
  if (devHeading != null && Date.now() - devHeadingT < 3000) return { h: devHeading, src: 'compass' };
  if (me && me.heading != null) return { h: me.heading, src: 'gps' };
  return null;
}
function startDirect(t, quiet) {
  if (navState) endNav(false, true);
  if (!me) return;
  directState = { t, said: {}, line: null, startD: hav([me.lat, me.lng], [t.lat, t.lng]) };
  if (NATIVE) try { Android.setNavigating(true); } catch (e) {}
  if (!dest || dest.lat !== t.lat || dest.lng !== t.lng) setDestination(t.lat, t.lng, t.name, '', true);
  $('sheet').classList.add('hidden'); $('searchWrap').classList.add('hidden'); $('layersBtn').parentElement.classList.add('hidden');
  $('fabs').style.bottom = 'calc(110px + env(safe-area-inset-bottom))';
  $('navTop').classList.add('direct'); $('navTop').classList.remove('hidden'); $('navBottom').classList.remove('hidden'); $('speed').classList.remove('hidden');
  $('navStepsBtn').classList.add('hidden'); $('navThen').classList.add('hidden');
  clearRouteLayer();
  directState.line = L.polyline([[me.lat, me.lng], [t.lat, t.lng]], { color: '#f97316', weight: 5, dashArray: '2 10', lineCap: 'round', interactive: false }).addTo(map);
  iconMode = null; updateMeMarker();
  setFollow(true);
  map.fitBounds(L.latLngBounds([[me.lat, me.lng], [t.lat, t.lng]]), { paddingTopLeft: [40, 170], paddingBottomRight: [40, 140], maxZoom: 17 });
  const d = directState.startD, b = bearing([me.lat, me.lng], [t.lat, t.lng]);
  if (!quiet) say('اتجاه مباشر. الهدف على بعد ' + spokenDist(d) + ' باتجاه ' + cardinal(b));
  renderDirect();
}
function renderDirect() {
  const s = directState; if (!s || !me) return;
  const t = s.t, d = hav([me.lat, me.lng], [t.lat, t.lng]), b = bearing([me.lat, me.lng], [t.lat, t.lng]);
  const hd = currentHeading();
  const rel = hd ? b - hd.h : b;
  $('navArrow').innerHTML = `<svg viewBox="0 0 48 48"><g transform="rotate(${rel.toFixed(1)} 24 24)"><path d="M24 4l12 30-12-7-12 7z" fill="#fff"/></g></svg>`;
  $('navDist').textContent = fmtDist(d);
  $('navText').textContent = 'نحو ' + t.name + ' · ' + cardinal(b) + ' ' + Math.round(b) + '°' + (hd ? '' : ' (الشمال للأعلى)');
  const sp = me.speed != null && me.speed > 0.8 ? me.speed : null;
  $('navEta').textContent = sp ? 'الوصول ' + clock(new Date(Date.now() + d / sp * 1000)) : 'اتجاه مباشر 🧭';
  $('navRemain').textContent = fmtDist(d) + ' خط مستقيم' + (hd ? (hd.src === 'compass' ? ' · البوصلة' : ' · اتجاه الحركة') : ' · حرّك الهاتف لمعايرة البوصلة');
  if (me.speed == null || me.speed < 1.5) { const el = meMarker && meMarker.getElement() && meMarker.getElement().querySelector('.hd'); if (el && hd) el.style.transform = 'rotate(' + hd.h + 'deg)'; }
}
function onDirectLocation() {
  const s = directState; if (!s || !me) return;
  const t = s.t, d = hav([me.lat, me.lng], [t.lat, t.lng]);
  $('spdVal').textContent = me.speed != null && me.speed >= 0 ? Math.round(me.speed * 3.6) : 0;
  if (s.line) s.line.setLatLngs([[me.lat, me.lng], [t.lat, t.lng]]);
  const arriveR = Math.max(10, Math.min(me.acc || 0, 25));
  if (d <= arriveR) { say('وصلت إلى الهدف'); endDirect(true); return; }
  for (const m of [1000, 500, 200, 100, 50]) {
    if (d <= m && s.startD > m * 1.2 && !s.said[m]) {
      [1000, 500, 200, 100, 50].forEach((x) => { if (x >= m) s.said[x] = true; });
      say('الهدف على بعد ' + spokenDist(d) + ' باتجاه ' + cardinal(bearing([me.lat, me.lng], [t.lat, t.lng])));
      break;
    }
  }
  renderDirect();
  if (follow) map.panTo([me.lat, me.lng], { animate: true, duration: 0.6 });
}
function endDirect(arrived) {
  const s = directState; if (!s) return;
  directState = null;
  if (s.line) map.removeLayer(s.line);
  if (NATIVE) try { Android.setNavigating(false); } catch (e) {}
  $('navTop').classList.remove('direct'); $('navTop').classList.add('hidden'); $('navBottom').classList.add('hidden'); $('speed').classList.add('hidden');
  $('navStepsBtn').classList.remove('hidden');
  $('searchWrap').classList.remove('hidden'); $('layersBtn').parentElement.classList.remove('hidden');
  iconMode = null; updateMeMarker();
  if (arrived) { const at = dest; clearDestination(); toast('وصلت إلى الهدف 🎯', 4000); if (typeof onArrived === 'function') onArrived(at); }
  else if (dest) { $('sheet').classList.remove('hidden'); fabsAboveSheet(); showRoute(); }
  else $('fabs').style.bottom = '';
}

/* ================= back button ================= */
function fieldHandleBack() {
  for (const id of ['importPanel', 'sitesPanel', 'setPanel']) if (!$(id).classList.contains('hidden')) { $(id).classList.add('hidden'); return true; }
  if (directState) { endDirect(false); return true; }
  return false;
}

/* ================= init ================= */
renderSettings();
renderSitesOnMap();
