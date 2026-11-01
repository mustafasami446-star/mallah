'use strict';
/* الملاح — أوقات الصلاة واتجاه القبلة. Everything is calculated on the phone from the position and the date
   (astronomical formulas), so it works without internet. The calculation method is the user's choice. */

const KAABA = { lat: 21.422487, lng: 39.826206 };
const PR_METHODS = {
  jafari: { name: 'التوقيت الجعفري', fajr: 16, isha: 14, maghrib: 4 },
  mwl: { name: 'رابطة العالم الإسلامي', fajr: 18, isha: 17 },
  egypt: { name: 'الهيئة المصرية العامة للمساحة', fajr: 19.5, isha: 17.5 },
  umm: { name: 'أم القرى', fajr: 18.5, ishaMin: 90 }
};
const PR_NAMES = { imsak: 'الإمساك', fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', sunset: 'الغروب', maghrib: 'المغرب', isha: 'العشاء' };
let prCfg = store.get('prCfg', null);          // {method, asr: 1|2, adj: {fajr: 0, ...}, adhan: {on, prayers, sound, loud}}
/* the adhan recordings (freely licensed, from Wikimedia Commons), downloaded once when the adhan is switched on */
const ADHAN_BASE = 'https://mustafasami446-star.github.io/mallah/adhan/';
const ADHAN_SOUNDS = [{"id": "j-hatamzadeh", "name": "أذان جعفري — مقام ماهور", "file": "j-hatamzadeh.mp3", "jafari": true, "def": true, "credit": "بصوت سعيد حاتم زاده ورمزيار · CC BY-SA 4.0 · ويكيميديا كومنز"}, {"id": "j-sobhdel", "name": "أذان جعفري — أداء مطوّل", "file": "j-sobhdel.mp3", "jafari": true, "credit": "بصوت حسين صبحدل · CC BY-SA 4.0 · ويكيميديا كومنز"}, {"id": "g-nabawi", "name": "أذان المسجد النبوي", "file": "g-nabawi.mp3", "jafari": false, "def": true, "credit": "تسجيل ejaz215 · CC BY 3.0 · ويكيميديا كومنز"}, {"id": "g-fakhry", "name": "أذان بصوت صباح فخري", "file": "g-fakhry.mp3", "jafari": false, "credit": "ملكية عامة · ويكيميديا كومنز"}, {"id": "g-quiet", "name": "أذان هادئ", "file": "g-quiet.mp3", "jafari": false, "credit": "تسجيل Adam-synagda · CC0 · ويكيميديا كومنز"}];
/* the list can grow without an app update: adhan/sounds.json on the site */
(function () {
  try { const c = JSON.parse(localStorage.getItem('adhanCat') || 'null'); if (c && c.length) ADHAN_SOUNDS.splice(0, ADHAN_SOUNDS.length, ...c); } catch (e) {}
  setTimeout(() => fetch(ADHAN_BASE + 'sounds.json?t=' + Math.floor(Date.now() / 3600e3), { cache: 'no-cache' }).then((r) => r.json()).then((j) => {
    if (!j || !Array.isArray(j.sounds) || !j.sounds.length) return;
    ADHAN_SOUNDS.splice(0, ADHAN_SOUNDS.length, ...j.sounds);
    try { localStorage.setItem('adhanCat', JSON.stringify(j.sounds)); } catch (e) {}
    if ($('prAdhan')) prAdhanCard();
  }).catch(() => {}), 9000);
})();
const ADHAN_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/* ---------------- the astronomy ---------------- */
const dsin = (d) => Math.sin(d * Math.PI / 180), dcos = (d) => Math.cos(d * Math.PI / 180), dtan = (d) => Math.tan(d * Math.PI / 180);
const darcsin = (x) => Math.asin(x) * 180 / Math.PI, darccos = (x) => Math.acos(x) * 180 / Math.PI, darctan2 = (y, x) => Math.atan2(y, x) * 180 / Math.PI;
const fixA = (a) => { a = a - 360 * Math.floor(a / 360); return a < 0 ? a + 360 : a; };
const fixH = (h) => { h = h - 24 * Math.floor(h / 24); return h < 0 ? h + 24 : h; };
function sunPos(jd) {
  const D = jd - 2451545.0, g = fixA(357.529 + 0.98560028 * D), q = fixA(280.459 + 0.98564736 * D);
  const L = fixA(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g)), e = 23.439 - 0.00000036 * D;
  const RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
  return { decl: darcsin(dsin(e) * dsin(L)), eqt: q / 15 - fixH(RA) };
}
/* the times of one day, as Date objects (the phone shows them in its own time zone) */
function prayerTimes(date, lat, lng, cfg) {
  const m = PR_METHODS[(cfg && cfg.method) || 'mwl'] || PR_METHODS.mwl, asrF = (cfg && cfg.asr) || 1;
  const y = date.getFullYear(), mo = date.getMonth(), d = date.getDate();
  const base = Date.UTC(y, mo, d);                              // 00:00 UTC of that calendar day
  const jd0 = base / 86400000 + 2440587.5;
  // hours after 00:00 UTC; each time is refined once with the sun's position at that moment
  const noon = (t) => fixH(12 - sunPos(jd0 + t / 24).eqt - lng / 15);
  const angleTime = (angle, t, before) => {
    const s = sunPos(jd0 + t / 24), n = noon(t);
    const c = (-dsin(angle) - dsin(s.decl) * dsin(lat)) / (dcos(s.decl) * dcos(lat));
    if (c > 1 || c < -1) return NaN;
    const h = darccos(c) / 15;
    return n + (before ? -h : h);
  };
  const asrTime = (t) => { const s = sunPos(jd0 + t / 24); const a = -Math.atan(1 / (asrF + dtan(Math.abs(lat - s.decl)))) * 180 / Math.PI; return angleTime(a, t, false); };
  const g = 12 - lng / 15;                                       // a first guess of noon (UTC hours)
  const T = {};
  T.fajr = angleTime(m.fajr, g - 6, true);
  T.sunrise = angleTime(0.833, g - 6, true);
  T.dhuhr = noon(g);
  T.asr = asrTime(g + 3);
  T.sunset = angleTime(0.833, g + 6, false);
  T.maghrib = m.maghrib ? angleTime(m.maghrib, g + 6, false) : T.sunset;
  T.isha = m.ishaMin ? T.maghrib + m.ishaMin / 60 : angleTime(m.isha, g + 7, false);
  T.imsak = T.fajr - 10 / 60;
  T.dhuhr += 1 / 60;                                            // a minute after the sun passes the meridian
  const adj = (cfg && cfg.adj) || {};
  const out = {};
  for (const k of Object.keys(T)) out[k] = isNaN(T[k]) ? null : new Date(Math.round((base + (T[k] + (adj[k] || 0) / 60) * 3600e3) / 60e3) * 60e3);
  return out;
}
/* the qibla: the starting direction of the shortest way to the Kaaba, degrees from true north */
function qiblaBearing(lat, lng) {
  const p1 = lat * Math.PI / 180, p2 = KAABA.lat * Math.PI / 180, dl = (KAABA.lng - lng) * Math.PI / 180;
  return (Math.atan2(Math.sin(dl), Math.cos(p1) * Math.tan(p2) - Math.sin(p1) * Math.cos(dl)) * 180 / Math.PI + 360) % 360;
}

