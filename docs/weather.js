'use strict';
/* الملاح — الطقس: المطر والرياح والحرارة والحالة لكل محافظة وقضاء وناحية، ساعة بساعة ليومين وأيامًا لأسبوع،
   على الخريطة بألوان متحركة وأرقام، مع تنبيهات الأمطار الغزيرة والرياح القوية والحر والصقيع.
   The forecast is made every two hours on GitHub (tools/weather.py: MET Norway + the ECMWF ensemble)
   and read from one file, so no phone talks to the weather services directly. */

const WX_BASE = 'https://raw.githubusercontent.com/mustafasami446-star/mallah/weather/';
const WX = {
  data: null, at: 0, loading: null,
  tab: store.get('wxTab', 'rain'), mode: 'h', idx: 0, sel: null,
  on: false, play: null, overlay: null, labels: L.layerGroup(), frames: new Map(), ar: null
};
let wxCfg = store.get('wxCfg', { alerts: true, follow: [] });
const wxSaveCfg = () => { store.set('wxCfg', wxCfg); wxNative(); };

/* ---------------- words and pictures ---------------- */
const WX_SYM = {
  clearsky: ['☀️', 'صحو'], fair: ['🌤', 'صحو غالبًا'], partlycloudy: ['⛅', 'غائم جزئيًا'], cloudy: ['☁️', 'غائم'], fog: ['🌫', 'ضباب'],
  lightrain: ['🌦', 'مطر خفيف'], rain: ['🌧', 'مطر'], heavyrain: ['🌧', 'مطر غزير'],
  lightrainshowers: ['🌦', 'زخات خفيفة'], rainshowers: ['🌦', 'زخات مطر'], heavyrainshowers: ['🌧', 'زخات غزيرة'],
  lightrainandthunder: ['⛈', 'رعد مع مطر خفيف'], rainandthunder: ['⛈', 'عاصفة رعدية'], heavyrainandthunder: ['⛈', 'عاصفة رعدية قوية'],
  rainshowersandthunder: ['⛈', 'زخات رعدية'], heavyrainshowersandthunder: ['⛈', 'زخات رعدية قوية'], lightrainshowersandthunder: ['⛈', 'زخات رعدية خفيفة'],
  lightsleet: ['🌨', 'مطر مع ثلج خفيف'], sleet: ['🌨', 'مطر مع ثلج'], lightsnow: ['🌨', 'ثلج خفيف'], snow: ['❄️', 'ثلج'], heavysnow: ['❄️', 'ثلج كثيف'],
  snowshowers: ['🌨', 'زخات ثلج'], sleetshowers: ['🌨', 'زخات مطر وثلج']
};
function wxSym(n, night) {
  const name = WX.data && n >= 0 ? WX.data.sym[n] : null;
  const s = WX_SYM[name] || ['·', '—'];
  if (night && (name === 'clearsky' || name === 'fair')) return ['🌙', name === 'clearsky' ? 'صافٍ' : 'صافٍ غالبًا'];
  return s;
}
const WX_DIRS = ['شمالية', 'شمالية شرقية', 'شرقية', 'جنوبية شرقية', 'جنوبية', 'جنوبية غربية', 'غربية', 'شمالية غربية'];
const wxDirName = (from) => WX_DIRS[Math.round(((from % 360) + 360) % 360 / 45) % 8];
const kmh = (ms10) => Math.round(ms10 * 0.36);                // stored as m/s × 10
const mm = (v10) => (v10 >= 100 ? Math.round(v10 / 10) : Math.round(v10) / 10);
const WX_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const iqDate = (ms) => new Date(ms + 3 * 3600e3);              // Iraq time, read with getUTC*
function wxHourMs(i) { return Date.parse(WX.data.start) + i * 3600e3; }
function wxDayLabel(i, short) {
  const d = new Date(Date.parse(WX.data.day0 + 'T00:00:00Z') + i * 86400e3);
  const today = Math.floor((Date.now() + 3 * 3600e3) / 86400e3), di = Math.floor(d.getTime() / 86400e3);
  if (di === today) return 'اليوم';
  if (di === today + 1) return 'غدًا';
  return WX_DAYS[d.getUTCDay()] + (short ? '' : ' ' + d.getUTCDate() + '/' + (d.getUTCMonth() + 1));
}
function wxTimeLabel(i) {
  if (WX.mode === 'd') return wxDayLabel(i);
  const t = iqDate(wxHourMs(i)), h = t.getUTCHours();
  const dayIdx = Math.floor((wxHourMs(i) + 3 * 3600e3) / 86400e3) - Math.floor(Date.parse(WX.data.day0 + 'T00:00:00Z') / 86400e3);
  const hh = (h % 12 || 12) + (h < 12 ? ' ص' : ' م');
  return (i === wxNowIdx() ? 'الآن · ' : '') + wxDayLabel(dayIdx, true) + ' ' + hh;
}
function wxNowIdx() { return WX.data ? Math.max(0, Math.min(WX.data.hours - 1, Math.floor((Date.now() - Date.parse(WX.data.start)) / 3600e3))) : 0; }
function wxDayOfHour(i) { return Math.max(0, Math.floor((wxHourMs(i) + 3 * 3600e3) / 86400e3) - Math.floor(Date.parse(WX.data.day0 + 'T00:00:00Z') / 86400e3)); }

/* ---------------- the data ---------------- */
async function wxCacheGet() { try { const c = await caches.open('mallah-wx'); const r = await c.match('weather.json'); return r ? await r.json() : null; } catch (e) { return null; } }
async function wxCachePut(txt) { try { const c = await caches.open('mallah-wx'); await c.put('weather.json', new Response(txt, { headers: { 'Content-Type': 'application/json' } })); } catch (e) {} }
function wxLoad(force) {
  if (WX.loading) return WX.loading;
  if (!force && WX.data && Date.now() - WX.at < 30 * 60e3) return Promise.resolve(WX.data);
  WX.loading = (async () => {
    if (!WX.data) { const c = await wxCacheGet(); if (c && c.v === 1) wxSetData(c); }
    try {
      const r = await fetch(WX_BASE + 'weather.json?t=' + Math.floor(Date.now() / 600e3), { cache: 'no-cache' });
      if (!r.ok) throw new Error('http ' + r.status);
      const txt = await r.text(), d = JSON.parse(txt);
      if (d && d.v === 1) { wxSetData(d); WX.at = Date.now(); wxCachePut(txt); }
    } catch (e) { if (!WX.data) throw e; }
    return WX.data;
  })().finally(() => { WX.loading = null; });
  return WX.loading;
}
function wxSetData(d) {
  const keep = WX.data && WX.mode === 'h' ? wxHourMs(WX.idx) : null;
  WX.data = d; WX.frames.clear();
  WX.idx = WX.mode === 'h' ? (keep ? Math.max(0, Math.min(d.hours - 1, Math.round((keep - Date.parse(d.start)) / 3600e3))) : wxNowIdx()) : Math.min(WX.idx, d.days - 1);
}
const wxArea = (id) => WX.data && WX.data.areas[id];
/* the numbers of one area (or a province: its districts together) at the chosen time */
function wxValues(id) {
  const D = WX.data; if (!D) return null;
  let list;
  if (String(id).startsWith('p:')) list = (WX.ar.kids[id] || []).map((n) => D.areas[n.id]).filter(Boolean);
  else list = [D.areas[id]].filter(Boolean);
  if (!list.length) return null;
  const pick = (f) => list.map(f).filter((x) => x != null);
  const avg = (a) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
  const max = (a) => a.length ? Math.max(...a) : null;
  const most = (a) => { const c = {}; a.forEach((x) => { if (x >= 0) c[x] = (c[x] || 0) + 1; }); let b = -1, n = 0; for (const k in c) if (c[k] > n || (c[k] === n && +k > b)) { b = +k; n = c[k]; } return b; };
  const i = WX.idx, n = list.length;
  if (WX.mode === 'h') {
    const di = wxDayOfHour(i), hr = iqDate(wxHourMs(i)).getUTCHours();
    return {
      n, t: avg(pick((a) => a.h.t[i])), r: max(pick((a) => a.h.r[i])), w: max(pick((a) => a.h.w[i])), d: list.length === 1 ? list[0].h.d[i] : null,
      s: most(pick((a) => a.h.s[i])), p: max(pick((a) => a.d.p && a.d.p[di])), night: hr < 6 || hr >= 18
    };
  }
  return {
    n, tx: max(pick((a) => a.d.tx[i])), tn: avg(pick((a) => a.d.tn[i])), r: max(pick((a) => a.d.r[i])), p: max(pick((a) => a.d.p && a.d.p[i])),
    w: max(pick((a) => a.d.w[i])), s: most(pick((a) => a.d.s[i])), p10: max(pick((a) => a.d.p10 && a.d.p10[i])), g15: max(pick((a) => a.d.g15 && a.d.g15[i]))
  };
}

