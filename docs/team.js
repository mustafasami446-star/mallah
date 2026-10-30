'use strict';
/* الملاح — الفريق (المرحلة 1): مجموعة رحلة، مواقع الأعضاء مباشرة على الخريطة، «اذهب إليه»، ونقطة تجمّع.
   Firebase Realtime Database over plain REST + a live stream (no SDK). Everything a member shares (name,
   position, battery, the meeting point) is encrypted on the phone with a key that exists only inside the
   group code, so the server stores unreadable data. */

const TEAM_FB = {
  apiKey: 'AIzaSyDkpiVF2DqoGE1tJPylYYXlMkgZOju5Elk',
  db: store.get('teamDb', 'https://mallah-team-default-rtdb.europe-west1.firebasedatabase.app'),
  auth: store.get('teamAuthBase', 'https://identitytoolkit.googleapis.com/v1'),
  token: store.get('teamTokenBase', 'https://securetoken.googleapis.com/v1')
};
const TEAM_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#f97316', '#3b82f6', '#14b8a6', '#eab308', '#8b5cf6'];

let team = store.get('team', null);        // {code, gid, name, me:{n,c}, owner}
let teamTree = { meta: null, members: {}, rally: null };
let teamView = { members: {}, rally: null, name: '' };   // decrypted
let teamSos = store.get('teamSos', null);
let teamKey = null, teamES = null, teamPaused = store.get('teamPaused', false);
let teamLast = { t: 0, lat: 0, lng: 0 }, teamFollow = null, teamRallySeen = store.get('teamRallySeen', 0);
const teamLayer = L.layerGroup().addTo(map);

