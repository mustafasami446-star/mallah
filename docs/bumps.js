'use strict';
/* الملاح — رصد الحفر الصامت: أثناء القيادة (الملاحة، أو «اتجه نحو»، أو وضع السيارة) والهاتف ثابت في الحامل،
   يراقب حساس الحركة الهزّة العمودية. الهبوط الحاد ثم الارتداد يُسجَّل «حفرة»، والصعود ثم النزول بسرعة منخفضة
   «مطب». يُرسَل كل رصد بلا اسم ولا مسار إلى Firebase (/bumps/<cell>/<id>).
   الحفرة تُعتبر مؤكدة حين ترصدها 3 سيارات مختلفة (أو بلاغ يدوي) في المكان نفسه وبالاتجاه نفسه، وتختفي حين
   تمرّ فوقها 3 سيارات بلا هزّة. حدود الكشف والظهور والتنبيه تأتي من ملف إعدادات على GitHub (config/bumps.json)،
   فتُضبط من بعيد بلا تحديث: البداية «جمع صامت» لا يظهر فيه شيء، ويُسأل السائق أحيانًا بعد الرحلة عمّا كان هناك. */

const BMP_URL = 'https://raw.githubusercontent.com/mustafasami446-star/mallah/main/config/bumps.json';
const BMP_DEF = { v: 1, on: true, minKmh: 20, thr: 4.5, p2p: 8, gyro: 70, ask: 0.6, show: false, alert: false, minDev: 3, gone: 3, days: 45, r: 15 };
let bmpCfg = Object.assign({}, BMP_DEF, store.get('bmpCfg', {}));
const BMP = {
  g: null, buf: [], trig: 0, last: null, lastTouch: 0, on: false,
  q: store.get('bmpQ', []),            // waiting to be sent
  trip: [],                            // this trip's own finds (for the question afterwards)
  ev: {},                              // cell -> {id: event}
  cells: {},                           // cell -> load time
  clusters: [],
  pass: null                           // a confirmed one being driven over: did it shake?
};
const bmpUserOn = () => store.get('bmpOn', true);

async function bmpCfgLoad() {
  if (Date.now() - store.get('bmpCfgT', 0) < 6 * 3600e3 && store.get('bmpCfg', null)) return;
  try {
    const r = await fetch(BMP_URL + '?t=' + Math.floor(Date.now() / 3600e3), { cache: 'no-store' });
    if (!r.ok) return;
    const c = await r.json();
    if (c && c.v === 1) { bmpCfg = Object.assign({}, BMP_DEF, c); store.set('bmpCfg', c); store.set('bmpCfgT', Date.now()); bmpShow(); }
  } catch (e) {}
}

/* ---------------- detection ---------------- */
function bmpDriving() {
  if (!bmpCfg.on || !bmpUserOn() || document.hidden || !me || me.prov === 'net') return false;
  const nav = (typeof navState !== 'undefined' && navState && typeof mode !== 'undefined' && mode === 'car') || (typeof directState !== 'undefined' && directState) || (typeof carOn !== 'undefined' && carOn);
  return !!nav;
}
function bmpListen() {
  const want = bmpDriving();
  if (want === BMP.on) return;
  BMP.on = want;
  if (want) window.addEventListener('devicemotion', bmpMotion); else { window.removeEventListener('devicemotion', bmpMotion); BMP.buf = []; BMP.g = null; }
}
setInterval(bmpListen, 3000);
['pointerdown', 'touchstart'].forEach((t) => document.addEventListener(t, () => { BMP.lastTouch = Date.now(); }, { capture: true, passive: true }));