/* ---------------- colours ---------------- */
const WX_RAMP = {
  rainH: [[0, 0, 0, 0, 0], [0.4, 125, 211, 252, 0.45], [1, 56, 189, 248, 0.6], [3, 37, 99, 235, 0.7], [8, 124, 58, 237, 0.78], [20, 219, 39, 119, 0.85]],
  rainP: [[0, 0, 0, 0, 0], [10, 125, 211, 252, 0.15], [30, 56, 189, 248, 0.4], [60, 37, 99, 235, 0.6], [90, 124, 58, 237, 0.75]],
  rainD: [[0, 0, 0, 0, 0], [1, 125, 211, 252, 0.45], [5, 56, 189, 248, 0.6], [15, 37, 99, 235, 0.7], [40, 124, 58, 237, 0.8]],
  wind: [[0, 34, 197, 94, 0.18], [4, 132, 204, 22, 0.35], [8, 250, 204, 21, 0.5], [12, 249, 115, 22, 0.62], [17, 239, 68, 68, 0.72], [25, 168, 85, 247, 0.8]],
  temp: [[-5, 147, 197, 253, 0.55], [5, 96, 165, 250, 0.5], [15, 52, 211, 153, 0.45], [25, 250, 204, 21, 0.5], [35, 249, 115, 22, 0.55], [45, 220, 38, 38, 0.62], [52, 136, 19, 55, 0.7]]
};
function wxColor(ramp, v) {
  if (v == null || v !== v) return null;
  const R = WX_RAMP[ramp];
  if (v <= R[0][0]) return R[0].slice(1);
  for (let k = 1; k < R.length; k++) {
    if (v <= R[k][0]) { const a = R[k - 1], b = R[k], f = (v - a[0]) / (b[0] - a[0]); return [0, 1, 2, 3].map((q) => a[q + 1] + (b[q + 1] - a[q + 1]) * f); }
  }
  return R[R.length - 1].slice(1);
}
/* what the colours mean, for the current tab */
function wxRampFor() {
  if (WX.tab === 'wind') return { ramp: 'wind', unit: 'كم/س', ticks: [[0, '0'], [4, '15'], [8, '30'], [12, '45'], [17, '60'], [25, '90']] };
  if (WX.tab === 'temp') return { ramp: 'temp', unit: '°م', ticks: [[-5, '-5'], [5, '5'], [15, '15'], [25, '25'], [35, '35'], [45, '45']] };
  if (WX.mode === 'd' && wxHasChance()) return { ramp: 'rainP', unit: 'احتمال المطر', ticks: [[10, '10%'], [30, '30%'], [60, '60%'], [90, '90%']] };
  if (WX.mode === 'd') return { ramp: 'rainD', unit: 'ملم في اليوم', ticks: [[1, '1'], [5, '5'], [15, '15'], [40, '40']] };
  return { ramp: 'rainH', unit: 'ملم في الساعة', ticks: [[0.4, '0.4'], [1, '1'], [3, '3'], [8, '8'], [20, '20']] };
}
const wxHasChance = () => !!(WX.data && WX.data.grid.d.p && WX.data.grid.d.p.some((a) => a && a.some((x) => x != null)));
/* value of one grid cell at the chosen time, in the units of the ramp */
function wxGridVal(k) {
  const G = WX.data.grid, i = WX.idx;
  if (WX.mode === 'h') {
    if (WX.tab === 'wind') { const v = G.h.w[k][i]; return v == null ? null : v / 10; }
    if (WX.tab === 'temp') return G.h.t[k][i];
    const v = G.h.r[k][i]; return v == null ? null : v / 10;
  }
  if (WX.tab === 'wind') { const v = G.d.w[k][i]; return v == null ? null : v / 10; }
  if (WX.tab === 'temp') return G.d.tx[k][i];
  if (wxHasChance()) return G.d.p[k] ? G.d.p[k][i] : null;
  const v = G.d.r[k][i]; return v == null ? null : v / 10;
}

/* ---------------- the coloured picture over Iraq ---------------- */
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const latOfY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
function wxFrame() {
  const key = WX.tab + '|' + WX.mode + '|' + WX.idx;
  if (WX.frames.has(key)) return WX.frames.get(key);
  const G = WX.data.grid, { ramp } = wxRampFor();
  const lat0 = G.lat0, lat1 = G.lat0 + (G.ny - 1) * G.step, lon0 = G.lon0, lon1 = G.lon0 + (G.nx - 1) * G.step;
  const W = 400, y0 = mercY(lat0), y1 = mercY(lat1), H = Math.round(W * (y1 - y0) / ((lon1 - lon0) * Math.PI / 180));
  const vals = new Float32Array(G.nx * G.ny);
  for (let k = 0; k < vals.length; k++) { const v = wxGridVal(k); vals[k] = v == null ? NaN : v; }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H), px = img.data;
  for (let py = 0; py < H; py++) {
    const lat = latOfY(y1 - (py + 0.5) / H * (y1 - y0)), gy = (lat - lat0) / G.step;
    const j0 = Math.max(0, Math.min(G.ny - 2, Math.floor(gy))), fy = Math.min(1, Math.max(0, gy - j0));
    for (let qx = 0; qx < W; qx++) {
      const gx = (qx + 0.5) / W * (G.nx - 1), i0 = Math.min(G.nx - 2, Math.floor(gx)), fx = gx - i0;
      const a = vals[j0 * G.nx + i0], b = vals[j0 * G.nx + i0 + 1], cc = vals[(j0 + 1) * G.nx + i0], d = vals[(j0 + 1) * G.nx + i0 + 1];
      let s = 0, wsum = 0;
      const add = (v, w) => { if (v === v) { s += v * w; wsum += w; } };
      add(a, (1 - fx) * (1 - fy)); add(b, fx * (1 - fy)); add(cc, (1 - fx) * fy); add(d, fx * fy);
      if (!wsum) continue;
      const col = wxColor(ramp, s / wsum); if (!col) continue;
      const o = (py * W + qx) * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = Math.round(col[3] * 255);
    }
  }
  x.putImageData(img, 0, 0);
  // only inside Iraq
  const P = (lon, lat) => [(lon - lon0) / (lon1 - lon0) * W, (y1 - mercY(lat)) / (y1 - y0) * H];
  x.globalCompositeOperation = 'destination-in';
  x.beginPath();
  (window.PROVINCES ? PROVINCES.features : []).forEach((f) => {
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([lo, la], n) => { const [X, Y] = P(lo, la); if (n) x.lineTo(X, Y); else x.moveTo(X, Y); })));
  });
  x.fill(); x.globalCompositeOperation = 'source-over';
  // wind: arrows blowing the way the wind goes
  if (WX.tab === 'wind' && WX.mode === 'h' && !WXP.can) {
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
      const k = j * G.nx + i, sp = G.h.w[k][WX.idx], dir = G.h.d[k][WX.idx];
      if (sp == null || dir == null) continue;
      const lat = lat0 + j * G.step, lon = lon0 + i * G.step;
      if (!wxInIraq(lat, lon)) continue;
      const [X, Y] = P(lon, lat), to = (dir + 180) * Math.PI / 180, len = 5 + Math.min(10, sp / 10);
      const dx = Math.sin(to) * len, dy = -Math.cos(to) * len;
      x.strokeStyle = 'rgba(15,23,42,.7)'; x.lineWidth = 3.4; wxArrow(x, X - dx, Y - dy, X + dx, Y + dy);
      x.strokeStyle = '#f8fafc'; x.lineWidth = 1.6; wxArrow(x, X - dx, Y - dy, X + dx, Y + dy);
    }
  }
  const url = c.toDataURL('image/png');
  const out = { url, bounds: [[lat0, lon0], [lat1, lon1]] };
  WX.frames.set(key, out);
  if (WX.frames.size > 120) WX.frames.delete(WX.frames.keys().next().value);
  return out;
}
function wxArrow(x, ax, ay, bx, by) {
  const a = Math.atan2(by - ay, bx - ax), h = 4.5;
  x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by);
  x.moveTo(bx, by); x.lineTo(bx - h * Math.cos(a - 0.5), by - h * Math.sin(a - 0.5));
  x.moveTo(bx, by); x.lineTo(bx - h * Math.cos(a + 0.5), by - h * Math.sin(a + 0.5));
  x.stroke();
}
let wxIraqCache = null;
function wxInIraq(lat, lng) {
  wxIraqCache = wxIraqCache || new Map();
  const k = lat + ',' + lng;
  if (!wxIraqCache.has(k)) wxIraqCache.set(k, (window.PROVINCES ? PROVINCES.features : []).some((f) => inArea({ g: f.geometry, b: bboxOf(f.geometry) }, lat, lng)));
  return wxIraqCache.get(k);
}

