'use strict';
/* الملاح — «وصف المكان بالمعالم»: في العراق يُوصف المكان بالمعالم لا بالعناوين. يكتب الملاح وصفًا يفهمه
   سائق التاكسي أو التوصيل: الحي والمنطقة، والشارع، وأقرب المعالم المعروفة واتجاهها، ورقم المحلة والزقاق
   والدار إن أدخلتها، والإحداثيات ورابط الخريطة. يعمل بدون إنترنت من الخريطة المنزّلة. */

const LM_KINDS = { mosque: 'جامع', hospital: 'مستشفى', clinic: 'مستوصف', school: 'مدرسة', university: 'جامعة', college: 'كلية', fuel: 'محطة وقود',
  bank: 'مصرف', marketplace: 'سوق', supermarket: 'أسواق', mall: 'مول', park: 'حديقة', stadium: 'ملعب', police: 'مركز شرطة', government: 'دائرة',
  townhall: 'دائرة', pharmacy: 'صيدلية', hotel: 'فندق', church: 'كنيسة', bus_station: 'كراج', restaurant: 'مطعم', cafe: 'مقهى' };
const LM_RANK = { mosque: 1, hospital: 1, school: 2, university: 1, college: 2, fuel: 2, marketplace: 1, mall: 1, park: 2, stadium: 1, police: 2,
  government: 2, townhall: 2, bank: 3, supermarket: 3, hotel: 3, church: 2, bus_station: 2, clinic: 3, pharmacy: 4, restaurant: 4, cafe: 5 };
