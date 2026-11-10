'use strict';
/* الملاح — «أين أصل خلال…»: على خريطة المناطق، من موقعك أو من أي نقطة، تُلوَّن الطرق والمناطق التي تصلها
   خلال 15 و30 و60 دقيقة بالسيارة (أو 10 و20 و30 مشيًا)، مع عدد الأحياء والقرى في كل نطاق وأقرب مستشفى.
   يُحسب بدون إنترنت من شبكة الطرق المنزّلة (roads.js). */

const AXR = { on: false, from: null, label: '', mode: 'car', res: null, url: '', busy: false };
const AXR_BANDS = { car: [15, 30, 60], foot: [10, 20, 30] };
const AXR_COL = ['#22c55e', '#facc15', '#f97316'];

async function axReach(from, label) {
  if (typeof roadsReach !== 'function' || !roadsFor([from.lat, from.lng], [from.lat, from.lng])) {
    toast('⏱ يحتاج شبكة الطرق المنزّلة لهذه المنطقة — نزّلها من «خرائط العراق بدون إنترنت»', 4500);
    return;
  }
  AXR.on = true; AXR.from = from; AXR.label = label || 'موقعك';
  await axReachRun(true);
}
async function axReachRun(fit) {
  if (AXR.busy) return;
  AXR.busy = true; axReachBar();
  const bands = AXR_BANDS[AXR.mode], { lat, lng } = AXR.from;
  // the towns, neighbourhoods, villages and hospitals around, to say which are within reach
  const around = (typeof places !== 'undefined' && places ? places : []).filter((p) => (ST_GROUP[p.k] || p.k === 'hospital') && Math.abs(p.lat - lat) < 1.1 && Math.abs(p.lng - lng) < 1.3).slice(0, 6000);
  const probe = new Float64Array(around.length * 2);
  around.forEach((p, i) => { probe[2 * i] = p.lat; probe[2 * i + 1] = p.lng; });
  let r = null;
  try { r = await roadsReach(lat, lng, AXR.mode, bands, probe); } catch (e) { r = null; }
  AXR.busy = false;
  if (!AXR.on) return;
  if (!r) { toast('⏱ لا يوجد طريق قريب من هذه النقطة في الشبكة المنزّلة', 3500); axReachOff(); return; }
  if (AXR.url) setTimeout(((u) => () => URL.revokeObjectURL(u))(AXR.url), 1500);
  AXR.url = URL.createObjectURL(r.blob);
  // what is within each band
  const cnt = bands.map(() => ({ town: 0, nb: 0, vil: 0 }));
  let hosp = null;
  around.forEach((p, i) => {
    const t = r.times[i]; if (t < 0) return;
    if (p.k === 'hospital') { if (!hosp || t < hosp.t) hosp = { n: p.n, t, lat: p.lat, lng: p.lng }; return; }
    const b = bands.findIndex((m) => t <= m); if (b < 0) return;
    for (let k = b; k < bands.length; k++) cnt[k][ST_GROUP[p.k]]++;     // a band counts the nearer ones too
  });
  AXR.res = { box: r.box, cnt, hosp, start: r.start, bands };
  axReachBar();
  if (fit) axReachFit(); else azSoon();
}
function axReachOff() {
  AXR.on = false; AXR.res = null;
  const g = $('azReach'); if (g) g.innerHTML = '';
  if (AXR.url) { URL.revokeObjectURL(AXR.url); AXR.url = ''; }
  const b = $('axrBar'); if (b) b.remove();
  azSoon();
}
function axReachFit() {
  if (!AZ || !AXR.res) return;
  const [S, W, N, E] = AXR.res.box, [x0, y0] = axXY(N, W), [x1, y1] = axXY(S, E);
  const b = AZ.base, need = Math.max((x1 - x0) * 1.15 / b.w, (y1 - y0) * 1.15 * 1.3 / b.h, 1 / 1200);
  const w = Math.min(b.w, b.w * need), h = w * b.h / b.w;
  AZ.vb = azClamp({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h * 0.42, w, h });
  azSoon();
}
/* the picture on the map, under the roads and the dots */
function axReachDraw() {
  const svg = $('areaSvg'); if (!svg) return;
  let g = $('azReach');
  if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.id = 'azReach'; const st = $('azStreets'); if (st) st.before(g); else return; }
  if (!AXR.on || !AXR.res || !AXR.url) { if (g.innerHTML) g.innerHTML = ''; return; }
  if (g.dataset.url === AXR.url && g.dataset.id === AZ.id) return;
  const [S, W, N, E] = AXR.res.box, [x0, y0] = axXY(N, W), [x1, y1] = axXY(S, E);
  g.dataset.url = AXR.url; g.dataset.id = AZ.id;
  g.innerHTML = `<image href="${AXR.url}" x="${fz(x0)}" y="${fz(y0)}" width="${fz(x1 - x0)}" height="${fz(y1 - y0)}" preserveAspectRatio="none" opacity=".62" style="pointer-events:none"/>`;
}
function axReachBar() {
  const box = $('azBox'); if (!box) return;
  let b = $('axrBar');
  if (!AXR.on) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'axrBar'; box.appendChild(b); }
  const bands = AXR_BANDS[AXR.mode], R = AXR.res;
  // Arabic counting: one, two, 3–10, 11+
  const cn = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : n + ' ' + (n <= 10 ? few : many);
  const word = (c) => { const p = []; if (c.town) p.push(cn(c.town, 'بلدة واحدة', 'بلدتان', 'مدن وبلدات', 'مدينة وبلدة')); if (c.nb) p.push(cn(c.nb, 'حي واحد', 'حيّان', 'أحياء', 'حيًا')); if (c.vil) p.push(cn(c.vil, 'قرية واحدة', 'قريتان', 'قرى', 'قرية')); return p.join(' · ') || 'لا أحياء أو قرى معروفة'; };
  b.innerHTML = `<div class="axnTop"><b>⏱ أين أصل من ${esc(AXR.label)}</b><button data-r="x" aria-label="إغلاق">✕</button></div>
    <div class="axnModes"><button data-r="car" class="${AXR.mode === 'car' ? 'on' : ''}">🚗 بالسيارة</button><button data-r="foot" class="${AXR.mode === 'foot' ? 'on' : ''}">🚶 مشيًا</button></div>
    ${AXR.busy || !R ? '<div class="s">⏳ جارٍ الحساب من شبكة الطرق…</div>' : bands.map((m, i) => `<div class="axrRow"><i style="background:${AXR_COL[i]}"></i><b>${m} د</b><span>${word(R.cnt[i])}</span></div>`).join('')
      + (R.hosp ? `<div class="axrRow h" data-r="hosp"><i>🏥</i><span>أقرب مستشفى أو مركز صحي: <b>${esc(R.hosp.n)}</b> — ${Math.max(1, Math.round(R.hosp.t))} د</span></div>` : '')
      + '<div class="s">تقدير بسرعات الطرق دون حساب الزحام</div>'}`;
  b.onclick = (e) => {
    const x = e.target.closest('[data-r]'); if (!x) return;
    const k = x.dataset.r;
    if (k === 'x') { axReachOff(); return; }
    if (k === 'hosp' && R && R.hosp) { axnRoute({ lat: R.hosp.lat, lng: R.hosp.lng, name: R.hosp.n }); return; }
    if ((k === 'car' || k === 'foot') && k !== AXR.mode) { AXR.mode = k; axReachRun(true); }
  };
}
/* where it starts: my location, else the middle of the area on the screen */
function axReachHere() {
  if (typeof me !== 'undefined' && me && me.lat) return axReach({ lat: me.lat, lng: me.lng }, 'موقعك');
  const n = AZ && AZ.cur; if (n && n.c) return axReach({ lat: n.c[1], lng: n.c[0] }, arShort(n));
  toast('⏱ شغّل الموقع أو اضغط مطولًا على نقطة في الخريطة');
}

/* the hooks: drawn with the map's extras, a button with the others (the long-press choice is in areas2.js) */
{
  const _draw = azExtraDraw;
  azExtraDraw = function (X) { _draw(X); try { axReachDraw(); } catch (e) {} };
  const _btns = axButtons;
  axButtons = function () {
    _btns();
    const b = $('azBtns2'); if (!b || b.querySelector('[data-x="reach"]')) return;
    const r = document.createElement('button'); r.dataset.r = 'go'; r.setAttribute('aria-label', 'أين أصل خلال ساعة'); r.textContent = '⏱'; r.dataset.x = 'reach';
    if (AXR.on) r.classList.add('on');
    r.onclick = (e) => { e.stopPropagation(); if (AXR.on) axReachOff(); else axReachHere(); r.classList.toggle('on', AXR.on); };
    b.appendChild(r);
  };
}
