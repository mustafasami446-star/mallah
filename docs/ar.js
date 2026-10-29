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

  /* ---------- phase 2: work sites, favourites and places shown over the camera picture ---------- */
  const GROUPS = [
    { id: 'sites', n: 'مواقع العمل', i: '🛢', r: 8000 },
    { id: 'favs', n: 'المفضلة', i: '⭐', r: 20000 },
    { id: 'places', n: 'الأماكن', i: '📍', r: 2500 }
  ];
  let arOn = store.get('arGroups', { sites: true, favs: true, places: true });
  let pois = [], poisAt = null, poisT = 0, poiSel = null;
  function collectPois() {
    if (!me) return [];
    const ref = [me.lat, me.lng], out = [];
    const add = (g, name, lat, lng, icon, sub) => {
      const d = hav(ref, [lat, lng]); if (d > g.r || d < 3) return;
      out.push({ g: g.id, n: name, lat, lng, d, icon, sub: sub || '' });
    };
    if (arOn.sites && typeof allSites === 'function') try { allSites().forEach((x) => add(GROUPS[0], x.n, x.lat, x.lng, '🛢', x.set)); } catch (e) {}
    if (arOn.favs && typeof favs !== 'undefined') favs.forEach((f) => add(GROUPS[1], f.name, f.lat, f.lng, f.kind === 'home' ? '⌂' : f.kind === 'work' ? '▣' : '⭐'));
    if (arOn.places && typeof places !== 'undefined' && places) {
      const dLat = GROUPS[2].r / 111000, dLng = dLat / Math.cos(me.lat * Math.PI / 180);
      for (const p of places) {
        if (Math.abs(p.lat - me.lat) > dLat || Math.abs(p.lng - me.lng) > dLng) continue;
        add(GROUPS[2], p.n, p.lat, p.lng, (typeof PLACE_ICON !== 'undefined' && PLACE_ICON[p.k]) || '📍', p.a);
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 60);
  }
  function refreshPois(force) {
    if (!me) return;
    if (!force && poisAt && Date.now() - poisT < 2500 && hav(poisAt, [me.lat, me.lng]) < 15) return;
    pois = collectPois(); poisAt = [me.lat, me.lng]; poisT = Date.now();
  }
  function renderChips() {
    const box = el('arChips'); if (!box) return;
    box.innerHTML = GROUPS.map((g) => `<button class="arChip${arOn[g.id] ? ' on' : ''}" data-g="${g.id}">${g.i} ${g.n}</button>`).join('');
    box.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => { arOn[b.dataset.g] = !arOn[b.dataset.g]; store.set('arGroups', arOn); renderChips(); refreshPois(true); }; });
  }
  const poiEls = [];
  function poiEl(i) {
    if (!poiEls[i]) {
      const d = document.createElement('button'); d.className = 'arPoi';
      d.onclick = () => { const p = d._p; if (!p) return; choosePoi(p); };
      el('arPois').appendChild(d); poiEls[i] = d;
    }
    return poiEls[i];
  }
  function choosePoi(p) {
    poiSel = p.n + '|' + p.lat + '|' + p.lng;
    const navigating = (typeof navState !== 'undefined' && navState) || (typeof directState !== 'undefined' && directState);
    if (navigating) { toast(p.n + ' — ' + fmtDist(hav([me.lat, me.lng], [p.lat, p.lng])), 3000); return; }
    setDestination(p.lat, p.lng, p.n, p.sub || '', false);          // the big arrow now points to it
    toast('🎯 ' + p.n, 2500);
  }
  function drawPois(horizonY) {
    refreshPois(false);
    const W = innerWidth, H = innerHeight, placed = [];
    let n = 0;
    for (const p of pois) {
      if (n >= 9) break;
      const rel = norm(bearing([me.lat, me.lng], [p.lat, p.lng]) - ar.head);
      if (Math.abs(rel) > HFOV / 2 - 2) continue;
      const x = W * (0.5 + rel / HFOV);
      // nearer places sit lower, farther ones closer to the horizon
      const k = Math.max(0, Math.min(1, Math.log(p.d / 20) / Math.log(8000 / 20)));
      let y = H * (horizonY / 100) + (1 - k) * H * 0.22 - 10;
      const w = 150, h = 44;
      for (let t = 0; t < 4 && placed.some((q) => Math.abs(q.x - x) < w * 0.9 && Math.abs(q.y - y) < h); t++) y -= h + 4;
      if (placed.some((q) => Math.abs(q.x - x) < w * 0.9 && Math.abs(q.y - y) < h) || y < 110) continue;
      placed.push({ x, y });
      const e = poiEl(n++); e._p = p;
      const key = p.n + '|' + p.lat + '|' + p.lng;
      e.className = 'arPoi' + (key === poiSel ? ' sel' : '') + ' g-' + p.g;
      e.innerHTML = `<span class="pi">${p.icon}</span><span class="pt"><b>${esc(p.n)}</b><small>${fmtDist(p.d)}</small></span>`;
      e.style.transform = 'translate(' + Math.round(x - 75) + 'px,' + Math.round(y - 22) + 'px)';
      e.style.display = '';
    }
    for (let i = n; i < poiEls.length; i++) poiEls[i].style.display = 'none';
  }
  function hidePois() { poiEls.forEach((e) => { e.style.display = 'none'; }); }
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
      <div id="arPois"></div>
      <div class="arChips" id="arChips"></div>
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
      el('arDist').textContent = '—'; el('arIc').textContent = '👁'; el('arText').textContent = !me ? 'بانتظار تحديد موقعك…' : 'اضغط على أي مكان لتتجه إليه';
      mark.classList.add('hidden'); edge.classList.add('hidden'); arrow.style.opacity = 0;
      if (me && ar.head != null && Date.now() - ar.headT < 2000 && !ar.flat) { hint.textContent = ''; drawPois(50 + (ar.pitch || 0) / VFOV * 100); } else hidePois();
      return;
    }
    const b = bearing([me.lat, me.lng], [t.lat, t.lng]), d = hav([me.lat, me.lng], [t.lat, t.lng]);
    el('arDist').textContent = fmtDist(d);
    el('arText').textContent = t.kind === 'turn' ? t.text : (d < 15 ? 'وصلت إلى ' + (t.text || 'الوجهة') : (t.text || 'الوجهة'));
    el('arIc').textContent = t.kind === 'turn' ? '↱' : '🎯';
    const fresh = ar.head != null && Date.now() - ar.headT < 2000;
    if (!fresh) {
      hint.textContent = 'بانتظار البوصلة… حرّك الهاتف على شكل الرقم 8 لمعايرتها';
      arrow.style.opacity = .25; hidePois(); mark.classList.add('hidden'); edge.classList.add('hidden'); return;
    }
    if (ar.flat) {
      hint.textContent = 'ارفع الهاتف أمامك كأنك تصوّر الطريق';
      arrow.style.opacity = .25; hidePois(); mark.classList.add('hidden'); edge.classList.add('hidden'); return;
    }
    hint.textContent = (me.acc || 0) > 25 ? 'دقة الموقع ضعيفة الآن (±' + Math.round(me.acc) + ' م)' : '';
    drawPois(50 + (ar.pitch || 0) / VFOV * 100);
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
    renderChips(); refreshPois(true);
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
    setInterval(() => btn.classList.toggle('hidden', !!ar || !me || (!arTarget() && !(typeof places !== 'undefined' && places) && !(typeof allSites === 'function' && allSites().length) && !(typeof favs !== 'undefined' && favs.length))), 1000);
  }
})();
