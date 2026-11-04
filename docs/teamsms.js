'use strict';
/* الملاح — مواقع الفريق بالرسائل النصية: زميل بلا إنترنت يرسل موقعه برسالة SMS (من «رسائل SMS الاحتياطية»)،
   فيقرؤها الملاح عند الاستلام ويضعه على الخريطة مع وقت الرسالة، والاستغاثة بتنبيه واضح. أندرويد فقط. */

const smsInOk = () => { try { return NATIVE && Android.teamCanSmsIn && Android.teamCanSmsIn(); } catch (e) { return false; } };
const smsLayer = L.layerGroup().addTo(map);
let smsPos = store.get('smsPos', []);          // [{key, name, from, lat, lng, acc, sos, t, at}]
let smsSeen = store.get('smsSeen', 0);
/* «📍 الملاح — علي: لا يوجد إنترنت لديّ. موقعي 14:05: https://maps.google.com/?q=30.5,47.8 (± 12 م)» */
function smsParse(o) {
  const t = o.text || '';
  const q = t.match(/maps\.google\.com\/\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/); if (!q) return null;
  const nm = t.match(/الملاح\s*—\s*(.+?)(?::|\s+يطلب|$)/);
  const acc = t.match(/±\s*(\d+)/), at = t.match(/موقعي\s+(\d{1,2}:\d{2})/);
  const name = (nm ? nm[1] : '').trim().slice(0, 40) || o.from || 'زميل';
  return { key: (o.from || '') + '|' + name, name, from: o.from || '', lat: +q[1], lng: +q[2], acc: acc ? +acc[1] : 0, sos: t.includes('🆘'), t: o.t, at: at ? at[1] : '' };
}
function smsDraw() {
  smsLayer.clearLayers();
  const now = Date.now();
  smsPos = smsPos.filter((p) => now - p.t < 12 * 3600e3);
  smsPos.forEach((p) => {
    const ago = Math.round((now - p.t) / 60e3), when = ago < 1 ? 'الآن' : ago < 60 ? 'قبل ' + ago + ' د' : 'قبل ' + Math.floor(ago / 60) + ' س';
    const html = `<div class="smsPin${p.sos ? ' sos' : ''}"><i>${p.sos ? '🆘' : '📩'}</i><span>${esc(p.name)}<small>${p.sos ? 'استغاثة · ' : 'SMS · '}${when}</small></span></div>`;
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html, iconSize: [0, 0] }), zIndexOffset: p.sos ? 900 : 400 })
      .on('click', () => actionSheet((p.sos ? '🆘 ' : '📩 ') + p.name + ' — موقع وصل برسالة ' + when, [
        { label: '🧭 اذهب إليه', fn: () => setDestination(p.lat, p.lng, p.name, 'موقع وصل برسالة SMS ' + when) },
        ...(p.from ? [{ label: '📞 اتصل ' + esc(p.from), fn: () => openExt('tel:' + p.from) }] : []),
        { label: '🗑 إزالة من الخريطة', cls: 'danger', fn: () => { smsPos = smsPos.filter((x) => x !== p); store.set('smsPos', smsPos); smsDraw(); } }
      ])).addTo(smsLayer);
  });
}
function smsCheck() {
  if (!NATIVE || !Android.teamSmsSince) return;
  let list = [];
  try { list = JSON.parse(Android.teamSmsSince(smsSeen) || '[]'); } catch (e) { return; }
  if (!list.length) return;
  list.forEach((o) => {
    smsSeen = Math.max(smsSeen, o.t || 0);
    const p = smsParse(o); if (!p) return;
    smsPos = smsPos.filter((x) => x.key !== p.key); smsPos.push(p);
    if (p.sos) { vib('700,250,700,250,700'); say(p.name + ' يطلب المساعدة'); toast('🆘 ' + p.name + ' يطلب المساعدة — وصل موقعه برسالة', 8000); setFollow(false); map.setView([p.lat, p.lng], 15); }
    else toast('📩 وصل موقع ' + p.name + ' برسالة SMS — يظهر على الخريطة', 5000);
  });
  store.set('smsSeen', smsSeen); store.set('smsPos', smsPos);
  smsDraw();
}
if (NATIVE) {
  if (!smsSeen) { smsSeen = Date.now(); store.set('smsSeen', smsSeen); }   // only messages from now on
  smsDraw(); setTimeout(smsCheck, 2000);
  setInterval(() => { if (document.visibilityState === 'visible') smsCheck(); }, 10000);
  setInterval(smsDraw, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') smsCheck(); });
}
