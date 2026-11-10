'use strict';
/* الملاح — «ذكّرني عند الوصول» والملخّص الصباحي.
   التذكير: تكتب ما تريد أن تتذكّره عند مكان، فيصلك إشعار حين تقترب منه — في أندرويد يراقب الهاتف المكان
   بنفسه (حتى والبرنامج مغلق إذا سمحتَ بالموقع «طوال الوقت»)، وفي نسخة الويب ما دام الملاح مفتوحًا.
   الملخّص الصباحي: إشعار واحد كل صباح في الوقت الذي تختاره: طقس منطقتك (والغبار والمطر)، والزمن من البيت
   إلى العمل، وأوقات الصلاة الباقية. */

/* ---------------- reminders by place ---------------- */
let remList = store.get('reminders', []);       // [{id, lat, lng, r, text, name, rep, t}]
function remSave() {
  store.set('reminders', remList);
  if (NATIVE && Android.remindConfig) {
    try { Android.remindConfig(JSON.stringify(remList.map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, r: x.r, text: x.text, name: x.name, rep: !!x.rep })))); } catch (e) {}
  }
}
async function remAdd(lat, lng, name) {
  name = (name || 'هذا المكان').replace(/^📍\s*/, '');
  const text = await uiPrompt('⏰ بماذا أذكّرك عند الوصول إلى ' + name + '؟', '', { ok: 'التالي', placeholder: 'مثلًا: اشترِ الخبز، سلّم الأوراق…' });
  if (text == null || !text.trim()) return;
  const done = (r, rep) => {
    remList.push({ id: 'r' + Date.now().toString(36), lat, lng, r, text: text.trim().slice(0, 140), name, rep, t: Date.now() });
    remSave();
    toast('⏰ سأذكّرك عند الوصول إلى ' + name, 3000);
    remPerms();
  };
  actionSheet('⏰ متى أذكّرك؟', [
    { label: 'عند الاقتراب (150 م) — مرة واحدة', fn: () => done(150, false) },
    { label: 'من مسافة أبعد (500 م) — مرة واحدة', fn: () => done(500, false) },
    { label: 'كل مرة أصل إلى هنا (150 م)', fn: () => done(150, true) }
  ]);
}
/* Android: notifications, then the location «all the time», so the place is noticed with the app closed */
async function remPerms() {
  if (!(NATIVE && Android.remindPerms)) return;
  try { if (Android.remindCanBg()) { Android.remindPerms(); return; } } catch (e) { return; }
  if (store.get('remBgAsked', false)) return;
  store.set('remBgAsked', true);
  await uiAlert('ليصلك التذكير والملاح مغلق، اختر في الصفحة التالية «السماح طوال الوقت» لإذن الموقع.\nبدونه يعمل التذكير والملاح مفتوح فقط.');
  try { Android.remindPerms(); } catch (e) {}
}
window.onRemindPerms = () => { try { if (!Android.remindCanBg()) toast('التذكير يعمل والملاح مفتوح فقط — يمكنك السماح بالموقع «طوال الوقت» من إعدادات الهاتف', 5000); } catch (e) {} };
function remFire(x) {
  x.last = Date.now();
  if (!x.rep) remList = remList.filter((y) => y !== x);
  remSave();
  try { Android.vibrate && Android.vibrate('120,80,120'); } catch (e) {}
  say('تذكير. ' + x.text);
  uiAlert('⏰ وصلت ' + x.name + '\n\n' + x.text);
}
// the web version (and a phone without the native watcher): check while the app is open
setInterval(() => {
  if ((NATIVE && Android.remindConfig) || !me || !remList.length) return;
  const now = Date.now();
  remList.slice().forEach((x) => {
    if (now - (x.last || 0) < 30 * 60e3) return;
    if (hav([me.lat, me.lng], [x.lat, x.lng]) <= x.r + Math.min(me.acc || 0, 100)) remFire(x);
  });
}, 15000);
// the ones the phone already told about while the app was closed
function remSync() {
  if (!(NATIVE && Android.remindFired)) return;
  try {
    const f = JSON.parse(Android.remindFired() || '[]');
    if (f.length) { remList = remList.filter((x) => !f.includes(x.id)); store.set('reminders', remList); }
  } catch (e) {}
}
remSync();
document.addEventListener('visibilitychange', () => { if (!document.hidden) remSync(); });
if (remList.length) setTimeout(remSave, 4000);     // after an update or a restart, the phone watches them again