/* ---------------- the panel ---------------- */
const prWhere = () => (me ? { lat: me.lat, lng: me.lng, known: true } : (store.get('prLast', null) ? Object.assign(store.get('prLast'), { known: false }) : { lat: 33.3152, lng: 44.3661, known: false, city: 'بغداد' }));
const prClock = (d) => (d ? d.toLocaleTimeString('ar-IQ-u-nu-latn', { hour: 'numeric', minute: '2-digit' }) : '—');
function prEnsure() {
  if ($('prPanel')) return;
  const el = document.createElement('div'); el.id = 'prPanel'; el.className = 'panel hidden';
  el.innerHTML = `<div class="panelHead"><button class="iconBtn" id="prClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button><h2>🕌 أوقات الصلاة والقبلة</h2></div>
    <div class="panelBody" id="prBody"></div>`;
  document.body.appendChild(el);
  $('prClose').onclick = () => prClose();
}
let prTimer = null;
function openPrayer() {
  prEnsure();
  $('menuDrop').classList.add('hidden');
  document.querySelectorAll('.panel:not(.hidden)').forEach((p) => p.classList.add('hidden'));
  $('prPanel').classList.remove('hidden');
  try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(() => {}); } catch (e) {}
  if (!prCfg) { prChooseMethod(true); return; }
  prRender();
  clearInterval(prTimer); prTimer = setInterval(() => { if ($('prPanel').classList.contains('hidden')) { clearInterval(prTimer); return; } prTick(); }, 250);
}
function prClose() { $('prPanel').classList.add('hidden'); clearInterval(prTimer); }
window.prHandleBack = () => {
  if ($('prMBox') && prCfg) { $('prMBox').remove(); return true; }
  if ($('prPanel') && !$('prPanel').classList.contains('hidden')) { prClose(); return true; }
  return false;
};
function prNext(now, w) {
  const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const today = prayerTimes(now, w.lat, w.lng, prCfg);
  for (const k of order) if (today[k] && today[k] > now) return { k, t: today[k] };
  const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  return { k: 'fajr', t: prayerTimes(tm, w.lat, w.lng, prCfg).fajr };
}
function prRender() {
  const w = prWhere(), now = new Date(), T = prayerTimes(now, w.lat, w.lng, prCfg);
  if (me) store.set('prLast', { lat: Math.round(me.lat * 100) / 100, lng: Math.round(me.lng * 100) / 100 });
  let hijri = '';
  try { hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(now) + ' (تقريبي)'; } catch (e) {}
  const greg = now.toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
  const rows = (prCfg.method === 'jafari' ? ['imsak', 'fajr', 'sunrise', 'dhuhr', 'asr', 'sunset', 'maghrib', 'isha'] : ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']);
  const nx = prNext(now, w);
  const q = qiblaBearing(w.lat, w.lng), dist = hav([w.lat, w.lng], [KAABA.lat, KAABA.lng]);
  $('prBody').innerHTML = `
    <div class="prNext"><div class="s">${esc(greg)}${hijri ? ' · ' + esc(hijri) : ''}${typeof moonInfo === 'function' ? ' · ' + moonInfo(Date.now()).icon + ' ' + moonInfo(Date.now()).name : ''}</div>
      <div class="big" id="prNextName">${PR_NAMES[nx.k]} ${prClock(nx.t)}</div><div class="cd" id="prCount"></div>
      <div class="s">${w.known ? '📍 حسب موقعك الحالي' : (w.city ? '📍 ' + w.city + ' — شغّل الموقع لأوقات منطقتك' : '📍 حسب آخر موقع معروف')}</div></div>
    <div class="card"><div id="prRows">${rows.map((k) => `<div class="res prRow${k === nx.k && nx.t.getDate() === now.getDate() ? ' on' : ''}${k === 'sunrise' || k === 'sunset' || k === 'imsak' ? ' minor' : ''}"><div class="t" style="flex:1">${PR_NAMES[k]}</div><div class="tm">${prClock(T[k])}</div></div>`).join('')}</div>
      <div class="btnRow" style="padding:10px 14px 12px"><button class="chip" id="prMethod">⚙️ ${esc(PR_METHODS[prCfg.method].name)}${prCfg.method !== 'jafari' ? ' · العصر ' + (prCfg.asr === 2 ? 'الحنفي' : 'الجمهور') : ''}</button></div></div>
    <div class="card prQibla"><h3>🕋 اتجاه القبلة</h3>
      <div class="prDial" id="prDial"><svg viewBox="0 0 220 220"><g id="prRose"><circle cx="110" cy="110" r="100" fill="none" stroke="rgba(148,163,184,.35)" stroke-width="2"/>
        ${[0, 90, 180, 270].map((a, i) => `<text x="110" y="28" fill="${i ? '#94a3b8' : '#ef4444'}" font-size="16" font-weight="700" text-anchor="middle" transform="rotate(${a} 110 110)">${['ش', 'ق', 'ج', 'غ'][i]}</text>`).join('')}
        ${Array.from({ length: 36 }, (_, i) => `<line x1="110" y1="12" x2="110" y2="${i % 9 ? 18 : 22}" stroke="rgba(148,163,184,.55)" stroke-width="2" transform="rotate(${i * 10} 110 110)"/>`).join('')}
        <g transform="rotate(${q.toFixed(1)} 110 110)"><path d="M110 30 L122 110 L110 100 L98 110 Z" fill="#22c55e"/><text x="110" y="62" font-size="20" text-anchor="middle">🕋</text></g></g>
        <path d="M110 4 l7 12 h-14z" fill="#f8fafc"/></svg></div>
      <div class="prQtxt"><b>${Math.round(q)}°</b> من الشمال (${cardinal(q)}) · مكة على بعد ${Math.round(dist / 1000).toLocaleString('ar-IQ-u-nu-latn')} كم</div>
      <div class="s" id="prQhint" style="text-align:center;padding:2px 14px 6px"></div>
      <div class="btnRow" style="padding:4px 14px 14px;justify-content:center"><button class="chip" id="prQmap">🗺 أظهر الاتجاه على الخريطة</button></div></div>
    <div class="card" id="prAdhan"></div>
    <div class="note">تُحسب الأوقات على هاتفك من موقعك والتاريخ، وتعمل بدون إنترنت. قد تختلف دقيقة أو دقيقتين عن تقويم مسجدك؛ يمكنك تعديل كل وقت من «⚙️». ابتعد عن الحديد والسيارة والمغناطيس عند استخدام البوصلة، وحرّك الهاتف على شكل 8 لمعايرتها.</div>`;
  $('prMethod').onclick = () => prChooseMethod(false);
  prAdhanCard();
  $('prQmap').onclick = () => prShowOnMap(w);
  prTick();
}
function prTick() {
  const w = prWhere(), now = new Date(), nx = prNext(now, w);
  const s = Math.max(0, Math.round((nx.t - now) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if ($('prCount')) $('prCount').textContent = 'بعد ' + (h ? h + ' س ' : '') + m + ' د';
  if ($('prNextName') && !$('prNextName').textContent.startsWith(PR_NAMES[nx.k])) prRender();
  // the dial turns with the phone so that the green arrow points at the Kaaba
  const hd = typeof currentHeading === 'function' ? currentHeading() : null, rose = $('prRose');
  if (!rose) return;
  const q = qiblaBearing(w.lat, w.lng);
  if (hd && hd.src === 'compass') {
    rose.setAttribute('transform', 'rotate(' + (-hd.h).toFixed(1) + ' 110 110)');
    const off = ((q - hd.h + 540) % 360) - 180;
    const ok = Math.abs(off) <= 4;
    $('prDial').classList.toggle('ok', ok);
    $('prQhint').textContent = ok ? '✓ أنت متّجه نحو القبلة' : (off > 0 ? 'استدر يمينًا ' : 'استدر يسارًا ') + Math.round(Math.abs(off)) + '°';
    if (ok && !prTick.buzz) { prTick.buzz = true; try { Android.vibrate && Android.vibrate('60'); } catch (e) {} }
    if (!ok) prTick.buzz = false;
  } else {
    rose.setAttribute('transform', '');
    $('prQhint').textContent = 'البوصلة غير متاحة الآن — الشمال إلى أعلى الدائرة';
  }
}
/* a line from here to Mecca along the shortest way */
let prLine = null;
function prShowOnMap(w) {
  prClose();
  if (prLine) map.removeLayer(prLine);
  const pts = [], p1 = [w.lat * Math.PI / 180, w.lng * Math.PI / 180], p2 = [KAABA.lat * Math.PI / 180, KAABA.lng * Math.PI / 180];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2[0] - p1[0]) / 2) ** 2 + Math.cos(p1[0]) * Math.cos(p2[0]) * Math.sin((p2[1] - p1[1]) / 2) ** 2));
  for (let i = 0; i <= 64; i++) {
    const f = i / 64, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]);
    const y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]);
    const z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
    pts.push([Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI, Math.atan2(y, x) * 180 / Math.PI]);
  }
  prLine = L.layerGroup([
    L.polyline(pts, { color: '#22c55e', weight: 4, dashArray: '8 8', interactive: false }),
    L.marker([KAABA.lat, KAABA.lng], { icon: L.divIcon({ className: 'prKaaba', html: '🕋', iconSize: [30, 30] }), interactive: false })
  ]).addTo(map);
  map.setView([w.lat, w.lng], Math.max(map.getZoom(), 14));
  toast('🕋 الخط الأخضر يشير إلى القبلة، ويختفي بعد دقيقتين', 5000);
  setTimeout(() => { if (prLine) { map.removeLayer(prLine); prLine = null; } }, 120000);
}
/* choosing the method (asked once, changeable any time) */
function prChooseMethod(first) {
  const cur = prCfg || { method: 'jafari', asr: 1, adj: {} };
  const el = document.createElement('div'); el.className = 'wxModal'; el.id = 'prMBox';
  const adjRow = (k) => `<div class="prAdj"><span>${PR_NAMES[k]}</span><button class="chip" data-a="${k}" data-d="-1">−</button><b id="prA_${k}">${(cur.adj || {})[k] || 0}</b><button class="chip" data-a="${k}" data-d="1">+</button></div>`;
  el.innerHTML = `<div class="card"><h3>🕌 طريقة حساب الأوقات</h3>
    ${first ? '<div class="s" style="padding:2px 14px 8px">اختر الطريقة التي يعتمدها مسجدك أو تقويمك. يمكنك تغييرها لاحقًا.</div>' : ''}
    ${Object.entries(PR_METHODS).map(([k, m]) => `<label class="wxSw"><input type="radio" name="prM" value="${k}" ${cur.method === k ? 'checked' : ''}> ${m.name}</label>`).join('')}
    <div class="s" style="padding:8px 14px 2px"><b>وقت العصر</b> (لغير التوقيت الجعفري):</div>
    <label class="wxSw"><input type="radio" name="prA" value="1" ${cur.asr !== 2 ? 'checked' : ''}> الجمهور (ظل الشيء مثله)</label>
    <label class="wxSw"><input type="radio" name="prA" value="2" ${cur.asr === 2 ? 'checked' : ''}> الحنفي (ظل الشيء مثليه)</label>
    <details style="padding:4px 14px"><summary class="s">تعديل الأوقات بالدقائق لتطابق تقويم مسجدك</summary>${['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map(adjRow).join('')}</details>
    <div class="btnRow" style="padding:10px 14px 14px"><button class="chip go" id="prMOk">حفظ</button></div></div>`;
  document.body.appendChild(el);
  const adj = Object.assign({}, cur.adj || {});
  el.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => { const k = b.dataset.a; adj[k] = Math.max(-30, Math.min(30, (adj[k] || 0) + +b.dataset.d)); $('prA_' + k).textContent = adj[k]; }; });
  el.onclick = (e) => { if (e.target === el && prCfg) el.remove(); };
  $('prMOk').onclick = () => {
    prCfg = { method: el.querySelector('[name=prM]:checked').value, asr: +el.querySelector('[name=prA]:checked').value, adj };
    if (prCfg.method === 'jafari') prCfg.asr = 1;
    store.set('prCfg', prCfg); el.remove(); openPrayer();
  };
}
/* ---------------- the adhan ---------------- */
function adhanCfg() { return Object.assign({ on: false, prayers: ADHAN_KEYS.slice(), sound: null, loud: false }, (prCfg && prCfg.adhan) || {}); }
function adhanDefaultSound() { const j = prCfg && prCfg.method === 'jafari'; return (ADHAN_SOUNDS.find((x) => !!x.jafari === j && x.def) || ADHAN_SOUNDS.find((x) => !!x.jafari === j) || ADHAN_SOUNDS[0] || {}).id; }
const adhanSound = (id) => ADHAN_SOUNDS.find((x) => x.id === id) || ADHAN_SOUNDS.find((x) => x.id === adhanDefaultSound());
let adhanPreview = null;
function prAdhanCard() {
  const el = $('prAdhan'); if (!el) return;
  const a = adhanCfg(), snd = adhanSound(a.sound);
  if (!ADHAN_SOUNDS.length) { el.remove(); return; }
  let next = '';
  try { if (NATIVE && Android.adhanNext && a.on) { const [t, k] = Android.adhanNext().split('|'); if (+t > Date.now()) next = 'الأذان القادم: ' + PR_NAMES[ADHAN_KEYS[+k]] + ' ' + prClock(new Date(+t)); } } catch (e) {}
  let ready = true; try { if (NATIVE && Android.adhanReady && a.on && snd) ready = Android.adhanReady(snd.id); } catch (e) {}
  el.innerHTML = `<h3>🔊 الأذان</h3>
    <label class="wxSw"><input type="checkbox" id="adOn" ${a.on ? 'checked' : ''}> رفع الأذان في أوقات الصلاة ${NATIVE ? '(حتى والبرنامج مغلق)' : '(ما دامت صفحة الملاح مفتوحة)'}</label>
    <div class="${a.on ? '' : 'hidden'}" id="adMore">
      <div class="adPr">${ADHAN_KEYS.map((k) => `<button class="chip${a.prayers.includes(k) ? ' on' : ''}" data-ad="${k}">${PR_NAMES[k]}</button>`).join('')}</div>
      <div class="s" style="padding:6px 14px 2px">الصوت:</div>
      ${ADHAN_SOUNDS.slice().sort((x, y) => (prCfg.method === 'jafari' ? (y.jafari ? 1 : 0) - (x.jafari ? 1 : 0) : (x.jafari ? 1 : 0) - (y.jafari ? 1 : 0))).map((x) => `<label class="wxSw adSnd"><input type="radio" name="adS" value="${x.id}" ${snd && snd.id === x.id ? 'checked' : ''}> <span style="flex:1">${esc(x.name)}<br><small class="s">${esc(x.credit)}</small></span><button class="chip" data-play="${x.id}">▶</button></label>`).join('')}
      ${NATIVE ? `<label class="wxSw"><input type="checkbox" id="adLoud" ${a.loud ? 'checked' : ''}> يُرفع حتى والهاتف على الصامت</label>` : ''}
      <div class="s" style="padding:4px 14px 12px">${!ready ? '⏳ جارٍ تنزيل صوت الأذان (مرة واحدة)… ' : ''}${next}</div>
    </div>`;
  const save = (ch) => { prCfg.adhan = Object.assign(adhanCfg(), ch); store.set('prCfg', prCfg); adhanSync(true); prAdhanCard(); };
  $('adOn').onchange = () => save({ on: $('adOn').checked, sound: a.sound || adhanDefaultSound() });
  el.querySelectorAll('[data-ad]').forEach((b) => { b.onclick = () => { const p = adhanCfg().prayers.slice(), i = p.indexOf(b.dataset.ad); if (i >= 0) p.splice(i, 1); else p.push(b.dataset.ad); save({ prayers: p }); }; });
  el.querySelectorAll('[name=adS]').forEach((r) => { r.onchange = () => save({ sound: r.value }); });
  if ($('adLoud')) $('adLoud').onchange = () => save({ loud: $('adLoud').checked });
  el.querySelectorAll('[data-play]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (adhanPreview) { adhanPreview.pause(); const same = adhanPreview._id === b.dataset.play; adhanPreview = null; document.querySelectorAll('[data-play]').forEach((x) => { x.textContent = '▶'; }); if (same) return; }
      const x = ADHAN_SOUNDS.find((s) => s.id === b.dataset.play);
      adhanPreview = new Audio(ADHAN_BASE + x.file); adhanPreview._id = x.id;
      adhanPreview.play().then(() => { b.textContent = '⏸'; }).catch(() => toast('تعذّر تشغيل الصوت — تحقق من الإنترنت'));
      adhanPreview.onended = () => { b.textContent = '▶'; adhanPreview = null; };
    };
  });
}
/* tell the phone (Android) what to do; it keeps one alarm for the next adhan */
let adhanSent = null;
function adhanSync(force) {
  if (!prCfg) return;
  const a = adhanCfg(), w = prWhere(), snd = adhanSound(a.sound);
  if (!force && adhanSent && Math.abs(adhanSent.lat - w.lat) < 0.15 && Math.abs(adhanSent.lng - w.lng) < 0.15) return;
  adhanSent = { lat: w.lat, lng: w.lng };
  if (NATIVE && Android.adhanConfig) {
    try { Android.adhanConfig(JSON.stringify({ on: !!a.on && !!snd, prayers: a.prayers, method: prCfg.method, asr: prCfg.asr || 1, adj: prCfg.adj || {}, lat: w.lat, lng: w.lng, loud: !!a.loud, sound: snd ? { id: snd.id, url: ADHAN_BASE + snd.file } : null })); } catch (e) {}
  } else adhanWebPlan();
}
/* web: only while the page is open */
let adhanWebT = null;
function adhanWebPlan() {
  clearTimeout(adhanWebT);
  const a = adhanCfg(), snd = adhanSound(a.sound);
  if (!a.on || !snd || !prCfg) return;
  const w = prWhere(), now = new Date();
  let best = null;
  for (let d = 0; d < 2 && !best; d++) {
    const day = new Date(now); day.setDate(day.getDate() + d);
    const T = prayerTimes(day, w.lat, w.lng, prCfg);
    for (const k of ADHAN_KEYS) if (a.prayers.includes(k) && T[k] && T[k] > now && (!best || T[k] < best.t)) best = { k, t: T[k] };
  }
  if (!best || best.t - now > 2 ** 31 - 1) return;
  adhanWebT = setTimeout(() => {
    const au = new Audio(ADHAN_BASE + snd.file);
    au.play().catch(() => {});
    toast('🕌 حان وقت صلاة ' + PR_NAMES[best.k], 8000);
    setTimeout(adhanWebPlan, 60000);
  }, best.t - now);
}
setTimeout(() => adhanSync(true), 8000);
setInterval(() => adhanSync(false), 5 * 60e3);
{ const b = $('openPrayer'); if (b) b.onclick = openPrayer; }
try { if (NATIVE && Android.takePrayerLaunch && Android.takePrayerLaunch()) setTimeout(openPrayer, 700); } catch (e) {}
window.openPrayer = openPrayer;
