'use strict';
/* الملاح — حفظ خريطة العراق داخل المتصفح (نسخة الويب: لابتوب و iPhone)
   The map pack (one ZIP) is stored in IndexedDB as 8 MB pieces. The vector tiles are read straight
   out of those pieces by byte range; the small files (fonts, symbols, places) are unpacked once. */
(function () {
  if (window.Android) return;                         // the Android app has its own native store
  const DB = 'mallah-map', CH = 8 * 1024 * 1024;
  let db = null, meta = null, busy = false, cancelled = false;
  const chunkCache = new Map();

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('chunks'); d.createObjectStore('files'); d.createObjectStore('meta'); };
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  function tx(store, mode, fn) {
    return open().then((d) => new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out; const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = t.onabort = () => rej(t.error || new Error('db'));
    }));
  }
  const put = (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key));
  const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
  const clear = (store) => tx(store, 'readwrite', (s) => s.clear());

  async function chunk(i) {
    if (chunkCache.has(i)) return chunkCache.get(i);
    const b = await get('chunks', i);
    if (!b) throw new Error('map piece missing');
    if (chunkCache.size > 24) chunkCache.delete(chunkCache.keys().next().value);
    chunkCache.set(i, b);
    return b;
  }
  /* bytes [pos, pos+len) of the stored ZIP */
  async function readRaw(pos, len) {
    const out = new Uint8Array(len); let done = 0;
    while (done < len) {
      const p = pos + done, i = Math.floor(p / CH), off = p - i * CH;
      const b = await chunk(i), n = Math.min(len - done, b.size - off);
      if (n <= 0) throw new Error('read past end');
      out.set(new Uint8Array(await b.slice(off, off + n).arrayBuffer()), done);
      done += n;
    }
    return out;
  }
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (u16(b, i) + u16(b, i + 2) * 65536);

  function progress(phase, done, total) { if (window.onMapPackProgress) window.onMapPackProgress(phase, done, total); }
  function finish(ok, msg) { busy = false; if (window.onMapPackDone) window.onMapPackDone(ok, msg || ''); }

  /* ---------- write a ZIP into pieces, from a File or a network stream ---------- */
  async function storeFromBlob(file) {
    await clear('chunks'); chunkCache.clear();
    const n = Math.ceil(file.size / CH);
    for (let i = 0; i < n; i++) {
      if (cancelled) throw new Error('cancelled');
      // copy the slice into memory first so the browser keeps its own copy, independent of the picked file
      const part = new Blob([await file.slice(i * CH, Math.min(file.size, (i + 1) * CH)).arrayBuffer()]);
      await put('chunks', i, part);
      progress('import', Math.min(file.size, (i + 1) * CH), file.size);
    }
    return file.size;
  }
  async function storeFromStream(resp, expected) {
    await clear('chunks'); chunkCache.clear();
    const total = +resp.headers.get('content-length') || expected || 0;
    const reader = resp.body.getReader();
    let parts = [], have = 0, size = 0, i = 0;
    for (;;) {
      if (cancelled) { try { reader.cancel(); } catch (e) {} throw new Error('cancelled'); }
      const { value, done } = await reader.read();
      if (value) { parts.push(value); have += value.length; size += value.length; }
      while (have >= CH || (done && have > 0)) {
        const blob = new Blob(parts), take = Math.min(CH, blob.size);
        await put('chunks', i++, blob.slice(0, take));
        const rest = blob.slice(take);
        parts = rest.size ? [new Uint8Array(await rest.arrayBuffer())] : []; have = rest.size;
        progress('download', size - have, total);
        if (done && have === 0) break;
      }
      if (done) break;
    }
    return size;
  }

  /* ---------- read the ZIP directory, unpack the small files, remember where the tiles are ---------- */
  async function install(size) {
    progress('install', 0, 0);
    const tailLen = Math.min(size, 65557), tail = await readRaw(size - tailLen, tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { e = i; break; }
    if (e < 0) throw new Error('ليس ملف خريطة صالحًا');
    const count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
    const cd = await readRaw(cdOff, cdSize), dec = new TextDecoder();
    await clear('files');
    let p = 0, tiles = null, manifest = null;
    for (let k = 0; k < count; k++) {
      if (u32(cd, p) !== 0x02014b50) throw new Error('zip directory');
      const method = u16(cd, p + 10), csize = u32(cd, p + 20), nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32), lho = u32(cd, p + 42);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/') || name.includes('..')) continue;
      const lh = await readRaw(lho, 30);
      const data = lho + 30 + u16(lh, 26) + u16(lh, 28);
      if (name.endsWith('.pmtiles')) { if (method !== 0) throw new Error('tiles compressed'); tiles = { name, offset: data, length: csize }; continue; }
      let bytes = await readRaw(data, csize);
      if (method === 8) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if (method !== 0) continue;
      await put('files', name, new Blob([bytes]));
      if (name === 'manifest.json') manifest = JSON.parse(dec.decode(bytes));
    }
    if (!tiles || !manifest) throw new Error('ليس ملف خريطة الملاح');
    meta = { version: manifest.version, tiles: tiles.name, offset: tiles.offset, length: tiles.length, size };
    await put('meta', 'current', meta);
  }

  async function run(source) {
    try {
      const size = await source();
      await install(size);
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
      finish(true);
    } catch (e) {
      meta = null; try { await put('meta', 'current', null); } catch (x) {}
      finish(false, e && e.message === 'cancelled' ? 'cancelled' : (e && e.message) || 'error');
    }
  }

  window.WebPack = {
    kind: 'web',
    ready: open().then(() => get('meta', 'current')).then((m) => { meta = m || null; }).catch(() => { meta = null; }),
    info() { return meta ? { installed: true, busy, version: meta.version, size: meta.size } : { installed: false, busy }; },
    async readSlice(off, len) {
      if (!meta) throw new Error('no map');
      return (await readRaw(meta.offset + off, len)).buffer;
    },
    async file(name) { const b = await get('files', name); if (!b) throw new Error('missing ' + name); return b; },
    /* try to download directly; GitHub may refuse that from a web page, then the browser downloads the file instead */
    download(url, size) {
      if (busy) return false;
      busy = true; cancelled = false;
      run(async () => {
        let r;
        try { r = await fetch(url, { mode: 'cors' }); } catch (e) { throw new Error('direct'); }
        if (!r.ok || !r.body) throw new Error('direct');
        return storeFromStream(r, size);
      });
      return true;
    },
    importFile() {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.zip,application/zip';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) { finish(false, 'cancelled'); return; }
        if (busy) return; busy = true; cancelled = false;
        run(() => storeFromBlob(f));
      };
      inp.click();
    },
    cancel() { cancelled = true; },
    async remove() { meta = null; chunkCache.clear(); await put('meta', 'current', null); await clear('chunks'); await clear('files'); }
  };
})();
