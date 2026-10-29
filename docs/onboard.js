'use strict';
/* الملاح — شاشات الترحيب عند أول تشغيل: تعريف، إذن الموقع، خريطة المحافظة، ثم الانطلاق */
(function () {
  if (!window.ONB_FIRST) return;
  const IS_WEB = !NATIVE;
  let i = 0, locState = 'idle', dlStarted = false;
  const N = 5;

  const el = document.createElement('div');
  el.id = 'onb';
  el.innerHTML = `
  <div class="onbView"><button class="onbSkip" id="onbSkip">تخطٍّ</button>
  <div class="onbTrack" id="onbTrack">
    <section class="onbSlide s0">
      <img class="onbLogo" src="logo.svg" alt="">
      <h1>الملاح</h1>
      <p class="lead">ملاحتك بالعربي — في المدينة وفي الحقل، حتى بدون إنترنت.</p>
      <p class="onbCredit">من تصميم الأستاذ مصطفى سامي</p>
    </section>
    <section class="onbSlide">
      <h2>كل ما تحتاجه في الطريق</h2>
      <div class="feats">
        <div class="feat"><span class="fi" style="--c:#0ea5e9">🔊</span><div><b>إرشاد صوتي عربي</b><small>«بعد 200 متر، انعطف يمينًا» — خطوة بخطوة</small></div></div>
        <div class="feat"><span class="fi" style="--c:#22c55e">🗺</span><div><b>خرائط بدون إنترنت</b><small>نزّل خريطة محافظتك مرة واحدة، وتعمل في أي مكان</small></div></div>
        <div class="feat"><span class="fi" style="--c:#f59e0b">🧭</span><div><b>مواقع العمل والبوصلة</b><small>الآبار والمحطات والمواقع، حتى حيث لا توجد طرق</small></div></div>
        <div class="feat"><span class="fi" style="--c:#a855f7">📐</span><div><b>القياس والمسارات</b><small>مساحات الأراضي بالدونم، وتسجيل المسار والعودة عليه</small></div></div>
      </div>
    </section>
    <section class="onbSlide">
      <div class="onbArt"><div class="pulse"></div><div class="pin">📍</div></div>
      <h2>اسمح بتحديد موقعك</h2>
      <p>يحتاج الملاح موقعك ليرشدك في الطريق ويعرض ما حولك. لا يشارك التطبيق موقعك مع أحد إلا حين تختار أنت «مشاركة موقعي».</p>
      <div class="onbStatus" id="onbLoc"></div>
    </section>
    <section class="onbSlide">
      <div id="onbMapArt" class="onbMapArt"></div>
      <h2>خريطة محافظتك بدون إنترنت</h2>
      <div id="onbMap"></div>
    </section>
    <section class="onbSlide">
      <img class="onbLogo sm" src="logo.svg" alt="">
      <h2>جاهز للانطلاق!</h2>
      <div class="tips">
        <div>🔍 اكتب في «إلى أين؟» أو اضغط مطولًا على الخريطة لاختيار وجهة</div>
        <div>⌂ احفظ البيت والعمل لتصل إليهما بلمسة واحدة</div>
        <div>☰ دليل الاستخدام الكامل في القائمة، في أي وقت</div>
      </div>
    </section>
  </div></div>
  <div class="onbFoot">
    <div class="dots" id="onbDots">${'<i></i>'.repeat(N)}</div>
    <div class="onbBtns" id="onbBtns"></div>
  </div>`;
  document.body.appendChild(el);
  document.body.classList.add('onb-on');

  const btns = $('onbBtns');
  function setBtns(list) {
    btns.innerHTML = '';
    list.forEach(([label, cls, fn]) => {
      const b = document.createElement('button');
      b.className = 'onbBtn ' + (cls || ''); b.innerHTML = label; b.onclick = fn;
      btns.appendChild(b);
    });
  }
  function go(n) {
    i = Math.max(0, Math.min(N - 1, n));
    $('onbTrack').style.transform = 'translateX(' + (i * 100) + '%)';
    $('onbDots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
    $('onbSkip').classList.toggle('hidden', i === N - 1);
    render();
  }
  const next = () => go(i + 1);

  /* ---- slide 3: location ---- */
  function askLocation() {
    locState = 'asking';
    try { startLocation(); } catch (e) {}
    try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(() => {}); } catch (e) {}
    render();
  }
  function locHtml() {
    if (me) {
      const p = typeof provinceAt === 'function' ? provinceAt(me.lat, me.lng) : null;
      return '<span class="ok">✓ تم تحديد موقعك' + (p ? ' — ' + esc(provName(p)) : '') + '</span>';
    }
    if (locState === 'denied') return '<span class="warnTxt">لم يُمنح الإذن. يمكنك السماح لاحقًا من إعدادات الهاتف، أو بزر تحديد الموقع ⌖.</span>';
    if (locState === 'disabled') return '<span class="warnTxt">خدمة الموقع (GPS) متوقفة في الهاتف. شغّلها ثم عد إلى هنا.</span>';
    if (locState === 'asking') return '<span class="muted">جارٍ تحديد موقعك…</span>';
    return '';
  }
  const _status = window.onGpsStatus;
  window.onGpsStatus = function (s) {
    if (document.body.classList.contains('onb-on') && (s === 'denied' || s === 'disabled' || s === 'error')) { locState = s === 'error' ? 'denied' : s; render(); }
    return _status.apply(this, arguments);
  };
  let advanced = false;
  const _loc = window.onNativeLocation;
  window.onNativeLocation = function () {
    const r = _loc.apply(this, arguments);
    if (document.body.classList.contains('onb-on')) {
      if (i === 2) { render(); if (!advanced) { advanced = true; setTimeout(() => { if (i === 2) next(); }, 1100); } }
      else if (i === 3) render();
    }
    return r;
  };

  /* ---- slide 4: the province map ---- */
  function miniMap(sel) {
    if (typeof projector !== 'function' || !PROVS.length) return '';
    const P = projector();
    let paths = '';
    PROVS.forEach((f) => {
      const g = f.geometry, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      const d = polys.map((poly) => poly.map((ring) => 'M' + ring.map((c) => P.p(c[0], c[1]).join(',')).join('L') + 'Z').join('')).join('');
      const id = f.properties.id, cls = hasPack(id) || hasPack(FULL_ID) ? 'inst' : id === sel ? 'sel' : '';
      paths += `<path class="mp ${cls}" d="${d}"/>`;
    });
    let dot = '';
    if (me) { const [x, y] = P.p(me.lng, me.lat); dot = `<circle class="pvMe" cx="${x}" cy="${y}" r="14"/>`; }
    return `<svg viewBox="-8 -8 ${SVG_W + 16} ${P.h + 16}" xmlns="http://www.w3.org/2000/svg">${paths}${dot}</svg>`;
  }
  function mapHtml() {
    if (!PK) return '<p>متصفحك لا يدعم حفظ الخرائط. يمكنك استخدام الخرائط مع الإنترنت كالمعتاد.</p>';
    if (packs().length) return '<p class="ok">✓ خرائطك جاهزة: ' + packs().map((p) => esc(provName(p.id))).join('، ') + '</p>';
    if (packBusyState) return `<p>${packBusyState.label}</p><div class="bar packBar"><i style="width:${packBusyState.pct || 0}%"></i></div><p class="muted packInfo">${packBusyState.info || ''}</p><p class="muted">يمكنك المتابعة — سنخبرك عند اكتمال التنزيل.</p>`;
    const sug = suggestedProvOnb();
    if (sug && remoteMap && remotePack(sug)) return `<p>أنت في <b>${esc(provName(sug))}</b>. نزّل خريطتها (${fmtMB(remotePack(sug).size)}) لتعمل الملاحة والبحث بدون إنترنت.</p><p class="muted">يُفضّل التنزيل عبر Wi-Fi.</p>`;
    if (navigator.onLine === false) return '<p>لا يوجد اتصال بالإنترنت الآن. يمكنك تنزيل خريطة محافظتك لاحقًا من القائمة ☰ ← «الخرائط بدون إنترنت».</p>';
    if (!remoteMap) return '<p class="muted">جارٍ جلب قائمة الخرائط…</p>';
    return '<p>اختر محافظتك من خريطة العراق ونزّل خريطتها (بين 7 و 23 م.ب)، لتعمل الملاحة والبحث بدون إنترنت.</p>';
  }
  function suggestedProvOnb() { return me && typeof provinceAt === 'function' ? provinceAt(me.lat, me.lng) : null; }

  function render() {
    if (!document.body.contains(el)) return;
    if (i === 2) $('onbLoc').innerHTML = locHtml();
    if (i === 3) { $('onbMapArt').innerHTML = miniMap(suggestedProvOnb()); $('onbMap').innerHTML = mapHtml(); }
    // buttons
    if (i === 0) setBtns([['ابدأ التعريف', 'primary', next]]);
    else if (i === 1) setBtns([['التالي', 'primary', next]]);
    else if (i === 2) {
      if (me) setBtns([['التالي', 'primary', next]]);
      else if (locState === 'idle') setBtns([['📍 السماح بالموقع', 'primary', askLocation], ['لاحقًا', 'ghost', next]]);
      else setBtns([['التالي', 'primary', next]]);
    } else if (i === 3) {
      const sug = suggestedProvOnb(), r = sug && remotePack(sug);
      if (!PK || packs().length || packBusyState || dlStarted || navigator.onLine === false) setBtns([['التالي', 'primary', next]]);
      else if (r) setBtns([['⬇ نزّل خريطة ' + esc(provName(sug)), 'primary', () => {
        if (IS_WEB) { finish(); queuePacks([sug]); return; }        // the web may need the two-step download sheet
        dlStarted = true; queuePacks([sug]); setTimeout(render, 200);
      }], ['اختر محافظة أخرى', 'ghost', () => { finish(); openPicker(sug); }], ['لاحقًا', 'ghost', next]]);
      else setBtns([['🗺 اختر محافظتك', 'primary', () => { finish(); openPicker(); }], ['لاحقًا', 'ghost', next]]);
    } else setBtns([['ابدأ', 'primary', finish]]);
  }
  // keep the map slide live while the list of maps arrives or a download runs
  const _rp = window.renderPacks || renderPacks;
  renderPacks = function () { _rp(); if (i === 3) render(); };

  function finish() {
    store.set('onbDone', true);
    document.body.classList.remove('onb-on');
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
    if (navigator.onLine !== false) setTimeout(() => toast('ابحث عن مكان أو اضغط مطولًا على الخريطة لاختيار وجهة', 4500), 400);
  }
  window.onbHandleBack = function () {
    if (!document.body.contains(el) || el.classList.contains('out')) return false;
    if (i > 0) { go(i - 1); return true; }
    return false;
  };

  $('onbSkip').onclick = finish;
  // swipe between slides (right-to-left: a swipe to the right shows the next one)
  let sx = null, sy = 0;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 0 && i < N - 1 && !(i === 2 && !me && locState === 'idle')) next();
    else if (dx < 0) go(i - 1);
  }, { passive: true });

  // fetch the list of maps in the background so the map slide can make a concrete offer
  if (PK && navigator.onLine !== false) setTimeout(() => { try { checkUpdates(true, true); } catch (e) {} }, 300);
  go(0);
})();
