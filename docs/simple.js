'use strict';
/* الملاح — الوضع المبسّط (لكبار السن ولمن يريد البرنامج سهلًا): ستة أزرار كبيرة مكان القائمة السفلية —
   إلى البيت، أماكني، أين أنا؟، الاتصال بفرد من العائلة، إرسال موقعي إليه، وإلى أين؟ بالصوت — ويُخفى الباقي. */

let simpleOn = store.get('simple', false);
let simpleFam = store.get('simpleFam', null);     // {name, tel}
function simpleBar() {
  let b = $('simpleBar');
  if (!simpleOn) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'simpleBar'; $('homeGrab').after(b); }
  const fam = simpleFam ? esc(simpleFam.name) : 'العائلة';
  b.innerHTML = `
    <button data-s="home"><i>⌂</i>إلى البيت</button>
    <button data-s="favs"><i>★</i>أماكني</button>
    <button data-s="where"><i>📍</i>أين أنا؟</button>
    <button data-s="voice"><i>🎤</i>إلى أين؟</button>
    <button data-s="call"><i>📞</i>اتصل بـ${fam}</button>
    <button data-s="send"><i>✉️</i>أرسل موقعي إلى ${fam}</button>
    <a data-s="off">الخروج من الوضع المبسّط</a>`;
  b.onclick = (e) => { const x = e.target.closest('[data-s]'); if (x) simpleDo(x.dataset.s); };
}
async function simpleFamAsk() {
  const name = await uiPrompt('من تريد أن تتصل به بلمسة واحدة؟ (الاسم)', simpleFam ? simpleFam.name : '', { ok: 'التالي', placeholder: 'مثلًا: ابني أحمد' });
  if (name == null || !name.trim()) return null;
  const tel = await uiPrompt('رقم هاتف ' + name.trim(), simpleFam ? simpleFam.tel : '', { ok: 'حفظ', num: 1, placeholder: '07xxxxxxxxx' });
  if (tel == null || normDigits(tel).replace(/[^0-9+]/g, '').length < 7) return null;
  simpleFam = { name: name.trim().slice(0, 24), tel: normDigits(tel).replace(/[^0-9+]/g, '') };
  store.set('simpleFam', simpleFam); simpleBar();
  return simpleFam;
}
async function simpleWhere() {
  if (!me) { toast('جارٍ تحديد موقعك…'); if (typeof startLocation === 'function') startLocation(); return null; }
  const parts = [];
  try { const st = typeof roadsStreetAt === 'function' ? await roadsStreetAt(me.lat, me.lng) : null; if (st && st.name) parts.push((/^(شارع|طريق|جسر|ساحة)/.test(st.name) ? '' : 'شارع ') + st.name); } catch (e) {}
  try { await arLoad(); const h = arHere(me.lat, me.lng); const names = h.slice().reverse().slice(0, 2).map((id) => arShort(AR.byId[id])); parts.push(...names); } catch (e) {}
  return parts.length ? 'أنت في ' + parts.join('، ') : 'أنت هنا: ' + me.lat.toFixed(5) + '، ' + me.lng.toFixed(5);
}
async function simpleDo(k) {
  if (k === 'home') { window.onWidgetGo('home'); return; }
  if (k === 'favs') { const b = $('openFavs'); if (b) b.click(); return; }
  if (k === 'voice') { window.onWidgetGo('voice'); return; }
  if (k === 'where') {
    const t = await simpleWhere(); if (!t) return;
    say(t);
    uiAlert('📍 ' + t);
    return;
  }
  if (k === 'call' || k === 'send') {
    const f = simpleFam || await simpleFamAsk(); if (!f) return;
    if (k === 'call') { if (NATIVE && Android.openUrl) Android.openUrl('tel:' + f.tel); else location.href = 'tel:' + f.tel; return; }
    if (!me) { toast('جارٍ تحديد موقعك… حاول بعد لحظات'); if (typeof startLocation === 'function') startLocation(); return; }
    const where = await simpleWhere();
    const text = (where ? where.replace(/^أنت في/, 'أنا في').replace(/^أنت هنا/, 'أنا هنا') + '\n' : '') + 'موقعي الآن: https://maps.google.com/?q=' + me.lat.toFixed(6) + ',' + me.lng.toFixed(6);
    if (NATIVE && Android.smsTo) Android.smsTo(f.tel, text); else location.href = 'sms:' + f.tel + '?&body=' + encodeURIComponent(text);
    return;
  }
  if (k === 'off') { if (await uiConfirm('الخروج من الوضع المبسّط والعودة إلى كل أزرار البرنامج؟', { ok: 'خروج' })) simpleSet(false); }
}
function simpleSet(on) {
  simpleOn = on; store.set('simple', on);
  document.body.classList.toggle('simple', on);
  simpleBar();
  if (on && typeof homeMini === 'function') { homeMini(false); homeExpand(false); }
  if (typeof placeFabs === 'function') setTimeout(placeFabs, 60);
  const m = $('openSimple'); if (m) m.innerHTML = simpleLab();
  if (on) toast('👴 الوضع المبسّط: أزرار كبيرة. للخروج: الزر الأخير أسفلها', 4000);
}
const simpleLab = () => '<span style="font-size:19px;width:22px;text-align:center">👴</span>' + (simpleOn ? 'الخروج من الوضع المبسّط' : 'الوضع المبسّط (أزرار كبيرة قليلة)');
{
  const s = $('openSettings');
  if (s) {
    const b = document.createElement('button'); b.id = 'openSimple'; b.innerHTML = simpleLab();
    b.onclick = () => { $('menuDrop').classList.add('hidden'); simpleSet(!simpleOn); };
    s.parentNode.insertBefore(b, s);
  }
  // «⋯» on the family button: change the person
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('#simpleBar [data-s="call"],#simpleBar [data-s="send"]')) { e.preventDefault(); simpleFamAsk(); } });
}
if (simpleOn) { document.body.classList.add('simple'); simpleBar(); }
