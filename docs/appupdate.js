'use strict';
/* الملاح — التحديث من داخل البرنامج: تنزيل الإصدار الجديد مع شريط تقدّم، ثم نافذة أندرويد «تحديث التطبيق».
   Older app builds (no native updater) and the web fall back to the download link. */
let updState = null;            // {app, done, total}
let updInstallWanted = false;

function startAppUpdate(app) {
  if (!NATIVE || !Android.appUpdDownload) { openExt(app.url); return; }
  if (navigator.onLine === false) { toast('لا يوجد اتصال بالإنترنت'); return; }
  updState = { app, done: 0, total: app.size || 0 };
  updBar();
  Android.appUpdDownload(app.url, app.size || 0, app.sha256 || '');
}
function updBar() {
  let el = $('updBar');
  if (!updState) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'updBar';
    el.innerHTML = '<div class="ub1"><span id="updTxt"></span><button id="updX" aria-label="إلغاء">✕</button></div><div class="bar"><i id="updPct"></i></div>';
    document.body.appendChild(el);
    $('updX').onclick = () => { try { Android.appUpdCancel(); } catch (e) {} updState = null; updBar(); };
  }
  const t = updState.total, p = t ? Math.min(100, Math.round(updState.done / t * 100)) : 0;
  $('updTxt').textContent = updState.ready ? '✓ تم تنزيل التحديث ' + updState.app.versionName : '⬇ جارٍ تنزيل التحديث ' + updState.app.versionName + '… ' + p + '%' + (t ? ' (' + fmtMB(updState.done) + ' من ' + fmtMB(t) + ')' : '');
  $('updPct').style.width = (updState.ready ? 100 : p) + '%';
}
window.onAppUpdProgress = (done, total) => { if (!updState) return; updState.done = done; if (total) updState.total = total; updBar(); };
window.onAppUpdReady = (ok, msg) => {
  if (!updState) return;
  if (!ok) {
    const app = updState.app; updState = null; updBar();
    if (msg === 'cancelled') return;
    actionSheet('⚠️ لم يكتمل تنزيل التحديث' + (msg === 'damaged' || msg === 'size' ? ' (وصل الملف ناقصًا أو تالفًا)' : ' — تحقق من الإنترنت'), [
      { label: '🔄 حاول مرة أخرى', fn: () => startAppUpdate(app) },
      { label: '🌐 التنزيل من المتصفح', fn: () => openExt(app.url) }
    ]);
    return;
  }
  updState.ready = true; updBar();
  installNow();
};
function installNow() {
  if (!updState) return;
  if (!Android.appUpdCanInstall()) {
    updInstallWanted = true;
    actionSheet('خطوة أخيرة (مرة واحدة فقط): اسمح للملاح بتثبيت التحديثات. ستفتح الإعدادات — فعّل «السماح من هذا المصدر» ثم ارجع إلى الملاح.', [
      { label: '⚙️ فتح الإعدادات', fn: () => Android.appUpdInstallSettings() },
      { label: '🌐 التحديث من المتصفح بدلًا من ذلك', fn: () => { updInstallWanted = false; openExt(updState.app.url); } }
    ]);
    return;
  }
  updInstallWanted = false;
  Android.appUpdInstall();               // Android shows «هل تريد تحديث هذا التطبيق؟»
}
// back from the settings screen: carry on by itself
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !updInstallWanted || !updState) return;
  setTimeout(() => { if (Android.appUpdCanInstall()) { closeModal(); installNow(); } }, 400);
});
window.onAppUpdInstall = (ok, msg) => {
  if (ok) { toast('✓ تم التحديث', 2000); return; }
  if (!updState) return;
  actionSheet('لم يكتمل التحديث' + (/status 3\b/.test(msg) ? ' (أُلغي)' : ''), [
    { label: '🔄 تثبيت التحديث الآن', fn: installNow },
    { label: '🌐 التحديث من المتصفح', fn: () => openExt(updState.app.url) },
    { label: 'لاحقًا', fn: () => { updState = null; updBar(); } }
  ]);
};
