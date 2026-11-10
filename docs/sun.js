'use strict';
/* الملاح — وضع الشمس: ألوان فاتحة عالية التباين وخط أعرض، لتُقرأ الشاشة تحت شمس الظهيرة على حامل السيارة.
   «تلقائي» يقرأ حسّاس الضوء في الهاتف: يعمل في ضوء الشمس القوي (أكثر من ~10 آلاف لوكس) ويعود حين يخفت. */

const SUN_HAS_SENSOR = () => { try { return NATIVE && Android.lightLux && Android.lightLux() > -1.5; } catch (e) { return false; } };
let sunMode = store.get('sun', null);
if (!sunMode) sunMode = NATIVE && typeof Android !== 'undefined' && Android.lightLux ? 'auto' : 'off';
let sunOn = false, sunHi = 0, sunLo = 0;
function sunApply(on) {
  if (on === sunOn) return;
  sunOn = on;
  document.body.classList.toggle('sun', on);
  const mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.content = on ? '#ffffff' : '#0f172a';
  if (typeof placeFabs === 'function') setTimeout(placeFabs, 50);
}
function sunTick() {
  if (sunMode === 'on') { sunApply(true); return; }
  if (sunMode === 'off') { sunApply(false); return; }
  let lux = -2; try { lux = Android.lightLux(); } catch (e) {}
  if (lux < 0) { sunApply(false); return; }
  // a little patience both ways, so a passing shadow or a bridge does not flip the screen
  if (lux >= 10000) { sunLo = 0; if (++sunHi >= 2) sunApply(true); }
  else if (lux <= 3000) { sunHi = 0; if (++sunLo >= 8) sunApply(false); }
  else { sunHi = 0; sunLo = 0; }
}
function setSunMode(v) {
  sunMode = v; store.set('sun', v); sunHi = sunLo = 0;
  sunTick(); renderLayerMenu();
  toast({ auto: '☀️ وضع الشمس: تلقائي حسب ضوء الشمس', on: '☀️ وضع الشمس: مُفعّل', off: 'وضع الشمس: متوقف' }[v]);
}
setInterval(sunTick, 2000);
sunTick();
{
  const _render = renderLayerMenu;
  renderLayerMenu = function () {
    _render();
    const m = $('layerMenu');
    const sep = document.createElement('div'); sep.className = 'sep'; sep.textContent = '☀️ وضع الشمس (ألوان فاتحة واضحة)'; m.appendChild(sep);
    const seg = document.createElement('div'); seg.className = 'seg';
    const opts = SUN_HAS_SENSOR() ? [['auto', 'تلقائي'], ['on', 'تشغيل'], ['off', 'إيقاف']] : [['on', 'تشغيل'], ['off', 'إيقاف']];
    opts.forEach(([v, t]) => {
      const b = document.createElement('button'); b.textContent = t;
      if (sunMode === v || (v === 'off' && sunMode === 'auto' && !SUN_HAS_SENSOR())) b.className = 'sel';
      b.onclick = (e) => { e.stopPropagation(); setSunMode(v); };
      seg.appendChild(b);
    });
    m.appendChild(seg);
  };
  renderLayerMenu();
}
