'use strict';
/* الملاح — القيادة: حد السرعة وتنبيه التجاوز، وبلاغات الطريق (حادث، زحام، سيطرة، طريق مغلق، كاميرا…)
   التي يراها كل مستخدمي الملاح، ووضع السيارة بأزرار وخط كبيرين. */

/* ================= speed limit ================= */
// the usual limit for each road class when none is recorded (km/h) — shown as «تقديري», never alarmed
const SPD_EST = [110, 100, 80, 70, 60, 50, 40, 20, 30, 60, 60, 60, 50, 50, 30, 0, 0, 0, 0, 0, 50];
let spdRoad = null, spdAt = 0, spdOver = 0, spdSaid = 0;
const spdAlertOn = () => store.get('spdAlert', true);
function spdShow(kmh) {
  let el = $('spdLim');
  if (!el) { el = document.createElement('div'); el.id = 'spdLim'; document.body.appendChild(el); el.onclick = () => toast(spdRoad && spdRoad.ms ? 'حد السرعة المسجّل لهذا الطريق ' + spdRoad.ms + ' كم/س' + (spdRoad.name ? ' — ' + spdRoad.name : '') : 'حد تقديري حسب نوع الطريق — غير مسجّل في الخريطة', 3500); }
  const lim = spdRoad ? (spdRoad.ms || SPD_EST[spdRoad.cls] || 0) : 0;
  const show = lim > 0 && !$('speed').classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const real = !!spdRoad.ms, over = real && kmh > lim + 5;
  el.className = (real ? '' : 'est') + (over ? ' over' : '');
  el.innerHTML = `<b>${lim}</b>${real ? '' : '<small>تقديري</small>'}`;
  $('speed').classList.toggle('over', over);
  if (over) {
    if (!spdOver) spdOver = Date.now();
    if (spdAlertOn() && Date.now() - spdOver > 4000 && Date.now() - spdSaid > 90000) { spdSaid = Date.now(); vib('200,120,200'); say('انتبه، تجاوزت السرعة المسموحة ' + lim); }
  } else spdOver = 0;
}
async function spdTick() {
  if (!me || $('speed').classList.contains('hidden') || typeof roadsRoadAt !== 'function' || !roadsReady()) { const el = $('spdLim'); if (el) el.classList.add('hidden'); return; }
  const kmh = me.speed != null && me.speed >= 0 ? me.speed * 3.6 : 0;
  if (Date.now() - spdAt > 2500) {
    spdAt = Date.now();
    const r = await roadsRoadAt(me.lat, me.lng, kmh > 8 && me.heading != null ? me.heading : null);
    if (r || Date.now() - (spdRoad && spdRoad.t || 0) > 15000) spdRoad = r ? Object.assign({ t: Date.now() }, r) : null;
  }
  spdShow(Math.round(kmh));
}
setInterval(spdTick, 1500);

/* ================= road reports ================= */
const RPT = {
  acc: { ic: '💥', ar: 'حادث', ttl: 90 },
  jam: { ic: '🚦', ar: 'زحام', ttl: 60 },
  chk: { ic: '👮', ar: 'سيطرة', ttl: 180 },
  closed: { ic: '⛔', ar: 'طريق مغلق', ttl: 360 },
  cam: { ic: '📷', ar: 'كاميرا سرعة', ttl: 30 * 24 * 60 },
  hole: { ic: '🕳', ar: 'حفرة أو مطب', ttl: 14 * 24 * 60 },
  water: { ic: '🌊', ar: 'مياه على الطريق', ttl: 360 }
};
const RPT_WORDS = [['acc', /حادث|حادثة|تصادم|دعم|انقلاب/], ['jam', /زحم|زحام|ازدحام|واكف|مزدحم/], ['chk', /سيطر|تفتيش|شرطة|نقطة/], ['closed', /مسدود|مغلق|مقطوع|سد|قطع/],
  ['cam', /كامير|رادار|ساهر/], ['hole', /حفر|طسة|مطب|مطبات/], ['water', /ماء|مي|مياه|غرق|مطر|طين/]];