/* ---------------- moving wind: little streaks carried by the wind ---------------- */
const WXP = { can: !!window.requestAnimationFrame, cv: null, ctx: null, parts: [], U: null, V: null, key: '', raf: 0, mask: null, last: 0 };
function wxpMask() {
  if (WXP.mask) return WXP.mask;
  const G = WX.data.grid, N = 120, m = new Uint8Array(N * N);
  const lat0 = G.lat0, lat1 = G.lat0 + (G.ny - 1) * G.step, lon0 = G.lon0, lon1 = G.lon0 + (G.nx - 1) * G.step;
  const provs = (window.PROVINCES ? PROVINCES.features : []).map((f) => ({ g: f.geometry, b: bboxOf(f.geometry) }));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const lat = lat0 + (j + 0.5) / N * (lat1 - lat0), lng = lon0 + (i + 0.5) / N * (lon1 - lon0);
    m[j * N + i] = provs.some((p) => inArea(p, lat, lng)) ? 1 : 0;
  }
  return (WXP.mask = { m, N, lat0, lat1, lon0, lon1 });
}
function wxpInside(lat, lng) {
  const M = wxpMask(), i = Math.floor((lng - M.lon0) / (M.lon1 - M.lon0) * M.N), j = Math.floor((lat - M.lat0) / (M.lat1 - M.lat0) * M.N);
  return i >= 0 && j >= 0 && i < M.N && j < M.N && M.m[j * M.N + i] === 1;
}
function wxpField() {
  const key = WX.idx + '|' + WX.data.made;
  if (WXP.key === key) return;
  const G = WX.data.grid, n = G.nx * G.ny; WXP.U = new Float32Array(n); WXP.V = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const sp = G.h.w[k][WX.idx], dir = G.h.d[k][WX.idx];
    if (sp == null || dir == null) { WXP.U[k] = NaN; WXP.V[k] = NaN; continue; }
    const s = sp / 10, a = dir * Math.PI / 180;             // "from" direction -> the way it blows
    WXP.U[k] = -s * Math.sin(a); WXP.V[k] = -s * Math.cos(a);
  }
  WXP.key = key;
}
function wxpWind(lat, lng) {
  const G = WX.data.grid, gx = (lng - G.lon0) / G.step, gy = (lat - G.lat0) / G.step;
  const i0 = Math.max(0, Math.min(G.nx - 2, Math.floor(gx))), j0 = Math.max(0, Math.min(G.ny - 2, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - i0)), fy = Math.min(1, Math.max(0, gy - j0));
  let u = 0, v = 0, w = 0;
  [[i0, j0, (1 - fx) * (1 - fy)], [i0 + 1, j0, fx * (1 - fy)], [i0, j0 + 1, (1 - fx) * fy], [i0 + 1, j0 + 1, fx * fy]].forEach(([i, j, q]) => {
    const k = j * G.nx + i; if (WXP.U[k] === WXP.U[k]) { u += WXP.U[k] * q; v += WXP.V[k] * q; w += q; }
  });
  return w ? [u / w, v / w] : null;
}
function wxpSpawn(p) {
  const M = wxpMask(), b = map.getBounds();
  const s = Math.max(M.lat0, b.getSouth()), n = Math.min(M.lat1, b.getNorth()), w = Math.max(M.lon0, b.getWest()), e = Math.min(M.lon1, b.getEast());
  for (let t = 0; t < 12; t++) {
    const lat = s + Math.random() * Math.max(0, n - s), lng = w + Math.random() * Math.max(0, e - w);
    if (n > s && e > w && wxpInside(lat, lng)) { p.lat = lat; p.lng = lng; p.age = Math.floor(Math.random() * 60); return p; }
  }
  p.lat = NaN; p.age = 0; return p;
}
function wxpOn() {
  if (!WXP.can || !WX.on || WX.tab !== 'wind' || WX.mode !== 'h' || !WX.data) { wxpOff(); return; }
  if (!WXP.cv) {
    const cv = document.createElement('canvas'); cv.id = 'wxWind';
    map.getContainer().appendChild(cv); WXP.cv = cv; WXP.ctx = cv.getContext('2d');
    map.on('movestart zoomstart', wxpClear); map.on('moveend zoomend resize', wxpResize);
  }
  wxpResize(); wxpField();
  if (!WXP.raf) WXP.raf = requestAnimationFrame(wxpStep);
}
function wxpOff() {
  if (WXP.raf) cancelAnimationFrame(WXP.raf); WXP.raf = 0;
  if (WXP.cv) { map.off('movestart zoomstart', wxpClear); map.off('moveend zoomend resize', wxpResize); WXP.cv.remove(); WXP.cv = null; WXP.ctx = null; }
}
function wxpClear() { if (WXP.ctx) WXP.ctx.clearRect(0, 0, WXP.cv.width, WXP.cv.height); WXP.moving = true; }
function wxpResize() {
  if (!WXP.cv) return;
  const r = map.getContainer().getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  WXP.cv.width = Math.round(r.width * dpr); WXP.cv.height = Math.round(r.height * dpr); WXP.dpr = dpr;
  WXP.moving = false;
  const want = Math.round(Math.min(900, r.width * r.height / 450));
  WXP.parts = Array.from({ length: want }, () => wxpSpawn({}));
}
function wxpStep(ts) {
  WXP.raf = 0;
  if (!WXP.cv || !WX.on || document.hidden) return;
  WXP.raf = requestAnimationFrame(wxpStep);
  if (WXP.moving || ts - WXP.last < 30) return;           // ~30 frames a second is plenty
  WXP.last = ts;
  wxpField();
  const x = WXP.ctx, dpr = WXP.dpr, W = WXP.cv.width, H = WXP.cv.height;
  x.globalCompositeOperation = 'destination-in'; x.fillStyle = 'rgba(0,0,0,0.9)'; x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'source-over'; x.lineWidth = 1.3 * dpr; x.lineCap = 'round';
  const dpp = 360 / (256 * Math.pow(2, map.getZoom())), f = 0.32 * dpp;   // a 10 m/s wind moves ~3 px a frame at any zoom
  x.beginPath();
  for (const p of WXP.parts) {
    if (p.lat !== p.lat || p.age++ > 90) { wxpSpawn(p); continue; }
    const uv = wxpWind(p.lat, p.lng);
    if (!uv) { wxpSpawn(p); continue; }
    const a = map.latLngToContainerPoint([p.lat, p.lng]);
    p.lat += uv[1] * f; p.lng += uv[0] * f / Math.cos(p.lat * Math.PI / 180);
    if (!wxpInside(p.lat, p.lng)) { wxpSpawn(p); continue; }
    const b = map.latLngToContainerPoint([p.lat, p.lng]);
    if (b.x < 0 || b.y < 0 || b.x > W / dpr || b.y > H / dpr) { wxpSpawn(p); continue; }
    x.moveTo(a.x * dpr, a.y * dpr); x.lineTo(b.x * dpr, b.y * dpr);
  }
  x.strokeStyle = 'rgba(248,250,252,.85)'; x.stroke();
}