function bmpMotion(e) {
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  const now = performance.now(), rr = e.rotationRate || {};
  // gravity: a slow average of what the phone feels; the shake is what is left, along gravity (up/down)
  if (!BMP.g) BMP.g = [a.x, a.y, a.z];
  const g = BMP.g; g[0] += (a.x - g[0]) * 0.06; g[1] += (a.y - g[1]) * 0.06; g[2] += (a.z - g[2]) * 0.06;
  const gn = Math.hypot(g[0], g[1], g[2]); if (gn < 8 || gn > 11.6) return;
  const v = ((a.x - g[0]) * g[0] + (a.y - g[1]) * g[1] + (a.z - g[2]) * g[2]) / gn;
  const rot = Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0);
  const B = BMP.buf; B.push([now, v, rot]);
  while (B.length && now - B[0][0] > 1500) B.shift();
  if (!BMP.trig && Math.abs(v) > bmpCfg.thr) BMP.trig = now;
  if (BMP.trig && now - BMP.trig > 450) { const t0 = BMP.trig; BMP.trig = 0; bmpJudge(t0); }
}
function bmpJudge(t0) {
  const kmh = me && me.speed != null ? me.speed * 3.6 : 0;
  if (kmh < bmpCfg.minKmh || !me || me.acc > 25) return;
  if (Date.now() - BMP.lastTouch < 2500) return;                                // the phone is being used
  const w = BMP.buf.filter((x) => x[0] >= t0 - 350 && x[0] <= t0 + 450);
  if (w.length < 8) return;
  let mn = w[0], mx = w[0], rot = 0;
  w.forEach((x) => { if (x[1] < mn[1]) mn = x; if (x[1] > mx[1]) mx = x; rot = Math.max(rot, x[2]); });
  // a phone that turns hard in the hand or slides on the seat, not a road
  if (rot > bmpCfg.gyro * Math.max(1, kmh / 60)) return;
  const p2p = mx[1] - mn[1]; if (p2p < bmpCfg.p2p) return;
  const k = mn[0] < mx[0] ? 'hole' : kmh < 35 ? 'bump' : 'hole';
  const here = [me.lat, me.lng];
  if (BMP.last && hav(BMP.last, here) < 30) return;                             // the back wheels of the same one
  BMP.last = here;
  const t = Date.now(), r = p2p / bmpCfg.p2p;
  const ev = { k, lat: Math.round(me.lat * 1e6) / 1e6, lng: Math.round(me.lng * 1e6) / 1e6, t, x: t + bmpCfg.days * 86400e3,
    s: r < 1.5 ? 1 : r < 2.2 ? 2 : 3, p: Math.round(p2p * 10) / 10, m: Math.round(Math.max(-mn[1], mx[1]) * 10) / 10, rt: Math.round(rot), kmh: Math.round(kmh) };
  if (me.heading != null) ev.h = Math.round(me.heading);
  bmpQueue(ev, true);
}
function bmpQueue(ev, mine) {
  ev.id = 'b' + ev.t.toString(36) + Math.random().toString(36).slice(2, 6);
  ev.c = rptCell(ev.lat, ev.lng);
  BMP.q.push(ev); store.set('bmpQ', BMP.q.slice(-200));
  if (mine && ev.k !== 'miss') BMP.trip.push(ev);
  bmpFlush();
}
let bmpFlushing = false;
async function bmpFlush() {
  if (bmpFlushing || !BMP.q.length || navigator.onLine === false || typeof fbReq !== 'function') return;
  bmpFlushing = true;
  try {
    await fbToken(); await fbDb();
    while (BMP.q.length) {
      const ev = BMP.q[0], { id, c } = ev, body = Object.assign({}, ev, { u: fbAuth.uid });
      delete body.id; delete body.c;
      try { await fbReq('PUT', '/bumps/' + c + '/' + id, body); }
      catch (e) { if (/40[013]/.test(String(e.message))) { BMP.q.shift(); continue; } break; }   // refused (old rules): drop it
      (BMP.ev[c] = BMP.ev[c] || {})[id] = body;
      BMP.q.shift();
    }
  } catch (e) {} finally { store.set('bmpQ', BMP.q); bmpFlushing = false; }
}
setInterval(bmpFlush, 60e3);
window.addEventListener('online', () => setTimeout(bmpFlush, 3000));

