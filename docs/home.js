'use strict';
/* الملاح — الشاشة الرئيسية: «إلى أين؟»، البيت والعمل والمفضلة، «اكتشف ما حولك» واختصارات */

const homeEl = $('searchWrap');

/* ---------------- sheet: collapsed / expanded ---------------- */
function homeExpand(on) { homeEl.classList.toggle('expanded', on); placeFabs(); }
$('homeGrab').onclick = () => { if (nearOn() && nearHits.length) setNearMode(nearMode === 'list' ? 'map' : 'list'); else homeExpand(!homeEl.classList.contains('expanded')); };
qEl.addEventListener('focus', () => homeExpand(true));
(function swipe() {
  let y0 = null;
  homeEl.addEventListener('touchstart', (e) => { if (homeEl.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  homeEl.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0; y0 = null;
    if (nearOn()) { if (dy < -40 && nearMode === 'map') setNearMode('list'); else if (dy > 50 && homeEl.scrollTop <= 0 && nearMode === 'list' && nearHits.length) setNearMode('map'); return; }
    if (dy < -40) homeExpand(true);
    else if (dy > 50 && homeEl.scrollTop <= 0) { homeExpand(false); qEl.blur(); }
  }, { passive: true });
})();
/* while results are shown, the discover section steps aside */
new MutationObserver(() => homeEl.classList.toggle('searching', !resEl.classList.contains('hidden'))).observe(resEl, { attributes: true, attributeFilter: ['class'] });

/* ---------------- chips: home, work, favorites ---------------- */
function renderChips() {
  const home = favs.find((f) => f.kind === 'home'), work = favs.find((f) => f.kind === 'work');
  $('chipHome').textContent = home ? 'البيت' : 'أضف البيت';
  $('chipWork').textContent = work ? 'العمل' : 'أضف العمل';
}
document.querySelectorAll('#homeChips [data-q]').forEach((el) => {
  el.onclick = () => {
    const f = favs.find((x) => x.kind === el.dataset.q);
    if (f) { closeSearch(); homeExpand(false); goFav(f); }
    else toast('اختر المكان من البحث أو بالضغط المطوّل على الخريطة، ثم «☆ حفظ في المفضلة» ← ' + (el.dataset.q === 'home' ? 'تعيين كالبيت' : 'تعيين كالعمل'), 5000);
  };
});
$('chipFavs').onclick = () => { renderFavs(); $('favPanel').classList.remove('hidden'); };
const _saveFavs = saveFavs;
saveFavs = function () { _saveFavs(); renderChips(); };

/* ---------------- discover around you ---------------- */
const CATS = [
  { id: 'fuel', n: 'وقود', i: '⛽', c: '#1e3a5f', k: ['fuel'], q: 'nwr["amenity"="fuel"]' },
  { id: 'hosp', n: 'مستشفيات', i: '🏥', c: '#4a1d24', k: ['hospital', 'clinic', 'doctors'], q: 'nwr["amenity"~"^(hospital|clinic|doctors)$"]' },
  { id: 'food', n: 'مطاعم', i: '🍽', c: '#4a2a12', k: ['restaurant', 'fast_food', 'cafe'], q: 'nwr["amenity"~"^(restaurant|fast_food|cafe)$"]' },
  { id: 'pharm', n: 'صيدليات', i: '💊', c: '#123d33', k: ['pharmacy'], q: 'nwr["amenity"="pharmacy"]' },
  { id: 'shop', n: 'تسوق', i: '🛒', c: '#33204d', k: ['supermarket', 'mall', 'marketplace', 'convenience', 'department_store'], q: 'nwr["shop"~"^(supermarket|mall|convenience|department_store)$"]' },
  { id: 'bank', n: 'بنوك', i: '🏦', c: '#1d3b1d', k: ['bank', 'atm'], q: 'nwr["amenity"~"^(bank|atm)$"]' },
  { id: 'mosque', n: 'مساجد', i: '🕌', c: '#123a3a', k: ['mosque'], q: 'nwr["amenity"="place_of_worship"]["religion"="muslim"]' },
  { id: 'hotel', n: 'فنادق', i: '🏨', c: '#3a2a1a', k: ['hotel', 'motel', 'guest_house'], q: 'nwr["tourism"~"^(hotel|motel|guest_house)$"]' }
];
$('catGrid').innerHTML = CATS.map((c) => `<button class="cat" data-cat="${c.id}"><span class="ci" style="background:${c.c}">${c.i}</span>${c.n}</button>`).join('');
const nearLayer = L.layerGroup().addTo(map);
let nearHits = [], nearSeq = 0;
function clearNear() { nearLayer.clearLayers(); nearHits = []; }
function nearRef() { return me ? [me.lat, me.lng] : [map.getCenter().lat, map.getCenter().lng]; }
function nearOffline(cat, ref) {
  if (typeof places === 'undefined' || !places) return null;
  const want = new Set(cat.k), out = [];
  for (const p of places) {
    if (!want.has(p.k)) continue;
    const d = hav(ref, [p.lat, p.lng]);
    if (d < 40000) out.push({ n: p.n, sub: [p.a, p.e].filter(Boolean).join(' · '), lat: p.lat, lng: p.lng, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 30);
}
async function nearOnline(cat, ref) {
  for (const r of [6000, 25000]) {
    const ql = `[out:json][timeout:20];${cat.q}(around:${r},${ref[0].toFixed(5)},${ref[1].toFixed(5)});out center 60;`;
    const j = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(ql), 25000);
    const out = (j.elements || []).map((e) => {
      const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
      const t = e.tags || {};
      return { n: t['name:ar'] || t.name || t['name:en'] || cat.n.replace(/ات$|ق$/, ''), sub: t['addr:street'] || t['name:en'] || '', lat, lng, d: hav(ref, [lat, lng]) };
    }).filter((x) => isFinite(x.lat) && isFinite(x.lng));
    if (out.length >= 5 || r === 25000) return out.sort((a, b) => a.d - b.d).slice(0, 30);
  }
  return [];
}
/* results of a category: a list, or the map with a compact bar (switch with «عرض على الخريطة») */
let nearCat = null, nearSrc = '', nearMode = 'list', nearSel = -1;
const nearOn = () => homeEl.classList.contains('nearOn');
function cleanName(s) { const t = String(s || '').replace(/^[\s@;:.,،\-_*#!|~]+/, '').replace(/[\s@;]+$/, '').replace(/\s{2,}/g, ' ').trim(); return t || String(s || ''); }
function nearHeadHtml(cat) {
  const n = nearHits.length;
  return `<div class="nearHead"><div class="nh"><b>${cat.i} ${cat.n} بالقرب منك</b><small>${n ? n + ' نتيجة' : ''}${n && nearSrc === 'offline' ? ' · بدون إنترنت' : ''}</small></div>`
    + (n ? `<button class="nearBtn" id="nearToggle">${nearMode === 'list' ? '🗺 عرض على الخريطة' : '☰ القائمة'}</button>` : '')
    + `<button class="nearX" id="nearClose" aria-label="إغلاق">✕</button></div>`
    + `<div class="nearCats">${CATS.map((c) => `<button class="ncat${c.id === cat.id ? ' on' : ''}" data-ncat="${c.id}"><span>${c.i}</span>${c.n}${c.id === cat.id ? ' <i>✓</i>' : ''}</button>`).join('')}</div>`;
}
function nearRowHtml(h, i, cat) {
  return `<div class="res nres${i === nearSel ? ' on' : ''}" data-near="${i}"><div class="ic" style="background:${cat.c}">${cat.i}</div><div style="flex:1;min-width:0"><div class="t">${esc(h.n)}</div><div class="s">${esc(h.sub || cat.n)}</div></div><div class="s nd">${fmtDist(h.d)}</div></div>`;
}
function renderNear(msg) {
  const cat = CATS.find((c) => c.id === nearCat); if (!cat) return;
  let h = nearHeadHtml(cat);
  if (msg) h += `<div class="res"><div class="s">${msg}</div></div>`;
  else if (nearMode === 'map') {
    const x = nearHits[nearSel];
    h += x ? `<div class="nearSel">${nearRowHtml(x, nearSel, cat)}<button class="chip go" id="nearGo">🧭 اذهب</button></div>`
      : '<div class="nearTip">اضغط على أي علامة في الخريطة لعرضها</div>';
  } else h += '<div class="nearList">' + nearHits.map((x, i) => nearRowHtml(x, i, cat)).join('') + '</div>';
  resEl.innerHTML = h; resEl.classList.remove('hidden');
  homeEl.classList.add('nearOn'); homeEl.classList.toggle('nearMap', nearMode === 'map');
  const t = $('nearToggle'); if (t) t.onclick = () => setNearMode(nearMode === 'list' ? 'map' : 'list');
  $('nearClose').onclick = closeNear;
  resEl.querySelectorAll('[data-ncat]').forEach((b) => { b.onclick = () => { if (b.dataset.ncat !== nearCat) showNearby(b.dataset.ncat, nearMode); }; });
  resEl.querySelectorAll('.nearList [data-near]').forEach((el) => { el.onclick = () => pickNear(+el.dataset.near); });
  const go = $('nearGo'); if (go) go.onclick = () => pickNear(nearSel);
  const sel = resEl.querySelector('.nearSel [data-near]'); if (sel) sel.onclick = () => pickNear(nearSel);
  placeFabs();
}
function drawNearMarkers() {
  const cat = CATS.find((c) => c.id === nearCat); if (!cat) return;
  nearLayer.clearLayers();
  nearHits.forEach((h, i) => L.marker([h.lat, h.lng], {
    icon: L.divIcon({ className: '', html: `<div class="nearPin${i === nearSel ? ' on' : ''}" style="--c:${cat.c}">${cat.i}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
    zIndexOffset: i === nearSel ? 900 : 0
  }).on('click', () => selectNear(i)).addTo(nearLayer));
}
function fitNear() {
  if (!nearHits.length) return;
  requestAnimationFrame(() => {
    const pts = nearHits.slice(0, nearMode === 'map' ? 15 : 6).map((h) => [h.lat, h.lng]);
    if (me) pts.push([me.lat, me.lng]);
    const wide = innerWidth >= 760, bottom = wide ? 40 : homeEl.offsetHeight + 24;
    setFollow(false);
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [wide ? 40 : 30, 90], paddingBottomRight: [wide ? 470 : 30, bottom], maxZoom: 16 });
  });
}
function setNearMode(m) {
  nearMode = m;
  homeExpand(m === 'list');
  renderNear(); drawNearMarkers();
  if (m === 'map') fitNear();
}
function selectNear(i) {
  nearSel = i;
  if (nearMode !== 'map') { nearMode = 'map'; homeExpand(false); }
  renderNear(); drawNearMarkers();
  const h = nearHits[i];
  if (h) requestAnimationFrame(() => {
    const y = innerWidth >= 760 ? 0 : homeEl.offsetHeight / 2;
    const p = map.project([h.lat, h.lng], map.getZoom()).add([innerWidth >= 760 ? 220 : 0, y]);
    map.panTo(map.unproject(p, map.getZoom()), { animate: true });
  });
}
async function showNearby(id, mode) {
  const cat = CATS.find((c) => c.id === id); if (!cat) return;
  const seq = ++nearSeq, ref = nearRef();
  nearCat = id; nearSel = -1; nearMode = mode || 'list'; nearHits = []; nearLayer.clearLayers();
  homeExpand(nearMode === 'list');
  renderNear('جارٍ البحث…');
  let hits = nearOffline(cat, ref), src = 'offline';
  if (!hits || !hits.length) {
    if (navigator.onLine === false) { hits = hits || []; }
    else { try { hits = await nearOnline(cat, ref); src = 'online'; } catch (e) { hits = hits || []; src = 'error'; } }
  }
  if (seq !== nearSeq || nearCat !== id) return;
  nearHits = hits.map((h) => Object.assign(h, { n: cleanName(h.n), sub: cleanName(h.sub) })); nearSrc = src;
  if (!hits.length) {
    renderNear(src === 'error' ? 'تعذّر البحث — تحقّق من الاتصال.' : navigator.onLine === false && !places ? 'لا يوجد اتصال. نزّل خريطة محافظتك للبحث بدون إنترنت.' : 'لا توجد نتائج قريبة.');
    return;
  }
  renderNear(); drawNearMarkers(); fitNear();
}
function closeNear() {
  nearSeq++; nearCat = null; nearSel = -1;
  homeEl.classList.remove('nearOn', 'nearMap');
  clearNear(); _closeSearchHome(); homeExpand(false);
}
function pickNear(i) {
  const h = nearHits[i]; if (!h) return;
  closeNear();
  setDestination(h.lat, h.lng, h.n, h.sub || '', false);
}
$('catGrid').querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => showNearby(b.dataset.cat); });

/* ---------------- shortcut cards ---------------- */
function renderCards() {
  const cards = [
    { id: 'openMaps', i: '⬇', t: 'خرائط بدون إنترنت', s: 'طريقك جاهز حتى بلا إنترنت' },
    { id: 'openMeasure', i: '📐', t: 'قياس مساحة أو مسافة', s: 'بالمتر المربع والدونم والهكتار' },
    { id: 'openTracks', i: '🛤', t: 'سجّل مسارك', s: 'ارجع على نفس الطريق، حتى الترابي' },
    { id: 'shareMe', i: '↗', t: 'شارك موقعك', s: 'واتساب أو رسالة SMS بدون إنترنت' }
  ];
  if (fset.field) cards.splice(1, 0, { id: 'openSites', i: '🛢', t: 'مواقع العمل', s: 'آبار، صمامات، محطات' });
  $('homeCards').innerHTML = cards.map((c) => `<button class="hcard" data-open="${c.id}"><span class="hc">${c.i}</span><span><div class="t">${c.t}</div><div class="s">${c.s}</div></span><span class="chev">‹</span></button>`).join('');
  $('homeCards').querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { const t = $(b.dataset.open); if (t) t.click(); }; });
}

/* ---------------- which screen is showing (hides the home sheet behind other panels) ---------------- */
const visible = (id) => { const el = $(id); return el && !el.classList.contains('hidden'); };
function uiState() {
  const b = document.body;
  b.classList.toggle('ui-dest', visible('sheet'));
  b.classList.toggle('ui-nav', visible('navTop'));
  b.classList.toggle('ui-meas', visible('measPanel'));
  placeFabs();
}
/* keep the location button just above whatever panel is at the bottom */
let placing = false;
function placeFabs() {
  if (placing) return; placing = true;
  requestAnimationFrame(() => {
    placing = false;
    const f = $('fabs'); if (!f) return;
    if (innerWidth >= 760) { f.style.bottom = '24px'; document.body.style.setProperty('--sheetH', '0px'); return; }
    const ids = ['navBottom', 'measPanel', 'sheet', 'searchWrap'];
    let h = 0;
    for (const id of ids) {
      const el = $(id);
      if (el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none') { h = el.offsetHeight; break; }
    }
    document.body.style.setProperty('--sheetH', h + 'px');
    const v = (h ? h + 14 : 24) + 'px';
    if (f.style.bottom !== v) f.style.bottom = v;
  });
}
window.fabsAboveSheet = placeFabs;
['sheet', 'navTop', 'navBottom', 'measPanel', 'searchWrap'].forEach((id) => { const el = $(id); if (el) new MutationObserver(uiState).observe(el, { attributes: true, attributeFilter: ['class', 'style'] }); });
new MutationObserver(() => { if (!placing) placeFabs(); }).observe($('fabs'), { attributes: true, attributeFilter: ['style'] });
if (window.ResizeObserver) new ResizeObserver(placeFabs).observe(homeEl);
addEventListener('resize', placeFabs);

/* tapping the map folds the sheet away; the back button collapses it */
map.on('click', () => {
  if (nearOn()) { if (nearMode === 'map' && nearSel >= 0) { nearSel = -1; renderNear(); drawNearMarkers(); } return; }
  if (homeEl.classList.contains('expanded') && resEl.classList.contains('hidden')) homeExpand(false);
});
map.on('movestart', () => { if (!nearOn() && homeEl.classList.contains('expanded') && !qEl.value && document.activeElement !== qEl) homeExpand(false); });
/* typing a search leaves the nearby results */
qEl.addEventListener('input', () => { if (nearOn()) { nearSeq++; nearCat = null; homeEl.classList.remove('nearOn', 'nearMap'); clearNear(); homeExpand(true); } }, true);
function homeHandleBack() {
  if (nearOn()) { if (nearMode === 'map' && nearHits.length) setNearMode('list'); else closeNear(); return true; }
  if (homeEl.classList.contains('expanded') && !document.body.classList.contains('ui-dest')) { homeExpand(false); qEl.blur(); return true; }
  return false;
}
const _closeSearchHome = closeSearch;
closeSearch = function () { _closeSearchHome(); if (nearOn()) { nearSeq++; nearCat = null; homeEl.classList.remove('nearOn', 'nearMap'); } if (nearHits.length && !document.body.classList.contains('ui-dest')) clearNear(); };

/* ---------------- init ---------------- */
renderChips(); renderCards(); uiState();
const _setField = $('setField').onchange;
$('setField').onchange = (e) => { _setField(e); renderCards(); };
