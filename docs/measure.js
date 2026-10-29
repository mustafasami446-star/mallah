'use strict';
/* الملاح — قياس المساحة والمسافة: رسم الزوايا، المستطيل السريع، المشي بالـ GPS، الخط */

var measActive = false;
const M = { mode: 'poly', pts: [], sig: [], walkRec: false, editId: null };
const mLayer = L.layerGroup().addTo(map);
let mVerts = [];                      // draggable vertex markers
let measures = store.get('measures', []);
const MODE_HINT = {
  poly: 'اضغط على زوايا الأرض بالترتيب حولها (مع أو عكس عقارب الساعة). اسحب أي نقطة لتعديلها.',
  rect: '١) اضغط بداية الطول ثم نهايته  ٢) اضغط نقطة على الضلع المقابل لتحديد العرض.',
  walk: 'قف على كل زاوية واضغط «📍 زاوية هنا»، أو شغّل التسجيل المستمر وامشِ على الحدود.',
  line: 'اضغط النقاط على طول الخط (أنبوب، سياج، طريق) لقياس طوله.'
};
const MEAS_MODE_AR = { poly: 'زوايا', rect: 'مستطيل', walk: 'مشي GPS', line: 'مسافة' };

/* ---------- geometry ---------- */
/* WGS84 ellipsoid radii at a latitude — exact for land-sized areas (well under 0.05% error up to tens of km) */
function radii(latDeg) {
  const a = 6378137, e2 = 0.00669437999014, s = Math.sin(latDeg * rad), w = 1 - e2 * s * s;
  return { M: a * (1 - e2) / Math.pow(w, 1.5), N: a / Math.sqrt(w) };
}
function localXY(pts) {
  const lat0 = pts.reduce((t, p) => t + p[0], 0) / pts.length, lng0 = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  const { M, N } = radii(lat0), c = Math.cos(lat0 * rad);
  return pts.map((p) => [(p[1] - lng0) * rad * N * c, (p[0] - lat0) * rad * M]);
}
function geoArea(pts) {
  if (pts.length < 3) return 0;
  const P = localXY(pts); let a = 0;
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; a += P[i][0] * P[j][1] - P[j][0] * P[i][1]; }
  return Math.abs(a / 2);
}
function mDist(p, q) {
  const { M, N } = radii((p[0] + q[0]) / 2);
  return Math.hypot((q[1] - p[1]) * rad * N * Math.cos((p[0] + q[0]) / 2 * rad), (q[0] - p[0]) * rad * M);
}
function perimeter(pts, closed) { let d = 0; for (let i = 1; i < pts.length; i++) d += mDist(pts[i - 1], pts[i]); if (closed && pts.length > 2) d += mDist(pts[pts.length - 1], pts[0]); return d; }
/* 1-sigma area uncertainty from independent point errors */
function areaSigma(pts, sig) {
  if (pts.length < 3) return 0;
  const P = localXY(pts), n = P.length; let v = 0;
  for (let i = 0; i < n; i++) { const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], s = sig[i] || 0; v += s * s * ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) / 4; }
  return Math.sqrt(v);
}
function toXY(p, o) { return [(p[1] - o[1]) * rad * R * Math.cos(o[0] * rad), (p[0] - o[0]) * rad * R]; }
function fromXY(xy, o) { return [o[0] + xy[1] / (R * rad), o[1] + xy[0] / (R * rad * Math.cos(o[0] * rad))]; }
function rectCorners(A, B, C) {
  const b = toXY(B, A), c = toXY(C, A), L = Math.hypot(b[0], b[1]);
  if (L < 0.01) return null;
  const u = [b[0] / L, b[1] / L], n = [-u[1], u[0]], w = c[0] * n[0] + c[1] * n[1];
  return { corners: [A, B, fromXY([b[0] + w * n[0], b[1] + w * n[1]], A), fromXY([w * n[0], w * n[1]], A)], L, W: Math.abs(w) };
}
function selfIntersects(pts) {
  const n = pts.length; if (n < 4) return false;
  const o = pts[0], P = pts.map((p) => toXY(p, o));
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inter = (a, b, c, d) => (cross(a, b, c) * cross(a, b, d) < 0) && (cross(c, d, a) * cross(c, d, b) < 0);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (inter(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return true;
  }
  return false;
}
function mpp() { const c = map.getCenter(); return 40075016.686 * Math.cos(c.lat * rad) / Math.pow(2, map.getZoom() + 8); }

/* ---------- units ---------- */
function nf(v, d) { return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }); }
function fmtArea(a) {
  if (a >= 1e6) return nf(a / 1e6, 3) + ' كم²';
  return nf(a, a < 100 ? 1 : 0) + ' م²';
}
function areaUnits(a) {
  const parts = [nf(a / 2500, a < 2500 ? 3 : 2) + ' دونم', nf(a / 10000, a < 10000 ? 4 : 2) + ' هكتار'];
  if (a >= 1e6) parts.push(nf(a, 0) + ' م²');
  return parts.join(' · ');
}
function fmtLen(m) { return m < 1000 ? nf(m, m < 10 ? 2 : 1) + ' م' : nf(m / 1000, 3) + ' كم'; }

