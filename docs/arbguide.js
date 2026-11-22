'use strict';
/* الملاح — دليل زائر الأربعين: أماكن كربلاء والنجف والكوفة والطريق بينها — المزارات والمساجد والحسينيات
   والفنادق والمرافق الصحية والخدمية ونقاط دالة (من OpenStreetMap، تُنزَّل مرة وتعمل بعدها بدون إنترنت)،
   و«الأماكن المختارة»، والمواكب الخدمية التي يسجّلها الزائرون فيراها الجميع. */

const AG_URL = 'https://raw.githubusercontent.com/mustafasami446-star/mallah/arbaeen/arbaeen.json';
const AG_CATS = [
  ['chosen', '⭐', 'الأماكن المختارة'],
  ['shrine', '🕌', 'المزارات والمقامات'],
  ['mosque', '🕌', 'المساجد'],
  ['huss', '🏛', 'الحسينيات'],
  ['hotel', '🏨', 'الفنادق'],
  ['mawkib', '🍲', 'المواكب الخدمية'],
  ['health', '🏥', 'المرافق الصحية', ['health', 'pharmacy']],
  ['serv', '🚰', 'الماء والمرافق والشرطة', ['water', 'toilets', 'police']],
  ['mark', '📍', 'نقاط دالة']
];
const AG_KIND = { shrine: '🕌 مزار', mosque: '🕌 مسجد', huss: '🏛 حسينية', hotel: '🏨 فندق', health: '🏥 صحي', pharmacy: '💊 صيدلية', water: '🚰 ماء', toilets: '🚻 مرافق', police: '👮 شرطة', mark: '📍 نقطة دالة', mawkib: '🍲 موكب' };
const AG_CITIES = ['الكل', 'كربلاء', 'النجف', 'الكوفة', 'الطريق'];
const AG = { data: store.get('agData', null), view: 'home', cat: null, city: store.get('agCity', 'الكل'), q: '', mw: [], layer: null };

/* ---------------- the data: once from the internet, then from the phone ---------------- */
async function agLoad(force) {
  const old = store.get('agAt', 0);
  if (AG.data && !force && Date.now() - old < 14 * 86400e3) return AG.data;
  try {
    const r = await fetch(AG_URL + '?t=' + Math.floor(Date.now() / 3600e3), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (d && d.places) { AG.data = d; try { store.set('agData', d); store.set('agAt', Date.now()); } catch (e) {} }
  } catch (e) { if (!AG.data) throw e; }
  return AG.data;
}
const agDist = (p) => (me ? hav([me.lat, me.lng], [p.lat, p.lng]) : null);
function agList(cat) {
  const D = AG.data; if (!D) return [];
  let L;
  if (cat === 'chosen') L = D.chosen.map((c) => ({ k: 'shrine', n: c.t, sub: c.n, lat: c.lat, lng: c.lng, c: c.c }));
  else if (cat === 'mawkib') L = AG.mw.map((m) => ({ k: 'mawkib', n: m.n, sub: m.s || '', lat: m.lat, lng: m.lng, c: agCity(m.lat, m.lng), mw: m }));
  else { const ks = (AG_CATS.find((x) => x[0] === cat) || [])[3] || [cat]; L = D.places.filter((p) => ks.includes(p.k)); }
  if (AG.city !== 'الكل') L = L.filter((p) => p.c === AG.city);
  if (AG.q) { const q = arNorm(AG.q); L = L.filter((p) => arNorm(p.n + ' ' + (p.e || '') + ' ' + (p.sub || '')).includes(q)); }
  if (me) L.sort((a, b) => agDist(a) - agDist(b));
  else if (cat !== 'chosen') L.sort((a, b) => (b.a || 0) - (a.a || 0) || a.n.localeCompare(b.n, 'ar'));
  return L;
}
const arNorm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '').toLowerCase();
function agCity(lat, lng) {
  const C = [['كربلاء', 32.616, 44.033, 14], ['الكوفة', 32.032, 44.398, 5], ['النجف', 31.996, 44.33, 10]];
  for (const [n, a, b, r] of C) if (hav([lat, lng], [a, b]) <= r * 1000) return n;
  return 'الطريق';
}

