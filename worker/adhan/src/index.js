/* الملاح — إشعار الأذان للآيفون واللابتوب والصفحة مغلقة (Cloudflare Worker + D1).
   Each browser that switches the adhan on sends its push subscription with its rounded position and
   calculation method. Every minute the worker sends a Web Push to the browsers whose prayer time has come.
   The notification opens Mallah, which then plays the full adhan. No names, no accounts. */

const SITE = 'https://mustafasami446-star.github.io';
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|web\.push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/;
const NAMES = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
const KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const MAX_PER_RUN = 45;                   // the free plan allows 50 requests out of one run

/* ---------------- prayer times (the same formulas as the app) ---------------- */
const dsin = (d) => Math.sin(d * Math.PI / 180), dcos = (d) => Math.cos(d * Math.PI / 180), dtan = (d) => Math.tan(d * Math.PI / 180);
const fixA = (a) => { a -= 360 * Math.floor(a / 360); return a < 0 ? a + 360 : a; };
const fixH = (h) => { h -= 24 * Math.floor(h / 24); return h < 0 ? h + 24 : h; };
function sun(jd) {
  const D = jd - 2451545.0, g = fixA(357.529 + 0.98560028 * D), q = fixA(280.459 + 0.98564736 * D);
  const L = fixA(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g)), e = 23.439 - 0.00000036 * D;
  const RA = Math.atan2(dcos(e) * dsin(L), dcos(L)) * 180 / Math.PI / 15;
  return { decl: Math.asin(dsin(e) * dsin(L)) * 180 / Math.PI, eqt: q / 15 - fixH(RA) };
}
const METHODS = { jafari: { fajr: 16, isha: 14, maghrib: 4 }, mwl: { fajr: 18, isha: 17 }, egypt: { fajr: 19.5, isha: 17.5 }, umm: { fajr: 18.5, ishaMin: 90 } };
function times(base, lat, lng, cfg) {
  const m = METHODS[cfg.method] || METHODS.mwl, asrF = cfg.asr === 2 ? 2 : 1, jd0 = base / 86400000 + 2440587.5;
  const noon = (t) => fixH(12 - sun(jd0 + t / 24).eqt - lng / 15);
  const angle = (a, t, before) => {
    const s = sun(jd0 + t / 24), n = noon(t), c = (-dsin(a) - dsin(s.decl) * dsin(lat)) / (dcos(s.decl) * dcos(lat));
    if (c > 1 || c < -1) return NaN;
    const h = Math.acos(c) * 180 / Math.PI / 15; return n + (before ? -h : h);
  };
  const g = 12 - lng / 15, s3 = sun(jd0 + (g + 3) / 24);
  const T = { fajr: angle(m.fajr, g - 6, true), dhuhr: noon(g) + 1 / 60, asr: angle(-Math.atan(1 / (asrF + dtan(Math.abs(lat - s3.decl)))) * 180 / Math.PI, g + 3, false) };
  const sunset = angle(0.833, g + 6, false);
  T.maghrib = m.maghrib ? angle(m.maghrib, g + 6, false) : sunset;
  T.isha = m.ishaMin ? T.maghrib + m.ishaMin / 60 : angle(m.isha, g + 7, false);
  const out = {}, adj = cfg.adj || {};
  for (const k of KEYS) out[k] = isNaN(T[k]) ? null : Math.round((base + (T[k] + (adj[k] || 0) / 60) * 3600e3) / 60e3) * 60e3;
  return out;
}
/* the next prayer (switched on) after `after`, in the browser's own calendar days */
function nextPrayer(cfg, after) {
  const tz = (cfg.tz || 0) * 60000, want = cfg.prayers && cfg.prayers.length ? cfg.prayers : KEYS;
  for (let d = 0; d < 3; d++) {
    const loc = new Date(after + tz + d * 86400e3), base = Date.UTC(loc.getUTCFullYear(), loc.getUTCMonth(), loc.getUTCDate());
    const T = times(base, cfg.lat, cfg.lng, cfg);
    let best = null;
    for (const k of KEYS) if (want.includes(k) && T[k] && T[k] > after && (!best || T[k] < best.t)) best = { k, t: T[k] };
    if (best) return best;
  }
  return null;
}

