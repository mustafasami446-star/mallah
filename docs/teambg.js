'use strict';
/* الملاح — الفريق (المرحلة 3): المشاركة في الخلفية (والشاشة مطفأة أو البرنامج مغلق) مع إشعار ثابت،
   إشعارات الرسائل والاستغاثة، ورسائل SMS الاحتياطية عند انقطاع الإنترنت. Android app only: the
   native TeamService does the work; this file keeps it in step with the page. */

const BG_OK = NATIVE && typeof Android !== 'undefined' && !!Android.teamStart;
let teamBg = store.get('teamBg', true), teamSms = store.get('teamSms', { on: false, to: '' });
let bgHash = '', bgAsked = store.get('teamBgAsked', false);

async function rawKeyB64(code) { return b64(await sha('mallah-key|' + code.replace(/-/g, ''))); }
function bgWanted() { return BG_OK && team && !teamPaused && teamBg; }
async function bgSync(force) {
  if (!BG_OK) return;
  let running = false; try { running = Android.teamRunning(); } catch (e) {}
  if (!bgWanted()) { if (running) { try { Android.teamStop(); } catch (e) {} } bgHash = ''; return; }
  if (document.visibilityState !== 'visible' || !fbAuth) return;     // Android only allows starting it from the screen
  await fbDb();
  const cfg = { db: TEAM_FB.db, apiKey: TEAM_FB.apiKey, gid: team.gid, key: await rawKeyB64(team.code), uid: fbAuth.uid, refresh: fbAuth.refresh,
    name: team.me.n, color: team.me.c, group: teamView.name || team.name || '', sos: teamSos || 0, smsOn: !!(teamSms.on && teamSms.to), smsTo: teamSms.to || '' };
  const h = JSON.stringify(cfg);
  if (!force && running && h === bgHash) return;
  bgHash = h;
  try { Android.teamStart(h); } catch (e) {}
}
setInterval(() => bgSync(false), 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !BG_OK) return;
  let ev = null; try { ev = Android.teamTakeEvent(); } catch (e) {}
  if (ev === 'paused' && team) { teamPaused = true; store.set('teamPaused', true); renderTeam(); toast('✋ أوقفتَ مشاركة موقعك من الإشعار'); }
  bgSync(false);
});
window.onTeamBg = (ok, msg) => { if (!ok) toast('تعذّر تشغيل المشاركة في الخلفية: ' + msg, 5000); };
window.onTeamPerms = (r) => {
  if (r && r['android.permission.POST_NOTIFICATIONS'] === false) toast('بدون إذن الإشعارات لن تصلك رسائل الفريق والبرنامج مغلق', 5000);
  if (r && r['android.permission.SEND_SMS'] === false) { teamSms.on = false; store.set('teamSms', teamSms); toast('لم يُمنح إذن إرسال الرسائل (SMS)', 4000); }
  renderTeam(); bgSync(true);
};

/* the page shares by itself only while the background service is not doing it */
const _publishBg = teamPublish;
teamPublish = function (force) {
  if (BG_OK) { try { if (Android.teamRunning()) return; } catch (e) {} }
  return _publishBg(force);
};
/* first time in a group: ask for notifications (Android 13+) */
const _openBg = teamOpen;
teamOpen = async function () {
  const r = await _openBg.apply(this, arguments);
  if (BG_OK && !bgAsked) { bgAsked = true; store.set('teamBgAsked', true); try { Android.teamPerms(false); } catch (e) {} }
  bgSync(true);
  return r;
};
/* help: also by SMS to the emergency numbers, right away, internet or not */
const _sosBg = teamSosSet;
teamSosSet = async function (on) {
  const r = await _sosBg(on);
  bgSync(true);
  if (on && BG_OK && teamSms.on && teamSms.to && me) {
    const ll = me.lat.toFixed(6) + ',' + me.lng.toFixed(6);
    const ok = Android.teamSms(teamSms.to, '🆘 الملاح — ' + team.me.n + ' يطلب المساعدة! موقعي: https://maps.google.com/?q=' + ll + ' (± ' + Math.round(me.acc || 0) + ' م)');
    toast(ok ? '✉️ أُرسل طلب المساعدة أيضًا برسالة SMS' : 'تعذّر إرسال SMS', 4000);
  }
  return r;
};
const _leaveBg = teamLeave;
teamLeave = async function () { const r = await _leaveBg(); bgSync(true); return r; };

