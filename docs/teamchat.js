'use strict';
/* الملاح — الفريق (المرحلة 2): المحادثة والرسائل السريعة، إرسال موقع، زر الاستغاثة، تنبيهات الابتعاد
   والتوقّف وانقطاع الاتصال، والعلامات المشتركة على الخريطة. Everything is encrypted like positions. */

const QUICK = ['👍 أنا بخير', '✋ توقفت', '⏳ انتظروني', '🚗 عطل في السيارة', '✅ وصلت', '⛽ أحتاج وقودًا'];
const MARK_KINDS = { closed: ['⛔', 'طريق مغلق'], hole: ['🕳', 'حفرة / طريق سيئ'], check: ['🛂', 'نقطة تفتيش'], site: ['🛢', 'موقع العمل'], water: ['💧', 'ماء'], other: ['📌', 'علامة'] };
const ALERT_DEF = { far: 3, stop: 20, lost: 30 };          // km from the group · minutes stopped · minutes without signal
let teamTab = 'members', chatCache = {}, chatSeen = store.get('teamChatSeen', 0), outbox = store.get('teamOutbox', []);
let chatFirst = true, sosSeen = {}, alertSeen = {}, moveTrack = {};
const markLayer = L.layerGroup().addTo(map);

/* ---------------- decoding the extra parts of the group ---------------- */
async function teamDecodeMore() {
  const chat = [];
  for (const [id, m] of Object.entries(teamTree.chat || {})) {
    if (!m || !m.e) continue;
    if (!chatCache[id]) { const v = await dec(m.e); if (!v) continue; chatCache[id] = Object.assign(v, { id, u: m.u, t: m.t || v.t || 0 }); }
    chat.push(chatCache[id]);
  }
  chat.sort((a, b) => a.t - b.t);
  const marks = [];
  for (const [id, m] of Object.entries(teamTree.marks || {})) { if (m && m.e) { const v = await dec(m.e); if (v) marks.push(Object.assign(v, { id })); } }
  const cfg = teamTree.cfg && teamTree.cfg.e ? await dec(teamTree.cfg.e) : null;
  return { chat, marks, cfg };
}
const myUid = () => fbAuth && fbAuth.uid;
function alertCfg() { return Object.assign({}, ALERT_DEF, teamView.cfg || {}); }

/* ---------------- after every update: new messages, help calls, alerts ---------------- */
function teamAfterDecode() {
  const chat = teamView.chat || [];
  // new messages from others
  const fresh = chat.filter((m) => m.t > chatSeen && m.u !== myUid());
  if (!chatFirst && fresh.length) {
    const last = fresh[fresh.length - 1];
    const open = !$('teamPanel').classList.contains('hidden') && teamTab === 'chat';
    if (!open && last.k !== 'sos') { toast('💬 ' + last.n + ': ' + msgText(last), 4000); beep(1); try { Android.vibrate && Android.vibrate('80'); } catch (e) {} }
  }
  chatFirst = false;
  // help calls (SOS stays on the member until they cancel it)
  Object.values(teamView.members).forEach((m) => {
    if (m.uid === myUid()) return;
    if (m.sos && sosSeen[m.uid] !== m.sos) { sosSeen[m.uid] = m.sos; sosAlarm(m); }
    if (!m.sos) delete sosSeen[m.uid];
  });
  drawSosBar(); drawMarks(); flushOutbox();
}
function msgText(m) {
  if (m.k === 'loc') return '📍 ' + (m.x || 'أرسل موقعًا');
  if (m.k === 'sos') return '🆘 يطلب المساعدة';
  if (m.k === 'sosoff') return '✅ ألغى طلب المساعدة';
  if (m.k === 'mark') return '📌 أضاف علامة: ' + (m.x || '');
  return m.x || '';
}