const rptLayer = L.layerGroup().addTo(map);
let rpts = {};                      // id -> report, from the cells loaded
const rptCells = {};                // cell -> last load time
let rptSaid = new Set(store.get('rptSaid', []));
const rptCell = (lat, lng) => 'r_' + Math.floor(lat * 10) + '_' + Math.floor(lng * 10);
function rptAlive(r) {
  const now = Date.now(), v = r.v || {};
  let ok = 0, gone = 0, lastOk = r.t;
  Object.values(v).forEach((x) => { if (x > 0) { ok++; lastOk = Math.max(lastOk, x); } else gone++; });
  const exp = Math.max(r.x || 0, lastOk + (RPT[r.k] ? RPT[r.k].ttl : 60) * 60e3);
  return exp > now && gone < ok + 2 ? { ok, gone, exp } : null;
}
async function rptLoad(cells, force) {
  if (typeof fbReq !== 'function' || navigator.onLine === false) return;
  const now = Date.now();
  const todo = [...new Set(cells)].filter((c) => force || now - (rptCells[c] || 0) > 120e3).slice(0, 12);
  if (!todo.length) return;
  await Promise.all(todo.map(async (c) => {
    rptCells[c] = now;
    try {
      const d = await fbReq('GET', '/reports/' + c) || {};
      Object.keys(rpts).forEach((id) => { if (rpts[id].c === c && !d[id]) delete rpts[id]; });
      Object.entries(d).forEach(([id, r]) => {
        if (!r || !RPT[r.k]) return;
        if (!rptAlive(r)) { if ((r.x || 0) < now) fbReq('DELETE', '/reports/' + c + '/' + id).catch(() => {}); return; }   // tidy up old ones
        rpts[id] = Object.assign({ id, c }, r);
      });
    } catch (e) {}
  }));
  rptDraw();
}
function rptDraw() {
  rptLayer.clearLayers();
  Object.values(rpts).forEach((r) => {
    const a = rptAlive(r); if (!a) return;
    L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', html: `<div class="rptPin k-${r.k}">${RPT[r.k].ic}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 500 })
      .on('click', () => rptOpen(r)).addTo(rptLayer);
  });
}
function rptAgo(t) { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'الآن' : m < 60 ? 'قبل ' + m + ' د' : m < 1440 ? 'قبل ' + Math.round(m / 60) + ' س' : 'قبل ' + Math.round(m / 1440) + ' يوم'; }
function rptOpen(r) {
  const a = rptAlive(r) || { ok: 0, gone: 0 }, mine = typeof fbAuth !== 'undefined' && fbAuth && fbAuth.uid === r.u;
  actionSheet(RPT[r.k].ic + ' ' + RPT[r.k].ar + ' · ' + rptAgo(r.t) + (a.ok ? ' · أكّده ' + a.ok : ''), [
    ...(mine ? [] : [{ label: '👍 ما زال موجودًا', fn: () => rptVote(r, true) }, { label: '👎 لم يعد موجودًا', fn: () => rptVote(r, false) }]),
    ...(mine ? [{ label: '🗑 حذف بلاغي', cls: 'danger', fn: async () => { try { await fbReq('DELETE', '/reports/' + r.c + '/' + r.id); delete rpts[r.id]; rptDraw(); toast('✓ حُذف البلاغ'); } catch (e) { toast('تعذّر الحذف'); } } }] : [])
  ]);
}
async function rptVote(r, ok) {
  try {
    await fbToken();
    const v = ok ? Date.now() : -Date.now();
    await fbReq('PUT', '/reports/' + r.c + '/' + r.id + '/v/' + fbAuth.uid, v);
    r.v = Object.assign({}, r.v, { [fbAuth.uid]: v }); rptDraw();
    toast(ok ? '👍 شكرًا — أكّدت البلاغ' : '👎 شكرًا — سيختفي إذا أكّد غيرك ذلك', 3000);
  } catch (e) { toast(String(e.message).includes('401') || String(e.message).includes('403') ? 'رفض الخادم — يلزم تحديث قواعد Firebase' : 'تعذّر الإرسال — تحقق من الإنترنت', 4000); }
}
let rptLast = {};
async function rptSend(k) {
  if (!me) { toast('بانتظار تحديد موقعك…'); return; }
  if (Date.now() - (rptLast[k] || 0) < 120e3) { toast('أرسلت هذا البلاغ قبل قليل'); return; }
  try {
    await fbToken(); await fbDb();
    const c = rptCell(me.lat, me.lng), now = Date.now();
    const r = { k, lat: Math.round(me.lat * 1e6) / 1e6, lng: Math.round(me.lng * 1e6) / 1e6, t: now, x: now + RPT[k].ttl * 60e3, u: fbAuth.uid };
    if (me.heading != null) r.h = Math.round(me.heading);
    const res = await fbReq('POST', '/reports/' + c, r);
    rptLast[k] = now;
    rpts[res.name] = Object.assign({ id: res.name, c }, r); rptDraw();
    rptSaid.add(res.name);
    toast(RPT[k].ic + ' شكرًا — وصل بلاغ «' + RPT[k].ar + '» لكل مستخدمي الملاح', 3500);
  } catch (e) { toast(String(e.message).includes('401') || String(e.message).includes('403') ? 'رفض الخادم — يلزم تحديث قواعد Firebase' : 'تعذّر إرسال البلاغ — تحقق من الإنترنت', 4000); }
}
function rptMenu() {
  actionSheet('⚠️ بلاغ عن الطريق هنا', [
    { label: '🎤 قل البلاغ بصوتك', fn: rptVoice },
    ...Object.entries(RPT).map(([k, v]) => ({ label: v.ic + ' ' + v.ar, fn: () => rptSend(k) }))
  ]);
}
/* speech: Android's recogniser, or the browser's where it has one */
function voiceAsk(prompt) {
  return new Promise((ok) => {
    if (NATIVE && Android.voice) { window.onVoice = (t) => { window.onVoice = null; ok(t || ''); }; Android.voice(prompt); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('التعرّف على الكلام غير متاح في هذا المتصفح'); ok(''); return; }
    const r = new SR(); r.lang = 'ar-IQ'; r.maxAlternatives = 1;
    r.onresult = (e) => ok(e.results[0][0].transcript || ''); r.onerror = () => ok(''); r.onend = () => ok('');
    toast('🎤 ' + prompt, 3000); r.start();
  });
}
async function rptVoice() {
  const t = await voiceAsk('قل: حادث، زحام، سيطرة، طريق مغلق، كاميرا، حفرة، أو مياه');
  if (!t) return;
  const hit = RPT_WORDS.find(([, re]) => re.test(t));
  if (!hit) { toast('لم أفهم «' + t + '» — اختر من القائمة', 4000); rptMenu(); return; }
  say('بلاغ ' + RPT[hit[0]].ar); rptSend(hit[0]);
}
/* what to load: around me, the visible map, and along the route */
function rptRefresh(force) {
  if (document.visibilityState !== 'visible' || !store.get('rptOn', true)) return;
  const cells = [];
  if (me) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.push(rptCell(me.lat + dy * 0.1, me.lng + dx * 0.1));
  if (map.getZoom() >= 9) { const b = map.getBounds(); for (let la = b.getSouth(); la <= b.getNorth() + 0.1; la += 0.1) for (let lo = b.getWest(); lo <= b.getEast() + 0.1; lo += 0.1) cells.push(rptCell(la, lo)); }
  const r = typeof navState !== 'undefined' && navState && navState.r;
  if (r) for (let k = 0, next = navState.along; k < r.pts.length; k++) if (r.cum[k] >= next && r.cum[k] < navState.along + 30000) { cells.push(rptCell(r.pts[k][0], r.pts[k][1])); next = r.cum[k] + 5000; }
  rptLoad(cells.slice(0, 24), force);
}
setTimeout(() => rptRefresh(true), 8000);
setInterval(() => rptRefresh(false), 60e3);
map.on('moveend', () => setTimeout(() => rptRefresh(false), 800));
/* while driving: a report on the road ahead is said once */
setInterval(() => {
  const r = typeof navState !== 'undefined' && navState && navState.r;
  if (!r || !me) return;
  Object.values(rpts).forEach((x) => {
    if (rptSaid.has(x.id) || !rptAlive(x)) return;
    let bi = -1, bd = 1e9;
    for (let k = 0; k < r.pts.length; k += 2) { if (r.cum[k] < navState.along - 50 || r.cum[k] > navState.along + 2500) continue; const d = hav(r.pts[k], [x.lat, x.lng]); if (d < bd) { bd = d; bi = k; } }
    if (bi < 0 || bd > 60) return;
    const ahead = r.cum[bi] - navState.along;
    if (ahead < 80 || ahead > (x.k === 'cam' ? 800 : 1500)) return;
    rptSaid.add(x.id); store.set('rptSaid', [...rptSaid].slice(-300));
    const dist = ahead >= 1000 ? (ahead / 1000).toFixed(1).replace('.0', '') + ' كيلومتر' : Math.round(ahead / 50) * 50 + ' متر';
    say('انتباه، ' + RPT[x.k].ar + ' بعد ' + dist);
    toast(RPT[x.k].ic + ' ' + RPT[x.k].ar + ' بعد ' + dist + ' (' + rptAgo(x.t) + ')', 6000);
  });
}, 5000);
/* the button on the map */
{
  const b = document.createElement('button');
  b.id = 'rptBtn'; b.className = 'fab'; b.setAttribute('aria-label', 'بلاغ عن الطريق'); b.textContent = '⚠️';
  b.onclick = rptMenu;
  b.style.fontSize = '22px';
  $('fabs').insertBefore(b, $('locBtn'));
}