/* ---------------- codes and encryption ---------------- */
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';           // no 0/O, 1/I
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(20));
  let s = ''; r.forEach((b) => { s += B32[b % 32]; });
  return s.match(/.{4}/g).join('-');
}
function cleanCode(txt) {
  const m = String(txt || '').toUpperCase().match(/[A-Z2-9]{4}(?:-?[A-Z2-9]{4}){4}/);
  if (!m) return null;
  const c = m[0].replace(/-/g, '');
  return [...c].every((ch) => B32.includes(ch)) ? c.match(/.{4}/g).join('-') : null;
}
const te = new TextEncoder();
async function sha(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s))); }
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (u) => btoa(String.fromCharCode(...u));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function teamKeys(code) {
  const c = code.replace(/-/g, '');
  const gid = hex(await sha('mallah-group|' + c)).slice(0, 24);
  const key = await crypto.subtle.importKey('raw', await sha('mallah-key|' + c), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { gid, key };
}
async function enc(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, teamKey, te.encode(JSON.stringify(obj))));
  return b64(iv) + '.' + b64(ct);
}
async function dec(s) {
  try {
    const [iv, ct] = String(s).split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, teamKey, unb64(ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) { return null; }
}

/* ---------------- sign-in (anonymous) ---------------- */
let fbAuth = store.get('fbAuth', null), fbAuthP = null;
async function fbToken() {
  if (fbAuth && fbAuth.exp - 120000 > Date.now()) return fbAuth.id;
  if (fbAuthP) return fbAuthP;
  fbAuthP = (async () => {
    let r;
    if (fbAuth && fbAuth.refresh) {
      r = await fetch(TEAM_FB.token + '/token?key=' + TEAM_FB.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(fbAuth.refresh) });
      if (r.ok) { const j = await r.json(); fbAuth = { id: j.id_token, refresh: j.refresh_token, uid: j.user_id, exp: Date.now() + (+j.expires_in || 3600) * 1000 }; store.set('fbAuth', fbAuth); return fbAuth.id; }
    }
    r = await fetch(TEAM_FB.auth + '/accounts:signUp?key=' + TEAM_FB.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' });
    if (!r.ok) throw new Error('auth ' + r.status);
    const j = await r.json();
    fbAuth = { id: j.idToken, refresh: j.refreshToken, uid: j.localId, exp: Date.now() + (+j.expiresIn || 3600) * 1000 };
    store.set('fbAuth', fbAuth); return fbAuth.id;
  })().finally(() => { fbAuthP = null; });
  return fbAuthP;
}
/* The database address depends on the region chosen when it was created: find it once. A wrong
   address answers 404 / "different region"; the right one answers 401 (locked) or 200. */
let dbFound = store.get('teamDbOk', null);
async function fbDb() {
  if (store.get('teamDb', null)) return TEAM_FB.db;                 // set by hand (tests)
  if (dbFound) return (TEAM_FB.db = dbFound);
  const cands = ['https://mallah-team-default-rtdb.europe-west1.firebasedatabase.app', 'https://mallah-team-default-rtdb.firebaseio.com', 'https://mallah-team-default-rtdb.asia-southeast1.firebasedatabase.app'];
  for (const c of cands) {
    try {
      const r = await fetch(c + '/.json?shallow=true');
      const t = await r.text();
      if ((r.status === 401 || r.status === 200) && !/different region|not found/i.test(t)) { dbFound = c; store.set('teamDbOk', c); return (TEAM_FB.db = c); }
    } catch (e) {}
  }
  return TEAM_FB.db;
}
async function fbReq(method, path, body) {
  await fbDb();
  const tok = await fbToken();
  const r = await fetch(TEAM_FB.db + path + '.json?auth=' + encodeURIComponent(tok), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error('db ' + r.status);
  return r.json();
}

/* ---------------- the live stream of the group ---------------- */
function setAt(tree, path, data) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return data || {};
  let o = tree; for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
  if (data === null) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = data;
  return tree;
}
let teamRetry = 0, teamRetryT = 0, teamLive = false;
async function teamConnect() {
  teamDisconnect();
  if (!team) return;
  if (navigator.onLine === false) { teamLive = false; renderTeam(); return; }
  let tok; try { await fbDb(); tok = await fbToken(); } catch (e) { teamLive = false; renderTeam(); return teamRetrySoon(); }
  const es = new EventSource(TEAM_FB.db + '/groups/' + team.gid + '.json?auth=' + encodeURIComponent(tok));
  teamES = es;
  const onData = (patch) => (ev) => {
    let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (!d) return;
    let tree = Object.assign({}, teamTree);
    if (patch) Object.keys(d.data || {}).forEach((k) => { tree = setAt(tree, (d.path === '/' ? '' : d.path) + '/' + k, d.data[k]); });
    else tree = setAt(tree, d.path, d.data);
    teamTree = Object.assign({}, tree || {}); teamTree.members = teamTree.members || {};
    teamLive = true; teamRetry = 0;
    teamDecode();
  };
  es.addEventListener('put', onData(false));
  es.addEventListener('patch', onData(true));
  es.addEventListener('auth_revoked', () => { fbAuth && (fbAuth.exp = 0); teamConnect(); });
  es.addEventListener('cancel', () => { teamLive = false; renderTeam(); teamDisconnect(); teamRetrySoon(); });
  es.onerror = () => { if (es.readyState === 2) { teamLive = false; renderTeam(); teamRetrySoon(); } };
}
function teamDisconnect() { if (teamES) { try { teamES.close(); } catch (e) {} teamES = null; } }
function teamRetrySoon() { clearTimeout(teamRetryT); teamRetryT = setTimeout(teamConnect, Math.min(60000, 3000 * Math.pow(2, teamRetry++))); }
window.addEventListener('online', () => { if (team) teamConnect(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && team && !teamES) teamConnect(); });

let decodeSeq = 0;
async function teamDecode() {
  const seq = ++decodeSeq, out = {};
  for (const [uid, m] of Object.entries(teamTree.members || {})) {
    if (!m || !m.e) continue;
    const v = await dec(m.e); if (!v) continue;
    out[uid] = Object.assign(v, { uid, st: m.t || v.t || 0 });
  }
  const rally = teamTree.rally && teamTree.rally.e ? await dec(teamTree.rally.e) : null;
  const meta = teamTree.meta && teamTree.meta.e ? await dec(teamTree.meta.e) : null;
  const extra = typeof teamDecodeMore === 'function' ? await teamDecodeMore() : {};
  if (seq !== decodeSeq) return;
  teamView = { members: out, rally, chat: extra.chat || [], marks: extra.marks || [], cfg: extra.cfg || null, name: (meta && meta.n) || team.name || 'الفريق', owner: teamTree.meta && teamTree.meta.owner };
  if (rally && rally.t > teamRallySeen) {
    teamRallySeen = rally.t; store.set('teamRallySeen', rally.t);
    if (rally.by !== (fbAuth && fbAuth.uid)) actionSheet('📍 نقطة تجمّع جديدة: ' + rally.n + (me ? ' — على بُعد ' + fmtDist(hav([me.lat, me.lng], [rally.lat, rally.lng])) : ''), [
      { label: '🧭 اذهب إليها', fn: () => teamGo({ lat: rally.lat, lng: rally.lng, n: rally.n }) }]);
  }
  followUpdate();
  if (typeof teamAfterDecode === 'function') teamAfterDecode();
  renderTeam();
}

/* ---------------- sharing my position ---------------- */
async function battery() { try { const b = navigator.getBattery && await navigator.getBattery(); return b ? Math.round(b.level * 100) : null; } catch (e) { return null; } }
async function teamPublish(force) {
  if (!team || !teamKey || teamPaused || !me || !fbAuth) return;
  const now = Date.now(), moved = teamLast.t ? hav([teamLast.lat, teamLast.lng], [me.lat, me.lng]) : 1e9;
  const moving = (me.speed || 0) > 1 || moved > 25;
  const every = moving ? 10000 : 60000;
  if (!force && now - teamLast.t < every && moved < 50) return;
  teamLast = { t: now, lat: me.lat, lng: me.lng };
  try {
    const e = await enc({ n: team.me.n, c: team.me.c, lat: +me.lat.toFixed(6), lng: +me.lng.toFixed(6), a: Math.round(me.acc || 0), h: me.heading == null ? null : Math.round(me.heading), s: me.speed == null ? null : +(+me.speed).toFixed(1), b: await battery(), sos: teamSos || null, t: now });
    await fbReq('PUT', '/groups/' + team.gid + '/members/' + fbAuth.uid, { e, t: { '.sv': 'timestamp' } });
  } catch (err) { teamLast.t = 0; }
}
setInterval(() => teamPublish(false), 5000);

/* ---------------- create / join / leave ---------------- */
async function teamOpen(code, name, myName, create) {
  const k = await teamKeys(code);
  teamKey = k.key;
  await fbToken();
  const color = TEAM_COLORS[parseInt(hex(await sha(fbAuth.uid)).slice(0, 4), 16) % TEAM_COLORS.length];
  team = { code, gid: k.gid, name: name || '', me: { n: myName, c: color } };
  if (create) await fbReq('PUT', '/groups/' + k.gid + '/meta', { owner: fbAuth.uid, e: await enc({ n: name }), created: { '.sv': 'timestamp' } });
  store.set('team', team); store.set('teamName', myName);
  teamPaused = false; store.set('teamPaused', false);
  teamLast.t = 0;
  await teamConnect();
  teamPublish(true);
  renderTeam();
}
async function teamCreate() {
  const myName = ($('tmMe').value || '').trim(), gname = ($('tmGroup').value || '').trim();
  if (!myName) { toast('اكتب اسمك أولًا'); $('tmMe').focus(); return; }
  if (!gname) { toast('اكتب اسم المجموعة'); $('tmGroup').focus(); return; }
  if (navigator.onLine === false) { toast('إنشاء المجموعة يحتاج اتصالًا بالإنترنت'); return; }
  teamBusy('جارٍ إنشاء المجموعة…');
  try { await teamOpen(newCode(), gname, myName, true); toast('✓ أُنشئت المجموعة. أرسل الدعوة لفريقك', 3500); teamInvite(); }
  catch (e) { team = null; store.set('team', null); teamFail(e); }
}
async function teamJoin(txt) {
  const myName = ($('tmMe').value || store.get('teamName', '') || '').trim();
  const code = cleanCode(txt != null ? txt : $('tmCode').value);
  if (!code) { toast('رمز المجموعة غير صحيح — يتكوّن من 20 حرفًا ورقمًا'); return; }
  if (!myName) { toast('اكتب اسمك أولًا'); $('tmMe').focus(); return; }
  if (navigator.onLine === false) { toast('الانضمام يحتاج اتصالًا بالإنترنت'); return; }
  teamBusy('جارٍ الانضمام…');
  try {
    const k = await teamKeys(code); teamKey = k.key;
    const meta = await fbReq('GET', '/groups/' + k.gid + '/meta');
    if (!meta) { teamKey = null; renderTeam(); toast('لا توجد مجموعة بهذا الرمز'); return; }
    const m = await dec(meta.e);
    await teamOpen(code, m && m.n, myName, false);
    toast('✓ انضممت إلى ' + (m && m.n ? m.n : 'المجموعة'), 3000);
  } catch (e) { team = null; store.set('team', null); teamFail(e); }
}
function teamFail(e) {
  renderTeam();
  const m = String(e && e.message || e);
  toast(/auth 400|auth 403/.test(m) ? 'تعذّر الدخول إلى خادم الفريق (تحقق من إعداد Firebase)' : /db 401|db 403/.test(m) ? 'رفض الخادم الطلب (قواعد الأمان)' : 'تعذّر الاتصال بخادم الفريق — تحقق من الإنترنت', 5000);
}
async function teamLeave() {
  const t = team; teamDisconnect();
  team = null; teamKey = null; teamTree = { meta: null, members: {}, rally: null }; teamView = { members: {}, rally: null, name: '' };
  store.set('team', null); teamFollow = null; renderTeam();
  if (t && fbAuth) try { await fbReq('DELETE', '/groups/' + t.gid + '/members/' + fbAuth.uid); } catch (e) {}
}
function teamInvite() {
  if (!team) return;
  const link = 'https://mustafasami446-star.github.io/mallah/?team=' + team.code;
  const txt = '👥 انضم إلى مجموعتي «' + teamView.name + '» في تطبيق الملاح لنرى مواقع بعضنا على الطريق.\n\nرمز المجموعة: ' + team.code + '\n\n' + link + '\n\n(في تطبيق أندرويد: ☰ ← الفريق ← الانضمام، والصق الرمز)';
  if (NATIVE && Android.shareText) Android.shareText(txt);
  else if (navigator.share) navigator.share({ text: txt }).catch(() => {});
  else { try { navigator.clipboard.writeText(txt); toast('✓ نُسخت الدعوة'); } catch (e) { prompt('انسخ الدعوة:', txt); } }
}

/* ---------------- the meeting point ---------------- */
async function teamSetRally(lat, lng, n) {
  if (!team) return;
  try {
    const r = { n: n || 'نقطة التجمّع', lat: +lat.toFixed(6), lng: +lng.toFixed(6), by: fbAuth.uid, byN: team.me.n, t: Date.now() };
    teamRallySeen = r.t; store.set('teamRallySeen', r.t);
    await fbReq('PUT', '/groups/' + team.gid + '/rally', { e: await enc(r) });
    toast('✓ أُرسلت نقطة التجمّع للفريق');
  } catch (e) { teamFail(e); }
}
function teamRallyMenu() {
  const items = [];
  if (me) items.push({ label: '📍 موقعي الحالي', fn: () => teamSetRally(me.lat, me.lng, 'عند ' + team.me.n) });
  if (dest) items.push({ label: '🏁 الوجهة: ' + esc(dest.name), fn: () => teamSetRally(dest.lat, dest.lng, dest.name) });
  items.push({ label: '✛ مركز الخريطة', fn: () => { const c = map.getCenter(); teamSetRally(c.lat, c.lng, 'نقطة التجمّع'); } });
  if (teamView.rally) items.push({ label: '🗑 إلغاء نقطة التجمّع', cls: 'danger', fn: async () => { try { await fbReq('DELETE', '/groups/' + team.gid + '/rally'); } catch (e) { teamFail(e); } } });
  actionSheet('حدّد نقطة التجمّع — تصل كل أعضاء المجموعة', items);
}

/* ---------------- go to a member (the route follows them) ---------------- */
function teamGo(p, uid) {
  $('teamPanel').classList.add('hidden');
  teamFollow = uid ? { uid, lat: p.lat, lng: p.lng } : null;
  setDestination(p.lat, p.lng, p.n, uid ? '👥 من فريقك — يتحدّث موقعه تلقائيًا' : '👥 نقطة التجمّع', true);
}
let followAsk = 0;
function followUpdate() {
  if (!teamFollow || !dest) { teamFollow = dest ? teamFollow : null; return; }
  const m = teamView.members[teamFollow.uid]; if (!m) return;
  const moved = hav([teamFollow.lat, teamFollow.lng], [m.lat, m.lng]);
  if (moved < 60) return;
  if (navState || (typeof directState !== 'undefined' && directState)) {
    if (moved > 250 && Date.now() - followAsk > 90000) { followAsk = Date.now(); toast('🚶 ' + m.n + ' تحرّك ' + fmtDist(moved) + ' — افتح «الفريق» لتحديث الوجهة', 5000); }
    return;
  }
  teamFollow.lat = m.lat; teamFollow.lng = m.lng;
  setDestination(m.lat, m.lng, m.n, '👥 من فريقك — يتحدّث موقعه تلقائيًا', true);
}

/* ---------------- on the map ---------------- */
const initial = (n) => ((n || '?').trim().slice(0, 1) || '?').replace(/[أإآ]/, 'ا');
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'الآن' : s < 3600 ? 'منذ ' + Math.round(s / 60) + ' د' : s < 86400 ? 'منذ ' + Math.round(s / 3600) + ' س' : 'منذ ' + Math.round(s / 86400) + ' يوم'; };
function memberIcon(m, mine) {
  const stale = Date.now() - (m.t || 0) > 3 * 60000;
  const ini = esc(initial(m.n));
  return L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 18],
    html: `<div class="tmPin${stale ? ' stale' : ''}" style="--c:${m.c}"><b>${ini}</b>${m.h != null && !stale ? `<i style="transform:rotate(${m.h + mapBearing()}deg)"></i>` : ''}<span>${esc(m.n)}${stale ? ' · ' + ago(m.t) : ''}</span></div>` });
}
function drawTeam() {
  teamLayer.clearLayers();
  if (!team) return;
  const mine = fbAuth && fbAuth.uid;
  Object.values(teamView.members).forEach((m) => {
    if (m.uid === mine || !isFinite(m.lat)) return;
    L.marker([m.lat, m.lng], { icon: memberIcon(m), zIndexOffset: 800 }).on('click', () => teamMemberMenu(m)).addTo(teamLayer);
  });
  const r = teamView.rally;
  if (r) L.marker([r.lat, r.lng], { zIndexOffset: 700, icon: L.divIcon({ className: '', iconSize: [34, 40], iconAnchor: [6, 38], html: `<div class="tmFlag">🚩<span>${esc(r.n)}</span></div>` }) })
    .on('click', () => actionSheet('🚩 ' + r.n + (r.byN ? ' — حدّدها ' + r.byN : ''), [{ label: '🧭 اذهب إليها', fn: () => teamGo({ lat: r.lat, lng: r.lng, n: r.n }) }])).addTo(teamLayer);
}
map.on('rotate', () => { if (team) drawTeam(); });
function teamMemberMenu(m) {
  const d = me ? fmtDist(hav([me.lat, me.lng], [m.lat, m.lng])) : '';
  actionSheet(m.n + (d ? ' — ' + d : '') + ' · ' + ago(m.t) + (m.b != null ? ' · 🔋' + m.b + '%' : ''), [
    { label: '🧭 اذهب إليه', fn: () => teamGo({ lat: m.lat, lng: m.lng, n: m.n }, m.uid) },
    { label: '🗺 عرضه على الخريطة', fn: () => { $('teamPanel').classList.add('hidden'); map.setView([m.lat, m.lng], Math.max(map.getZoom(), 16)); } }
  ]);
}

