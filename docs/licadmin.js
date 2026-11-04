'use strict';
/* الملاح — وضع المصمم: توليد رموز التفعيل من هاتف المصمم أو لابتوبه.
   Opened by tapping the version number in «عن البرنامج» 7 times; the secret key is pasted once and kept
   only on that device. The same code runs in the standalone page (mallah-admin.html). */

const LICA = {
  key: null,
  log: (() => { try { return JSON.parse(localStorage.getItem('licAdminLog') || '[]'); } catch (e) { return []; } })()
};
async function licaKey() {
  if (LICA.key) return LICA.key;
  const k = localStorage.getItem('licAdminKey');
  if (!k) return null;
  LICA.key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(k), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return LICA.key;
}
async function licaSetKey(txt) {
  const k = String(txt || '').replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(k), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    // it must match the public key inside the app
    const test = new TextEncoder().encode('mallah-key-check');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, test);
    const pub = await crypto.subtle.importKey('spki', Uint8Array.from(atob(LICA_PUB), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, test))) return false;
    localStorage.setItem('licAdminKey', k); LICA.key = key; return true;
  } catch (e) { return false; }
}
function licaCleanDev(txt) {
  const m = String(txt || '').toUpperCase().match(/[A-Z2-9]{4}-?[A-Z2-9]{4}-?[A-Z2-9]{4}/);
  return m ? m[0].replace(/-/g, '').match(/.{4}/g).join('-') : null;
}
async function licaMake(dev, kind, exp) {
  const key = await licaKey(); if (!key) throw new Error('no key');
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode('mallah-license|v1|' + dev + '|' + kind + '|' + exp)));
  return 'M1-' + kind + exp + '-' + btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function licaBuyerText(dev, code) {
  return 'شكرًا لك 🌟 هذا رمز تفعيل «الملاح» لجهازك (' + dev + '):\n\n' + code + '\n\nافتح الملاح ← الصق الرمز في شاشة التفعيل ← «🔓 تفعيل».\n(في الإعدادات ← «🔑 التفعيل» إن لم تظهر الشاشة)';
}
/* ---------------- the log on both phones: encrypted copy in the team database ----------------
   The place and the encryption key both come from the secret key, so only a device that holds the secret
   key can find or read the log. The secret key itself never leaves the device. One node per buyer, so two
   phones writing at once never overwrite each other. */
const LSYNC = {
  api: 'AIzaSyDkpiVF2DqoGE1tJPylYYXlMkgZOju5Elk',
  dbs: ['https://mallah-team-default-rtdb.europe-west1.firebasedatabase.app', 'https://mallah-team-default-rtdb.firebaseio.com', 'https://mallah-team-default-rtdb.asia-southeast1.firebasedatabase.app'],
  db: localStorage.getItem('licaDb') || null, auth: null, ids: null, busy: null,
  last: +localStorage.getItem('licaSyncT') || 0, err: ''
};
const lsHex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const lsB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))), lsUnB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function lsIds() {
  const k = localStorage.getItem('licAdminKey'); if (!k) return null;
  if (LSYNC.ids && LSYNC.ids.k === k) return LSYNC.ids;
  const h = async (t) => crypto.subtle.digest('SHA-256', new TextEncoder().encode('mallah-admin-sync|' + t + '|' + k));
  const sid = lsHex(await h('id')).slice(0, 32);
  const aes = await crypto.subtle.importKey('raw', await h('aes'), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return (LSYNC.ids = { k, sid, aes });
}
async function lsToken() {
  let a = LSYNC.auth || (() => { try { return JSON.parse(localStorage.getItem('licaFbAuth') || 'null'); } catch (e) { return null; } })();
  if (a && a.exp - 120000 > Date.now()) return (LSYNC.auth = a).id;
  let r, j;
  if (a && a.refresh) {
    r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + LSYNC.api, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refresh) });
    if (r.ok) { j = await r.json(); a = { id: j.id_token, refresh: j.refresh_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 }; }
    else a = null;
  } else a = null;
  if (!a) {
    r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + LSYNC.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' });
    if (!r.ok) throw new Error('auth');
    j = await r.json(); a = { id: j.idToken, refresh: j.refreshToken, exp: Date.now() + (+j.expiresIn || 3600) * 1000 };
  }
  LSYNC.auth = a; localStorage.setItem('licaFbAuth', JSON.stringify(a)); return a.id;
}
async function lsDb() {
  if (LSYNC.db) return LSYNC.db;
  for (const c of LSYNC.dbs) {
    try { const r = await fetch(c + '/.json?shallow=true'), t = await r.text(); if ((r.status === 401 || r.status === 200) && !/different region|not found/i.test(t)) { localStorage.setItem('licaDb', c); return (LSYNC.db = c); } } catch (e) {}
  }
  return (LSYNC.db = LSYNC.dbs[0]);
}
async function lsReq(method, path, body, query) {
  const db = await lsDb(), tok = await lsToken();
  const r = await fetch(db + path + '.json?auth=' + encodeURIComponent(tok) + (query || ''), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 || r.status === 403) throw new Error('rules');
  if (!r.ok) throw new Error('db ' + r.status);
  return r.json();
}
/* ---------------- crash reports from the users' phones ----------------
   Each report is sealed with the public key inside the app; only the secret key here opens it. */
