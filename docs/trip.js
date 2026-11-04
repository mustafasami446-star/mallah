'use strict';
/* الملاح — مشاركة الرحلة مع العائلة: رابط يفتح بأي متصفح ويُظهر موقعك مباشرة حتى تصل (أو حتى تنتهي المدة).
   The position goes encrypted to a group of its own; the key is only in the link's #part, which browsers never
   send to a server, so only whoever has the link can see it. On Android the background service keeps sharing
   with the screen off; on the web the page shares while it is open. */

const TRIP_PAGE = 'https://mustafasami446-star.github.io/mallah/trip/#';
let trip = store.get('trip', null);          // {code, gid, key (b64), uid, name, dest, until, start, arr}
let tripKey = null, tripPub = { t: 0, lat: 0, lng: 0 };

async function tripKeyOf(t) { return (tripKey && tripKey.code === t.code) ? tripKey.k : (tripKey = { code: t.code, k: (await teamKeys(t.code)).key }).k; }
async function tripEnc(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tripKeyOf(trip), te.encode(JSON.stringify(obj))));
  return b64(iv) + '.' + b64(ct);
}
function tripRemain() {
  if (!trip || !trip.dest || !me) return {};
  const same = dest && Math.abs(dest.lat - trip.dest.lat) < 1e-5 && Math.abs(dest.lng - trip.dest.lng) < 1e-5;
  if (same && navState && navState.r) {
    const r = navState.r, remain = Math.max(0, r.total - navState.along), secs = r.total > 0 ? r.duration * (remain / r.total) : 0;
    return { rem: Math.round(remain), eta: Math.round(Date.now() + secs * 1000) };
  }
  return { rem: Math.round(hav([me.lat, me.lng], [trip.dest.lat, trip.dest.lng])) };
}
async function tripPublish(extra) {
  if (!trip || !me) return false;
  const rec = Object.assign({ n: trip.name, lat: Math.round(me.lat * 1e6) / 1e6, lng: Math.round(me.lng * 1e6) / 1e6, a: Math.round(me.acc || 0), t: Date.now() }, tripRemain(), extra || {});
  if (me.heading != null) rec.h = Math.round(me.heading);
  if (me.speed != null) rec.s = Math.round(me.speed * 10) / 10;
  if (trip.dest) rec.dest = trip.dest;
  if (trip.arr) rec.arr = trip.arr;
  try {
    await fbReq('PUT', '/groups/' + trip.gid + '/members/' + trip.uid, { e: await tripEnc(rec), t: { '.sv': 'timestamp' } });
    tripPub = { t: Date.now(), lat: me.lat, lng: me.lng };
    return true;
  } catch (e) { return false; }
}
/* the page shares by itself only while the Android background service is not doing it */
function tripBgRunning() { try { return BG_OK && Android.teamRunning(); } catch (e) { return false; } }
setInterval(() => {
  if (!trip) return;
  const now = Date.now();
  if ((trip.arr && now - trip.arr > 10 * 60e3) || now > trip.until) { tripStop(true); return; }
  if (!me || document.visibilityState !== 'visible' || tripBgRunning()) return;
  const moved = tripPub.t ? hav([tripPub.lat, tripPub.lng], [me.lat, me.lng]) : 1e9;
  const moving = (me.speed != null && me.speed > 1) || moved > 30;
  if (now - tripPub.t >= (moving ? 15e3 : 60e3)) tripPublish();
  tripBar();
}, 5000);

