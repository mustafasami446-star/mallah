'use strict';
/* الملاح — استكشف المناطق: العراق ← المحافظة ← القضاء ← الناحية ← الأحياء والقرى.
   Pick an area on an interactive map to see it on the map, and to search or discover places inside it. */

let AR = null;                 // {byId, kids: {parentId: [node]}}
let arPath = [];               // ids from the top: ['p:maysan', 'd12', ...]
let arSel = null;              // selected child id at the current level
let areaScope = null;          // the area shown on the map (search and discover stay inside it)
const areaLayer = L.layerGroup().addTo(map);
const AR_KIND = { iraq: 'العراق', p: 'محافظة', d: 'قضاء', s: 'ناحية' };
const AR_KIDS = { iraq: 'المحافظات', p: 'الأقضية', d: 'النواحي' };

function arLoad() {
  if (AR) return Promise.resolve(AR);
  const ready = window.AREAS ? Promise.resolve() : loadScript('areas-data.js');
  return ready.then(() => {
    const byId = {}, kids = {};
    const add = (n, up) => { byId[n.id] = n; n.up = up; (kids[up] = kids[up] || []).push(n); };
    byId.iraq = { id: 'iraq', k: 'iraq', ar: 'العراق' };
    (window.PROVINCES ? PROVINCES.features : []).forEach((f) => {
      const n = { id: 'p:' + f.properties.id, pid: f.properties.id, k: 'p', ar: f.properties.name, g: f.geometry, c: f.properties.label };
      n.b = bboxOf(n.g); add(n, 'iraq');
    });
    ((window.AREAS && AREAS.areas) || []).forEach((a) => {
      const up = a.k === 'd' ? 'p:' + a.p : (a.up || null);
      if (a.k === 's' && !up) return;
      add({ id: a.id, k: a.k, ar: a.ar, g: a.g, c: a.c, b: a.b, pid: a.p }, up);
    });
    Object.values(kids).forEach((l) => l.sort((x, y) => x.ar.localeCompare(y.ar, 'ar')));
    AR = { byId, kids };
    return AR;
  });
}
function bboxOf(g) {
  let w = 180, e = -180, s = 90, n = -90;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  polys.forEach((p) => p[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
  return [w, s, e, n];
}
function inArea(n, lat, lng) {
  if (!n || !n.g) return true;
  const b = n.b;
  if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) return false;
  const polys = n.g.type === 'MultiPolygon' ? n.g.coordinates : [n.g.coordinates];
  for (const poly of polys) {
    let inside = false;
    poly.forEach((ring, ri) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
      }
      if (c) inside = ri === 0 ? true : !inside;
    });
    if (inside) return true;
  }
  return false;
}
const arTitle = (n) => !n ? '' : n.k === 'iraq' || n.k === 'p' || /^(قضاء|ناحية|مركز)\s/.test(n.ar) ? n.ar : AR_KIND[n.k] + ' ' + n.ar;
const arShort = (n) => n.ar.replace(/^مركز قضاء\s+/, 'مركز ').replace(/^(قضاء|ناحية)\s+/, '');
const arCur = () => AR.byId[arPath[arPath.length - 1] || 'iraq'];
const arKids = (id) => (AR.kids[id] || []);
/* the fourth level: towns, neighbourhoods and villages inside a sub-district (from the downloaded province maps) */
const ST_GROUP = { city: 'town', town: 'town', suburb: 'nb', neighbourhood: 'nb', quarter: 'nb', village: 'vil', hamlet: 'vil' };
const ST_HEAD = { town: ['🏘', 'المدن والبلدات'], nb: ['📍', 'الأحياء'], vil: ['🏡', 'القرى'] };
const ST_RANK = { city: 0, town: 1, suburb: 2, quarter: 3, neighbourhood: 3, village: 4, hamlet: 5 };
let stCache = {}, stPlaces = null;
function arSettle(n) {
  if (!n || n.k === 'iraq' || typeof places === 'undefined' || !places) return [];
  if (stPlaces !== places) { stCache = {}; stPlaces = places; }
  if (stCache[n.id]) return stCache[n.id];
  return (stCache[n.id] = places.filter((p) => ST_GROUP[p.k] && inArea(n, p.lat, p.lng))
    .sort((a, b) => ST_RANK[a.k] - ST_RANK[b.k] || a.n.localeCompare(b.n, 'ar')));
}
const arLeaf = (n) => n && n.k !== 'iraq' && n.k !== 'p' && !arKids(n.id).length;
function stCount(list) {
  const c = { town: 0, nb: 0, vil: 0 }; list.forEach((p) => c[ST_GROUP[p.k]]++);
  // Arabic counting: one, two (dual), 3–10 plural, 11+ singular (حيًا)
  const w = (k, one, two, many, acc) => !c[k] ? '' : c[k] === 1 ? one : c[k] === 2 ? two : c[k] + ' ' + (c[k] <= 10 ? many : acc);
  return [w('town', 'بلدة واحدة', 'بلدتان', 'مدن وبلدات', 'مدينة وبلدة'), w('nb', 'حي واحد', 'حيّان', 'أحياء', 'حيًا'), w('vil', 'قرية واحدة', 'قريتان', 'قرى', 'قرية')].filter(Boolean).join(' · ');
}
const STL = '<div class="stLegend"><span><i class="town"></i>مدن وبلدات</span><span><i class="nb"></i>أحياء</span><span><i class="vil"></i>قرى</span></div>';
let stSel = null;   // the chosen town / neighbourhood / village (index into arSettle(cur)) at the fourth level
/* the deepest area around a point, for "you are here" */
function arHere(lat, lng) {
  const out = [];
  let id = 'iraq';
  for (;;) {
    const k = arKids(id).find((n) => inArea(n, lat, lng));
    if (!k) return out;
    out.push(k.id); id = k.id;
  }
}

