'use strict';
/* الملاح — الملاحة على خريطة «استكشف المناطق».
   1) المسار إلى أي منطقة أو حي أو قرية أو خدمة يُرسم على خريطة المناطق: المسافة والوقت، والطرق، والأقضية والنواحي التي يمر بها.
   2) أثناء الملاحة: زر ◈ يعرض الرحلة على خريطة المناطق — تتبعك وتدور مع اتجاهك، مع الإرشاد والصوت، وتنبيه عند دخول ناحية جديدة. */

const AXN = { r: null, to: null, mode: store.get('axnMode', 'car'), live: false, follow: true, pausedAt: 0, lastLeaf: null, lastProv: null, routeKey: '', timer: 0 };

/* the place to go for an area: its main town if it has one, else its middle */
function axnTargetOf(n) {
  const st = arSettle(n).filter((p) => p.k === 'city' || p.k === 'town');
  const short = axNorm(arShort(n));
  const best = st.find((p) => axNorm(p.n) === short) || st.find((p) => p.k === 'city') || st[0];
  if (best) return { lat: best.lat, lng: best.lng, name: best.n };
  return { lat: n.c[1], lng: n.c[0], name: arTitle(n) };
}
/* the areas a route passes through, in order (districts, or sub-districts for a short trip) */
function axnPasses(r) {
  const out = [], seen = new Set(), short = r.total < 60000;
  for (let k = 0, next = 0; k < r.pts.length; k++) {
    if (r.cum[k] < next && k !== r.pts.length - 1) continue;
    next = r.cum[k] + Math.max(1500, r.total / 60);
    let a = arAreaOf({ lat: r.pts[k][0], lng: r.pts[k][1] });
    if (!a) continue;
    if (!short) while (a && a.k === 's' && AR.byId[a.up]) a = AR.byId[a.up];
    if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  }
  return out;
}
/* the main roads of a route, by the distance driven on each */
function axnVia(r) {
  const by = {}, first = {};
  r.steps.forEach((s, i) => { const nm = s.name || s.ref; if (!nm) return; const d = (r.steps[i + 1] ? r.steps[i + 1]._at : r.total) - (s._at || 0); by[nm] = (by[nm] || 0) + d; if (first[nm] == null) first[nm] = i; });
  // the three longest, in the order you drive them
  return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).filter((x) => x[1] > r.total * 0.08).map((x) => x[0]).sort((a, b) => first[a] - first[b]);
}
/* the deepest area that holds both ends: the view that shows the whole trip */
function axnCommon(a, b) {
  const ca = a ? axChain(a) : [], cb = b ? axChain(b) : [], out = [];
  for (let i = 0; i < Math.min(ca.length, cb.length) && ca[i] === cb[i]; i++) out.push(ca[i]);
  return out;
}

