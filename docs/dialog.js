'use strict';
/* الملاح — نوافذ التأكيد والإدخال الخاصة بالتطبيق، بدل نوافذ المتصفح (التي تكتب «تشير صفحة https://…»).
   uiConfirm(msg, {ok, cancel, danger}) → Promise<boolean>
   uiPrompt(msg, value, {ok, type, placeholder}) → Promise<string|null>
   uiAlert(msg) → Promise<void> */
(function () {
  const css = `
#uiDlg{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:18px}
#uiDlg .bg{position:absolute;inset:0;background:rgba(2,6,23,.62);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
#uiDlg .box{position:relative;width:100%;max-width:380px;background:var(--panel,#111c33);color:var(--text,#e7eefc);border:1px solid var(--line,#2a3b61);
  border-radius:20px;padding:18px 16px 12px;box-shadow:0 18px 50px rgba(0,0,0,.5);direction:rtl;animation:uiDlgIn .16s ease-out}
@keyframes uiDlgIn{from{transform:scale(.94);opacity:0}to{transform:none;opacity:1}}
#uiDlg .hd{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted,#93a4c6);margin-bottom:8px}
#uiDlg .hd img{width:20px;height:20px;border-radius:6px}
#uiDlg .msg{font-size:16px;line-height:1.6;white-space:pre-line;word-break:break-word;max-height:50vh;overflow:auto}
#uiDlg input{width:100%;margin-top:12px;padding:12px;border-radius:12px;border:1px solid var(--line,#2a3b61);background:var(--bg,#0f172a);color:inherit;font:inherit;font-size:16px;direction:auto;outline:none}
#uiDlg input:focus{border-color:var(--accent,#38bdf8)}
#uiDlg .btns{display:flex;gap:8px;margin-top:16px}
#uiDlg .btns button{flex:1;padding:12px;border-radius:12px;border:0;font:inherit;font-size:15.5px;font-weight:600;cursor:pointer}
#uiDlg .ok{background:var(--accent2,#0ea5e9);color:#fff}
#uiDlg .ok.danger{background:var(--danger,#ef4444)}
#uiDlg .no{background:var(--panel2,#1b2a4a);color:var(--text,#e7eefc)}
`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const queue = [];
  let open = false;
  function show(kind, msg, value, o) {
    return new Promise((resolve) => { queue.push({ kind, msg, value, o: o || {}, resolve }); next(); });
  }
  function next() {
    if (open || !queue.length) return;
    open = true;
    const d = queue.shift(), o = d.o;
    const w = document.createElement('div'); w.id = 'uiDlg';
    w.innerHTML = `<div class="bg"></div><div class="box" role="dialog" aria-modal="true">
      <div class="hd"><img src="icon-192.png" alt="" onerror="this.remove()">الملاح</div>
      <div class="msg">${escH(d.msg)}</div>
      ${d.kind === 'prompt' ? `<input type="${o.type || 'text'}" ${o.type === 'password' || o.num ? 'inputmode="numeric"' : ''} placeholder="${escH(o.placeholder || '')}" autocomplete="off">` : ''}
      <div class="btns"><button class="ok${o.danger ? ' danger' : ''}">${escH(o.ok || 'حسنًا')}</button>${d.kind === 'alert' ? '' : `<button class="no">${escH(o.cancel || 'إلغاء')}</button>`}</div></div>`;
    document.body.appendChild(w);
    const inp = w.querySelector('input');
    if (inp) { inp.value = d.value == null ? '' : String(d.value); setTimeout(() => { inp.focus(); try { inp.select(); } catch (e) {} }, 60); }
    else setTimeout(() => w.querySelector('.ok').focus(), 30);
    const done = (ok) => {
      if (!w.parentNode) return;
      w.remove(); open = false; document.removeEventListener('keydown', key, true);
      d.resolve(d.kind === 'prompt' ? (ok ? inp.value : null) : d.kind === 'confirm' ? !!ok : undefined);
      setTimeout(next, 0);
    };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } else if (e.key === 'Enter' && (inp || document.activeElement === w.querySelector('.ok'))) { e.preventDefault(); done(true); } };
    document.addEventListener('keydown', key, true);
    w.querySelector('.ok').onclick = () => done(true);
    const no = w.querySelector('.no'); if (no) no.onclick = () => done(false);
    w.querySelector('.bg').onclick = () => done(d.kind === 'alert');
    window.uiDlgBack = () => { done(false); return true; };
  }
  window.uiConfirm = (msg, o) => show('confirm', msg, null, o);
  window.uiPrompt = (msg, value, o) => show('prompt', msg, value, o);
  window.uiAlert = (msg, o) => show('alert', msg, null, o);
  window.uiDlgOpen = () => open;
  // the Android back button closes it like «إلغاء»
  const hb = () => { const h = window.handleBack; if (h && h.__ui) return; window.handleBack = function () { if (open && window.uiDlgBack) return window.uiDlgBack(); return h ? h.apply(this, arguments) : false; }; window.handleBack.__ui = 1; };
  window.addEventListener('load', hb); setTimeout(hb, 0);
})();