/* ---------------- sounds ---------------- */
let actx = null;
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === 2 ? [880, 660, 880, 660, 880, 660] : [740, 990];
    tones.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = kind === 2 ? 'square' : 'sine';
      g.gain.setValueAtTime(kind === 2 ? 0.25 : 0.12, actx.currentTime + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + i * 0.22 + 0.2);
      o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + i * 0.22); o.stop(actx.currentTime + i * 0.22 + 0.21);
    });
  } catch (e) {}
}

/* ---------------- sending (kept and retried when the internet is down) ---------------- */
async function teamSend(msg) {
  if (!team) return;
  const item = { e: await enc(Object.assign({ n: team.me.n, c: team.me.c, t: Date.now() }, msg)), u: myUid(), t: { '.sv': 'timestamp' } };
  outbox.push(item); store.set('teamOutbox', outbox);
  chatSeen = Date.now(); store.set('teamChatSeen', chatSeen);
  await flushOutbox();
  if (outbox.length) toast('📤 ستُرسل الرسالة عند عودة الإنترنت');
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !outbox.length || !team || navigator.onLine === false) return;
  flushing = true;
  try {
    while (outbox.length) {
      const it = outbox[0]; it.u = myUid();
      await fbReq('POST', '/groups/' + team.gid + '/chat', it);
      outbox.shift(); store.set('teamOutbox', outbox);
    }
    if (team && teamTab === 'chat' && !$('teamPanel').classList.contains('hidden')) renderTeam();
  } catch (e) { /* try again later */ } finally { flushing = false; }
}
setInterval(flushOutbox, 15000);

/* ---------------- help (SOS) ---------------- */
function teamSosAsk() {
  if (teamSos) { actionSheet('إلغاء طلب المساعدة؟', [{ label: '✅ أنا بخير — ألغِ الطلب', fn: () => teamSosSet(false) }]); return; }
  actionSheet('🆘 إرسال طلب مساعدة لكل الفريق مع موقعك؟ سيسمعون تنبيهًا قويًا حتى تلغيه.', [{ label: '🆘 أرسل طلب المساعدة', cls: 'danger', fn: () => teamSosSet(true) }]);
}
async function teamSosSet(on) {
  teamSos = on ? Date.now() : null; store.set('teamSos', teamSos);
  teamPublish(true);
  await teamSend(on ? { k: 'sos', lat: me && me.lat, lng: me && me.lng } : { k: 'sosoff' });
  toast(on ? '🆘 أُرسل طلب المساعدة' : '✓ أُلغي طلب المساعدة');
  renderTeam();
}
function sosAlarm(m) {
  beep(2); setTimeout(() => beep(2), 1600);
  try { Android.vibrate && Android.vibrate('600,200,600,200,600'); } catch (e) {}
  try { if (typeof speak === 'function') speak('تنبيه. ' + m.n + ' يطلب المساعدة'); } catch (e) {}
  actionSheet('🆘 ' + m.n + ' يطلب المساعدة' + (me ? ' — على بُعد ' + fmtDist(hav([me.lat, me.lng], [m.lat, m.lng])) : ''), [
    { label: '🧭 اذهب إليه الآن', fn: () => teamGo({ lat: m.lat, lng: m.lng, n: m.n }, m.uid) },
    { label: '🗺 عرضه على الخريطة', fn: () => map.setView([m.lat, m.lng], 16) }]);
}
function drawSosBar() {
  let el = $('sosBar');
  const list = Object.values(teamView.members || {}).filter((m) => m.sos && m.uid !== myUid());
  if (!list.length || !team) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('button'); el.id = 'sosBar'; document.body.appendChild(el); }
  const m = list[0];
  el.innerHTML = '🆘 ' + esc(m.n) + ' يطلب المساعدة' + (me ? ' · ' + fmtDist(hav([me.lat, me.lng], [m.lat, m.lng])) : '') + ' — اضغط للذهاب';
  el.onclick = () => teamGo({ lat: m.lat, lng: m.lng, n: m.n }, m.uid);
}