/* ---------------- what is known: the confirmed ones ---------------- */
async function bmpLoad(cells) {
  if (typeof fbReq !== 'function' || navigator.onLine === false) return;
  const now = Date.now(), todo = [...new Set(cells)].filter((c) => now - (BMP.cells[c] || 0) > 5 * 60e3).slice(0, 12);
  if (!todo.length) return;
  await Promise.all(todo.map(async (c) => {
    BMP.cells[c] = now;
    try {
      const d = await fbReq('GET', '/bumps/' + c) || {};
      Object.entries(d).forEach(([id, e]) => { if (e && e.x < now) { delete d[id]; fbReq('DELETE', '/bumps/' + c + '/' + id).catch(() => {}); } });
      BMP.ev[c] = d;
    } catch (e) {}
  }));
  bmpCluster();
}
const bmpHdOk = (a, b) => a == null || b == null || Math.abs(((a - b + 540) % 360) - 180) < 50;
function bmpCluster() {
  const R = bmpCfg.r, all = [];
  Object.values(BMP.ev).forEach((d) => Object.values(d || {}).forEach((e) => all.push(e)));
  const hits = all.filter((e) => (e.a || e.k) === 'hole' || (e.a || e.k) === 'bump').sort((a, b) => a.t - b.t);
  const cl = [];
  hits.forEach((e) => {
    const c = cl.find((x) => hav([x.lat, x.lng], [e.lat, e.lng]) < R && bmpHdOk(x.h, e.h));
    if (!c) { cl.push({ lat: e.lat, lng: e.lng, h: e.h, n: 1, devs: new Set([e.u]), last: e.t, s: e.s || 1, holes: (e.a || e.k) === 'hole' ? 1 : 0 }); return; }
    c.lat = (c.lat * c.n + e.lat) / (c.n + 1); c.lng = (c.lng * c.n + e.lng) / (c.n + 1); c.n++;
    if (c.h == null) c.h = e.h;
    c.devs.add(e.u); c.last = Math.max(c.last, e.t); c.s = Math.max(c.s, e.s || 1); if ((e.a || e.k) === 'hole') c.holes++;
  });
  // a report by hand of a hole there counts as one more car
  if (typeof rpts !== 'undefined') Object.values(rpts).forEach((r) => {
    if (r.k !== 'hole' || r.auto) return;
    const c = cl.find((x) => hav([x.lat, x.lng], [r.lat, r.lng]) < R * 2); if (c) c.devs.add('r:' + r.u);
  });
  // cars that drove over it, after the last shake, without one
  const miss = all.filter((e) => e.k === 'miss');
  cl.forEach((c) => {
    c.miss = new Set(miss.filter((m) => m.t > c.last && hav([c.lat, c.lng], [m.lat, m.lng]) < R && bmpHdOk(c.h, m.h)).map((m) => m.u));
    c.ok = c.devs.size >= bmpCfg.minDev && c.miss.size < bmpCfg.gone;
  });
  BMP.clusters = cl;
  bmpShow();
}
/* shown with the reports (and said ahead while driving) only when the settings say so */
function bmpShow() {
  if (typeof rpts === 'undefined') return;
  Object.keys(rpts).forEach((id) => { if (rpts[id].auto) delete rpts[id]; });
  if (bmpCfg.show) BMP.clusters.filter((c) => c.ok).forEach((c, i) => {
    const id = 'bm_' + c.lat.toFixed(5) + '_' + c.lng.toFixed(5);
    rpts[id] = { id, c: 'bm', auto: true, k: 'hole', lat: c.lat, lng: c.lng, h: c.h, t: c.last, x: c.last + bmpCfg.days * 86400e3, v: {}, u: '', n: c.devs.size, kind: c.holes * 2 >= c.n ? 'hole' : 'bump' };
    if (!bmpCfg.alert) rptSaid.add(id);
  });
  if (typeof rptDraw === 'function') rptDraw();
}
/* driving over a confirmed one without a shake: one vote that it is gone */
setInterval(() => {
  if (!BMP.on || !me || !BMP.clusters.length) { BMP.pass = null; return; }
  const kmh = me.speed != null ? me.speed * 3.6 : 0;
  if (BMP.pass) {
    const d = hav([me.lat, me.lng], [BMP.pass.c.lat, BMP.pass.c.lng]);
    if (d > 45) {
      const shook = BMP.trip.some((e) => e.t > BMP.pass.t - 8000 && hav([e.lat, e.lng], [BMP.pass.c.lat, BMP.pass.c.lng]) < 40);
      if (!shook && BMP.pass.close) bmpQueue({ k: 'miss', lat: Math.round(BMP.pass.c.lat * 1e6) / 1e6, lng: Math.round(BMP.pass.c.lng * 1e6) / 1e6, h: me.heading != null ? Math.round(me.heading) : undefined, t: Date.now(), x: Date.now() + bmpCfg.days * 86400e3, s: 0 }, false);
      BMP.pass = null;
    } else if (d < 8) BMP.pass.close = true;
    return;
  }
  if (kmh < bmpCfg.minKmh || me.acc > 15) return;
  const c = BMP.clusters.find((x) => x.ok && hav([me.lat, me.lng], [x.lat, x.lng]) < 25 && bmpHdOk(x.h, me.heading));
  if (c) BMP.pass = { c, t: Date.now(), close: false };
}, 1000);
// load with the reports: around me, the map and the route
{
  const _load = rptLoad;
  rptLoad = async function (cells, force) { await _load(cells, force); if (bmpCfg.show || BMP.on) bmpLoad(cells); };
  const _open = rptOpen;
  rptOpen = function (r) {
    if (!r.auto) return _open(r);
    actionSheet(`${r.kind === 'bump' ? '〰️ مطب' : '🕳 حفرة'} رصدتها ${r.n} سيارات · آخر مرة ${rptAgo(r.t)}`, [
      { label: '👎 لم تعد موجودة', fn: () => { bmpQueue({ k: 'miss', lat: r.lat, lng: r.lng, h: r.h, t: Date.now(), x: Date.now() + bmpCfg.days * 86400e3, s: 0, a: 'gone' }, false); toast('👎 شكرًا — ستختفي إذا أكّد غيرك ذلك', 3000); } }
    ]);
  };
}