/* ================= car mode ================= */
let carOn = store.get('carMode', false);
function carSet(on) {
  carOn = on; store.set('carMode', on);
  document.body.classList.toggle('car', on);
  if (on && typeof homeMini === 'function') homeMini(true);
  carBar();
  toast(on ? '🚗 وضع السيارة: أزرار وخط كبيران — للإيقاف من القائمة ☰' : 'أوقفتَ وضع السيارة', 3000);
}
function carBar() {
  let b = $('carBar');
  if (!carOn) { if (b) b.remove(); if (typeof placeFabs === 'function') placeFabs(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'carBar'; document.body.appendChild(b); if (window.ResizeObserver) new ResizeObserver(() => placeFabs()).observe(b); }
  b.innerHTML = `<button data-c="voice">🎤<span>إلى أين؟</span></button><button data-c="home">⌂<span>البيت</span></button><button data-c="work">▣<span>العمل</span></button><button data-c="fav">★<span>المفضلة</span></button><button data-c="rpt">⚠️<span>بلاغ</span></button>`;
  b.onclick = async (e) => {
    const c = e.target.closest('[data-c]'); if (!c) return;
    const k = c.dataset.c;
    if (k === 'rpt') { rptMenu(); return; }
    if (k === 'voice') {
      const t = await voiceAsk('إلى أين تريد الذهاب؟'); if (!t) return;
      homeExpand(true); qEl.value = t; qEl.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    if (k === 'fav') { $('openSaved') ? $('openSaved').click() : homeExpand(true); return; }
    const f = favs.find((x) => x.kind === k);
    if (f) setDestination(f.lat, f.lng, f.name, '');
    else toast(k === 'home' ? 'لم تحدّد البيت بعد' : 'لم تحدّد العمل بعد');
  };
}
{
  const s = $('openSettings');
  if (s) {
    const b = document.createElement('button'); b.id = 'openCar';
    const lab = () => '<span style="font-size:19px;width:22px;text-align:center">🚗</span>' + (carOn ? 'إيقاف وضع السيارة' : 'وضع السيارة (أزرار كبيرة)');
    b.innerHTML = lab();
    s.parentNode.insertBefore(b, s);
    b.onclick = () => { $('menuDrop').classList.add('hidden'); carSet(!carOn); b.innerHTML = lab(); };
    const r = document.createElement('button'); r.id = 'openSpd';
    const lab2 = () => '<span style="font-size:19px;width:22px;text-align:center">⚠️</span>' + (spdAlertOn() ? 'إيقاف تنبيه تجاوز السرعة' : 'تشغيل تنبيه تجاوز السرعة');
    r.innerHTML = lab2();
    s.parentNode.insertBefore(r, s);
    r.onclick = () => { $('menuDrop').classList.add('hidden'); store.set('spdAlert', !spdAlertOn()); r.innerHTML = lab2(); toast(spdAlertOn() ? 'تنبيه تجاوز السرعة يعمل' : 'أوقفتَ تنبيه تجاوز السرعة'); };
  }
}
if (carOn) { document.body.classList.add('car'); carBar(); }
