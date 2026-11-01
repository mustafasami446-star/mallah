'use strict';
/* الملاح — تقارير الأعطال: إذا حدث خطأ في البرنامج عند أي مستخدم يُرسل وصفه التقني تلقائيًا إلى قاعدة البيانات
   (بدون موقع أو اسم أو أي بيانات شخصية) ليُصلح قبل أن يشتكي أحد. Loaded first, so it also catches errors
   while the other files load; reports wait in a small queue until the app can send them. */
(function () {
  const Q = 'crashQ', MAX_DAY = 10;
  const noise = /^(Script error\.?|ResizeObserver loop|Failed to fetch|Load failed|NetworkError|The operation was aborted|AbortError|.*network error|.*Fetch is aborted)/i;
  let qd; try { qd = JSON.parse(localStorage.getItem(Q) || '[]'); } catch (e) { qd = []; }
  const save = () => { try { localStorage.setItem(Q, JSON.stringify(qd.slice(-20))); } catch (e) {} };
  function add(msg, stack, kind) {
    msg = String(msg || '').slice(0, 480);
    if (!msg || noise.test(msg)) return;
    const day = new Date().toISOString().slice(0, 10), sig = msg.slice(0, 120) + '|' + String(stack || '').split('\n')[1];
    let sent; try { sent = JSON.parse(localStorage.getItem('crashSent') || '{}'); } catch (e) { sent = {}; }
    if (sent.d !== day) sent = { d: day, n: 0, s: [] };
    if (sent.s.includes(sig) || sent.n >= MAX_DAY || qd.some((r) => r.sig === sig)) return;
    sent.n++; sent.s.push(sig); try { localStorage.setItem('crashSent', JSON.stringify(sent)); } catch (e) {}
    qd.push({ sig, m: msg, s: String(stack || '').slice(0, 1800), k: kind, at: Date.now(), ui: (document.body && document.body.className || '').slice(0, 120) });
    save();
    if (!add.soon) add.soon = setTimeout(() => { add.soon = null; flush(); }, 20000);
  }
  window.addEventListener('error', (e) => {
    if (!e || (!e.message && !e.error)) return;
    add(e.message || String(e.error), (e.error && e.error.stack) || (e.filename ? e.filename.split('/').pop() + ':' + e.lineno + ':' + e.colno : ''), 'js');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason; add(r && r.message ? r.message : String(r), r && r.stack, 'promise');
  });
  window.mallahCrash = (msg, stack) => add(msg, stack, 'manual');
  async function flush() {
    try { const n = typeof Android !== 'undefined' && Android.takeCrash && Android.takeCrash(); if (n) { const l = n.split('\n'); add(l[1] || l[0], n, 'native'); } } catch (e) {}
    if (!qd.length || typeof fbReq !== 'function' || !navigator.onLine) return;
    let dev = ''; try { dev = typeof Android !== 'undefined' && Android.deviceModel ? Android.deviceModel() : ''; } catch (e) {}
    if (!dev) { const ua = navigator.userAgent; dev = /iPhone|iPad/.test(ua) ? 'iOS web' : /Android/.test(ua) ? 'Android web' : /Windows/.test(ua) ? 'Windows web' : /Mac/.test(ua) ? 'Mac web' : 'web'; }
    const v = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?';
    while (qd.length) {
      const r = qd[0];
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try {
        await fbReq('PUT', '/crash/' + id, { m: r.m, s: r.s, k: r.k, ui: r.ui, v, d: dev.slice(0, 80), at: r.at, t: { '.sv': 'timestamp' } });
      } catch (e) { break; }
      qd.shift(); save();
    }
  }
  window.mallahCrashFlush = flush;
  setTimeout(flush, 15000);
  setInterval(flush, 10 * 60e3);
})();