let licaCrashKey = null;
async function licaOpenCrash(r) {
  if (!licaCrashKey) {
    const k = localStorage.getItem('licAdminKey'); if (!k) return null;
    licaCrashKey = await crypto.subtle.importKey('pkcs8', lsUnB64(k), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  }
  try {
    const pub = await crypto.subtle.importKey('raw', lsUnB64(r.k), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, licaCrashKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const raw = lsUnB64(r.e);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))));
  } catch (e) { return null; }
}
/* the last 300 reports, opened and grouped: the same error on many phones is one line with a count */
async function licaCrashes() {
  const all = (await lsReq('GET', '/crash', undefined, '&orderBy=' + encodeURIComponent('"$key"') + '&limitToLast=300')) || {};
  const groups = {};
  for (const [id, r] of Object.entries(all)) {
    if (!r) continue;
    const o = r.e && r.k ? await licaOpenCrash(r) : (r.m ? r : null);      // (the first reports were not sealed yet)
    if (!o) continue;
    const top = String(o.s || '').split('\n').map((x) => x.trim()).filter((x) => x && x !== o.m && !x.startsWith('TypeError') && !x.startsWith('Error'))[0] || '';
    const sig = (o.m || '').slice(0, 160) + '|' + top.replace(/:\d+:\d+\)?$/, '');
    const g = groups[sig] || (groups[sig] = { sig, m: o.m, s: o.s, k: o.k, n: 0, devs: new Set(), vers: new Set(), uis: new Set(), first: Infinity, last: 0, ids: [] });
    g.n++; g.devs.add(o.d || '?'); g.vers.add(o.v || r.v || '?'); if (o.ui) g.uis.add(o.ui);
    const t = r.t || o.at || 0; g.first = Math.min(g.first, t); if (t > g.last) { g.last = t; g.s = o.s; }
    g.ids.push(id);
  }
  return Object.values(groups).sort((a, b) => b.last - a.last);
}
function licaCrashText(g) {
  return '🐞 عطل في الملاح\n' + g.m + '\n\nعدد المرات: ' + g.n + ' · الأجهزة: ' + [...g.devs].join('، ') + '\nالإصدارات: ' + [...g.vers].join('، ')
    + '\nآخر مرة: ' + new Date(g.last).toLocaleString('ar-IQ-u-nu-latn') + (g.uis.size ? '\nالشاشة: ' + [...g.uis].join(' / ') : '') + '\n\n' + (g.s || '');
}
function licaSaveLog() { localStorage.setItem('licAdminLog', JSON.stringify(LICA.log)); }
function licaMerge(list) {
  const map = {}; LICA.log.concat(list).forEach((r) => { if (r && r.dev && r.code && (!map[r.dev] || map[r.dev].t < r.t)) map[r.dev] = r; });
  const before = JSON.stringify(LICA.log);
  LICA.log = Object.values(map).sort((a, b) => a.t - b.t); licaSaveLog();
  return before !== JSON.stringify(LICA.log);
}
/* pull everything, merge, push what the other phone does not have yet */
function licaSync() {
  if (LSYNC.busy) return LSYNC.busy;
  LSYNC.busy = (async () => {
    const ids = await lsIds(); if (!ids) return false;
    const remote = (await lsReq('GET', '/adminlog/' + ids.sid)) || {};
    const got = [], have = {};
    for (const eid of Object.keys(remote)) {
      try {
        const raw = lsUnB64(remote[eid].e);
        const r = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, ids.aes, raw.slice(12))));
        got.push(r); have[r.dev] = r.t;
      } catch (e) {}
    }
    const changed = licaMerge(got);
    for (const r of LICA.log) {
      if (have[r.dev] >= r.t) continue;
      const eid = lsHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.sid + '|' + r.dev))).slice(0, 16);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ids.aes, new TextEncoder().encode(JSON.stringify(r))));
      const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
      await lsReq('PUT', '/adminlog/' + ids.sid + '/' + eid, { e: lsB64(all) });
    }
    LSYNC.last = Date.now(); LSYNC.err = ''; localStorage.setItem('licaSyncT', String(LSYNC.last));
    return changed;
  })().catch((e) => { LSYNC.err = e && e.message === 'rules' ? 'rules' : 'net'; throw e; }).finally(() => { LSYNC.busy = null; });
  return LSYNC.busy;
}
function licaSyncText() {
  if (LSYNC.busy) return '☁️ جارٍ المزامنة…';
  if (LSYNC.err === 'rules') return '⚠️ لم تُقبل المزامنة — انشر قواعد Firebase الجديدة (فيها adminlog)';
  if (LSYNC.err) return '⚠️ تعذّرت المزامنة — لا يوجد إنترنت؟ السجل محفوظ هنا وسيُزامَن لاحقًا';
  if (!LSYNC.last) return '☁️ لم تتم المزامنة بعد';
  return '☁️ متزامن مع أجهزتك الأخرى — آخر مزامنة ' + new Date(LSYNC.last).toLocaleString('ar-IQ', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' });
}

function licaPanel(root) {
  root.innerHTML = `<div class="card"><h3>🔑 توليد رمز تفعيل</h3><div class="frm">
      <label>رقم جهاز المشتري (يصلك منه عبر واتساب)</label><input type="text" id="laDev" dir="ltr" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters">
      <label>اسم المشتري (للسجل)</label><input type="text" id="laName" placeholder="مثال: أحمد — حقل الحلفاية">
      <label>رقم واتساب المشتري (اختياري، لإرسال الرمز له مباشرة)</label><input type="text" id="laTel" dir="ltr" inputmode="tel" placeholder="07XXXXXXXXX"></div>
    <div class="btnRow"><button class="chip go" id="laMake">🔑 توليد الرمز</button></div>
    <div id="laOut"></div></div>
    <div class="card"><h3>السجل (${LICA.log.length})</h3><div class="s" id="laSync" style="padding:4px 14px 8px"></div><div class="btnRow" style="padding-bottom:8px"><button class="chip" id="laSyncGo">🔄 مزامنة الآن</button></div><div id="laLog"></div></div>
    <div class="card"><h3 id="laCrH">🐞 أعطال المستخدمين</h3><div class="s" id="laCrS" style="padding:4px 14px 8px"></div><div class="btnRow" style="padding-bottom:8px"><button class="chip" id="laCrGo">🔄 تحديث</button><button class="chip" id="laCrAll">إظهار التي أُصلحت</button></div><div id="laCr"></div></div>
    <div class="card"><h3>💾 نسخة احتياطية</h3><div class="btnRow"><button class="chip go" id="laBackup">💾 حفظ نسخة من السجل</button><button class="chip" id="laRestore">📂 استعادة نسخة</button><input type="file" id="laFile" accept=".json,application/json" hidden></div>
    <div class="btnRow"><button class="chip" id="laPin">🔒 تغيير رمز PIN</button><button class="chip" id="laLockNow">🔒 قفل الآن</button><button class="chip del" id="laForget">🗑 حذف المفتاح من هذا الجهاز</button></div>
    <div class="s" style="padding:6px 14px 12px;color:var(--muted);line-height:1.7">المفتاح السري محفوظ على هذا الجهاز فقط. لا ترسله لأحد: من يملكه يستطيع تفعيل أي جهاز.</div></div>`;
  const q = (id) => root.querySelector('#' + id);
  const drawLog = () => {
    const h = root.querySelector('#laLog').parentNode.querySelector('h3'); if (h) h.textContent = 'السجل (' + LICA.log.length + ')';
    q('laLog').innerHTML = LICA.log.slice().reverse().map((r) => `<div class="res"><div style="flex:1;min-width:0"><div class="t">${escA(r.name || '—')}</div><div class="s" dir="ltr" style="text-align:right">${r.dev} · ${new Date(r.t).toLocaleDateString('ar-IQ')}</div></div><button class="chip" data-copy="${r.dev}">نسخ الرمز</button></div>`).join('') || '<div class="item"><div class="grow s">لا يوجد بعد</div></div>';
    q('laLog').querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { const r = LICA.log.find((x) => x.dev === b.dataset.copy); if (r) copyA(licaBuyerText(r.dev, r.code)); }; });
  };
  drawLog();
  const sync = () => {
    if (!root.isConnected) return;
    q('laSync').textContent = '☁️ جارٍ المزامنة…';
    licaSync().then((ch) => { if (ch) drawLog(); }).catch(() => {}).finally(() => { if (q('laSync')) q('laSync').textContent = licaSyncText(); });
  };
  q('laSync').textContent = licaSyncText();
  q('laSyncGo').onclick = sync;
  sync();
  // crash reports
  let crShowAll = false, crGroups = [];
  const fixed = () => { try { return JSON.parse(localStorage.getItem('licCrashFixed') || '[]'); } catch (e) { return []; } };
  const drawCr = () => {
    const fx = fixed(), seen = +localStorage.getItem('licCrashSeen') || 0;
    const list = crGroups.filter((g) => crShowAll || !fx.includes(g.sig));
    const fresh = crGroups.filter((g) => !fx.includes(g.sig) && g.last > seen).length;
    q('laCrH').textContent = '🐞 أعطال المستخدمين' + (fresh ? ' — ' + fresh + ' جديدة' : '');
    q('laCrS').textContent = crGroups.length ? (list.length ? 'الأحدث أولًا. اضغط عطلًا لترى تفاصيله.' : '✓ لا توجد أعطال مفتوحة') : '✓ لم يصل أي عطل';
    q('laCrAll').textContent = crShowAll ? 'إخفاء التي أُصلحت' : 'إظهار التي أُصلحت';
    q('laCr').innerHTML = list.map((g, i) => `<div class="res laCrRow" style="display:block;cursor:pointer" data-i="${i}">
      <div class="t" style="${fx.includes(g.sig) ? 'opacity:.55;text-decoration:line-through' : ''}">${g.last > seen && !fx.includes(g.sig) ? '🔴 ' : ''}${escA(g.m)}</div>
      <div class="s">${g.n} مرة · ${g.devs.size} جهاز · ${escA([...g.vers].join('، '))} · آخرها ${escA(new Date(g.last).toLocaleString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>
      <div class="laCrMore hidden"><div class="s" style="margin-top:6px">الأجهزة: ${escA([...g.devs].join('، '))}${g.uis.size ? '<br>الشاشة: ' + escA([...g.uis].join(' / ')) : ''}</div>
        <pre dir="ltr" style="white-space:pre-wrap;word-break:break-all;font-size:11px;background:var(--panel2);padding:8px;border-radius:10px;max-height:220px;overflow:auto">${escA(g.s || '')}</pre>
        <div class="btnRow" style="padding:0"><button class="chip" data-copy="${i}">📋 نسخ للإرسال</button><button class="chip go" data-fix="${i}">${fx.includes(g.sig) ? '↩ إعادة فتح' : '✓ تم الإصلاح'}</button></div></div></div>`).join('');
    q('laCr').querySelectorAll('.laCrRow').forEach((row) => { row.onclick = (e) => { if (e.target.closest('button')) return; row.querySelector('.laCrMore').classList.toggle('hidden'); }; });
    q('laCr').querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => copyA(licaCrashText(list[+b.dataset.copy])); });
    q('laCr').querySelectorAll('[data-fix]').forEach((b) => { b.onclick = () => { const g = list[+b.dataset.fix], f = fixed(), i = f.indexOf(g.sig); if (i >= 0) f.splice(i, 1); else f.push(g.sig); localStorage.setItem('licCrashFixed', JSON.stringify(f.slice(-500))); drawCr(); }; });
  };
  const loadCr = () => {
    if (!root.isConnected) return;
    q('laCrS').textContent = 'جارٍ التحميل…';
    licaCrashes().then((g) => { crGroups = g; drawCr(); setTimeout(() => localStorage.setItem('licCrashSeen', String(Date.now())), 4000); })
      .catch((e) => { if (q('laCrS')) q('laCrS').textContent = e && e.message === 'rules' ? '⚠️ انشر قواعد Firebase الجديدة (فيها crash) لترى الأعطال' : '⚠️ تعذّر التحميل — تحقق من الإنترنت'; });
  };
  q('laCrGo').onclick = loadCr;
  q('laCrAll').onclick = () => { crShowAll = !crShowAll; drawCr(); };
  loadCr();
  if (typeof window.licaWatch === 'function') window.licaWatch();
  q('laMake').onclick = async () => {
    const dev = licaCleanDev(q('laDev').value);
    if (!dev) { msgA('رقم الجهاز غير صحيح — 12 حرفًا ورقمًا مثل AB3D-EF4H-JK5M'); return; }
    let code; try { code = await licaMake(dev, 'F', '0'); } catch (e) { msgA('المفتاح السري غير موجود على هذا الجهاز'); return; }
    const name = q('laName').value.trim(), tel = q('laTel').value.replace(/[^\d]/g, '');
    LICA.log = LICA.log.filter((r) => r.dev !== dev).concat([{ dev, name, code, t: Date.now() }]);
    licaSaveLog();
    const text = licaBuyerText(dev, code);
    q('laOut').innerHTML = `<div class="laCode" dir="ltr">${code}</div><div class="btnRow"><button class="chip go" id="laCopy">📋 نسخ الرسالة</button>${tel ? '<button class="chip go" id="laWa">💬 إرسال عبر واتساب</button>' : ''}</div>`;
    q('laCopy').onclick = () => copyA(text);
    if (q('laWa')) q('laWa').onclick = () => openA('https://wa.me/' + (tel.startsWith('0') ? '964' + tel.slice(1) : tel) + '?text=' + encodeURIComponent(text));
    drawLog(); sync();
  };
  q('laBackup').onclick = () => saveA('mallah-licenses-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ app: 'mallah-admin', v: 1, at: Date.now(), log: LICA.log }, null, 1));
  q('laRestore').onclick = () => q('laFile').click();
  q('laFile').onchange = async () => {
    const f = q('laFile').files[0]; if (!f) return;
    try {
      const j = JSON.parse((await f.text()).replace(/^\uFEFF/, '')); if (!j || !Array.isArray(j.log)) throw 0;
      licaMerge(j.log);
      msgA('✓ استُعيد السجل (' + LICA.log.length + ')'); drawLog(); sync();
    } catch (e) { msgA('الملف ليس نسخة سجل من الإدارة'); }
  };
  q('laPin').onclick = () => licaPinSetup(root, () => licaPanel(root));
  q('laLockNow').onclick = () => { licaUnlocked = false; licaRender(root); };
  q('laForget').onclick = async () => { if (await confirmA('حذف المفتاح السري من هذا الجهاز؟ (احتفظ بنسخة منه أولًا)')) { localStorage.removeItem('licAdminKey'); LICA.key = null; msgA('حُذف المفتاح من هذا الجهاز'); } };
}

