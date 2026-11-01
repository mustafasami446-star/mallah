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
  /* sealed for the designer: only the secret key in «الملاح — الإدارة» can open a report (ECDH + AES-GCM) */
  async function seal(obj) {
    const pub = await crypto.subtle.importKey('spki', Uint8Array.from(atob(LIC.pub), (c) => c.charCodeAt(0)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
    const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
    const b = (u) => { let s = ''; u.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
    return { e: b(all), k: b(raw) };
  }
  async function flush() {
    try { const n = typeof Android !== 'undefined' && Android.takeCrash && Android.takeCrash(); if (n) { const l = n.split('\n'); add(l[1] || l[0], n, 'native'); } } catch (e) {}
    if (!qd.length || typeof fbReq !== 'function' || typeof LIC === 'undefined' || !navigator.onLine) return;
    let dev = ''; try { dev = typeof Android !== 'undefined' && Android.deviceModel ? Android.deviceModel() : ''; } catch (e) {}
    if (!dev) { const ua = navigator.userAgent; dev = /iPhone|iPad/.test(ua) ? 'iOS web' : /Android/.test(ua) ? 'Android web' : /Windows/.test(ua) ? 'Windows web' : /Mac/.test(ua) ? 'Mac web' : 'web'; }
    const v = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?';
    while (qd.length) {
      const r = qd[0];
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try {
        const box = await seal({ m: r.m, s: r.s, k: r.k, ui: r.ui, v, d: dev.slice(0, 80), at: r.at });
        await fbReq('PUT', '/crash/' + id, { e: box.e, k: box.k, v, t: { '.sv': 'timestamp' } });
      } catch (e) { break; }
      qd.shift(); save();
    }
  }
  window.mallahCrashFlush = flush;
  setTimeout(flush, 15000);
  setInterval(flush, 10 * 60e3);
})();
