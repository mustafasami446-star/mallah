'use strict';
/* الملاح — مساحة أكبر للخريطة:
   1) الأزرار القليلة الاستعمال (الكاميرا، الفريق، البلاغ) تجتمع خلف زر «المزيد»، ويبقى «موقعي» ظاهرًا
   2) الطقس صار داخل زر الطبقات (وبطاقة الطقس في القائمة السفلية)
   3) لمسة على الخريطة تُخفي الأزرار والقائمة السفلية، ولمسة أخرى تعيدها؛ وأثناء سحب الخريطة تخفت الأزرار */

/* ---------------- 1) «المزيد» ---------------- */
const fabMore = (() => {
  const fabs = $('fabs'), more = document.createElement('button');
  more.id = 'moreBtn'; more.className = 'fab hidden'; more.setAttribute('aria-label', 'المزيد'); more.title = 'المزيد';
  const ICON_MORE = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="7" r="2.2"/><circle cx="7" cy="17" r="2.2"/><circle cx="17" cy="17" r="2.2"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  fabs.insertBefore(more, $('locBtn'));
  let open = false, shown = '';
  const B = document.body, kids = () => ['arBtn', 'teamBtn', 'rptBtn'].map((id) => $(id)).filter(Boolean);
  // a button is there to show at all (each one keeps deciding that itself, with .hidden)
  const avail = (b) => !b.classList.contains('hidden') && !(b.id === 'rptBtn' && B.classList.contains('car') && !B.classList.contains('ui-nav'));
  // while navigating, the report button stays out on the map: it is the one needed on the road
  const direct = (b) => b.id === 'rptBtn' && B.classList.contains('ui-nav');
  function set(el, cls, on) { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); }
  function sync() {
    // always behind «المزيد», even one alone: the camera button appears a moment after start (once the
    // sensors answer), and a lone report button turning into «المزيد» looked like a jump
    const g = kids().filter((b) => avail(b) && !direct(b)), grouped = g.length > 0;
    if (!grouped && open) open = false;
    kids().forEach((b) => set(b, 'fgHide', grouped && !open && g.includes(b)));
    set(more, 'hidden', !grouped); set(more, 'on', open); set(fabs, 'open', open);
    // a dot on «المزيد» when the team is on (blue when a message waits), so it is not forgotten behind it
    const t = $('teamBtn'), em = t && t.querySelector('em');
    const dot = grouped && !open && t && g.includes(t) && t.classList.contains('on') ? (em && em.classList.contains('msg') && !em.classList.contains('hidden') ? 'msg' : 'on') : '';
    const want = (open ? 'x' : 'm') + dot;
    if (want !== shown) { shown = want; more.innerHTML = (open ? ICON_X : ICON_MORE) + (dot ? `<i class="${dot === 'msg' ? 'msg' : ''}"></i>` : ''); }
    if (typeof placeFabs === 'function') placeFabs();
  }
  function setOpen(on) { if (open !== on) { open = on; sync(); } }
  more.onclick = (e) => { e.stopPropagation(); setOpen(!open); };
  // choosing one of them folds the group again
  fabs.addEventListener('click', (e) => { const b = e.target.closest('.fab'); if (b && open && kids().includes(b)) setTimeout(() => setOpen(false), 0); });
  const mo = new MutationObserver(sync);
  kids().forEach((b) => mo.observe(b, { attributes: true, attributeFilter: ['class'], subtree: true }));
  new MutationObserver(sync).observe(B, { attributes: true, attributeFilter: ['class'] });
  sync();
  return { isOpen: () => open, close: () => setOpen(false), sync };
})();

/* ---------------- 2) the weather in the layers menu ---------------- */
{
  const _render = renderLayerMenu;
  renderLayerMenu = function () {
    _render();
    const m = $('layerMenu'), on = typeof WX !== 'undefined' && WX.on;
    const b = document.createElement('button');
    b.className = 'wxItem' + (on ? ' sel' : '');
    b.textContent = on ? '🌦 إخفاء الطقس' : '🌦 الطقس والمطر';
    b.onclick = (e) => { e.stopPropagation(); m.classList.add('hidden'); if (typeof WX !== 'undefined' && WX.on) closeWeather(); else openWeather(); };
    m.prepend(b);
  };
  // the menu says «إخفاء» while the weather is open
  $('layersBtn').addEventListener('click', () => renderLayerMenu(), true);
  renderLayerMenu();
}

/* ---------------- 3) a tap on the map: the map alone ---------------- */
let calmOn = false, calmBusy = false;
function calmSet(on) {
  if (calmOn === on) return;
  calmOn = on; document.body.classList.toggle('calm', on);
  if (on && !store.get('calmHint', false)) { store.set('calmHint', true); toast('المس الخريطة مرة أخرى لإظهار الأزرار', 3500); }
  if (!on && typeof placeFabs === 'function') placeFabs();
}
// is something else using this tap? (it closes a menu, folds the sheet, picks a place…) — read before those handlers run
map.on('preclick', () => {
  const B = document.body, home = $('searchWrap');
  calmBusy = fabMore.isOpen() || !$('layerMenu').classList.contains('hidden') || !$('menuDrop').classList.contains('hidden')
    || home.classList.contains('expanded') || home.classList.contains('nearOn') || !resEl.classList.contains('hidden')
    || B.classList.contains('ui-dest') || B.classList.contains('ui-meas') || B.classList.contains('ui-wx')
    || (typeof directState !== 'undefined' && !!directState) || document.activeElement === qEl;
  if (fabMore.isOpen()) fabMore.close();
});
map.on('click', () => { if (!calmBusy) calmSet(!calmOn); calmBusy = false; });
// anything that opens on the map brings the buttons back
{
  let navWas = document.body.classList.contains('ui-nav');
  new MutationObserver(() => {
    const B = document.body, nav = B.classList.contains('ui-nav');
    if (calmOn && (nav !== navWas || B.classList.contains('ui-dest') || B.classList.contains('ui-meas') || B.classList.contains('ui-wx'))) calmSet(false);
    navWas = nav;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  ['menuBtn', 'q'].forEach((id) => { const el = $(id); if (el) el.addEventListener('focus', () => calmSet(false)); });
}
// the back button shows them again before doing anything else
{
  const _back = window.handleBack;
  window.handleBack = function () { if (calmOn) { calmSet(false); return true; } return _back(); };
}
// while the map is dragged, the buttons fade back so the map under them shows
{
  let t = 0;
  map.on('dragstart', () => { clearTimeout(t); document.body.classList.add('mapMove'); });
  map.on('dragend', () => { clearTimeout(t); t = setTimeout(() => document.body.classList.remove('mapMove'), 900); });
}