/* ---------------- rain falling on the chosen area ---------------- */
// The chosen province / district / sub-district gets its outline, and rain falls inside it as heavily as the
// forecast says: drops and little splashes, thicker and faster for heavy rain, none when it stays dry.
const WXR = { cv: null, ctx: null, raf: 0, drops: [], path: null, box: null, rate: 0, size: 1, key: '', last: 0, moving: false };
function wxrRain() {
  const v = WX.sel && wxValues(WX.sel);
  if (!v) return { rate: 0, size: 1, txt: '' };
  if (WX.mode === 'h') {
    const r = (v.r || 0) / 10;                                  // mm in this hour
    return { rate: r <= 0 ? 0 : Math.min(1, 0.12 + r / 6), size: r >= 4 ? 1.5 : r >= 1 ? 1.2 : 0.9 };
  }
  const p = v.p != null ? v.p : (v.r ? Math.min(100, 30 + v.r / 2) : 0), mmDay = (v.r || 0) / 10;
  return { rate: p < 15 ? 0 : Math.min(1, p / 100 * (mmDay >= 5 ? 1 : 0.75)), size: mmDay >= 15 ? 1.5 : mmDay >= 3 ? 1.2 : 0.9 };
}
function wxrOn() {
  const n = WX.sel && WX.ar && WX.ar.byId[WX.sel];
  if (!WX.on || !WX.data || !n || !n.g || !(WX.tab === 'rain' || WX.tab === 'sky')) { wxrOff(); return; }
  const r = wxrRain();
  if (!WXR.cv) {
    const cv = document.createElement('canvas'); cv.id = 'wxRain'; map.getContainer().appendChild(cv);
    WXR.cv = cv; WXR.ctx = cv.getContext('2d');
    map.on('movestart zoomstart', wxrHide); map.on('moveend zoomend resize', wxrLayout);
  }
  WXR.rate = r.rate; WXR.size = r.size;
  if (WXR.key !== n.id) { WXR.key = n.id; wxrLayout(); }
  if (!WXR.raf) WXR.raf = requestAnimationFrame(wxrStep);
}
function wxrOff() {
  if (WXR.raf) cancelAnimationFrame(WXR.raf); WXR.raf = 0;
  if (WXR.cv) { map.off('movestart zoomstart', wxrHide); map.off('moveend zoomend resize', wxrLayout); WXR.cv.remove(); WXR.cv = null; WXR.ctx = null; WXR.key = ''; }
}
function wxrHide() { WXR.moving = true; if (WXR.ctx) WXR.ctx.clearRect(0, 0, WXR.cv.width, WXR.cv.height); }
/* the outline in screen pixels, redone after every move */
function wxrLayout() {
  if (!WXR.cv) return;
  const n = WX.ar.byId[WXR.key]; if (!n) return;
  const rc = map.getContainer().getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  WXR.cv.width = Math.round(rc.width * dpr); WXR.cv.height = Math.round(rc.height * dpr); WXR.dpr = dpr;
  const path = new Path2D(), polys = n.g.type === 'MultiPolygon' ? n.g.coordinates : [n.g.coordinates];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([lng, lat], i) => {
    const p = map.latLngToContainerPoint([lat, lng]), X = p.x * dpr, Y = p.y * dpr;
    if (i) path.lineTo(X, Y); else path.moveTo(X, Y);
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  })));
  WXR.path = path;
  WXR.box = [Math.max(0, x0), Math.max(0, y0), Math.min(WXR.cv.width, x1), Math.min(WXR.cv.height, y1)];
  WXR.drops = []; WXR.moving = false;
}
function wxrStep(ts) {
  WXR.raf = 0;
  if (!WXR.cv || !WX.on || document.hidden) return;
  WXR.raf = requestAnimationFrame(wxrStep);
  if (WXR.moving || !WXR.path || ts - WXR.last < 33) return;
  WXR.last = ts;
  const x = WXR.ctx, dpr = WXR.dpr, [bx0, by0, bx1, by1] = WXR.box, W = bx1 - bx0, H = by1 - by0;
  x.clearRect(0, 0, WXR.cv.width, WXR.cv.height);
  // the area itself: a soft blue wash and a bright outline
  x.save();
  x.fillStyle = WXR.rate > 0 ? 'rgba(56,189,248,' + (0.10 + WXR.rate * 0.18) + ')' : 'rgba(148,163,184,.10)'; x.fill(WXR.path, 'evenodd');
  x.setLineDash([7 * dpr, 5 * dpr]); x.lineWidth = 2.4 * dpr; x.strokeStyle = WXR.rate > 0 ? '#38bdf8' : '#cbd5e1'; x.stroke(WXR.path); x.setLineDash([]);
  if (WXR.rate > 0 && W > 4 && H > 4) {
    x.clip(WXR.path, 'evenodd');
    const want = Math.min(420, Math.round(W * H / (dpr * dpr) / 600 * WXR.rate) + 6);
    while (WXR.drops.length < want) WXR.drops.push(wxrDrop(bx0, by0, W, H, true));
    if (WXR.drops.length > want) WXR.drops.length = want;
    const sz = WXR.size * dpr;
    x.lineCap = 'round';
    for (const d of WXR.drops) {
      if (d.splash >= 0) {                                      // a little ring where it lands
        d.splash += 1;
        const a = 1 - d.splash / 9;
        x.strokeStyle = 'rgba(186,230,253,' + (a * 0.8) + ')'; x.lineWidth = 1.1 * dpr;
        x.beginPath(); x.ellipse(d.x, d.land, (2 + d.splash * 1.4) * sz, (0.8 + d.splash * 0.5) * sz, 0, 0, Math.PI * 2); x.stroke();
        if (d.splash > 8) Object.assign(d, wxrDrop(bx0, by0, W, H, false));
        continue;
      }
      d.y += d.v * sz;
      const len = (7 + d.v * 1.3) * sz;
      const g = x.createLinearGradient(d.x, d.y - len, d.x - len * 0.18, d.y);
      g.addColorStop(0, 'rgba(186,230,253,0)'); g.addColorStop(1, 'rgba(224,242,254,.95)');
      x.strokeStyle = g; x.lineWidth = 1.6 * sz;
      x.beginPath(); x.moveTo(d.x + len * 0.18, d.y - len); x.lineTo(d.x, d.y); x.stroke();
      if (d.y >= d.land) { d.splash = 0; d.y = d.land; }
    }
  }
  x.restore();
}
function wxrDrop(bx0, by0, W, H, scatter) {
  const land = by0 + Math.random() * H;
  return { x: bx0 + Math.random() * W, land, y: scatter ? land - Math.random() * H * 0.6 : land - 40 - Math.random() * Math.min(H, 260), v: 5 + Math.random() * 4, splash: -1 };
}
/* tapping inside an area on the map chooses it (provinces when far out, then districts, then sub-districts) */
map.on('click', (e) => {
  if (!WX.on || !WX.ar) return;
  const z = map.getZoom(), lat = e.latlng.lat, lng = e.latlng.lng;
  const want = z < 7.5 ? 1 : z < 9.3 ? 2 : 3;
  const chain = arHere(lat, lng); if (!chain.length) return;
  wxSelect(chain[Math.min(want, chain.length) - 1]);
});

