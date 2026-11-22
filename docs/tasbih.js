'use strict';
/* الملاح — المسبحة: زر كبير تضغطه فيعدّ ويهتزّ الهاتف هزة خفيفة.
   تسبيح الزهراء عليها السلام: الله أكبر 34، ثم الحمد لله 33، ثم سبحان الله 33 — ينتقل وحده من ذكر إلى الذي بعده.
   والعدّ المفتوح بلا حد، وأذكار تضيفها أنت بعددها. يبقى العدّ محفوظًا لو أغلقت البرنامج. */

const TSB_ZAHRA = [['الله أكبر', 34], ['الحمد لله', 33], ['سبحان الله', 33]];
let tsb = Object.assign({ mode: 'zahra', i: 0, n: 0, day: '', today: 0, custom: [] }, store.get('tsb', {}));
const tsbSave = () => store.set('tsb', tsb);
const tsbDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
/* the stages of the chosen tasbih: [[text, count]]; count 0 = no limit */
function tsbStages() {
  if (tsb.mode === 'zahra') return TSB_ZAHRA;
  const c = tsb.custom.find((x) => x.id === tsb.mode);
  if (c) return [[c.t, c.n]];
  return [['', 0]];
}
const tsbBuzz = (p) => { try { if (NATIVE && Android.vibrate) Android.vibrate(p); else if (navigator.vibrate) navigator.vibrate(p.split(',').map(Number)); } catch (e) {} };
const tsbNum = (n) => n.toLocaleString('ar-IQ-u-nu-latn');

function openTasbih() {
  $('menuDrop').classList.add('hidden');
  let el = $('tsbPanel');
  if (!el) {
    el = document.createElement('div'); el.id = 'tsbPanel'; el.className = 'panel hidden';
    el.innerHTML = `<div class="panelHead"><button class="iconBtn" id="tsbClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button><h2>📿 المسبحة</h2></div>
      <div class="panelBody" id="tsbBody"></div>`;
    document.body.appendChild(el);
    $('tsbClose').onclick = () => el.classList.add('hidden');
  }
  document.querySelectorAll('.panel:not(.hidden)').forEach((p) => p.classList.add('hidden'));
  el.classList.remove('hidden');
  tsbRender();
}
window.tsbHandleBack = () => { const el = $('tsbPanel'); if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); return true; } return false; };

