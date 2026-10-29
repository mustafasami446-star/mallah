'use strict';
/* الملاح — المرحلة ٣: تسجيل المسارات، مناطق التنبيه، سجل الزيارات، الروابط */

/* ================= shared helpers ================= */
function vib(pattern) {
  if (NATIVE && Android.vibrate) { try { Android.vibrate(pattern); } catch (e) {} return; }
  try { navigator.vibrate(pattern.split(',').map(Number)); } catch (e) {}
}
function saveTextFile(name, mime, content) {
  if (NATIVE && Android.saveFile) { Android.saveFile(name, mime, content); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + content], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.onFileSaved(true);
}
window.onFileSaved = (ok) => toast(ok ? 'تم حفظ الملف' : 'لم يتم حفظ الملف');
function xmlEsc(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
function stamp(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function hhmm(d) { const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }
function fmtElapsed(ms) { const m = Math.floor(ms / 60000); return m < 60 ? m + ' د' : Math.floor(m / 60) + ' س ' + (m % 60) + ' د'; }
/* Douglas–Peucker simplification; returns the indexes kept */
function simplifyIdx(pts, tol) {
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const lat0 = pts[0][0] * rad, kx = Math.cos(lat0) * R * rad, ky = R * rad;
  const xy = pts.map((p) => [p[1] * kx, p[0] * ky]);
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = []; keep.forEach((k, i) => { if (k) out.push(i); }); return out;
}
function pathLen(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += hav(pts[i - 1], pts[i]); return d; }

/* ================= track recording ================= */
let tracks = store.get('tracks', []);
let rec = store.get('recTrack', null);   // {start, pts:[[lat,lng,t]], dist}
let recLine = null, shownTrack = null;
function saveTracks() {
  try { localStorage.setItem('tracks', JSON.stringify(tracks)); return true; }
  catch (e) { toast('لا توجد مساحة كافية؛ احذف بعض المسارات القديمة'); return false; }
}
function persistRec() { try { localStorage.setItem('recTrack', JSON.stringify(rec)); } catch (e) {} }
function keepGps() { if (NATIVE) try { Android.setNavigating(!!(rec || navState || directState)); } catch (e) {} }
function startRec() {
  if (rec) return;
  rec = { start: Date.now(), pts: [], dist: 0 };
  if (me) rec.pts.push([me.lat, me.lng, Date.now()]);
  persistRec(); keepGps(); drawRec(); renderRecBar();
  say('بدأ تسجيل المسار'); toast('بدأ تسجيل المسار — أبقِ التطبيق مفتوحًا أثناء التسجيل', 4000);
}
function drawRec() {
  if (!rec) { if (recLine) { map.removeLayer(recLine); recLine = null; } return; }
  const ll = rec.pts.map((p) => [p[0], p[1]]);
  if (!recLine) recLine = L.polyline(ll, { color: '#e11d48', weight: 5, opacity: .9, interactive: false }).addTo(map);
  else recLine.setLatLngs(ll);
}
function recPoint() {
  if (!rec || !me) return;
  if (me.acc && me.acc > 50) return;
  const last = rec.pts[rec.pts.length - 1], now = Date.now();
  if (last) {
    const d = hav([last[0], last[1]], [me.lat, me.lng]);
    const minD = Math.max(5, (me.acc || 0) * 0.5);
    if (d < minD && !(now - last[2] > 30000 && d >= 3)) return;
    rec.dist += d;
  }
  rec.pts.push([Math.round(me.lat * 1e6) / 1e6, Math.round(me.lng * 1e6) / 1e6, now]);
  if (recLine) recLine.addLatLng([me.lat, me.lng]); else drawRec();
  if (rec.pts.length % 3 === 0) persistRec();
  renderRecBar();
}
function renderRecBar() {
  const b = $('recBar');
  if (!rec) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  $('recInfo').textContent = 'تسجيل · ' + fmtDist(rec.dist) + ' · ' + fmtElapsed(Date.now() - rec.start);
  $('recToggle').textContent = '⏹ إيقاف التسجيل';
}
setInterval(() => { if (rec) renderRecBar(); }, 30000);
function stopRec() {
  if (!rec) return;
  const r = rec;
  rec = null; try { localStorage.removeItem('recTrack'); } catch (e) {}
  drawRec(); renderRecBar(); keepGps();
  if (r.pts.length < 2 || r.dist < 20) { toast('المسار قصير جدًا ولم يُحفظ'); return; }
  const def = 'مسار ' + stamp(new Date(r.start)) + ' ' + hhmm(new Date(r.start));
  const name = (prompt('اسم المسار', def) || def).trim();
  const pts = r.pts.map((p) => [p[0], p[1]]);
  const idx = simplifyIdx(pts, 3);
  const t = { id: Date.now().toString(36), name, date: r.start, dur: r.pts[r.pts.length - 1][2] - r.start, dist: r.dist, pts: idx.map((i) => pts[i]) };
  tracks.unshift(t);
  if (!saveTracks()) { tracks.shift(); return; }
  say('تم حفظ المسار'); toast('تم حفظ المسار «' + name + '» (' + fmtDist(r.dist) + ')', 4000);
}
$('recToggle').onclick = () => { if (rec) { if (confirm('إيقاف تسجيل المسار وحفظه؟')) stopRec(); } else startRec(); };

/* show a saved track */
function showTrack(t) {
  hideTrack();
  const ll = t.pts.map((p) => [p[0], p[1]]);
  shownTrack = L.layerGroup([
    L.polyline(ll, { color: '#7c3aed', weight: 6, opacity: .9, interactive: false }),
    L.circleMarker(ll[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1, interactive: false }),
    L.circleMarker(ll[ll.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1, interactive: false })
  ]).addTo(map);
  setFollow(false);
  map.fitBounds(L.latLngBounds(ll), { padding: [40, 120] });
  $('trackChip').textContent = '✕ إخفاء: ' + t.name; $('trackChip').classList.remove('hidden');
}
function hideTrack() { if (shownTrack) { map.removeLayer(shownTrack); shownTrack = null; } $('trackChip').classList.add('hidden'); }
$('trackChip').onclick = hideTrack;

/* turn a recorded track into a turn-by-turn route */
const TRACK_SPEED = { car: 30, bike: 12, foot: 4.5 }; // km/h on unpaved tracks
function trackRoute(t, reverse) {
  const pts = (reverse ? t.pts.slice().reverse() : t.pts).map((p) => [p[0], p[1]]);
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const keep = simplifyIdx(pts, 12);
  const steps = [{ name: 'المسار المسجل', maneuver: { type: 'depart', location: [pts[0][1], pts[0][0]] }, _idx: 0 }];
  for (let k = 1; k < keep.length - 1; k++) {
    const a = pts[keep[k - 1]], b = pts[keep[k]], c = pts[keep[k + 1]];
    if (hav(a, b) < 15 || hav(b, c) < 15) continue;
    const diff = ((bearing(b, c) - bearing(a, b) + 540) % 360) - 180;
    const ad = Math.abs(diff); if (ad < 30) continue;
    const side = diff > 0 ? 'right' : 'left';
    const modifier = ad > 165 ? 'uturn' : ad > 120 ? 'sharp ' + side : ad > 55 ? side : 'slight ' + side;
    const last = steps[steps.length - 1];
    if (cum[keep[k]] - cum[last._idx] < 25 && last.maneuver.type === 'turn') continue;
    steps.push({ name: '', maneuver: { type: 'turn', modifier, location: [b[1], b[0]] }, _idx: keep[k] });
  }
  steps.push({ name: '', maneuver: { type: 'arrive', location: [pts[pts.length - 1][1], pts[pts.length - 1][0]] }, _idx: pts.length - 1 });
  steps.forEach((s) => { s._at = cum[s._idx]; s._text = instruction(s); });
  const sp = (TRACK_SPEED[mode] || 30) / 3.6;
  return { pts, cum, total, distance: total, duration: total / sp, steps, gap: 0, custom: true };
}
function navTrack(t, reverse) {
  if (!me) { toast('بانتظار تحديد موقعك…'); startLocation(); return; }
  if (navState) endNav(false, true);
  if (directState) endDirect(false);
  hideTrack(); closeSearch();
  const r = trackRoute(t, reverse);
  const end = r.pts[r.pts.length - 1];
  const nameTo = reverse ? 'بداية «' + t.name + '»' : 'نهاية «' + t.name + '»';
  setDestination(end[0], end[1], nameTo, 'مسار مسجّل · ' + fmtDist(r.total), true);
  routeSeq++; routes = {}; routes[mode] = r;
  document.querySelectorAll('.mode b').forEach((b) => { b.textContent = b.dataset.t === mode ? fmtDur(r.duration) : '—'; });
  showRoute(true);
  const off = project(r, [me.lat, me.lng], 0).off;
  if (off > 150) toast('أنت على بعد ' + fmtDist(off) + ' من المسار المسجل — توجّه إليه أولًا', 4500);
}
function trackGpx(t) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mallah Navigator" xmlns="http://www.topografix.com/GPX/1/1">\n'
    + '<trk><name>' + xmlEsc(t.name) + '</name><trkseg>\n'
    + t.pts.map((p) => '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"/>').join('\n')
    + '\n</trkseg></trk>\n</gpx>\n';
}
function renderTracks() {
  $('recStartBtn').textContent = rec ? '⏹ إيقاف التسجيل الحالي' : '⏺ بدء تسجيل مسار جديد';
  const l = $('tracksList');
  if (!tracks.length) { l.innerHTML = '<div class="item"><div class="grow s">لا توجد مسارات مسجلة بعد.</div></div>'; return; }
  l.innerHTML = tracks.map((t, i) => `<div class="item"><div class="grow"><div class="t">${esc(t.name)}</div>
    <div class="s">${fmtDist(t.dist)}${t.dur ? ' · ' + fmtElapsed(t.dur) : ''} · ${new Date(t.date).toLocaleDateString('ar-IQ-u-nu-latn')}</div></div>
    <button class="chip go" data-tnav="${i}">ملاحة</button><button class="chip" data-tmore="${i}">⋯</button></div>`).join('');
  l.querySelectorAll('[data-tnav]').forEach((b) => {
    b.onclick = () => {
      const t = tracks[+b.dataset.tnav];
      actionSheet(t.name, [
        { label: '➡️ من البداية إلى النهاية', fn: () => { $('tracksPanel').classList.add('hidden'); navTrack(t, false); } },
        { label: '⬅️ العودة من النهاية إلى البداية', fn: () => { $('tracksPanel').classList.add('hidden'); navTrack(t, true); } }
      ]);
    };
  });
  l.querySelectorAll('[data-tmore]').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.tmore, t = tracks[i];
      actionSheet(t.name, [
        { label: '🗺 عرض على الخريطة', fn: () => { $('tracksPanel').classList.add('hidden'); showTrack(t); } },
        { label: '💾 حفظ كملف GPX (لمشاركته أو فتحه في Google Earth)', fn: () => saveTextFile(t.name.replace(/[\\/:*?"<>|]/g, '_') + '.gpx', 'application/gpx+xml', trackGpx(t)) },
        { label: '✏️ إعادة التسمية', fn: () => { const n = prompt('الاسم الجديد', t.name); if (n && n.trim()) { t.name = n.trim(); saveTracks(); renderTracks(); } } },
        { label: '🗑 حذف', cls: 'danger', fn: () => { if (confirm('حذف «' + t.name + '»؟')) { tracks.splice(i, 1); saveTracks(); renderTracks(); } } }
      ]);
    };
  });
}
$('openTracks').onclick = () => { $('menuDrop').classList.add('hidden'); renderTracks(); $('tracksPanel').classList.remove('hidden'); };
$('recStartBtn').onclick = () => { if (rec) { if (confirm('إيقاف تسجيل المسار وحفظه؟')) stopRec(); } else { startRec(); $('tracksPanel').classList.add('hidden'); } renderTracks(); };
$('trackImpBtn').onclick = () => $('trackFile').click();
$('trackFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const txt = await readAs(f, 'text');
    const doc = new DOMParser().parseFromString(txt, 'application/xml');
    let pts = [...doc.querySelectorAll('trkpt, rtept')].map((p) => [+p.getAttribute('lat'), +p.getAttribute('lon')]);
    if (!pts.length) doc.querySelectorAll('LineString coordinates').forEach((c) => {
      c.textContent.trim().split(/\s+/).forEach((tok) => { const [lng, lat] = tok.split(',').map(Number); pts.push([lat, lng]); });
    });
    pts = pts.filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (pts.length < 2) throw new Error('لا يوجد مسار في الملف');
    const nm = doc.querySelector('trk > name, rte > name, Placemark > name, Document > name');
    const idx = simplifyIdx(pts, 3);
    const t = { id: Date.now().toString(36), name: nm ? nm.textContent.trim() : f.name.replace(/\.[^.]+$/, ''), date: Date.now(), dur: 0, dist: pathLen(pts), pts: idx.map((i) => [Math.round(pts[i][0] * 1e6) / 1e6, Math.round(pts[i][1] * 1e6) / 1e6]) };
    tracks.unshift(t); if (!saveTracks()) { tracks.shift(); return; }
    renderTracks(); toast('تم استيراد المسار (' + fmtDist(t.dist) + ')');
  } catch (err) { toast('تعذّر استيراد المسار: ' + (err.message || ''), 4500); }
});

