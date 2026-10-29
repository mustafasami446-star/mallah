'use strict';
/* الملاح — تكييف نسخة الويب (لابتوب و iPhone): تثبيت كتطبيق، الشاشة مضاءة، البوصلة والصوت في iPhone، الروابط */
(function () {
  if (NATIVE) return;

  /* install as an app + work offline (the app's own files are kept by a service worker) */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller)
            actionSheet('🆕 يتوفر إصدار جديد من الملاح', [{ label: '🔄 تحديث الآن', fn: () => { navigator.serviceWorker.addEventListener('controllerchange', () => location.reload()); w.postMessage('skip'); } }]);
        });
      });
    }).catch(() => {});
  }

  /* keep the screen on while navigating, recording or walking a boundary */
  let lock = null;
  async function wantLock() {
    const want = !!(navState || (typeof directState !== 'undefined' && directState) || (typeof rec !== 'undefined' && rec) ||
      (window.measActive && typeof M !== 'undefined' && M.walkRec)) && document.visibilityState === 'visible';
    try {
      if (want && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      else if (!want && lock) { await lock.release(); lock = null; }
    } catch (e) { lock = null; }
  }
  setInterval(wantLock, 3000);
  document.addEventListener('visibilitychange', wantLock);

  /* iPhone: the compass and the voice need a first tap before they are allowed */
  let compassAsked = false, voiceUnlocked = false;
  document.addEventListener('click', () => {
    if (!voiceUnlocked && window.speechSynthesis) { voiceUnlocked = true; try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} }
  }, true);
  function askCompass() {
    if (compassAsked) return; compassAsked = true;
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function')
        DeviceOrientationEvent.requestPermission().catch(() => {});
    } catch (e) {}
  }
  ['startBtn', 'directBtn', 'mHere', 'locBtn'].forEach((id) => { const el = $(id); if (el) el.addEventListener('click', askCompass, true); });

  /* prefer an Arabic voice when the browser has one */
  if (window.speechSynthesis) {
    let arVoice = null;
    const pick = () => { const v = speechSynthesis.getVoices(); arVoice = v.find((x) => /^ar/i.test(x.lang)) || null; };
    pick(); speechSynthesis.onvoiceschanged = pick;
    window.say = function (text) {
      if (muted || !text) return;
      try { const u = new SpeechSynthesisUtterance(text); u.lang = 'ar'; if (arVoice) u.voice = arVoice; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
    };
  }

  /* links: …/mallah/?lat=30.5&lng=47.8&name=… or ?site=WQ1-55 open that place */
  const q = new URLSearchParams(location.search);
  if (q.get('lat') || q.get('site') || q.get('geo')) {
    const link = q.get('geo') ? q.get('geo') : 'mallah://nav?' + q.toString();
    setTimeout(() => { if (window.handleLink) handleLink(link); history.replaceState(null, '', location.pathname); }, 900);
  }

  /* features that only exist in the Android app */
  const cities = $('citiesList'); if (cities && cities.parentElement) cities.parentElement.classList.add('hidden');
  const dv = $('dlView'); if (dv) dv.classList.add('hidden');
  document.querySelectorAll('#mapsPanel .note').forEach((n) => { n.innerHTML = 'في نسخة الويب: نزّل خريطة محافظتك أو العراق كاملًا من الأعلى لتعمل الخريطة والبحث بدون إنترنت.'; });
  const gpsBtn = $('gpsBtn'); if (gpsBtn) gpsBtn.classList.add('hidden');
  document.body.classList.add('web');
})();