/* ---------------- alerts: far from the group, stopped, no signal ---------------- */
function checkAlerts() {
  if (!team || !teamView.members) return;
  const cfg = alertCfg(), now = Date.now(), all = Object.values(teamView.members).filter((m) => isFinite(m.lat));
  if (all.length < 2) return;
  const say = (key, txt, m) => {
    if (alertSeen[key] && now - alertSeen[key] < 15 * 60000) return;
    alertSeen[key] = now;
    beep(1);
    actionSheet('⚠️ ' + txt, [{ label: '🧭 اذهب إليه', fn: () => teamGo({ lat: m.lat, lng: m.lng, n: m.n }, m.uid) }, { label: '🗺 عرضه على الخريطة', fn: () => map.setView([m.lat, m.lng], 15) }]);
  };
  all.forEach((m) => {
    if (m.uid === myUid() || m.sos) return;
    // far: distance to the nearest other member
    if (cfg.far > 0) {
      let near = Infinity;
      all.forEach((o) => { if (o.uid !== m.uid && now - (o.t || 0) < cfg.lost * 60000) near = Math.min(near, hav([m.lat, m.lng], [o.lat, o.lng])); });
      if (near !== Infinity && near > cfg.far * 1000) say('far' + m.uid, m.n + ' ابتعد ' + fmtDist(near) + ' عن أقرب زميل', m);
    }
    // stopped: has not moved 50 m for a while (while still sending)
    const tr = moveTrack[m.uid];
    if (!tr || hav([tr.lat, tr.lng], [m.lat, m.lng]) > 50) moveTrack[m.uid] = { lat: m.lat, lng: m.lng, t: now };
    else if (cfg.stop > 0 && now - (m.t || 0) < 3 * 60000 && now - tr.t > cfg.stop * 60000) say('stop' + m.uid + tr.t, m.n + ' متوقّف منذ ' + Math.round((now - tr.t) / 60000) + ' دقيقة', m);
    // no signal
    if (cfg.lost > 0 && now - (m.t || 0) > cfg.lost * 60000 && now - (m.t || 0) < 12 * 3600000) say('lost' + m.uid + m.t, 'انقطع اتصال ' + m.n + ' منذ ' + Math.round((now - m.t) / 60000) + ' دقيقة — آخر موقع معروف على الخريطة', m);
  });
}
setInterval(checkAlerts, 30000);
function alertSettings() {
  const c = alertCfg();
  const opt = (vals, cur, unit) => vals.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v ? v + ' ' + unit : 'متوقف'}</option>`).join('');
  const old = $('alBox'); if (old) old.remove();
  const box = document.createElement('div'); box.id = 'alBox';
  box.innerHTML = `<div class="frm"><label>نبّهني إذا ابتعد عضو عن أقرب زميل أكثر من</label><select id="alFar">${opt([0, 1, 2, 3, 5, 10, 20], c.far, 'كم')}</select>
    <label>إذا توقّف عضو عن الحركة أكثر من</label><select id="alStop">${opt([0, 10, 20, 30, 60], c.stop, 'دقيقة')}</select>
    <label>إذا انقطع اتصال عضو أكثر من</label><select id="alLost">${opt([0, 15, 30, 60, 120], c.lost, 'دقيقة')}</select></div>`;
  actionSheet('⚙️ تنبيهات الفريق — تصل كل الأعضاء', [{ label: '✓ حفظ للجميع', fn: async () => {
    const v = { far: +box.querySelector('#alFar').value, stop: +box.querySelector('#alStop').value, lost: +box.querySelector('#alLost').value };
    try { await fbReq('PUT', '/groups/' + team.gid + '/cfg', { e: await enc(v) }); toast('✓ حُفظت التنبيهات'); } catch (e) { teamFail(e); }
  } }]);
  $('mTitle').after(box);
}
{ const _cm = closeModal; closeModal = function () { const b = $('alBox'); if (b) b.remove(); return _cm.apply(this, arguments); }; }

/* ---------------- shared marks ---------------- */
function drawMarks() {
  markLayer.clearLayers();
  if (!team) return;
  (teamView.marks || []).forEach((k) => {
    const [ic, nm] = MARK_KINDS[k.k] || MARK_KINDS.other;
    L.marker([k.lat, k.lng], { zIndexOffset: 600, icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="tmMark">${ic}<span>${esc(k.x || nm)}</span></div>` }) })
      .on('click', () => actionSheet(ic + ' ' + (k.x || nm) + (k.byN ? ' — أضافها ' + k.byN : '') + ' · ' + ago(k.t), [
        { label: '🧭 اذهب إليها', fn: () => teamGo({ lat: k.lat, lng: k.lng, n: k.x || nm }) },
        { label: '🗑 حذف العلامة للجميع', cls: 'danger', fn: async () => { try { await fbReq('DELETE', '/groups/' + team.gid + '/marks/' + k.id); } catch (e) { teamFail(e); } } }])).addTo(markLayer);
  });
}
function teamMarkAsk(lat, lng) {
  actionSheet('📌 علامة يراها كل الفريق في هذا المكان', Object.entries(MARK_KINDS).map(([k, [ic, nm]]) => ({ label: ic + ' ' + nm, fn: async () => {
    const r = { k, x: nm, lat: +lat.toFixed(6), lng: +lng.toFixed(6), by: myUid(), byN: team.me.n, t: Date.now() };
    try { await fbReq('POST', '/groups/' + team.gid + '/marks', { e: await enc(r) }); teamSend({ k: 'mark', x: nm, lat: r.lat, lng: r.lng }); toast('✓ أُضيفت العلامة للفريق'); } catch (e) { teamFail(e); }
  } })));
}
// in the destination sheet (long-press anywhere): «علامة للفريق»
{
  const acts = document.querySelector('#sheet .acts');
  if (acts) {
    const b = document.createElement('button'); b.className = 'chip hidden'; b.id = 'teamMarkBtn'; b.textContent = '📌 علامة للفريق';
    b.onclick = () => { if (dest) teamMarkAsk(dest.lat, dest.lng); };
    acts.appendChild(b);
    const _sd = setDestination;
    setDestination = function () { const r = _sd.apply(this, arguments); b.classList.toggle('hidden', !team); return r; };
  }
}

