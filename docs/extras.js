'use strict';
/* الملاح — لمسات يومية: شريط «يومك» (الطقس الآن والصلاة القادمة وعدّاد رمضان)، كلمات سريعة في البحث، «هل تعلم؟»،
   الطقس على طريقك وتذكير الوقود في الرحلات الطويلة، الشروق والغروب وطور القمر، وحجم الخط. */

/* ---------------- sun and moon (calculated on the phone) ---------------- */
const MOON_SYN = 29.530588853, MOON_NEW = Date.UTC(2000, 0, 6, 18, 14);
function moonInfo(d) {
  const age = (((d - MOON_NEW) / 86400e3) % MOON_SYN + MOON_SYN) % MOON_SYN;
  const phases = [[1.8, '🌑', 'محاق'], [6.4, '🌒', 'هلال'], [8.4, '🌓', 'تربيع أول'], [13.8, '🌔', 'أحدب متزايد'], [15.8, '🌕', 'بدر'], [21.1, '🌖', 'أحدب متناقص'], [23.1, '🌗', 'تربيع أخير'], [27.7, '🌘', 'هلال متناقص'], [30, '🌑', 'محاق']];
  const p = phases.find((x) => age < x[0]);
  return { age, icon: p[1], name: p[2], lit: Math.round((1 - Math.cos(age / MOON_SYN * 2 * Math.PI)) / 2 * 100) };
}
function hijriParts(d) {
  try {
    const f = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
    const parts = f.formatToParts(d), get = (t) => (parts.find((x) => x.type === t) || {}).value;
    const m = +new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric' }).format(d);
    return { day: +get('day'), month: get('month'), year: get('year'), m, text: f.format(d) };
  } catch (e) { return null; }
}
/* «🌅 6:03 · 🌇 5:01 · 🌖 أحدب متناقص» for a place */
function sunMoonLine(lat, lng) {
  const T = prayerTimes(new Date(), lat, lng, prCfg || { method: 'mwl' }), mo = moonInfo(Date.now()), h = hijriParts(new Date());
  return `🌅 الشروق ${prClock(T.sunrise)} · 🌇 الغروب ${prClock(T.sunset)} · ${mo.icon} ${mo.name}${h ? ' (' + h.day + ' ' + h.month + ')' : ''}`;
}