/* ---------------- 1. the route on the areas map ---------------- */
async function axnRoute(to) {
  if (!me) { toast('بانتظار تحديد موقعك…'); startLocation(); return; }
  AXN.to = to;
  toast('🧭 جارٍ حساب المسار إلى ' + to.name + '…', 2500);
  let r;
  try { r = await fetchRoute(AXN.mode, [me.lat, me.lng], [to.lat, to.lng]); }
  catch (e) { toast(navigator.onLine === false && !(typeof roadsReady === 'function' && roadsReady()) ? 'لا يوجد إنترنت ولا بيانات طرق منزّلة لهذه المنطقة' : 'تعذّر حساب المسار', 4000); return; }
  AXN.r = r; AXN.routeKey = '';
  // a view that holds the whole trip
  arPath = axnCommon(arAreaOf({ lat: me.lat, lng: me.lng }), arAreaOf(to));
  arSel = null; stSel = null; plPick = null;
  if (AZ) AZ.rot = 0;
  arRender();
  axnFit();
  arSheet('min');
}
function axnFit() {
  if (!AZ || !AXN.r) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  AXN.r.pts.forEach((p) => { const [x, y] = axXY(p[0], p[1]); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  const b = AZ.base, pad = 1.35, need = Math.max((x1 - x0) * pad / b.w, (y1 - y0) * pad * 1.25 / b.h, 1 / 40);
  const w = Math.min(b.w, b.w * need), h = w * b.h / b.w;
  AZ.vb = azClamp({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h * 0.45, w, h });
  azSoon();
}
function axnClear() { AXN.r = null; AXN.to = null; const b = $('axnBar'); if (b) b.remove(); const g = $('azRoute'); if (g) g.innerHTML = ''; azSoon(); }
function axnBar() {
  const box = $('azBox'); if (!box) return;
  let b = $('axnBar');
  if (!AXN.r || AXN.live) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'axnBar'; box.appendChild(b); }
  const r = AXN.r, via = axnVia(r), passes = axnPasses(r);
  b.innerHTML = `<div class="axnTop"><b>🧭 ${esc(AXN.to.name)}</b><button data-n="x" aria-label="إغلاق">✕</button></div>
    <div class="axnModes"><button data-n="car" class="${AXN.mode === 'car' ? 'on' : ''}">🚗</button><button data-n="foot" class="${AXN.mode === 'foot' ? 'on' : ''}">🚶</button>
      <span class="axnSum"><b>${fmtDist(r.total)}</b> · ${fmtDur(r.duration)}${r.offline ? ' · 📴' : ''}</span></div>
    ${via.length ? '<div class="s">🛣 عبر ' + via.map(esc).join(' ← ') + '</div>' : ''}
    ${passes.length > 1 ? '<div class="s">◈ يمر بـ ' + passes.map((a) => esc(arShort(a))).join(' ← ') + '</div>' : ''}
    <button class="btn axnGo" data-n="go">▶ ابدأ الملاحة</button>`;
  b.onclick = async (e) => {
    const x = e.target.closest('[data-n]'); if (!x) return;
    const k = x.dataset.n;
    if (k === 'x') axnClear();
    else if (k === 'car' || k === 'foot') { if (AXN.mode !== k) { AXN.mode = k; store.set('axnMode', k); axnRoute(AXN.to); } }
    else if (k === 'go') axnStart();
  };
}
/* start the usual navigation with this route, then (if asked) show it here */
async function axnStart(live) {
  const to = AXN.to, r = AXN.r; if (!to || !r) return;
  mode = AXN.mode; store.set('mode', mode);
  $('areaPanel').classList.add('hidden');
  setDestination(to.lat, to.lng, to.name, '');
  routes[mode] = r;                                   // the route already found; the usual one replaces it when ready
  for (let i = 0; i < 60 && (!routes[mode] || $('startBtn').disabled); i++) await new Promise((ok) => setTimeout(ok, 250));
  if (!routes[mode]) routes[mode] = r;
  $('startBtn').disabled = false;
  $('startBtn').click();
  if (live) setTimeout(axnLiveOn, 600);
}

/* ---------------- drawing (called from azDraw) ---------------- */
function axnDraw(X) {
  const g = $('azRoute'); if (!g) return;
  const r = AXN.live && typeof navState !== 'undefined' && navState ? navState.r : AXN.r;
  if (!r) { if (g.innerHTML) g.innerHTML = ''; AXN.routeKey = ''; return; }
  const from = AXN.live && navState ? navState.along : 0;
  const key = (r.pts.length + '|' + r.total) + '|' + Math.round(from / 50) + '|' + AZ.id;
  const k = X.k;
  if (key !== AXN.routeKey) {
    AXN.routeKey = key;
    let d = '', started = false;
    for (let i = 0; i < r.pts.length; i++) {
      if (r.cum[i + 1] != null && r.cum[i + 1] < from) continue;
      const [x, y] = axXY(r.pts[i][0], r.pts[i][1]); d += (started ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); started = true;
    }
    const end = r.pts[r.pts.length - 1], [ex, ey] = axXY(end[0], end[1]), [sx, sy] = axXY(r.pts[0][0], r.pts[0][1]);
    g.innerHTML = `<path class="axnCase" d="${d}"/><path class="axnLine${AXN.mode === 'foot' && !AXN.live ? ' foot' : ''}" d="${d}"/>`
      + (AXN.live ? '' : `<circle class="axnStart" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="1"/>`) + `<circle class="axnEnd" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="1"/>`;
  }
  g.querySelectorAll('circle').forEach((c) => { c.setAttribute('r', ((c.classList.contains('axnEnd') ? 9 : 6) / k).toFixed(2)); c.style.strokeWidth = (3 / k).toFixed(2); });
  // in the live view: an arrow for you, pointing where you go
  if (AXN.live && me) {
    const [x, y] = axXY(me.lat, me.lng), s = 13 / k, h = me.heading != null ? me.heading : 0;
    $('azMe').innerHTML = `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${h.toFixed(1)})"><circle r="${(s * 1.25).toFixed(2)}" class="axnHalo"/><path class="axnArrow" d="M0,${(-s).toFixed(2)} L${(s * 0.75).toFixed(2)},${(s * 0.8).toFixed(2)} L0,${(s * 0.35).toFixed(2)} L${(-s * 0.75).toFixed(2)},${(s * 0.8).toFixed(2)}Z" style="stroke-width:${(2 / k).toFixed(2)}"/></g>`;
  }
}
function axnAfterRender() { axnBar(); }

/* ---------------- 2. the live view while navigating ---------------- */
function axnLiveOn() {
  if (typeof navState === 'undefined' || !navState || !me) { toast('ابدأ الملاحة أولًا'); return; }
  AXN.live = true; AXN.follow = true; AXN.lastLeaf = null; AXN.mode = mode;
  document.body.classList.add('azLive');
  const leaf = arAreaOf({ lat: me.lat, lng: me.lng });
  const ch = leaf ? axChain(leaf) : [];
  AXN.lastProv = ch[0] || null;
  openAreas(ch[0] || undefined);
  setTimeout(() => {
    arPath = ch.slice(0, 1); arSel = null; stSel = null; plPick = null;
    arRender(); arSheet('min');
    axnZoomTo(25);
    axnTick();
  }, 50);
  clearInterval(AXN.timer); AXN.timer = setInterval(axnTick, 1000);
  const c = $('areaClose'); if (c && !c.dataset.axn) { c.dataset.axn = 1; c.addEventListener('click', () => { if (AXN.live) axnLiveOff(true); }); }
  axnLiveButtons();
}
function axnLiveOff(keepPanel) {
  AXN.live = false; clearInterval(AXN.timer);
  document.body.classList.remove('azLive');
  if (AZ) AZ.rot = 0;
  if (!keepPanel) $('areaPanel').classList.add('hidden');
  const b = $('axnLiveBtns'); if (b) b.remove();
  AXN.routeKey = ''; if ($('azMe')) azSoon();
}
/* zoom to a scale given in screen pixels per km */
function axnZoomTo(pxkm) {
  if (!AZ) return;
  const svg = $('areaSvg'); if (!svg) return;
  const Ws = svg.getBoundingClientRect().width, k = pxkm * 111.32 / AZ.sc;
  const w = Math.min(AZ.base.w, Ws / k), h = w * AZ.base.h / AZ.base.w;
  AZ.vb = { x: AZ.vb.x + AZ.vb.w / 2 - w / 2, y: AZ.vb.y + AZ.vb.h / 2 - h / 2, w, h };
}
function axnTick() {
  if (!AXN.live) return;
  if (typeof navState === 'undefined' || !navState) { axnLiveOff(); toast('انتهت الملاحة'); return; }
  if (!me || !AZ || !$('areaSvg')) return;
  // a new province: draw it
  const leaf = arAreaOf({ lat: me.lat, lng: me.lng }), ch = leaf ? axChain(leaf) : [];
  if (ch[0] && ch[0] !== AXN.lastProv) { AXN.lastProv = ch[0]; arPath = [ch[0]]; arRender(); arSheet('min'); axnZoomTo(25); }
  // entering a new sub-district or district: say it once
  if (leaf && leaf.id !== AXN.lastLeaf) {
    if (AXN.lastLeaf) {
      const d = AR.byId[leaf.up], v = WX.data ? wxValues(leaf.id) : null;
      const txt = 'دخلت ' + arTitle(leaf) + (d && d.k !== 'p' && leaf.k === 's' ? '، ' + arTitle(d) : '');
      toast('◈ ' + txt + (v && v.t != null ? ' · 🌡 ' + v.t + '°' : ''), 5000);
      say(txt);
    }
    AXN.lastLeaf = leaf.id;
  }
  // follow, heading up
  if (AXN.follow || Date.now() - AXN.pausedAt > 12000) {
    AXN.follow = true;
    const [x, y] = axXY(me.lat, me.lng), vb = AZ.vb;
    if (me.heading != null && (me.speed == null || me.speed > 1.5)) AZ.rot = -me.heading;
    // you sit a little below the middle, so more of the road ahead shows
    const a = (AZ.rot || 0) * Math.PI / 180, dy = vb.h * 0.2;
    const cx = x - dy * Math.sin(a), cy = y - dy * Math.cos(a);
    AZ.vb = { x: cx - vb.w / 2, y: cy - vb.h / 2, w: vb.w, h: vb.h };
  }
  azSoon();
  const fb = $('axnFollow'); if (fb) fb.classList.toggle('hidden', AXN.follow);
}
function axnLiveButtons() {
  let b = $('axnLiveBtns'); if (b) b.remove();
  b = document.createElement('div'); b.id = 'axnLiveBtns';
  b.innerHTML = `<button id="axnFollow" class="hidden">⌖ تابعني</button><button id="axnBack">🗺 الخريطة العادية</button>`;
  document.body.appendChild(b);
  $('axnBack').onclick = () => axnLiveOff();
  $('axnFollow').onclick = () => { AXN.follow = true; axnTick(); };
}
/* a finger on the map in the live view pauses following for a few seconds */
document.addEventListener('pointerdown', (e) => { if (AXN.live && e.target.closest && e.target.closest('#areaSvg')) { AXN.follow = false; AXN.pausedAt = Date.now(); } }, true);
/* the button in the navigation bar */
{
  const nb = $('navBottom'), steps = $('navStepsBtn');
  if (nb && steps) {
    const b = document.createElement('button'); b.className = 'btn ghost small'; b.id = 'navAreasBtn'; b.setAttribute('aria-label', 'خريطة المناطق');
    b.innerHTML = '<span style="font-size:20px;line-height:1">◈</span>';
    nb.insertBefore(b, steps);
    b.onclick = () => (AXN.live ? axnLiveOff() : axnLiveOn());
  }
}
