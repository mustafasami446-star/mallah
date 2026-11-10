'use strict';
/* الملاح — ودجت الشاشة الرئيسية (أندرويد): الصلاة القادمة والطقس، وأزرار «إلى البيت» و«إلى العمل» و«إلى أين؟».
   يحسب الهاتف الصلاة بنفسه؛ والبرنامج يعطيه سطر الطقس كلما تحدّث. */

let wgLast = '';
function wgPush() {
  if (!(NATIVE && typeof Android !== 'undefined' && Android.widgetData)) return;
  const el = $('dbWx'); if (!el) return;
  const ic = (el.querySelector('.di') || {}).textContent || '', t = (el.querySelector('b') || {}).textContent || '', w = (el.querySelector('.dt') || {}).textContent || '';
  if (!t) return;
  const d = JSON.stringify({ ic, t: t + ' ' + w.split(' · ')[0] });
  if (d === wgLast) return;
  wgLast = d;
  try { Android.widgetData(d); } catch (e) {}
}
setTimeout(wgPush, 9000);
setInterval(wgPush, 60e3);

/* a button of the widget was pressed */
window.onWidgetGo = async (k) => {
  if (k === 'prayer') { if (typeof openPrayer === 'function') openPrayer(); return; }
  if (k === 'weather') { if (typeof openWeather === 'function') openWeather(); return; }
  if (k === 'voice') {
    const t = await voiceAsk('إلى أين تريد الذهاب؟');
    homeExpand(true);
    if (!t) { qEl.focus(); return; }
    qEl.value = t; qEl.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  if (k === 'home' || k === 'work') {
    const f = favs.find((x) => x.kind === k);
    if (!f) { toast('احفظ ' + (k === 'home' ? 'البيت' : 'العمل') + ' أولًا: اختر المكان ثم «☆ حفظ في المفضلة» ← ' + (k === 'home' ? 'تعيين كالبيت' : 'تعيين كالعمل'), 5000); return; }
    setDestination(f.lat, f.lng, f.name || KIND_AR[k], '');
    // start as soon as the route is ready
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 300)); const b = $('startBtn'); if (b && !b.disabled) { b.click(); return; } }
  }
};
try { const g = NATIVE && Android.takeGoLaunch ? Android.takeGoLaunch() : null; if (g && g !== 'open') setTimeout(() => window.onWidgetGo(g), 2500); } catch (e) {}
