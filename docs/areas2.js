'use strict';
/* الملاح — «استكشف المناطق»، الإضافات: القمر الصناعي، الطقس على المناطق، الخدمات في كل منطقة، المساحة والمسافة،
   الطرق الرئيسية، البحث داخل الخريطة، المقارنة، مواقعك، التصدير، وتنزيل شوارع المنطقة. */

const AX = {
  sat: store.get('axSat', false), roads: store.get('axRoads', true), mine: store.get('axMine', true), wx: store.get('axWx', ''),
  svc: null,             // the service kind shown as dots (mosque, school…)
  satKey: '', roadsFor: {}, cmp: null, statCache: {}, sizeCache: {}
};
const AX_SVC = [['mosque', '🕌', 'جوامع'], ['school', '🏫', 'مدارس'], ['hospital', '🏥', 'مستشفيات'], ['clinic', '🩺', 'مستوصفات'], ['fuel', '⛽', 'محطات وقود'],
  ['marketplace', '🛒', 'أسواق'], ['pharmacy', '💊', 'صيدليات'], ['bank', '🏦', 'مصارف'], ['police', '👮', 'شرطة'], ['university', '🎓', 'جامعات وكليات']];
const axSvcKind = (k) => (k === 'college' ? 'university' : k === 'supermarket' || k === 'mall' ? 'marketplace' : k);

/* ---------------- units ⇄ lat/lng on the areas map ---------------- */
const axLL = (x, y) => [AZ.geo.n - y / AZ.geo.sc, x / (AZ.geo.kx * AZ.geo.sc) + AZ.geo.w];
const axXY = (lat, lng) => [(lng - AZ.geo.w) * AZ.geo.kx * AZ.geo.sc, (AZ.geo.n - lat) * AZ.geo.sc];

/* ---------------- 1. satellite under the borders ---------------- */
function axSatDraw(X) {
  const g = $('azSat'); if (!g) return;
  $('areaSvg').classList.toggle('axSat', AX.sat);
  if (!AX.sat) { if (g.innerHTML) g.innerHTML = ''; AX.satKey = ''; return; }
  const cs = azCorners(X, AZ_OVER * 0.7).map((u) => axLL(u[0], u[1]));
  const S = Math.min(...cs.map((c) => c[0])), N = Math.max(...cs.map((c) => c[0])), W = Math.min(...cs.map((c) => c[1])), E = Math.max(...cs.map((c) => c[1]));
  // device pixels per degree of longitude: sharp on high-density screens
  const ppd = X.k * AZ.geo.kx * AZ.geo.sc * Math.min(2, window.devicePixelRatio || 1);
  let z = Math.max(4, Math.min(19, Math.ceil(Math.log2(360 * ppd / 256) - 0.25)));
  const tx = (lng, zz) => Math.floor((lng + 180) / 360 * 2 ** zz);
  const ty = (lat, zz) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** zz); };
  while (z > 4 && (tx(E, z) - tx(W, z) + 1) * (ty(S, z) - ty(N, z) + 1) > 150) z--;
  const x0 = tx(W, z), x1 = tx(E, z), y0 = ty(N, z), y1 = ty(S, z);
  const key = [z, x0, x1, y0, y1].join(',');
  if (key === AX.satKey && g.querySelector('image')) return;
  AX.satKey = key;
  const lon = (x) => x / 2 ** z * 360 - 180, lat = (y) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
  // the new pictures go on top of the old ones, which stay until the new ones have come (no blank flash while zooming)
  const NS = 'http://www.w3.org/2000/svg', layer = document.createElementNS(NS, 'g');
  let left = 0;
  // when this set has come, the older ones under it go — and a set already replaced by a newer one does nothing
  // (before, a replaced set finishing late removed everything, newer pictures included: the map went blank)
  const done = () => { if (--left > 0 || layer.parentNode !== g) return; let c; while ((c = layer.previousSibling)) c.remove(); };
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const [ax, ay] = axXY(lat(y), lon(x)), [bx, by] = axXY(lat(y + 1), lon(x + 1));
    const im = document.createElementNS(NS, 'image');
    im.setAttribute('href', `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
    im.setAttribute('x', ax.toFixed(3)); im.setAttribute('y', ay.toFixed(3));
    im.setAttribute('width', (bx - ax).toFixed(3)); im.setAttribute('height', (by - ay).toFixed(3));
    im.setAttribute('preserveAspectRatio', 'none');
    left++; im.addEventListener('load', done); im.addEventListener('error', done);
    layer.appendChild(im);
  }
  while (g.children.length > 1) g.firstChild.remove();       // at most the last set under the new one
  g.appendChild(layer);
  setTimeout(() => { left = 0; done(); }, 12000);
}

/* ---------------- 2. weather on the areas ---------------- */
function axWxFill() {
  const svg = $('areaSvg'); if (!svg) return;
  svg.classList.toggle('axWxOn', !!AX.wx);
  svg.querySelectorAll('path.pv').forEach((p) => {
    p.style.fill = '';
    if (!AX.wx || !WX.data) return;
    const v = wxValues(p.dataset.ar); if (!v) return;
    let c = null;
    if (AX.wx === 'temp') c = wxColor('temp', v.t != null ? v.t : v.tx);
    else if (AX.wx === 'dust') c = wxColor('dust', v.u);
    else c = v.p != null ? wxColor('rainP', v.p) : wxColor('rainH', v.r);
    if (c) p.style.fill = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0.35, c[3])})`;
  });
}
async function axWxToggle() {
  const hasDust = () => !!(WX.data && WX.data.grid.h.u && WX.data.grid.h.u.some((r) => r && r.some((x) => x != null)));
  AX.wx = { '': 'temp', temp: 'rain', rain: 'dust', dust: '' }[AX.wx]; store.set('axWx', AX.wx);
  if (AX.wx && !WX.data) {
    toast('🌦 جارٍ تحميل الطقس…', 2000);
    try { WX.mode = 'h'; await Promise.all([wxLoad(), arLoad().then((a) => { WX.ar = a; })]); WX.idx = wxNowIdx(); } catch (e) { toast('تعذّر تحميل الطقس'); AX.wx = ''; }
  }
  if (WX.data && WX.mode === 'h') WX.idx = wxNowIdx();
  if (AX.wx === 'dust' && !hasDust()) { AX.wx = ''; store.set('axWx', ''); }
  toast(AX.wx === 'dust' ? '🌫 المناطق ملوّنة بالغبار الآن' : AX.wx === 'temp' ? '🌡 المناطق ملوّنة بالحرارة الآن' : AX.wx === 'rain' ? '🌧 المناطق ملوّنة باحتمال المطر اليوم' : 'أوقفتَ تلوين الطقس', 2500);
  arRender();
}
function axWxLine(n) {
  if (!AX.wx || !WX.data) return '';
  const v = wxValues(n.id); if (!v) return '';
  return '<div class="s axLine">' + wxLine(v, false) + '</div>';
}

