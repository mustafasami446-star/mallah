'use strict';
/* الملاح — المحرّك الواحد، المرحلة 1.
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
    ovPushRoute(); ovPushMe();
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

/* the Leaflet copies: hidden while MapLibre draws them, shown again on the other maps */
function ovLeaflet(show) {
  [routeLayer, routeCasing].forEach((l) => {
    if (!l || !l.setStyle) return;
    if (l._ovOp == null) l._ovOp = l.options.opacity;
    l.setStyle({ opacity: show ? l._ovOp : 0 });
  });
  if (meMarker) meMarker.setOpacity(show ? 1 : 0);
  if (accCircle) accCircle.setStyle(show ? { opacity: .4, fillOpacity: .08 } : { opacity: 0, fillOpacity: 0 });
}
function ovRefresh() {
  const on = ovActive();
  if (on && OV.gl !== vecLayer._gl) {
    OV.gl = vecLayer._gl;
    if (!OV.gl._ovHooked) { OV.gl._ovHooked = true; OV.gl.on('styledata', () => ovInstall(OV.gl)); }
  }
  OV.on = on;
  if (on) ovInstall(OV.gl);
  ovLeaflet(!on);
}

/* hooks into the existing drawing code */
const _drawRouteOv = drawRoute;
drawRoute = function (r) { _drawRouteOv(r); OV.route = r && r.pts; OV.routeMode = typeof mode !== 'undefined' ? mode : 'car'; ovPushRoute(); ovLeaflet(!OV.on); };
const _clearRouteOv = clearRouteLayer;
clearRouteLayer = function () { _clearRouteOv(); OV.route = null; ovPushRoute(); };
const _meOv = updateMeMarker;
updateMeMarker = function () { _meOv(); ovPushMe(); if (OV.on) ovLeaflet(false); };
map.on('layeradd layerremove', (e) => { if (e.layer instanceof VecLayer || e.layer === vecLayer) setTimeout(ovRefresh, 0); });
// MapLibre is created asynchronously: look again once it exists
setInterval(() => { if (ovActive() !== OV.on || (OV.on && OV.gl !== vecLayer._gl)) ovRefresh(); }, 700);