/* ================= alert zones (field mode) ================= */
let zones = store.get('zones', []);
const ZT = {
  danger: { ar: 'خطر (H2S / غاز)', icon: '☠️', color: '#dc2626' },
  permit: { ar: 'تتطلب تصريح دخول', icon: '🛂', color: '#d97706' },
  info: { ar: 'تنبيه عام', icon: 'ℹ️', color: '#2563eb' }
};
const zoneLayer = L.layerGroup().addTo(map);
const zoneState = {};   // id -> 'out' | 'near' | 'in'
function saveZones() { store.set('zones', zones); }
function renderZonesOnMap() {
  zoneLayer.clearLayers();
  if (!sitesAllowed()) return;
  zones.forEach((z) => {
    const t = ZT[z.type] || ZT.info;
    L.circle([z.lat, z.lng], { radius: z.r, color: t.color, weight: 2, opacity: z.on ? .9 : .35, fillOpacity: z.on ? .15 : .05, dashArray: z.on ? null : '6 6' })
      .bindTooltip(t.icon + ' ' + z.name, { direction: 'center', className: 'zoneTip' })
      .on('click', () => zoneMenu(z)).addTo(zoneLayer);
  });
}
function zoneMenu(z) {
  if (navState || directState || window.measActive) return;
  const t = ZT[z.type] || ZT.info;
  actionSheet(t.icon + ' ' + z.name + ' — نصف القطر ' + fmtDist(z.r), [
    { label: z.on ? '🔕 إيقاف التنبيه لهذه المنطقة' : '🔔 تشغيل التنبيه', fn: () => { z.on = !z.on; saveZones(); renderZonesOnMap(); renderZones(); } },
    { label: '✏️ إعادة التسمية', fn: () => { const n = prompt('اسم المنطقة', z.name); if (n && n.trim()) { z.name = n.trim(); saveZones(); renderZonesOnMap(); renderZones(); } } },
    { label: '🗑 حذف المنطقة', cls: 'danger', fn: () => { zones = zones.filter((x) => x !== z); delete zoneState[z.id]; saveZones(); renderZonesOnMap(); renderZones(); updateZoneBanner(); } }
  ]);
}
function addZoneAt(lat, lng, defName) {
  actionSheet('نوع منطقة التنبيه', Object.keys(ZT).map((k) => ({
    label: ZT[k].icon + ' ' + ZT[k].ar,
    fn: () => actionSheet('نصف قطر المنطقة', [100, 250, 500, 1000, 2000].map((r) => ({
      label: fmtDist(r),
      fn: () => {
        const n = prompt('اسم المنطقة', defName || ZT[k].ar); if (n == null) return;
        zones.push({ id: Date.now().toString(36), name: n.trim() || ZT[k].ar, type: k, lat, lng, r, on: true });
        saveZones(); renderZonesOnMap(); toast('تمت إضافة منطقة التنبيه'); onOpsLocation();
      }
    })))
  })));
}
function updateZoneBanner() {
  const inside = zones.filter((z) => z.on && zoneState[z.id] === 'in' && sitesAllowed());
  const b = $('zoneBanner');
  if (!inside.length) { b.classList.add('hidden'); return; }
  const z = inside.sort((a, c) => (a.type === 'danger' ? 0 : 1) - (c.type === 'danger' ? 0 : 1))[0], t = ZT[z.type] || ZT.info;
  b.style.background = t.color; b.textContent = t.icon + ' داخل منطقة: ' + z.name + ' — ' + t.ar + (inside.length > 1 ? ' (+' + (inside.length - 1) + ')' : '');
  b.classList.remove('hidden');
}
function checkZones() {
  if (!me || !sitesAllowed()) return;
  zones.forEach((z) => {
    if (!z.on) return;
    const d = hav([me.lat, me.lng], [z.lat, z.lng]) - z.r, prev = zoneState[z.id] || 'out', t = ZT[z.type] || ZT.info;
    let next = prev;
    if (d <= 0) next = 'in';
    else if (prev === 'in') next = d > 30 ? (d <= 200 ? 'near' : 'out') : 'in';
    else if (d <= 200) next = 'near';
    else if (d > 260) next = 'out';
    if (next === prev) return;
    zoneState[z.id] = next;
    if (next === 'in') { say('تحذير: دخلت ' + (z.type === 'danger' ? 'منطقة خطر' : 'منطقة') + ' ' + z.name); vib(z.type === 'danger' ? '600,200,600,200,600' : '400,200,400'); toast(t.icon + ' دخلت منطقة ' + z.name, 5000); }
    else if (next === 'near' && prev === 'out') { say('تنبيه: تقترب من ' + z.name + '، على بعد ' + spokenDist(Math.max(10, d))); vib('250'); toast(t.icon + ' تقترب من منطقة ' + z.name + ' (' + fmtDist(d) + ')', 4500); }
    else if (prev === 'in') { say('خرجت من منطقة ' + z.name); toast('خرجت من منطقة ' + z.name); }
  });
  updateZoneBanner();
}
function renderZones() {
  const l = $('zonesList');
  if (!zones.length) { l.innerHTML = '<div class="item"><div class="grow s">لا توجد مناطق تنبيه بعد.</div></div>'; return; }
  l.innerHTML = zones.map((z, i) => { const t = ZT[z.type] || ZT.info; return `<div class="item"><div style="font-size:20px">${t.icon}</div><div class="grow"><div class="t">${esc(z.name)}</div>
    <div class="s">${t.ar} · ${fmtDist(z.r)} · ${z.on ? '<span class="ok">التنبيه مفعّل</span>' : 'التنبيه متوقف'}</div></div>
    <button class="chip" data-zshow="${i}">عرض</button><button class="chip" data-zmore="${i}">⋯</button></div>`; }).join('');
  l.querySelectorAll('[data-zshow]').forEach((b) => { b.onclick = () => { const z = zones[+b.dataset.zshow]; $('zonesPanel').classList.add('hidden'); setFollow(false); map.fitBounds(L.latLng(z.lat, z.lng).toBounds(z.r * 2.6)); }; });
  l.querySelectorAll('[data-zmore]').forEach((b) => { b.onclick = () => zoneMenu(zones[+b.dataset.zmore]); });
}
$('openZones').onclick = () => { $('menuDrop').classList.add('hidden'); if (!fieldUnlocked && !tryUnlock()) return; renderZones(); $('zonesPanel').classList.remove('hidden'); };
$('zoneHereBtn').onclick = () => { if (!me) { toast('لم يُحدَّد موقعك بعد'); return; } $('zonesPanel').classList.add('hidden'); addZoneAt(me.lat, me.lng); };
$('zoneDestBtn').onclick = () => { if (dest) addZoneAt(dest.lat, dest.lng, dest.name); };

