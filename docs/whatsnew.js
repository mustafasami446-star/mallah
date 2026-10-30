'use strict';
/* الملاح — «ما الجديد»: بعد كل تحديث تظهر مرة واحدة لوحات مصوّرة تعرّف المستخدم بالجديد.
   To announce a new version: add an entry at the top of WHATS_NEW (version + slides). Users who skipped
   several versions see the slides of all of them (newest first, at most MAX_SLIDES). */

/* ---------------- illustrations: a small dark street map, then what each slide shows ---------------- */
const WN_BASE = `<rect width="320" height="320" fill="#1a2744"/>
<g fill="#22325a">${(() => { let s = ''; for (let y = 14; y < 320; y += 30) for (let x = 12; x < 320; x += 34) s += `<rect x="${x}" y="${y}" width="22" height="16" rx="4"/>`; return s; })()}</g>
<rect x="250" y="0" width="70" height="320" fill="#13203b"/>
<g stroke="#34466e" stroke-linecap="round" fill="none">
  <path d="M-10 230 L330 196" stroke-width="16"/><path d="M-10 92 L330 64" stroke-width="12"/>
  <path d="M70 -10 L76 330" stroke-width="11"/><path d="M178 -10 L168 330" stroke-width="13"/>
  <path d="M-10 20 L120 150 L250 300" stroke-width="7"/>
</g>
<rect x="96" y="112" width="44" height="62" rx="12" fill="#1f4637" opacity=".8"/>
<text x="296" y="190" fill="#6f9ad8" font-size="15" font-weight="600" transform="rotate(90 296 190)" text-anchor="middle">نهر دجلة</text>`;
const wnSvg = (inner) => `<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">${WN_BASE}${inner}</svg>`;
const WN_ART = {
  areas: () => wnSvg(`
    <path d="M30 40 L150 30 L170 120 L120 170 L40 150 Z" fill="#38bdf8" fill-opacity=".14" stroke="#38bdf8" stroke-width="3" stroke-dasharray="10 7"/>
    <path d="M170 120 L240 110 L245 230 L150 250 L120 170 Z" fill="#22c55e" fill-opacity=".10" stroke="#22c55e" stroke-width="2.5"/>
    <path d="M40 150 L120 170 L150 250 L60 280 Z" fill="#f59e0b" fill-opacity=".10" stroke="#f59e0b" stroke-width="2.5"/>
    <g font-weight="700" font-size="16" text-anchor="middle" paint-order="stroke" stroke="#0b1220" stroke-width="5">
      <text x="98" y="98" fill="#e0f2fe">العمارة</text><text x="192" y="190" fill="#dcfce7">الكحلاء</text><text x="95" y="230" fill="#fef3c7">الميمونة</text></g>
    <g transform="translate(150 22)"><rect width="150" height="34" rx="17" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>
      <text x="75" y="22" fill="#e0f2fe" font-size="14" font-weight="700" text-anchor="middle">📍 قضاء العمارة ✕</text></g>`),
  glued: () => wnSvg(`
    <path d="M70 300 L74 222 L170 205 L176 64 L260 56" fill="none" stroke="#0b3a8a" stroke-width="15" stroke-linejoin="round" stroke-linecap="round" opacity=".6"/>
    <path d="M70 300 L74 222 L170 205 L176 64 L260 56" fill="none" stroke="#3b82f6" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
    <g transform="translate(250 56)"><path d="M0 -26C-10 -26 -18 -18 -18 -8 -18 6 0 22 0 22S18 6 18 -8C18 -18 10 -26 0 -26z" transform="translate(0 -18)" fill="#ef4444" stroke="#fff" stroke-width="2"/><circle cy="-26" r="6" fill="#fff"/></g>
    <g transform="translate(120 214) rotate(-80)"><circle r="17" fill="#2563eb" stroke="#fff" stroke-width="3"/><path d="M0 -10l7 17-7-4-7 4z" fill="#fff" transform="rotate(90)"/></g>
    <g transform="translate(232 250)" fill="none" stroke="#e2e8f0" stroke-width="3" stroke-linecap="round" opacity=".9">
      <path d="M-26 0a26 26 0 0 1 44-18"/><path d="M18 -18l2-12M18 -18l-12-1"/>
      <circle cx="-30" cy="22" r="7" fill="#e2e8f0" fill-opacity=".25"/><circle cx="22" cy="28" r="7" fill="#e2e8f0" fill-opacity=".25"/></g>`),
  gps: () => wnSvg(`
    <circle cx="110" cy="200" r="74" fill="#ef4444" fill-opacity=".10" stroke="#ef4444" stroke-opacity=".6" stroke-width="2" stroke-dasharray="6 6"/>
    <circle cx="150" cy="168" r="8" fill="#94a3b8" stroke="#fff" stroke-width="2" opacity=".6"/>
    <path d="M140 158l20 20M160 158l-20 20" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>
    <circle cx="74" cy="226" r="16" fill="#2563eb" fill-opacity=".22"/>
    <circle cx="74" cy="226" r="9" fill="#2563eb" stroke="#fff" stroke-width="3"/>
    <g transform="translate(150 40)"><rect width="150" height="58" rx="14" fill="#0f172a" stroke="#22c55e" stroke-width="1.5"/>
      <text x="75" y="25" fill="#bbf7d0" font-size="15" font-weight="700" text-anchor="middle">🛰 GPS ± 3 م</text>
      <text x="75" y="46" fill="#fca5a5" font-size="12.5" text-anchor="middle">📡 الشبكة ± 450 م ✗</text></g>`),
  under: () => `<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">${WN_BASE}
    <defs><pattern id="wnSat" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#5b5a3a"/><rect x="2" y="3" width="17" height="15" fill="#4c6b35"/><rect x="22" y="20" width="15" height="17" fill="#6b5f3f"/><rect x="21" y="2" width="16" height="12" fill="#3f5e2c"/></pattern>
      <clipPath id="wnClip"><path d="M0 0 H200 L140 320 H0 Z"/></clipPath></defs>
    <g clip-path="url(#wnClip)"><rect width="320" height="320" fill="url(#wnSat)"/>
      <g stroke="#cbbf9a" stroke-linecap="round" fill="none" opacity=".75"><path d="M-10 230 L330 196" stroke-width="9"/><path d="M-10 92 L330 64" stroke-width="7"/><path d="M70 -10 L76 330" stroke-width="7"/></g></g>
    <path d="M200 0 L140 320" stroke="#e2e8f0" stroke-width="3" stroke-dasharray="8 8"/>
    <g font-size="14" font-weight="700" text-anchor="middle" paint-order="stroke" stroke="#0b1220" stroke-width="5">
      <text x="80" y="40" fill="#fef9c3">صور القمر الصناعي</text><text x="250" y="290" fill="#bae6fd">خريطتك المنزّلة</text></g></svg>`,
  team: () => wnSvg(`
    <path d="M70 300 L74 222 L170 205 L176 64" fill="none" stroke="#22c55e" stroke-width="5" stroke-dasharray="2 10" stroke-linecap="round"/>
    ${[[74, 236, '#ef4444', 'م'], [170, 150, '#06b6d4', 'ع'], [210, 210, '#a855f7', 'ح']].map(([x, y, c, t]) => `<g transform="translate(${x} ${y})"><circle r="17" fill="${c}" stroke="#fff" stroke-width="3"/><text y="6" fill="#fff" font-size="16" font-weight="700" text-anchor="middle">${t}</text></g>`).join('')}
    <g transform="translate(176 58)"><text font-size="34" text-anchor="middle">🚩</text></g>
    <g transform="translate(18 26)"><rect width="150" height="34" rx="17" fill="#0f172a" stroke="#22c55e" stroke-width="1.5"/><text x="75" y="22" fill="#bbf7d0" font-size="14" font-weight="700" text-anchor="middle">👥 3 متصلين</text></g>`),
  update: () => wnSvg(`
    <g transform="translate(160 150)">
      <circle r="78" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>
      <path d="M-40 -8a42 42 0 0 1 74-22" fill="none" stroke="#38bdf8" stroke-width="10" stroke-linecap="round"/><path d="M38 -46l-2 26-25-6z" fill="#38bdf8"/>
      <path d="M40 8a42 42 0 0 1-74 22" fill="none" stroke="#22c55e" stroke-width="10" stroke-linecap="round"/><path d="M-38 46l2-26 25 6z" fill="#22c55e"/></g>
    <g transform="translate(95 252)"><rect width="130" height="38" rx="19" fill="#22c55e"/><text x="65" y="25" fill="#04111f" font-size="16" font-weight="800" text-anchor="middle">${APP_VERSION} ✓</text></g>`)
};