/* ---------------- 3. services in an area ---------------- */
function axStats(n) {
  if (AX.statCache[n.id] && AX.statCache[n.id].pl === places) return AX.statCache[n.id].c;
  const c = {};
  if (typeof places !== 'undefined' && places) placesIn(n).forEach((p) => { const k = axSvcKind(p.k); if (AX_SVC.some((s) => s[0] === k)) c[k] = (c[k] || 0) + 1; });
  AX.statCache[n.id] = { pl: typeof places !== 'undefined' ? places : null, c };
  return c;
}
function axSvcPts(n) {
  if (!AX.svc || typeof places === 'undefined' || !places) return [];
  return placesIn(n).filter((p) => axSvcKind(p.k) === AX.svc);
}

/* ---------------- 4. size and distance ---------------- */
function axKm2(n) {
  if (AX.sizeCache[n.id] != null) return AX.sizeCache[n.id];
  if (!n.g) return 0;
  const polys = n.g.type === 'MultiPolygon' ? n.g.coordinates : [n.g.coordinates];
  let a = 0;
  polys.forEach((poly) => poly.forEach((ring, i) => {
    let s = 0; const k = Math.cos(ring[0][1] * Math.PI / 180) * 111.32;
    for (let j = 0; j < ring.length - 1; j++) s += ring[j][0] * k * ring[j + 1][1] * 110.54 - ring[j + 1][0] * k * ring[j][1] * 110.54;
    a += (i ? -1 : 1) * Math.abs(s) / 2;
  }));
  return (AX.sizeCache[n.id] = Math.max(0, a));
}
const axFmtKm2 = (a) => a >= 100 ? Math.round(a).toLocaleString('en') + ' كم²' : a.toFixed(a >= 10 ? 0 : 1) + ' كم²';
async function axDist(n) {
  const el = $('axDist'); if (!el || !me || !n.c) return;
  const d = hav([me.lat, me.lng], [n.c[1], n.c[0]]);
  if (inArea(n, me.lat, me.lng)) { el.textContent = '📍 أنت داخلها'; return; }
  el.textContent = '📏 ' + fmtDist(d) + ' عن موقعك (خط مستقيم)';
  if (typeof roadsReady === 'function' && roadsReady() && d < 700000) {
    try {
      const r = await offlineRoute('car', [me.lat, me.lng], [n.c[1], n.c[0]]);
      if ($('axDist') === el) el.textContent = '🚗 ' + fmtDist(r.total) + ' بالسيارة · ' + fmtDur(r.duration) + ' إلى مركزها';
    } catch (e) {}
  }
}

/* ---------------- 5. main roads ---------------- */
async function axRoadsLoad(cur) {
  if (!AX.roads || AX.roadsFor[cur.id] || typeof roadsMainIn !== 'function' || !roadsReady()) return;
  AX.roadsFor[cur.id] = 'loading';
  const shapes = arKids(cur.id).length ? arKids(cur.id) : [cur];
  let w = 180, e = -180, s = 90, n = -90;
  shapes.forEach((k) => { w = Math.min(w, k.b[0]); s = Math.min(s, k.b[1]); e = Math.max(e, k.b[2]); n = Math.max(n, k.b[3]); });
  const list = await roadsMainIn(s, w, n, e);
  AX.roadsFor[cur.id] = list || [];
  if (AZ && AZ.id === cur.id) { AZ.roadsKey = ''; axRoadsDraw(); }
}
/* the map's view as a lat/lng box, padded by a share of its size */
function axViewBox(X, pad) {
  const cs = azCorners(X).map((u) => axLL(u[0], u[1]));
  const S = Math.min(...cs.map((c) => c[0])), N = Math.max(...cs.map((c) => c[0])), W = Math.min(...cs.map((c) => c[1])), E = Math.max(...cs.map((c) => c[1]));
  const pa = (N - S) * pad, po = (E - W) * pad;
  return [S - pa, W - po, N + pa, E + po];
}
/* a path of the roads that cross a box (keeps the drawing small when zoomed in — a huge path makes the phone drop the whole map) */
function axRoadPath(list, box, keep, tol) {
  const [S, W, N, E] = box || [], out = {}, t2 = (tol || 0) * (tol || 0);   // tol: points closer than this are skipped
  list.forEach((r) => {
    if (!keep(r[0])) return;
    if (!r.bb) { let s = 90, w = 180, n = -90, e = -180; for (let k = 1; k + 1 < r.length && typeof r[k] === 'number'; k += 2) { s = Math.min(s, r[k]); n = Math.max(n, r[k]); w = Math.min(w, r[k + 1]); e = Math.max(e, r[k + 1]); } r.bb = [s, w, n, e]; }
    if (box && (r.bb[2] < S || r.bb[0] > N || r.bb[3] < W || r.bb[1] > E)) return;
    // points closer than «tol» (about a pixel) to the last one drawn are skipped: the whole country's roads
    // were 6 MB of drawing, repainted after every zoom
    let d = '', lx = 0, ly = 0, n = 0, px = 0, py = 0, pend = false;
    for (let k = 1; k + 1 < r.length && typeof r[k] === 'number'; k += 2) {
      const [x, y] = axXY(r[k], r[k + 1]);
      if (n && t2 && (x - lx) * (x - lx) + (y - ly) * (y - ly) < t2) { px = x; py = y; pend = true; continue; }
      d += (n ? 'L' : 'M') + fz(x) + ',' + fz(y); lx = x; ly = y; n++; pend = false;
    }
    if (pend) d += 'L' + fz(px) + ',' + fz(py);
    if (n < 2 && !pend) return;
    const c = Math.min(4, r[0]); (out[c] = out[c] || []).push(d);
  });
  return out;
}
const axBoxKey = (b) => b.map((v) => v.toFixed(3)).join(',');
function axRoadsDraw(X) {
  const g = $('azRoads'); if (!g || !AZ) return;
  const list = AX.roads && Array.isArray(AX.roadsFor[AZ.id]) ? AX.roadsFor[AZ.id] : [];
  X = X || azXf();
  const pxkm = X.k * AZ.sc / 111.32;
  if (!list.length) { if (g.innerHTML) g.innerHTML = ''; AZ.roadsKey = ''; AZ.roadsPic = null; return; }
  if (pxkm < 15) { axRoadsPic(X, list, pxkm); return; }
  // close in: the roads near the view, as lines (sharp at any zoom)
  const box = axViewBox(X, 0.9);
  const key = AZ.id + '|' + list.length + '|' + axBoxKey(box.map((v) => Math.round(v * 200) / 200));
  if (key === AZ.roadsKey) return;
  AZ.roadsKey = key; AZ.roadsPic = null;
  const by = axRoadPath(list, box, (c) => c <= 3);
  g.innerHTML = [0, 1, 2, 3].map((c) => by[c] ? `<path class="azRd c${c}" d="${by[c].join('')}"/>` : '').join('');
}
/* far out, the roads are painted once into a picture: a whole country of roads as lines was megabytes of drawing,
   repainted by the phone after every zoom (the map froze a second or more after the fingers left it).
   The picture is made for the view and a margin around it, at this zoom level's sharpness, and remade only
   when the view leaves it or the zoom changes a level. */
