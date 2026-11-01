"""Find more freely licensed Shia (Ja'fari) adhan recordings on Wikimedia Commons and Freesound,
transcribe them and keep the ones that contain the Shia phrases. Temporary helper."""
import json, os, re, subprocess, urllib.request, urllib.parse, html
UA = {'User-Agent': 'Mallah/1.0 (github.com/mustafasami446-star/mallah; mustafasami446@gmail.com)'}
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
def api(**p):
    p.update(format='json', formatversion=2)
    return json.loads(get('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(p)))
terms = ['اذان', 'أذان', 'آذان', 'اذان شیعه', 'اذان ماهور', 'اذان ترکی', 'مؤذن', 'موذن زاده', 'اذان حرم', 'اذان مغرب', 'اذان صبح', 'اذان ظهر',
         'adhan Iran', 'azan Iran', 'adhan shia', 'azan shia', 'adhan Mashhad', 'adhan Karbala', 'adhan Najaf', 'Imam Reza shrine adhan', 'Tasnim adhan',
         'Moazzenzadeh', 'call to prayer Iran', 'azan Tehran', 'ezan Azerbaijan', 'azan Baku', 'adhan Bahrain', 'adhan Lebanon shia', 'azan Pakistan shia']
seen = {}
for q in terms:
    for ft in ('audio', 'video'):
        try:
            r = api(action='query', list='search', srsearch=q + ' filetype:' + ft, srnamespace=6, srlimit=50)
            for x in r.get('query', {}).get('search', []): seen.setdefault(x['title'], q)
        except Exception as e: print('fail', q, e)
titles = list(seen); print('commons found', len(titles), flush=True)
cands = []
for i in range(0, len(titles), 40):
    r = api(action='query', titles='|'.join(titles[i:i + 40]), prop='imageinfo', iiprop='url|size|mime|extmetadata|metadata', iiextmetadatafilter='LicenseShortName|Artist|ImageDescription')
    for pg in r.get('query', {}).get('pages', []):
        ii = (pg.get('imageinfo') or [{}])[0]; em = ii.get('extmetadata', {})
        md = {m['name']: m['value'] for m in (ii.get('metadata') or []) if isinstance(m, dict) and 'name' in m}
        ln = md.get('length') or md.get('playtime_seconds')
        try: ln = float(ln)
        except Exception: continue
        lic = (em.get('LicenseShortName') or {}).get('value', '')
        txt = pg['title'] + ' ' + re.sub('<[^>]+>', '', (em.get('ImageDescription') or {}).get('value', ''))
        if not (40 <= ln <= 900): continue
        if not re.search(r'adhan|azan|athan|ezan|اذان|أذان|آذان|موذن|مؤذن|call to prayer', txt, re.I): continue
        if not re.search(r'CC|Public domain|PD', lic): continue
        cands.append(dict(t=pg['title'], url=ii.get('url'), size=ii.get('size'), len=ln, lic=lic, artist=re.sub('<[^>]+>', '', (em.get('Artist') or {}).get('value', ''))[:80], desc=txt[:250], src='commons'))
# Freesound: public search pages (license shown on each sound page)
for q in ['adhan', 'azan', 'athan', 'adhan iran', 'azan shia', 'call to prayer iran', 'ezan']:
    try:
        h = get('https://freesound.org/search/?q=' + urllib.parse.quote(q)).decode('utf8', 'ignore')
        for m in set(re.findall(r'href="(/people/[^/"]+/sounds/\d+/)"', h)):
            p = get('https://freesound.org' + m).decode('utf8', 'ignore')
            title = html.unescape((re.search(r'<title>(.*?)</title>', p, re.S) or [None, ''])[1]).strip()
            lic = 'CC0' if 'publicdomain/zero' in p else 'CC BY 4.0' if 'licenses/by/4.0' in p else 'CC BY 3.0' if 'licenses/by/3.0' in p else 'CC BY-NC' if 'by-nc' in p else '?'
            mp3 = re.search(r'(https://cdn\.freesound\.org/previews/[^"]+-hq\.mp3)', p)
            dur = re.search(r'"duration"\s*:\s*"?([\d.]+)', p) or re.search(r'data-duration="([\d.]+)"', p)
            d = float(dur.group(1)) if dur else 0
            if lic in ('CC0', 'CC BY 4.0', 'CC BY 3.0') and mp3 and (d == 0 or 40 <= d <= 900):
                cands.append(dict(t='freesound ' + m + ' ' + title, url=mp3.group(1), len=d, lic=lic, artist=m.split('/')[2], desc=title, src='freesound'))
    except Exception as e: print('freesound fail', q, e)
uniq = {}
for c in cands: uniq[c['url']] = c
cands = list(uniq.values()); print('candidates', len(cands), flush=True)
for c in cands: print('C', c['t'], '|', round(c['len']), '|', c['lic'], '|', c['artist'], '|', c['desc'][:160], flush=True)
from faster_whisper import WhisperModel
m = WhisperModel('small', device='cpu', compute_type='int8')
os.makedirs('out', exist_ok=True); keep = []
cands = [c for c in cands if not (c.get('size') and c['size'] > 80e6)]
cands.sort(key=lambda c: (0 if re.search(r'شیعه|shia|karbala|najaf|کربلا|نجف|mashhad|مشهد|رضا|Iran|ایران|ماهور|ترکی|Tasnim|Mehr|Baku|Bahrain', c['t'] + c['desc'], re.I) else 1, c.get('size') or 0))
cands = cands[:45]
print('to transcribe', len(cands), flush=True)
for n, c in enumerate(cands):
    try:
        open('in', 'wb').write(get(c['url']))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'in', '-vn', '-ac', '1', '-ar', '16000', '-t', '240', 'w.wav'], check=True)
        segs, _ = m.transcribe('w.wav', language='ar', beam_size=1)
        txt = ' '.join(s.text.strip() for s in segs)
        shia = bool(re.search(r'علي|عليا|عليًا|ولي الله|خير العمل|خير الع|خير الرم', txt))
        print('T', 'SHIA' if shia else '----', c['t'], '::', txt[:400], flush=True)
        if shia:
            f = 'out/s%02d.mp3' % n
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'in', '-vn', '-ac', '1', '-ar', '44100', '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-16', '-b:a', '80k', f], check=True)
            c['file'] = os.path.basename(f); c['text'] = txt[:1500]; keep.append(c)
    except Exception as e: print('err', c['t'], e)
json.dump(keep, open('out/info.json', 'w'), ensure_ascii=False, indent=1)
print('kept', len(keep))