/* ---------------- Web Push (VAPID + aes128gcm, RFC 8291 / 8292) ---------------- */
const te = new TextEncoder();
const b64u = (u) => btoa(String.fromCharCode(...new Uint8Array(u))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function vapidKeys(env) {
  let row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('vapid').first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const v = JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) });
    await env.DB.prepare('INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)').bind('vapid', v).run();
    row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('vapid').first();
  }
  const j = JSON.parse(row.v);
  return { pub: j.pub, priv: await crypto.subtle.importKey('jwk', j.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
}
const jwtCache = new Map();
async function vapidAuth(keys, endpoint) {
  const aud = new URL(endpoint).origin, c = jwtCache.get(aud);
  if (c && c.exp > Date.now() + 3600e3) return c.h;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const unsigned = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64u(te.encode(JSON.stringify({ aud, exp, sub: SITE + '/mallah/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.priv, te.encode(unsigned));
  const h = 'vapid t=' + unsigned + '.' + b64u(sig) + ', k=' + keys.pub;
  jwtCache.set(aud, { h, exp: exp * 1000 });
  return h;
}
async function encrypt(sub, payload, eph) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const ua = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode('WebPush: info\0'), uaPub, eph.pub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([eph.pub.length]), eph.pub, ct);
}
async function push(env, keys, eph, sub, payload) {
  const body = await encrypt(sub, payload, eph);
  return fetch(sub.endpoint, {
    method: 'POST', body,
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '900', Urgency: 'high', Authorization: await vapidAuth(keys, sub.endpoint) }
  });
}

/* ---------------- storage ---------------- */
async function ensure(env) {
  if (ensure.done) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS subs (id TEXT PRIMARY KEY, sub TEXT NOT NULL, cfg TEXT NOT NULL, next INTEGER, k TEXT, fails INTEGER DEFAULT 0, updated INTEGER)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS subs_next ON subs(next)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)')
  ]);
  ensure.done = true;
}
const idOf = async (endpoint) => b64u(await crypto.subtle.digest('SHA-256', te.encode(endpoint))).slice(0, 32);

/* ---------------- HTTP: the app registers here ---------------- */
function cors(req) {
  const o = req.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': o === SITE || o === 'https://appassets.androidplatform.net' || o.startsWith('http://localhost') ? o : SITE, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
}
/* map packs for the web version: GitHub release files carry no CORS header, so a web page cannot
   download them itself; this passes them through (streamed, nothing is stored) with one. */