const AX_RD = [['#cbd5e1', 1.1, 0.7], ['#fde68a', 1.6, 0.85], ['#fbbf24', 2.4, 1], ['#f59e0b', 3, 1]];   // c3 … c0
function axRoadsPic(X, list, pxkm) {
  const lod = Math.floor(Math.log2(pxkm)), maxC = pxkm < 1.5 ? 1 : pxkm < 5 ? 2 : 3;
  const view = axViewBox(X, 0.1), c = AZ.roadsPic;
  if (c && c.id === AZ.id && c.lod === lod && c.n === list.length && view[0] >= c.box[0] && view[1] >= c.box[1] && view[2] <= c.box[2] && view[3] <= c.box[3]) return;
  // made a moment later: the map shows its new view at once, the old roads picture (in place) until the new one is ready
  const box = axViewBox(X, 0.6), id = AZ.id;
  AZ.roadsPic = { id, lod, n: list.length, box, wait: true };
  clearTimeout(axRoadsPic.t);
  axRoadsPic.t = setTimeout(() => { if (AZ && AZ.id === id && AZ.roadsPic && AZ.roadsPic.box === box) axRoadsPaint(list, lod, maxC, box); }, 60);
}
/* the painting itself runs in a background worker (the map stays free to move while it paints);
   phones without one paint here */
