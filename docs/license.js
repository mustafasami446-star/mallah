'use strict';
/* الملاح — التفعيل: تجربة كاملة 14 يومًا لكل جهاز، ثم يُقفل البرنامج حتى يُدخَل رمز تفعيل خاص بالجهاز.
   The activation code is an ECDSA P-256 signature over the device number, made with the designer's
   secret key (never in the app). The app holds only the public key and checks the code offline.
   The trial start is anchored on the server (Firebase) per device, so reinstalling does not renew it. */

const LIC = {
  pub: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfpTCYai240LgmSawDwbVupHvpQZyLnYvcKLt430FN/iiD4wAqh+izAtoW/ioqAWTDxkXw/p2gLlf8/Fr/w9ZEg==',
  trialDays: 14, price: '15,000', wa: '9647861666400',
  dev: null, lic: null, start: null, state: 'trial', daysLeft: 14
};
const LIC_B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const licTe = new TextEncoder();
async function licSha(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', licTe.encode(s))); }
const licHex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/* ---------------- the device number ---------------- */
function webDevSeed() {
  let s = null;
  try { s = localStorage.getItem('mallahDev'); } catch (e) {}
  if (!s) { const m = document.cookie.match(/(?:^|; )mallahDev=([0-9a-f]{32})/); if (m) s = m[1]; }
  if (!s) { s = licHex(crypto.getRandomValues(new Uint8Array(16))); }
  try { localStorage.setItem('mallahDev', s); } catch (e) {}
  try { document.cookie = 'mallahDev=' + s + '; max-age=315360000; path=/; SameSite=Lax'; } catch (e) {}
  return 'web:' + s;
}
async function deviceNumber() {
  let seed = null;
  if (NATIVE && Android.deviceId) { try { const a = Android.deviceId(); if (a) seed = 'and:' + a; } catch (e) {} }
  if (!seed) seed = webDevSeed();
  const h = await licSha('mallah-device|' + seed);
  let s = ''; for (let i = 0; i < 12; i++) s += LIC_B32[h[i] % 32];
  return s.match(/.{4}/g).join('-');
}

/* ---------------- checking a code ---------------- */
// code: "M1-<kind><exp>-<signature base64url>"   kind F = full · exp 0 = never, or YYYYMMDD
function licParse(txt) {
  const m = String(txt || '').replace(/\s+/g, '').match(/M1-([A-Z])(\d{1,8})-([A-Za-z0-9_-]{60,120})/);
  return m ? { kind: m[1], exp: m[2], sig: m[3], code: m[0] } : null;
}
const licMsg = (dev, kind, exp) => 'mallah-license|v1|' + dev + '|' + kind + '|' + exp;
async function licVerify(code, dev) {
  const p = licParse(code); if (!p) return null;
  try {
    const key = await crypto.subtle.importKey('spki', unb64u(LIC.pub.replace(/\+/g, '-').replace(/\//g, '_')), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(p.sig), licTe.encode(licMsg(dev, p.kind, p.exp)));
    if (!ok) return null;
    if (p.exp !== '0') { const e = p.exp; const end = new Date(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8), 23, 59); if (Date.now() > end) return Object.assign(p, { expired: true }); }
    return p;
  } catch (e) { return null; }
}

/* ---------------- the trial ---------------- */
async function trialAnchor(devHash) {
  // the first start of this device, kept on the server (reinstalling or clearing data does not renew the trial)
  try {
    if (typeof fbReq !== 'function' || navigator.onLine === false) return null;
    const r = await fbReq('GET', '/trials/' + devHash);
    if (r && r.t) return r.t;
    await fbReq('PUT', '/trials/' + devHash, { t: { '.sv': 'timestamp' } });
    const r2 = await fbReq('GET', '/trials/' + devHash);
    return r2 && r2.t ? r2.t : null;
  } catch (e) { return null; }
}
function trialUpdate() {
  const now = Math.max(Date.now(), store.get('licSeen', 0));          // the clock moved back? it does not help
  store.set('licSeen', now);
  const used = (now - LIC.start) / 86400000;
  LIC.daysLeft = Math.max(0, Math.ceil(LIC.trialDays - used));
  LIC.state = LIC.lic ? 'active' : LIC.daysLeft > 0 ? 'trial' : 'locked';
}
async function licInit() {
  LIC.dev = await deviceNumber();
  const saved = store.get('licCode', null);
  if (saved) { const v = await licVerify(saved, LIC.dev); LIC.lic = v && !v.expired ? v : null; }
  LIC.start = store.get('licStart', null) || Date.now();
  store.set('licStart', LIC.start);
  trialUpdate(); licApply(); LIC.ready = true;
  if (!LIC.lic) {
    const t = await trialAnchor(licHex(await licSha('mallah-trial|' + LIC.dev)).slice(0, 24));
    if (t && t < LIC.start) { LIC.start = t; store.set('licStart', t); trialUpdate(); licApply(); }
  }
}
setInterval(() => { if (LIC.dev && !LIC.lic) { trialUpdate(); licApply(); } }, 60000);

/* ---------------- what the user sees ---------------- */
function licApply() {
  document.body.classList.toggle('locked', LIC.state === 'locked');
  if (LIC.state === 'locked') {
    showLock();
    try { if (NATIVE && Android.teamStop) Android.teamStop(); } catch (e) {}      // nothing keeps running behind the lock
    try { if (navState) endNav(false, true); } catch (e) {}
  } else { const l = $('lockScr'); if (l) l.remove(); }
  // the last days of the trial: a small reminder
  let b = $('trialBar');
  if (LIC.state === 'trial' && LIC.daysLeft <= 3) {
    if (!b) { b = document.createElement('button'); b.id = 'trialBar'; b.onclick = () => showLock(true); document.body.appendChild(b); }
    b.textContent = '⏳ ' + (LIC.daysLeft === 1 ? 'آخر يوم' : LIC.daysLeft === 2 ? 'متبقٍ يومان' : 'متبقٍ ' + LIC.daysLeft + ' أيام') + ' من الفترة التجريبية — فعّل الملاح';
  } else if (b) b.remove();
  const s = $('licStatus');
  if (s) s.textContent = LIC.state === 'active' ? '✓ مفعّل على هذا الجهاز' : LIC.state === 'trial' ? 'فترة تجريبية — متبقٍ ' + LIC.daysLeft + ' يومًا' : 'انتهت الفترة التجريبية';
}
function waText() {
  return 'السلام عليكم، أريد تفعيل برنامج الملاح.\nرقم جهازي: ' + LIC.dev + '\n(أرفقت صورة إيصال الدفع ' + LIC.price + ' دينار)';
}
function showLock(closable) {
  let el = $('lockScr');
  if (el) { el.dataset.closable = closable && LIC.state !== 'locked' ? '1' : ''; return; }
  el = document.createElement('div'); el.id = 'lockScr';
  el.dataset.closable = closable && LIC.state !== 'locked' ? '1' : '';
  const locked = LIC.state === 'locked';
  el.innerHTML = `<div class="lkIn">
    <div class="lkHead"><img src="logo.svg" alt=""><div><b>الملاح</b><small>${locked ? 'انتهت الفترة التجريبية (14 يومًا)' : LIC.state === 'active' ? 'مفعّل على هذا الجهاز ✓' : 'الفترة التجريبية — متبقٍ ' + LIC.daysLeft + ' يومًا'}</small></div>${locked ? '' : '<button class="lkX" id="lkX">✕</button>'}</div>
    ${LIC.state === 'active' ? '<p class="lkLead">البرنامج مفعّل على هذا الجهاز. شكرًا لدعمك 🌟</p>' : `
    <p class="lkLead">${locked ? 'لمتابعة استخدام الملاح فعّله على هذا الجهاز — مرة واحدة فقط وبدون اشتراك.' : 'يمكنك تفعيل الملاح الآن على هذا الجهاز — مرة واحدة فقط وبدون اشتراك.'}</p>
    <div class="lkPrice">${LIC.price} <small>دينار عراقي</small></div>
    <div class="lkDev"><small>رقم جهازك</small><b dir="ltr">${LIC.dev}</b><button class="chip" id="lkCopy">📋 نسخ</button></div>
    <ol class="lkSteps">
      <li>ادفع <b>${LIC.price} دينار</b> بمسح الرمز من تطبيق <b>سوبر كي (SuperQi)</b>:<img class="lkQi" src="pay-qi.jpg" alt="رمز الدفع"><button class="chip lkWa" id="lkSaveQi">💾 حفظ رمز الدفع في الصور (لمسحه من سوبر كي)</button></li>
      <li>أرسل <b>صورة الإيصال</b> و<b>رقم جهازك</b> للمصمم عبر واتساب:<button class="chip go lkWa" id="lkWa">💬 إرسال عبر واتساب</button></li>
      <li>يصلك <b>رمز التفعيل</b> — الصقه هنا:</li>
    </ol>
    <textarea id="lkCode" dir="ltr" rows="3" placeholder="M1-…"></textarea>
    <button class="lkGo" id="lkGo">🔓 تفعيل</button>
    <p class="lkNote">الرمز خاص بهذا الجهاز ولا يعمل على غيره. إذا غيّرت هاتفك أو مسحت بيانات المتصفح تواصل مع المصمم.</p>`}
    <div class="lkSig">من تصميم <b>الأستاذ مصطفى سامي</b><span dir="ltr">+964 786 166 6400 · +964 775 596 2400</span></div></div>`;
  document.body.appendChild(el);
  if ($('lkX')) $('lkX').onclick = () => el.remove();
  if (LIC.state === 'active') return;
  $('lkCopy').onclick = () => { try { navigator.clipboard.writeText(LIC.dev); toast('✓ نُسخ رقم الجهاز'); } catch (e) { prompt('رقم جهازك:', LIC.dev); } };
  $('lkWa').onclick = () => openExt('https://wa.me/' + LIC.wa + '?text=' + encodeURIComponent(waText()));
  $('lkGo').onclick = licActivate;
  // paying from this same phone: keep the payment code as a picture, then «scan from gallery» in SuperQi
  $('lkSaveQi').onclick = async () => {
    try {
      const blob = await (await fetch('pay-qi.jpg')).blob();
      if (NATIVE && Android.shareImage) { const d = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(blob); }); Android.shareImage(d, 'mallah-pay-qi.jpg', 'رمز الدفع — الملاح ' + LIC.price + ' دينار'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mallah-pay-qi.jpg'; a.click(); toast('✓ حُفظت الصورة في التنزيلات');
    } catch (e) { toast('تعذّر الحفظ'); }
  };
}
async function licActivate() {
  const txt = $('lkCode').value;
  if (!licParse(txt)) { toast('الصق رمز التفعيل كاملًا كما وصلك (يبدأ بـ M1-)', 4000); return; }
  const v = await licVerify(txt, LIC.dev);
  if (!v) { toast('رمز التفعيل غير صحيح لهذا الجهاز — تأكد أنك أرسلت رقم الجهاز الظاهر هنا', 5000); return; }
  if (v.expired) { toast('انتهت صلاحية هذا الرمز', 4000); return; }
  store.set('licCode', v.code); LIC.lic = v; trialUpdate();
  const l = $('lockScr'); if (l) l.remove();
  licApply();
  actionSheet('🎉 تم تفعيل الملاح على هذا الجهاز. شكرًا لك!', []);
}
window.licHandleBack = () => { const ap = $('adminPanel'); if (ap && !ap.classList.contains('hidden') && !$('lockScr')) { ap.classList.add('hidden'); return true; } const l = $('lockScr'); if (!l) return false; if (LIC.state !== 'locked') l.remove(); return true; };
// activation links: …?act=M1-… or mallah://activate?c=M1-…
{
  const q = new URLSearchParams(location.search);
  if (q.get('act')) { store.set('licPending', q.get('act')); history.replaceState(null, '', location.pathname); }
  const _hl = window.handleLink;
  window.handleLink = function (url) { const p = licParse(decodeURIComponent(String(url || ''))); if (p) { store.set('licPending', p.code); showLock(true); setTimeout(() => { if ($('lkCode')) $('lkCode').value = p.code; }, 50); return; } return _hl(url); };
}
{ const b = $('openLic'); if (b) b.onclick = () => { document.querySelectorAll('.panel:not(.hidden)').forEach((p) => p.classList.add('hidden')); showLock(true); const pend = store.get('licPending', null); if (pend && $('lkCode')) $('lkCode').value = pend; }; }
licInit().then(() => { const pend = store.get('licPending', null); if (pend && LIC.state !== 'active') { showLock(true); if ($('lkCode')) $('lkCode').value = pend; } });

/* ---------------- designer mode (generating codes) ---------------- */
const LICA_PUB = LIC.pub;
const escA = esc, msgA = (m) => toast(m, 4000), openA = (u) => openExt(u), confirmA = (m) => window.confirm(m);
function copyA(t) { try { navigator.clipboard.writeText(t).then(() => toast('✓ نُسخ'), () => prompt('انسخ:', t)); } catch (e) { prompt('انسخ:', t); } }
function adminShow() { const b = $('openAdmin'); if (b) b.classList.toggle('hidden', !localStorage.getItem('licAdminKey')); }
function openAdmin() {
  document.querySelectorAll('.panel:not(.hidden)').forEach((p) => p.classList.add('hidden'));
  $('adminPanel').classList.remove('hidden');
  licaRender($('adminBody'));
}
let adminTaps = 0, adminTapT = 0;
document.addEventListener('click', (e) => {
  if (!e.target.closest('.cApp, .lkHead img')) return;
  if (Date.now() - adminTapT > 1500) adminTaps = 0;
  adminTapT = Date.now();
  if (++adminTaps < 7) return;
  adminTaps = 0;
  const go = async () => {
    if ($('lockScr') && $('lkCode')) { $('lkCode').value = await licaMake(LIC.dev, 'F', '0'); toast('رمز هذا الجهاز جاهز — اضغط «تفعيل»'); return; }   // the designer's own phone
    openAdmin();
  };
  if (localStorage.getItem('licAdminKey')) { go(); return; }
  const k = prompt('وضع المصمم — الصق المفتاح السري:');
  if (!k) return;
  licaSetKey(k).then((ok) => { if (ok) { toast('✓ حُفظ المفتاح على هذا الجهاز'); adminShow(); go(); } else toast('المفتاح غير صحيح'); });
});
{ const b = $('openAdmin'); if (b) b.onclick = openAdmin; adminShow(); }
{ const c = $('adminClose'); if (c) c.onclick = () => $('adminPanel').classList.add('hidden'); }