/* ---------------- what's new, newest version first ---------------- */
const WHATS_NEW = [
  { v: '5.2', slides: [
    { art: 'team', t: 'الفريق يعمل والشاشة مطفأة', d: 'في أندرويد يستمر الملاح بمشاركة موقعك مع الفريق والبرنامج مغلق، مع إشعار ثابت يمكنك الإيقاف منه. وتصلك إشعارات الرسائل والاستغاثة. وإذا انقطع الإنترنت يُرسَل موقعك برسالة SMS إلى رقم الطوارئ الذي تختاره.', act: ['👥 افتح الفريق', () => { if (typeof openTeam === 'function') openTeam(); }] }
  ] },
  { v: '5.1', slides: [
    { art: 'team', t: 'محادثة الفريق والاستغاثة', d: 'في «الفريق»: محادثة ورسائل سريعة وإرسال موقعك بضغطة، وزر 🆘 يطلب المساعدة بتنبيه قوي لكل الأعضاء، وتنبيهات إذا ابتعد أحدكم أو توقّف أو انقطع اتصاله، وعلامات مشتركة على الخريطة.', act: ['👥 افتح الفريق', () => { if (typeof openTeam === 'function') openTeam(); }] }
  ] },
  { v: '5.0', slides: [
    { art: 'team', t: 'رحلة الفريق', d: 'أنشئ مجموعة لفريقك من ☰ ← «الفريق»: ترون مواقع بعضكم مباشرة على الخريطة، وتذهبون إلى أي زميل أو إلى نقطة تجمّع يحددها أحدكم. كل المواقع مشفّرة.', act: ['👥 افتح الفريق', () => { if (typeof openTeam === 'function') openTeam(); }] }
  ] },
  { v: '4.8', slides: [
    { art: 'update', t: 'التحديث من داخل البرنامج', d: 'من الآن تُنزَّل التحديثات داخل الملاح نفسه مع شريط تقدّم، ثم تضغط «تحديث» فقط — دون متصفح ودون البحث عن الملف. أول مرة يطلب أندرويد السماح للملاح بتثبيت التحديثات.' }
  ] },
  { v: '4.7', slides: [
    { art: 'areas', t: 'استكشف المناطق', d: 'اضغط «◈ المناطق» لتتنقّل بين المحافظات والأقضية والنواحي على خريطة تفاعلية، وتبحث داخل المنطقة التي تختارها فقط.', act: ['◈ جرّبها الآن', () => { if (typeof openAreas === 'function') openAreas(); }] },
    { art: 'glued', t: 'خريطة ثابتة ومتماسكة', d: 'في الخرائط المنزّلة صار المسار وموقعك والوجهة ومواقع العمل جزءًا من الخريطة نفسها: لا تنزاح ولا تتأخر عند التكبير والتدوير بإصبعين.' },
    { art: 'gps', t: 'موقعك بدقة الأقمار الصناعية', d: 'لم يعد الموقع التقريبي من شبكة الهاتف يُبعد نقطتك مئات الأمتار. واضغط زر ⌖ لترى دقة موقعك.' },
    { art: 'under', t: 'لا مساحات رمادية أو ضبابية', d: 'مع إنترنت ضعيف، تظهر شوارع خريطتك المنزّلة واضحة تحت صور القمر الصناعي حتى تصل، وخريطة الشوارع تُعرض من خرائطك مباشرة.' },
    { art: 'update', t: 'التحديثات تصلك بسهولة', d: 'من الإعدادات ← «🔄 البحث عن تحديث للبرنامج» في أي وقت. ونسخة الآيفون واللابتوب تتحدّث الآن وحدها.' }
  ] }
];
const MAX_SLIDES = 9;
const verNum = (v) => String(v || '0').split('.').map((n) => +n || 0).reduce((a, n, i) => a + n / Math.pow(1000, i), 0);

