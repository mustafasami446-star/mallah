'use strict';
/* الملاح — بلاغات على طريقك المعتاد: إذا حفظتَ البيت والعمل، يعرف الملاح طريقك بينهما، وحين تفتحه وأنت في البيت
   (أو في العمل) ينظر في بلاغات الناس على ذلك الطريق — حادث، زحام، سيطرة، طريق مغلق، مياه — ويخبرك قبل خروجك. */

const CM_KINDS = ['acc', 'jam', 'closed', 'chk', 'water'];
let cmOn = store.get('cmAlerts', true);
let cmSaid = new Set(store.get('cmSaid', []));
function cmEnds() {
  const home = favs.find((f) => f.kind === 'home'), work = favs.find((f) => f.kind === 'work');
  return home && work ? { home, work } : null;
}
/* the road between home and work, kept for a week: points every ~150 m */
async function cmRoute(from, to, key) {
  const c = store.get('cmRoute', null);
  if (c && c.key === key && Date.now() - c.t < 7 * 86400e3) return c.pts;
  const r = await fetchRoute('car', [from.lat, from.lng], [to.lat, to.lng]);
  const pts = [];
  for (let k = 0, next = 0; k < r.pts.length; k++) if (r.cum[k] >= next) { pts.push([+r.pts[k][0].toFixed(5), +r.pts[k][1].toFixed(5)]); next = r.cum[k] + 150; }
  pts.push(r.pts[r.pts.length - 1]);
  store.set('cmRoute', { key, t: Date.now(), pts });
  return pts;
}
async function cmCheck(manual) {
  if (!cmOn && !manual) return;
  const E = cmEnds(); if (!E) { if (manual) toast('احفظ البيت والعمل أولًا من «أضف البيت» و«أضف العمل»'); return; }
  if (!manual && (!me || typeof rptLoad !== 'function')) return;
  // which way: from where you are now
  let from = E.home, to = E.work, toWord = 'العمل';
  if (me && hav([me.lat, me.lng], [E.work.lat, E.work.lng]) < 1200) { from = E.work; to = E.home; toWord = 'البيت'; }
  else if (!manual && (!me || hav([me.lat, me.lng], [E.home.lat, E.home.lng]) > 1200)) return;   // away from both: not now
  const key = [E.home.lat, E.home.lng, E.work.lat, E.work.lng].map((v) => v.toFixed(4)).join(',');
  let pts;
  try { pts = await cmRoute(E.home, E.work, key); } catch (e) { if (manual) toast('تعذّر حساب الطريق بين البيت والعمل'); return; }
  const cells = [...new Set(pts.map((p) => rptCell(p[0], p[1])))];
  for (let i = 0; i < cells.length; i += 12) await rptLoad(cells.slice(i, i + 12), manual);
  // the reports within ~150 m of the road, nearest to the start first
  const hits = [];
  Object.values(rpts).forEach((r) => {
    if (!CM_KINDS.includes(r.k) || !rptAlive(r)) return;
    let bi = -1;
    for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i][0] - r.lat) < 0.003 && Math.abs(pts[i][1] - r.lng) < 0.003 && hav(pts[i], [r.lat, r.lng]) < 150) { bi = i; break; }
    if (bi >= 0) hits.push({ r, at: from === E.home ? bi : pts.length - 1 - bi });
  });
  hits.sort((a, b) => a.at - b.at);
  const fresh = manual ? hits : hits.filter((h) => !cmSaid.has(h.r.id));
  if (!fresh.length) { if (manual) toast('✅ لا بلاغات على طريقك إلى ' + toWord + ' الآن', 3500); return; }
  fresh.forEach((h) => cmSaid.add(h.r.id)); store.set('cmSaid', [...cmSaid].slice(-200));
  const lines = fresh.slice(0, 3).map((h) => `${RPT[h.r.k].ic} ${RPT[h.r.k].ar} بعد نحو ${fmtDist(Math.max(100, h.at * 150))} من ${toWord === 'العمل' ? 'البيت' : 'العمل'} · ${rptAgo(h.r.t)}`);
  const first = fresh[0].r;
  routeNote(`<div><b>⚠️ على طريقك إلى ${toWord}:</b></div>` + lines.map((l) => '<div>' + l + '</div>').join('') + (fresh.length > 3 ? `<div class="s">و${fresh.length - 3} بلاغات أخرى</div>` : ''),
    [['📍 أرني', () => { if (typeof setFollow === 'function') setFollow(false); map.setView([first.lat, first.lng], 16); rptRefresh && rptRefresh(true); }],
     ['🧭 الطريق إلى ' + toWord, () => setDestination(to.lat, to.lng, toWord === 'العمل' ? (KIND_AR.work || 'العمل') : (KIND_AR.home || 'البيت'), '')]], 30000);
  if (!manual) { try { Android.vibrate && Android.vibrate('80,60,80'); } catch (e) {} say('تنبيه. على طريقك إلى ' + toWord + ' ' + RPT[first.k].ar); }
}
// when the app opens, and every ten minutes while it is open
setTimeout(() => cmCheck(false), 12000);
setInterval(() => cmCheck(false), 10 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => cmCheck(false), 4000); });

/* the switch, with the morning summary's choices (menu ☰ ← ☀️) */
{
  const _ms = mornSheet;
  mornSheet = async function () {
    await _ms();
    const box = $('mBtns'), cancel = box && box.querySelector('.cancel'); if (!cancel) return;
    const add = (html, fn) => { const b = document.createElement('button'); b.innerHTML = html; b.onclick = () => { closeModal(); fn(); }; cancel.before(b); };
    add(cmOn ? '⚠️ تنبيه البلاغات على طريق العمل: يعمل — إيقاف' : '⚠️ تشغيل تنبيه البلاغات على طريق العمل', () => { cmOn = !cmOn; store.set('cmAlerts', cmOn); toast(cmOn ? 'ستُنبَّه بالبلاغات على طريقك بين البيت والعمل' : 'أوقفتَ تنبيه البلاغات على طريق العمل'); });
    add('🔎 افحص طريقي إلى العمل الآن', () => cmCheck(true));
  };
}