/* ---------------- start and stop ---------------- */
async function tripStart(destination, hours) {
  if (!me) { toast('بانتظار تحديد موقعك…'); startLocation(); return; }
  if (trip) { tripShareLink(); return; }
  let name = store.get('tripName', '') || store.get('teamName', '');
  if (!name) { name = ((await uiPrompt('اسمك كما ستراه العائلة:', '', { ok: 'متابعة' })) || '').trim().slice(0, 30); if (!name) return; }
  store.set('tripName', name);
  toast('📡 جارٍ تجهيز الرابط…');
  try {
    await fbToken(); await fbDb();
    const code = newCode(), { gid } = await teamKeys(code);
    trip = { code, gid, uid: fbAuth.uid, name, dest: destination ? { lat: +destination.lat.toFixed(6), lng: +destination.lng.toFixed(6), n: String(destination.name || 'الوجهة').slice(0, 60) } : null,
      start: Date.now(), until: Date.now() + (destination ? 12 : (hours || 1)) * 3600e3, arr: 0 };
    tripKey = null;
    await fbReq('PUT', '/groups/' + gid + '/meta', { owner: fbAuth.uid, e: await tripEnc({ n: name, kind: 'trip', start: trip.start, until: trip.until }) });
    store.set('trip', trip);
    if (!(await tripPublish())) throw new Error('publish');
  } catch (e) {
    trip = null; store.set('trip', null);
    toast(String(e && e.message).includes('403') || String(e && e.message).includes('401') ? 'رفض الخادم الطلب — تحقق من قواعد Firebase' : 'تعذّرت المشاركة — تحقق من الإنترنت', 4500);
    return;
  }
  if (typeof bgSync === 'function') bgSync(true);
  if (BG_OK && !store.get('teamBgAsked', false)) { store.set('teamBgAsked', true); try { Android.teamPerms(false); } catch (e) {} }
  tripBar();
  tripShareLink();
}
function tripShareLink() {
  if (!trip) return;
  const link = TRIP_PAGE + trip.code;
  const text = '📡 ' + trip.name + ' يشارك رحلته معك' + (trip.dest ? ' إلى «' + trip.dest.n + '»' : '') + ' — افتح الرابط لترى موقعه مباشرة' + (trip.dest ? ' حتى يصل' : '') + ':\n' + link;
  doShare(text);
}
async function tripStop(auto) {
  if (!trip) return;
  const t = trip;
  if (me) await tripPublish({ end: Date.now() });            // the family's page shows «انتهت المشاركة»
  trip = null; tripKey = null; store.set('trip', null);
  if (typeof bgSync === 'function') bgSync(true);
  tripBar();
  toast(auto ? (t.arr ? '✓ انتهت مشاركة الرحلة بعد وصولك' : '✓ انتهت مدة مشاركة الرحلة') : '✋ أوقفتَ مشاركة الرحلة', 4000);
}
/* arriving: the family sees «وصل», the link stays 10 minutes more, then stops by itself */
{
  const _arr = window.onArrived;
  window.onArrived = function (at) {
    try { if (_arr) _arr.apply(this, arguments); } catch (e) {}
    if (trip && trip.dest && !trip.arr && at && hav([at.lat, at.lng], [trip.dest.lat, trip.dest.lng]) < 300) {
      trip.arr = Date.now(); store.set('trip', trip); tripPublish(); if (typeof bgSync === 'function') bgSync(true); tripBar();
    }
  };
}
/* for the Android background service (teambg.js puts it in its settings) */
window.tripBg = async () => {
  if (!trip) return null;
  return { gid: trip.gid, key: b64(await sha('mallah-key|' + trip.code.replace(/-/g, ''))), dest: trip.dest, until: trip.arr ? Math.min(trip.until, trip.arr + 10 * 60e3) : trip.until };
};
window.tripOnEvent = (ev) => {
  if (!trip) return;
  if (ev === 'paused') { trip = null; store.set('trip', null); tripBar(); toast('✋ أوقفتَ المشاركة من الإشعار'); }
  if (ev === 'tripEnded') { trip = null; store.set('trip', null); tripBar(); toast('✓ انتهت مشاركة الرحلة'); }
};

/* ---------------- on the screen ---------------- */
function tripBar() {
  let b = $('tripBar');
  if (!trip) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'tripBar'; document.body.appendChild(b); }
  const left = Math.max(0, trip.until - Date.now()), h = Math.floor(left / 3600e3), m = Math.round((left % 3600e3) / 60e3);
  b.innerHTML = `<span class="dot"></span><span class="g">📡 ${trip.arr ? 'وصلت — تنتهي المشاركة بعد قليل' : trip.dest ? 'العائلة تتابع رحلتك إلى ' + esc(trip.dest.n) : 'العائلة تتابع موقعك · ' + (h ? h + ' س ' : '') + m + ' د'}</span><button id="tripSh">🔗</button><button id="tripX">إيقاف</button>`;
  $('tripSh').onclick = tripShareLink;
  $('tripX').onclick = async () => { if (await uiConfirm('إيقاف مشاركة الرحلة؟ لن ترى العائلة موقعك بعد الآن.', { ok: 'إيقاف', danger: true })) tripStop(false); };
}
/* the share menus get a «live link» choice */
{
  const _menu = shareMenu;
  shareMenu = function (title, lat, lng, extra, msgTitle) {
    const nav = (navState || directState) && dest && me;
    const mine = title === '📍 موقعي الحالي';
    if (!nav && !mine) return _menu.apply(this, arguments);
    const text = locText(msgTitle || title, lat, lng, extra);
    const live = trip
      ? [{ label: '🔗 إرسال رابط الرحلة المباشر مرة أخرى', fn: tripShareLink }, { label: '✋ إيقاف مشاركة الرحلة', fn: () => tripStop(false) }]
      : nav ? [{ label: '📡 رابط مباشر — يتابعونك حتى تصل', fn: () => tripStart({ lat: dest.lat, lng: dest.lng, name: dest.name }) }]
        : [{ label: '📡 رابط مباشر لموقعي — ساعة', fn: () => tripStart(null, 1) }, { label: '📡 رابط مباشر لموقعي — 4 ساعات', fn: () => tripStart(null, 4) }];
    actionSheet(title, live.concat([
      { label: '↗ رسالة بموقعي الآن (واتساب، تيليجرام…)', fn: () => doShare(text) },
      { label: '✉️ رسالة SMS — تعمل بدون إنترنت', fn: () => doSms(text) }
    ]));
  };
}
tripBar();
