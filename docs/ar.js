'use strict';
/* الملاح — الملاحة بالكاميرا (الواقع المعزز): ترى الطريق أمامك وعليه سهم الاتجاه والمسافة.
   Phase 1: the direction arrow, the distance and the target marker over the live camera picture. */
(function () {
  const HFOV = 50, VFOV = 66;          // field of view of a phone's back camera held upright (degrees)
  let ar = null;                       // {stream, raf, head, pitch, flat, headT, lastSpeak}
  const norm = (d) => ((d % 360) + 540) % 360 - 180;

  /* where to point: the next turn while navigating, the target in compass mode, or the chosen destination */
  function arTarget() {
    if (typeof navState !== 'undefined' && navState && navState.r) {
      const r = navState.r, k = navState.stepIdx, next = r.steps[k + 1];
      if (next && next.maneuver && Array.isArray(next.maneuver.location) && next.maneuver.type !== 'arrive')
        return { lat: next.maneuver.location[1], lng: next.maneuver.location[0], text: next._text, kind: 'turn' };
      if (dest) return { lat: dest.lat, lng: dest.lng, text: dest.name, kind: 'dest' };
    }
    if (typeof directState !== 'undefined' && directState && directState.t)
      return { lat: directState.t.lat, lng: directState.t.lng, text: directState.t.name || 'الهدف', kind: 'dest' };
    if (dest) return { lat: dest.lat, lng: dest.lng, text: dest.name, kind: 'dest' };
    return null;
  }

  /* the compass direction the back camera looks at, from the phone's full orientation
     (works when the phone is held upright in front of you, not only lying flat) */
  function camOrientation(e) {
    if (e.webkitCompassHeading != null) {                 // iPhone
      return { h: e.webkitCompassHeading, pitch: (e.beta || 90) - 90, flat: Math.abs(e.beta || 0) < 35 };
    }
    if (!(e.absolute || e.type === 'deviceorientationabsolute') || e.alpha == null) return null;
    const r = Math.PI / 180, a = e.alpha * r, b = (e.beta || 0) * r, g = (e.gamma || 0) * r;
    const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    const vx = -(cA * sG + cG * sA * sB), vy = -(sA * sG - cA * cG * sB), vz = -cB * cG;   // the back camera's direction
    const horiz = Math.hypot(vx, vy);
    return { h: (Math.atan2(vx, vy) / r + 360) % 360, pitch: Math.atan2(vz, horiz) / r, flat: horiz < 0.45 };
  }
  function onOrient(e) {
    if (!ar) return;
    const o = camOrientation(e); if (!o) return;
    if (ar.head == null) ar.head = o.h; else ar.head = (ar.head + norm(o.h - ar.head) * 0.2 + 360) % 360;   // smoothing
    ar.pitch = ar.pitch == null ? o.pitch : ar.pitch + (o.pitch - ar.pitch) * 0.2;
    ar.flat = o.flat; ar.headT = Date.now();
  }

  function el(id) { return document.getElementById(id); }
  function build() {
    const v = document.createElement('div');
    v.id = 'arView';
    v.innerHTML = `<video id="arVideo" autoplay playsinline muted></video>
      <div class="arTop"><div class="arIc" id="arIc"></div><div class="arTx"><div class="ad" id="arDist">—</div><div class="at" id="arText"></div></div>
        <button class="arX" id="arClose" aria-label="إغلاق الكاميرا">✕</button></div>
      <div class="arMark hidden" id="arMark"><div class="pin">📍</div><div class="lb" id="arMarkLb"></div></div>
      <div class="arEdge hidden" id="arEdge"></div>
      <div class="arGround"><svg id="arArrow" viewBox="0 0 200 200"><defs><linearGradient id="arG" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#0ea5e9" stop-opacity=".35"/><stop offset="1" stop-color="#7dd3fc"/></linearGradient></defs>
        <path d="M100 8 L168 92 L126 92 L126 190 L74 190 L74 92 L32 92 Z" fill="url(#arG)" stroke="#e0f2fe" stroke-width="5" stroke-linejoin="round"/></svg></div>
      <div class="arHint" id="arHint"></div>
      <div class="arSafe hidden" id="arSafe"><div>⚠️<b>الكاميرا للمشي فقط</b><span>لا تستخدمها أثناء القيادة. تابع بالخريطة والصوت.</span><button class="chip" id="arSafeX">العودة إلى الخريطة</button></div></div>`;
    document.body.appendChild(v);
    el('arClose').onclick = closeAR;
    el('arSafeX').onclick = closeAR;
    return v;
  }

  function frame() {
    if (!ar) return;
    ar.raf = requestAnimationFrame(frame);
    const t = arTarget();
    const hint = el('arHint'), arrow = el('arArrow'), mark = el('arMark'), edge = el('arEdge');
    // safety: moving at driving speed
    const fast = me && me.speed != null && me.speed > 5.5;
    el('arSafe').classList.toggle('hidden', !fast);
    if (!t || !me) {
      el('arDist').textContent = '—'; el('arText').textContent = !me ? 'بانتظار تحديد موقعك…' : 'اختر وجهة أولًا';
      hint.textContent = ''; mark.classList.add('hidden'); edge.classList.add('hidden'); arrow.style.opacity = .25; return;
    }
    const b = bearing([me.lat, me.lng], [t.lat, t.lng]), d = hav([me.lat, me.lng], [t.lat, t.lng]);
    el('arDist').textContent = fmtDist(d);
    el('arText').textContent = t.kind === 'turn' ? t.text : (d < 15 ? 'وصلت إلى ' + (t.text || 'الوجهة') : (t.text || 'الوجهة'));
    el('arIc').textContent = t.kind === 'turn' ? '↱' : '🎯';
    const fresh = ar.head != null && Date.now() - ar.headT < 2000;
    if (!fresh) {
      hint.textContent = 'بانتظار البوصلة… حرّك الهاتف على شكل الرقم 8 لمعايرتها';
      arrow.style.opacity = .25; mark.classList.add('hidden'); edge.classList.add('hidden'); return;
    }
    if (ar.flat) {
      hint.textContent = 'ارفع الهاتف أمامك كأنك تصوّر الطريق';
      arrow.style.opacity = .25; mark.classList.add('hidden'); edge.classList.add('hidden'); return;
    }
    hint.textContent = (me.acc || 0) > 25 ? 'دقة الموقع ضعيفة الآن (±' + Math.round(me.acc) + ' م)' : '';
    const rel = norm(b - ar.head);
    arrow.style.opacity = 1;
    arrow.style.transform = 'rotateX(58deg) rotateZ(' + rel.toFixed(1) + 'deg)';
    if (Math.abs(rel) < HFOV / 2) {
      const x = 50 + rel / (HFOV / 2) * 50, y = 50 + (ar.pitch || 0) / VFOV * 100;   // looking down raises the horizon
      mark.style.left = x + '%'; mark.style.top = Math.max(18, Math.min(70, y)) + '%';
      el('arMarkLb').textContent = fmtDist(d);
      mark.classList.remove('hidden'); edge.classList.add('hidden');
    } else {
      mark.classList.add('hidden');
      edge.innerHTML = rel > 0 ? '<span>استدر يمينًا</span><b>→</b>' : '<b>←</b><span>استدر يسارًا</span>';
      edge.className = 'arEdge ' + (rel > 0 ? 'r' : 'l');
    }
  }

  async function openAR() {
    if (ar) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('الكاميرا غير مدعومة على هذا الجهاز', 4000); return; }
    // iPhone asks for the compass separately, and only from a tap
    try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch (e) {}
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      toast(e && e.name === 'NotAllowedError' ? 'لم يُسمح باستخدام الكاميرا — اسمح بها من إعدادات الهاتف' : 'تعذّر تشغيل الكاميرا', 4500);
      return;
    }
    const v = el('arView') || build();
    v.classList.remove('hidden');
    ar = { stream, raf: 0, head: null, pitch: null, flat: false, headT: 0 };
    const video = el('arVideo'); video.srcObject = stream; try { await video.play(); } catch (e) {}
    if (!store.get('arSeen', false)) { store.set('arSeen', true); toast('امسك الهاتف أمامك: السهم يشير إلى طريقك، والعلامة 📍 فوق الهدف', 5000); }
    frame();
  }
  function closeAR() {
    if (!ar) return;
    cancelAnimationFrame(ar.raf);
    try { ar.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    const v = el('arView'); if (v) { el('arVideo').srcObject = null; v.classList.add('hidden'); }
    ar = null;
  }
  window.openAR = openAR; window.closeAR = closeAR;
  window.arHandleBack = function () { if (ar) { closeAR(); return true; } return false; };
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', (e) => { if (e.absolute || e.webkitCompassHeading != null) onOrient(e); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeAR(); });

  /* the camera button shows whenever there is somewhere to point at */
  const btn = el('arBtn');
  if (btn) {
    btn.onclick = openAR;
    setInterval(() => btn.classList.toggle('hidden', !arTarget() || !!ar), 800);
  }
})();