/* ---------------- the community's mawakib ---------------- */
const AG_MW_SEASON = () => String(new Date().getFullYear());
async function agMwLoad() {
  try {
    await fbDb();
    const d = await fbReq('GET', '/mawakib/' + AG_MW_SEASON()) || {};
    const now = Date.now();
    AG.mw = Object.entries(d).map(([id, m]) => Object.assign({ id }, m)).filter((m) => m && m.x > now && m.lat && (!m.v || Object.values(m.v).filter((t) => t < 0).length < 3));
  } catch (e) { AG.mw = AG.mw || []; }
  return AG.mw;
}
const AG_MW_KINDS = ['🍲 طعام وماء', '💧 ماء وعصير', '☕ شاي وقهوة', '🛏 منام واستراحة', '🩺 علاج وإسعاف', '👟 خدمات أخرى'];
async function agMwAdd() {
  if (!me) { toast('بانتظار تحديد موقعك… سجّل الموكب وأنت عنده'); return; }
  const name = await uiPrompt('🍲 اسم الموكب (كما هو مكتوب عليه)', '', { ok: 'التالي', placeholder: 'مثلًا: موكب أهالي البصرة' });
  if (!name || !name.trim()) return;
  actionSheet('ماذا يقدّم؟', AG_MW_KINDS.map((s) => ({
    label: s, fn: async () => {
      try {
        await fbToken(); await fbDb();
        const now = Date.now();
        const r = { n: name.trim().slice(0, 60), s, lat: Math.round(me.lat * 1e6) / 1e6, lng: Math.round(me.lng * 1e6) / 1e6, t: now, x: now + 10 * 86400e3, u: fbAuth.uid };
        await fbReq('POST', '/mawakib/' + AG_MW_SEASON(), r);
        toast('🍲 شكرًا — صار الموكب ظاهرًا لكل زوّار الأربعين في الملاح', 3500);
        await agMwLoad(); if (AG.view === 'list' && AG.cat === 'mawkib') agRender();
      } catch (e) { toast(String(e.message).match(/40[13]/) ? 'رفض الخادم — يلزم تحديث قواعد Firebase للمواكب' : 'تعذّر الإرسال — تحقق من الإنترنت', 4000); }
    }
  })));
}
async function agMwVote(m, ok) {
  try { await fbToken(); await fbDb(); await fbReq('PUT', '/mawakib/' + AG_MW_SEASON() + '/' + m.id + '/v/' + fbAuth.uid, ok ? Date.now() : -Date.now()); toast(ok ? '👍 شكرًا للتأكيد' : '👎 شكرًا — يُحذف الموكب إذا أكّد غيرك أنه غير موجود'); } catch (e) { toast('تعذّر الإرسال'); }
}