/* ---------------- numbers on the map ---------------- */
function wxLabelText(v) {
  if (!v) return null;
  if (WX.tab === 'temp') return WX.mode === 'h' ? (v.t == null ? null : v.t + '°') : (v.tx == null ? null : v.tx + '°<small>/' + v.tn + '°</small>');
  if (WX.tab === 'wind') { const w = WX.mode === 'h' ? v.w : v.w; return w == null ? null : kmh(w) + (v.d != null ? '<i style="transform:rotate(' + (v.d + 180) + 'deg)">↑</i>' : ''); }
  if (WX.tab === 'sky') { const s = wxSym(v.s, v.night); return s[0]; }
  if (WX.mode === 'd' && v.p != null) return v.p + '%';
  if (v.r == null) return null;
  return v.r ? '💧' + mm(v.r) : (v.p != null && WX.mode === 'h' ? '<small>' + v.p + '%</small>' : '0');
}
function wxLabelColor(v) {
  if (!v) return null;
  let c = null;
  if (WX.tab === 'temp') c = wxColor('temp', WX.mode === 'h' ? v.t : v.tx);
  else if (WX.tab === 'wind') c = wxColor('wind', v.w == null ? null : v.w / 10);
  else if (WX.tab === 'rain') c = WX.mode === 'd' && v.p != null ? wxColor('rainP', v.p) : wxColor(WX.mode === 'd' ? 'rainD' : 'rainH', v.r == null ? null : v.r / 10);
  return c && c[3] > 0.2 ? 'rgba(' + c.slice(0, 3).map(Math.round).join(',') + ',.92)' : null;
}
function wxDrawLabels() {
  WX.labels.clearLayers();
  if (!WX.on || !WX.data || !WX.ar) return;
  const z = map.getZoom(), b = map.getBounds().pad(0.1);
  let nodes;
  if (z < 7.5) nodes = WX.ar.kids.iraq || [];
  else if (z < 9.3) nodes = Object.values(WX.ar.byId).filter((n) => n.k === 'd');
  else nodes = Object.values(WX.ar.byId).filter((n) => n.k === 's' || (n.k === 'd' && !(WX.ar.kids[n.id] || []).length));
  let count = 0;
  for (const n of nodes) {
    if (!n.c || !b.contains([n.c[1], n.c[0]])) continue;
    if (++count > 160) break;
    const v = wxValues(n.id), t = wxLabelText(v);
    if (t == null) continue;
    const bg = wxLabelColor(v), name = z >= 5.5 ? '<b>' + esc(arShort(n)) + '</b>' : '';
    const ic = L.divIcon({ className: 'wxLbl' + (n.id === WX.sel ? ' on' : ''), html: `<span${bg ? ' style="background:' + bg + '"' : ''}>${t}</span>${name}`, iconSize: null });
    L.marker([n.c[1], n.c[0]], { icon: ic, keyboard: false, zIndexOffset: 500 }).on('click', () => { wxSelect(n.id); }).addTo(WX.labels);
  }
}

/* ---------------- the sheet ---------------- */
function wxEnsure() {
  if ($('wxSheet')) return;
  const el = document.createElement('div'); el.id = 'wxSheet'; el.className = 'sheet hidden';
  el.innerHTML = `<div class="wxTop"><b>🌦 الطقس</b><span class="s" id="wxMade"></span><button class="iconBtn" id="wxClose" aria-label="إغلاق"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="wxTabs" id="wxTabs"><button data-tab="rain">🌧 المطر</button><button data-tab="wind">💨 الرياح</button><button data-tab="temp">🌡 الحرارة</button><button data-tab="sky">⛅ الحالة</button></div>
    <div class="wxTime"><div class="wxMode" id="wxMode"><button data-m="h">ساعة بساعة</button><button data-m="d">الأيام</button></div><button class="wxPlay" id="wxPlay" aria-label="تشغيل">▶</button></div>
    <div class="wxSlide"><input type="range" id="wxRange" min="0" max="47" step="1" dir="ltr"><div id="wxWhen"></div></div>
    <div class="wxLegend" id="wxLegend"></div>
    <div class="wxInfo" id="wxInfo"></div>
    <div class="wxBtns"><button class="chip" id="wxList">📋 كل المناطق</button><button class="chip" id="wxShare">📤 مشاركة</button><button class="chip" id="wxBell">🔔 التنبيهات</button></div>
    <div class="wxSrc" id="wxSrc"></div>`;
  document.body.appendChild(el);
  $('wxClose').onclick = closeWeather;
  $('wxTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; WX.tab = b.dataset.tab; store.set('wxTab', WX.tab); wxRender(); };
  $('wxMode').onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === WX.mode) return;
    const nowH = WX.mode === 'h' ? wxDayOfHour(WX.idx) : null;
    WX.mode = b.dataset.m; WX.idx = WX.mode === 'd' ? Math.min(WX.data.days - 1, nowH || 0) : wxNowIdx();
    wxStop(); wxRender();
  };
  $('wxRange').oninput = () => { WX.idx = +$('wxRange').value; wxStop(); wxRender(true); };
  $('wxPlay').onclick = () => (WX.play ? wxStop() : wxStart());
  $('wxList').onclick = () => openWxList();
  $('wxBell').onclick = () => wxAlertSettings();
  $('wxShare').onclick = () => wxShareCard();
}
function wxStart() {
  const n = WX.mode === 'h' ? WX.data.hours : WX.data.days;
  $('wxPlay').textContent = '⏸';
  WX.play = setInterval(() => { WX.idx = (WX.idx + 1) % n; wxRender(true); }, WX.mode === 'h' ? 650 : 1100);
}
function wxStop() { if (WX.play) clearInterval(WX.play); WX.play = null; if ($('wxPlay')) $('wxPlay').textContent = '▶'; }

