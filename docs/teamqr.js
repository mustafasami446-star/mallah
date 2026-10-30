'use strict';
/* الملاح — دعوة الفريق برمز QR: عرض الرمز ومشاركته كصورة، ومسحه بالكاميرا للانضمام.
   The QR holds the invitation link, so a phone's own camera opens the web version too. */

const inviteLink = (code) => 'https://mustafasami446-star.github.io/mallah/?team=' + code;
let qrLib = null, jsqrLib = null;
const needQr = () => qrLib || (qrLib = loadScript('lib/qrcode.min.js'));
const needJsQR = () => jsqrLib || (jsqrLib = loadScript('lib/jsQR.min.js'));

/* the invitation card as a picture: title, the code square, the text code */
async function qrCanvas() {
  await needQr();
  const q = qrcode(0, 'M'); q.addData(inviteLink(team.code)); q.make();
  const n = q.getModuleCount(), cell = Math.floor(640 / (n + 8)), size = cell * (n + 8);
  const W = size + 80, H = size + 300, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#0f172a'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#ffffff'; x.beginPath(); x.roundRect ? x.roundRect(40, 120, size, size, 28) : x.rect(40, 120, size, size); x.fill();
  x.fillStyle = '#0b1220';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect(40 + (k + 4) * cell, 120 + (r + 4) * cell, cell, cell);
  x.direction = 'rtl'; x.textAlign = 'center';
  x.fillStyle = '#e0f2fe'; x.font = '700 40px Plex, system-ui, sans-serif';
  x.fillText('👥 ' + (teamView.name || 'الفريق'), W / 2, 72);
  x.fillStyle = '#94a3b8'; x.font = '500 26px Plex, system-ui, sans-serif';
  x.fillText('امسح الرمز للانضمام إلى المجموعة في تطبيق الملاح', W / 2, size + 175);
  x.direction = 'ltr'; x.fillStyle = '#7dd3fc'; x.font = '700 34px monospace';
  x.fillText(team.code, W / 2, size + 232);
  x.direction = 'rtl'; x.fillStyle = '#64748b'; x.font = '500 22px Plex, system-ui, sans-serif';
  x.fillText('الملاح — ملاحتك بالعربي', W / 2, size + 276);
  return c;
}
async function showQr() {
  if (!team) return;
  let c; try { c = await qrCanvas(); } catch (e) { toast('تعذّر إنشاء رمز QR'); return; }
  const el = document.createElement('div'); el.id = 'qrBox';
  el.innerHTML = `<div class="qrCard"><img alt="رمز QR للمجموعة"><div class="qrBtns"><button class="chip go" id="qrShare">📤 مشاركة كصورة</button><button class="chip" id="qrClose">إغلاق</button></div>
    <div class="s">اعرضه لزملائك ليمسحوه من «👥 الفريق» ← «📷 مسح رمز QR»، أو بكاميرا الهاتف العادية فتُفتح نسخة الويب. من يمسحه يمكنه الانضمام، فلا تنشره علنًا.</div></div>`;
  el.querySelector('img').src = c.toDataURL('image/png');
  document.body.appendChild(el);
  const close = () => el.remove();
  el.onclick = (e) => { if (e.target === el) close(); };
  $('qrClose').onclick = close;
  $('qrShare').onclick = async () => {
    const text = '👥 انضم إلى مجموعتي «' + teamView.name + '» في الملاح — امسح الرمز أو افتح الرابط:\n' + inviteLink(team.code) + '\nرمز المجموعة: ' + team.code;
    const data = c.toDataURL('image/png').split(',')[1];
    if (NATIVE && Android.shareImage) { if (!Android.shareImage(data, 'mallah-team-qr.png', text)) toast('تعذّرت المشاركة'); return; }
    try {
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const file = new File([blob], 'mallah-team-qr.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mallah-team-qr.png'; a.click();
      toast('✓ حُفظت الصورة في التنزيلات');
    } catch (e) { /* cancelled */ }
  };
}
window.qrHandleBack = () => { const b = $('qrBox') || $('qrScan'); if (!b) return false; if (b.id === 'qrScan') stopScan(); else b.remove(); return true; };

/* ---------------- scanning ---------------- */
let scan = null;
async function startScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('الكاميرا غير متاحة على هذا الجهاز'); return; }
  const el = document.createElement('div'); el.id = 'qrScan';
  el.innerHTML = '<video playsinline muted></video><div class="qrFrame"></div><div class="qrHint">وجّه الكاميرا إلى رمز QR للمجموعة</div><button class="chip" id="qrStop">إلغاء</button>';
  document.body.appendChild(el);
  $('qrStop').onclick = stopScan;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = el.querySelector('video'); v.srcObject = stream; await v.play();
    let det = null;
    try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) det = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) {}
    if (!det) await needJsQR();
    scan = { stream, el, det, cv: document.createElement('canvas'), on: true };
    scanLoop();
  } catch (e) {
    stopScan();
    toast(e && e.name === 'NotAllowedError' ? 'لم يُسمح باستخدام الكاميرا' : 'تعذّر تشغيل الكاميرا', 4000);
  }
}
async function scanLoop() {
  if (!scan || !scan.on) return;
  const v = scan.el.querySelector('video');
  let text = null;
  try {
    if (v.readyState >= 2) {
      if (scan.det) { const r = await scan.det.detect(v); if (r && r[0]) text = r[0].rawValue; }
      else {
        const w = Math.min(800, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
        scan.cv.width = w; scan.cv.height = h;
        const x = scan.cv.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, w, h);
        const r = jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (r) text = r.data;
      }
    }
  } catch (e) {}
  if (text) {
    const code = cleanCode(text);
    if (code) { gotCode(code); return; }
    scan.el.querySelector('.qrHint').textContent = 'هذا الرمز ليس رمز مجموعة من الملاح';
  }
  setTimeout(() => requestAnimationFrame(scanLoop), 120);
}
function stopScan() {
  if (scan) { scan.on = false; try { scan.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} }
  scan = null;
  const el = $('qrScan'); if (el) el.remove();
}
function gotCode(code) {
  try { Android.vibrate && Android.vibrate('60'); } catch (e) {}
  stopScan();
  if (team) { toast(team.code === code ? 'أنت في هذه المجموعة أصلًا' : 'أنت في مجموعة أخرى — غادرها أولًا للانضمام', 4000); return; }
  if ($('tmCode')) $('tmCode').value = code;
  const name = ($('tmMe') && $('tmMe').value.trim()) || store.get('teamName', '');
  if (name) teamJoin(code);
  else { toast('✓ قُرئ رمز المجموعة — اكتب اسمك ثم اضغط «انضمام»', 4000); if ($('tmMe')) $('tmMe').focus(); }
}

/* ---------------- buttons in the team panel ---------------- */
const _renderQr = renderTeam;
renderTeam = function () {
  _renderQr();
  if ($('teamPanel').classList.contains('hidden')) return;
  if (team) {
    const inv = $('tmInvite');
    if (inv && !$('tmQr')) { const b = document.createElement('button'); b.className = 'chip'; b.id = 'tmQr'; b.textContent = '🔳 QR'; b.onclick = showQr; inv.after(b); }
  } else {
    const j = $('tmJoin');
    if (j && !$('tmScan')) { const b = document.createElement('button'); b.className = 'chip'; b.id = 'tmScan'; b.textContent = '📷 مسح رمز QR'; b.onclick = startScan; j.after(b); }
  }
};
