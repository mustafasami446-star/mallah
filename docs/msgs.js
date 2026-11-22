'use strict';
/* الملاح — «رسائل المصمم»: يكتب المصمم من وضع المصمم رسالة إلى كل المستخدمين أو إلى مستخدم واحد
   (يختاره بالاسم من سجل التفعيل، ورقم جهازه بجانبه). تُوقَّع الرسالة بالمفتاح السري، فلا يقبل الملاح إلا رسائل
   المصمم الحقيقية. يفحص الهاتف كل ساعتين حتى والبرنامج مغلق ويُظهر إشعارًا، وتظهر في البرنامج بطاقةً
   وفي «📨 رسائل المصمم». حين يفتحها المستخدم يُسجَّل أنه قرأها، فيرى المصمم من قرأ.
   Firebase: /msgs/all/<id>, /msgs/to/<h>/<id> = {ti, b, t, x, s, u} · /msgread/<id>/<h> = time
   h = the first 24 hex of SHA-256("mallah-msg|" + device number) — the device number itself is never sent. */

const MSG = { h: '', box: store.get('msgBox', []), read: new Set(store.get('msgRead', [])), busy: false };
const msgSigned = (id, to, m) => 'mallah-msg|v1|' + id + '|' + to + '|' + m.t + '|' + m.x + '|' + (m.ti || '') + '|' + m.b;
async function msgHashOf(dev) { return licHex(await licSha('mallah-msg|' + dev)).slice(0, 24); }
async function msgVerify(id, to, m) {
  try {
    if (!m || typeof m.b !== 'string' || !m.s) return false;
    const key = await crypto.subtle.importKey('spki', unb64u(LIC.pub.replace(/\+/g, '-').replace(/\//g, '_')), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(m.s), licTe.encode(msgSigned(id, to, m)));
  } catch (e) { return false; }
}
function msgNative() {
  if (!(NATIVE && Android.msgConfig) || !MSG.h) return;
  try { Android.msgConfig(JSON.stringify({ db: TEAM_FB.db, h: MSG.h, pub: LIC.pub, seen: [...MSG.read].slice(-200) })); } catch (e) {}
}
async function msgGet(path) {
  try { const r = await fetch(TEAM_FB.db + path + '.json?t=' + Date.now()); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
/* fetch both boxes, keep the signed ones that have not expired */
async function msgCheck(show) {
  if (MSG.busy || !MSG.h || navigator.onLine === false) return;
  MSG.busy = true;
  try {
    await fbDb();
    const now = Date.now(), got = [];
    for (const to of ['all', MSG.h]) {
      const box = await msgGet(to === 'all' ? '/msgs/all' : '/msgs/to/' + to);
      if (!box || typeof box !== 'object') continue;
      for (const [id, m] of Object.entries(box)) {
        if (!(m.x > now) || m.t > now + 86400e3) continue;
        if (await msgVerify(id, to, m)) got.push({ id, ti: m.ti || '', b: m.b, t: m.t, x: m.x, one: to !== 'all' });
      }
    }
    MSG.box = got.sort((a, b) => b.t - a.t).slice(0, 50);
    store.set('msgBox', MSG.box);
    msgNative();
    msgBadge();
    if (show) { const n = MSG.box.filter((m) => !MSG.read.has(m.id)).reverse()[0]; if (n) msgCard(n); }
  } finally { MSG.busy = false; }
}
function msgMarkRead(m) {
  if (MSG.read.has(m.id)) return;
  MSG.read.add(m.id); store.set('msgRead', [...MSG.read].slice(-300));
  msgNative(); msgBadge();
  if (typeof fbReq === 'function') fbReq('PUT', '/msgread/' + m.id + '/' + MSG.h, { '.sv': 'timestamp' }).catch(() => {});
}
const msgWhen = (t) => new Date(t).toLocaleString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
function msgBody(b) {
  return esc(b).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="#" data-u="${u}">${u}</a>`).replace(/\n/g, '<br>');
}
function msgLinks(el) { el.querySelectorAll('[data-u]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openExt(a.dataset.u); }; }); }
/* one message, as a card over the app */
function msgCard(m) {
  document.getElementById('msgCard')?.remove();
  const el = document.createElement('div'); el.id = 'msgCard';
  el.innerHTML = `<div class="msgBox"><div class="msgHead"><span>📨</span><div><b>${esc(m.ti || 'رسالة من مصمم الملاح')}</b><div class="s">${m.one ? 'إليك خاصة · ' : ''}${msgWhen(m.t)}</div></div></div>
    <div class="msgText">${msgBody(m.b)}</div>
    <div class="btnRow"><button class="chip go" id="msgOk">تم</button>${MSG.box.length > 1 ? '<button class="chip" id="msgAll">📨 كل الرسائل</button>' : ''}</div></div>`;
  document.body.appendChild(el);
  msgLinks(el);
  msgMarkRead(m);
  $('msgOk').onclick = () => el.remove();
  if ($('msgAll')) $('msgAll').onclick = () => { el.remove(); openMsgs(); };
  el.onclick = (e) => { if (e.target === el) el.remove(); };
}
/* the inbox */
function openMsgs() {
  $('menuDrop').classList.add('hidden');
  let p = $('msgPanel');
  if (!p) {
    p = document.createElement('div'); p.id = 'msgPanel'; p.className = 'panel hidden';
    p.innerHTML = `<div class="panelHead"><button class="iconBtn" id="msgClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button><h2>📨 رسائل المصمم</h2></div><div class="panelBody" id="msgList"></div>`;
    document.body.appendChild(p);
    $('msgClose').onclick = () => p.classList.add('hidden');
  }
  document.querySelectorAll('.panel:not(.hidden)').forEach((x) => x.classList.add('hidden'));
  p.classList.remove('hidden');
  const draw = () => {
    $('msgList').innerHTML = MSG.box.length ? MSG.box.map((m) => `<div class="card msgItem${MSG.read.has(m.id) ? '' : ' new'}"><div class="msgHead"><span>${MSG.read.has(m.id) ? '✉️' : '📨'}</span><div><b>${esc(m.ti || 'رسالة من مصمم الملاح')}</b><div class="s">${m.one ? 'إليك خاصة · ' : ''}${msgWhen(m.t)}</div></div></div><div class="msgText">${msgBody(m.b)}</div></div>`).join('')
      : '<div class="note">لا رسائل الآن. حين يرسل مصمم الملاح رسالة تصلك إشعارًا وتظهر هنا.</div>';
    msgLinks($('msgList'));
    MSG.box.forEach(msgMarkRead);
  };
  draw();
  msgCheck(false).then(() => { if (!p.classList.contains('hidden')) draw(); });
}
window.msgHandleBack = () => {
  const c = $('msgCard'); if (c) { c.remove(); return true; }
  const p = $('msgPanel'); if (p && !p.classList.contains('hidden')) { p.classList.add('hidden'); return true; }
  return false;
};
function msgBadge() {
  const b = $('openMsgs'); if (!b) return;
  const n = MSG.box.filter((m) => !MSG.read.has(m.id)).length;
  let s = b.querySelector('.msgN'); if (!s) { s = document.createElement('span'); s.className = 'msgN'; b.appendChild(s); }
  s.textContent = n ? String(n) : ''; s.classList.toggle('hidden', !n);
}

/* the menu, the notification tap, and the checks */
{
  const s = $('openSettings');
  if (s) { const b = document.createElement('button'); b.id = 'openMsgs'; b.innerHTML = '<span style="font-size:19px;width:22px;text-align:center">📨</span>رسائل المصمم'; b.onclick = openMsgs; s.parentNode.insertBefore(b, s); }
  const _go = window.onWidgetGo;
  window.onWidgetGo = (k) => { if (k === 'msgs') { openMsgs(); return; } return _go && _go(k); };
  msgBadge();
}
(async () => {
  for (let i = 0; i < 60 && !LIC.dev; i++) await new Promise((r) => setTimeout(r, 500));
  if (!LIC.dev) return;
  MSG.h = await msgHashOf(LIC.dev);
  setTimeout(() => msgCheck(true), 9000);
  setInterval(() => msgCheck(true), 2 * 3600e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - (MSG.lastVis || 0) > 15 * 60e3) { MSG.lastVis = Date.now(); msgCheck(true); } });
})();

/* ---------------- designer mode: writing a message ---------------- */
let msgaSent = (() => { try { return JSON.parse(localStorage.getItem('licaMsgs') || '[]'); } catch (e) { return []; } })();
const msgaSave = () => localStorage.setItem('licaMsgs', JSON.stringify(msgaSent.slice(-100)));
async function msgaHashes() {
  const out = {};
  for (const r of LICA.log) out[await msgHashOf(r.dev)] = r;
  return out;
}
function msgaCard(root) {
  const c = document.createElement('div'); c.className = 'card'; c.id = 'laMsg';
  c.innerHTML = `<h3>📨 رسالة إلى المستخدمين</h3><div class="frm">
      <div class="seg" id="lmTo"><button class="sel" data-t="all">👥 الجميع</button><button data-t="one">👤 مستخدم واحد</button></div>
      <div id="lmOne" class="hidden"><label>ابحث بالاسم أو برقم الجهاز</label><input type="text" id="lmFind" placeholder="مثال: أحمد"><div id="lmPick"></div></div>
      <label>العنوان (اختياري)</label><input type="text" id="lmTi" maxlength="60" placeholder="مثال: تحديث جديد">
      <label>نص الرسالة</label><textarea id="lmB" rows="4" maxlength="1500" placeholder="اكتب رسالتك…"></textarea>
      <label>تبقى ظاهرة لمدة</label><div class="seg" id="lmX"><button data-d="7">أسبوع</button><button class="sel" data-d="30">شهر</button><button data-d="90">3 أشهر</button></div></div>
    <div class="btnRow"><button class="chip go" id="lmSend">📨 إرسال</button></div>
    <div class="s" style="padding:0 14px 8px">تصل خلال ساعتين على الأكثر (أو فورًا إذا كان الملاح مفتوحًا)، موقّعة بمفتاحك فلا يستطيع أحد تقليدها.</div>
    <h3 style="margin-top:6px">المُرسَلة</h3><div id="lmSent"></div>`;
  root.insertBefore(c, root.children[1] || null);
  const q = (id) => c.querySelector('#' + id);
  let to = 'all', who = null, days = 30;
  q('lmTo').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; to = b.dataset.t; q('lmTo').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); q('lmOne').classList.toggle('hidden', to !== 'one'); };
  q('lmX').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; days = +b.dataset.d; q('lmX').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); };
  const pick = () => {
    const f = q('lmFind').value.trim().toLowerCase().replace(/-/g, '');
    const list = LICA.log.slice().reverse().filter((r) => !f || (r.name || '').toLowerCase().includes(f) || r.dev.toLowerCase().replace(/-/g, '').includes(f)).slice(0, 8);
    q('lmPick').innerHTML = list.map((r) => `<div class="res lmRow${who && who.dev === r.dev ? ' on' : ''}" data-d="${r.dev}"><div style="flex:1;min-width:0"><div class="t">${escA(r.name || '— بلا اسم')}</div><div class="s" dir="ltr" style="text-align:right">${r.dev}</div></div>${who && who.dev === r.dev ? '✓' : ''}</div>`).join('') || '<div class="s" style="padding:6px 2px">لا أحد في السجل بهذا الاسم أو الرقم</div>';
    q('lmPick').querySelectorAll('[data-d]').forEach((x) => { x.onclick = () => { who = LICA.log.find((r) => r.dev === x.dataset.d); pick(); }; });
  };
  q('lmFind').oninput = pick; pick();
  q('lmSend').onclick = async () => {
    const b = q('lmB').value.trim(), ti = q('lmTi').value.trim();
    if (!b) { msgA('اكتب نص الرسالة'); return; }
    if (to === 'one' && !who) { msgA('اختر المستخدم من القائمة'); return; }
    const key = await licaKey().catch(() => null); if (!key) { msgA('المفتاح السري غير موجود على هذا الجهاز'); return; }
    const box = to === 'all' ? 'all' : await msgHashOf(who.dev);
    if (!(await uiConfirm(to === 'all' ? 'إرسال الرسالة إلى كل مستخدمي الملاح؟' : 'إرسال الرسالة إلى ' + (who.name || who.dev) + '؟', { ok: 'إرسال' }))) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t = Date.now(), x = t + days * 86400e3;
    const m = { ti, b, t, x };
    m.s = b64u(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, licTe.encode(msgSigned(id, box, m)))));
    try {
      const tok = await lsToken(); m.u = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).user_id;
      await lsReq('PUT', to === 'all' ? '/msgs/all/' + id : '/msgs/to/' + box + '/' + id, m);
    } catch (e) { msgA(e && e.message === 'rules' ? '⚠️ لم تُقبل الرسالة — أضف قواعد msgs في Firebase' : '⚠️ تعذّر الإرسال — تحقق من الإنترنت'); return; }
    msgaSent.push({ id, box, to: to === 'all' ? 'الجميع' : (who.name || who.dev), dev: to === 'all' ? '' : who.dev, ti, b, t, x }); msgaSave();
    q('lmB').value = ''; q('lmTi').value = '';
    msgA('✓ أُرسلت الرسالة'); drawSent();
  };
  const drawSent = async () => {
    const list = msgaSent.slice().reverse().slice(0, 15);
    q('lmSent').innerHTML = list.map((m) => `<div class="res lmSentRow"><div style="flex:1;min-width:0"><div class="t">${m.ti ? '<b>' + escA(m.ti) + '</b> · ' : ''}${escA(m.b.slice(0, 80))}${m.b.length > 80 ? '…' : ''}</div><div class="s">إلى ${escA(m.to)} · ${msgWhen(m.t)}${m.x < Date.now() ? ' · انتهت' : ''}</div><div class="s lmRead" data-r="${m.id}">⏳ …</div></div><button class="chip del" data-del="${m.id}">سحب</button></div>`).join('') || '<div class="s" style="padding:4px 14px 12px">لم ترسل رسائل من هذا الجهاز بعد</div>';
    q('lmSent').querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const m = msgaSent.find((x) => x.id === b.dataset.del); if (!m || !(await confirmA('سحب هذه الرسالة؟ لن تظهر لمن لم يقرأها بعد.'))) return;
        try { await lsReq('DELETE', m.box === 'all' ? '/msgs/all/' + m.id : '/msgs/to/' + m.box + '/' + m.id); } catch (e) { msgA('⚠️ تعذّر السحب'); return; }
        msgaSent = msgaSent.filter((x) => x !== m); msgaSave(); drawSent();
      };
    });
    let H = null;
    for (const m of list) {
      const el = q('lmSent').querySelector(`[data-r="${m.id}"]`); if (!el) continue;
      let r = null; try { r = await lsReq('GET', '/msgread/' + m.id); } catch (e) { el.textContent = ''; continue; }
      const hs = Object.keys(r || {});
      if (m.box !== 'all') { el.innerHTML = hs.length ? '✓✓ <b style="color:#86efac">قرأها</b> ' + msgWhen(r[hs[0]]) : '✓ لم يقرأها بعد'; continue; }
      if (!H) H = await msgaHashes();
      const names = hs.map((h) => H[h] && (H[h].name || H[h].dev)).filter(Boolean), other = hs.length - names.length;
      el.innerHTML = hs.length ? `👁 قرأها <b style="color:#86efac">${hs.length}</b>${names.length ? ': ' + names.slice(0, 12).map(escA).join('، ') + (names.length > 12 ? ' و' + (names.length - 12) + ' آخرون' : '') : ''}${other ? (names.length ? ' + ' : ' — ') + other + ' في فترة التجربة' : ''}` : '👁 لم يقرأها أحد بعد';
    }
  };
  drawSent();
}
{
  const _panel = licaPanel;
  licaPanel = function (root) {
    _panel(root);
    try { msgaCard(root); } catch (e) {}
  };
}