async function openWeather(areaId) {
  wxEnsure();
  document.querySelectorAll('.panel:not(.hidden)').forEach((p) => p.classList.add('hidden'));
  $('layerMenu').classList.add('hidden');
  WX.on = true; document.body.classList.add('ui-wx'); $('wxSheet').classList.remove('hidden');
  $('wxInfo').innerHTML = '<div class="s">جارٍ تحميل النشرة…</div>';
  wxAskNotify();
  try {
    await Promise.all([wxLoad(), arLoad().then((a) => { WX.ar = a; })]);
  } catch (e) {
    $('wxInfo').innerHTML = '<div class="s">تعذّر تحميل نشرة الطقس — تحقق من الإنترنت</div>'; return;
  }
  if (!WX.on) return;
  if (areaId) WX.sel = areaId;
  else if (!WX.sel) { const here = me ? arHere(me.lat, me.lng) : []; WX.sel = here[here.length - 1] || null; }
  if (WX.mode === 'h' && !WX.play) WX.idx = wxNowIdx();
  WX.labels.addTo(map);
  if (areaId && WX.ar.byId[areaId] && WX.ar.byId[areaId].c) map.flyTo([WX.ar.byId[areaId].c[1], WX.ar.byId[areaId].c[0]], Math.max(map.getZoom(), 9));
  else if (!me || map.getZoom() > 9) { const z = Math.min(map.getZoom(), 7); if (!map.getBounds().intersects([[29, 38.8], [37.4, 48.8]]) || map.getZoom() > 9) map.flyTo(me ? [me.lat, me.lng] : [33.2, 43.8], me ? 8 : 6); }
  wxRender();
  wxLoad(true).then(() => { if (WX.on) wxRender(); }).catch(() => {});
}
function closeWeather() {
  WX.on = false; wxStop(); wxpOff(); wxrOff();
  document.body.classList.remove('ui-wx');
  if ($('wxSheet')) $('wxSheet').classList.add('hidden');
  if (WX.overlay) { map.removeLayer(WX.overlay); WX.overlay = null; }
  map.removeLayer(WX.labels);
}
window.wxHandleBack = () => {
  if ($('wxBellBox')) { $('wxBellBox').remove(); return true; }
  if ($('wxAlertBar') && !$('wxAlertBar').classList.contains('hidden')) { $('wxAlertBar').classList.add('hidden'); return true; }
  if ($('wxListPanel') && !$('wxListPanel').classList.contains('hidden')) { $('wxListPanel').classList.add('hidden'); return true; }
  if (WX.on) { closeWeather(); return true; }
  return false;
};
function wxRender(fast) {
  if (!WX.on || !WX.data) return;
  const D = WX.data, n = WX.mode === 'h' ? D.hours : D.days;
  WX.idx = Math.max(0, Math.min(n - 1, WX.idx));
  document.querySelectorAll('#wxTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === WX.tab));
  document.querySelectorAll('#wxMode [data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === WX.mode));
  const r = $('wxRange'); r.max = n - 1; r.value = WX.idx;
  $('wxWhen').textContent = wxTimeLabel(WX.idx);
  const age = Math.round((Date.now() - Date.parse(D.made)) / 60e3);
  $('wxMade').textContent = 'حُدّثت ' + (age < 60 ? 'قبل ' + Math.max(1, age) + ' د' : age < 1440 ? 'قبل ' + Math.round(age / 60) + ' س' : 'قبل ' + Math.round(age / 1440) + ' يوم');
  $('wxSrc').textContent = D.src + (wxHasChance() ? ' · احتمالات المطر: ECMWF' : '');
  // the picture
  if (WX.tab === 'sky' && WX.mode === 'd') { if (WX.overlay) { map.removeLayer(WX.overlay); WX.overlay = null; } }
  else {
    const f = wxFrame();
    if (!WX.overlay) WX.overlay = L.imageOverlay(f.url, f.bounds, { opacity: 0.85, interactive: false, className: 'wxImg' }).addTo(map);
    else WX.overlay.setUrl(f.url);
  }
  // legend
  const rm = wxRampFor();
  $('wxLegend').innerHTML = WX.tab === 'sky' ? '<span class="s">رموز الحالة على الخريطة، والمطر بالأزرق</span>'
    : `<div class="bar" style="background:linear-gradient(to left,${WX_RAMP[rm.ramp].map((s) => 'rgba(' + s.slice(1, 4).join(',') + ',' + Math.max(0.25, s[4]) + ')').join(',')})"></div><div class="ticks">${rm.ticks.map((t) => '<span>' + t[1] + '</span>').join('')}</div><span class="s">${rm.unit}</span>`;
  wxRenderInfo();
  wxDrawLabels();
  wxpOn(); wxrOn();
}
function wxLine(v, full) {
  if (!v) return '<span class="s">لا توجد بيانات لهذه المنطقة</span>';
  const parts = [];
  if (WX.mode === 'h') {
    const s = wxSym(v.s, v.night);
    parts.push(`<span class="big">${s[0]}</span> ${s[1]}`);
    if (v.t != null) parts.push(`🌡 <b>${v.t}°</b>`);
    parts.push(`🌧 ${v.r ? '<b>' + mm(v.r) + '</b> ملم/س' : 'لا مطر'}${v.p != null ? ' · احتمال اليوم <b>' + v.p + '%</b>' : ''}`);
    if (v.w != null) parts.push(`💨 <b>${kmh(v.w)}</b> كم/س${v.d != null ? ' ' + wxDirName(v.d) : ''}`);
  } else {
    const s = wxSym(v.s);
    parts.push(`<span class="big">${s[0]}</span> ${s[1]}`);
    if (v.tx != null) parts.push(`🌡 <b>${v.tx}°</b> / ${v.tn}°`);
    parts.push(`🌧 ${v.p != null ? 'احتمال <b>' + v.p + '%</b>' : ''}${v.r != null ? (v.p != null ? ' · ' : '') + (v.r ? '<b>' + mm(v.r) + '</b> ملم' : 'لا مطر') : ''}`);
    if (v.w != null) parts.push(`💨 حتى <b>${kmh(v.w)}</b> كم/س`);
    if (full && v.g15 != null && v.g15 >= 30) parts.push(`🌪 احتمال هبّات قوية ${v.g15}%`);
  }
  return parts.map((p) => '<span class="wxP">' + p + '</span>').join('');
}
function wxRenderInfo() {
  const n = WX.sel && WX.ar && WX.ar.byId[WX.sel];
  if (!n) { $('wxInfo').innerHTML = '<div class="s">اضغط رقمًا على الخريطة أو «كل المناطق» لترى تفاصيل منطقة</div>'; return; }
  const fol = wxCfg.follow.includes(n.id);
  $('wxInfo').innerHTML = `<div class="wxName"><b>${esc(arTitle(n))}</b>${n.k !== 'p' && n.up && WX.ar.byId[n.up] ? '<span class="s"> — ' + esc(arShort(WX.ar.byId[n.up])) + '</span>' : ''}<button class="wxFol${fol ? ' on' : ''}" id="wxFol" title="متابعة">${fol ? '⭐ متابَعة' : '☆ متابعة'}</button></div><div class="wxVals">${wxLine(wxValues(n.id), true)}</div>${wxWeekHtml(n.id)}${n.c && typeof sunMoonLine === 'function' ? '<div class="wxSun">' + sunMoonLine(n.c[1], n.c[0]) + '</div>' : ''}`;
  $('wxFol').onclick = () => wxToggleFollow(n.id);
  $('wxInfo').querySelectorAll('[data-wd]').forEach((b) => { b.onclick = () => { wxStop(); WX.mode = 'd'; WX.idx = +b.dataset.wd; wxRender(); }; });
}
/* the week in one row: tap a day to see it on the map */
function wxWeekDays(id) {
  const keep = [WX.mode, WX.idx], out = [];
  WX.mode = 'd';
  for (let i = 0; i < WX.data.days; i++) { WX.idx = i; out.push(wxValues(id)); }
  [WX.mode, WX.idx] = keep;
  return out;
}
function wxWeekHtml(id) {
  const days = wxWeekDays(id);
  if (!days.some(Boolean)) return '';
  return '<div class="wxWeek">' + days.map((v, i) => !v ? '' : `<button data-wd="${i}" class="${WX.mode === 'd' && WX.idx === i ? 'on' : ''}"><small>${wxDayLabel(i, true)}</small><span>${wxSym(v.s)[0]}</span><b>${v.tx != null ? v.tx + '°' : '—'}</b><small>${v.tn != null ? v.tn + '°' : ''}</small>${v.p != null && v.p >= 20 ? '<i>💧' + v.p + '%</i>' : ''}</button>`).join('') + '</div>';
}
/* a picture of the forecast to send in WhatsApp */
async function wxShareCard() {
  const n = WX.sel && WX.ar && WX.ar.byId[WX.sel];
  if (!n) { toast('اختر منطقة أولًا'); return; }
  const days = wxWeekDays(n.id).slice(0, 5), W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0c4a6e'); g.addColorStop(0.55, '#0b1f3a'); g.addColorStop(1, '#07111f');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.direction = 'rtl'; x.textAlign = 'center';
  const font = (w, s) => { x.font = w + ' ' + s + 'px Plex, system-ui, sans-serif'; };
  x.fillStyle = '#bae6fd'; font('600', 40); x.fillText('🌦 الطقس', W / 2, 110);
  x.fillStyle = '#ffffff'; font('800', 70); x.fillText(arTitle(n), W / 2, 200);
  const today = days[0] || {};
  // now: the current hour (sky and temperature); then today's range and chance of rain
  const keep = [WX.mode, WX.idx]; WX.mode = 'h'; WX.idx = wxNowIdx(); const now = wxValues(n.id) || {}; [WX.mode, WX.idx] = keep;
  const sNow = wxSym(now.s != null && now.s >= 0 ? now.s : today.s, now.night);
  font('400', 190); x.fillText(sNow[0], W / 2, 430);
  font('800', 120); x.fillText((now.t != null ? now.t : today.tx != null ? today.tx : '—') + '°', W / 2, 590);
  x.fillStyle = '#e0f2fe'; font('600', 46); x.fillText('الآن: ' + sNow[1], W / 2, 665);
  x.fillStyle = '#cbd5e1'; font('500', 38);
  x.fillText('اليوم: العظمى ' + (today.tx != null ? today.tx : '—') + '° · الصغرى ' + (today.tn != null ? today.tn : '—') + '°' + (today.p != null ? ' · المطر ' + today.p + '%' : ''), W / 2, 730);
  if (today.w != null) x.fillText('💨 الرياح حتى ' + kmh(today.w) + ' كم/س', W / 2, 785);
  // the next days
  const cw = (W - 120) / 4;
  days.slice(1, 5).forEach((v, k) => {
    const cx = W - 60 - cw * k - cw / 2, y = 850;
    x.fillStyle = 'rgba(255,255,255,.07)'; x.beginPath(); x.roundRect ? x.roundRect(cx - cw / 2 + 10, y, cw - 20, 300, 28) : x.rect(cx - cw / 2 + 10, y, cw - 20, 300); x.fill();
    if (!v) return;
    x.fillStyle = '#bae6fd'; font('700', 38); x.fillText(wxDayLabel(k + 1, true), cx, y + 60);
    font('400', 80); x.fillText(wxSym(v.s)[0], cx, y + 160);
    x.fillStyle = '#fff'; font('800', 48); x.fillText((v.tx != null ? v.tx : '—') + '°', cx, y + 230);
    x.fillStyle = '#94a3b8'; font('600', 34); x.fillText((v.tn != null ? v.tn : '—') + '°' + (v.p != null && v.p >= 20 ? '  💧' + v.p + '%' : ''), cx, y + 276);
  });
  // signature
  if (location.protocol !== 'file:') try {
    const logo = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'icon-192.png'; });
    x.drawImage(logo, W / 2 + 120, H - 150, 80, 80);
  } catch (e) {}
  x.fillStyle = '#e0f2fe'; font('800', 46); x.fillText('الملاح', W / 2 - 10, H - 95);
  x.fillStyle = '#94a3b8'; font('500', 28); x.direction = 'ltr'; x.fillText('mustafasami446-star.github.io/mallah/get', W / 2, H - 45);
  const data = c.toDataURL('image/jpeg', 0.9), text = '🌦 طقس ' + arTitle(n) + ' — من تطبيق الملاح:\nhttps://mustafasami446-star.github.io/mallah/get/';
  if (NATIVE && Android.shareImage) { if (!Android.shareImage(data.split(',')[1], 'mallah-weather.jpg', text)) toast('تعذّرت المشاركة'); return; }
  try {
    const blob = await (await fetch(data)).blob(), file = new File([blob], 'mallah-weather.jpg', { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mallah-weather.jpg'; a.click(); toast('✓ حُفظت الصورة في التنزيلات');
  } catch (e) {}
}
function wxSelect(id) { WX.sel = id; wxRenderInfo(); wxDrawLabels(); wxrOn(); }
function wxToggleFollow(id) {
  const i = wxCfg.follow.indexOf(id);
  if (i >= 0) wxCfg.follow.splice(i, 1); else { if (wxCfg.follow.length >= 20) { toast('يمكن متابعة 20 منطقة كحد أقصى'); return; } wxCfg.follow.push(id); wxCfg.alerts = true; toast('⭐ ستصلك تنبيهات الطقس لهذه المنطقة'); }
  wxSaveCfg(); wxRenderInfo();
}
map.on('moveend', () => { if (WX.on) wxDrawLabels(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && WX.on) { wxpOn(); wxrOn(); } });

/* ---------------- every area in a list ---------------- */
let wxListPath = [];
function openWxList() {
  if (!$('wxListPanel')) {
    const el = document.createElement('div'); el.id = 'wxListPanel'; el.className = 'panel hidden';
    el.innerHTML = `<div class="panelHead"><button class="iconBtn" id="wxListClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button><h2>🌦 طقس المناطق</h2></div>
      <div class="panelBody"><div id="wxCrumbs"></div><div class="s" id="wxListWhen" style="padding:2px 14px 8px"></div><div class="card"><div id="wxRows"></div></div><div class="note" id="wxListSrc"></div></div>`;
    document.body.appendChild(el);
    $('wxListClose').onclick = () => el.classList.add('hidden');
  }
  wxStop();
  $('wxListPanel').classList.remove('hidden');
  if (!wxListPath.length && WX.sel && WX.ar.byId[WX.sel]) {
    const chain = []; let n = WX.ar.byId[WX.ar.byId[WX.sel].up];
    while (n && n.id !== 'iraq') { chain.unshift(n.id); n = WX.ar.byId[n.up]; }
    wxListPath = chain;
  }
  wxRenderList();
}
function wxRenderList() {
  const cur = wxListPath.length ? WX.ar.byId[wxListPath[wxListPath.length - 1]] : WX.ar.byId.iraq;
  const crumbs = [WX.ar.byId.iraq].concat(wxListPath.map((id) => WX.ar.byId[id]));
  $('wxCrumbs').innerHTML = crumbs.map((n, i) => i === crumbs.length - 1 ? `<b>${esc(arShort(n))}</b>` : `<button data-up="${i}">${esc(arShort(n))}</button><span class="sep">‹</span>`).join('');
  $('wxCrumbs').querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => { wxListPath = wxListPath.slice(0, +b.dataset.up); wxRenderList(); }; });
  $('wxListWhen').textContent = '⏱ ' + wxTimeLabel(WX.idx) + ' — غيّر الوقت من شريط الطقس';
  $('wxListSrc').textContent = WX.data.src;
  const kids = (WX.ar.kids[cur.id] || []);
  $('wxRows').innerHTML = kids.map((n) => {
    const sub = (WX.ar.kids[n.id] || []).length, fol = wxCfg.follow.includes(n.id);
    return `<div class="res wxRow" data-id="${n.id}"><div style="flex:1;min-width:0"><div class="t">${fol ? '⭐ ' : ''}${esc(arTitle(n))}</div><div class="wxVals sm">${wxLine(wxValues(n.id))}</div></div>
      <button class="chip" data-show="${n.id}">🗺</button>${sub ? '<button class="chip" data-in="' + n.id + '">‹ ' + sub + '</button>' : ''}</div>`;
  }).join('') || '<div class="item"><div class="grow s">لا توجد مناطق أصغر</div></div>';
  $('wxRows').querySelectorAll('[data-in]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); wxListPath.push(b.dataset.in); wxRenderList(); $('wxListPanel').querySelector('.panelBody').scrollTop = 0; }; });
  $('wxRows').querySelectorAll('[data-show]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation(); const n = WX.ar.byId[b.dataset.show];
      $('wxListPanel').classList.add('hidden'); wxSelect(n.id);
      if (n.b) map.flyToBounds([[n.b[1], n.b[0]], [n.b[3], n.b[2]]], { padding: [30, 30], maxZoom: 10 });
    };
  });
  $('wxRows').querySelectorAll('.wxRow').forEach((r) => { r.onclick = () => { const id = r.dataset.id; if ((WX.ar.kids[id] || []).length) { wxListPath.push(id); wxRenderList(); } else { $('wxListPanel').classList.add('hidden'); wxSelect(id); const n = WX.ar.byId[id]; if (n.c) map.flyTo([n.c[1], n.c[0]], Math.max(map.getZoom(), 10)); } }; });
}

