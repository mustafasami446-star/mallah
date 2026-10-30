'use strict';
/* الملاح — وضع المصمم: توليد رموز التفعيل من هاتف المصمم أو لابتوبه.
   Opened by tapping the version number in «عن البرنامج» 7 times; the secret key is pasted once and kept
   only on that device. The same code runs in the standalone page (mallah-admin.html). */

const LICA = {
  key: null,
  log: (() => { try { return JSON.parse(localStorage.getItem('licAdminLog') || '[]'); } catch (e) { return []; } })()
};
async function licaKey() {
  if (LICA.key) return LICA.key;
  const k = localStorage.getItem('licAdminKey');
  if (!k) return null;
  LICA.key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(k), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return LICA.key;
}
async function licaSetKey(txt) {
  const k = String(txt || '').replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(k), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    // it must match the public key inside the app
    const test = new TextEncoder().encode('mallah-key-check');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, test);
    const pub = await crypto.subtle.importKey('spki', Uint8Array.from(atob(LICA_PUB), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, test))) return false;
    localStorage.setItem('licAdminKey', k); LICA.key = key; return true;
  } catch (e) { return false; }
}
function licaCleanDev(txt) {
  const m = String(txt || '').toUpperCase().match(/[A-Z2-9]{4}-?[A-Z2-9]{4}-?[A-Z2-9]{4}/);
  return m ? m[0].replace(/-/g, '').match(/.{4}/g).join('-') : null;
}
async function licaMake(dev, kind, exp) {
  const key = await licaKey(); if (!key) throw new Error('no key');
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode('mallah-license|v1|' + dev + '|' + kind + '|' + exp)));
  return 'M1-' + kind + exp + '-' + btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function licaBuyerText(dev, code) {
  return 'شكرًا لك 🌟 هذا رمز تفعيل «الملاح» لجهازك (' + dev + '):\n\n' + code + '\n\nافتح الملاح ← الصق الرمز في شاشة التفعيل ← «🔓 تفعيل».\n(في الإعدادات ← «🔑 التفعيل» إن لم تظهر الشاشة)';
}
function licaRender(root) {
  root.innerHTML = `<div class="card"><h3>🔑 توليد رمز تفعيل</h3><div class="frm">
      <label>رقم جهاز المشتري (يصلك منه عبر واتساب)</label><input type="text" id="laDev" dir="ltr" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters">
      <label>اسم المشتري (للسجل)</label><input type="text" id="laName" placeholder="مثال: أحمد — حقل الحلفاية">
      <label>رقم واتساب المشتري (اختياري، لإرسال الرمز له مباشرة)</label><input type="text" id="laTel" dir="ltr" inputmode="tel" placeholder="07XXXXXXXXX"></div>
    <div class="btnRow"><button class="chip go" id="laMake">🔑 توليد الرمز</button></div>
    <div id="laOut"></div></div>
    <div class="card"><h3>السجل (${LICA.log.length})</h3><div id="laLog"></div></div>
    <div class="card"><div class="btnRow"><button class="chip" id="laExport">📤 تصدير السجل</button><button class="chip del" id="laForget">🗑 حذف المفتاح من هذا الجهاز</button></div>
    <div class="s" style="padding:6px 14px 12px;color:var(--muted);line-height:1.7">المفتاح السري محفوظ على هذا الجهاز فقط. لا ترسله لأحد: من يملكه يستطيع تفعيل أي جهاز.</div></div>`;
  const q = (id) => root.querySelector('#' + id);
  const drawLog = () => {
    const h = root.querySelector('#laLog').parentNode.querySelector('h3'); if (h) h.textContent = 'السجل (' + LICA.log.length + ')';
    q('laLog').innerHTML = LICA.log.slice().reverse().map((r) => `<div class="res"><div style="flex:1;min-width:0"><div class="t">${escA(r.name || '—')}</div><div class="s" dir="ltr" style="text-align:right">${r.dev} · ${new Date(r.t).toLocaleDateString('ar-IQ')}</div></div><button class="chip" data-copy="${r.dev}">نسخ الرمز</button></div>`).join('') || '<div class="item"><div class="grow s">لا يوجد بعد</div></div>';
    q('laLog').querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { const r = LICA.log.find((x) => x.dev === b.dataset.copy); if (r) copyA(licaBuyerText(r.dev, r.code)); }; });
  };
  drawLog();
  q('laMake').onclick = async () => {
    const dev = licaCleanDev(q('laDev').value);
    if (!dev) { msgA('رقم الجهاز غير صحيح — 12 حرفًا ورقمًا مثل AB3D-EF4H-JK5M'); return; }
    let code; try { code = await licaMake(dev, 'F', '0'); } catch (e) { msgA('المفتاح السري غير موجود على هذا الجهاز'); return; }
    const name = q('laName').value.trim(), tel = q('laTel').value.replace(/[^\d]/g, '');
    LICA.log = LICA.log.filter((r) => r.dev !== dev).concat([{ dev, name, code, t: Date.now() }]);
    localStorage.setItem('licAdminLog', JSON.stringify(LICA.log));
    const text = licaBuyerText(dev, code);
    q('laOut').innerHTML = `<div class="laCode" dir="ltr">${code}</div><div class="btnRow"><button class="chip go" id="laCopy">📋 نسخ الرسالة</button>${tel ? '<button class="chip go" id="laWa">💬 إرسال عبر واتساب</button>' : ''}</div>`;
    q('laCopy').onclick = () => copyA(text);
    if (q('laWa')) q('laWa').onclick = () => openA('https://wa.me/' + (tel.startsWith('0') ? '964' + tel.slice(1) : tel) + '?text=' + encodeURIComponent(text));
    drawLog();
  };
  q('laExport').onclick = () => copyA(LICA.log.map((r) => [new Date(r.t).toISOString().slice(0, 10), r.dev, r.name, r.code].join('\t')).join('\n'));
  q('laForget').onclick = () => { if (confirmA('حذف المفتاح السري من هذا الجهاز؟ (احتفظ بنسخة منه أولًا)')) { localStorage.removeItem('licAdminKey'); LICA.key = null; msgA('حُذف المفتاح من هذا الجهاز'); } };
}
