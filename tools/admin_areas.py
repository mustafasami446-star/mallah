#!/usr/bin/env python3
"""Districts (أقضية) and sub-districts (نواحي) of Iraq from OpenStreetMap, for the app's
area picker (province -> district -> sub-district).

usage: admin_areas.py <admin.geojsonseq> <out areas.json>
"""
import json, os, re, sys, collections
from shapely.geometry import shape, mapping
from shapely.validation import make_valid
sys.path.insert(0, os.path.dirname(__file__))
from split_provinces import load_provinces

ARABIC = re.compile('[؀-ۿ]')
TOL = float(os.environ.get('AREA_TOL', '0.0012'))   # ~120 m


def rnd(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 4), round(c[1], 4)]
    return [rnd(x) for x in c]


def ar_name(p):
    for k in ('name:ar', 'official_name:ar', 'alt_name:ar'):
        if p.get(k):
            return p[k].strip()
    n = (p.get('name') or '').strip()
    if ARABIC.search(n):
        # "Kurdish / Arabic" style names: keep the Arabic-script part that is not Kurdish-only
        return n
    return (p.get('name:en') or n).strip()


def main(src, out):
    provs = load_provinces(src)
    raw = []
    with open(src, encoding='utf-8') as f:
        for line in f:
            line = line.strip().lstrip('\x1e')
            if not line:
                continue
            ft = json.loads(line)
            p = ft.get('properties') or {}
            if p.get('boundary') != 'administrative':
                continue
            try:
                lvl = int(p.get('admin_level'))
            except (TypeError, ValueError):
                continue
            if lvl < 5 or lvl > 9:
                continue
            if (ft.get('geometry') or {}).get('type') not in ('Polygon', 'MultiPolygon'):
                continue
            iso = (p.get('ISO3166-2') or '')
            if iso and not iso.upper().startswith('IQ'):
                continue
            g = make_valid(shape(ft['geometry']))
            if g.is_empty:
                continue
            pt = g.representative_point()
            prov = next((q for q in provs if q['geom'].contains(pt)), None)
            if not prov:
                continue                                   # outside Iraq
            raw.append({'osm': str(p.get('@id') or p.get('id') or len(raw)), 'l': lvl, 'ar': ar_name(p),
                        'en': (p.get('name:en') or p.get('name') or '').strip(), 'p': prov['id'], 'g': g, 'pt': pt})

    cnt = collections.Counter(a['l'] for a in raw)
    print('areas per admin_level:', dict(sorted(cnt.items())))
    # the district level is the coarser level with most areas; sub-districts the next one down
    dl = max((l for l in cnt if l <= 6), key=lambda l: cnt[l], default=None)
    # sub-districts (nahiya) are admin_level 7 or 8; 9 and below are city neighbourhoods
    sl = max((l for l in cnt if dl and dl < l <= 8), key=lambda l: cnt[l], default=None)
    stats = collections.defaultdict(lambda: collections.Counter())
    for a in raw:
        stats[a['p']][a['l']] += 1
    print('district level', dl, 'sub-district level', sl)

    areas = [a for a in raw if a['l'] in (dl, sl)]
    dists = [a for a in areas if a['l'] == dl]
    for i, a in enumerate(areas):
        a['id'] = ('d' if a['l'] == dl else 's') + str(i)
    for a in areas:
        a['up'] = None
        if a['l'] == sl:
            d = next((d for d in dists if d['p'] == a['p'] and d['g'].contains(a['pt'])), None)
            a['up'] = d['id'] if d else None

    res = []
    per = collections.defaultdict(lambda: [0, 0, 0])
    for a in areas:
        g = a['g'].simplify(TOL, preserve_topology=True)
        if g.is_empty:
            continue
        w, s, e, n = a['g'].bounds
        m = mapping(g)
        res.append({'id': a['id'], 'k': 'd' if a['l'] == dl else 's', 'ar': a['ar'], 'en': a['en'], 'p': a['p'], 'up': a['up'],
                    'c': [round(a['pt'].x, 4), round(a['pt'].y, 4)], 'b': [round(w, 4), round(s, 4), round(e, 4), round(n, 4)],
                    'g': {'type': m['type'], 'coordinates': rnd(m['coordinates'])}})
        per[a['p']][0 if a['l'] == dl else 1] += 1
        if a['l'] == sl and not a['up']:
            per[a['p']][2] += 1
    res.sort(key=lambda r: (r['p'], r['k'], r['ar']))
    doc = {'source': 'OpenStreetMap contributors (ODbL)', 'levels': {'district': dl, 'subdistrict': sl},
           'stats': {p: dict(c) for p, c in stats.items()}, 'areas': res}
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print('written', out, os.path.getsize(out), 'bytes,', len(res), 'areas')
    for pid in sorted(per):
        print(f'  {pid:14s} districts {per[pid][0]:3d}  sub-districts {per[pid][1]:3d}  (without district {per[pid][2]})')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