/* ---------------- after the trip: what was there? ---------------- */
async function bmpAsk() {
  const t = BMP.trip.filter((e) => e.k === 'hole' || e.k === 'bump'); BMP.trip = [];
  if (!t.length || Math.random() > bmpCfg.ask) return;
  const e = t.sort((a, b) => b.p - a.p)[0];
  await new Promise((r) => setTimeout(r, 3500));
  if (typeof setFollow === 'function') setFollow(false);
  map.setView([e.lat, e.lng], 17);
  const mk = L.marker([e.lat, e.lng], { icon: L.divIcon({ className: '', html: '<div class="rptPin k-hole">❓</div>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 900 }).addTo(map);
  setTimeout(() => mk.remove(), 90e3);
  const ans = (a) => { mk.remove(); if (!a) return; e.a = a; if (BMP.q.includes(e)) { store.set('bmpQ', BMP.q); toast('شكرًا — جوابك يحسّن دقة رصد الحفر للجميع', 3000); return; } fbReq('PUT', '/bumps/' + e.c + '/' + e.id + '/a', a).then(() => toast('شكرًا — جوابك يحسّن دقة رصد الحفر للجميع', 3000)).catch(() => {}); };
  actionSheet('🕳 شعر هاتفك بهزّة قوية هنا (' + rptAgo(e.t) + ') — ما الذي كان هناك؟', [
    { label: '🕳 حفرة', fn: () => ans('hole') },
    { label: '〰️ مطب صناعي', fn: () => ans('bump') },
    { label: '🤷 لا شيء — تحرّك الهاتف أو طريق عادي', fn: () => ans('none') }
  ]);
  const cancel = $('mBtns') && $('mBtns').querySelector('.cancel'); if (cancel) { cancel.textContent = 'لا أعرف'; const f = cancel.onclick; cancel.onclick = (ev) => { mk.remove(); f && f(ev); }; }
}
{
  const _end = endNav;
  endNav = function (arrived, handoff) { const was = !!navState; _end(arrived, handoff); if (was && !handoff) bmpAsk(); };
}

/* ---------------- the switch (in ⚠️), and telling once what it does ---------------- */
{
  const _m = rptMenu;
  rptMenu = function () {
    _m();
    const box = $('mBtns'), cancel = box && box.querySelector('.cancel'); if (!cancel) return;
    const b = document.createElement('button');
    b.innerHTML = bmpUserOn() ? '🕳 رصد الحفر تلقائيًا: يعمل — إيقاف' : '🕳 تشغيل رصد الحفر تلقائيًا';
    b.onclick = () => { closeModal(); store.set('bmpOn', !bmpUserOn()); bmpListen(); toast(bmpUserOn() ? '🕳 يرصد هاتفك الحفر أثناء القيادة ويشاركها بلا اسم' : 'أوقفتَ رصد الحفر — تبقى ترى ما يرصده الآخرون', 3500); };
    cancel.before(b);
  };
}
setInterval(() => {
  if (!BMP.on || store.get('bmpTold', false)) return;
  store.set('bmpTold', true);
  toast('🕳 أثناء القيادة يرصد الملاح الحفر بحساس الحركة ويشاركها بلا اسم ولا مسار، ليُنبَّه بها الجميع — ثبّت الهاتف في الحامل. للإيقاف: زر ⚠️', 9000);
}, 5000);
setTimeout(bmpCfgLoad, 15000);
setInterval(bmpCfgLoad, 6 * 3600e3);
setTimeout(bmpFlush, 20000);

/* ---------------- designer mode: how the silent collection is going ---------------- */
async function bmpStats(el) {
  el.innerHTML = '⏳ جارٍ جمع الأرقام…';
  let d = null;
  try { d = await lsReq('GET', '/bumps'); } catch (e) { el.textContent = e && e.message === 'rules' ? '⚠️ أضف قاعدة bumps في Firebase' : '⚠️ تعذّر الاتصال'; return null; }
  const all = []; Object.entries(d || {}).forEach(([c, x]) => Object.values(x || {}).forEach((e) => all.push(e)));
  const hits = all.filter((e) => e.k === 'hole' || e.k === 'bump'), dev = new Set(hits.map((e) => e.u));
  const ansd = hits.filter((e) => e.a), by = { hole: [], bump: [], none: [] };
  ansd.forEach((e) => by[e.a] && by[e.a].push(e));
  const med = (a, f) => { if (!a.length) return '—'; const v = a.map(f).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  const saved = BMP.ev; BMP.ev = d || {}; bmpCluster(); const conf = BMP.clusters.filter((c) => c.ok).length, cl = BMP.clusters.length; BMP.ev = saved; bmpCluster();
  const lines = [
    `رصد الحفر — ${new Date().toLocaleDateString('ar-IQ-u-nu-latn')} — الإعدادات v${bmpCfg.v} thr=${bmpCfg.thr} p2p=${bmpCfg.p2p} gyro=${bmpCfg.gyro} show=${bmpCfg.show} alert=${bmpCfg.alert}`,
    `الرصدات: ${hits.length} من ${dev.size} جهاز · مرور بلا هزّة: ${all.length - hits.length}`,
    `أماكن: ${cl} · مؤكدة (${bmpCfg.minDev}+ سيارات): ${conf}`,
    `أجوبة السائقين: ${ansd.length} — حفرة ${by.hole.length} · مطب ${by.bump.length} · لا شيء ${by.none.length}`,
    ...['hole', 'bump', 'none'].map((k) => `  ${k}: p وسيط ${med(by[k], (e) => e.p)} · m وسيط ${med(by[k], (e) => e.m)} · سرعة وسيط ${med(by[k], (e) => e.kmh)} · دوران وسيط ${med(by[k], (e) => e.rt)}`),
    'التفاصيل (p,m,kmh,rt,جواب): ' + ansd.slice(-60).map((e) => [e.p, e.m, e.kmh, e.rt, e.a[0]].join(',')).join(' ')
  ];
  el.innerHTML = lines.slice(0, 7).map((l) => '<div>' + escA(l) + '</div>').join('');
  return lines.join('\n');
}
{
  const _panel = licaPanel;
  licaPanel = function (root) {
    _panel(root);
    try {
      const c = document.createElement('div'); c.className = 'card'; c.id = 'laBmp';
      c.innerHTML = `<h3>🕳 رصد الحفر التلقائي</h3>
        <div class="s" style="padding:0 14px">${bmpCfg.show ? (bmpCfg.alert ? 'الحالة: ظاهر للمستخدمين مع التنبيه الصوتي' : 'الحالة: ظاهر للمستخدمين، بلا تنبيه صوتي بعد') : 'الحالة: جمع صامت — لا يظهر شيء للمستخدمين بعد'}</div>
        <div class="s lmStats" id="bmpSt" style="padding:8px 14px;line-height:1.8">اضغط «احسب» لترى ما جُمع حتى الآن</div>
        <div class="btnRow"><button class="chip go" id="bmpGo">📊 احسب</button><button class="chip hidden" id="bmpCopy">📋 انسخ الأرقام لمصمم البرنامج</button></div>`;
      root.appendChild(c);
      let txt = '';
      c.querySelector('#bmpGo').onclick = async () => { txt = await bmpStats(c.querySelector('#bmpSt')) || ''; c.querySelector('#bmpCopy').classList.toggle('hidden', !txt); };
      c.querySelector('#bmpCopy').onclick = () => copyText(txt);
    } catch (e) {}
  };
}