const DIRS8 = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
function bearingDeg(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
/* the addresses the user typed (محلة / زقاق / دار), kept by place */
let addrBook = store.get('addrBook', []);   // [{lat, lng, m, z, d, note}]
const addrAt = (lat, lng) => addrBook.find((a) => hav([a.lat, a.lng], [lat, lng]) < 60);
async function addrEdit(lat, lng) {
  const a = addrAt(lat, lng) || {};
  const m = await uiPrompt('رقم المحلة (اختياري)', a.m || '', { num: 1, ok: 'التالي' }); if (m == null) return false;
  const z = await uiPrompt('رقم الزقاق (اختياري)', a.z || '', { num: 1, ok: 'التالي' }); if (z == null) return false;
  const d = await uiPrompt('رقم الدار (اختياري)', a.d || '', { num: 1, ok: 'التالي' }); if (d == null) return false;
  const note = await uiPrompt('علامة مميزة للباب أو البناية (اختياري) — مثلًا: باب أخضر، بجانب محل…', a.note || '', { ok: 'حفظ' }); if (note == null) return false;
  addrBook = addrBook.filter((x) => x !== addrAt(lat, lng));
  const v = { lat, lng, m: normDigits(m).trim(), z: normDigits(z).trim(), d: normDigits(d).trim(), note: note.trim().slice(0, 80) };
  if (v.m || v.z || v.d || v.note) addrBook.push(v);
  store.set('addrBook', addrBook);
  return true;
}
/* the known places around a point: from the downloaded map, else the nearby-places squares */
async function lmAround(lat, lng) {
  let list = [];
  if (typeof places !== 'undefined' && places) {
    list = places.filter((p) => Math.abs(p.lat - lat) < 0.012 && Math.abs(p.lng - lng) < 0.014).map((p) => ({ n: p.n, k: p.k, lat: p.lat, lng: p.lng }));
  }
  if (!list.some((p) => LM_KINDS[p.k]) && typeof poiTile === 'function' && navigator.onLine !== false) {
    try { list = list.concat((await poiTile(poiKey(lat, lng))).map((r) => ({ n: r[1], k: r[0], lat: r[2], lng: r[3] }))); } catch (e) {}
  }
  return list;
}
async function describePlace(lat, lng, title) {
  toast('🗺 جارٍ كتابة الوصف…', 1500);
  const list = await lmAround(lat, lng);
  // the neighbourhood and the area
  const lines = [];
  let nb = null, nbd = 2500;
  list.forEach((p) => { if (['suburb', 'neighbourhood', 'quarter', 'village', 'town', 'hamlet'].includes(p.k)) { const d = hav([lat, lng], [p.lat, p.lng]); if (d < nbd) { nbd = d; nb = p; } } });
  let area = null;
  try { if (typeof arLoad === 'function') { await arLoad(); const a = arAreaOf({ lat, lng }); if (a) area = arShort(a); } } catch (e) {}
  let prov = '';
  try { const h = arHere(lat, lng); if (h.length) prov = AR.byId[h[0]].ar; } catch (e) {}
  const where = [nb && nb.n, area && (!nb || nb.n !== area) ? area : '', prov && prov !== area ? prov : ''].filter(Boolean);
  if (where.length) lines.push('📍 ' + where.join('، '));
  // the street
  const st = typeof roadsStreetAt === 'function' ? await roadsStreetAt(lat, lng) : null;
  if (st && st.name) lines.push('🛣 على ' + (/^(شارع|طريق|جسر|ساحة)/.test(st.name) ? '' : 'شارع ') + st.name);
  // up to three landmarks, the known kinds first, nearest first
  const lm = list.filter((p) => LM_KINDS[p.k] && p.n && !/^\d+$/.test(p.n))
    .map((p) => Object.assign({ d: hav([lat, lng], [p.lat, p.lng]) }, p))
    .filter((p) => p.d < 900)
    .sort((a, b) => (a.d / 100 + LM_RANK[a.k] * 1.5) - (b.d / 100 + LM_RANK[b.k] * 1.5));
  const used = new Set(), picks = [];
  for (const p of lm) { if (used.has(p.n)) continue; used.add(p.n); picks.push(p); if (picks.length >= 3) break; }
  if (picks.length) {
    lines.push('🏛 قرب:');
    picks.forEach((p) => {
      const named = p.n.startsWith(LM_KINDS[p.k]) || /^(جامع|مسجد|مستشفى|مدرسة|جامعة|كلية|محطة|مصرف|سوق|حديقة|ملعب|مركز|دائرة|صيدلية|فندق|كنيسة)/.test(p.n) ? p.n : LM_KINDS[p.k] + ' ' + p.n;
      lines.push(p.d < 40 ? '  • بجانب ' + named : '  • على بعد ' + (p.d < 1000 ? Math.round(p.d / 10) * 10 + ' م' : (p.d / 1000).toFixed(1) + ' كم') + ' ' + DIRS8[Math.round(bearingDeg([p.lat, p.lng], [lat, lng]) / 45) % 8] + ' ' + named);
    });
  }
  // the address the user typed
  const ad = addrAt(lat, lng);
  if (ad) {
    const parts = [ad.m && 'محلة ' + ad.m, ad.z && 'زقاق ' + ad.z, ad.d && 'دار ' + ad.d].filter(Boolean);
    if (parts.length) lines.push('🏠 ' + parts.join(' · '));
    if (ad.note) lines.push('🚪 ' + ad.note);
  }
  lines.push('🧭 ' + lat.toFixed(6) + ', ' + lng.toFixed(6));
  const text = (title ? title.replace(/^📍\s*/, '📍 ') + '\n' : '') + lines.join('\n') + '\nhttps://maps.google.com/?q=' + lat.toFixed(6) + ',' + lng.toFixed(6);
  const sms = (title ? title.replace(/^📍\s*/, '') + ': ' : '') + lines.filter((l) => !l.startsWith('🧭')).join(' ').replace(/[^\S\n]+/g, ' ').replace(/[📍🛣🏛🏠🚪•]/gu, '').trim() + ' ' + lat.toFixed(5) + ',' + lng.toFixed(5);
  actionSheet('🗺 وصف المكان بالمعالم', [
    { label: `<div class="descTxt">${esc(text)}</div>` },
    { label: '↗ مشاركة الوصف (واتساب، تيليجرام…)', fn: () => doShare(text) },
    { label: '✉️ إرسال الوصف SMS — بدون إنترنت', fn: () => doSms(sms) },
    { label: '📋 نسخ', fn: () => (typeof copyText === 'function' ? copyText(text) : doShare(text)) },
    { label: ad ? '🏠 تعديل رقم المحلة والزقاق والدار' : '🏠 أضف رقم المحلة والزقاق والدار', fn: async () => { if (await addrEdit(lat, lng)) describePlace(lat, lng, title); } }
  ]);
}