/* ---------------- the panel ---------------- */
function agEnsure() {
  if ($('agPanel')) return;
  const el = document.createElement('div'); el.id = 'agPanel'; el.className = 'panel hidden';
  el.innerHTML = `<div class="panelHead"><button class="iconBtn" id="agBack" aria-label="رجوع"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button><h2 id="agTitle">🕌 دليل زائر الأربعين</h2></div>
    <div class="agSearch"><input id="agQ" type="search" placeholder="ابحث عن مزار، حسينية، فندق…" autocomplete="off"><button id="agMic" aria-label="بحث بالصوت">🎤</button></div>
    <div class="agCities" id="agCities"></div>
    <div class="panelBody" id="agBody"></div>`;
  document.body.appendChild(el);
  $('agBack').onclick = () => { if (AG.view !== 'home' || AG.q) { AG.view = 'home'; AG.q = ''; $('agQ').value = ''; agRender(); } else agClose(); };
  let t = 0;
  $('agQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { AG.q = $('agQ').value.trim(); if (AG.q && AG.view === 'home') AG.view = 'search'; if (!AG.q && AG.view === 'search') AG.view = 'home'; agRender(); }, 220); };
  $('agMic').onclick = async () => { const s = await voiceAsk('عن أي مكان تبحث؟'); if (s) { $('agQ').value = s; $('agQ').oninput(); } };
}
async function openArbGuide() {
  agEnsure();
  $('menuDrop').classList.add('hidden');
  document.querySelectorAll('.panel:not(.hidden)').forEach((p) => p.classList.add('hidden'));
  $('agPanel').classList.remove('hidden');
  AG.view = 'home'; AG.q = ''; $('agQ').value = '';
  agRender();
  try { await agLoad(); } catch (e) { $('agBody').innerHTML = '<div class="agEmpty">تعذّر تنزيل الدليل — يحتاج الإنترنت أول مرة فقط.<br><button class="btn" onclick="openArbGuide()">↻ أعد المحاولة</button></div>'; return; }
  agRender();
  agMwLoad().then(() => agRender());
}
function agClose() { $('agPanel').classList.add('hidden'); }
window.agHandleBack = () => {
  const p = $('agPanel'); if (!p || p.classList.contains('hidden')) return false;
  $('agBack').onclick(); return true;
};
function agRender() {
  const body = $('agBody'); if (!body) return;
  $('agCities').innerHTML = AG_CITIES.map((c) => `<button class="${AG.city === c ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
  $('agCities').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; AG.city = b.dataset.c; store.set('agCity', AG.city); agRender(); };
  const D = AG.data;
  if (!D) { body.innerHTML = '<div class="agEmpty">⏳ جارٍ تنزيل دليل الأماكن…</div>'; return; }
  const cat = AG.view === 'list' ? AG_CATS.find((c) => c[0] === AG.cat) : null;
  $('agTitle').textContent = cat ? cat[1] + ' ' + cat[2] : AG.view === 'search' ? '🔎 نتائج البحث' : '🕌 دليل زائر الأربعين';
  if (AG.view === 'list' || AG.view === 'search') {
    let L = AG.view === 'search' ? AG_CATS.filter((c) => c[0] !== 'chosen').flatMap((c) => agList(c[0])) : agList(AG.cat);
    if (AG.view === 'search' && me) L.sort((a, b) => agDist(a) - agDist(b));
    const head = AG.cat === 'mawkib' && AG.view === 'list' ? `<button class="agAdd" id="agMwAdd">➕ سجّل موكبًا أنت عنده الآن</button><div class="agNote">المواكب يسجّلها الزوّار أنفسهم، وتختفي بعد عشرة أيام أو إذا أكّد ثلاثة أنها غير موجودة.</div>` : '';
    body.innerHTML = head + (L.length ? `<div class="agTools"><span>${L.length} مكانًا${me ? ' — الأقرب أولًا' : ''}</span><button id="agOnMap">🗺 اعرضها على الخريطة</button></div><div class="agList">${L.slice(0, 300).map((p, i) => agRow(p, i)).join('')}</div>`
      : `<div class="agEmpty">${AG.cat === 'mawkib' ? 'لا مواكب مسجّلة هنا بعد — كن أول من يسجّل' : 'لا شيء هنا' + (AG.city !== 'الكل' ? ' في ' + AG.city + ' — جرّب «الكل»' : '')}</div>`);
    body.querySelectorAll('.agRow').forEach((r) => { r.onclick = () => agPlace(L[+r.dataset.i]); });
    const om = $('agOnMap'); if (om) om.onclick = () => agOnMap(L, cat ? cat[2] : 'نتائج البحث');
    const ad = $('agMwAdd'); if (ad) ad.onclick = agMwAdd;
    return;
  }
  // home: the chosen places, the categories, the services
  const chosen = D.chosen.filter((c) => AG.city === 'الكل' || c.c === AG.city);
  const count = (k) => (k === 'chosen' ? chosen.length : k === 'mawkib' ? AG.mw.filter((m) => AG.city === 'الكل' || agCity(m.lat, m.lng) === AG.city).length : agList(k).length);
  body.innerHTML = `
    ${chosen.length ? `<div class="agChips">${chosen.map((c, i) => `<button data-ch="${i}">${esc(c.t)}</button>`).join('')}</div>` : ''}
    <div class="agSec">دليل الأماكن</div>
    <div class="agCard">${AG_CATS.map((c) => `<button class="agCat" data-cat="${c[0]}"><i>${c[1]}</i><b>${c[2]}</b><small>${count(c[0])}</small><span>‹</span></button>`).join('')}</div>
    <div class="agSec">خدمات الأربعين</div>
    <div class="agCard">
      <button class="agCat" data-s="walk"><i>🚶</i><b>الطريق وعدّ الأعمدة<small>رقم العمود الذي أنت عنده، والباقي إلى كربلاء، ونقطة لقاء العائلة</small></b><span>‹</span></button>
      <button class="agCat" data-s="qibla"><i>🕋</i><b>البوصلة<small>اتجاه القبلة قبل الصلاة</small></b><span>‹</span></button>
      <button class="agCat" data-s="near"><i>🏥</i><b>أقرب مرفق صحي مني<small>مستشفى أو مركز صحي أو صيدلية، مع المسار إليه</small></b><span>‹</span></button>
      <button class="agCat" data-s="mw"><i>🍲</i><b>سجّل موكبًا هنا<small>يراه كل زوّار الأربعين في الملاح</small></b><span>‹</span></button>
      <button class="agCat" data-s="share"><i>📍</i><b>أرسل موقعي للعائلة<small>رابط موقعك، أو رسالة SMS بدون إنترنت</small></b><span>‹</span></button>
    </div>
    <div class="agNote">بيانات الأماكن من OpenStreetMap ويحدّثها الملاح كل أسبوعين. قد يغيب بعض الأماكن غير المسجّلة على الخريطة.</div>`;
  body.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => { const c = chosen[+b.dataset.ch]; agPlace({ k: 'shrine', n: c.t, sub: c.n, lat: c.lat, lng: c.lng, c: c.c }); }; });
  body.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { AG.view = 'list'; AG.cat = b.dataset.cat; agRender(); body.scrollTop = 0; if (AG.cat === 'mawkib') agMwLoad().then(() => agRender()); }; });
  body.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => agService(b.dataset.s); });
}
function agRow(p, i) {
  const d = agDist(p);
  return `<button class="agRow" data-i="${i}"><i>${(AG_KIND[p.k] || '📍').split(' ')[0]}</i><span><b>${esc(p.n || AG_KIND[p.k].split(' ')[1])}</b><small>${esc([(AG_KIND[p.k] || '').split(' ').slice(1).join(' '), p.sub && p.sub !== p.n ? p.sub : '', p.c].filter(Boolean).join(' · '))}</small></span>${d != null ? `<em>${fmtDist(d)}</em>` : ''}</button>`;
}
function agPlace(p) {
  const d = agDist(p);
  const items = [
    { label: `<div style="text-align:right"><b>${esc(p.n || '')}</b><div class="s">${esc([(AG_KIND[p.k] || '').split(' ').slice(1).join(' '), p.sub && p.sub !== p.n ? p.sub : '', p.c, d != null ? 'على بعد ' + fmtDist(d) : ''].filter(Boolean).join(' · '))}</div></div>` },
    { label: '🧭 المسار إليه', fn: () => { agClose(); setDestination(p.lat, p.lng, p.n || AG_KIND[p.k], (AG_KIND[p.k] || '') + (p.c ? ' — ' + p.c : '')); } },
    { label: '🗺 أظهره على الخريطة', fn: () => agOnMap([p], p.n) },
    { label: '↗ مشاركة المكان', fn: () => doShare(locText('📍 ' + (p.n || ''), p.lat, p.lng, p.c)) }
  ];
  if (p.mw) { items.push({ label: '👍 الموكب موجود', fn: () => agMwVote(p.mw, true) }); items.push({ label: '👎 الموكب غير موجود', fn: () => agMwVote(p.mw, false) }); }
  actionSheet(AG_KIND[p.k] || '📍', items);
}
/* the places on the main map, with a chip to take them away */
function agOnMap(L, title) {
  agClose();
  if (AG.layer) { map.removeLayer(AG.layer); AG.layer = null; }
  AG.layer = L.slice(0, 400).reduce((g, p) => {
    const ic = (AG_KIND[p.k] || '📍').split(' ')[0];
    const m = window.L.marker([p.lat, p.lng], { icon: window.L.divIcon({ className: 'agPin', html: `<span>${ic}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) });
    m.on('click', () => agPlace(p));
    if (p.n) m.bindTooltip(p.n, { direction: 'top', offset: [0, -12] });
    return g.addLayer(m);
  }, window.L.layerGroup()).addTo(map);
  try { if (typeof setFollow === 'function') setFollow(false); const b = window.L.latLngBounds(L.slice(0, 400).map((p) => [p.lat, p.lng])); if (L.length === 1) map.setView([L[0].lat, L[0].lng], 17); else map.fitBounds(b, { padding: [50, 50], maxZoom: 17 }); } catch (e) {}
  let chip = $('agChip');
  if (!chip) { chip = document.createElement('button'); chip.id = 'agChip'; document.body.appendChild(chip); }
  chip.textContent = '✕ ' + (title || 'أماكن الدليل') + ' (' + Math.min(L.length, 400) + ')';
  chip.onclick = () => { if (AG.layer) { map.removeLayer(AG.layer); AG.layer = null; } chip.remove(); };
}
function agService(k) {
  if (k === 'walk') { agClose(); if (typeof arb !== 'undefined' && arb && arb.on) arbMenu(); else arbStart(); return; }
  if (k === 'qibla') { openPrayer(); setTimeout(() => { const c = document.querySelector('.prQibla'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }, 300); return; }
  if (k === 'mw') { agMwAdd(); return; }
  if (k === 'share') {
    if (!me) { toast('بانتظار تحديد موقعك…'); return; }
    actionSheet('📍 أرسل موقعي', [
      { label: '↗ رابط موقعي (واتساب، تيليجرام…)', fn: () => doShare(locText('📍 أنا هنا الآن', me.lat, me.lng, 'زيارة الأربعين')) },
      { label: '✉️ رسالة SMS — بدون إنترنت', fn: () => doSms('أنا هنا الآن: ' + me.lat.toFixed(5) + ',' + me.lng.toFixed(5) + ' https://maps.google.com/?q=' + me.lat.toFixed(6) + ',' + me.lng.toFixed(6)) }
    ]);
    return;
  }
  if (k === 'near') {
    if (!me) { toast('بانتظار تحديد موقعك…'); return; }
    const L = (AG.data ? AG.data.places : []).filter((p) => p.k === 'health' || p.k === 'pharmacy').sort((a, b) => agDist(a) - agDist(b)).slice(0, 6);
    if (!L.length) { toast('لا مرافق صحية في الدليل قربك'); return; }
    actionSheet('🏥 أقرب المرافق الصحية', L.map((p) => ({ label: `${AG_KIND[p.k].split(' ')[0]} ${esc(p.n || 'مركز صحي')} — ${fmtDist(agDist(p))}`, fn: () => { agClose(); setDestination(p.lat, p.lng, p.n || 'مركز صحي', AG_KIND[p.k]); } })));
  }
}

/* ---------------- the ways in ---------------- */
{
  const s = $('openSettings');
  if (s) {
    const b = document.createElement('button'); b.id = 'openArbGuide';
    b.innerHTML = '<span style="font-size:19px;width:22px;text-align:center">🕌</span>دليل زائر الأربعين (كربلاء والنجف)';
    b.onclick = openArbGuide;
    const after = $('openArbaeen'); if (after) after.after(b); else s.parentNode.insertBefore(b, s);
  }
}