/* ================= site visit log (field mode) ================= */
let visits = store.get('visits', []);
const VS = { ok: '✅ سليم / تم الفحص', maint: '🔧 يحتاج صيانة', fault: '⛔ عطل / متوقف', other: '📝 أخرى' };
function saveVisits() { try { localStorage.setItem('visits', JSON.stringify(visits)); return true; } catch (e) { toast('لا توجد مساحة كافية لحفظ الزيارة'); return false; } }
function siteAt(lat, lng) { return allSites().find((s) => hav([s.lat, s.lng], [lat, lng]) < 3); }
function logVisit(target) {
  if (!target) return;
  if (!me) { toast('لم يُحدَّد موقعك بعد'); startLocation(); return; }
  const dist = hav([me.lat, me.lng], [target.lat, target.lng]);
  if (dist > 100 && !confirm('أنت على بعد ' + fmtDist(dist) + ' من الموقع. هل تريد تسجيل الزيارة رغم ذلك؟')) return;
  const site = siteAt(target.lat, target.lng);
  actionSheet('تسجيل زيارة: ' + target.name, Object.keys(VS).map((k) => ({
    label: VS[k],
    fn: () => {
      const note = prompt('ملاحظة (اختياري)', '');
      if (note == null) return;
      visits.unshift({ id: Date.now().toString(36), site: target.name, set: site ? site.set : '', t: Date.now(), lat: me.lat, lng: me.lng, acc: Math.round(me.acc || 0), dist: Math.round(dist), status: k, note: note.trim() });
      if (!saveVisits()) { visits.shift(); return; }
      toast('تم تسجيل الزيارة ✓'); vib('80');
    }
  })));
}
$('visitBtn').onclick = () => logVisit(dest);
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function visitsCsv() {
  const head = ['Site', 'List', 'Date', 'Time', 'Status', 'Status_AR', 'Note', 'Latitude', 'Longitude', 'GPS_Accuracy_m', 'Distance_from_site_m'];
  const rows = visits.slice().reverse().map((v) => { const d = new Date(v.t); return [v.site, v.set, stamp(d), hhmm(d), v.status, VS[v.status].replace(/^\S+\s/, ''), v.note, v.lat.toFixed(6), v.lng.toFixed(6), v.acc, v.dist]; });
  return [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function renderVisits() {
  const l = $('visitsList');
  $('visitsCount').textContent = visits.length ? visits.length + ' زيارة مسجلة' : 'لا توجد زيارات بعد';
  l.innerHTML = visits.slice(0, 200).map((v, i) => { const d = new Date(v.t); return `<div class="item"><div style="font-size:20px">${VS[v.status].split(' ')[0]}</div>
    <div class="grow"><div class="t">${esc(v.site)}</div><div class="s">${stamp(d)} ${hhmm(d)} · ${esc(VS[v.status].replace(/^\S+\s/, ''))}${v.note ? ' · ' + esc(v.note) : ''}${v.dist > 100 ? ' · <span class="warnTxt">على بعد ' + fmtDist(v.dist) + '</span>' : ''}</div></div>
    <button class="chip del" data-vrm="${i}">حذف</button></div>`; }).join('');
  l.querySelectorAll('[data-vrm]').forEach((b) => { b.onclick = () => { if (confirm('حذف هذه الزيارة؟')) { visits.splice(+b.dataset.vrm, 1); saveVisits(); renderVisits(); } }; });
}
$('openVisits').onclick = () => { $('menuDrop').classList.add('hidden'); if (!fieldUnlocked && !tryUnlock()) return; renderVisits(); $('visitsPanel').classList.remove('hidden'); };
$('visitsExport').onclick = () => { if (!visits.length) { toast('لا توجد زيارات لتصديرها'); return; } saveTextFile('زيارات-' + stamp(new Date()) + '.csv', 'text/csv', visitsCsv()); };
$('visitsClear').onclick = () => { if (visits.length && confirm('حذف كل الزيارات المسجلة؟ صدّرها أولًا إذا كنت تحتاجها.')) { visits = []; saveVisits(); renderVisits(); } };

/* arrival at a work site → offer to log a visit */
window.onArrived = function (at) {
  if (!at || !sitesAllowed() || !siteAt(at.lat, at.lng)) return;
  setTimeout(() => actionSheet('وصلت إلى ' + at.name, [{ label: '✅ تسجيل زيارة الآن', fn: () => logVisit(at) }]), 800);
};

/* ================= links: geo: and mallah:// ================= */
window.handleLink = function (url) {
  try {
    let lat, lng, name = 'موقع مُرسَل', direct = false;
    url = decodeURIComponent(String(url));
    if (/^geo:/i.test(url)) {
      const m = url.match(/^geo:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i);
      const q = url.match(/[?&]q=([^&]+)/i);
      if (q) {
        const qc = q[1].match(/^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:\((.*)\))?/);
        if (qc) { lat = +qc[1]; lng = +qc[2]; if (qc[3]) name = qc[3]; }
        else if (!(m && (+m[1] || +m[2]))) { qEl.value = q[1].replace(/\+/g, ' '); $('searchBar').requestSubmit(); return; }
      }
      if (lat == null && m) { lat = +m[1]; lng = +m[2]; }
    } else if (/^mallah:/i.test(url)) {
      const p = new URLSearchParams(url.replace(/^mallah:\/*[^?]*\??/i, ''));
      lat = parseFloat(p.get('lat')); lng = parseFloat(p.get('lng') || p.get('lon'));
      if (p.get('name')) name = p.get('name');
      direct = p.get('mode') === 'direct';
      if (!isFinite(lat) && p.get('site')) { const h = searchSites(p.get('site')); if (h[0]) { openSite(h[0]); return; } }
    }
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) { toast('رابط موقع غير صالح'); return; }
    if (navState) endNav(false, true); if (directState) endDirect(false);
    setDestination(lat, lng, name, fmtCoord(lat, lng), true);
    if (direct && me) startDirect({ lat, lng, name });
  } catch (e) { toast('تعذّر فتح الرابط'); }
};

/* ================= hooks ================= */
window.onOpsLocation = function () {
  if (rec) { recPoint(); keepGps(); }
  checkZones();
};
window.opsFieldChanged = function () {
  ['zoneDestBtn', 'visitBtn'].forEach((id) => $(id).classList.toggle('hidden', !fset.field));
  renderZonesOnMap(); updateZoneBanner();
};
function opsHandleBack() {
  for (const id of ['tracksPanel', 'zonesPanel', 'visitsPanel']) if (!$(id).classList.contains('hidden')) { $(id).classList.add('hidden'); return true; }
  return false;
}

/* ================= init ================= */
opsFieldChanged();
if (rec) { drawRec(); renderRecBar(); keepGps(); setTimeout(() => toast('يستمر تسجيل المسار من الجلسة السابقة', 4000), 1500); }
if (NATIVE && Android.getLaunchLink) { const l = Android.getLaunchLink(); if (l) setTimeout(() => handleLink(l), 600); }