/* ---------------- the panel ---------------- */
function arEnsure() {
  if ($('areaPanel')) return;
  const el = document.createElement('div');
  el.id = 'areaPanel'; el.className = 'panel hidden';
  el.innerHTML = `<div class="panelHead"><button class="iconBtn" id="areaClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button><h2>استكشف المناطق</h2></div>
  <div class="panelBody" id="areaBody">
    <div id="areaCrumbs"></div>
    <div id="areaMapWrap"></div>
    <div id="areaSheet" class="mid"><div class="grab" id="areaGrab"></div><div id="areaLegend"></div><div id="areaSheetBody">
    <div class="card" id="areaSel"></div>
    <div class="card"><h3 id="areaListH"></h3><div id="areaList"></div></div>
    <div class="note">حدود الأقضية والنواحي، وأسماء المدن والأحياء والقرى، من OpenStreetMap — وقد تكون تقريبية أو ناقصة في بعض المحافظات. الأحياء والقرى تظهر بعد تنزيل خريطة المحافظة.</div>
  </div></div></div>`;
  document.body.appendChild(el);
  $('areaClose').onclick = () => el.classList.add('hidden');
  arSheetInit();
}
function openAreas(startId) {
  arEnsure();
  $('areaPanel').classList.remove('hidden');
  arSheet('min');                   // the map first; the cards come up with a tap or a swipe
  $('areaSel').innerHTML = '<div class="item"><div class="grow s">جارٍ التحميل…</div></div>';
  if (typeof loadPlaces === 'function') { const lp = loadPlaces(); if (lp && lp.then) lp.then(() => { if (!$('areaPanel').classList.contains('hidden')) arRender(); }); }
  arLoad().then(() => {
    const here = me ? arHere(me.lat, me.lng) : [];
    let target = startId || (areaScope && areaScope.id) || null;
    if (target && AR.byId[target]) {
      const chain = []; let n = AR.byId[target];
      while (n && n.id !== 'iraq') { chain.unshift(n.id); n = AR.byId[n.up]; }
      arSel = chain.pop(); arPath = chain;
    } else if (here.length) { arPath = here.slice(0, 1); arSel = here[1] || null; if (!arSel) { arPath = []; arSel = here[0]; } }
    else { arPath = []; arSel = null; }
    arRender();
  }).catch(() => { $('areaSel').innerHTML = '<div class="item"><div class="grow s">تعذّر تحميل حدود المناطق</div></div>'; });
}
function arEnter(id) { arPath.push(id); arSel = null; stSel = null; plPick = null; arRender(); arSheet('mid'); $('areaSheetBody').scrollTop = 0; }
function arUp(depth) { stSel = null; plPick = null; arSel = arPath[depth] || null; arPath = arPath.slice(0, depth); arRender(); }
function arRender() {
  const cur = arCur(), kids = arKids(cur.id), here = me ? arHere(me.lat, me.lng) : [];
  // breadcrumbs
  const crumbs = [AR.byId.iraq].concat(arPath.map((id) => AR.byId[id]));
  $('areaCrumbs').innerHTML = crumbs.map((n, i) => i === crumbs.length - 1
    ? `<b>${esc(arShort(n))}</b>` : `<button data-up="${i}">${esc(arShort(n))}</button><span class="sep">‹</span>`).join('');
  $('areaCrumbs').querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => arUp(+b.dataset.up); });
  if (arLeaf(cur) && arPath.length) { stRender(cur, here); return; }
  // the map of this level
  const selN = arSel && AR.byId[arSel];
  // a province or district map shows everything inside it: the sub-district borders and every town, neighbourhood and village
  const preview = cur.k !== 'iraq' ? arSettle(cur) : [];
  $('areaMapWrap').innerHTML = arSvg(cur, kids, here, preview, true); $('areaLegend').innerHTML = preview.length ? STL : '';
  azAttach();
  // selected area (or a tapped town / neighbourhood / village)
  const sel = arSel && AR.byId[arSel];
  if (plPick) { $('areaSel').innerHTML = placeCardHtml(plPick, arAreaOf(plPick)); placeCardBind(plPick, () => { plPick = null; arRender(); }); }
  else $('areaSel').innerHTML = sel ? arCard(sel, here) : arCard(cur, here, true);
  $('areaSel').querySelectorAll('[data-act]').forEach((b) => {
    const n = AR.byId[b.dataset.id];
    b.onclick = () => { if (b.dataset.act === 'show') areaShow(n); else if (b.dataset.act === 'in') arEnter(n.id); else if (b.dataset.act === 'search') areaSearch(n); else areaNear(n); };
  });
  // the list
  $('areaListH').textContent = kids.length ? AR_KIDS[cur.k] + ' (' + kids.length + ')' : '';
  $('areaList').parentNode.classList.toggle('hidden', !kids.length);
  $('areaList').innerHTML = kids.map((n) => {
    const sub = arKids(n.id).length, st = !sub && n.k !== 'p' ? arSettle(n) : [];
    const subTxt = sub ? sub + ' ' + AR_KIDS[n.k].replace('ال', '') : stCount(st);
    return `<div class="res provRow${n.id === arSel ? ' on' : ''}" data-pick="${n.id}"><div class="ic">${n.k === 'p' ? '🗺' : n.k === 'd' ? '🏙' : '📍'}</div><div style="flex:1;min-width:0"><div class="t">${esc(arTitle(n))}${here.includes(n.id) ? ' <span class="hereTag">📍</span>' : ''}</div><div class="s">${subTxt}</div></div>${sub || st.length ? '<div class="s" style="flex:none">‹</div>' : ''}</div>`;
  }).join('');
  $('areaList').querySelectorAll('[data-pick]').forEach((el) => {
    el.onclick = () => { arSel = el.dataset.pick; plPick = null; arRender(); arSheet('mid'); $('areaSheetBody').scrollTo({ top: 0, behavior: 'smooth' }); };
  });
}
function arCard(n, here, isCur) {
  const sub = arKids(n.id).length, inHere = here.includes(n.id);
  const bits = [];
  if (n.k !== 'iraq') bits.push(AR_KIND[n.k]);
  if (sub) bits.push(sub + ' ' + AR_KIDS[n.k].replace('ال', ''));
  const st = arLeaf(n) ? arSettle(n) : [];
  const stAll = n.k !== 'iraq' ? (st.length ? st : arSettle(n)) : [];
  if (stAll.length) bits.push(stCount(stAll));
  const cnt = n.k !== 'iraq' && typeof places !== 'undefined' && places ? placesIn(n).length : 0;
  if (cnt) bits.push(cnt.toLocaleString('en') + ' مكان في خرائطك');
  if (n.k === 'iraq') return `<div class="item"><div class="grow s">اضغط على محافظة في الخريطة أو اخترها من القائمة، ثم اضغطها مرة ثانية للدخول إلى أقضيتها</div></div>`;
  let btns = `<button class="chip go" data-act="show" data-id="${n.id}">🗺 عرض على الخريطة</button><button class="chip" data-act="search" data-id="${n.id}">🔍 ابحث فيها</button><button class="chip" data-act="near" data-id="${n.id}">🧭 اكتشف فيها</button>`;
  if (sub && !isCur) btns = `<button class="chip go" data-act="in" data-id="${n.id}">${AR_KIDS[n.k]} ‹</button>` + btns.replace('chip go', 'chip');
  else if (st.length && !isCur) btns = `<button class="chip go" data-act="in" data-id="${n.id}">الأحياء والقرى ‹</button>` + btns.replace('chip go', 'chip');
  const noMap = arLeaf(n) && !st.length && typeof packs === 'function' && !packs().length
    ? '<div class="s" style="margin-top:8px">لعرض أحيائها وقراها: نزّل خريطة المحافظة من «الخرائط بدون إنترنت».</div>' : '';
  return `<div class="areaCard"><div class="t">${esc(arTitle(n))}${inHere ? ' <span class="hereTag">📍 أنت هنا</span>' : ''}</div><div class="s">${bits.join(' · ')}</div><div class="areaBtns">${btns}</div>${noMap}</div>`;
}
/* ---------------- the zoomable area map ----------------
   The shapes are drawn once; dots and names are redrawn at every zoom so they keep the same size on screen.
   Names appear by zoom: districts and cities first, then sub-districts and towns, then neighbourhoods, then
   villages, and the English name too when zoomed right in. Names that would overlap wait for a closer zoom. */
