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
/* the people a sent message went to: [{dev, h, id, name}] (null = everyone) */
const msgaRcp = (m) => m.rcp || (m.box === 'all' ? null : [{ dev: m.dev, h: m.box, id: m.id, name: m.to }]);
const msgaDay = (t) => new Date(t).toLocaleDateString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
function msgaCard(root) {
  const c = document.createElement('div'); c.className = 'card'; c.id = 'laMsg';
  c.innerHTML = `<h3>📨 رسالة إلى المستخدمين</h3><div class="frm">
      <div class="seg" id="lmTo"><button class="sel" data-t="all">👥 الجميع</button><button data-t="one">👤 مستخدمون محددون</button></div>
      <div id="lmOne" class="hidden"><label>إلى</label><div class="lmDrop" id="lmDrop" role="button" tabindex="0"></div><div class="lmList hidden" id="lmList"></div></div>
      <label>العنوان (اختياري)</label><input type="text" id="lmTi" maxlength="60" placeholder="مثال: تحديث جديد">
      <label>نص الرسالة</label><textarea id="lmB" rows="4" maxlength="1500" placeholder="اكتب رسالتك…"></textarea>
      <label>تبقى ظاهرة لمدة</label><div class="seg" id="lmX"><button data-d="7">أسبوع</button><button class="sel" data-d="30">شهر</button><button data-d="90">3 أشهر</button></div></div>
    <div class="btnRow"><button class="chip go" id="lmSend">📨 إرسال</button></div>
    <div class="s" style="padding:0 14px 8px">تصل خلال ساعتين على الأكثر (أو فورًا إذا كان الملاح مفتوحًا)، موقّعة بمفتاحك فلا يستطيع أحد تقليدها.</div>
    <h3 style="margin-top:6px">المُرسَلة</h3><div id="lmSent"></div>`;
  root.insertBefore(c, root.children[1] || null);
  const q = (id) => c.querySelector('#' + id);
  let to = 'all', days = 30, find = '';
  const chosen = new Set();             // device numbers
  const readOf = {};                    // dev → {t, read} of the last message sent to them
  // everyone in the activation log, once each (the latest entry), alphabetically
  const people = () => {
    const by = {};
    LICA.log.forEach((r) => { if (!by[r.dev] || r.t > by[r.dev].t) by[r.dev] = r; });
    return Object.values(by).sort((x, y) => (x.name || '￿').localeCompare(y.name || '￿', 'ar') || x.dev.localeCompare(y.dev));
  };
  const nameOf = (dev) => { const r = people().find((x) => x.dev === dev); return (r && r.name) || dev; };
  const drawDrop = () => {
    q('lmDrop').innerHTML = chosen.size
      ? [...chosen].map((d) => `<span class="lmTag">${escA(nameOf(d))}<i data-x="${d}">✕</i></span>`).join('') + '<span class="lmArr">▾</span>'
      : '<span class="lmPh">اختر المستخدمين</span><span class="lmArr">▾</span>';
  };
  const readTxt = (dev) => {
    const r = readOf[dev]; if (r === undefined) return '';
    if (!r) return '';
    return r.read ? `<span class="lmOk">✓✓ قرأ آخر رسالة</span>` : `<span class="lmNo">✓ لم يقرأ آخر رسالة (${msgWhen(r.t)})</span>`;
  };
  const drawList = () => {
    const f = find.trim().toLowerCase().replace(/-/g, ''), all = people();
    const list = all.filter((r) => !f || (r.name || '').toLowerCase().includes(f) || r.dev.toLowerCase().replace(/-/g, '').includes(f));
    const el = q('lmList');
    const keep = el.querySelector('#lmFind');
    if (!keep) {
      el.innerHTML = `<div class="lmTop"><input type="text" id="lmFind" placeholder="🔎 ابحث بالاسم أو برقم الجهاز"></div><div id="lmRows"></div>
        <div class="lmFoot"><button class="chip" id="lmAll">تحديد الظاهرين</button><button class="chip" id="lmNone">إلغاء التحديد</button><button class="chip go" id="lmDone">تم</button></div>`;
      q('lmFind').oninput = () => { find = q('lmFind').value; drawList(); };
      q('lmAll').onclick = () => { people().filter((r) => !find.trim() || q('lmRows').querySelector(`[data-d="${r.dev}"]`)).forEach((r) => chosen.add(r.dev)); drawList(); drawDrop(); };
      q('lmNone').onclick = () => { chosen.clear(); drawList(); drawDrop(); };
      q('lmDone').onclick = () => { el.classList.add('hidden'); };
    }
    q('lmRows').innerHTML = list.map((r) => `<div class="lmRow${chosen.has(r.dev) ? ' on' : ''}" data-d="${r.dev}"><span class="lmChk">${chosen.has(r.dev) ? '✓' : ''}</span>
        <div style="flex:1;min-width:0"><div class="t">${escA(r.name || '— بلا اسم')}</div><div class="s"><span dir="ltr">${r.dev}</span> · فُعّل ${msgaDay(r.t)}</div><div class="s">${readTxt(r.dev)}</div></div></div>`).join('')
      || `<div class="s" style="padding:10px">${all.length ? 'لا أحد بهذا الاسم أو الرقم' : 'سجل التفعيل فارغ — من تفعّله يظهر هنا'}</div>`;
    q('lmDone').textContent = chosen.size ? 'تم (' + chosen.size + ')' : 'تم';
    q('lmRows').querySelectorAll('[data-d]').forEach((x) => { x.onclick = () => { const d = x.dataset.d; chosen.has(d) ? chosen.delete(d) : chosen.add(d); drawList(); drawDrop(); }; });
  };
  // whether each one read the last message you sent them (looked up when the list opens)
  let readBusy = false;
  const loadRead = async () => {
    if (readBusy) return; readBusy = true;
    const last = {};
    msgaSent.forEach((m) => (msgaRcp(m) || []).forEach((r) => { if (!last[r.dev] || m.t > last[r.dev].t) last[r.dev] = { t: m.t, h: r.h, id: r.id }; }));
    for (const r of people()) {
      const l = last[r.dev]; if (!l) { readOf[r.dev] = null; continue; }
      if (readOf[r.dev] && readOf[r.dev].read) continue;
      try { const v = await lsReq('GET', '/msgread/' + l.id + '/' + l.h); readOf[r.dev] = { t: l.t, read: !!v }; } catch (e) { break; }
      if (!q('lmList').classList.contains('hidden')) drawList();
    }
    readBusy = false;
  };
  q('lmDrop').onclick = (e) => {
    const x = e.target.closest('[data-x]');
    if (x) { chosen.delete(x.dataset.x); drawDrop(); if (!q('lmList').classList.contains('hidden')) drawList(); return; }
    const L = q('lmList'); L.classList.toggle('hidden');
    if (!L.classList.contains('hidden')) { drawList(); loadRead(); }
  };
  drawDrop();
  q('lmTo').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; to = b.dataset.t; q('lmTo').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); q('lmOne').classList.toggle('hidden', to !== 'one'); };
  q('lmX').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; days = +b.dataset.d; q('lmX').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); };
  const sign = async (key, id, box, m) => b64u(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, licTe.encode(msgSigned(id, box, m)))));
  q('lmSend').onclick = async () => {
    const b = q('lmB').value.trim(), ti = q('lmTi').value.trim();
    if (!b) { msgA('اكتب نص الرسالة'); return; }
    if (to === 'one' && !chosen.size) { msgA('اختر مستخدمًا واحدًا على الأقل من القائمة'); return; }
    const key = await licaKey().catch(() => null); if (!key) { msgA('المفتاح السري غير موجود على هذا الجهاز'); return; }
    const devs = [...chosen], names = devs.map(nameOf);
    const ask = to === 'all' ? 'إرسال الرسالة إلى كل مستخدمي الملاح؟' : devs.length === 1 ? 'إرسال الرسالة إلى ' + names[0] + '؟' : 'إرسال الرسالة إلى ' + devs.length + ' مستخدمين:\n' + names.join('، ') + '؟';
    if (!(await uiConfirm(ask, { ok: 'إرسال' }))) return;
    const base = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t = Date.now(), x = t + days * 86400e3;
    let u;
    try { const tok = await lsToken(); u = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).user_id; } catch (e) { msgA('⚠️ تعذّر الإرسال — تحقق من الإنترنت'); return; }
    const fail = (e) => msgA(e && e.message === 'rules' ? '⚠️ لم تُقبل الرسالة — أضف قواعد msgs في Firebase' : '⚠️ تعذّر الإرسال — تحقق من الإنترنت');
    if (to === 'all') {
      const m = { ti, b, t, x, u }; m.s = await sign(key, base, 'all', m);
      try { await lsReq('PUT', '/msgs/all/' + base, m); } catch (e) { fail(e); return; }
      msgaSent.push({ id: base, box: 'all', to: 'الجميع', ti, b, t, x });
    } else {
      const rcp = [];
      for (let i = 0; i < devs.length; i++) {
        const h = await msgHashOf(devs[i]), id = devs.length === 1 ? base : base + '-' + i;
        const m = { ti, b, t, x, u }; m.s = await sign(key, id, h, m);
        try { await lsReq('PUT', '/msgs/to/' + h + '/' + id, m); } catch (e) { fail(e); if (!rcp.length) return; break; }
        rcp.push({ dev: devs[i], h, id, name: names[i] });
        readOf[devs[i]] = { t, read: false };
      }
      msgaSent.push({ id: base, box: 'to', rcp, to: rcp.length === 1 ? rcp[0].name : rcp.length + ' مستخدمين', ti, b, t, x });
      if (rcp.length < devs.length) msgA('⚠️ وصلت إلى ' + rcp.length + ' من ' + devs.length + ' فقط');
    }
    msgaSave();
    q('lmB').value = ''; q('lmTi').value = ''; chosen.clear(); drawDrop(); q('lmList').classList.add('hidden');
    msgA('✓ أُرسلت الرسالة'); drawSent();
  };
  const drawSent = async () => {
    const list = msgaSent.slice().reverse().slice(0, 15);
    q('lmSent').innerHTML = list.map((m) => `<div class="res lmSentRow"><div style="flex:1;min-width:0"><div class="t">${m.ti ? '<b>' + escA(m.ti) + '</b> · ' : ''}${escA(m.b.slice(0, 80))}${m.b.length > 80 ? '…' : ''}</div><div class="s">إلى ${escA(m.to)} · ${msgWhen(m.t)}${m.x < Date.now() ? ' · انتهت' : ''}</div><div class="s lmRead" data-r="${m.id}">⏳ …</div></div><button class="chip del" data-del="${m.id}">سحب</button></div>`).join('') || '<div class="s" style="padding:4px 14px 12px">لم ترسل رسائل من هذا الجهاز بعد</div>';
    q('lmSent').querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const m = msgaSent.find((x) => x.id === b.dataset.del); if (!m || !(await confirmA('سحب هذه الرسالة؟ لن تظهر لمن لم يقرأها بعد.'))) return;
        try {
          const R = msgaRcp(m);
          if (!R) await lsReq('DELETE', '/msgs/all/' + m.id);
          else for (const r of R) await lsReq('DELETE', '/msgs/to/' + r.h + '/' + r.id);
        } catch (e) { msgA('⚠️ تعذّر السحب'); return; }
        msgaSent = msgaSent.filter((x) => x !== m); msgaSave(); drawSent();
      };
    });
    let H = null;
    for (const m of list) {
      const el = q('lmSent').querySelector(`[data-r="${m.id}"]`); if (!el) continue;
      const R = msgaRcp(m);
      try {
        if (R) {
          const st = [];
          for (const r of R) { const v = await lsReq('GET', '/msgread/' + r.id + '/' + r.h); st.push({ n: r.name, v }); readOf[r.dev] = readOf[r.dev] && readOf[r.dev].t > m.t ? readOf[r.dev] : { t: m.t, read: !!v }; }
          const n = st.filter((x) => x.v).length;
          el.innerHTML = R.length === 1 ? (n ? '✓✓ <b style="color:#86efac">قرأها</b> ' + msgWhen(st[0].v) : '✓ لم يقرأها بعد')
            : `👁 قرأها <b style="color:#86efac">${n}</b> من ${R.length}: ` + st.map((x) => escA(x.n) + (x.v ? ' <span class="lmOk">✓✓</span>' : ' <span class="lmNo">✓</span>')).join('، ');
          continue;
        }
        const r = await lsReq('GET', '/msgread/' + m.id), hs = Object.keys(r || {});
        if (!H) H = await msgaHashes();
        const names = hs.map((h) => H[h] && (H[h].name || H[h].dev)).filter(Boolean), other = hs.length - names.length;
        el.innerHTML = hs.length ? `👁 قرأها <b style="color:#86efac">${hs.length}</b>${names.length ? ': ' + names.slice(0, 12).map(escA).join('، ') + (names.length > 12 ? ' و' + (names.length - 12) + ' آخرون' : '') : ''}${other ? (names.length ? ' + ' : ' — ') + other + ' في فترة التجربة' : ''}` : '👁 لم يقرأها أحد بعد';
      } catch (e) { el.textContent = ''; }
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
