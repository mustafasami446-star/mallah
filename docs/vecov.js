'use strict';
/* الملاح — المحرّك الواحد، المراحل 1 و2 و3.
   On the downloaded (vector) map, the route line and "you are here" (dot, accuracy circle, heading /
   navigation arrow) are drawn by MapLibre itself, in the same frame as the streets, so they can never
   slide off the road while zooming or turning. The Leaflet copies stay (hidden) so every other map
   keeps working exactly as before. */

const OV = { on: false, gl: null, route: null, routeMode: 'car' };
const OV_EMPTY = { type: 'FeatureCollection', features: [] };

function ovActive() { return !!(vecLayer && vecLayer._gl); }
function ovRouteColor(m) { return m === 'foot' ? '#7c3aed' : m === 'bike' ? '#0891b2' : '#2563eb'; }

/* arrow and heading-cone images, drawn once on a canvas */
function ovImg(kind) {
  const s = kind === 'nav' ? 40 : 48, r = 2, c = document.createElement('canvas');
  c.width = c.height = s * r;
  const x = c.getContext('2d'); x.scale(r, r);
  if (kind === 'nav') {
    x.beginPath(); x.arc(20, 20, 18, 0, Math.PI * 2); x.fillStyle = '#2563eb'; x.fill();
    x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
    x.beginPath(); x.moveTo(20, 8); x.lineTo(28, 29); x.lineTo(20, 24); x.lineTo(12, 29); x.closePath(); x.fillStyle = '#fff'; x.fill();
  } else {
    x.globalAlpha = 0.85; x.beginPath(); x.moveTo(24, 2); x.lineTo(31, 14); x.lineTo(17, 14); x.closePath(); x.fillStyle = '#2563eb'; x.fill();
  }
  return { width: c.width, height: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}
function ovCircle(lat, lng, m) {
  const pts = [], R = 6378137, dLat = m / R * 180 / Math.PI, dLng = dLat / Math.cos(lat * Math.PI / 180);
  for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI; pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
}

/* sources and layers; added again whenever the style is replaced (night mode, new maps) */
function ovInstall(gl) {
  try {
    if (!gl.style || !gl.style._loaded || gl.getSource('ov_route')) return;
    ['nav', 'cone'].forEach((k) => { if (!gl.hasImage('ov_' + k)) gl.addImage('ov_' + k, ovImg(k), { pixelRatio: 2 }); });
    gl.addSource('ov_route', { type: 'geojson', data: OV_EMPTY });
    gl.addSource('ov_acc', { type: 'geojson', data: OV_EMPTY });
    gl.addSource('ov_me', { type: 'geojson', data: OV_EMPTY });
    // the route goes above the streets but under the place names
    const firstLabel = (gl.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;
    gl.addLayer({ id: 'ov_route_casing', type: 'line', source: 'ov_route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#0b3a8a', 'line-opacity': 0.55, 'line-width': 11 } }, firstLabel);
    gl.addLayer({ id: 'ov_route', type: 'line', source: 'ov_route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.95, 'line-width': 7 } }, firstLabel);
    gl.addLayer({ id: 'ov_route_foot', type: 'line', source: 'ov_route', filter: ['==', ['get', 'foot'], true], layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-dasharray': [0.3, 1.6] } }, firstLabel);
    gl.addLayer({ id: 'ov_acc', type: 'fill', source: 'ov_acc', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.08, 'fill-outline-color': 'rgba(37,99,235,.4)' } });
    gl.addLayer({ id: 'ov_cone', type: 'symbol', source: 'ov_me', filter: ['all', ['==', ['get', 'nav'], false], ['==', ['get', 'hasHd'], true]],
      layout: { 'icon-image': 'ov_cone', 'icon-rotate': ['get', 'hd'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    gl.addLayer({ id: 'ov_me_halo', type: 'circle', source: 'ov_me', filter: ['==', ['get', 'nav'], false],
      paint: { 'circle-radius': 11, 'circle-color': 'rgba(37,99,235,.35)', 'circle-blur': 0.3 } });
    gl.addLayer({ id: 'ov_me', type: 'circle', source: 'ov_me', filter: ['==', ['get', 'nav'], false],
      paint: { 'circle-radius': 7.5, 'circle-color': '#2563eb', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
    gl.addLayer({ id: 'ov_nav', type: 'symbol', source: 'ov_me', filter: ['==', ['get', 'nav'], true],
      layout: { 'icon-image': 'ov_nav', 'icon-rotate': ['get', 'hd'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    // stage 2: work sites, discover pins, the destination pin (under "you are here")
    gl.addSource('ov_pts', { type: 'geojson', data: OV_EMPTY });
    gl.addLayer({ id: 'ov_site', type: 'circle', source: 'ov_pts', filter: ['==', ['get', 't'], 'site'],
      paint: { 'circle-radius': 7, 'circle-color': '#f97316', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }, 'ov_acc');
    gl.addLayer({ id: 'ov_site_lbl', type: 'symbol', source: 'ov_pts', minzoom: 14, filter: ['==', ['get', 't'], 'site'],
      layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Medium'], 'text-size': 12.5, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-max-width': 9 },
      paint: { 'text-color': '#fed7aa', 'text-halo-color': 'rgba(15,23,42,.92)', 'text-halo-width': 2.2 } }, 'ov_acc');
    gl.addLayer({ id: 'ov_near', type: 'symbol', source: 'ov_pts', filter: ['==', ['get', 't'], 'near'],
      layout: { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'z'] } }, 'ov_acc');
    gl.addLayer({ id: 'ov_dest', type: 'symbol', source: 'ov_pts', filter: ['==', ['get', 't'], 'dest'],
      layout: { 'icon-image': 'ov_pin', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, 'ov_acc');
    if (!gl.hasImage('ov_pin')) gl.addImage('ov_pin', ovPinImg(), { pixelRatio: 2 });
    // stage 3: every other line and shape (measuring, recorded tracks, alert zones, area outline, compass line)
    gl.addSource('ov_paths', { type: 'geojson', data: OV_EMPTY });
    const notPt = ['!=', ['geometry-type'], 'Point'];
    gl.addLayer({ id: 'ov_p_fill', type: 'fill', source: 'ov_paths', filter: ['all', notPt, ['>', ['get', 'fo'], 0]],
      paint: { 'fill-color': ['get', 'f'], 'fill-opacity': ['get', 'fo'] } }, 'ov_site');
    gl.addLayer({ id: 'ov_p_line', type: 'line', source: 'ov_paths', filter: ['all', notPt, ['==', ['get', 's'], true], ['==', ['get', 'd'], false]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'] } }, 'ov_site');
    gl.addLayer({ id: 'ov_p_dash', type: 'line', source: 'ov_paths', filter: ['all', notPt, ['==', ['get', 's'], true], ['==', ['get', 'd'], true]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'], 'line-dasharray': [0.6, 2.2] } }, 'ov_site');
    gl.addLayer({ id: 'ov_p_pt', type: 'circle', source: 'ov_paths', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'f'], 'circle-opacity': ['get', 'fo'],
        'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': ['get', 'w'], 'circle-stroke-opacity': ['get', 'op'] } }, 'ov_site');
    ovPushRoute(); ovPushMe(); ovPushPts(); ovPushPaths();
  } catch (e) { console.warn('overlay', e); diagLog && diagLog('overlay: ' + (e && e.message)); }
}
function ovPushRoute() {
  const gl = OV.gl; if (!gl || !gl.getSource('ov_route')) return;
  const r = OV.route;
  gl.getSource('ov_route').setData(r ? { type: 'Feature', properties: { color: ovRouteColor(OV.routeMode), foot: OV.routeMode === 'foot' },
    geometry: { type: 'LineString', coordinates: r.map((p) => [p[1] != null ? p[1] : p.lng, p[0] != null ? p[0] : p.lat]) } } : OV_EMPTY);
  // walking: dotted line only
  try { gl.setLayoutProperty('ov_route', 'visibility', OV.routeMode === 'foot' ? 'none' : 'visible'); gl.setLayoutProperty('ov_route_casing', 'visibility', OV.routeMode === 'foot' ? 'none' : 'visible'); } catch (e) {}
}
function ovPushMe() {
  const gl = OV.gl; if (!gl || !gl.getSource('ov_me')) return;
  if (!me) { gl.getSource('ov_me').setData(OV_EMPTY); gl.getSource('ov_acc').setData(OV_EMPTY); return; }
  const nav = !!(navState || directState);
  gl.getSource('ov_me').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [me.lng, me.lat] },
    properties: { nav, hd: me.heading || 0, hasHd: me.heading != null } });
  gl.getSource('ov_acc').setData(!nav && me.acc > 3 ? ovCircle(me.lat, me.lng, me.acc) : OV_EMPTY);
}

function ovPinImg() {
  const r = 2, c = document.createElement('canvas'); c.width = 34 * r; c.height = 44 * r;
  const x = c.getContext('2d'); x.scale(r, r);
  const p = new Path2D('M17 1C8.2 1 1 8 1 16.7 1 28.5 17 43 17 43s16-14.5 16-26.3C33 8 25.8 1 17 1z');
  x.fillStyle = '#ef4444'; x.fill(p); x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke(p);
  x.beginPath(); x.arc(17, 16.5, 6, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
  return { width: c.width, height: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}
/* a discover pin: the category's emoji on its colour, larger when selected */
function ovNearImg(gl, cat, on) {
  const name = 'ov_near_' + cat.id + (on ? '_on' : '');
  if (gl.hasImage(name)) return name;
  const r = 2, s = on ? 36 : 28, c = document.createElement('canvas'); c.width = c.height = (s + 4) * r;
  const x = c.getContext('2d'); x.scale(r, r);
  x.beginPath(); x.arc(s / 2 + 2, s / 2 + 2, s / 2, 0, Math.PI * 2); x.fillStyle = cat.c; x.fill();
  x.lineWidth = on ? 3 : 2; x.strokeStyle = on ? '#38bdf8' : '#fff'; x.stroke();
  x.font = Math.round(s * 0.55) + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(cat.i, s / 2 + 2, s / 2 + 3);
  gl.addImage(name, { width: c.width, height: c.height, data: x.getImageData(0, 0, c.width, c.height).data }, { pixelRatio: r });
  return name;
}
function ovPushPts() {
  const gl = OV.gl; if (!gl || !gl.getSource('ov_pts')) return;
  const f = [], pt = (lng, lat, props) => f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props });
  try {
    if (typeof allSites === 'function') allSites().forEach((s) => pt(s.lng, s.lat, { t: 'site', n: s.n }));
    if (typeof nearHits !== 'undefined' && nearHits.length && typeof CATS !== 'undefined') {
      const cat = CATS.find((c) => c.id === nearCat);
      if (cat) nearHits.forEach((h, i) => pt(h.lng, h.lat, { t: 'near', img: ovNearImg(gl, cat, i === nearSel), z: i === nearSel ? 1 : 0 }));
    }
    if (destMarker && map.hasLayer(destMarker)) { const ll = destMarker.getLatLng(); pt(ll.lng, ll.lat, { t: 'dest' }); }
  } catch (e) { console.warn('overlay pts', e); }
  gl.getSource('ov_pts').setData({ type: 'FeatureCollection', features: f });
}
let ovPtsSoon = false;
function ovPtsLater() { if (ovPtsSoon) return; ovPtsSoon = true; requestAnimationFrame(() => { ovPtsSoon = false; ovPushPts(); }); }

/* all other Leaflet lines and shapes, copied with their own colours and widths */
function ovSkip(l) {
  return l === routeLayer || l === routeCasing || l === accCircle
    || (typeof siteRenderer !== 'undefined' && l.options.renderer === siteRenderer);
}
function ovLL(a) { return a.map((p) => Array.isArray(p) ? ovLL(p) : [p.lng, p.lat]); }
function ovPushPaths() {
  const gl = OV.gl; if (!gl || !gl.getSource('ov_paths')) return;
  const f = [];
  map.eachLayer((l) => {
    if (!(l instanceof L.Path) || ovSkip(l)) return;
    try {
      const o = l.options, fill = o.fill !== false && (l instanceof L.Polygon || l instanceof L.CircleMarker);
      const props = { c: o.color || '#3388ff', w: o.weight != null ? o.weight : 3, op: o.opacity != null ? o.opacity : 1, s: o.stroke !== false,
        d: !!o.dashArray, f: o.fillColor || o.color || '#3388ff', fo: fill ? (o.fillOpacity != null ? o.fillOpacity : 0.2) : 0 };
      let g;
      if (l instanceof L.Circle) { const c = l.getLatLng(); g = ovCircle(c.lat, c.lng, l.getRadius()).geometry; }
      else if (l instanceof L.CircleMarker) { const c = l.getLatLng(); g = { type: 'Point', coordinates: [c.lng, c.lat] }; props.r = o.radius || 10; }
      else if (l instanceof L.Polygon) {
        let r = ovLL(l.getLatLngs());
        if (typeof r[0][0] === 'number') r = [r];                     // a flat ring
        const polys = typeof r[0][0][0] === 'number' ? [r] : r;           // one polygon or several
        polys.forEach((p) => p.forEach((ring) => { if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]); }));
        if (!polys[0][0] || polys[0][0].length < 4) return;
        g = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
      } else if (l instanceof L.Polyline) {
        const r = ovLL(l.getLatLngs());
        if (!r.length) return;
        g = typeof r[0][0] === 'number' ? { type: 'LineString', coordinates: r } : { type: 'MultiLineString', coordinates: r };
        if (g.type === 'LineString' && r.length < 2) return;
      } else return;
      f.push({ type: 'Feature', geometry: g, properties: props });
    } catch (e) {}
  });
  gl.getSource('ov_paths').setData({ type: 'FeatureCollection', features: f });
}
let ovPathsSoon = false;
function ovPathsLater() { if (!OV.on || ovPathsSoon) return; ovPathsSoon = true; requestAnimationFrame(() => { ovPathsSoon = false; ovPushPaths(); }); }
// lines and shapes that change in place (dragging a measured corner, a growing recorded track, a zone switched off)
['redraw', 'setStyle'].forEach((fn) => {
  const orig = L.Path.prototype[fn];
  L.Path.prototype[fn] = function () { const r = orig.apply(this, arguments); if (this._map && !ovSkip(this)) ovPathsLater(); return r; };
});

/* the Leaflet copies: hidden while MapLibre draws them, shown again on the other maps */
function ovLeaflet(show) {
  [routeLayer, routeCasing].forEach((l) => {
    if (!l || !l.setStyle) return;
    if (l._ovOp == null) l._ovOp = l.options.opacity;
    l.setStyle({ opacity: show ? l._ovOp : 0 });
  });
  if (meMarker) meMarker.setOpacity(show ? 1 : 0);
  if (accCircle) accCircle.setStyle(show ? { opacity: .4, fillOpacity: .08 } : { opacity: 0, fillOpacity: 0 });
  // markers and sites stay where they are (they still answer taps) but are not seen
  document.body.classList.toggle('ov-on', !show);
  if (typeof siteRenderer !== 'undefined' && siteRenderer._container) siteRenderer._container.style.opacity = show ? '' : '0';
}
function ovRefresh() {
  const on = ovActive();
  if (on && OV.gl !== vecLayer._gl) {
    OV.gl = vecLayer._gl;
    if (!OV.gl._ovHooked) { OV.gl._ovHooked = true; OV.gl.on('styledata', () => ovInstall(OV.gl)); }
  }
  OV.on = on;
  if (on) { ovInstall(OV.gl); ovPushPaths(); }
  ovLeaflet(!on);
}

/* hooks into the existing drawing code */
const _drawRouteOv = drawRoute;
drawRoute = function (r) { _drawRouteOv(r); OV.route = r && r.pts; OV.routeMode = typeof mode !== 'undefined' ? mode : 'car'; ovPushRoute(); ovLeaflet(!OV.on); };
const _clearRouteOv = clearRouteLayer;
clearRouteLayer = function () { _clearRouteOv(); OV.route = null; ovPushRoute(); };
const _meOv = updateMeMarker;
updateMeMarker = function () { _meOv(); ovPushMe(); if (OV.on) ovLeaflet(false); };
map.on('layeradd layerremove', (e) => {
  if (e.layer instanceof VecLayer || e.layer === vecLayer) setTimeout(ovRefresh, 0);
  else if (e.layer instanceof L.Marker || e.layer instanceof L.CircleMarker) ovPtsLater();
  if (e.layer instanceof L.Path) ovPathsLater();
});
// MapLibre is created asynchronously: look again once it exists
setInterval(() => { if (ovActive() !== OV.on || (OV.on && OV.gl !== vecLayer._gl)) ovRefresh(); }, 700);