function whatsNewSlides(since) {
  const out = [];
  WHATS_NEW.forEach((e) => { if (verNum(e.v) > verNum(since)) e.slides.forEach((s) => out.push(s)); });
  return out.slice(0, MAX_SLIDES);
}

function showWhatsNew(slides, title) {
  if (!slides.length || $('wn')) return;
  let i = 0;
  const N = slides.length;
  const el = document.createElement('div');
  el.id = 'wn';
  el.innerHTML = `<div class="onbView"><div class="wnHead"><span class="wnBrand"><img src="logo.svg" alt="">الملاح</span><span class="wnVer">${esc(title)}</span><button class="wnSkip" id="wnSkip">تخطٍّ</button></div>
    <div class="onbTrack" id="wnTrack">${slides.map((s) => `<section class="onbSlide wnSlide"><div class="wnArt">${WN_ART[s.art] ? WN_ART[s.art]() : ''}</div><h2>${esc(s.t)}</h2><p>${esc(s.d)}</p></section>`).join('')}</div></div>
    <div class="onbFoot"><div class="dots" id="wnDots">${'<i></i>'.repeat(N)}</div><div class="onbBtns" id="wnBtns"></div></div>`;
  document.body.appendChild(el);
  document.body.classList.add('onb-on');
  const finish = () => {
    store.set('wnSeen', APP_VERSION);
    document.body.classList.remove('onb-on');
    el.classList.add('out'); setTimeout(() => el.remove(), 300);
  };
  const go = (n) => {
    i = Math.max(0, Math.min(N - 1, n));
    $('wnTrack').style.transform = 'translateX(' + (i * 100) + '%)';
    $('wnDots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
    const s = slides[i], b = $('wnBtns'); b.innerHTML = '';
    const add = (label, cls, fn) => { const x = document.createElement('button'); x.className = 'onbBtn ' + cls; x.textContent = label; x.onclick = fn; b.appendChild(x); };
    if (s.act) add(s.act[0], i === N - 1 ? 'primary' : 'ghost', () => { finish(); s.act[1](); });
    add(i === N - 1 ? 'ابدأ' : 'التالي', 'primary', () => (i === N - 1 ? finish() : go(i + 1)));
    $('wnSkip').style.visibility = i === N - 1 ? 'hidden' : '';
  };
  $('wnSkip').onclick = finish;
  let sx = null, sy = 0;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 0 && i < N - 1) go(i + 1); else if (dx < 0) go(i - 1);
  }, { passive: true });
  window.wnHandleBack = () => {
    if (!document.body.contains(el) || el.classList.contains('out')) return false;
    if (i > 0) go(i - 1); else finish();
    return true;
  };
  go(0);
}

/* after an update: once. On a first install the welcome screens already introduce everything. */
(function () {
  if (window.ONB_FIRST) { store.set('wnSeen', APP_VERSION); return; }
  const seen = store.get('wnSeen', null);
  if (seen === APP_VERSION) return;
  const slides = whatsNewSlides(seen || '0');
  if (!slides.length) { store.set('wnSeen', APP_VERSION); return; }
  setTimeout(() => {
    if (navState || (typeof directState !== 'undefined' && directState) || window.measActive) return;   // next start
    showWhatsNew(slides, 'ما الجديد في الإصدار ' + APP_VERSION);
  }, 900);
})();
{ const b = $('openWn'); if (b) b.onclick = () => { document.querySelectorAll('.panel:not(.hidden)').forEach((p) => p.classList.add('hidden')); showWhatsNew(WHATS_NEW[0].slides, 'ما الجديد في الإصدار ' + WHATS_NEW[0].v); }; }
