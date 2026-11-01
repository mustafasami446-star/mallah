"""Download the candidate adhan recordings from Wikimedia Commons, make small mp3 files, and transcribe them
(to check which phrases each one contains). Temporary helper."""
import json, os, subprocess, urllib.request, urllib.parse
UA = {'User-Agent': 'Mallah/1.0 (github.com/mustafasami446-star/mallah; mustafasami446@gmail.com)'}
C = ['File:اذان حسین صبحدل.webm', 'File:AzaanMaahur.ogg', 'File:Tour guide recite Adhan in the Shah mosque in Isfahan, Iran.webm',
     'File:Call to prayer by Sabah Fakhry.mp3', 'File:Beautiful adhan.ogg', 'File:Azan.ogg', 'File:33937 ejaz215 call-to-prayer-from-the-prophet-s-mo.ogg']
os.makedirs('out', exist_ok=True)
r = json.loads(urllib.request.urlopen(urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(dict(action='query', titles='|'.join(C), prop='imageinfo', iiprop='url', format='json', formatversion=2)), headers=UA)).read())
info = []
for i, pg in enumerate(sorted(r['query']['pages'], key=lambda p: C.index(p['title']) if p['title'] in C else 99)):
    url = pg['imageinfo'][0]['url']; src = 'in%d' % i; dst = 'out/adhan%d.mp3' % (i + 1)
    print('downloading', pg['title'], url, flush=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as f, open(src, 'wb') as o: o.write(f.read())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '44100', '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-16', '-b:a', '80k', dst], check=True)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout.strip() or 0)
    info.append(dict(file=os.path.basename(dst), title=pg['title'], url='https://commons.wikimedia.org/wiki/' + urllib.parse.quote(pg['title'].replace(' ', '_')), dur=round(dur), size=os.path.getsize(dst)))
    os.remove(src)
try:
    from faster_whisper import WhisperModel
    m = WhisperModel('small', device='cpu', compute_type='int8')
    for it in info:
        segs, _ = m.transcribe('out/' + it['file'], language='ar', beam_size=1, vad_filter=False)
        it['text'] = ' '.join(s.text.strip() for s in segs)[:1500]
        print('====', it['title'], it['dur'], 's\n', it['text'], flush=True)
except Exception as e:
    print('transcribe failed', e)
json.dump(info, open('out/info.json', 'w'), ensure_ascii=False, indent=1)
