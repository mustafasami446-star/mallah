import json, urllib.request, urllib.parse, sys
UA = {'User-Agent': 'Mallah/1.0 (github.com/mustafasami446-star/mallah; mustafasami446@gmail.com)'}
def api(**p):
    p.update(format='json', formatversion=2)
    return json.loads(urllib.request.urlopen(urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(p), headers=UA), timeout=40).read())
seen = {}
for q in ['adhan', 'azan', 'athan', 'ezan', 'أذان', 'اذان', 'آذان', 'call to prayer', 'shia adhan', 'اذان شیعه', 'اذان', 'muezzin', 'Adhan Iraq', 'Adhan Karbala', 'Adhan Najaf', 'Adhan Kadhimiya']:
    try:
        r = api(action='query', list='search', srsearch=q + ' filetype:audio', srnamespace=6, srlimit=50)
        r2 = api(action='query', list='search', srsearch=q + ' filetype:video', srnamespace=6, srlimit=30)
    except Exception as e:
        print('fail', q, e); continue
    for x in r['query']['search'] + r2['query']['search']: seen[x['title']] = q
titles = list(seen)
print('found', len(titles))
out = []
for i in range(0, len(titles), 40):
    r = api(action='query', titles='|'.join(titles[i:i + 40]), prop='imageinfo', iiprop='url|size|mime|extmetadata|metadata', iiextmetadatafilter='LicenseShortName|Artist|ImageDescription|Categories|DateTimeOriginal')
    for pg in r['query']['pages']:
        ii = (pg.get('imageinfo') or [{}])[0]; em = ii.get('extmetadata', {})
        md = {m['name']: m['value'] for m in (ii.get('metadata') or []) if isinstance(m, dict) and 'name' in m}
        out.append(dict(t=pg['title'], url=ii.get('url'), mime=ii.get('mime'), size=ii.get('size'), len=md.get('length') or md.get('playtime_seconds'),
                        lic=(em.get('LicenseShortName') or {}).get('value'), artist=(em.get('Artist') or {}).get('value', '')[:120],
                        desc=(em.get('ImageDescription') or {}).get('value', '')[:300], cats=(em.get('Categories') or {}).get('value', '')[:300]))
json.dump(out, open('adhan_list.json', 'w'), ensure_ascii=False, indent=1)
for o in out: print(o['t'], '|', o['mime'], '|', o['size'], '|', o['len'], '|', o['lic'])