function tsbRender() {
  const body = $('tsbBody'); if (!body) return;
  if (tsb.day !== tsbDay()) { tsb.day = tsbDay(); tsb.today = 0; tsbSave(); }
  const S = tsbStages(), st = S[Math.min(tsb.i, S.length - 1)], lim = st[1], done = lim && tsb.i >= S.length - 1 && tsb.n >= lim;
  const chips = [['zahra', 'تسبيح الزهراء ع'], ['free', 'عدّ مفتوح'], ...tsb.custom.map((c) => [c.id, c.t])];
  const ring = lim ? Math.min(1, tsb.n / lim) : 0, R = 118, L = 2 * Math.PI * R;
  body.innerHTML = `
    <div class="tsbChips">${chips.map(([k, t]) => `<button class="chip${tsb.mode === k ? ' on' : ''}" data-m="${esc(k)}">${esc(t)}</button>`).join('')}<button class="chip" data-m="+">＋ ذكر</button></div>
    ${tsb.mode === 'zahra' ? `<div class="tsbSteps">${S.map(([t, n], i) => `<span class="${i < tsb.i || (i === tsb.i && done) ? 'd' : i === tsb.i ? 'on' : ''}">${t} <b>${tsbNum(n)}</b></span>`).join('<i>←</i>')}</div>` : ''}
    <button class="tsbBtn${done ? ' fin' : ''}" id="tsbTap" aria-label="سبّح">
      <svg viewBox="0 0 260 260"><circle cx="130" cy="130" r="${R}" fill="none" stroke="rgba(148,163,184,.2)" stroke-width="10"/>
        ${lim ? `<circle cx="130" cy="130" r="${R}" fill="none" stroke="${done ? '#22c55e' : '#0ea5e9'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(L * ring).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 130 130)"/>` : ''}</svg>
      <div class="tsbIn">${done ? '<div class="tsbT">تقبّل الله</div><div class="tsbN">✓</div><div class="s">اضغط للبدء من جديد</div>'
        : `<div class="tsbT">${esc(st[0] || 'اضغط للعدّ')}</div><div class="tsbN">${tsbNum(tsb.n)}</div><div class="s">${lim ? 'من ' + tsbNum(lim) : 'بلا حدّ'}</div>`}</div>
    </button>
    <div class="btnRow tsbRow"><button class="chip" id="tsbUndo">↶ تراجع</button><button class="chip" id="tsbReset">⟲ من البداية</button>${tsb.custom.some((c) => c.id === tsb.mode) ? '<button class="chip" id="tsbDel">🗑 حذف هذا الذكر</button>' : ''}</div>
    <div class="s" style="text-align:center;padding:4px 14px 14px">مجموع ما سبّحت اليوم: <b>${tsbNum(tsb.today)}</b> · يبقى العدّ محفوظًا لو أغلقت الملاح</div>`;
  body.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => (b.dataset.m === '+' ? tsbAdd() : tsbMode(b.dataset.m)); });
  $('tsbTap').onclick = tsbTap;
  $('tsbUndo').onclick = () => {
    if (tsb.n > 0) { tsb.n--; tsb.today = Math.max(0, tsb.today - 1); } else if (tsb.i > 0) { tsb.i--; tsb.n = tsbStages()[tsb.i][1] - 1; tsb.today = Math.max(0, tsb.today - 1); }
    tsbSave(); tsbRender();
  };
  $('tsbReset').onclick = () => { tsb.i = 0; tsb.n = 0; tsbSave(); tsbRender(); };
  if ($('tsbDel')) $('tsbDel').onclick = async () => { if (await uiConfirm('حذف هذا الذكر من المسبحة؟', { ok: 'حذف' })) { tsb.custom = tsb.custom.filter((c) => c.id !== tsb.mode); tsbMode('zahra'); } };
}
function tsbMode(m) { if (tsb.mode !== m) { tsb.mode = m; tsb.i = 0; tsb.n = 0; tsbSave(); } tsbRender(); }
function tsbTap() {
  const S = tsbStages(), lim = S[tsb.i][1];
  if (lim && tsb.i >= S.length - 1 && tsb.n >= lim) { tsb.i = 0; tsb.n = 0; tsbSave(); tsbRender(); return; }   // finished: start again
  tsb.n++; tsb.today++;
  if (lim && tsb.n >= lim) {
    if (tsb.i < S.length - 1) { tsb.i++; tsb.n = 0; tsbBuzz('90,70,90'); toast(S[tsb.i][0] + ' × ' + tsbNum(S[tsb.i][1]), 1500); }
    else tsbBuzz('120,80,120,80,200');
  } else tsbBuzz(tsb.n % 33 === 0 && !lim ? '80' : '18');
  tsbSave(); tsbRender();
}
async function tsbAdd() {
  const t = await uiPrompt('📿 الذكر الذي تريد عدّه', '', { ok: 'التالي', placeholder: 'مثلًا: أستغفر الله، اللهم صلِّ على محمد وآل محمد' });
  if (t == null || !t.trim()) return;
  const n = await uiPrompt('كم مرة؟ (اتركه فارغًا لعدٍّ بلا حد)', '100', { ok: 'حفظ', type: 'number' });
  if (n == null) return;
  const c = { id: 'c' + Date.now().toString(36), t: t.trim().slice(0, 60), n: Math.max(0, Math.min(100000, parseInt(n, 10) || 0)) };
  tsb.custom.push(c); tsbMode(c.id);
}

/* the menu (☰), and a button in the prayer panel */
{
  const s = $('openSettings');
  if (s) {
    const b = document.createElement('button'); b.id = 'openTasbih';
    b.innerHTML = '<span style="font-size:19px;width:22px;text-align:center">📿</span>المسبحة';
    b.onclick = openTasbih; s.parentNode.insertBefore(b, s);
  }
  if (typeof prRender === 'function') {
    const _r = prRender;
    prRender = function () {
      _r();
      const q = document.querySelector('#prBody .prQibla .btnRow'); if (!q || q.querySelector('#prTsb')) return;
      const b = document.createElement('button'); b.className = 'chip'; b.id = 'prTsb'; b.textContent = '📿 المسبحة'; b.onclick = openTasbih; q.appendChild(b);
    };
  }
}