/* ---------------- warnings ---------------- */
const WX_ALERT = {
  rain: (v) => '🌧 ' + (v < 0 ? 'احتمال أمطار غزيرة ' + (-v) + '%' : 'أمطار غزيرة متوقعة (نحو ' + v + ' ملم)'),
  wind: (v) => '💨 ' + (v < 0 ? 'احتمال رياح قوية ' + (-v) + '%' : 'رياح قوية نحو ' + v + ' كم/س') + ' — قد تثير الغبار',
  storm: () => '⛈ عواصف رعدية متوقعة',
  heat: (v) => '🔥 حر شديد — العظمى ' + v + '°',
  frost: (v) => '❄️ صقيع — الصغرى ' + v + '°'
};
function wxWhenText(t) {
  if (/^\d{4}-\d\d-\d\d$/.test(t)) {
    const d = Math.floor(Date.parse(t + 'T00:00:00Z') / 86400e3) - Math.floor((Date.now() + 3 * 3600e3) / 86400e3);
    return d <= 0 ? 'اليوم' : d === 1 ? 'غدًا' : WX_DAYS[new Date(Date.parse(t + 'T00:00:00Z')).getUTCDay()];
  }
  const ms = Date.parse(t.replace('Z', ':00Z')); if (ms <= Date.now()) return 'الآن';
  const h = iqDate(ms).getUTCHours(), d = Math.floor((ms + 3 * 3600e3) / 86400e3) - Math.floor((Date.now() + 3 * 3600e3) / 86400e3);
  return (d <= 0 ? 'اليوم' : d === 1 ? 'غدًا' : WX_DAYS[iqDate(ms).getUTCDay()]) + ' ' + (h % 12 || 12) + (h < 12 ? ' ص' : ' م');
}
function wxWatchIds() {
  const ids = new Set(wxCfg.follow);
  const mine = store.get('wxMine', null); if (mine) mine.forEach((id) => ids.add(id));
  if (WX.ar) wxCfg.follow.forEach((id) => (WX.ar.kids[id] || []).forEach((k) => ids.add(k.id)));   // following a district covers its sub-districts
  return [...ids];
}
async function wxCheckAlerts() {
  if (!wxCfg.alerts) return;
  let A; try { const r = await fetch(WX_BASE + 'alerts.json?t=' + Math.floor(Date.now() / 600e3), { cache: 'no-cache' }); A = await r.json(); } catch (e) { return; }
  const ids = new Set(wxWatchIds()); if (!ids.size || !A || !A.alerts) return;
  const seen = store.get('wxSeen', []);
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const live = (t) => (t.length > 10 ? Date.parse(t.replace('Z', ':00Z')) > Date.now() - 3 * 3600e3 : t >= today);   // not already over
  const hit = A.alerts.filter((a) => ids.has(a.a) && live(a.t) && !seen.includes(a.a + a.k + a.t));
  if (!hit.length) return;
  store.set('wxSeen', seen.concat(hit.map((a) => a.a + a.k + a.t)).slice(-300));
  try { await arLoad().then((a) => { WX.ar = a; }); } catch (e) {}
  const name = (id) => (WX.ar && WX.ar.byId[id] ? arTitle(WX.ar.byId[id]) : '');
  const a = hit[0];
  wxBanner(`<b>تنبيه طقس — ${esc(name(a.a))}</b><div>${WX_ALERT[a.k] ? WX_ALERT[a.k](a.v) : ''} · ${wxWhenText(a.t)}</div>${hit.length > 1 ? '<div class="s">' + (hit.length === 2 ? 'وتنبيه آخر' : 'و' + (hit.length - 1) + ' تنبيهات أخرى') + ' — اضغط للتفاصيل</div>' : ''}`, a.a);
}
function wxBanner(html, areaId) {
  let b = $('wxAlertBar');
  if (!b) { b = document.createElement('div'); b.id = 'wxAlertBar'; document.body.appendChild(b); }
  b.innerHTML = `<div class="g">${html}</div><button class="x" aria-label="إغلاق">✕</button>`;
  b.classList.remove('hidden');
  b.querySelector('.g').onclick = () => { b.classList.add('hidden'); openWeather(areaId); };
  b.querySelector('.x').onclick = () => b.classList.add('hidden');
  try { Android.vibrate && Android.vibrate('80,60,80'); } catch (e) {}
}
/* the sub-district where the phone is, for "my area" warnings */
let wxMineAt = null;
function wxUpdateMine() {
  if (!wxCfg.alerts || !me || !window.AREAS) return;
  if (wxMineAt && Math.abs(wxMineAt[0] - me.lat) < 0.03 && Math.abs(wxMineAt[1] - me.lng) < 0.03) return;
  wxMineAt = [me.lat, me.lng];
  arLoad().then((a) => {
    WX.ar = a;
    const here = arHere(me.lat, me.lng).filter((id) => !id.startsWith('p:'));
    const old = JSON.stringify(store.get('wxMine', null));
    if (here.length && JSON.stringify(here) !== old) { store.set('wxMine', here); wxNative(); }
  }).catch(() => {});
}
/* Android: the phone checks the warnings by itself every two hours, even with the app closed */
function wxNative() {
  if (!(NATIVE && Android.wxConfig)) return;
  const ids = wxWatchIds(), names = {};
  if (WX.ar || window.AREAS) ids.forEach((id) => { const n = WX.ar && WX.ar.byId[id]; if (n) names[id] = arTitle(n); });
  try { Android.wxConfig(JSON.stringify({ on: !!wxCfg.alerts && ids.length > 0, ids, names, url: WX_BASE + 'alerts.json' })); } catch (e) {}
}
function wxAskNotify() {
  if (store.get('wxAsked', false) || !wxCfg.alerts) return;
  store.set('wxAsked', true);
  try { if (NATIVE && Android.wxPerms) Android.wxPerms(); } catch (e) {}
}
function wxAlertSettings() {
  const fol = wxCfg.follow.map((id) => WX.ar && WX.ar.byId[id]).filter(Boolean);
  const mine = (store.get('wxMine', null) || []).map((id) => WX.ar && WX.ar.byId[id]).filter(Boolean);
  const el = document.createElement('div'); el.id = 'wxBellBox'; el.className = 'wxModal';
  el.innerHTML = `<div class="card"><h3>🔔 تنبيهات الطقس</h3>
    <label class="wxSw"><input type="checkbox" id="wxAl" ${wxCfg.alerts ? 'checked' : ''}> تنبيهي بالأمطار الغزيرة والرياح القوية والعواصف والحر الشديد والصقيع</label>
    <div class="s" style="padding:4px 14px">${NATIVE ? 'يفحص الهاتف التنبيهات كل ساعتين حتى والبرنامج مغلق، ويرسل إشعارًا.' : 'في نسخة الويب تظهر التنبيهات عند فتح الملاح.'}</div>
    <div class="s" style="padding:8px 14px 2px"><b>📍 منطقتي (حسب موقعي):</b> ${mine.length ? mine.map((n) => esc(arShort(n))).join(' ← ') : 'غير معروفة بعد — شغّل الموقع'}</div>
    <div class="s" style="padding:8px 14px 2px"><b>⭐ مناطق أتابعها:</b></div>
    <div id="wxFolList">${fol.map((n) => `<div class="res"><div style="flex:1" class="t">${esc(arTitle(n))}</div><button class="chip" data-rm="${n.id}">إزالة</button></div>`).join('') || '<div class="s" style="padding:2px 14px 8px">لا شيء بعد — اضغط «☆ متابعة» عند أي منطقة</div>'}</div>
    <div class="btnRow" style="padding:10px 14px 14px"><button class="chip go" id="wxBellOk">تم</button></div></div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.onclick = (e) => { if (e.target === el) close(); };
  $('wxBellOk').onclick = close;
  $('wxAl').onchange = () => { wxCfg.alerts = $('wxAl').checked; wxSaveCfg(); if (wxCfg.alerts) { store.set('wxAsked', false); wxAskNotify(); wxUpdateMine(); } };
  el.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { wxToggleFollow(b.dataset.rm); b.closest('.res').remove(); }; });
}

/* ---------------- the button, and starting up ---------------- */
{ const b = $('wxBtn'); if (b) b.onclick = () => (WX.on ? closeWeather() : openWeather()); }
window.openWeather = openWeather;
setTimeout(() => { wxCheckAlerts(); wxNative(); }, 6000);
setInterval(() => { wxCheckAlerts(); if (WX.on) wxLoad().then(() => wxRender()).catch(() => {}); }, 30 * 60e3);
setInterval(wxUpdateMine, 60e3);
setTimeout(() => { if (wxCfg.alerts && me) arLoad().then(wxUpdateMine).catch(() => {}); }, 15000);
try { const w = NATIVE && Android.takeWxLaunch ? Android.takeWxLaunch() : null; if (w != null) setTimeout(() => openWeather(w || undefined), 600); } catch (e) {}