/* ---------------- the settings card in the team panel ---------------- */
const _renderBg = renderTeam;
renderTeam = function () {
  _renderBg();
  const body = $('teamBody');
  if (!team || !body || $('teamPanel').classList.contains('hidden') || teamTab !== 'members') return;
  const card = document.createElement('div'); card.className = 'card';
  if (!BG_OK) {
    card.innerHTML = '<h3>📡 المشاركة في الخلفية</h3><div class="item"><div class="grow s">متاحة في تطبيق أندرويد فقط. في نسخة الويب (الآيفون واللابتوب) يُشارَك موقعك والصفحة مفتوحة على الشاشة.</div></div>';
  } else {
    let run = false; try { run = Android.teamRunning(); } catch (e) {}
    const st = teamPaused ? '✋ مشاركتك متوقفة' : !teamBg ? 'متوقفة — يُشارَك موقعك والبرنامج مفتوح فقط' : run ? '<span class="ok">● تعمل</span> — يصل موقعك للفريق والشاشة مطفأة أو البرنامج مغلق' : 'جارٍ التشغيل…';
    card.innerHTML = `<h3>📡 المشاركة في الخلفية</h3>
      <div class="item"><div class="grow"><div class="s">${st}</div></div><button class="chip ${teamBg ? '' : 'go'}" id="tmBgT">${teamBg ? 'إيقافها' : 'تشغيلها'}</button></div>
      <div class="s" style="padding:0 14px 10px;color:var(--muted);line-height:1.7">يظهر إشعار ثابت «الملاح يشارك موقعك» ومنه يمكنك الإيقاف. يُرسَل موقعك كل 15 ثانية أثناء الحركة وكل دقيقتين عند التوقف، وتصلك إشعارات الرسائل والاستغاثة. في بعض الهواتف (مثل Infinix وTecno) فعّل «السماح بالعمل في الخلفية» للملاح من إعدادات البطارية.</div>
      <h3>✉️ رسائل SMS الاحتياطية</h3>
      <div class="frm"><label>رقم أو أرقام الطوارئ (افصل بينها بفاصلة)</label><input type="text" id="tmSmsTo" dir="ltr" inputmode="tel" placeholder="07XXXXXXXXX" value="${esc(teamSms.to || '')}"></div>
      <div class="item"><div class="grow s">${teamSms.on && teamSms.to ? '<span class="ok">● مفعّلة</span> — ' : ''}إذا انقطع الإنترنت 10 دقائق يُرسَل موقعك برسالة SMS كل 15 دقيقة، وعند الاستغاثة تُرسل رسالة فورًا (من رصيدك).</div></div>
      <div class="btnRow"><button class="chip ${teamSms.on ? '' : 'go'}" id="tmSmsT">${teamSms.on ? 'إيقاف الرسائل' : 'تفعيل الرسائل'}</button><button class="chip" id="tmSmsTest">إرسال رسالة تجربة</button></div>`;
  }
  const cards = body.querySelectorAll('.card'); body.insertBefore(card, cards[cards.length - 1] || null);
  if (!BG_OK) return;
  $('tmBgT').onclick = () => { teamBg = !teamBg; store.set('teamBg', teamBg); if (teamBg) { try { Android.teamPerms(false); } catch (e) {} } bgSync(true); setTimeout(renderTeam, 700); };
  const saveTo = () => { teamSms.to = ($('tmSmsTo').value || '').trim(); store.set('teamSms', teamSms); };
  $('tmSmsTo').onchange = () => { saveTo(); bgSync(true); };
  $('tmSmsT').onclick = () => {
    saveTo();
    if (!teamSms.on && !teamSms.to) { toast('اكتب رقم الطوارئ أولًا'); $('tmSmsTo').focus(); return; }
    teamSms.on = !teamSms.on; store.set('teamSms', teamSms);
    if (teamSms.on && !Android.teamCanSms()) Android.teamPerms(true);
    bgSync(true); renderTeam();
  };
  $('tmSmsTest').onclick = () => {
    saveTo();
    if (!teamSms.to) { toast('اكتب رقم الطوارئ أولًا'); return; }
    if (!Android.teamCanSms()) { Android.teamPerms(true); return; }
    const ll = me ? me.lat.toFixed(6) + ',' + me.lng.toFixed(6) : '';
    const ok = Android.teamSms(teamSms.to, '✉️ رسالة تجربة من الملاح — ' + team.me.n + (ll ? ': https://maps.google.com/?q=' + ll : ''));
    toast(ok ? '✓ أُرسلت رسالة التجربة' : 'تعذّر الإرسال', 3000);
  };
};
// the team panel text about sharing only while open is outdated on Android
if (BG_OK) setTimeout(() => bgSync(false), 2500);
