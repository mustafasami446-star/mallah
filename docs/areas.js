'use strict';
/* الملاح — استكشف المناطق: العراق ← المحافظة ← القضاء ← الناحية.
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
    <div class="card" id="areaSel"></div>
    <div class="card"><h3 id="areaListH"></h3><div id="areaList"></div></div>
    <div class="note">حدود الأقضية والنواحي من OpenStreetMap، وقد تكون تقريبية أو ناقصة في بعض المحافظات.</div>
  </div>`;
  document.body.appendChild(el);
  $('areaClose').onclick = () => el.classList.add('hidden');
  $('areaMapWrap').addEventListener('click', (e) => {
    const t = e.target.closest('[data-ar]');
    if (!t) return;
    if (t.dataset.ar === arSel && arKids(arSel).length) arEnter(arSel);
    else { arSel = t.dataset.ar; arRender(); }
  });
}
function openAreas(startId) {
  arEnsure();
  $('areaPanel').classList.remove('hidden');
  $('areaSel').innerHTML = '<div class="item"><div class="grow s">جارٍ التحميل…</div></div>';
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
function arEnter(id) { arPath.push(id); arSel = null; arRender(); $('areaBody').scrollTop = 0; }
function arUp(depth) { arSel = arPath[depth] || null; arPath = arPath.slice(0, depth); arRender(); }
function arRender() {
  const cur = arCur(), kids = arKids(cur.id), here = me ? arHere(me.lat, me.lng) : [];
  // breadcrumbs
  const crumbs = [AR.byId.iraq].concat(arPath.map((id) => AR.byId[id]));
  $('areaCrumbs').innerHTML = crumbs.map((n, i) => i === crumbs.length - 1
    ? `<b>${esc(arShort(n))}</b>` : `<button data-up="${i}">${esc(arShort(n))}</button><span class="sep">‹</span>`).join('');
  $('areaCrumbs').querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => arUp(+b.dataset.up); });
  // the map of this level
  $('areaMapWrap').innerHTML = arSvg(cur, kids, here);
  // selected area
  const sel = arSel && AR.byId[arSel];
  $('areaSel').innerHTML = sel ? arCard(sel, here) : arCard(cur, here, true);
  $('areaSel').querySelectorAll('[data-act]').forEach((b) => {
    const n = AR.byId[b.dataset.id];
    b.onclick = () => { if (b.dataset.act === 'show') areaShow(n); else if (b.dataset.act === 'in') arEnter(n.id); else if (b.dataset.act === 'search') areaSearch(n); else areaNear(n); };
  });
  // the list
  $('areaListH').textContent = kids.length ? AR_KIDS[cur.k] + ' (' + kids.length + ')' : '';
  $('areaList').parentNode.classList.toggle('hidden', !kids.length);
  $('areaList').innerHTML = kids.map((n) => {
    const sub = arKids(n.id).length;
    return `<div class="res provRow${n.id === arSel ? ' on' : ''}" data-pick="${n.id}"><div class="ic">${n.k === 'p' ? '🗺' : n.k === 'd' ? '🏙' : '📍'}</div><div style="flex:1;min-width:0"><div class="t">${esc(arTitle(n))}${here.includes(n.id) ? ' <span class="hereTag">📍</span>' : ''}</div><div class="s">${sub ? sub + ' ' + AR_KIDS[n.k].replace('ال', '') : ''}</div></div>${sub ? '<div class="s" style="flex:none">‹</div>' : ''}</div>`;
  }).join('');
  $('areaList').querySelectorAll('[data-pick]').forEach((el) => {
    el.onclick = () => { arSel = el.dataset.pick; arRender(); $('areaBody').scrollTo({ top: 0, behavior: 'smooth' }); };
  });
}
function arCard(n, here, isCur) {
  const sub = arKids(n.id).length, inHere = here.includes(n.id);
  const bits = [];
  if (n.k !== 'iraq') bits.push(AR_KIND[n.k]);
  if (sub) bits.push(sub + ' ' + AR_KIDS[n.k].replace('ال', ''));
  const cnt = n.k !== 'iraq' && typeof places !== 'undefined' && places ? placesIn(n).length : 0;
  if (cnt) bits.push(cnt.toLocaleString('en') + ' مكان في خرائطك');
  if (n.k === 'iraq') return `<div class="item"><div class="grow s">اضغط على محافظة في الخريطة أو اخترها من القائمة، ثم اضغطها مرة ثانية للدخول إلى أقضيتها</div></div>`;
  let btns = `<button class="chip go" data-act="show" data-id="${n.id}">🗺 عرض على الخريطة</button><button class="chip" data-act="search" data-id="${n.id}">🔍 ابحث فيها</button><button class="chip" data-act="near" data-id="${n.id}">🧭 اكتشف فيها</button>`;
  if (sub && !isCur) btns = `<button class="chip go" data-act="in" data-id="${n.id}">${AR_KIDS[n.k]} ‹</button>` + btns.replace('chip go', 'chip');
  return `<div class="areaCard"><div class="t">${esc(arTitle(n))}${inHere ? ' <span class="hereTag">📍 أنت هنا</span>' : ''}</div><div class="s">${bits.join(' · ')}</div><div class="areaBtns">${btns}</div></div>`;
}
function arSvg(cur, kids, here) {
  const W = 600, shapes = kids.length ? kids : [cur];
  if (!shapes[0] || !shapes[0].g) return '';
  let w = 180, e = -180, s = 90, n = -90;
  shapes.forEach((k) => { w = Math.min(w, k.b[0]); s = Math.min(s, k.b[1]); e = Math.max(e, k.b[2]); n = Math.max(n, k.b[3]); });
  const kx = Math.cos((s + n) / 2 * Math.PI / 180), sc = W / Math.max(1e-6, (e - w) * kx), H = Math.max(120, Math.ceil((n - s) * sc));
  const P = (x, y) => ((x - w) * kx * sc).toFixed(1) + ',' + ((n - y) * sc).toFixed(1);
  const path = (g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]).map((poly) => poly.map((r) => 'M' + r.map((c) => P(c[0], c[1])).join('L') + 'Z').join('')).join('');
  let paths = '', labels = '';
  const fs = Math.max(13, Math.min(22, 260 / Math.sqrt(shapes.length + 1)));
  shapes.forEach((k) => {
    const cls = 'pv' + (k.id === arSel ? ' sel' : '') + (here.includes(k.id) ? ' here' : '');
    paths += `<path class="${cls}" data-ar="${k.id}" d="${path(k.g)}"/>`;
    const wpx = (k.b[2] - k.b[0]) * kx * sc, hpx = (k.b[3] - k.b[1]) * sc;
    if (k.c && shapes.length > 1 && (wpx < arShort(k).length * fs * 0.42 || hpx < fs * 0.9)) return;   // too small to label: it is in the list below
    if (k.c) { const [x, y] = P(k.c[0], k.c[1]).split(','); labels += `<text class="pvl" style="font-size:${fs}px" x="${x}" y="${y}">${esc(arShort(k))}</text>`; }
  });
  let meDot = '';
  if (me && me.lng >= w && me.lng <= e && me.lat >= s && me.lat <= n) { const [x, y] = P(me.lng, me.lat).split(','); meDot = `<circle class="pvMe" cx="${x}" cy="${y}" r="9"/>`; }
  return `<svg id="areaSvg" viewBox="-8 -8 ${W + 16} ${H + 16}" xmlns="http://www.w3.org/2000/svg">${paths}${meDot}${labels}</svg>`;
}

/* ---------------- on the map ---------------- */
function placesIn(n) {
  if (typeof places === 'undefined' || !places) return [];
  return places.filter((p) => inArea(n, p.lat, p.lng));
}
function areaSet(n) {
  areaScope = n && n.k !== 'iraq' ? n : null;
  window.placeFilter = areaScope ? (p) => inArea(areaScope, p.lat, p.lng) : null;
  areaLayer.clearLayers();
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