/* ---------------- the lock: fingerprint / face, or a PIN ---------------- */
// The host provides window.licaBio = { avail(), enroll(), verify() } (Android: the system fingerprint/face
// prompt; the installed web page: the phone's passkey prompt). Without it, the PIN alone.
let licaUnlocked = false, licaFails = 0, licaWait = 0, licaHidden = 0;
async function licaHash(pin, salt) { return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mallah-admin-pin|' + salt + '|' + pin))))); }
function licaRender(root) {
  if (!localStorage.getItem('licAdminPin')) return licaPinSetup(root, () => { licaUnlocked = true; licaPanel(root); });
  if (licaUnlocked) return licaPanel(root);
  root.innerHTML = `<div class="card laGate"><div class="laLockIc">🔒</div><b>الملاح — الإدارة</b><div class="s">افتح بالبصمة أو الوجه، أو أدخل رمز PIN</div>
    <button class="chip go laBio hidden" id="laBio">👆 فتح بالبصمة / الوجه</button>
    <div class="frm"><input type="password" id="laPinIn" inputmode="numeric" maxlength="8" placeholder="رمز PIN" autocomplete="off" dir="ltr" style="text-align:center;letter-spacing:6px;font-size:22px"></div>
    <div class="btnRow" style="justify-content:center"><button class="chip go" id="laPinGo">فتح</button></div></div>`;
  const q = (id) => root.querySelector('#' + id);
  const ok = () => { licaUnlocked = true; licaFails = 0; licaPanel(root); };
  const tryBio = async () => { try { if (await window.licaBio.verify()) ok(); } catch (e) {} };
  q('laPinGo').onclick = async () => {
    if (Date.now() < licaWait) { msgA('انتظر ' + Math.ceil((licaWait - Date.now()) / 1000) + ' ثانية'); return; }
    const p = JSON.parse(localStorage.getItem('licAdminPin'));
    if ((await licaHash(q('laPinIn').value, p.s)) === p.h) ok();
    else { q('laPinIn').value = ''; if (++licaFails >= 5) { licaWait = Date.now() + 30000; licaFails = 0; msgA('محاولات كثيرة — انتظر 30 ثانية'); } else msgA('رمز PIN غير صحيح'); }
  };
  q('laPinIn').onkeydown = (e) => { if (e.key === 'Enter') q('laPinGo').click(); };
  if (window.licaBio && localStorage.getItem('licAdminBio')) {
    window.licaBio.avail().then((a) => { if (!a) return; q('laBio').classList.remove('hidden'); q('laBio').onclick = tryBio; tryBio(); }).catch(() => {});
  }
}
function licaPinSetup(root, done) {
  root.innerHTML = `<div class="card laGate"><div class="laLockIc">🔐</div><b>حماية صفحة الإدارة</b><div class="s">اختر رمز PIN (4 إلى 8 أرقام) يُطلب عند فتحها. ويمكنك بعده تفعيل البصمة أو الوجه.</div>
    <div class="frm"><input type="password" id="laP1" inputmode="numeric" maxlength="8" placeholder="رمز PIN" dir="ltr" style="text-align:center;letter-spacing:6px;font-size:22px">
    <input type="password" id="laP2" inputmode="numeric" maxlength="8" placeholder="أعد كتابته" dir="ltr" style="text-align:center;letter-spacing:6px;font-size:22px;margin-top:8px"></div>
    <div class="btnRow" style="justify-content:center"><button class="chip go" id="laPSave">حفظ</button></div></div>`;
  const q = (id) => root.querySelector('#' + id);
  q('laPSave').onclick = async () => {
    const a = q('laP1').value, b = q('laP2').value;
    if (!/^\d{4,8}$/.test(a)) { msgA('رمز PIN من 4 إلى 8 أرقام'); return; }
    if (a !== b) { msgA('الرمزان غير متطابقين'); return; }
    const salt = Math.random().toString(36).slice(2);
    localStorage.setItem('licAdminPin', JSON.stringify({ s: salt, h: await licaHash(a, salt) }));
    msgA('✓ حُفظ رمز PIN');
    let bio = false; try { bio = window.licaBio && await window.licaBio.avail(); } catch (e) {}
    if (!bio) return done();
    root.innerHTML = `<div class="card laGate"><div class="laLockIc">👆</div><b>البصمة أو الوجه</b><div class="s">افتح الإدارة ببصمتك أو وجهك بدل كتابة الرمز في كل مرة.</div>
      <div class="btnRow" style="justify-content:center"><button class="chip go" id="laBioOn">تفعيل البصمة / الوجه</button><button class="chip" id="laBioNo">لاحقًا</button></div></div>`;
    root.querySelector('#laBioNo').onclick = done;
    root.querySelector('#laBioOn').onclick = async () => {
      try { if (await window.licaBio.enroll()) { localStorage.setItem('licAdminBio', '1'); msgA('✓ فُعّلت البصمة / الوجه'); } else msgA('لم تُفعَّل البصمة'); } catch (e) { msgA('لم تُفعَّل البصمة'); }
      done();
    };
  };
}
// back after a while away: locked again
document.addEventListener('visibilitychange', () => { if (document.hidden) licaHidden = Date.now(); else if (licaHidden && Date.now() - licaHidden > 60000) { licaUnlocked = false; if (typeof licaOnRelock === 'function') licaOnRelock(); } });
