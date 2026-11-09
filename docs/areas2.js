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
  const vb = AZ.vb, Ws = vb.w * X.k, Hs = vb.h * X.k;
  const cs = [[0, 0], [Ws, 0], [0, Hs], [Ws, Hs]].map(([a, b]) => { const u = X.toU(a, b); return axLL(u[0], u[1]); });
  const S = Math.min(...cs.map((c) => c[0])), N = Math.max(...cs.map((c) => c[0])), W = Math.min(...cs.map((c) => c[1])), E = Math.max(...cs.map((c) => c[1]));
  const ppd = X.k * AZ.geo.kx * AZ.geo.sc;                       // screen pixels per degree of longitude
  let z = Math.max(4, Math.min(18, Math.round(Math.log2(360 * ppd / 256))));
  const tx = (lng, zz) => Math.floor((lng + 180) / 360 * 2 ** zz);
  const ty = (lat, zz) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** zz); };
  while (z > 4 && (tx(E, z) - tx(W, z) + 1) * (ty(S, z) - ty(N, z) + 1) > 48) z--;
  const x0 = tx(W, z), x1 = tx(E, z), y0 = ty(N, z), y1 = ty(S, z);
  const key = [z, x0, x1, y0, y1].join(',');
  if (key === AX.satKey) return;
  AX.satKey = key;
  const lon = (x) => x / 2 ** z * 360 - 180, lat = (y) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
  let h = '';
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const [ax, ay] = axXY(lat(y), lon(x)), [bx, by] = axXY(lat(y + 1), lon(x + 1));
    h += `<image href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}" x="${ax.toFixed(2)}" y="${ay.toFixed(2)}" width="${(bx - ax + 0.3).toFixed(2)}" height="${(by - ay + 0.3).toFixed(2)}" preserveAspectRatio="none"/>`;
  }
  g.innerHTML = h;
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
    else c = v.p != null ? wxColor('rainP', v.p) : wxColor('rainH', v.r);
    if (c) p.style.fill = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0.35, c[3])})`;
  });
}
async function axWxToggle() {
  AX.wx = { '': 'temp', temp: 'rain', rain: '' }[AX.wx]; store.set('axWx', AX.wx);
  if (AX.wx && !WX.data) {
    toast('🌦 جارٍ تحميل الطقس…', 2000);
    try { WX.mode = 'h'; await Promise.all([wxLoad(), arLoad().then((a) => { WX.ar = a; })]); WX.idx = wxNowIdx(); } catch (e) { toast('تعذّر تحميل الطقس'); AX.wx = ''; }
  }
  if (WX.data && WX.mode === 'h') WX.idx = wxNowIdx();
  toast(AX.wx === 'temp' ? '🌡 المناطق ملوّنة بالحرارة الآن' : AX.wx === 'rain' ? '🌧 المناطق ملوّنة باحتمال المطر اليوم' : 'أوقفتَ تلوين الطقس', 2500);
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
  if (AZ && AZ.id === cur.id) axRoadsDraw();
}
function axRoadsDraw() {
  const g = $('azRoads'); if (!g || !AZ) return;
  const list = AX.roads && Array.isArray(AX.roadsFor[AZ.id]) ? AX.roadsFor[AZ.id] : [];
  const by = [[], [], [], []];
  list.forEach((r) => {
    let d = '';
    for (let k = 1; k + 1 < r.length; k += 2) { const [x, y] = axXY(r[k], r[k + 1]); d += (k === 1 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1); }
    by[Math.min(3, r[0])].push(d);
  });
  g.innerHTML = by.map((ds, c) => ds.length ? `<path class="azRd c${c}" d="${ds.join('')}"/>` : '').join('');
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
function azExtraDraw(X) {
  axSatDraw(X);
  if (typeof axnDraw === 'function') axnDraw(X);
  if (AZ.roadsDrawnFor !== AZ.id + '|' + AX.roads) { AZ.roadsDrawnFor = AZ.id + '|' + AX.roads; axRoadsDraw(); }
  const k = X.k, vb = AZ.vb, Ws = vb.w * k, Hs = vb.h * k;
  axPts = [];
  let h = '';
  const cur = AZ.cur;
  const svc = axSvcPts(cur);
  svc.forEach((p) => {
    const [x, y] = axXY(p.lat, p.lng), s = X.toS(x, y); if (s[0] < -20 || s[1] < -20 || s[0] > Ws + 20 || s[1] > Hs + 20) return;
    h += `<rect class="axSvc" x="${(x - 5 / k).toFixed(2)}" y="${(y - 5 / k).toFixed(2)}" width="${(10 / k).toFixed(2)}" height="${(10 / k).toFixed(2)}" rx="${(2 / k).toFixed(2)}" style="stroke-width:${(1.5 / k).toFixed(2)}"/>`;
    axPts.push({ s, kind: 'svc', obj: p });
  });
  $('azSvc').innerHTML = h;
  h = '';
  axMine(cur).forEach((m) => {
    const [x, y] = axXY(m.lat, m.lng), s = X.toS(x, y); if (s[0] < -20 || s[1] < -20 || s[0] > Ws + 20 || s[1] > Hs + 20) return;
    const r = 6 / k;
    h += `<path class="axMine" d="M${x.toFixed(2)},${(y - r * 1.4).toFixed(2)}L${(x + r).toFixed(2)},${y.toFixed(2)}L${x.toFixed(2)},${(y + r * 1.4).toFixed(2)}L${(x - r).toFixed(2)},${y.toFixed(2)}Z" style="fill:${AX_MINE[m.k][2]};stroke-width:${(1.5 / k).toFixed(2)}"/>`;
    axPts.push({ s, kind: 'mine', obj: m });
  });
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
    + `<button data-x="wx" aria-label="الطقس" class="${AX.wx ? 'on' : ''}">${AX.wx === 'rain' ? '🌧' : AX.wx === 'temp' ? '🌡' : '🌦'}</button>`
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