/* ---------------- the panel ---------------- */
function teamBusy(msg) { const b = $('teamBody'); if (b) b.innerHTML = `<div class="card"><div class="item"><div class="grow s">${msg}</div></div></div>`; }
function renderTeam() {
  drawTeam();
  const fab = $('teamBtn');
  const others = Object.values(teamView.members).filter((m) => m.uid !== (fbAuth && fbAuth.uid));
  const online = others.filter((m) => Date.now() - (m.t || 0) < 3 * 60000).length;
  if (fab) { fab.classList.toggle('hidden', !team); fab.classList.toggle('on', !!team); const bd = fab.querySelector('em'); if (bd) { bd.textContent = team ? online : ''; bd.classList.toggle('hidden', !team || !online); } }
  const body = $('teamBody'); if (!body || $('teamPanel').classList.contains('hidden')) return;
  if (!team) {
    body.innerHTML = `<div class="card tmIntro"><div class="t">👥 رحلة الفريق</div><div class="s">أنشئ مجموعة لفريقك أو انضم إلى مجموعة، فيرى كل منكم مواقع الآخرين على الخريطة مباشرة، ويمكنه الذهاب إلى أي زميل أو إلى نقطة تجمّع يحددها القائد. المواقع مشفّرة ولا يقرؤها إلا أعضاء المجموعة.</div></div>
      <div class="card"><div class="frm"><label>اسمك كما يظهر للفريق</label><input type="text" id="tmMe" maxlength="24" placeholder="مثال: أحمد" value="${esc(store.get('teamName', ''))}"></div></div>
      <div class="card"><h3>مجموعة جديدة</h3><div class="frm"><label>اسم المجموعة</label><input type="text" id="tmGroup" maxlength="40" placeholder="مثال: فريق حقل الحلفاية"></div><div class="btnRow"><button class="chip go" id="tmCreate">➕ إنشاء مجموعة</button></div></div>
      <div class="card"><h3>الانضمام إلى مجموعة</h3><div class="frm"><label>رمز المجموعة (أو الصق رسالة الدعوة كاملة)</label><input type="text" id="tmCode" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" dir="ltr"></div><div class="btnRow"><button class="chip go" id="tmJoin">🔗 انضمام</button></div></div>`;
    $('tmCreate').onclick = teamCreate; $('tmJoin').onclick = () => teamJoin();
    const pend = store.get('teamPending', null); if (pend) { $('tmCode').value = pend; store.set('teamPending', null); }
    return;
  }
  const mine = fbAuth && fbAuth.uid, r = teamView.rally;
  const list = Object.values(teamView.members).sort((a, b) => (a.uid === mine ? -1 : b.uid === mine ? 1 : (me ? hav([me.lat, me.lng], [a.lat, a.lng]) - hav([me.lat, me.lng], [b.lat, b.lng]) : 0)));
  const rows = list.map((m) => {
    const isMe = m.uid === mine, stale = Date.now() - (m.t || 0) > 3 * 60000;
    const d = !isMe && me ? fmtDist(hav([me.lat, me.lng], [m.lat, m.lng])) : '';
    return `<div class="res" data-tm="${esc(m.uid)}"><div class="ic"><span class="tmDot${stale ? ' stale' : ''}" style="--c:${m.c}">${esc(initial(m.n))}</span></div><div style="flex:1;min-width:0"><div class="t">${esc(m.n)}${isMe ? ' <span class="hereTag">(أنت)</span>' : ''}</div><div class="s">${isMe ? (teamPaused ? '✋ مشاركة موقعك متوقفة' : '📡 يشارك موقعه') : ago(m.t)}${m.b != null ? ' · 🔋' + m.b + '%' : ''}</div></div><div class="s" style="flex:none">${d}</div></div>`;
  }).join('') || '<div class="item"><div class="grow s">لا أحد بعد — أرسل الدعوة لفريقك</div></div>';
  body.innerHTML = `<div class="card"><div class="tmHead"><div class="grow"><div class="t">👥 ${esc(teamView.name)}</div><div class="s">${teamLive ? '<span class="ok">● متصل</span>' : '<span class="warnTxt">● غير متصل — ستظهر آخر المواقع المعروفة</span>'} · ${list.length} عضو</div></div><button class="chip go" id="tmInvite">📤 دعوة</button></div>
      <div class="s tmCode" dir="ltr">${team.code}</div></div>
    <div class="card"><h3>🚩 نقطة التجمّع</h3>${r ? `<div class="item"><div class="grow"><div class="t">${esc(r.n)}</div><div class="s">${r.byN ? 'حدّدها ' + esc(r.byN) + ' · ' : ''}${ago(r.t)}${me ? ' · ' + fmtDist(hav([me.lat, me.lng], [r.lat, r.lng])) : ''}</div></div><button class="chip go" id="tmRallyGo">🧭 اذهب</button></div>` : '<div class="item"><div class="grow s">لم تُحدَّد بعد</div></div>'}
      <div class="btnRow"><button class="chip" id="tmRallySet">${r ? '✏️ تغيير' : '➕ تحديد نقطة تجمّع'}</button></div></div>
    <div class="card"><h3>الأعضاء</h3>${rows}</div>
    <div class="card"><div class="btnRow"><button class="chip" id="tmPause">${teamPaused ? '▶ استئناف مشاركة موقعي' : '✋ إيقاف مشاركة موقعي'}</button><button class="chip del" id="tmLeave">🚪 مغادرة المجموعة</button></div>
      <div class="s" style="margin-top:8px;color:var(--muted)">يُشارَك موقعك كل 10 ثوانٍ أثناء الحركة وكل دقيقة عند التوقف، ويمكنك إيقاف المشاركة في أي وقت.</div></div>`;
  $('tmInvite').onclick = teamInvite;
  $('tmRallySet').onclick = teamRallyMenu;
  if ($('tmRallyGo')) $('tmRallyGo').onclick = () => teamGo({ lat: r.lat, lng: r.lng, n: r.n });
  $('tmPause').onclick = () => { teamPaused = !teamPaused; store.set('teamPaused', teamPaused); if (!teamPaused) teamPublish(true); renderTeam(); };
  $('tmLeave').onclick = () => actionSheet('مغادرة «' + teamView.name + '»؟ لن يرى الفريق موقعك بعد الآن.', [{ label: '🚪 مغادرة', cls: 'danger', fn: teamLeave }]);
  body.querySelectorAll('[data-tm]').forEach((el) => {
    el.onclick = () => { const m = teamView.members[el.dataset.tm]; if (m && m.uid !== mine) teamMemberMenu(m); };
  });
}
function openTeam() {
  $('menuDrop').classList.add('hidden');
  $('teamPanel').classList.remove('hidden');
  renderTeam();
}
setInterval(() => { if (team) renderTeam(); }, 30000);        // "منذ ... د" stays current