const AX_RW_SRC = `
const lists = {};
onmessage = async (e) => {
  const m = e.data;
  if (m.put) { lists[m.put] = m.cls; return; }
  const cls = lists[m.id]; if (!cls) { postMessage({ seq: m.seq, err: 'nolist' }); return; }
  const cv = new OffscreenCanvas(m.cw, m.ch), ctx = cv.getContext('2d');
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const [S, W, N, E] = m.box, fx = m.fx, fy = m.fy, tiny = 0.6 / Math.min(fx, fy);
  for (let cl = Math.min(3, m.maxC); cl >= 0; cl--) {
    const c = cls[cl]; if (!c) continue;
    const st = m.styles[3 - cl]; ctx.strokeStyle = st[0]; ctx.globalAlpha = st[2]; ctx.lineWidth = st[1] * m.dpr;
    ctx.beginPath();
    const bb = c.bb, pts = c.pts, at = c.at;
    for (let r = 0; r < at.length - 1; r++) {
      const b = r * 4;
      if (bb[b + 2] < S || bb[b] > N || bb[b + 3] < W || bb[b + 1] > E) continue;
      if (bb[b + 2] - bb[b] < tiny && bb[b + 3] - bb[b + 1] < tiny) continue;
      const a0 = at[r], a1 = at[r + 1];
      let lx = -1e9, ly = -1e9;
      for (let q = a0; q < a1; q += 2) {
        const px = (pts[q + 1] - W) * fx, py = (N - pts[q]) * fy;
        if (q === a0) ctx.moveTo(px, py);
        else if (Math.abs(px - lx) + Math.abs(py - ly) > 0.8 || q + 2 >= a1) ctx.lineTo(px, py);
        else continue;
        lx = px; ly = py;
      }
    }
    ctx.stroke();
  }
  const blob = await cv.convertToBlob({ type: 'image/png' });
  postMessage({ seq: m.seq, blob });
};`;
let axRW = null, axRWseq = 0;
const axRWcb = {};
function axRWorker() {
  if (axRW !== null) return axRW;
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') throw 0;
    axRW = new Worker(URL.createObjectURL(new Blob([AX_RW_SRC], { type: 'text/javascript' })));
    axRW.onmessage = (e) => { const f = axRWcb[e.data.seq]; delete axRWcb[e.data.seq]; if (f) f(e.data); };
    axRW.onerror = () => { axRW = false; };
  } catch (e) { axRW = false; }
  return axRW;
}
/* the roads by class, packed once per list: numbers in flat arrays the worker can keep */
function axRoadsPack(list) {
  if (list.pack) return list.pack;
  const by = [[], [], [], [], []];
  for (const r of list) by[Math.min(4, r[0])].push(r);
  const cls = by.map((rs) => {
    let n = 0; rs.forEach((r) => { for (let q = 1; q + 1 < r.length && typeof r[q] === 'number'; q += 2) n += 2; });
    const pts = new Float64Array(n), at = new Int32Array(rs.length + 1), bb = new Float64Array(rs.length * 4);
    let o = 0;
    rs.forEach((r, i) => {
      at[i] = o; let s = 90, w = 180, nn = -90, e = -180;
      for (let q = 1; q + 1 < r.length && typeof r[q] === 'number'; q += 2) {
        pts[o++] = r[q]; pts[o++] = r[q + 1];
        s = Math.min(s, r[q]); nn = Math.max(nn, r[q]); w = Math.min(w, r[q + 1]); e = Math.max(e, r[q + 1]);
      }
      bb[i * 4] = s; bb[i * 4 + 1] = w; bb[i * 4 + 2] = nn; bb[i * 4 + 3] = e;
    });
    at[rs.length] = o;
    return { pts, at, bb };
  });
  list.pack = { id: 'L' + (++axRWseq), cls, sent: false };
  return list.pack;
}
function axRoadsPaint(list, lod, maxC, box) {
  const g = $('azRoads'); if (!g) return;
  const [S, W, N, E] = box;
  const [x0, y0] = axXY(N, W), [x1, y1] = axXY(S, E);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let k = Math.pow(2, lod + 0.5) * 111.32 / AZ.sc * dpr;           // canvas pixels per drawing unit
  k = Math.min(k, 3072 / Math.max(1e-9, x1 - x0), 3072 / Math.max(1e-9, y1 - y0));
  const cw = Math.max(1, Math.round((x1 - x0) * k)), ch = Math.max(1, Math.round((y1 - y0) * k));
  const fx = AZ.geo.kx * AZ.geo.sc * k, fy = AZ.geo.sc * k;
  const pic = AZ.roadsPic;
  const show = (b) => {
    if (!b || AZ.roadsPic !== pic || !g.isConnected) return;
    pic.wait = false; AZ.roadsKey = '';
    const url = URL.createObjectURL(b), old = g.dataset.url;
    g.innerHTML = `<image href="${url}" x="${fz(x0)}" y="${fz(y0)}" width="${fz(x1 - x0)}" height="${fz(y1 - y0)}" preserveAspectRatio="none" style="pointer-events:none"/>`;
    g.dataset.url = url;
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
  };
  const pack = axRoadsPack(list), w = axRWorker();
  if (w) {
    if (!pack.sent) { w.postMessage({ put: pack.id, cls: pack.cls }); pack.sent = true; }
    const seq = ++axRWseq;
    axRWcb[seq] = (d) => { if (d.blob) show(d.blob); else { pack.sent = false; } };
    w.postMessage({ seq, id: pack.id, box, cw, ch, fx, fy, maxC, dpr, styles: AX_RD });
    return;
  }
  // no worker: paint here
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const tiny = 0.6 / Math.min(fx, fy);
  for (let cl = Math.min(3, maxC); cl >= 0; cl--) {
    const c = pack.cls[cl], st = AX_RD[3 - cl]; ctx.strokeStyle = st[0]; ctx.globalAlpha = st[2]; ctx.lineWidth = st[1] * dpr;
    ctx.beginPath();
    for (let r = 0; r < c.at.length - 1; r++) {
      const b = r * 4, bb = c.bb;
      if (bb[b + 2] < S || bb[b] > N || bb[b + 3] < W || bb[b + 1] > E) continue;
      if (bb[b + 2] - bb[b] < tiny && bb[b + 3] - bb[b + 1] < tiny) continue;
      for (let q = c.at[r]; q < c.at[r + 1]; q += 2) {
        const px = (c.pts[q + 1] - W) * fx, py = (N - c.pts[q]) * fy;
        if (q === c.at[r]) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }
  cv.toBlob(show);
}

/* ---------------- 8. your places ---------------- */
function axMine(n) {
  const out = [];
  if (!AX.mine) return out;
  const inN = (lat, lng) => !n || n.k === 'iraq' || inArea(n, lat, lng);
  (typeof favs !== 'undefined' ? favs : []).forEach((f) => { if (inN(f.lat, f.lng)) out.push({ k: 'fav', n: f.name, lat: f.lat, lng: f.lng }); });
  (typeof allSites === 'function' ? allSites() : []).forEach((s) => { if (inN(s.lat, s.lng)) out.push({ k: 'site', n: s.n, lat: s.lat, lng: s.lng, sub: s.set }); });
  (typeof zones !== 'undefined' ? zones : []).forEach((z) => { if (z.on !== false && inN(z.lat, z.lng)) out.push({ k: 'zone', n: z.name, lat: z.lat, lng: z.lng }); });
  if (typeof rpts !== 'undefined') Object.values(rpts).forEach((r) => { if (rptAlive(r) && inN(r.lat, r.lng)) out.push({ k: 'rpt', n: RPT[r.k].ic + ' ' + RPT[r.k].ar, lat: r.lat, lng: r.lng, sub: rptAgo(r.t) }); });
  return out;
}
const AX_MINE = { fav: ['⭐', 'مفضلة', '#f472b6'], site: ['📌', 'موقع ميداني', '#a78bfa'], zone: ['⚠️', 'منطقة تنبيه', '#ef4444'], rpt: ['🚧', 'بلاغ', '#f97316'] };
function axMineCount(n) {
  const c = {}; axMine(n).forEach((m) => { c[m.k] = (c[m.k] || 0) + 1; });
  return Object.entries(c).map(([k, v]) => AX_MINE[k][0] + ' ' + v + ' ' + AX_MINE[k][1]).join(' · ');
}

/* ---------------- drawing on the map (called by azDraw) ---------------- */
let axPts = [];      // what can be tapped: {x, y, kind, obj}
/* ---------------- every street when zoomed in close ---------------- */
AX.st = { key: '', list: null, drawn: '', busy: false, t: 0 };
function axStreets(X) {
  const g = $('azStreets'); if (!g) return;
  const pxkm = X.k * AZ.sc / 111.32;
  if (!AX.roads || pxkm < 40 || typeof roadsReady !== 'function' || !roadsReady()) { if (g.innerHTML) g.innerHTML = ''; AX.st.drawn = ''; return; }
  const view = axViewBox(X, 0.7), want = axViewBox(X, 1.0);
  const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  const c = AX.st.box;
  const fits = c && view[0] >= c[0] && view[1] >= c[1] && view[2] <= c[2] && view[3] <= c[3] && area(c) <= area(want) * 6;
  if (!fits && !AX.st.busy) {
    AX.st.busy = true;
    clearTimeout(AX.st.t);
    AX.st.t = setTimeout(async () => {
      const list = await roadsMainIn(want[0], want[1], want[2], want[3], true);
      AX.st.busy = false; AX.st.box = want; AX.st.list = list || []; AX.st.drawn = '';
      azSoon();
    }, 200);
  }
  if (!AX.st.list) return;
  const key = AZ.id + '|' + axBoxKey(view.map((v) => Math.round(v * 500) / 500)) + '|' + AX.st.list.length;
  if (AX.st.drawn === key) return;
  AX.st.drawn = key;
  const by = axRoadPath(AX.st.list, view, (cl) => cl >= 4);
  g.innerHTML = by[4] ? `<path class="azSt" d="${by[4].join('')}"/>` : '';
}
/* a long press on the areas map: the route to that point, like on the main map */
let axPin = null;
async function azLongPress(sx, sy) {
  const X = azXf(), u = X.toU(sx, sy), [lat, lng] = axLL(u[0], u[1]);
  axPin = { lat, lng }; azSoon();
  let name = 'النقطة المختارة';
  try { const st = typeof roadsStreetAt === 'function' ? await roadsStreetAt(lat, lng) : null; if (st && st.name) name = (/^(شارع|طريق|جسر|ساحة)/.test(st.name) ? '' : 'شارع ') + st.name; } catch (e) {}
  const leaf = arAreaOf({ lat, lng });
  const to = { lat, lng, name };
  const live = typeof AXN !== 'undefined' && AXN.live;
  actionSheet('📍 ' + name + (leaf ? ' — ' + arShort(leaf) : ''), [
    live ? { label: '🧭 غيّر الوجهة إلى هنا', fn: () => axnRetarget(to) } : { label: '🧭 المسار إلى هنا', fn: () => axnRoute(to) },
    { label: '🗺 عرضها على الخريطة الرئيسية', fn: () => { $('areaPanel').classList.add('hidden'); if (live) axnLiveOff(true); setDestination(lat, lng, name, leaf ? arTitle(leaf) : ''); } },
    { label: '🗺 وصف المكان بالمعالم', fn: () => describePlace(lat, lng, name) },
    { label: '⏱ أين أصل من هنا خلال ساعة', fn: () => axReach({ lat, lng }, 'هذه النقطة') },
    { label: '⏰ ذكّرني عند الوصول هنا', fn: () => remAdd(lat, lng, name) }
  ]);
}
function azExtraDraw(X) {
  axSatDraw(X);
  axStreets(X);
  if (typeof axnDraw === 'function') axnDraw(X);
  axRoadsDraw(X);
  const k = X.k, vb = AZ.vb, Ws = vb.w * k, Hs = vb.h * k;
  axPts = [];
  let h = '';
  const cur = AZ.cur;
  const svc = axSvcPts(cur);
  svc.forEach((p) => {
    const [x, y] = axXY(p.lat, p.lng), s = X.toS(x, y); if (s[0] < -20 || s[1] < -20 || s[0] > Ws + 20 || s[1] > Hs + 20) return;
    h += `<rect class="axSvc" x="${fz((x - 5 / k))}" y="${fz((y - 5 / k))}" width="${fz((10 / k))}" height="${fz((10 / k))}" rx="${fz((2 / k))}" style="stroke-width:${fz((1.5 / k))}"/>`;
    axPts.push({ s, kind: 'svc', obj: p });
  });
  $('azSvc').innerHTML = h;
  h = '';
  axMine(cur).forEach((m) => {
    const [x, y] = axXY(m.lat, m.lng), s = X.toS(x, y); if (s[0] < -20 || s[1] < -20 || s[0] > Ws + 20 || s[1] > Hs + 20) return;
    const r = 6 / k;
    h += `<path class="axMine" d="M${fz(x)},${fz((y - r * 1.4))}L${fz((x + r))},${fz(y)}L${fz(x)},${fz((y + r * 1.4))}L${fz((x - r))},${fz(y)}Z" style="fill:${AX_MINE[m.k][2]};stroke-width:${fz((1.5 / k))}"/>`;
    axPts.push({ s, kind: 'mine', obj: m });
  });
  if (axPin) {
    const [x, y] = axXY(axPin.lat, axPin.lng), r = 9 / k;
    h += `<g transform="translate(${fz(x)} ${fz(y)})"><path class="axPin" d="M0,0 L${fz((-r * 0.7))},${fz((-r * 1.6))} A${fz((r * 0.8))},${fz((r * 0.8))} 0 1 1 ${fz((r * 0.7))},${fz((-r * 1.6))} Z" style="stroke-width:${fz((1.5 / k))}"/></g>`;
  }
  $('azMine').innerHTML = h;
  axWxFill();
}
function azExtraTap(sx, sy) {
  let best = null, bd = 18;
  axPts.forEach((p) => { const d = Math.hypot(p.s[0] - sx, p.s[1] - sy); if (d < bd) { bd = d; best = p; } });
  if (!best) return false;
  const o = best.obj;
  if (best.kind === 'svc') {
    const kind = AX_SVC.find((s) => s[0] === axSvcKind(o.k));
    actionSheet((kind ? kind[1] + ' ' : '') + o.n, [{ label: '🧭 المسار إليه هنا', fn: () => axnRoute({ lat: o.lat, lng: o.lng, name: o.n }) }, { label: '🗺 اذهب إليه على الخريطة', fn: () => { $('areaPanel').classList.add('hidden'); setDestination(o.lat, o.lng, o.n, o.e || ''); } }]);
  } else {
    actionSheet(AX_MINE[o.k][0] + ' ' + o.n + (o.sub ? ' · ' + o.sub : ''), [{ label: '🧭 المسار إليه هنا', fn: () => axnRoute({ lat: o.lat, lng: o.lng, name: o.n }) }, { label: '🗺 اذهب إليه على الخريطة', fn: () => { $('areaPanel').classList.add('hidden'); setDestination(o.lat, o.lng, o.n, AX_MINE[o.k][1]); } }]);
  }
  return true;
}

/* ---------------- the extra buttons on the map ---------------- */
function axButtons() {
  const box = $('azBox'); if (!box || $('azBtns2')) return;
  const b = document.createElement('div'); b.id = 'azBtns2';
  b.innerHTML = `<button data-x="find" aria-label="بحث">🔍</button><button data-x="sat" aria-label="قمر صناعي" class="${AX.sat ? 'on' : ''}">🛰</button>`
    + `<button data-x="wx" aria-label="الطقس" class="${AX.wx ? 'on' : ''}">${AX.wx === 'rain' ? '🌧' : AX.wx === 'temp' ? '🌡' : AX.wx === 'dust' ? '🌫' : '🌦'}</button>`
    + `<button data-x="roads" aria-label="الطرق الرئيسية" class="${AX.roads ? 'on' : ''}">🛣</button><button data-x="mine" aria-label="مواقعي" class="${AX.mine ? 'on' : ''}">📌</button>`;
  box.appendChild(b);
  b.onclick = (e) => {
    const x = e.target.closest('[data-x]'); if (!x) return;
    const k = x.dataset.x;
    if (k === 'find') { axFind(); return; }
    if (k === 'wx') { axWxToggle(); return; }
    if (k === 'sat') { AX.sat = !AX.sat; store.set('axSat', AX.sat); toast(AX.sat ? '🛰 صور القمر الصناعي (تحتاج إنترنت)' : 'أوقفتَ القمر الصناعي', 2200); }
    if (k === 'roads') { AX.roads = !AX.roads; store.set('axRoads', AX.roads); if (AX.roads && !roadsReady()) toast('الطرق تظهر بعد تنزيل خريطة المحافظة وبيانات طرقها', 3500); }
    if (k === 'mine') { AX.mine = !AX.mine; store.set('axMine', AX.mine); toast(AX.mine ? '📌 مواقعك: المفضلة والمواقع الميدانية ومناطق التنبيه والبلاغات' : 'أخفيتَ مواقعك', 2500); }
    arRender();
  };
}

/* ---------------- 6. search inside the map ---------------- */
const axNorm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').replace(/^ال/, '').toLowerCase().trim();
async function axFind() {
  const q = await uiPrompt('ابحث عن محافظة أو قضاء أو ناحية أو حي أو قرية', '', { ok: 'بحث' });
  if (!q || !q.trim()) return;
  const nq = axNorm(q), hits = [];
  Object.values(AR.byId).forEach((n) => { if (n.k === 'iraq') return; const t = axNorm(arShort(n)), t2 = axNorm(n.ar); if (t.includes(nq) || t2.includes(nq)) hits.push({ type: 'area', n, score: (t === nq ? 0 : t.startsWith(nq) ? 1 : 2) + (n.k === 'p' ? 0 : n.k === 'd' ? 0.1 : 0.2) }); });
  if (typeof places !== 'undefined' && places) places.forEach((p) => {
    if (!ST_GROUP[p.k]) return;
    const t = axNorm(p.n);
    if (t.includes(nq) || (p.e && p.e.toLowerCase().includes(q.trim().toLowerCase()))) hits.push({ type: 'place', p, score: (t === nq ? 0.5 : t.startsWith(nq) ? 1.5 : 2.5) + ST_RANK[p.k] * 0.05 });
  });
  if (!hits.length) { toast('لم أجد «' + q + '»' + (typeof places === 'undefined' || !places ? ' — الأحياء والقرى تحتاج خريطة المحافظة' : ''), 4000); return; }
  hits.sort((a, b) => a.score - b.score);
  const go = (h) => (h.type === 'area' ? axGoArea(h.n) : axGoPlace(h.p));
  if (hits.length === 1) { go(hits[0]); return; }
  actionSheet('🔍 «' + q + '»', hits.slice(0, 15).map((h) => ({
    label: h.type === 'area' ? '🗺 ' + esc(arTitle(h.n)) + (h.n.up && AR.byId[h.n.up] && h.n.k !== 'p' ? ' <span class="s">— ' + esc(arShort(AR.byId[h.n.up])) + '</span>' : '')
      : ST_HEAD[ST_GROUP[h.p.k]][0] + ' ' + esc(h.p.n) + (h.p.e ? ' <span class="s">' + esc(h.p.e) + '</span>' : ''),
    fn: () => go(h)
  })));
}
function axChain(n) { const c = []; let x = n; while (x && x.k !== 'iraq') { c.unshift(x.id); x = AR.byId[x.up]; } return c; }
function axGoArea(n) {
  const c = axChain(n);
  arPath = c.slice(0, -1); arSel = n.id; stSel = null; plPick = null;
  if (AZ) AZ.rot = 0;
  arRender(); arSheet('mid'); $('areaSheetBody').scrollTop = 0;
}
function axGoPlace(p) {
  const leaf = arAreaOf(p);
  if (!leaf) { toast('المكان خارج حدود المناطق'); return; }
  const chain = axChain(leaf);
  arPath = chain; arSel = null; plPick = null;
  const list = arSettle(leaf); stSel = Math.max(0, list.indexOf(p));
  if (list.indexOf(p) < 0) { arPath = chain.slice(0, -1); arSel = null; plPick = p; stSel = null; }
  arRender();
  // zoom onto it
  requestAnimationFrame(() => {
    if (!AZ) return;
    const [x, y] = axXY(p.lat, p.lng), b = AZ.base, w = b.w / 6, h = b.h / 6;
    AZ.vb = azClamp({ x: x - w / 2, y: y - h / 2, w, h }); azSoon();
    arSheet('mid'); $('areaSheetBody').scrollTop = 0;
  });
}

/* ---------------- 7. compare two areas ---------------- */
function axCompare(n) {
  if (!AX.cmp || AX.cmp === n.id) { AX.cmp = n.id; toast('⚖ اختر المنطقة الثانية ثم اضغط «⚖ قارن» فيها', 4000); arRender(); return; }
  const A = AR.byId[AX.cmp], B = n; AX.cmp = null;
  const row = (t, a, b) => `<tr><th>${t}</th><td>${a}</td><td>${b}</td></tr>`;
  const st = (x) => { const c = { town: 0, nb: 0, vil: 0 }; arSettle(x).forEach((p) => c[ST_GROUP[p.k]]++); return c; };
  const sa = st(A), sb = st(B), ca = axStats(A), cb = axStats(B);
  let rows = row('النوع', AR_KIND[A.k] || '', AR_KIND[B.k] || '') + row('المساحة', axFmtKm2(axKm2(A)), axFmtKm2(axKm2(B)));
  if (arKids(A.id).length || arKids(B.id).length) rows += row('التقسيمات', arKids(A.id).length, arKids(B.id).length);
  rows += row('مدن وبلدات', sa.town, sb.town) + row('أحياء', sa.nb, sb.nb) + row('قرى', sa.vil, sb.vil);
  AX_SVC.forEach(([k, ic, ar]) => { if (ca[k] || cb[k]) rows += row(ic + ' ' + ar, ca[k] || 0, cb[k] || 0); });
  if (WX.data) { const va = wxValues(A.id), vb2 = wxValues(B.id); if (va && vb2 && va.t != null) rows += row('🌡 الحرارة الآن', va.t + '°', vb2.t + '°'); }
  if (me && A.c && B.c) rows += row('📏 عن موقعك', fmtDist(hav([me.lat, me.lng], [A.c[1], A.c[0]])), fmtDist(hav([me.lat, me.lng], [B.c[1], B.c[0]])));
  actionSheet('⚖ مقارنة', [{ label: `<table class="axCmp"><tr><th></th><td><b>${esc(arShort(A))}</b></td><td><b>${esc(arShort(B))}</b></td></tr>${rows}</table>` }]);
  arRender();
}

/* ---------------- 9. export: a picture of the map, KML and GeoJSON ---------------- */
async function axExport(n) {
  actionSheet('📤 تصدير ' + arTitle(n), [
    { label: '🖼 صورة الخريطة بأسمائها (مشاركة)', fn: () => axExportImage(n) },
    { label: '🌍 ملف KML (Google Earth)', fn: () => axExportKml(n) },
    { label: '🗂 ملف GeoJSON (برامج GIS)', fn: () => axExportGeo(n) }
  ]);
}
function axFeatures(n) {
  const areas = [n].concat(arKids(n.id));
  const pts = arSettle(n);
  return { areas, pts };
}
function axExportGeo(n) {
  const { areas, pts } = axFeatures(n);
  const fc = { type: 'FeatureCollection', features: [] };
  areas.forEach((a) => { if (a.g) fc.features.push({ type: 'Feature', properties: { name: a.ar, kind: AR_KIND[a.k] || a.k, area_km2: Math.round(axKm2(a) * 10) / 10 }, geometry: a.g }); });
  pts.forEach((p) => fc.features.push({ type: 'Feature', properties: { name: p.n, name_en: p.e || '', kind: p.k }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
  saveTextFile('mallah-' + axFileName(n) + '.geojson', 'application/geo+json', JSON.stringify(fc));
}
function axExportKml(n) {
  const { areas, pts } = axFeatures(n);
  const ring = (r) => '<LinearRing><coordinates>' + r.map((c) => c[0].toFixed(5) + ',' + c[1].toFixed(5)).join(' ') + '</coordinates></LinearRing>';
  const poly = (g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]).map((p) => '<Polygon><outerBoundaryIs>' + ring(p[0]) + '</outerBoundaryIs>' + p.slice(1).map((h) => '<innerBoundaryIs>' + ring(h) + '</innerBoundaryIs>').join('') + '</Polygon>').join('');
  let k = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xmlEsc(arTitle(n)) + ' — الملاح</name>'
    + '<Style id="a"><LineStyle><color>ff38bdf8</color><width>2</width></LineStyle><PolyStyle><color>2238bdf8</color></PolyStyle></Style>';
  areas.forEach((a) => { if (a.g) k += '<Placemark><name>' + xmlEsc(a.ar) + '</name><styleUrl>#a</styleUrl><MultiGeometry>' + poly(a.g) + '</MultiGeometry></Placemark>'; });
  if (pts.length) k += '<Folder><name>المدن والأحياء والقرى</name>' + pts.map((p) => '<Placemark><name>' + xmlEsc(p.n) + '</name>' + (p.e ? '<description>' + xmlEsc(p.e) + '</description>' : '') + '<Point><coordinates>' + p.lng.toFixed(6) + ',' + p.lat.toFixed(6) + '</coordinates></Point></Placemark>').join('') + '</Folder>';
  k += '</Document></kml>';
  saveTextFile('mallah-' + axFileName(n) + '.kml', 'application/vnd.google-earth.kml+xml', k);
}
const axFileName = (n) => (n.en || n.id || 'area').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'area';
async function axExportImage(n) {
  const svg = $('areaSvg'); if (!svg) return;
  toast('🖼 جارٍ تجهيز الصورة…', 2000);
  const r = svg.getBoundingClientRect(), S = 2, W = Math.round(r.width * S), H = Math.round(r.height * S), head = 120;
  const clone = svg.cloneNode(true);
  clone.querySelector('#azSat') && (clone.querySelector('#azSat').innerHTML = '');      // map pictures from the internet cannot go into the image
  clone.setAttribute('width', W); clone.setAttribute('height', H);
  // the page's styles for the map, written into the picture
  let css = '';
  for (const sh of document.styleSheets) { try { for (const rule of sh.cssRules) if (/#areaSvg|\.pv|\.pvl|\.stDot|\.azRd|\.axSvc|\.axMine/.test(rule.selectorText || '')) css += rule.cssText + '\n'; } catch (e) {} }
  const st = document.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = css + 'text{font-family:"Plex",system-ui,sans-serif}';
  clone.insertBefore(st, clone.firstChild);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; }).catch(() => {});
  const c = document.createElement('canvas'); c.width = W; c.height = H + head;
  const x = c.getContext('2d');
  x.fillStyle = '#0b1220'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, head, W, H);
  URL.revokeObjectURL(url);
  x.fillStyle = '#e2e8f0'; x.font = 'bold 44px Plex, system-ui, sans-serif'; x.textAlign = 'right'; x.direction = 'rtl';
  x.fillText(arTitle(n), W - 32, 62);
  x.fillStyle = '#94a3b8'; x.font = '26px Plex, system-ui, sans-serif';
  x.fillText('الملاح · ' + axFmtKm2(axKm2(n)) + ' · ' + new Date().toLocaleDateString('ar-IQ-u-nu-latn'), W - 32, 100);
  const data = c.toDataURL('image/jpeg', 0.9), text = '🗺 ' + arTitle(n) + ' — من تطبيق الملاح';
  if (NATIVE && Android.shareImage) { if (!Android.shareImage(data.split(',')[1], 'mallah-area.jpg', text)) toast('تعذّرت المشاركة'); return; }
  try {
    const blob = await (await fetch(data)).blob(), file = new File([blob], 'mallah-area.jpg', { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (e) {}
  const a = document.createElement('a'); a.href = data; a.download = 'mallah-' + axFileName(n) + '.jpg'; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------- 10. download the streets of an area ---------------- */
async function axDownload(n) {
  if (!NATIVE || typeof queueDownload !== 'function') { toast('تنزيل الشوارع متاح في تطبيق أندرويد', 3500); return; }
  const box = { w: n.b[0], s: n.b[1], e: n.b[2], n: n.b[3] };
  let maxZ = OFFLINE_MAX_Z, cnt = tileCount(box, CITY_MIN_Z, maxZ);
  while (cnt > 60000 && maxZ > 13) { maxZ--; cnt = tileCount(box, CITY_MIN_Z, maxZ); }
  const note = maxZ < OFFLINE_MAX_Z ? '\n(المنطقة كبيرة، فستُنزَّل بتفاصيل أقل من مستوى الشوارع الصغيرة)' : '';
  if (!(await uiConfirm('تنزيل شوارع «' + arTitle(n) + '» لتعمل بدون إنترنت؟\nالحجم التقريبي ' + fmtMB(cnt * KB_PER_TILE * 1024) + note, { ok: 'تنزيل' }))) return;
  const id = 'ar' + String(n.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  queueDownload(Object.assign({ id, name: arTitle(n), minZ: CITY_MIN_Z, maxZ }, box));
}

/* ---------------- the card: extra lines and buttons ---------------- */
{
  const _card = arCard;
  arCard = function (n, here, isCur) {
    const html = _card.apply(this, arguments);
    if (!n || n.k === 'iraq') return html;
    const st = axStats(n);
    const chips = AX_SVC.filter(([k]) => st[k]).map(([k, ic, ar]) => `<button class="chip axChip${AX.svc === k ? ' on' : ''}" data-x="svc" data-k="${k}">${ic} ${st[k]} ${ar}</button>`).join('');
    const mine = axMineCount(n);
    const extra = `<div class="axInfo">
      <div class="s">📐 ${axFmtKm2(axKm2(n))}${n.c ? ' · <span id="axDist"></span>' : ''}</div>
      ${axWxLine(n)}
      ${chips ? '<div class="axChips">' + chips + '</div>' : ''}
      ${mine ? '<div class="s axLine">📌 مواقعك هنا: ' + mine + '</div>' : ''}
      <div class="areaBtns"><button class="chip go" data-x="route" data-id="${n.id}">🧭 المسار إليها</button><button class="chip${AX.cmp === n.id ? ' on' : ''}" data-x="cmp" data-id="${n.id}">⚖ ${AX.cmp && AX.cmp !== n.id ? 'قارن مع ' + esc(arShort(AR.byId[AX.cmp])) : AX.cmp === n.id ? 'اختر منطقة ثانية…' : 'قارن'}</button><button class="chip" data-x="exp" data-id="${n.id}">📤 تصدير</button>${NATIVE ? `<button class="chip" data-x="dl" data-id="${n.id}">⬇ شوارعها بدون إنترنت</button>` : ''}</div>
    </div>`;
    return html.replace(/<\/div>$/, extra + '</div>');
  };
  const _render = arRender;
  arRender = function () {
    _render.apply(this, arguments);
    axButtons();
    if (typeof axnAfterRender === 'function') axnAfterRender();
    const sel = $('areaSel');
    sel.querySelectorAll('[data-x]').forEach((b) => {
      b.onclick = () => {
        const n = b.dataset.id && AR.byId[b.dataset.id];
        if (b.dataset.x === 'svc') { AX.svc = AX.svc === b.dataset.k ? null : b.dataset.k; arRender(); if (AX.svc) toast('تظهر على الخريطة كمربعات — اضغط أيًّا منها', 2500); }
        else if (b.dataset.x === 'cmp') axCompare(n);
        else if (b.dataset.x === 'route') axnRoute(axnTargetOf(n));
        else if (b.dataset.x === 'exp') axExport(n);
        else if (b.dataset.x === 'dl') axDownload(n);
      };
    });
    const id = sel.querySelector('[data-x="cmp"]');
    const n = id && AR.byId[id.dataset.id];
    if (n) axDist(n);
    if (AZ && AZ.cur) axRoadsLoad(AZ.cur);
  };
}