/* ---------- drawing ---------- */
function shapePts() {
  if (M.mode === 'rect') {
    if (M.pts.length === 3) { const r = rectCorners(M.pts[0], M.pts[1], M.pts[2]); return r ? r.corners : M.pts.slice(0, 2); }
    return M.pts.slice();
  }
  return M.pts.slice();
}
function isClosed() { return M.mode !== 'line'; }
function edgeLabel(a, b, txt, cls) {
  return L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { interactive: false, icon: L.divIcon({ className: 'mLbl' + (cls ? ' ' + cls : ''), html: '<span>' + txt + '</span>', iconSize: [0, 0] }) });
}
function redraw() {
  mLayer.clearLayers();
  const S = shapePts(), n = S.length;
  if (n >= 2) {
    const ring = isClosed() && n >= 3;
    const style = { color: '#facc15', weight: 3, opacity: 1, interactive: false, fillColor: '#facc15', fillOpacity: .18 };
    (ring ? L.polygon(S, style) : L.polyline(S, style)).addTo(mLayer);
    if (M.mode === 'rect' && M.pts.length >= 2) L.polyline([M.pts[0], M.pts[1]], { color: '#f97316', weight: 5, interactive: false }).addTo(mLayer);
    const many = n > 30;
    if (!many) {
      for (let i = 0; i < n - 1; i++) edgeLabel(S[i], S[i + 1], fmtLen(mDist(S[i], S[i + 1]))).addTo(mLayer);
      if (ring) edgeLabel(S[n - 1], S[0], fmtLen(mDist(S[n - 1], S[0]))).addTo(mLayer);
    }
    if (ring) {
      const c = L.polygon(S).getBounds().getCenter();
      L.marker(c, { interactive: false, icon: L.divIcon({ className: 'mLbl big', html: '<span>' + fmtArea(geoArea(S)) + '</span>', iconSize: [0, 0] }) }).addTo(mLayer);
    }
  }
  if (M.mode === 'walk' && M.walkRec && me) L.circle([me.lat, me.lng], { radius: me.acc || 5, color: '#22c55e', weight: 1, fillOpacity: .1, interactive: false }).addTo(mLayer);
  syncVerts();
  renderResult();
}
function syncVerts() {
  const want = (M.mode === 'walk' && M.pts.length > 30) ? [] : M.pts;  // too many points from a GPS walk → no handles
  mVerts.forEach((m) => map.removeLayer(m)); mVerts = [];
  want.forEach((p, i) => {
    const lbl = M.mode === 'rect' ? ['أ', 'ب', 'ع'][i] || '' : String(i + 1);
    const mk = L.marker(p, { draggable: true, zIndexOffset: 2000, icon: L.divIcon({ className: 'mV' + (M.mode === 'rect' && i === 2 ? ' w' : ''), html: '<div>' + lbl + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map);
    mk.on('drag', (e) => { const ll = e.target.getLatLng(); M.pts[i] = [ll.lat, ll.lng]; M.sig[i] = mpp() * 4; redrawShapesOnly(); });
    mk.on('dragend', () => redraw());
    mk.on('click', () => vertexMenu(i));
    mVerts.push(mk);
  });
}
function redrawShapesOnly() {
  const keep = mVerts; mVerts = [];
  mLayer.clearLayers();
  const S = shapePts();
  if (S.length >= 2) (isClosed() && S.length >= 3 ? L.polygon(S, { color: '#facc15', weight: 3, fillColor: '#facc15', fillOpacity: .18, interactive: false }) : L.polyline(S, { color: '#facc15', weight: 3, interactive: false })).addTo(mLayer);
  mVerts = keep;
  renderResult();
}
function vertexMenu(i) {
  actionSheet('النقطة ' + (i + 1), [
    { label: '🗑 حذف هذه النقطة', cls: 'danger', fn: () => { M.pts.splice(i, 1); M.sig.splice(i, 1); redraw(); } }
  ]);
}

/* ---------- results ---------- */
function result() {
  const S = shapePts(), closed = isClosed() && S.length >= 3;
  const area = closed ? geoArea(S) : 0, per = perimeter(S, closed);
  let sg = M.sig.slice();
  if (M.mode === 'rect' && S.length === 4) { const m = Math.max(...M.sig.slice(0, 3), 0); sg = [m, m, m, m]; }
  return { S, closed, area, per, err: closed ? areaSigma(S, sg) : 0 };
}
function renderResult() {
  const r = result();
  let main = '', sub = '', warn = '';
  if (M.mode === 'line') {
    main = r.S.length >= 2 ? fmtLen(r.per) : 'أضف نقطتين على الأقل';
    sub = r.S.length >= 2 ? (r.S.length - 1) + ' مقطع' : '';
  } else if (M.mode === 'rect') {
    if (M.pts.length < 3) { main = ['اضغط بداية الطول', 'اضغط نهاية الطول', 'اضغط على الضلع المقابل لتحديد العرض'][M.pts.length]; }
    else {
      const q = rectCorners(M.pts[0], M.pts[1], M.pts[2]);
      main = fmtArea(r.area); sub = 'الطول ' + fmtLen(q.L) + ' × العرض ' + fmtLen(q.W) + '<br>' + areaUnits(r.area);
    }
  } else {
    if (!r.closed) main = M.mode === 'walk' ? 'سجّل ' + (3 - M.pts.length) + ' زوايا أخرى على الأقل' : 'أضف ' + (3 - M.pts.length) + ' نقاط أخرى على الأقل';
    else { main = fmtArea(r.area); sub = areaUnits(r.area) + '<br>المحيط ' + fmtLen(r.per) + ' · ' + r.S.length + ' زوايا'; }
    if (r.closed && selfIntersects(r.S)) warn = '⚠️ الأضلاع متقاطعة — رتّب الزوايا حول الأرض بالتسلسل ليكون الحساب صحيحًا';
  }
  if (r.closed && r.err > 0) {
    const pct = r.area ? r.err / r.area * 100 : 0;
    sub += '<br><span class="' + (pct > 10 ? 'warnTxt' : 'muted') + '">هامش الخطأ التقريبي ± ' + fmtArea(r.err) + ' (' + nf(pct, pct < 1 ? 1 : 0) + '%)</span>';
  }
  if (M.mode !== 'walk' && map.getZoom() < 17 && M.sig.some((x) => x > 0.6)) warn = warn || '💡 للدقة: قرّب الخريطة إلى أقصى حد واستخدم طبقة القمر الصناعي';
  $('mMain').innerHTML = main; $('mSub').innerHTML = sub; $('mWarn').innerHTML = warn; $('mWarn').classList.toggle('hidden', !warn);
  $('mSave').disabled = !(r.closed || (M.mode === 'line' && r.S.length >= 2));
  $('mWalkBtns').classList.toggle('hidden', M.mode !== 'walk');
  $('mCenterAdd').classList.toggle('hidden', M.mode === 'walk' || (M.mode === 'rect' && M.pts.length >= 3));
  $('mCross').classList.toggle('hidden', M.mode === 'walk' || (M.mode === 'rect' && M.pts.length >= 3));
  $('mWalkRec').textContent = M.walkRec ? '⏹ إيقاف التسجيل' : '⏺ تسجيل مستمر';
  $('mWalkRec').classList.toggle('rec', M.walkRec);
  $('mGps').textContent = me ? 'دقة GPS الحالية ± ' + Math.round(me.acc || 0) + ' م' + ((me.acc || 0) > 10 ? ' — انتظر قليلًا لتتحسن' : ' ✓') : 'بانتظار GPS…';
  document.querySelectorAll('#mModes button').forEach((b) => b.classList.toggle('sel', b.dataset.m === M.mode));
  $('mHint').textContent = MODE_HINT[M.mode];
}

/* ---------- adding points ---------- */
function addPt(ll, sigma) {
  if (M.mode === 'rect' && M.pts.length >= 3) { toast('المستطيل مكتمل — اسحب النقاط للتعديل أو امسح للبدء من جديد'); return; }
  M.pts.push([ll[0], ll[1]]); M.sig.push(sigma);
  redraw();
}
map.on('click', (e) => { if (!measActive || M.mode === 'walk') return; addPt([e.latlng.lat, e.latlng.lng], mpp() * 4); });
$('mCenterAdd').onclick = () => { const c = map.getCenter(); addPt([c.lat, c.lng], mpp() * 1.5); };
/* corner by GPS: average the readings for a few seconds while standing still (much steadier than one reading) */
const AVG_SECONDS = 15;
let avg = null;   // {t0, sw, slat, slng, n, accs}
function avgAdd() {
  if (!avg || !me || (me.acc || 99) > 30 || (me.t || 0) < avg.t0) return;   // only fixes taken after the press
  const w = 1 / Math.max(1, (me.acc || 5) ** 2);
  avg.sw += w; avg.slat += me.lat * w; avg.slng += me.lng * w; avg.n++; avg.accs.push(me.acc || 5);
}
function avgTick() {
  if (!avg) return;
  const left = Math.max(0, AVG_SECONDS - Math.floor((Date.now() - avg.t0) / 1000));
  $('mHere').textContent = '⏳ ' + left + ' ث · ' + avg.n + ' قراءة — اضغط للإنهاء';
  if (left <= 0) avgFinish();
}
function avgFinish() {
  const a = avg; avg = null; clearInterval(avgTimer);
  $('mHere').textContent = '📍 زاوية هنا'; $('mHere').classList.remove('rec');
  if (!a || !a.n) { toast('لم تصل قراءات GPS كافية — حاول في مكان مكشوف'); return; }
  const accs = a.accs.sort((x, y) => x - y), med = accs[Math.floor(accs.length / 2)];
  // readings are correlated over seconds, so the gain is real but limited: assume ~half the typical error
  const sigma = Math.max(1, med / Math.min(2, Math.sqrt(a.n)));
  addPt([a.slat / a.sw, a.slng / a.sw], sigma); vib('60');
  say('زاوية ' + M.pts.length);
  toast('تم تسجيل الزاوية من ' + a.n + ' قراءة (± ' + nf(sigma, 1) + ' م تقريبًا)', 3500);
}
let avgTimer = 0;
$('mHere').onclick = () => {
  if (avg) { avgFinish(); return; }
  if (!me) { toast('بانتظار GPS…'); startLocation(); return; }
  if ((me.acc || 0) > 15) toast('دقة GPS ± ' + Math.round(me.acc) + ' م — قف في مكان مكشوف لتتحسن', 3500);
  avg = { t0: Date.now(), sw: 0, slat: 0, slng: 0, n: 0, accs: [] };
  $('mHere').classList.add('rec'); say('قف ثابتًا');
  avgTimer = setInterval(avgTick, 500); avgTick();
};
$('mWalkRec').onclick = () => {
  M.walkRec = !M.walkRec;
  if (M.walkRec) { if (me) addPt([me.lat, me.lng], me.acc || 5); say('بدأ التسجيل. امشِ على حدود الأرض'); }
  else { simplifyWalk(); say('توقف التسجيل'); }
  keepGps(); renderResult();
};
function simplifyWalk() {
  if (M.pts.length < 8) return;
  const idx = simplifyIdx(M.pts, 1);
  M.pts = idx.map((i) => M.pts[i]); M.sig = idx.map((i) => M.sig[i]);
  redraw();
}
function measOnLocation() {
  if (!measActive) return;
  if (avg) avgAdd();
  if (M.mode === 'walk' && M.walkRec && me && (me.acc || 0) <= 25) {
    const last = M.pts[M.pts.length - 1];
    if (!last || hav(last, [me.lat, me.lng]) >= Math.max(3, (me.acc || 0) * 0.5)) { M.pts.push([me.lat, me.lng]); M.sig.push(me.acc || 5); redraw(); return; }
  }
  if (M.mode === 'walk') renderResult();
}
const _prevOps = window.onOpsLocation;
window.onOpsLocation = function () { if (_prevOps) _prevOps(); measOnLocation(); };
$('mType').onclick = () => {
  const t = prompt('أدخل إحداثيات نقطة أو أكثر مفصولة بـ ; (عشرية، درجات، أو UTM)', '');
  if (!t) return;
  let ok = 0, bad = 0;
  t.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => { const p = parseCoords(x); if (p) { M.pts.push([p.lat, p.lng]); M.sig.push(0.5); ok++; } else bad++; });
  if (M.mode === 'rect' && M.pts.length > 3) { M.pts.length = 3; M.sig.length = 3; }
  redraw();
  if (ok) { const b = L.latLngBounds(M.pts); setFollow(false); map.fitBounds(b.pad(0.3), { maxZoom: 19 }); }
  toast(ok + ' نقطة أضيفت' + (bad ? ' · ' + bad + ' غير مفهومة' : ''));
};
$('mDims').onclick = () => {
  const l = parseFloat(normDigits(prompt('الطول بالأمتار', '') || '')); if (!isFinite(l) || l <= 0) return;
  const w = parseFloat(normDigits(prompt('العرض بالأمتار', '') || '')); if (!isFinite(w) || w <= 0) return;
  const a = l * w;
  actionSheet('📐 ' + nf(l, 2) + ' × ' + nf(w, 2) + ' م', [{ label: '<b>' + fmtArea(a) + '</b> · ' + areaUnits(a), fn: () => copyText(fmtArea(a) + ' (' + areaUnits(a) + ')') }]);
};

/* ---------- toolbar ---------- */
function setMode(m) {
  if (M.pts.length && m !== M.mode && !confirm('تغيير الطريقة يمسح النقاط الحالية. متابعة؟')) return;
  if (M.walkRec) { M.walkRec = false; keepGps(); }
  if (m !== M.mode) { M.pts = []; M.sig = []; }
  M.mode = m;
  if (m === 'walk') { startLocation(); if (me) { setFollow(true); map.setView([me.lat, me.lng], Math.max(map.getZoom(), 18)); } }
  redraw();
}
document.querySelectorAll('#mModes button').forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
$('mUndo').onclick = () => { M.pts.pop(); M.sig.pop(); redraw(); };
$('mClear').onclick = () => { if (M.pts.length && confirm('مسح كل النقاط؟')) { M.pts = []; M.sig = []; M.editId = null; redraw(); } };
function openMeasure(mode) {
  if (navState) endNav(false, true);
  if (directState) endDirect(false);
  if (dest) clearDestination();
  closeSearch(); hideTrack && hideTrack();
  measActive = true; M.pts = []; M.sig = []; M.walkRec = false; M.editId = null; M.mode = mode || M.mode;
  $('searchWrap').classList.add('hidden'); $('fabs').classList.add('hidden');
  $('measPanel').classList.remove('hidden'); $('mHintBar').classList.remove('hidden');
  if (layerKey !== 'sat' && M.mode !== 'walk' && !store.get('measLayerAsked', false)) {
    store.set('measLayerAsked', true);
    actionSheet('للقياس فوق الأرض الحقيقية، طبقة القمر الصناعي أوضح', [{ label: '🛰 التحويل إلى القمر الصناعي', fn: () => setLayer('sat') }]);
  }
  redraw();
}
function closeMeasure() {
  if (M.pts.length && !confirm('إنهاء القياس؟ النقاط غير المحفوظة ستُمسح.')) return;
  if (avg) { avg = null; clearInterval(avgTimer); $("mHere").textContent = "📍 زاوية هنا"; $("mHere").classList.remove("rec"); }
  measActive = false; M.walkRec = false; M.pts = []; M.sig = []; keepGps();
  mLayer.clearLayers(); mVerts.forEach((m) => map.removeLayer(m)); mVerts = [];
  $('measPanel').classList.add('hidden'); $('mHintBar').classList.add('hidden'); $('mCross').classList.add('hidden');
  $('searchWrap').classList.remove('hidden'); $('fabs').classList.remove('hidden');
}
$('mClose').onclick = closeMeasure;
$('openMeasure').onclick = () => { $('menuDrop').classList.add('hidden'); openMeasure(); };
const _keepGps = keepGps;
keepGps = function () { if (NATIVE) try { Android.setNavigating(!!(rec || navState || directState || (measActive && M.walkRec))); } catch (e) {} };

/* ---------- saving & export ---------- */
function measText(m) {
  const lines = ['📐 ' + m.name];
  if (m.type === 'line') lines.push('الطول: ' + fmtLen(m.per));
  else { lines.push('المساحة: ' + fmtArea(m.area) + ' (' + areaUnits(m.area) + ')'); lines.push('المحيط: ' + fmtLen(m.per)); }
  lines.push('النقاط:');
  m.pts.forEach((p, i) => lines.push((i + 1) + ') ' + p[0].toFixed(6) + ', ' + p[1].toFixed(6)));
  const c = L.latLngBounds(m.pts).getCenter();
  lines.push('https://maps.google.com/?q=' + c.lat.toFixed(6) + ',' + c.lng.toFixed(6));
  return lines.join('\n');
}
function measKml(m) {
  const coords = m.pts.concat(m.type === 'line' ? [] : [m.pts[0]]).map((p) => p[1] + ',' + p[0] + ',0').join(' ');
  const geom = m.type === 'line' ? '<LineString><coordinates>' + coords + '</coordinates></LineString>'
    : '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + coords + '</coordinates></LinearRing></outerBoundaryIs></Polygon>';
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xmlEsc(m.name) + '</name>'
    + '<Style id="s"><LineStyle><color>ff15ccfa</color><width>3</width></LineStyle><PolyStyle><color>4015ccfa</color></PolyStyle></Style>'
    + '<Placemark><name>' + xmlEsc(m.name) + '</name><description>' + xmlEsc(m.type === 'line' ? 'الطول ' + fmtLen(m.per) : 'المساحة ' + fmtArea(m.area) + ' — ' + areaUnits(m.area) + ' — المحيط ' + fmtLen(m.per)) + '</description><styleUrl>#s</styleUrl>' + geom + '</Placemark>'
    + '</Document></kml>\n';
}
function measCsv(m) {
  const rows = [['Point', 'Latitude', 'Longitude', 'UTM_Zone', 'Easting', 'Northing', 'Side_to_next_m']];
  m.pts.forEach((p, i) => {
    const u = latLngToUtm(p[0], p[1]), nx = m.pts[(i + 1) % m.pts.length];
    rows.push([i + 1, p[0].toFixed(7), p[1].toFixed(7), u.zone + u.band, u.E.toFixed(2), u.N.toFixed(2), (m.type === 'line' && i === m.pts.length - 1) ? '' : mDist(p, nx).toFixed(2)]);
  });
  rows.push([]);
  if (m.type !== 'line') { rows.push(['Area_m2', m.area.toFixed(2)]); rows.push(['Area_dunam', (m.area / 2500).toFixed(4)]); rows.push(['Area_hectare', (m.area / 10000).toFixed(4)]); }
  rows.push([m.type === 'line' ? 'Length_m' : 'Perimeter_m', m.per.toFixed(2)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
$('mSave').onclick = () => {
  const r = result(); if (!(r.closed || (M.mode === 'line' && r.S.length >= 2))) return;
  if (M.walkRec) { M.walkRec = false; simplifyWalk(); keepGps(); }
  const old = M.editId && measures.find((x) => x.id === M.editId);
  const def = old ? old.name : (M.mode === 'line' ? 'خط ' : 'قطعة ') + stamp(new Date());
  const name = prompt('اسم القياس', def); if (name == null) return;
  const S = shapePts();
  const m = { id: old ? old.id : Date.now().toString(36), name: name.trim() || def, type: M.mode === 'line' ? 'line' : 'area', how: M.mode,
    pts: S.map((p) => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]), src: M.pts.map((p) => [p[0], p[1]]), sig: M.sig.slice(),
    area: r.area, per: r.per, err: r.err, date: Date.now() };
  if (old) measures[measures.indexOf(old)] = m; else measures.unshift(m);
  try { localStorage.setItem('measures', JSON.stringify(measures)); } catch (e) { toast('لا توجد مساحة كافية للحفظ'); return; }
  M.editId = m.id;
  actionSheet('✓ تم الحفظ: ' + m.name, [
    { label: '↗ مشاركة النتيجة', fn: () => doShare(measText(m)) },
    { label: '🌍 حفظ كملف KML (Google Earth)', fn: () => saveTextFile(m.name.replace(/[\\/:*?"<>|]/g, '_') + '.kml', 'application/vnd.google-earth.kml+xml', measKml(m)) },
    { label: '📊 حفظ الزوايا كملف Excel (CSV)', fn: () => saveTextFile(m.name.replace(/[\\/:*?"<>|]/g, '_') + '.csv', 'text/csv', measCsv(m)) }
  ]);
};
function renderMeasures() {
  const l = $('measList');
  if (!measures.length) { l.innerHTML = '<div class="item"><div class="grow s">لا توجد قياسات محفوظة بعد.</div></div>'; return; }
  l.innerHTML = measures.map((m, i) => `<div class="item"><div style="font-size:20px">${m.type === 'line' ? '📏' : '📐'}</div><div class="grow"><div class="t">${esc(m.name)}</div>
    <div class="s">${m.type === 'line' ? fmtLen(m.per) : fmtArea(m.area) + ' · ' + nf(m.area / 2500, 2) + ' دونم'} · ${MEAS_MODE_AR[m.how] || ''} · ${new Date(m.date).toLocaleDateString('ar-IQ-u-nu-latn')}</div></div>
    <button class="chip go" data-mopen="${i}">فتح</button><button class="chip" data-mmore="${i}">⋯</button></div>`).join('');
  l.querySelectorAll('[data-mopen]').forEach((b) => { b.onclick = () => { $('measListPanel').classList.add('hidden'); loadMeasure(measures[+b.dataset.mopen]); }; });
  l.querySelectorAll('[data-mmore]').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.mmore, m = measures[i], fn = m.name.replace(/[\\/:*?"<>|]/g, '_');
      actionSheet(m.name, [
        { label: '↗ مشاركة النتيجة', fn: () => doShare(measText(m)) },
        { label: '🌍 حفظ كملف KML', fn: () => saveTextFile(fn + '.kml', 'application/vnd.google-earth.kml+xml', measKml(m)) },
        { label: '📊 حفظ الزوايا كملف Excel (CSV)', fn: () => saveTextFile(fn + '.csv', 'text/csv', measCsv(m)) },
        { label: '✏️ إعادة التسمية', fn: () => { const n = prompt('الاسم', m.name); if (n && n.trim()) { m.name = n.trim(); store.set('measures', measures); renderMeasures(); } } },
        { label: '🗑 حذف', cls: 'danger', fn: () => { if (confirm('حذف «' + m.name + '»؟')) { measures.splice(i, 1); store.set('measures', measures); renderMeasures(); } } }
      ]);
    };
  });
}
function loadMeasure(m) {
  if (!measActive) openMeasure(m.how === 'walk' ? 'poly' : m.how);
  M.mode = m.how === 'walk' ? 'poly' : m.how;
  M.pts = (m.src || m.pts).map((p) => [p[0], p[1]]); M.sig = (m.sig && m.sig.length === M.pts.length) ? m.sig.slice() : M.pts.map(() => 1);
  M.editId = m.id;
  redraw(); setFollow(false);
  map.fitBounds(L.latLngBounds(M.pts).pad(0.25), { paddingBottomRight: [0, 260], maxZoom: 19 });
}
$('mList').onclick = () => { renderMeasures(); $('measListPanel').classList.remove('hidden'); };
$('mShare').onclick = () => {
  const r = result(); if (!(r.closed || (M.mode === 'line' && r.S.length >= 2))) { toast('أكمل القياس أولًا'); return; }
  doShare(measText({ name: 'قياس', type: M.mode === 'line' ? 'line' : 'area', pts: r.S, area: r.area, per: r.per }));
};

/* ---------- back button ---------- */
function measHandleBack() {
  if (!$('measListPanel').classList.contains('hidden')) { $('measListPanel').classList.add('hidden'); return true; }
  if (measActive) { closeMeasure(); return true; }
  return false;
}