let AZ = null;                 // {id, W, H, base, vb, sc, dots, lbls, me, leaf}
let plPick = null;             // a town / neighbourhood / village tapped on a province or district map
const AZ_PXKM = { sub: 3, town: 3, nb: 6, vil: 11, en: 16 };   // screen pixels per km from which each kind gets its name
function arSvg(cur, kids, here, dots, preview) {
  const W = 600, shapes = kids.length ? kids : [cur];
  if (!shapes[0] || !shapes[0].g) return '';
  let w = 180, e = -180, s = 90, n = -90;
  shapes.forEach((k) => { w = Math.min(w, k.b[0]); s = Math.min(s, k.b[1]); e = Math.max(e, k.b[2]); n = Math.max(n, k.b[3]); });
  const kx = Math.cos((s + n) / 2 * Math.PI / 180), sc = W / Math.max(1e-6, (e - w) * kx), H = Math.max(120, Math.ceil((n - s) * sc));
  const XY = (x, y) => [(x - w) * kx * sc, (n - y) * sc];
  const P = (x, y) => XY(x, y).map((v) => v.toFixed(1)).join(',');
  const path = (g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]).map((poly) => poly.map((r) => 'M' + r.map((c) => P(c[0], c[1])).join('L') + 'Z').join('')).join('');
  let paths = '';
  const lbls = [];
  shapes.forEach((k) => {
    const cls = 'pv' + (k.id === arSel ? ' sel' : '') + (here.includes(k.id) ? ' here' : '');
    paths += `<path class="${cls}" data-ar="${k.id}" d="${path(k.g)}"/>`;
    if (k.c) { const [x, y] = XY(k.c[0], k.c[1]); lbls.push({ x, y, t: arShort(k), cls: 'azA', fpx: 15, pr: 0, min: 0 }); }
  });
  // the sub-districts inside each district, as thin dashed lines with their names when zoomed in (a province map)
  if (cur.k === 'p') shapes.forEach((k) => arKids(k.id).forEach((c) => {
    if (!c.g) return;
    paths += `<path class="pvSub" d="${path(c.g)}"/>`;
    if (c.c) { const [x, y] = XY(c.c[0], c.c[1]); lbls.push({ x, y, t: arShort(c), cls: 'azS', fpx: 13, pr: 2, min: AZ_PXKM.sub }); }
  }));
  const D = [];
  (dots || []).forEach((p, i) => {
    if (p.lng < w || p.lng > e || p.lat < s || p.lat > n) return;
    const [x, y] = XY(p.lng, p.lat), g = ST_GROUP[p.k];
    D.push({ x, y, g, p, i, rank: ST_RANK[p.k] });
  });
  D.sort((a, b) => b.rank - a.rank);          // villages underneath, towns on top
  const content = { x: -8, y: -8, w: W + 16, h: H + 16 };
  const keep = AZ && AZ.id === cur.id && AZ.W === W;
  AZ = { id: cur.id, W, H, content, base: keep ? AZ.base : Object.assign({}, content), vb: keep ? AZ.vb : null, rot: keep ? AZ.rot : (AZ ? AZ.rot : 0) || 0, sc, dots: D, lbls, leaf: !preview, me: null };
  if (!AZ.vb) AZ.vb = Object.assign({}, AZ.base);
  AZ.geo = { w, n, kx, sc };               // drawing units ⇄ lat/lng (areas2.js)
  AZ.cur = cur;
  if (me && me.lng >= w && me.lng <= e && me.lat >= s && me.lat <= n) AZ.me = XY(me.lng, me.lat);
  const vb = AZ.vb;
  return `<div id="azBox"><svg id="areaSvg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" xmlns="http://www.w3.org/2000/svg"><g id="azRotG"><g id="azSat"></g>${paths}<g id="azStreets"></g><g id="azRoads"></g><g id="azRoute"></g><g id="azSvc"></g><g id="azMine"></g><g id="azDots"></g><g id="azMe"></g></g><g id="azLbl"></g></svg>
    <div id="azBtns"><button data-z="in" aria-label="تكبير">＋</button><button data-z="out" aria-label="تصغير">－</button><button data-z="fit" aria-label="الحجم الكامل">⤢</button><button data-z="north" aria-label="الشمال للأعلى" id="azNorth"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 3l4 9h-8z" fill="#ef4444"/><path d="M12 21l-4-9h8z" fill="#94a3b8"/></svg></button></div></div>`;
}
/* pixels on screen per unit of the drawing */
function azK() {
  const svg = $('areaSvg'); if (!svg || !AZ) return 1;
  // the layout size (not the on-screen box, which a gesture's quick preview transforms)
  return Math.min(svg.clientWidth / AZ.vb.w, svg.clientHeight / AZ.vb.h) || 1;
}
/* the map turns around the middle of the view: from drawing units to screen pixels and back */
function azXf() {
  const vb = AZ.vb, k = azK(), a = (AZ.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2, hw = vb.w * k / 2, hh = vb.h * k / 2;
  return {
    k, cx, cy,
    toS: (x, y) => { const dx = x - cx, dy = y - cy; return [(dx * c - dy * sn) * k + hw, (dx * sn + dy * c) * k + hh]; },
    toU: (sx, sy) => { const dx = (sx - hw) / k, dy = (sy - hh) / k; return [cx + dx * c + dy * sn, cy - dx * sn + dy * c]; }
  };
}
function azDraw() {
  const svg = $('areaSvg'); if (!svg || !AZ) return;
  const vb = AZ.vb, X = azXf(), k = X.k, pxkm = k * AZ.sc / 111.32, Ws = vb.w * k, Hs = vb.h * k;
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  $('azRotG').setAttribute('transform', AZ.rot ? `rotate(${AZ.rot.toFixed(2)} ${X.cx.toFixed(2)} ${X.cy.toFixed(2)})` : '');
  const nb = $('azNorth'); if (nb) { nb.firstElementChild.style.transform = `rotate(${AZ.rot || 0}deg)`; nb.classList.toggle('on', !!AZ.rot); }
  svg.style.touchAction = vb.w < AZ.base.w * 0.98 || AZ.rot ? 'none' : 'pan-y';
  const inView = (x, y, m) => { const p = X.toS(x, y); return p[0] >= -m && p[0] <= Ws + m && p[1] >= -m && p[1] <= Hs + m; };
  const R = AZ.leaf ? { town: 8, nb: 6, vil: 5 } : { town: 6, nb: 4, vil: 3.5 };
  const selP = AZ.leaf ? (stSel != null ? AZ.dots.find((d) => d.i === stSel) : null) : (plPick ? AZ.dots.find((d) => d.p === plPick) : null);
  let dd = '';
  AZ.dots.forEach((d) => {
    if (d === selP || !inView(d.x, d.y, 20)) return;
    dd += `<circle class="stDot ${d.g}" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${(R[d.g] / k).toFixed(2)}" style="stroke-width:${(1.4 / k).toFixed(2)}"/>`;
  });
  if (selP) dd += `<circle class="stDot on" cx="${selP.x.toFixed(1)}" cy="${selP.y.toFixed(1)}" r="${(10 / k).toFixed(2)}" style="stroke-width:${(4 / k).toFixed(2)}"/>`;
  $('azDots').innerHTML = dd;
  $('azMe').innerHTML = AZ.me ? `<circle class="pvMe" cx="${AZ.me[0].toFixed(1)}" cy="${AZ.me[1].toFixed(1)}" r="${(8 / k).toFixed(2)}" style="stroke-width:${(3 / k).toFixed(2)}"/>` : '';
  // the names that fit at this zoom, most important first; one that would overlap a placed one waits for a closer zoom.
  // Names stay upright however the map is turned.
  const cand = [];
  AZ.lbls.forEach((l) => { if (pxkm >= l.min && inView(l.x, l.y, 0)) cand.push(l); });
  const en = pxkm >= AZ_PXKM.en;
  AZ.dots.forEach((d) => {
    const min = d.p.k === 'city' ? 0 : d.g === 'town' ? AZ_PXKM.town : d.g === 'nb' ? AZ_PXKM.nb : AZ_PXKM.vil;
    const on = d === selP;
    if (!on && (pxkm < min || !inView(d.x, d.y, 0))) return;
    if (!on && pxkm < AZ_PXKM.sub && AZ.lbls.some((l) => l.t === d.p.n)) return;   // the district already carries this name
    cand.push({ x: d.x, y: d.y, t: d.p.n, e: en || on ? d.p.e : '', cls: 'azP ' + d.g + (on ? ' on' : ''), fpx: on ? 15 : d.g === 'town' ? 14 : 12.5, pr: on ? -1 : d.p.k === 'city' ? 1 : d.g === 'town' ? 3 : d.g === 'nb' ? 4 : 5, dot: R[d.g] + 2 });
  });
  cand.sort((a, b) => a.pr - b.pr);
  const placed = [];
  let out = '';
  cand.forEach((l) => {
    const [sx, sy] = X.toS(l.x, l.y);
    const tw = Math.max(l.t.length * 0.6, l.e ? l.e.length * 0.5 : 0) * l.fpx + 12, th = l.fpx * (l.e ? 2.4 : 1.45);
    const cy = l.dot ? sy - l.dot - th / 2 : sy;            // place names sit above their dot
    const box = [sx - tw / 2, cy - th / 2, sx + tw / 2, cy + th / 2];
    if (l.pr >= 0 && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
    placed.push(box);
    const f = (l.fpx / k).toFixed(2), x0 = vb.x + sx / k, y0 = vb.y + (cy - (l.e ? l.fpx * 0.45 : 0)) / k;
    out += `<text class="pvl ${l.cls}" style="font-size:${f}px;stroke-width:${(4 / k).toFixed(2)}px" x="${x0.toFixed(1)}" y="${y0.toFixed(1)}">${esc(l.t)}</text>`;
    if (l.e) out += `<text class="pvl azE" style="font-size:${(l.fpx * 0.78 / k).toFixed(2)}px;stroke-width:${(3.5 / k).toFixed(2)}px" x="${x0.toFixed(1)}" y="${(y0 + l.fpx * 1.05 / k).toFixed(1)}">${esc(l.e)}</text>`;
  });
  $('azLbl').innerHTML = out;
  if (typeof azExtraDraw === 'function') azExtraDraw(X);
  AZ.drawn = { vb: Object.assign({}, vb), rot: AZ.rot || 0 };
  svg.style.transform = '';
}
/* while a finger moves the map, only a quick transform of what is drawn; the full drawing follows when it stops */
function azPreview() {
  const svg = $('areaSvg'); if (!svg || !AZ || !AZ.drawn) return;
  const W = svg.clientWidth, d = AZ.drawn, v = AZ.vb;
  const kr = W / d.vb.w, kc = W / v.w, a = (AZ.rot || 0) * Math.PI / 180;
  const dx = (d.vb.x + d.vb.w / 2) - (v.x + v.w / 2), dy = (d.vb.y + d.vb.h / 2) - (v.y + v.h / 2);
  const tx = kc * (dx * Math.cos(a) - dy * Math.sin(a)), ty = kc * (dx * Math.sin(a) + dy * Math.cos(a));
  svg.style.transformOrigin = '50% 50%';
  svg.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotate(${((AZ.rot || 0) - d.rot).toFixed(2)}deg) scale(${(kc / kr).toFixed(4)})`;
}
let azRaf = 0;
function azSoon() { if (!azRaf) azRaf = requestAnimationFrame(() => { azRaf = 0; if (AZ && AZ.gesture && AZ.drawn) azPreview(); else azDraw(); }); }
function azGestureEnd() { if (AZ) { AZ.gesture = false; azSoon(); } }
/* zoom by f (and turn by dr degrees) keeping the point under the fingers where it is */
function azZoom(f, sx, sy, dr) {
  if (!AZ) return;
  const vb = AZ.vb, b = AZ.base, X = azXf(), Ws = vb.w * X.k, Hs = vb.h * X.k;
  if (sx == null) { sx = Ws / 2; sy = Hs / 2; }
  const u = X.toU(sx, sy);
  const nw = Math.min(b.w, Math.max(b.w / 3000, vb.w / f)), nh = nw * b.h / b.w, k2 = X.k * vb.w / nw;
  if (dr) AZ.rot = ((AZ.rot || 0) + dr + 540) % 360 - 180;
  const a = (AZ.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const dx = (sx - Ws / 2) / k2, dy = (sy - Hs / 2) / k2;
  const cx = u[0] - (dx * c + dy * sn), cy = u[1] - (-dx * sn + dy * c);
  AZ.vb = azClamp({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
  azSoon();
}
/* keep the middle of the view over the map */
function azClamp(v) {
  const b = AZ.base;
  if (!AZ.rot && v.w >= b.w - 1e-6) { v.x = b.x; v.y = b.y; return v; }
  const cx = Math.min(b.x + b.w, Math.max(b.x, v.x + v.w / 2)), cy = Math.min(b.y + b.h, Math.max(b.y, v.y + v.h / 2));
  v.x = cx - v.w / 2; v.y = cy - v.h / 2;
  return v;
}
/* touch and mouse: drag to move, two fingers to zoom, double tap / wheel to zoom, a tap selects */
function azFit() {
  const svg = $('areaSvg'); if (!svg || !AZ) return;
  const r = { width: svg.clientWidth, height: svg.clientHeight }; if (!r.width || !r.height) return;
  const R = r.width / r.height, c = AZ.content, b = { x: c.x, y: c.y, w: c.w, h: c.h };
  if (c.w / c.h < R) { b.w = c.h * R; b.x = c.x - (b.w - c.w) / 2; } else { b.h = c.w / R; b.y = c.y - (b.h - c.h) / 2; }
  const z = AZ.vb && AZ.base ? AZ.base.w / AZ.vb.w : 1, cx = AZ.vb ? AZ.vb.x + AZ.vb.w / 2 : b.x + b.w / 2, cy = AZ.vb ? AZ.vb.y + AZ.vb.h / 2 : b.y + b.h / 2;
  AZ.base = b;
  const w = b.w / Math.max(1, z), h = b.h / Math.max(1, z);
  AZ.vb = azClamp({ x: cx - w / 2, y: cy - h / 2, w, h });
}
function azAttach() {
  const svg = $('areaSvg'); if (!svg) return;
  azFit();
  azDraw();
  $('azBtns').onclick = (e) => {
    const z = e.target.closest('[data-z]'); if (!z) return;
    if (z.dataset.z === 'fit') { AZ.vb = Object.assign({}, AZ.base); AZ.rot = 0; azSoon(); }
    else if (z.dataset.z === 'north') { const r = AZ.rot || 0; if (r) azZoom(1, null, null, -r); }
    else azZoom(z.dataset.z === 'in' ? 2 : 0.5);
  };
  const pts = new Map();
  let start = null, moved = false, lastTap = 0, pinch = null, longT = 0, longDone = false;
  const rel = (e) => { const r = $('azBox').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  svg.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, rel(e));
    try { svg.setPointerCapture(e.pointerId); } catch (x) {}
    AZ.gesture = true;
    if (pts.size === 1) {
      start = { p: rel(e), vb: Object.assign({}, AZ.vb) }; moved = false; longDone = false;
      clearTimeout(longT); const at = rel(e);
      longT = setTimeout(() => { if (!moved && pts.size === 1 && typeof azLongPress === 'function') { longDone = true; vib('30'); azLongPress(at[0], at[1]); } }, 550);
    } else clearTimeout(longT);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), ang: Math.atan2(b[1] - a[1], b[0] - a[0]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], turning: false }; moved = true; }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, rel(e));
    if (pts.size >= 2 && pinch) {
      // two fingers: spread to zoom, twist to turn (turning starts after a clear twist, so a plain pinch does not tilt the map)
      const [a, b] = [...pts.values()], d = Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      let da = (ang - pinch.ang) * 180 / Math.PI; da = ((da + 540) % 360) - 180;
      let turn = 0;
      if (pinch.turning) turn = da; else { pinch.tw = (pinch.tw || 0) + da; if (Math.abs(pinch.tw) > 12) { pinch.turning = true; turn = pinch.tw; } }
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // move with the fingers' middle, then zoom and turn around it
      if (Math.hypot(m[0] - pinch.m[0], m[1] - pinch.m[1]) > 0.5) {
        const X = azXf(), u0 = X.toU(pinch.m[0], pinch.m[1]), u1 = X.toU(m[0], m[1]);
        AZ.vb = azClamp({ x: AZ.vb.x + u0[0] - u1[0], y: AZ.vb.y + u0[1] - u1[1], w: AZ.vb.w, h: AZ.vb.h });
      }
      azZoom(d / pinch.d, m[0], m[1], turn);
      pinch.d = d; pinch.ang = ang; pinch.m = m;
      return;
    }
    if (!start) return;
    const p = rel(e), dx = p[0] - start.p[0], dy = p[1] - start.p[1];
    if (!moved && Math.hypot(dx, dy) < 7) return;
    moved = true; clearTimeout(longT);
    // drag: the map follows the finger, also when turned
    const k = azK(), a = (AZ.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    const ux = (dx * c + dy * sn) / k, uy = (-dx * sn + dy * c) / k;
    AZ.vb = azClamp({ x: start.vb.x - ux, y: start.vb.y - uy, w: start.vb.w, h: start.vb.h });
    azSoon();
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size) { const q = [...pts.values()][0]; start = { p: q, vb: Object.assign({}, AZ.vb) }; return; }
    azGestureEnd();
    clearTimeout(longT);
    if (e.type === 'pointercancel' || moved || longDone) { start = null; longDone = false; return; }
    start = null;
    const now = Date.now();
    if (now - lastTap < 320) { lastTap = 0; azZoom(2, p[0], p[1]); return; }
    lastTap = now;
    azTap(p[0], p[1], e.clientX, e.clientY);
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('wheel', (e) => { e.preventDefault(); AZ.gesture = true; clearTimeout(AZ.wt); AZ.wt = setTimeout(azGestureEnd, 200); const p = rel(e); azZoom(e.deltaY < 0 ? 1.25 : 0.8, p[0], p[1]); }, { passive: false });
}
function azTap(sx, sy, cx, cy) {
  const X = azXf();
  // the nearest dot within a finger's reach
  let best = null, bd = 18;
  AZ.dots.forEach((d) => { const p = X.toS(d.x, d.y), dd = Math.hypot(p[0] - sx, p[1] - sy); if (dd < bd) { bd = dd; best = d; } });
  if (!best && typeof azExtraTap === 'function' && azExtraTap(sx, sy, X)) return;
  if (best) {
    if (AZ.leaf) stSel = best.i; else plPick = best.p;
    arRender(); arSheet('mid'); $('areaSheetBody').scrollTop = 0; return;
  }
  const t = document.elementFromPoint(cx, cy), a = t && t.closest && t.closest('[data-ar]');
  if (!a) { if (plPick) { plPick = null; arRender(); } return; }
  plPick = null;
  if (a.dataset.ar === arSel && (arKids(arSel).length || arSettle(AR.byId[arSel]).length)) arEnter(arSel);
  else { arSel = a.dataset.ar; arRender(); arSheet('mid'); $('areaSheetBody').scrollTop = 0; }
}
window.addEventListener('resize', () => { if ($('areaSvg')) { azFit(); azSoon(); } });

/* the cards and lists sit in a sheet over the full-screen map: pull it up (or tap its handle) to open it, down to give the map room */
const AR_SHEETS = ['min', 'mid', 'full'];
function arSheet(st) {
  const el = $('areaSheet'); if (!el) return;
  AR_SHEETS.forEach((k) => el.classList.toggle(k, k === st));
}
const arSheetNow = () => AR_SHEETS.find((k) => $('areaSheet').classList.contains(k)) || 'mid';
function arSheetInit() {
  const el = $('areaSheet'), body = $('areaSheetBody');
  $('areaGrab').onclick = () => arSheet({ min: 'mid', mid: 'full', full: 'min' }[arSheetNow()]);
  $('areaLegend').onclick = () => { if (arSheetNow() === 'min') arSheet('mid'); };
  let y0 = null, fromTop = false;
  el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; fromTop = !body.contains(e.target) || body.scrollTop <= 0; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0; y0 = null;
    const i = AR_SHEETS.indexOf(arSheetNow());
    if (dy < -40 && (i === 0 || !body.contains(e.target) || arSheetNow() !== 'full')) arSheet(AR_SHEETS[Math.min(2, i + 1)]);
    else if (dy > 50 && fromTop) arSheet(AR_SHEETS[Math.max(0, i - 1)]);
  }, { passive: true });
  // in the smallest state, touching the peeking card opens it
  body.addEventListener('click', (e) => { if (arSheetNow() === 'min' && !e.target.closest('button')) arSheet('mid'); }, true);
}

/* the card of a town / neighbourhood / village */
function placeCardHtml(p, area) {
  const kind = { city: 'مدينة', town: 'بلدة', suburb: 'حي', neighbourhood: 'حي', quarter: 'حي', village: 'قرية', hamlet: 'قرية صغيرة' }[p.k] || '';
  return `<div class="areaCard"><div class="t">${ST_HEAD[ST_GROUP[p.k]][0]} ${esc(p.n)}</div><div class="s">${[kind, area ? 'في ' + arTitle(area) : '', p.e].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="areaBtns"><button class="chip go" data-sa="route">🧭 المسار إليه</button><button class="chip" data-sa="go">🗺 عرض على الخريطة</button><button class="chip" data-sa="near">🧭 اكتشف حولها</button><button class="chip" data-sa="back">✕</button></div></div>`;
}
function placeCardBind(p, back) {
  $('areaSel').querySelector('[data-sa=go]').onclick = () => stGo(p, false);
  $('areaSel').querySelector('[data-sa=route]').onclick = () => axnRoute({ lat: p.lat, lng: p.lng, name: p.n });
  $('areaSel').querySelector('[data-sa=near]').onclick = () => stGo(p, true);
  $('areaSel').querySelector('[data-sa=back]').onclick = back;
}
/* the deepest area a place is in (for its card) */
function arAreaOf(p) {
  let id = 'iraq', last = null;
  for (;;) { const k = arKids(id).find((n) => inArea(n, p.lat, p.lng)); if (!k) return last; last = k; id = k.id; }
}

/* ---------------- the fourth level: towns, neighbourhoods and villages of a sub-district ---------------- */
function stRender(cur, here) {
  const list = arSettle(cur);
  $('areaMapWrap').innerHTML = arSvg(cur, [], here, list); $('areaLegend').innerHTML = list.length ? STL : '';
  azAttach();
  const p = stSel != null ? list[stSel] : null;
  if (p) {
    $('areaSel').innerHTML = placeCardHtml(p, cur);
    placeCardBind(p, () => { stSel = null; arRender(); });
  } else {
    $('areaSel').innerHTML = arCard(cur, here, true);
    $('areaSel').querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => { if (b.dataset.act === 'show') areaShow(cur); else if (b.dataset.act === 'search') areaSearch(cur); else areaNear(cur); };
    });
  }
  $('areaListH').textContent = list.length ? 'الأحياء والقرى (' + list.length + ')' : '';
  $('areaList').parentNode.classList.toggle('hidden', !list.length);
  let h = '', last = '';
  list.forEach((q, i) => {
    const g = ST_GROUP[q.k];
    if (g !== last) { last = g; h += `<div class="stHead">${ST_HEAD[g][0]} ${ST_HEAD[g][1]} (${list.filter((x) => ST_GROUP[x.k] === g).length})</div>`; }
    h += `<div class="res provRow${i === stSel ? ' on' : ''}" data-sp="${i}"><div class="ic">${ST_HEAD[g][0]}</div><div style="flex:1;min-width:0"><div class="t">${esc(q.n)}</div>${q.e ? `<div class="s">${esc(q.e)}</div>` : ''}</div></div>`;
  });
  $('areaList').innerHTML = h;
  $('areaList').querySelectorAll('[data-sp]').forEach((el) => {
    el.onclick = () => { stSel = +el.dataset.sp; arRender(); arSheet('mid'); $('areaSheetBody').scrollTo({ top: 0, behavior: 'smooth' }); };
  });
}
function stGo(p, near) {
  $('areaPanel').classList.add('hidden');
  if (typeof closeSearch === 'function') closeSearch();
  setDestination(p.lat, p.lng, p.n, [p.a, p.e].filter(Boolean).join(' · '));
  if (near) { if (typeof homeExpand === 'function') homeExpand(true); toast('اختر نوع المكان من «اكتشف ما حولك»', 3500); }
}

/* ---------------- on the map ---------------- */
function placesIn(n) {
  if (typeof places === 'undefined' || !places) return [];
  return places.filter((p) => inArea(n, p.lat, p.lng));
}
/* on the main map: the chosen area's towns, neighbourhoods and villages with their names — more of them as you zoom in */
const areaPlLayer = L.layerGroup().addTo(map);
let areaPlList = [];
const APL_Z = { city: 0, town: 10, nb: 13, vil: 14, en: 15 };
function areaPlDraw() {
  areaPlLayer.clearLayers();
  if (!areaScope || !areaPlList.length) return;
  const z = map.getZoom(), b = map.getBounds().pad(0.15), size = map.getSize();
  const placed = [];
  let n = 0;
  for (const p of areaPlList) {             // already in order of importance (cities, towns, neighbourhoods, villages)
    const g = ST_GROUP[p.k], min = p.k === 'city' ? APL_Z.city : APL_Z[g];
    if (z < min || !b.contains([p.lat, p.lng])) continue;
    const pt = map.latLngToContainerPoint([p.lat, p.lng]);
    const en = z >= APL_Z.en && p.e;
    const tw = Math.max(p.n.length, en ? p.e.length * 0.8 : 0) * 7.5 + 14, th = en ? 34 : 20;
    const box = [pt.x - tw / 2, pt.y - th - 6, pt.x + tw / 2, pt.y + 4];
    if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
    if (pt.x < -50 || pt.y < -50 || pt.x > size.x + 50 || pt.y > size.y + 50) continue;
    placed.push(box);
    const icon = L.divIcon({ className: 'apl apl-' + g, iconSize: [0, 0], html: `<i></i><span>${esc(p.n)}${en ? `<small>${esc(p.e)}</small>` : ''}</span>` });
    L.marker([p.lat, p.lng], { icon, keyboard: false, zIndexOffset: g === 'town' ? 300 : g === 'nb' ? 200 : 100 })
      .on('click', () => setDestination(p.lat, p.lng, p.n, [p.a, p.e].filter(Boolean).join(' · '))).addTo(areaPlLayer);
    if (++n >= 250) break;
  }
}
map.on('zoomend moveend', () => { if (areaScope) areaPlDraw(); });
function areaPlSet() {
  areaPlList = areaScope ? arSettle(areaScope).slice() : [];
  areaPlDraw();
  if (areaScope && !areaPlList.length && typeof loadPlaces === 'function') {
    const lp = loadPlaces(), want = areaScope;
    if (lp && lp.then) lp.then(() => { if (areaScope === want) { areaPlList = arSettle(want).slice(); areaPlDraw(); } });
  }
}
function areaSet(n) {
  areaScope = n && n.k !== 'iraq' ? n : null;
  window.placeFilter = areaScope ? (p) => inArea(areaScope, p.lat, p.lng) : null;
  areaLayer.clearLayers();
  setTimeout(areaPlSet, 0);
  let chip = $('areaChip');
  if (!areaScope) { if (chip) chip.classList.add('hidden'); document.body.classList.remove('area-on'); qEl.placeholder = 'إلى أين؟'; return; }
  L.geoJSON(areaScope.g, { interactive: false, style: { color: '#38bdf8', weight: 3, opacity: 0.95, dashArray: '9 7', fillColor: '#38bdf8', fillOpacity: 0.06 } }).addTo(areaLayer);
  if (!chip) {
    chip = document.createElement('div'); chip.id = 'areaChip';
    chip.innerHTML = '<button id="areaChipT"></button><button id="areaChipX" aria-label="إلغاء">✕</button>';
    document.body.appendChild(chip);
    $('areaChipT').onclick = () => openAreas(areaScope && areaScope.id);
    $('areaChipX').onclick = () => areaSet(null);
  }
  $('areaChipT').textContent = '📍 ' + arTitle(areaScope);
  chip.classList.remove('hidden'); document.body.classList.add('area-on');
}
function areaShow(n) {
  $('areaPanel').classList.add('hidden');
  if (typeof closeSearch === 'function') closeSearch();
  if (typeof homeExpand === 'function') homeExpand(false);
  areaSet(n);
  const b = n.b;
  map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [40, 40] });
}
function areaSearch(n) {
  areaShow(n);
  if (typeof homeExpand === 'function') homeExpand(true);
  qEl.value = ''; qEl.placeholder = 'ابحث في ' + arTitle(n) + '…';
  qEl.focus();
  arTopPlaces();
}
function areaNear(n) {
  areaShow(n);
  if (typeof homeExpand === 'function') homeExpand(true);
  toast('اختر نوع المكان من «اكتشف ما حولك» — ستظهر الأماكن داخل ' + arTitle(n) + ' فقط', 4500);
}
/* with an area chosen and nothing typed yet: its cities, towns and villages */
function arTopPlaces() {
  if (!areaScope) return false;
  const rank = { city: 0, town: 1, suburb: 2, village: 3, neighbourhood: 4, quarter: 4, hamlet: 5 };
  const list = placesIn(areaScope).filter((p) => rank[p.k] != null).sort((a, b) => rank[a.k] - rank[b.k] || a.n.localeCompare(b.n, 'ar')).slice(0, 40);
  if (!list.length) return false;
  resEl.innerHTML = `<div class="secTitle">مدن وقرى وأحياء في ${esc(arTitle(areaScope))}</div>` + list.map((p, i) =>
    `<div class="res" data-arp="${i}"><div class="ic">${{ city: '🏙', town: '🏘', village: '🏡' }[p.k] || '📍'}</div><div style="flex:1;min-width:0"><div class="t">${esc(p.n)}</div><div class="s">${esc([p.a, p.e].filter(Boolean).join(' · '))}</div></div></div>`).join('');
  resEl.classList.remove('hidden');
  resEl.querySelectorAll('[data-arp]').forEach((el) => {
    el.onclick = () => { const p = list[+el.dataset.arp]; closeSearch(); setDestination(p.lat, p.lng, p.n, [p.a, p.e].filter(Boolean).join(' · ')); };
  });
  return true;
}
const _showRecentsAr = showRecents;
showRecents = function () { if (arTopPlaces()) return; _showRecentsAr(); };
qEl.addEventListener('blur', () => { if (!areaScope) qEl.placeholder = 'إلى أين؟'; });

function areasHandleBack() {
  const p = $('areaPanel');
  if (p && !p.classList.contains('hidden')) {
    if (arPath.length) arUp(arPath.length - 1); else p.classList.add('hidden');
    return true;
  }
  return false;
}
{ const c = $('chipAreas'); if (c) c.onclick = () => openAreas(); }