/* ---------------- «يومك»: above the search box ---------------- */
function dayBarEnsure() {
  if ($('dayBar')) return;
  const el = document.createElement('div'); el.id = 'dayBar';
  el.innerHTML = '<button id="dbWx" class="db"></button><button id="dbPr" class="db"></button>';
  $('searchBar').before(el);
  $('dbWx').onclick = () => openWeather();
  $('dbPr').onclick = () => openPrayer();
}
let dayArea = null;                  // the nearest district / sub-district to the phone, for the temperature
function dayNearestArea(lat, lng) {
  if (typeof WX === 'undefined' || !WX.ar || !WX.data) return null;
  let best = null, bd = 1e18;
  for (const id in WX.data.areas) {
    const n = WX.ar.byId[id]; if (!n || !n.c) continue;
    const d = (n.c[1] - lat) ** 2 + ((n.c[0] - lng) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return bd < 0.5 ? best : null;     // ~70 km: outside Iraq there is no forecast
}
function dayBar() {
  dayBarEnsure();
  const w = prWhere(), now = new Date();
  // weather now
  let wx = '';
  if (typeof WX !== 'undefined' && WX.data && WX.ar) {   // weather.js may still be loading on a slow connection
    if (!dayArea || !dayBar.at || hav(dayBar.at, [w.lat, w.lng]) > 3000) { dayArea = dayNearestArea(w.lat, w.lng); dayBar.at = [w.lat, w.lng]; }
    const a = dayArea && WX.data.areas[dayArea], i = wxNowIdx();
    if (a && a.h.t[i] != null) {
      const hr = new Date(Date.now() + 3 * 3600e3).getUTCHours(), s = wxSym(a.h.s[i], hr < 6 || hr >= 18);
      wx = `<span class="di">${s[0]}</span><b>${a.h.t[i]}°</b><span class="dt">${esc(s[1])}</span>`;
    }
  }
  $('dbWx').innerHTML = wx || '<span class="di">🌦</span><span class="dt">الطقس</span>';
  // prayer, or the Ramadan counter
  let pr = '<span class="di">🕌</span><span class="dt">أوقات الصلاة</span>';
  if (prCfg) {
    const h = hijriParts(now), T = prayerTimes(now, w.lat, w.lng, prCfg);
    const left = (t) => { const s = Math.max(0, Math.round((t - now) / 60000)), hh = Math.floor(s / 60); return (hh ? hh + ' س ' + (s % 60) + ' د' : s + ' د'); };
    if (h && h.m === 9 && T.maghrib && T.fajr) {
      const imsak = prCfg.method === 'jafari' ? T.imsak : T.fajr;
      if (now < imsak) pr = `<span class="di">🌙</span><span class="dt">الإمساك بعد</span><b>${left(imsak)}</b>`;
      else if (now < T.maghrib) pr = `<span class="di">🌙</span><span class="dt">الإفطار بعد</span><b>${left(T.maghrib)}</b>`;
      else { const tm = new Date(now); tm.setDate(tm.getDate() + 1); const T2 = prayerTimes(tm, w.lat, w.lng, prCfg); pr = `<span class="di">🌙</span><span class="dt">الإمساك بعد</span><b>${left(prCfg.method === 'jafari' ? T2.imsak : T2.fajr)}</b>`; }
    } else {
      const nx = prNext(now, w);
      pr = `<span class="di">🕌</span><span class="dt">${PR_NAMES[nx.k]} بعد</span><b>${left(nx.t)}</b>`;
    }
  }
  $('dbPr').innerHTML = pr;
}
/* the forecast for the bar: the saved one when it is fresh, else download (≈150 KB compressed) */
async function dayWxLoad() {
  if (typeof WX === 'undefined') { setTimeout(dayWxLoad, 3000); return; }
  try {
    if (!WX.data) { const c = await wxCacheGet(); if (c && c.v === 1) wxSetData(c); }
    if (!WX.data || Date.now() - Date.parse(WX.data.made) > 3 * 3600e3) await wxLoad(true);
    WX.ar = WX.ar || await arLoad();
  } catch (e) {}
  dayBar();
}
setTimeout(dayBar, 300);
setTimeout(dayWxLoad, 5000);
setInterval(dayBar, 30000);
setInterval(() => { if (typeof WX !== 'undefined' && WX.data && Date.now() - Date.parse(WX.data.made) > 3 * 3600e3 && document.visibilityState === 'visible') dayWxLoad(); }, 20 * 60e3);

/* ---------------- quick words in the search box ---------------- */
const QWORDS = [
  { re: /^(ال)?قبل[ةه]$|^اتجاه (ال)?قبل[ةه]$/, t: '🕋 اتجاه القبلة', go: () => { openPrayer(); setTimeout(() => { const c = document.querySelector('.prQibla'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }, 300); } },
  { re: /^(ال)?(صلا[ةه]|اذان|أذان|آذان|مواقيت( الصلا[ةه])?|اوقات الصلا[ةه]|أوقات الصلا[ةه])$/, t: '🕌 أوقات الصلاة والأذان', go: () => openPrayer() },
  { re: /^(ال)?(طقس|جو|مطر|امطار|أمطار|حرار[ةه]|رياح|الانواء|الأنواء)$/, t: '🌦 الطقس', go: () => openWeather() },
  { re: /^(ال)?فريق$/, t: '👥 الفريق', go: () => { if (typeof openTeam === 'function') openTeam(); } },
  { re: /^(ال)?مناطق$/, t: '◈ استكشف المناطق', go: () => { if (typeof openAreas === 'function') openAreas(); } },
  { re: /^(ال)?(اعدادات|إعدادات)$/, t: '⚙️ الإعدادات', go: () => { const b = $('openSettings'); if (b) b.click(); } }
];
const quickFor = (q) => { const s = String(q || '').trim().replace(/\s+/g, ' '); return s ? QWORDS.find((x) => x.re.test(s)) : null; };
function quickGo(x) { qEl.value = ''; $('clearQ').classList.add('hidden'); closeSearch(); if (typeof homeExpand === 'function') homeExpand(false); x.go(); }
qEl.addEventListener('input', () => {
  const x = quickFor(qEl.value); if (!x) return;
  setTimeout(() => {               // after the normal suggestions are drawn
    resEl.insertAdjacentHTML('afterbegin', `<div class="res quickRes" id="quickRes"><div class="ic">⚡</div><div style="flex:1"><div class="t">افتح: ${x.t}</div><div class="s">اضغط هنا أو «بحث»</div></div></div>`);
    resEl.classList.remove('hidden');
    $('quickRes').onclick = () => quickGo(x);
  }, 0);
});
$('searchBar').addEventListener('submit', (e) => {
  const x = quickFor(qEl.value); if (!x) return;
  e.preventDefault(); e.stopImmediatePropagation(); quickGo(x);
}, true);

/* ---------------- «هل تعلم؟»: one tip a day ---------------- */
const TIPS = [
  ['اضغط مطولًا على أي نقطة في الخريطة لتختارها وجهة.'],
  ['اكتب «قبلة» أو «طقس» أو «صلاة» في البحث لتفتح القسم مباشرة.'],
  ['أثناء الملاحة اضغط زر المشاركة ← «📡 رابط مباشر» لتتابعك العائلة حتى تصل.', null],
  ['في الطقس اضغط داخل أي محافظة أو قضاء ليهطل المطر المتوقع داخل حدوده.', () => openWeather()],
  ['زر ▶ في الطقس يحرّك الخريطة ساعة بساعة لترى أين يتجه المطر.', () => openWeather()],
  ['«الرياح» في الطقس تُظهر خطوطًا تجري باتجاه الريح وسرعتها.', () => { store.set('wxTab', 'wind'); WX.tab = 'wind'; openWeather(); }],
  ['حمّل خريطة محافظتك من «الخرائط بدون إنترنت» لتعمل الملاحة بلا إنترنت.', () => { const b = $('openMaps'); if (b) b.click(); }],
  ['بوصلة القبلة تخضرّ عندما تتجه نحوها، ويهتز الهاتف.', () => openPrayer()],
  ['يمكن رفع الأذان في وقته حتى والبرنامج مغلق — من «أوقات الصلاة».', () => openPrayer()],
  ['«الفريق» يجمع زملاءك على الخريطة مع محادثة وزر استغاثة.', () => { if (typeof openTeam === 'function') openTeam(); }],
  ['«المناطق» تعرض المحافظات والأقضية والنواحي، وتبحث داخل أي منها.', () => { if (typeof openAreas === 'function') openAreas(); }],
  ['«الاتجاه المباشر» يوصلك بالبوصلة إلى أماكن بلا طرق، مثل موقع في الصحراء.'],
  ['يمكنك حفظ البيت والعمل لتصل إليهما بضغطة من الشاشة الرئيسية.'],
  ['«قياس المساحة والمسافة» في القائمة يقيس أي أرض أو طريق على الخريطة.'],
  ['تنبيهات الطقس تصلك عند توقع أمطار غزيرة أو رياح قوية في منطقتك.', () => openWeather()],
  ['شارك «الملاح» مع أصدقائك من القائمة ← «شارك الملاح».', () => { if (typeof shareApp === 'function') shareApp(); }],
  ['يمكن تكبير الخط من الإعدادات ← «حجم الخط».', () => { const b = $('openSettings'); if (b) b.click(); }],
  ['اضغط على الطقس أو الصلاة أعلى البحث لتفتح قسمها مباشرة.']
];
function tipShow() {
  const today = new Date().toISOString().slice(0, 10);
  if (store.get('tipHide', '') === today) { const t = $('dayTip'); if (t) t.remove(); return; }
  const n = Math.floor(Date.now() / 86400e3) % TIPS.length, tip = TIPS[n];
  let el = $('dayTip');
  if (!el) { el = document.createElement('div'); el.id = 'dayTip'; $('homeMore').prepend(el); }   // in the opened sheet, not over the map
  el.innerHTML = `<span class="tl">💡 هل تعلم؟</span><span class="tt">${esc(tip[0])}</span><button class="tx" aria-label="إخفاء">✕</button>`;
  el.classList.toggle('act', !!tip[1]);
  el.onclick = (e) => { if (e.target.closest('.tx')) { store.set('tipHide', today); el.remove(); return; } if (tip[1]) tip[1](); };
}
setTimeout(tipShow, 400);

/* ---------------- long drives: the weather on the way, and fuel ---------------- */
let routeFuel = L.layerGroup().addTo(map);
function routeNote(html, buttons, ms) {
  let el = $('routeNote');
  if (!el) { el = document.createElement('div'); el.id = 'routeNote'; document.body.appendChild(el); }
  el.innerHTML = `<div class="rn">${html}</div><div class="rb">${(buttons || []).map((b, i) => `<button data-i="${i}">${b[0]}</button>`).join('')}<button data-x="1">✕</button></div>`;
  el.classList.remove('hidden');
  el.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { el.classList.add('hidden'); buttons[+b.dataset.i][1](); }; });
  el.querySelector('[data-x]').onclick = () => el.classList.add('hidden');
  clearTimeout(routeNote.t); routeNote.t = setTimeout(() => el.classList.add('hidden'), ms || 15000);
}
/* the prayer times that fall during the trip, each at the place you will be by then */
function prayersAlong(r, t0) {
  const out = [], seen = new Set(), cfg = prCfg || { method: 'mwl' };
  let prev = null;
  for (let k = 0, next = 0; k <= r.pts.length; k++) {
    const last = k === r.pts.length;
    if (!last && r.cum[k] < next) continue;
    const kk = last ? r.pts.length - 1 : k;
    next = r.cum[kk] + 5000;
    const [lat, lng] = r.pts[kk], when = t0 + r.duration * 1000 * (r.cum[kk] / r.total);
    if (prev) {
      // a prayer whose time (at this stretch of road) comes between the two moments
      [new Date(prev.when), new Date(when)].forEach((d) => {
        const T = prayerTimes(d, lat, lng, cfg);
        ADHAN_KEYS.forEach((key) => {
          const t = T[key]; if (!t) return;
          const id = key + t.toDateString();
          if (!seen.has(id) && t.getTime() > prev.when && t.getTime() <= when) { seen.add(id); out.push({ k: key, t, lat, lng, along: r.cum[kk] }); }
        });
      });
    }
    prev = { when };
    if (last) break;
  }
  out.sort((a, b) => a.t - b.t);
  out.forEach((x) => {
    const id = typeof dayNearestArea === 'function' ? dayNearestArea(x.lat, x.lng) : null;
    x.p = id && WX.ar && WX.ar.byId[id] ? arShort(WX.ar.byId[id]) : '';
    // without the weather areas: the nearest town from the downloaded map
    if (!x.p && typeof places !== 'undefined' && places) {
      let bd = 25000;
      places.forEach((q) => { if ((q.k === 'city' || q.k === 'town') && Math.abs(q.lat - x.lat) < 0.25 && Math.abs(q.lng - x.lng) < 0.3) { const d = hav([q.lat, q.lng], [x.lat, x.lng]); if (d < bd) { bd = d; x.p = q.n; } } });
    }
  });
  return out;
}
/* Ramadan: does the trip end before the iftar, or does the maghrib catch you on the road? */
function iftarLine(r, t0, pa) {
  const h = hijriParts(new Date(t0)); if (!h || h.m !== 9) return '';
  const end = r.pts[r.pts.length - 1], arrive = t0 + r.duration * 1000;
  const onRoad = pa.find((x) => x.k === 'maghrib');
  if (onRoad) return '🌙 يحين الإفطار (' + prClock(onRoad.t) + ') وأنت على الطريق' + (onRoad.p ? ' قرب ' + esc(onRoad.p) : '');
  const T = prayerTimes(new Date(arrive), end[0], end[1], prCfg || { method: 'mwl' });
  if (!T.maghrib || T.maghrib.getTime() < t0) return '';
  const min = Math.round((T.maghrib - arrive) / 60e3);
  if (min < 0 || min > 180) return '';
  return '🌙 تصل قبل الإفطار بـ ' + (min < 60 ? min + ' دقيقة' : Math.floor(min / 60) + ' س ' + (min % 60) + ' د') + ' (المغرب هناك ' + prClock(T.maghrib) + ')';
}
/* mosques within ~1.5 km of the road around where each prayer finds you */
const routeMosq = L.layerGroup().addTo(map);
async function mosquesNear(pts) {
  const near = (lat, lng) => pts.some((p) => Math.abs(p[0] - lat) < 0.03 && Math.abs(p[1] - lng) < 0.035 && hav(p, [lat, lng]) < 1500);
  let hits = [];
  if (typeof places !== 'undefined' && places) hits = places.filter((p) => p.k === 'mosque' && near(p.lat, p.lng)).map((p) => ({ n: p.n, lat: p.lat, lng: p.lng }));
  if (!hits.length && typeof poiTile === 'function') {
    try {
      const keys = [...new Set(pts.map((p) => poiKey(p[0], p[1])))];
      const rows = (await Promise.all(keys.map(poiTile))).flat();
      hits = rows.filter((x) => x[0] === 'mosque' && near(x[2], x[3])).map((x) => ({ n: x[1] || 'جامع', lat: x[2], lng: x[3] }));
    } catch (e) {}
  }
  return hits;
}
function routeStretch(r, from, to) {
  const pts = [];
  for (let k = 0, next = from; k < r.pts.length; k++) if (r.cum[k] >= next && r.cum[k] <= to) { pts.push(r.pts[k]); next = r.cum[k] + 1500; }
  return pts;
}
async function mosquesAlong(r, pa) {
  routeMosq.clearLayers();
  toast('🕌 جارٍ البحث عن الجوامع على الطريق…');
  let n = 0;
  for (const x of pa) {
    // from 15 km before the adhan's place to 25 km after it
    const hits = await mosquesNear(routeStretch(r, Math.max(0, x.along - 15000), x.along + 25000));
    hits.slice(0, 40).forEach((h) => {
      n++;
      L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', html: '<div class="nearPin" style="--c:#123a3a">🕌</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) })
        .bindTooltip(esc(h.n) + ' · ' + PR_NAMES[x.k], { direction: 'top' }).addTo(routeMosq);
    });
  }
  toast(n ? '🕌 ' + n + ' جامع قرب طريقك عند أوقات الصلاة — تظهر على الخريطة' : 'لم أجد جوامع مسجّلة قرب هذه المقاطع من الطريق', 5000);
  setTimeout(() => routeMosq.clearLayers(), 3 * 3600e3);
}
/* while driving: 12 minutes before an adhan, the nearest mosque ahead on the road (said once per prayer) */
let prRoadSaid = '';
setInterval(async () => {
  try {
    if (typeof navState === 'undefined' || !navState || !navState.r || !me || !store.get('prRoadOn', true)) return;
    const r = navState.r, now = Date.now(), T = prayerTimes(new Date(), me.lat, me.lng, prCfg || { method: 'mwl' });
    const key = ADHAN_KEYS.find((k) => T[k] && T[k] - now > 0 && T[k] - now <= 12 * 60e3);
    if (!key) return;
    const id = key + T[key].toDateString();
    if (prRoadSaid === id) return;
    const remain = r.total - navState.along, left = r.duration * (remain / r.total);
    if (left < 15 * 60) return;                               // arriving soon anyway
    prRoadSaid = id;
    const hits = await mosquesNear(routeStretch(r, navState.along + 500, navState.along + 15000));
    let best = null;
    hits.forEach((h) => {
      // how far along the road the mosque is
      let bi = 0, bd = 1e9;
      for (let k = 0; k < r.pts.length; k += 3) { const d = hav(r.pts[k], [h.lat, h.lng]); if (d < bd) { bd = d; bi = k; } }
      const ahead = r.cum[bi] - navState.along;
      if (ahead > 300 && (!best || ahead < best.ahead)) best = Object.assign({ ahead }, h);
    });
    const tm = Math.max(1, Math.round((T[key] - now) / 60e3));
    if (best) {
      const km = best.ahead >= 1000 ? Math.round(best.ahead / 1000) + ' كيلومتر' : Math.round(best.ahead / 100) * 100 + ' متر';
      routeNote(`<div>🕌 أذان ${PR_NAMES[key]} بعد ${tm} دقيقة — ${esc(best.n)} على طريقك بعد ${km}</div>`,
        [['📍 أرني', () => { routeMosq.clearLayers(); L.marker([best.lat, best.lng], { icon: L.divIcon({ className: '', html: '<div class="nearPin" style="--c:#123a3a">🕌</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).bindTooltip(esc(best.n), { direction: 'top', permanent: true }).addTo(routeMosq); setFollow(false); map.setView([best.lat, best.lng], 16); }]], 30000);
      say('يقترب أذان ' + PR_NAMES[key] + '. يوجد جامع على طريقك بعد ' + km);
    } else {
      routeNote(`<div>🕌 أذان ${PR_NAMES[key]} بعد ${tm} دقيقة</div>`, [], 15000);
    }
  } catch (e) {}
}, 60e3);
async function routeChecks(r) {
  if (!r || !r.pts) return;
  // short trips: only the iftar in Ramadan
  if (r.total < 40000) { try { const l = iftarLine(r, Date.now(), prayersAlong(r, Date.now())); if (l) routeNote('<div>' + l + '</div>', [], 15000); } catch (e) {} return; }
  const notes = [], btns = [];
  // the weather along the road, at the time you will be there
  try {
    if (!WX.data) await dayWxLoad();
    if (WX.data && WX.ar) {
      const G = WX.data.grid, t0 = Date.now();
      let rain = null, wind = null, storm = null;
      for (let k = 0, next = 0; k < r.pts.length; k++) {
        if (r.cum[k] < next) continue;
        next = r.cum[k] + 8000;
        const [lat, lng] = r.pts[k], when = t0 + r.duration * 1000 * (r.cum[k] / r.total);
        const hi = Math.floor((when - Date.parse(WX.data.start)) / 3600e3);
        if (hi < 0 || hi >= WX.data.hours) continue;
        const i = Math.round((lng - G.lon0) / G.step), j = Math.round((lat - G.lat0) / G.step);
        if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
        const c = j * G.nx + i, rr = G.h.r[c][hi], ww = G.h.w[c][hi];
        const place = () => { const id = dayNearestArea(lat, lng); return id && WX.ar.byId[id] ? arShort(WX.ar.byId[id]) : ''; };
        if (!rain && rr != null && rr >= 5) rain = { p: place(), t: when, mm: rr / 10 };
        if (!wind && ww != null && ww >= 110) wind = { p: place(), t: when, k: kmh(ww) };
        if (!storm) { const id = dayNearestArea(lat, lng), a = id && WX.data.areas[id], s = a && a.h.s[hi]; if (s >= 0 && /thunder/.test(WX.data.sym[s])) storm = { p: place(), t: when }; }
      }
      const at = (x) => (x.p ? ' قرب ' + esc(x.p) : '') + ' حوالي ' + prClock(new Date(x.t));
      if (storm) notes.push('⛈ عواصف رعدية متوقعة على طريقك' + at(storm));
      if (rain) notes.push('🌧 ' + (rain.mm >= 4 ? 'أمطار غزيرة' : 'أمطار') + ' متوقعة على طريقك' + at(rain));
      if (wind) notes.push('💨 رياح قوية (' + wind.k + ' كم/س) على طريقك' + at(wind) + ' — قد تثير الغبار');
      if (storm || rain || wind) btns.push(['🌦 الطقس', () => openWeather()]);
    }
  } catch (e) {}
  // the prayers that come while you drive, and in Ramadan the iftar
  try {
    const pa = prayersAlong(r, Date.now());
    pa.forEach((x) => notes.push('🕌 أذان ' + PR_NAMES[x.k] + ' ' + prClock(x.t) + ' وأنت' + (x.p ? ' قرب ' + esc(x.p) : ' على الطريق')));
    if (pa.length) btns.push(['🕌 جوامع على الطريق', () => mosquesAlong(r, pa)]);
    const ift = iftarLine(r, Date.now(), pa);
    if (ift) notes.push(ift);
  } catch (e) {}
  // fuel
  if (r.total >= 300000) {
    notes.push('⛽ رحلة طويلة (' + Math.round(r.total / 1000) + ' كم) — تأكد من الوقود قبل الانطلاق');
    btns.push(['⛽ محطات الوقود على الطريق', () => fuelAlong(r)]);
  }
  if (!notes.length) return;
  routeNote(notes.map((n) => '<div>' + n + '</div>').join(''), btns, 20000);
  if (notes[0] && !notes[0].startsWith('⛽')) say(notes[0].replace(/<[^>]+>/g, '').replace(/^[^؀-ۿ]+/, ''));
}
/* fuel stations within ~1.5 km of the road: the downloaded map first, otherwise OpenStreetMap online */
async function fuelAlong(r) {
  routeFuel.clearLayers();
  const step = Math.max(3000, r.total / 140), pts = [];
  for (let k = 0, next = 0; k < r.pts.length; k++) if (r.cum[k] >= next) { pts.push(r.pts[k]); next = r.cum[k] + step; }
  pts.push(r.pts[r.pts.length - 1]);
  const near = (lat, lng) => pts.some((p) => Math.abs(p[0] - lat) < 0.04 && Math.abs(p[1] - lng) < 0.05 && hav(p, [lat, lng]) < 1500 + step / 2);
  let hits = [];
  if (typeof places !== 'undefined' && places) hits = places.filter((p) => p.k === 'fuel' && near(p.lat, p.lng)).map((p) => ({ n: p.n, lat: p.lat, lng: p.lng }));
  if (!hits.length && typeof poiTile === 'function') {
    toast('⛽ جارٍ البحث عن المحطات على الطريق…');
    try {
      const keys = [...new Set(pts.map((p) => poiKey(p[0], p[1])))];
      const rows = (await Promise.all(keys.map(poiTile))).flat();
      hits = rows.filter((r) => r[0] === 'fuel' && near(r[2], r[3])).map((r) => ({ n: r[1] || 'محطة وقود', lat: r[2], lng: r[3] }));
      if (!hits.length) { toast('لم أجد محطات وقود مسجّلة على هذا الطريق', 4000); return; }
    } catch (e) { hits = []; }
  }
  if (!hits.length) {
    toast('⛽ جارٍ البحث عن المحطات على الطريق…');
    try {
      const line = pts.map((p) => p[0].toFixed(4) + ',' + p[1].toFixed(4)).join(',');
      const j = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent('[out:json][timeout:40];nwr["amenity"="fuel"](around:1500,' + line + ');out center 300;'), 45000);
      hits = (j.elements || []).map((e) => { const t = e.tags || {}; return { n: t['name:ar'] || t.name || 'محطة وقود', lat: e.lat != null ? e.lat : e.center && e.center.lat, lng: e.lon != null ? e.lon : e.center && e.center.lon }; }).filter((x) => isFinite(x.lat));
    } catch (e) { toast('تعذّر البحث — تحقق من الإنترنت', 4000); return; }
  }
  if (!hits.length) { toast('لم أجد محطات وقود مسجّلة على هذا الطريق', 4000); return; }
  hits.forEach((h) => L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', html: '<div class="nearPin" style="--c:#1e3a5f">⛽</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) })
    .bindTooltip(esc(h.n), { direction: 'top' }).addTo(routeFuel));
  toast('⛽ ' + hits.length + ' محطة وقود على طريقك — تظهر على الخريطة', 5000);
  setTimeout(() => routeFuel.clearLayers(), 3 * 3600e3);
}
{
  const b = $('startBtn'), _start = b.onclick;
  b.onclick = function () { const r = routes[mode]; _start.apply(this, arguments); if (navState) setTimeout(() => routeChecks(r), 1500); };
}

/* ---------------- font size ---------------- */
function fontApply() { const f = store.get('fontSize', 'n'); document.body.classList.remove('fs-l', 'fs-xl'); if (f !== 'n') document.body.classList.add('fs-' + f); }
fontApply();
{
  const body = document.querySelector('#setPanel .panelBody');
  if (body) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<h3>🔠 حجم الخط</h3><div class="fsRow"><button data-fs="n">عادي</button><button data-fs="l">كبير</button><button data-fs="xl">كبير جدًا</button></div>';
    body.prepend(c);
    const mark = () => c.querySelectorAll('[data-fs]').forEach((b) => b.classList.toggle('on', b.dataset.fs === store.get('fontSize', 'n')));
    c.querySelectorAll('[data-fs]').forEach((b) => { b.onclick = () => { store.set('fontSize', b.dataset.fs); fontApply(); mark(); }; });
    mark();
  }
}