/* ---------------- wiring ---------------- */
$('openTeam').onclick = openTeam;
$('teamBtn').onclick = openTeam;
$('teamClose').onclick = () => $('teamPanel').classList.add('hidden');
function teamHandleBack() { const p = $('teamPanel'); if (p && !p.classList.contains('hidden')) { p.classList.add('hidden'); return true; } return false; }
// invitation links: …/mallah/?team=CODE and mallah://team?code=CODE
const _handleLinkT = window.handleLink;
window.handleLink = function (url) {
  const s = decodeURIComponent(String(url || ''));
  if (/^mallah:\/*team/i.test(s) || /[?&]team=/i.test(s)) {
    const code = cleanCode(s);
    if (code) { store.set('teamPending', code); openTeam(); if (team && team.code === code) return; if (team) toast('أنت في مجموعة أخرى — غادرها أولًا للانضمام'); return; }
  }
  return _handleLinkT(url);
};
{ const q = new URLSearchParams(location.search); if (q.get('team')) { const c = cleanCode(q.get('team')); if (c) { store.set('teamPending', c); setTimeout(openTeam, 1200); history.replaceState(null, '', location.pathname); } } }
// back in a group after a restart
(async function teamResume() {
  if (!team) return renderTeam();
  try { teamKey = (await teamKeys(team.code)).key; } catch (e) { return; }
  teamConnect(); renderTeam();
})();