/* ---------------- the chat view ---------------- */
function renderTeamChat(body) {
  const chat = teamView.chat || [], mine = myUid();
  const rows = chat.slice(-150).map((m) => {
    const me_ = m.u === mine, time = new Date(m.t).toLocaleTimeString('ar-IQ', { hour: 'numeric', minute: '2-digit' });
    const loc = (m.k === 'loc' || m.k === 'sos' || m.k === 'mark') && isFinite(m.lat) ? `<button class="chip tmLoc" data-lat="${m.lat}" data-lng="${m.lng}" data-n="${esc(m.n)}">🧭 اذهب إلى الموقع</button>` : '';
    return `<div class="tmMsg${me_ ? ' mine' : ''}${m.k === 'sos' ? ' sos' : ''}"><div class="tmWho" style="color:${m.c}">${me_ ? 'أنت' : esc(m.n)} · ${time}</div><div class="tmTxt">${esc(msgText(m))}</div>${loc}</div>`;
  }).join('') || '<div class="tmEmpty">لا رسائل بعد — اكتب أول رسالة للفريق</div>';
  body.innerHTML = `<div class="tmChat" id="tmChat">${rows}${outbox.length ? `<div class="tmEmpty">📤 ${outbox.length} بانتظار الإنترنت</div>` : ''}</div>
    <div class="tmQuick">${QUICK.map((q, i) => `<button class="chip" data-q="${i}">${q}</button>`).join('')}</div>
    <form class="tmSend" id="tmSend"><button type="button" class="iconBtn" id="tmLocBtn" title="أرسل موقعي">📍</button><input type="text" id="tmText" maxlength="400" placeholder="اكتب رسالة للفريق…" autocomplete="off"><button class="chip go" type="submit">إرسال</button></form>`;
  const box = $('tmChat'); box.scrollTop = box.scrollHeight;
  body.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => teamSend({ k: 'q', x: QUICK[+b.dataset.q] }); });
  body.querySelectorAll('.tmLoc').forEach((b) => { b.onclick = () => teamGo({ lat: +b.dataset.lat, lng: +b.dataset.lng, n: 'موقع ' + b.dataset.n }); });
  $('tmLocBtn').onclick = () => { if (!me) { toast('بانتظار تحديد موقعك'); return; } teamSend({ k: 'loc', x: 'موقعي الآن', lat: +me.lat.toFixed(6), lng: +me.lng.toFixed(6) }); };
  $('tmSend').onsubmit = (e) => { e.preventDefault(); const t = $('tmText').value.trim(); if (!t) return; $('tmText').value = ''; teamSend({ k: 'txt', x: t }); };
  chatSeen = Math.max(chatSeen, chat.length ? chat[chat.length - 1].t : 0); store.set('teamChatSeen', chatSeen);
}
function unread() { return (teamView.chat || []).filter((m) => m.t > chatSeen && m.u !== myUid()).length; }