function remListSheet() {
  const items = remList.map((x) => ({
    label: `<div style="text-align:right"><b>📍 ${esc(x.name)}</b>${x.rep ? ' <small>(كل مرة)</small>' : ''}<div class="s">${esc(x.text)}</div></div>`,
    fn: async () => { if (await uiConfirm('حذف التذكير عند «' + x.name + '»؟', { ok: 'حذف' })) { remList = remList.filter((y) => y !== x); remSave(); toast('حُذف التذكير'); } }
  }));
  items.push({ label: '➕ تذكير عند موقعي الحالي', fn: () => { if (!me) { toast('لم يُحدَّد موقعك بعد'); return; } remAdd(me.lat, me.lng, 'موقعك الحالي'); } });
  actionSheet(remList.length ? '⏰ تذكيرات الأماكن — اضغط تذكيرًا لحذفه' : '⏰ لا تذكيرات بعد — اختر مكانًا ثم «⋯» ← «⏰ ذكّرني عند الوصول هنا»', items);
}

/* ---------------- the morning summary ---------------- */
let mornCfg = store.get('mornCfg', { on: false, h: 7, m: 0 });
const mornDate = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);
let mornCommute = store.get('mornCommute', null);  // {day, min}
async function mornCommuteNow() {
  const home = favs.find((f) => f.kind === 'home'), work = favs.find((f) => f.kind === 'work');
  if (!home || !work || typeof offlineRoute !== 'function') return null;
  const today = mornDate(Date.now());
  if (mornCommute && mornCommute.day === today) return mornCommute.min;
  try { const r = await offlineRoute('car', [home.lat, home.lng], [work.lat, work.lng]); mornCommute = { day: today, min: Math.max(1, Math.round(r.duration / 60)) }; store.set('mornCommute', mornCommute); return mornCommute.min; } catch (e) { return null; }
}
/* the text of each coming day (the app prepares it; the phone shows it in the morning) */
async function mornDays() {
  const out = {};
  if (typeof WX === 'undefined' || !WX.data || !WX.ar) return out;
  const w = prWhere(), id = dayNearestArea(w.lat, w.lng), a = id && WX.data.areas[id]; if (!a) return out;
  const name = arShort(WX.ar.byId[id]), d0 = Date.parse(WX.data.day0 + 'T00:00:00Z'), com = await mornCommuteNow();
  for (let i = 0; i < Math.min(WX.data.days, 4); i++) {
    const s = wxSym(a.d.s[i]), parts = [`${s[0]} ${name}: ${s[1]}`];
    if (a.d.tx[i] != null) parts.push(a.d.tx[i] + '° / ' + a.d.tn[i] + '°');
    const p = a.d.p && a.d.p[i]; if (p != null && p >= 30) parts.push('💧 احتمال مطر ' + p + '%');
    const du = wxDust(a.d.u && a.d.u[i]); if (du && du[2] >= 2) parts.push(du[0] + ' ' + du[1]);
    if (a.d.tn[i] != null && a.d.tn[i] <= 1) parts.push('❄️ صقيع ليلًا');
    if (a.d.tx[i] != null && a.d.tx[i] >= 47) parts.push('🔥 حر شديد');
    let t = parts.join(' · ');
    if (com) t += '\n🚗 من البيت إلى العمل نحو ' + com + ' د';
    out[new Date(d0 + i * 86400e3).toISOString().slice(0, 10)] = t;
  }
  return out;
}
async function mornPush() {
  if (!(NATIVE && Android.morningConfig)) return;
  const days = mornCfg.on ? await mornDays() : {};
  try { Android.morningConfig(JSON.stringify({ on: !!mornCfg.on, h: mornCfg.h, m: mornCfg.m, days })); } catch (e) {}
}
const mornClock = () => (mornCfg.h % 12 || 12) + ':' + String(mornCfg.m).padStart(2, '0') + (mornCfg.h < 12 ? ' ص' : ' م');
async function mornSheet() {
  const today = await mornDays(), txt = today[mornDate(Date.now())] || '';
  const set = (h, m) => {
    mornCfg = { on: h != null, h: h == null ? mornCfg.h : h, m: m == null ? mornCfg.m : m }; store.set('mornCfg', mornCfg); mornPush();
    if (mornCfg.on) { try { if (NATIVE && Android.wxPerms) Android.wxPerms(); } catch (e) {} }
    toast(mornCfg.on ? '☀️ يصلك الملخّص كل يوم ' + mornClock() : 'أوقفتَ الملخّص الصباحي', 3000);
  };
  const T = [[6, 0], [6, 30], [7, 0], [7, 30], [8, 0]];
  actionSheet('☀️ الملخّص الصباحي' + (mornCfg.on ? ' — يعمل ' + mornClock() : ''), [
    { label: `<div class="s" style="text-align:right;white-space:pre-line">${txt ? esc(txt) + '\n🕌 وأوقات الصلاة الباقية' : 'طقس منطقتك، والزمن من البيت إلى العمل، وأوقات الصلاة'}</div>` },
    ...T.map(([h, m]) => ({ label: '⏰ كل يوم الساعة ' + (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ص' + (mornCfg.on && mornCfg.h === h && mornCfg.m === m ? ' ✓' : ''), fn: () => set(h, m) })),
    ...(mornCfg.on ? [{ label: '⏹ إيقاف الملخّص', fn: () => set(null) }] : [])
  ]);
}
// keep the coming days' text fresh: after the forecast loads, and every two hours
setTimeout(() => { if (mornCfg.on) mornPush(); }, 20000);
setInterval(() => { if (mornCfg.on) mornPush(); }, 2 * 3600e3);
// the web version: once a day, the first time the app is opened after the chosen time (until noon)
setTimeout(async () => {
  if (NATIVE || !mornCfg.on) return;
  const now = new Date(Date.now() + 3 * 3600e3), h = now.getUTCHours(), m = now.getUTCMinutes(), day = mornDate(Date.now());
  if (h * 60 + m < mornCfg.h * 60 + mornCfg.m || h >= 12 || store.get('mornShown', '') === day) return;
  const t = (await mornDays())[day]; if (!t) return;
  store.set('mornShown', day);
  uiAlert('☀️ صباح الخير\n\n' + t);
}, 25000);

/* ---------------- the menu, and «⋯» on a place ---------------- */
{
  const s = $('openSettings');
  if (s) {
    const mk = (id, icon, label, fn) => { const b = document.createElement('button'); b.id = id; b.innerHTML = '<span style="font-size:19px;width:22px;text-align:center">' + icon + '</span>' + label; b.onclick = () => { $('menuDrop').classList.add('hidden'); fn(); }; s.parentNode.insertBefore(b, s); };
    mk('openRemind', '⏰', 'تذكيرات الأماكن', remListSheet);
    mk('openMorning', '☀️', 'الملخّص الصباحي', mornSheet);
  }
  const _share = shareMenu;
  shareMenu = function (title, lat, lng, extra, msgTitle) {
    _share(title, lat, lng, extra, msgTitle);
    const box = $('mBtns'), cancel = box && box.querySelector('.cancel'); if (!cancel) return;
    const b = document.createElement('button'); b.innerHTML = '⏰ ذكّرني عند الوصول هنا';
    b.onclick = () => { closeModal(); remAdd(lat, lng, msgTitle || title); };
    cancel.before(b);
  };
}
