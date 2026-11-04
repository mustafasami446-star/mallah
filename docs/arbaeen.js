'use strict';
/* الملاح — مشاية الأربعين: رقم العمود الذي أنت عنده، والباقي إلى كربلاء، ونقطة لقاء العائلة.
   The poles are not published with coordinates, so the walker sets them: the number of the pole they stand
   at, then the next one when they reach it — that gives the distance between poles on this road. From then
   on the distance walked counts the poles. A tap on «أنا عند العمود…» corrects it any time. All offline. */

let arb = store.get('arbaeen', null);   // {on, n0, step, dir, goal, dist, last:[lat,lng], cal:{n,lat,lng}, meet, mawakib:[], t0, d0}
function arbSave() { store.set('arbaeen', arb); }
const arbPole = () => arb && arb.step ? Math.round(arb.n0 + arb.dir * arb.dist / arb.step) : (arb ? arb.n0 : 0);
const arbLeft = () => arb && arb.goal ? Math.max(0, (arb.goal - arbPole()) * arb.dir) : null;

/* ---------------- start, calibrate, correct ---------------- */
async function arbStart() {
  if (!me) { toast('بانتظار تحديد موقعك…'); startLocation(); return; }
  const v = await uiPrompt('🚶 مشاية الأربعين\nما رقم العمود الذي تقف عنده الآن؟ (مكتوب على العمود)', arb ? String(arbPole()) : '', { num: 1, ok: 'التالي' });
  if (v == null) return;
  const n = parseInt(normDigits(v), 10);
  if (!isFinite(n) || n < 0) { toast('اكتب رقم العمود'); return; }
  const g = await uiPrompt('رقم العمود الأخير (عند وصولك). من النجف إلى كربلاء حوالي 1452 — اتركه فارغًا إن لم تعرفه', arb && arb.goal ? String(arb.goal) : (n < 1452 ? '1452' : ''), { num: 1, ok: 'ابدأ' });
  if (g == null) return;
  const goal = parseInt(normDigits(g || ''), 10);
  const keep = arb && arb.step ? { step: arb.step, mawakib: arb.mawakib || [], meet: arb.meet || null } : { mawakib: (arb && arb.mawakib) || [], meet: (arb && arb.meet) || null };
  arb = Object.assign({ on: true, n0: n, dir: isFinite(goal) && goal < n ? -1 : 1, goal: isFinite(goal) ? goal : null, dist: 0, last: [me.lat, me.lng], t0: Date.now(), d0: 0,
    cal: keep.step ? null : { n, lat: me.lat, lng: me.lng } }, keep);
  arbSave(); keepGps(); arbBar();
  if (!arb.step) {
    say('امشِ إلى العمود التالي، وعندما تصل اضغط وصلت العمود التالي');
    toast('امشِ إلى العمود ' + (n + arb.dir) + ' واضغط «وصلت العمود التالي» عند وصولك — هكذا يعرف الملاح المسافة بين الأعمدة', 7000);
  } else toast('✓ أنت عند العمود ' + n, 3000);
}
/* reaching the next pole: the distance between the two taps is one pole (or more, if they say so) */
async function arbCalibrate() {
  if (!arb || !arb.cal || !me) return;
  const def = arb.cal.n + arb.dir;
  const v = await uiPrompt('رقم العمود الذي وصلت إليه', String(def), { num: 1, ok: 'احسب' });
  if (v == null) return;
  const n = parseInt(normDigits(v), 10), k = Math.abs(n - arb.cal.n);
  const d = hav([arb.cal.lat, arb.cal.lng], [me.lat, me.lng]);
  if (!k) { toast('اكتب رقم عمود غير الذي بدأت عنده'); return; }
  const step = d / k;
  if (step < 15 || step > 200) { toast('المسافة غير منطقية (' + Math.round(step) + ' م بين العمودين) — تأكد من دقة الموقع وحاول مرة أخرى', 5000); arb.cal = { n, lat: me.lat, lng: me.lng }; arbSave(); arbBar(); return; }
  arb.step = step; arb.dir = n > arb.cal.n ? 1 : -1; arb.n0 = n; arb.dist = 0; arb.last = [me.lat, me.lng]; arb.cal = null;
  arb.t0 = Date.now(); arb.d0 = 0;
  arbSave(); arbBar();
  toast('✓ المسافة بين الأعمدة ' + Math.round(step) + ' م — يعدّ الملاح الأعمدة الآن وأنت تمشي', 5000);
  say('تم. المسافة بين الأعمدة ' + Math.round(step) + ' متر');
}
async function arbCorrect() {
  if (!arb) return;
  const v = await uiPrompt('أنا عند العمود رقم:', String(arbPole()), { num: 1, ok: 'تصحيح' });
  if (v == null) return;
  const n = parseInt(normDigits(v), 10); if (!isFinite(n)) return;
  // keep the walking speed: what was walked so far stays counted in the time
  arb.d0 += arb.dist; arb.n0 = n; arb.dist = 0; if (me) arb.last = [me.lat, me.lng];
  arbSave(); arbBar(); toast('✓ صُحّح: العمود ' + n, 2500);
}
function arbStop() {
  if (!arb) return;
  arb.on = false; arbSave(); keepGps(); arbBar();
  toast('أوقفتَ عدّ الأعمدة — تبقى نقطة اللقاء والمواكب محفوظة', 4000);
}