/* ---------------- plugging into the team panel ---------------- */
const _renderTeam2 = renderTeam;
renderTeam = function () {
  const body = $('teamBody'), open = body && !$('teamPanel').classList.contains('hidden');
  // keep what is being typed when an update arrives
  const typing = open && teamTab === 'chat' && $('tmText') ? $('tmText').value : null, focused = typing != null && document.activeElement === $('tmText');
  if (team && open && teamTab === 'chat') { drawTeam(); renderTeamChat(body); }
  else _renderTeam2();
  // badge: unread messages first, otherwise how many are online
  const fab = $('teamBtn'), bd = fab && fab.querySelector('em'), u = team ? unread() : 0;
  if (bd && u) { bd.textContent = '💬' + u; bd.classList.remove('hidden'); bd.classList.add('msg'); } else if (bd) bd.classList.remove('msg');
  if (!team || !open) return;
  // tabs + help + alerts, above the rest
  const head = document.createElement('div'); head.className = 'tmTabs';
  head.innerHTML = `<button data-tab="members" class="${teamTab === 'members' ? 'on' : ''}">👥 الأعضاء</button><button data-tab="chat" class="${teamTab === 'chat' ? 'on' : ''}">💬 المحادثة${u ? ' <b>' + u + '</b>' : ''}</button><button class="sosBtn${teamSos ? ' on' : ''}" id="tmSos">${teamSos ? '✅ ألغِ الاستغاثة' : '🆘 استغاثة'}</button>`;
  body.insertBefore(head, body.firstChild);
  head.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { teamTab = b.dataset.tab; renderTeam(); }; });
  $('tmSos').onclick = teamSosAsk;
  if (teamTab === 'members') {
    const extra = document.createElement('div'); extra.className = 'card';
    extra.innerHTML = `<div class="btnRow"><button class="chip" id="tmAlerts">⚙️ تنبيهات الفريق</button><button class="chip" id="tmMarkHere">📌 علامة عند موقعي</button></div>
      <div class="s" style="margin:8px 0 0;color:var(--muted)">لإضافة علامة في أي مكان: اضغط مطوّلًا على الخريطة ثم «📌 علامة للفريق».</div>`;
    const cards = body.querySelectorAll('.card'); body.insertBefore(extra, cards[cards.length - 1] || null);
    $('tmAlerts').onclick = alertSettings;
    $('tmMarkHere').onclick = () => { if (!me) { toast('بانتظار تحديد موقعك'); return; } teamMarkAsk(me.lat, me.lng); };
  }
  if (typing != null && $('tmText')) { $('tmText').value = typing; if (focused) $('tmText').focus(); }
};
const _teamLeave2 = teamLeave;
teamLeave = async function () { teamSos = null; store.set('teamSos', null); outbox = []; store.set('teamOutbox', []); chatCache = {}; markLayer.clearLayers(); const r = await _teamLeave2(); drawSosBar(); return r; };
