'use strict';
/* الملاح — حساب المسار بدون إنترنت.
   The road network of the installed maps (built from OpenStreetMap on the "roads" branch) is kept on the
   phone; a background worker finds the fastest way on it (A*) and turns it into the same steps as the
   online router, so navigation, voice and rerouting work the same with or without internet. */

const ROADS_BASE = 'https://raw.githubusercontent.com/mustafasami446-star/mallah/roads/';
const ROADS_DB = 'mallah-roads';
let roadsInfo = store.get('roadsInfo', {});   // {id: {version, size, bbox}} of the graphs saved on this phone
let roadsBusy = false;

/* ---------------- storage (IndexedDB) ---------------- */
function roadsDb() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(ROADS_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  });
}
async function roadsGet(id) {
  const db = await roadsDb();
  return new Promise((ok, bad) => { const q = db.transaction('files').objectStore('files').get(id); q.onsuccess = () => ok(q.result || null); q.onerror = () => bad(q.error); });
}
async function roadsPut(id, buf) {
  const db = await roadsDb();
  return new Promise((ok, bad) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').put(buf, id); t.oncomplete = ok; t.onerror = () => bad(t.error); });
}
async function roadsDel(id) {
  const db = await roadsDb();
  return new Promise((ok) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').delete(id); t.oncomplete = ok; t.onerror = ok; });
}

/* which graphs this phone needs: Iraq when the whole-Iraq map is installed, otherwise one per province map */
function roadsWanted() {
  const ids = typeof packs === 'function' ? packs().map((p) => p.id) : [];
  return ids.includes('iraq') ? ['iraq'] : ids;
}
async function roadsSync(manual) {
  if (roadsBusy || navigator.onLine === false) return;
  const want = roadsWanted();
  roadsBusy = true;
  try {
    // graphs of maps no longer installed
    for (const id of Object.keys(roadsInfo)) if (!want.includes(id)) { await roadsDel(id); delete roadsInfo[id]; store.set('roadsInfo', roadsInfo); roadsWorkerDrop(id); }
    if (!want.length) return;
    const man = await getJSON(ROADS_BASE + 'roads.json?t=' + Math.floor(Date.now() / 3600e3), 20000);
    for (const id of want) {
      const p = (man.packs || []).find((x) => x.id === id);
      if (!p || !p.edges) continue;
      if (roadsInfo[id] && roadsInfo[id].version === man.version) continue;
      const r = await fetch(ROADS_BASE + p.file + '?v=' + man.version);
      if (!r.ok) throw new Error('roads ' + r.status);
      const buf = await r.arrayBuffer();
      await roadsPut(id, buf);
      roadsInfo[id] = { version: man.version, size: buf.byteLength, bbox: p.bbox || null };
      store.set('roadsInfo', roadsInfo);
      roadsWorkerDrop(id);
      if (manual !== false) toast('🧭 صار حساب المسار بدون إنترنت جاهزًا لخريطة ' + (typeof provName === 'function' ? provName(id) : id), 4500);
    }
  } catch (e) { if (manual === true) toast('تعذّر تنزيل بيانات الطرق — حاول لاحقًا', 4000); }
  finally { roadsBusy = false; if (typeof renderPackCard === 'function') renderPackCard(); }
}
const roadsReady = () => roadsWanted().some((id) => roadsInfo[id]);
setTimeout(() => roadsSync(false), 15000);
setInterval(() => roadsSync(false), 6 * 3600e3);
window.addEventListener('online', () => setTimeout(() => roadsSync(false), 5000));

/* ---------------- the worker ---------------- */
const ROADS_WORKER = `'use strict';
const G = {};          // id -> graph
const SPEED = {        // km/h by road class: car, bike, foot
  car: [100, 85, 65, 55, 45, 35, 25, 10, 15, 60, 55, 45, 40, 35, 15, 0, 0, 0, 0, 0, 30],
  bike: [0, 16, 16, 16, 16, 15, 15, 12, 12, 0, 16, 16, 15, 15, 12, 10, 8, 10, 4, 18, 15],
  foot: [0, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5, 5, 5, 4.5, 3, 5, 5]
};
const R = 6371008.8, rad = Math.PI / 180;
function hav(la1, lo1, la2, lo2) { const a = Math.sin((la2 - la1) * rad / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin((lo2 - lo1) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); }
async function load(id, buf) {
  const raw = await new Response(new Response(buf).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const dv = new DataView(raw);
  if (dv.getUint32(0, true) !== 0x3147524d) throw new Error('bad graph');
  const N = dv.getUint32(8, true), E = dv.getUint32(12, true), GP = dv.getUint32(16, true), NB = dv.getUint32(20, true);
  let o = 24;
  const nodes = new Int32Array(raw.slice(o, o + N * 8)); o += N * 8;
  const ea = new Uint32Array(E), eb = new Uint32Array(E), elen = new Float32Array(E), ecls = new Uint8Array(E), efl = new Uint8Array(E),
    ename = new Uint32Array(E), egs = new Uint32Array(E), egc = new Uint16Array(E), ems = new Uint16Array(E);
  for (let i = 0; i < E; i++, o += 28) {
    ea[i] = dv.getUint32(o, true); eb[i] = dv.getUint32(o + 4, true); elen[i] = dv.getUint32(o + 8, true) / 10;
    ecls[i] = dv.getUint8(o + 12); efl[i] = dv.getUint8(o + 13); ename[i] = dv.getUint32(o + 16, true);
    egs[i] = dv.getUint32(o + 20, true); egc[i] = dv.getUint16(o + 24, true); ems[i] = dv.getUint16(o + 26, true);
  }
  const geom = new Int32Array(raw.slice(o, o + GP * 8)); o += GP * 8;
  const names = new Uint8Array(raw.slice(o, o + NB));   // copies, so the unpacked file can be freed
  // both ways of every edge from each node (direction checked while searching)
  const deg = new Uint32Array(N + 1);
  for (let i = 0; i < E; i++) { deg[ea[i] + 1]++; deg[eb[i] + 1]++; }
  for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
  const adj = new Uint32Array(2 * E), fill = deg.slice(0, N);
  for (let i = 0; i < E; i++) { adj[fill[ea[i]]++] = i * 2; adj[fill[eb[i]]++] = i * 2 + 1; }
  G[id] = { id, N, E, nodes, ea, eb, elen, ecls, efl, ename, egs, egc, ems, geom, names, deg, adj, td: new TextDecoder() };
  return { N, E };
}
/* the points of an edge from a to b, as [lat, lng, lat, lng, ...] */
function epts(g, e) {
  const out = [g.nodes[2 * g.ea[e]] / 1e6, g.nodes[2 * g.ea[e] + 1] / 1e6];
  for (let k = 0; k < g.egc[e]; k++) out.push(g.geom[2 * (g.egs[e] + k)] / 1e6, g.geom[2 * (g.egs[e] + k) + 1] / 1e6);
  out.push(g.nodes[2 * g.eb[e]] / 1e6, g.nodes[2 * g.eb[e] + 1] / 1e6);
  return out;
}
function nameOf(g, e) {
  const off = g.ename[e]; if (!off) return '';
  let end = off; while (end < g.names.length && g.names[end] !== 10) end++;
  const n = g.td.decode(g.names.subarray(off, end));
  return /^[0-9٠-٩]+$/.test(n) ? 'طريق ' + n : n;      // a road known only by its number
}
const usable = (g, e, mode) => { const f = g.efl[e]; if (mode === 'car' && f & 4) return false; if (mode === 'foot' && f & 8) return false; return SPEED[mode][g.ecls[e]] > 0; };
const canGo = (g, e, fwd, mode) => mode === 'foot' || !(g.efl[e] & 1) || fwd;
function speedOf(g, e, mode) {
  let v = SPEED[mode][g.ecls[e]];
  if (mode === 'car' && g.ems[e]) v = Math.min(v, g.ems[e] * 0.9);
  return v / 3.6;
}
/* the nearest usable road to a point: the edge, how far along it, and the point on it */
function snap(g, lat, lng, mode) {
  const kx = Math.cos(lat * rad) * 111320, ky = 110540;
  let best = null;
  // the roads that start or end near the point (a quick pass over all junctions), widening until some are found
  for (const R of [1500, 5000, 20000]) {
    const la = Math.round(lat * 1e6), lo = Math.round(lng * 1e6), dLa = R / 0.11054, dLo = R / (0.1113 * Math.cos(lat * rad));
    const near = [];
    for (let i = 0, n = g.nodes; i < g.N; i++) if (Math.abs(n[2 * i] - la) < dLa && Math.abs(n[2 * i + 1] - lo) < dLo) near.push(i);
    const seen = new Set();
    {
      const l = [];
      near.forEach((i) => { for (let k = g.deg[i]; k < g.deg[i + 1]; k++) l.push(g.adj[k] >> 1); });
      for (const e of l) {
        if (seen.has(e) || !usable(g, e, mode)) continue; seen.add(e);
        const p = epts(g, e); let along = 0;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const ax = (p[k + 1] - lng) * kx, ay = (p[k] - lat) * ky, bx = (p[k + 3] - lng) * kx, by = (p[k + 2] - lat) * ky;
          const dx2 = bx - ax, dy2 = by - ay, L = dx2 * dx2 + dy2 * dy2;
          const t = L ? Math.max(0, Math.min(1, -(ax * dx2 + ay * dy2) / L)) : 0;
          const px = ax + t * dx2, py = ay + t * dy2, d = Math.hypot(px, py), segL = Math.sqrt(L);
          if (!best || d < best.d) best = { e, d, k, t, off: along + t * segL, lat: lat + py / ky, lng: lng + px / kx };
          along += segL;
        }
        // the lengths along the drawn line and the stored length differ a little: scale to the stored one
        if (best && best.e === e && along > 0) best.off = best.off * g.elen[e] / along;
      }
    }
    if (best && best.d <= R) break;
  }
  return best && best.d < 20000 ? best : null;
}
/* a small binary heap of (cost, node) */
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(k, v) { const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v); while (i) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; } K[i] = k; V[i] = v; }
  pop() {
    const K = this.k, V = this.v, top = V[0], last = K.length - 1, k = K[last], v = V[last]; K.length = last; V.length = last;
    if (last) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= last) break; if (c + 1 < last && K[c + 1] < K[c]) c++; if (K[c] >= k) break; K[i] = K[c]; V[i] = V[c]; i = c; } K[i] = k; V[i] = v; }
    return top;
  }
  get size() { return this.k.length; }
  topKey() { return this.k[0]; }
}
function route(g, mode, from, to) {
  const s = snap(g, from[0], from[1], mode), t = snap(g, to[0], to[1], mode);
  if (!s || !t) return { code: 'NoRoute', why: !s ? 'start' : 'end' };
  const vmax = mode === 'car' ? 100 / 3.6 : mode === 'bike' ? 18 / 3.6 : 5 / 3.6;
  const tla = g.nodes, H = (n) => hav(tla[2 * n] / 1e6, tla[2 * n + 1] / 1e6, t.lat, t.lng) / vmax;
  const dist = new Float64Array(g.N).fill(Infinity), prev = new Int32Array(g.N).fill(-1);
  const heap = new Heap();
  const se = s.e, sv = speedOf(g, se, mode);
  // leave the start edge towards either end it can be driven to
  if (canGo(g, se, true, mode)) { const c = (g.elen[se] - s.off) / sv; dist[g.eb[se]] = c; prev[g.eb[se]] = -2; heap.push(c + H(g.eb[se]), g.eb[se]); }
  if (canGo(g, se, false, mode)) { const c = s.off / sv; if (c < dist[g.ea[se]]) { dist[g.ea[se]] = c; prev[g.ea[se]] = -3; heap.push(c + H(g.ea[se]), g.ea[se]); } }
  // the target edge is reached from its ends
  const te = t.e, tv = speedOf(g, te, mode);
  let bestCost = Infinity, bestEnd = -1, direct = false;
  if (se === te) {
    const fwd = t.off >= s.off;
    if (canGo(g, se, fwd, mode)) { bestCost = Math.abs(t.off - s.off) / sv; direct = true; }
  }
  const closeA = canGo(g, te, true, mode) ? t.off / tv : Infinity;              // from a, along a→b
  const closeB = canGo(g, te, false, mode) ? (g.elen[te] - t.off) / tv : Infinity; // from b, along b→a
  let n = 0;
  while (heap.size) {
    if (heap.topKey() >= bestCost) break;
    const u = heap.pop(), du = dist[u];
    if (++n > 3e6) break;
    if (u === g.ea[te] && du + closeA < bestCost) { bestCost = du + closeA; bestEnd = 0; direct = false; }
    if (u === g.eb[te] && du + closeB < bestCost) { bestCost = du + closeB; bestEnd = 1; direct = false; }
    for (let k = g.deg[u]; k < g.deg[u + 1]; k++) {
      const x = g.adj[k], e = x >> 1, fwd = !(x & 1);
      if (!usable(g, e, mode) || !canGo(g, e, fwd, mode)) continue;
      const v = fwd ? g.eb[e] : g.ea[e], c = du + g.elen[e] / speedOf(g, e, mode);
      if (c < dist[v]) { dist[v] = c; prev[v] = x; heap.push(c + H(v), v); }
    }
  }
  if (bestCost === Infinity) return { code: 'NoRoute', why: 'disconnected' };
  // the path as a list of [edge, forward, fromOffset, toOffset]
  const parts = [];
  if (direct) parts.push([se, t.off >= s.off, s.off, t.off]);
  else {
    const endNode = bestEnd === 0 ? g.ea[te] : g.eb[te];
    parts.push([te, bestEnd === 0, bestEnd === 0 ? 0 : g.elen[te], t.off]);
    let v = endNode;
    while (prev[v] >= 0) { const x = prev[v], e = x >> 1, fwd = !(x & 1); parts.push([e, fwd, fwd ? 0 : g.elen[e], fwd ? g.elen[e] : 0]); v = fwd ? g.ea[e] : g.eb[e]; }
    parts.push([se, prev[v] === -2, s.off, prev[v] === -2 ? g.elen[se] : 0]);
    parts.reverse();
  }
  return build(g, mode, parts, s, t, bestCost);
}
/* the line between two offsets of an edge, in travel order */
function partLine(g, e, a, b) {
  const p = epts(g, e), cum = [0];
  for (let k = 2; k < p.length; k += 2) cum.push(cum[cum.length - 1] + hav(p[k - 2], p[k - 1], p[k], p[k + 1]));
  const L = cum[cum.length - 1] || 1, f = L / (g.elen[e] || L);
  const at = (o) => { o = o * f; let i = 1; while (i < cum.length - 1 && cum[i] < o) i++; const t = (o - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * t, p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * t, i]; };
  const A = at(Math.min(a, b)), B = at(Math.max(a, b));
  const line = [[A[0], A[1]]];
  for (let i = A[2]; i < B[2]; i++) line.push([p[2 * i], p[2 * i + 1]]);
  line.push([B[0], B[1]]);
  if (a > b) line.reverse();
  return line;
}
function bearing(a, b) { const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad), x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad); return (Math.atan2(y, x) / rad + 360) % 360; }
function modOf(turn) {
  const a = Math.abs(turn), side = turn > 0 ? 'right' : 'left';
  if (a < 20) return 'straight';
  if (a < 45) return 'slight ' + side;
  if (a < 135) return side;
  if (a < 170) return 'sharp ' + side;
  return 'uturn';
}
function build(g, mode, parts, s, t, cost) {
  const coords = [], legs = [];
  parts.forEach(([e, fwd, a, b]) => {
    const line = partLine(g, e, a, b), len = Math.abs(b - a);
    if (len < 0.5 && legs.length) return;
    legs.push({ e, line, len, time: len / speedOf(g, e, mode), name: nameOf(g, e), round: !!(g.efl[e] & 2), cls: g.ecls[e], end: fwd ? g.eb[e] : g.ea[e] });
    line.forEach((p, i) => { if (!(coords.length && i === 0)) coords.push([p[1], p[0]]); });
  });
  const ll = (p) => [+p[1].toFixed(6), +p[0].toFixed(6)];
  const steps = [];
  const step = (type, mod, loc, name, extra) => { const st = { maneuver: Object.assign({ type, modifier: mod, location: loc }, extra || {}), name: name || '', ref: '', distance: 0, duration: 0 }; steps.push(st); return st; };
  let cur = step('depart', null, ll(legs[0].line[0]), legs[0].name);
  for (let i = 0; i < legs.length; i++) {
    const L = legs[i];
    cur.distance += L.len; cur.duration += L.time;
    const N = legs[i + 1]; if (!N) break;
    const node = L.end, degree = g.deg[node + 1] - g.deg[node];
    const inB = bearing(L.line[Math.max(0, L.line.length - 2)], L.line[L.line.length - 1]), outB = bearing(N.line[0], N.line[1] || N.line[0]);
    let turn = outB - inB; if (turn > 180) turn -= 360; if (turn < -180) turn += 360;
    if (N.round && !L.round) {
      // entering a roundabout: count the ways out until we leave it
      let exits = 0, j = i + 1;
      for (; j < legs.length && legs[j].round; j++) { const nd = legs[j].end; if (g.deg[nd + 1] - g.deg[nd] > 2) exits++; }
      const out = legs[j] || legs[legs.length - 1];
      cur = step('roundabout', null, ll(N.line[0]), out.name, { exit: Math.max(1, exits) });
      continue;
    }
    if (L.round && N.round) continue;
    if (L.round && !N.round) { continue; }     // the roundabout step already said which exit
    const nameChange = N.name !== L.name;
    if (Math.abs(turn) >= 40 || (degree > 2 && Math.abs(turn) >= 25) || (nameChange && N.name && Math.abs(turn) >= 15)) cur = step('turn', modOf(turn), ll(N.line[0]), N.name);
    else if (nameChange && N.name && degree > 2) cur = step('new name', 'straight', ll(N.line[0]), N.name);
  }
  const last = legs[legs.length - 1], lp = last.line[last.line.length - 1];
  step('arrive', null, ll(lp), '');
  const distance = legs.reduce((x, l) => x + l.len, 0);
  return { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: coords }, legs: [{ steps }], distance, duration: cost, offline: true }],
    snap: { from: s.d, to: t.d } };
}
onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.load) { const r = await load(m.load, m.buf); postMessage({ id: m.id, ok: r }); return; }
    if (m.drop) { delete G[m.drop]; postMessage({ id: m.id, ok: 1 }); return; }
    if (m.has) { postMessage({ id: m.id, ok: !!G[m.has] }); return; }
    if (m.near) { const g = G[m.graph]; if (!g) throw new Error('no graph'); const sn = snap(g, m.near[0], m.near[1], 'foot'); postMessage({ id: m.id, ok: sn && sn.d < 90 ? { name: nameOf(g, sn.e), d: sn.d } : null }); return; }
    if (m.route) { const g = G[m.graph]; if (!g) throw new Error('no graph'); postMessage({ id: m.id, ok: route(g, m.route.mode, m.route.from, m.route.to) }); return; }
  } catch (e) { postMessage({ id: m.id, err: String(e && e.message || e) }); }
};`;
let roadsW = null, roadsSeq = 0;
const roadsWait = {};
function roadsCall(msg, transfer) {
  if (!roadsW) {
    roadsW = new Worker(URL.createObjectURL(new Blob([ROADS_WORKER], { type: 'text/javascript' })));
    roadsW.onmessage = (ev) => { const w = roadsWait[ev.data.id]; if (!w) return; delete roadsWait[ev.data.id]; if (ev.data.err) w[1](new Error(ev.data.err)); else w[0](ev.data.ok); };
  }
  const id = ++roadsSeq;
  return new Promise((ok, bad) => { roadsWait[id] = [ok, bad]; roadsW.postMessage(Object.assign({ id }, msg), transfer || []); });
}
const roadsLoaded = {};
function roadsWorkerDrop(id) { if (roadsLoaded[id]) { delete roadsLoaded[id]; if (roadsW) roadsCall({ drop: id }).catch(() => {}); } }
async function roadsLoad(id) {
  if (!roadsLoaded[id]) {
    roadsLoaded[id] = (async () => {
      const buf = await roadsGet(id); if (!buf) throw new Error('missing');
      await roadsCall({ load: id, buf }, []);
      return true;
    })();
    roadsLoaded[id].catch(() => { delete roadsLoaded[id]; });
  }
  return roadsLoaded[id];
}
/* which saved graph covers both ends */
function roadsFor(from, to) {
  if (roadsInfo.iraq) return 'iraq';
  const inB = (b, p) => b && p[1] >= b[0] && p[1] <= b[2] && p[0] >= b[1] && p[0] <= b[3];
  const ids = Object.keys(roadsInfo).filter((id) => roadsWanted().includes(id));
  return ids.find((id) => inB(roadsInfo[id].bbox, from) && inB(roadsInfo[id].bbox, to)) || null;
}
/* the offline route, in the shape the online router returns */
async function offlineRoute(m, from, to) {
  const id = roadsFor(from, to);
  if (!id) throw new Error(Object.keys(roadsInfo).length ? 'OfflineOutside' : 'NoOffline');
  await roadsLoad(id);
  const j = await roadsCall({ route: { mode: m, from, to }, graph: id });
  if (j.code !== 'Ok') throw new Error('NoRoute');
  const r = prepRoute(j.routes[0]);
  r.gap = hav(r.pts[r.pts.length - 1], to);
  r.offline = true;
  return r;
}

/* the name of the street at a point (for describing a place), from the saved road network */
async function roadsStreetAt(lat, lng) {
  const id = roadsFor([lat, lng], [lat, lng]); if (!id) return null;
  try { await roadsLoad(id); return await roadsCall({ near: [lat, lng], graph: id }); } catch (e) { return null; }
}