async function mapFile(req, url) {
  const f = url.searchParams.get('f') || '';
  if (!/^map-\d{8}\/mallah-[a-z0-9_-]{1,40}\.zip$/.test(f)) return new Response('bad file', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
  const r = await fetch('https://github.com/mustafasami446-star/mallah/releases/download/' + f, { redirect: 'follow', cf: { cacheEverything: true, cacheTtl: 86400 } });
  const h = new Headers({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/zip', 'Cache-Control': 'public, max-age=86400' });
  const len = r.headers.get('content-length'); if (len) h.set('Content-Length', len);
  return new Response(r.body, { status: r.status, headers: h });
}
async function handle(req, env) {
  const h = cors(req), url = new URL(req.url);
  if (url.pathname === '/map') return mapFile(req, url);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  await ensure(env);
  if (url.pathname === '/key') return new Response(JSON.stringify({ key: (await vapidKeys(env)).pub }), { headers: h });
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: true, service: 'mallah-adhan' }), { headers: h });
  const txt = await req.text();
  if (txt.length > 4000) return new Response('{"error":"too big"}', { status: 413, headers: h });
  let j; try { j = JSON.parse(txt); } catch (e) { return new Response('{"error":"json"}', { status: 400, headers: h }); }
  const sub = j.sub || {};
  let host = ''; try { host = new URL(sub.endpoint).hostname; } catch (e) {}
  if (!PUSH_HOSTS.test(host) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return new Response('{"error":"subscription"}', { status: 400, headers: h });
  const id = await idOf(sub.endpoint);
  if (url.pathname === '/unsub' || !j.on) { await env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(id).run(); return new Response('{"ok":true,"off":true}', { headers: h }); }
  const c = j.cfg || {};
  const cfg = { lat: Math.round(+c.lat * 20) / 20, lng: Math.round(+c.lng * 20) / 20, method: METHODS[c.method] ? c.method : 'mwl', asr: c.asr === 2 ? 2 : 1,
    adj: Object.fromEntries(KEYS.map((k) => [k, Math.max(-30, Math.min(30, +((c.adj || {})[k]) || 0))])),
    prayers: (Array.isArray(c.prayers) ? c.prayers : KEYS).filter((k) => KEYS.includes(k)), tz: Math.max(-840, Math.min(840, +c.tz || 0)) };
  if (!isFinite(cfg.lat) || !isFinite(cfg.lng) || Math.abs(cfg.lat) > 66) return new Response('{"error":"place"}', { status: 400, headers: h });
  const nx = nextPrayer(cfg, Date.now() + 20000);
  await env.DB.prepare('INSERT INTO subs (id, sub, cfg, next, k, fails, updated) VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET sub = excluded.sub, cfg = excluded.cfg, next = excluded.next, k = excluded.k, fails = 0, updated = excluded.updated')
    .bind(id, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), JSON.stringify(cfg), nx ? nx.t : null, nx ? nx.k : null, Date.now()).run();
  if (j.test) {                                       // «جرّب الإشعار الآن»
    const keys = await vapidKeys(env), eph = await ephemeral();
    const r = await push(env, keys, eph, JSON.parse(JSON.stringify(sub)), JSON.stringify({ k: 'test', title: '🕌 الملاح — تجربة إشعار الأذان', body: 'سيصلك إشعار مثل هذا في وقت كل صلاة' }));
    return new Response(JSON.stringify({ ok: r.ok, status: r.status, next: nx }), { headers: h });
  }
  return new Response(JSON.stringify({ ok: true, next: nx }), { headers: h });
}
async function ephemeral() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privateKey: kp.privateKey, pub: new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) };
}

/* ---------------- every minute: send the adhan notifications that are due ---------------- */
async function tick(env) {
  await ensure(env);
  const now = Date.now();
  const due = await env.DB.prepare('SELECT id, sub, cfg, next, k, fails FROM subs WHERE next IS NOT NULL AND next <= ? ORDER BY next LIMIT ?').bind(now + 20000, MAX_PER_RUN).all();
  if (!due.results.length) return;
  const keys = await vapidKeys(env), eph = await ephemeral(), stmts = [];
  await Promise.all(due.results.map(async (row) => {
    const cfg = JSON.parse(row.cfg), sub = JSON.parse(row.sub);
    const late = now - row.next > 15 * 60e3;          // more than 15 minutes late (the worker was down): skip it
    let gone = false, ok = true;
    if (!late) {
      try {
        const r = await push(env, keys, eph, sub, JSON.stringify({ k: row.k, t: row.next, title: '🕌 حان وقت صلاة ' + (NAMES[row.k] || ''), body: 'اضغط لرفع الأذان في الملاح' }));
        gone = r.status === 404 || r.status === 410; ok = r.ok;
      } catch (e) { ok = false; }
    }
    if (gone || (!ok && row.fails >= 20)) { stmts.push(env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(row.id)); return; }
    const nx = nextPrayer(cfg, Math.max(row.next, now) + 60000);
    stmts.push(env.DB.prepare('UPDATE subs SET next = ?, k = ?, fails = ? WHERE id = ?').bind(nx ? nx.t : null, nx ? nx.k : null, ok ? 0 : row.fails + 1, row.id));
  }));
  if (stmts.length) await env.DB.batch(stmts);
  // browsers that have not opened Mallah for 60 days are forgotten
  if (new Date(now).getUTCMinutes() === 7 && new Date(now).getUTCHours() === 3) await env.DB.prepare('DELETE FROM subs WHERE updated < ?').bind(now - 60 * 86400e3).run();
}

export default {
  fetch: (req, env) => handle(req, env).catch((e) => new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: cors(req) })),
  scheduled: (ev, env, ctx) => ctx.waitUntil(tick(env))
};