/* ---------------- counting while walking ---------------- */
function arbOnLoc() {
  if (!arb || !arb.on || !me) return;
  if ((me.acc || 0) > 35) return;                       // a poor fix would add false steps
  if (!arb.last) { arb.last = [me.lat, me.lng]; return; }
  const d = hav(arb.last, [me.lat, me.lng]);
  if (d < 12) return;                                    // standing still: GPS jitter is not walking
  if (d > 3000) { arb.last = [me.lat, me.lng]; arbSave(); return; }   // a jump (car, bad fix): skip it
  arb.dist += d; arb.last = [me.lat, me.lng];
  arbSave(); arbBar();
}
{
  const _prev = window.onOpsLocation;
  window.onOpsLocation = function () { if (_prev) _prev.apply(this, arguments); arbOnLoc(); };
  const _kg = keepGps;
  keepGps = function () { _kg(); if (NATIVE && arb && arb.on) try { Android.setNavigating(true); } catch (e) {} };
}

/* ---------------- on the screen ---------------- */
function arbBar() {
  let b = $('arbBar');
  if (!arb || !arb.on) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'arbBar'; document.body.appendChild(b); }
  if (arb.cal) {
    b.innerHTML = `<span class="g">🚶 بدأت عند العمود <b>${arb.cal.n}</b> — امشِ إلى التالي</span><button id="arbCal">وصلت العمود التالي</button><button id="arbX">✕</button>`;
    $('arbCal').onclick = arbCalibrate;
  } else {
    const n = arbPole(), left = arbLeft();
    const walked = arb.d0 + arb.dist, hrs = (Date.now() - arb.t0) / 3600e3;
    const v = hrs > 0.25 && walked > 500 ? walked / 1000 / hrs : 4;            // km/h, 4 until there is enough walking
    const eta = left != null && arb.step ? left * arb.step / 1000 / v : null;
    b.innerHTML = `<span class="g">🚶 العمود <b>${n}</b>${left != null ? ` · بقي <b>${left}</b> عمود (${(left * arb.step / 1000).toFixed(1)} كم${eta != null ? ' · ≈ ' + (eta < 1 ? Math.round(eta * 60) + ' د' : eta.toFixed(1) + ' س') : ''})` : ''}</span><button id="arbMenu">⋯</button>`;
    $('arbMenu').onclick = arbMenu;
    b.querySelector('.g').onclick = arbMenu;
  }
  const x = $('arbX'); if (x) x.onclick = arbStop;
}
function arbMenu() {
  const n = arbPole();
  const near = (arb.mawakib || []).map((m) => Object.assign({ gap: (m.n - n) * arb.dir }, m)).filter((m) => m.gap >= 0).sort((a, b) => a.gap - b.gap)[0];
  actionSheet('🚶 العمود ' + n + (arb.step ? ' · ' + Math.round(arb.step) + ' م بين الأعمدة' : ''), [
    { label: '✏️ أنا عند عمود آخر — تصحيح الرقم', fn: arbCorrect },
    { label: '📍 نقطة لقاء العائلة هنا (العمود ' + n + ')', fn: () => arbMeet(n) },
    ...(arb.meet ? [{ label: '🧭 نقطة اللقاء: العمود ' + arb.meet.n + ' — ' + (arb.meet.n === n ? 'أنت عندها' : 'بعد ' + Math.abs(arb.meet.n - n) + ' عمود ' + ((arb.meet.n - n) * arb.dir > 0 ? 'أمامك' : 'خلفك')), fn: () => arbShowMeet() }] : []),
    { label: '↗ أرسل موقعي: «أنا عند العمود ' + n + '»', fn: () => doShare('🚶 أنا الآن عند العمود ' + n + ' في طريق المشاية' + (me ? '\nhttps://maps.google.com/?q=' + me.lat.toFixed(6) + ',' + me.lng.toFixed(6) : '')) },
    { label: '✉️ نفس الرسالة SMS — بدون إنترنت', fn: () => doSms('أنا الآن عند العمود ' + n + ' في طريق المشاية' + (me ? ' ' + me.lat.toFixed(5) + ',' + me.lng.toFixed(5) : '')) },
    { label: '🍲 سجّل موكبًا هنا', fn: () => arbAddMawkib(n) },
    ...(near ? [{ label: '🍲 أقرب موكب سجّلته أمامك: ' + esc(near.name) + ' (العمود ' + near.n + '، بعد ' + near.gap + ')', fn: () => {} }] : []),
    ...((arb.mawakib || []).length ? [{ label: '📋 مواكبي (' + arb.mawakib.length + ')', fn: arbMawakib }] : []),
    { label: '📏 أعد قياس المسافة بين الأعمدة', fn: () => { arb.step = null; arb.cal = me ? { n, lat: me.lat, lng: me.lng } : null; arbSave(); arbBar(); toast('امشِ إلى العمود التالي واضغط «وصلت العمود التالي»', 5000); } },
    { label: '⏹ إيقاف عدّ الأعمدة', cls: 'danger', fn: arbStop }
  ]);
}
async function arbMeet(n) {
  arb.meet = { n, lat: me ? me.lat : null, lng: me ? me.lng : null, t: Date.now() }; arbSave();
  const text = '📍 نقطة لقائنا: العمود ' + n + ' في طريق المشاية' + (me ? '\nhttps://maps.google.com/?q=' + me.lat.toFixed(6) + ',' + me.lng.toFixed(6) : '') + '\nإذا تفرّقنا نلتقي هنا.';
  if (await uiConfirm('حُفظت نقطة اللقاء عند العمود ' + n + '. هل ترسلها للعائلة الآن؟', { ok: 'أرسل' })) doShare(text);
}
function arbShowMeet() {
  if (!arb.meet || arb.meet.lat == null) return;
  if (typeof setDestination === 'function') setDestination(arb.meet.lat, arb.meet.lng, 'نقطة اللقاء — العمود ' + arb.meet.n, 'مشاية الأربعين');
}
async function arbAddMawkib(n) {
  const name = await uiPrompt('اسم الموكب أو ما يقدّمه (طعام، ماء، استراحة، علاج…)', '', { ok: 'حفظ' });
  if (!name || !name.trim()) return;
  (arb.mawakib = arb.mawakib || []).push({ n, name: name.trim().slice(0, 60), lat: me ? me.lat : null, lng: me ? me.lng : null });
  arbSave(); toast('✓ حُفظ الموكب عند العمود ' + n);
}
function arbMawakib() {
  const n = arbPole();
  actionSheet('🍲 مواكبي', arb.mawakib.slice().sort((a, b) => a.n - b.n).map((m) => ({
    label: '🍲 ' + esc(m.name) + ' — العمود ' + m.n + (m.n === n ? ' (أنت هنا)' : ' (' + Math.abs(m.n - n) + ' ' + ((m.n - n) * arb.dir > 0 ? 'أمامك' : 'خلفك') + ')'),
    fn: () => { if (m.lat != null) setDestination(m.lat, m.lng, m.name, 'موكب — العمود ' + m.n); }
  })));
}

/* the menu entry */
{
  const s = $('openSettings');
  if (s) {
    const b = document.createElement('button'); b.id = 'openArbaeen';
    b.innerHTML = '<span style="font-size:19px;width:22px;text-align:center">🚶</span>مشاية الأربعين (عدّ الأعمدة)';
    s.parentNode.insertBefore(b, s);
    b.onclick = () => { $('menuDrop').classList.add('hidden'); if (arb && arb.on) arbMenu(); else arbStart(); };
  }
}
arbBar();
