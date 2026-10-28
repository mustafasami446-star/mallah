#!/usr/bin/env python3
"""Build the offline place index (places.tsv) for the Mallah app from an OSM GeoJSON-seq export.
Columns: name (Arabic when available) / English name / lat / lng / kind / nearest city."""
import json, sys, math, re

ARABIC = re.compile(r'[؀-ۿ]')
KEEP_AMENITY = None   # keep every named amenity
PLACE_RANK = {'city': 0, 'town': 1, 'suburb': 2, 'quarter': 2, 'neighbourhood': 2, 'village': 3, 'hamlet': 4, 'locality': 4, 'isolated_dwelling': 5}
KIND_KEYS = ['place', 'amenity', 'healthcare', 'shop', 'tourism', 'aeroway', 'railway', 'public_transport', 'leisure', 'office', 'historic', 'man_made']

def centroid(g):
    t, c = g['type'], g['coordinates']
    if t == 'Point': return c[1], c[0]
    ring = c[0] if t == 'Polygon' else c[0][0]
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return sum(ys) / len(ys), sum(xs) / len(xs)

def kind_of(p):
    for k in KIND_KEYS:
        v = p.get(k)
        if v:
            if k == 'amenity' and v == 'place_of_worship':
                rel = p.get('religion', '')
                return 'mosque' if rel == 'muslim' else ('church' if rel == 'christian' else 'place_of_worship')
            if k == 'aeroway': return 'airport'
            if k in ('railway', 'public_transport'): return 'station'
            if k == 'office': return 'government'
            return v
    return ''

def main(src, out):
    rows, seen = [], set()
    with open(src, encoding='utf-8') as f:
        for line in f:
            line = line.strip().lstrip('\x1e')
            if not line: continue
            try: ft = json.loads(line)
            except Exception: continue
            p = ft.get('properties') or {}
            name = p.get('name') or ''
            ar = p.get('name:ar') or (name if ARABIC.search(name) else '')
            en = p.get('name:en') or (name if name and not ARABIC.search(name) else '')
            main_name = ar or name or en
            if not main_name: continue
            try: lat, lng = centroid(ft['geometry'])
            except Exception: continue
            k = kind_of(p)
            key = (main_name, round(lat, 3), round(lng, 3))
            if key in seen: continue
            seen.add(key)
            rows.append([main_name.replace('\t', ' '), en.replace('\t', ' ') if en != main_name else '', lat, lng, k])
    # nearest city/town gives each result some context
    towns = [(r[2], r[3], r[0]) for r in rows if r[4] in ('city', 'town')]
    cell = {}
    for t in towns: cell.setdefault((int(t[0] * 2), int(t[1] * 2)), []).append(t)
    def near(lat, lng):
        best, bd = '', 1e9
        ci, cj = int(lat * 2), int(lng * 2)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for t in cell.get((ci + di, cj + dj), []):
                    d = (t[0] - lat) ** 2 + ((t[1] - lng) * math.cos(math.radians(lat))) ** 2
                    if d < bd: bd, best = d, t[2]
        return best
    rows.sort(key=lambda r: (PLACE_RANK.get(r[4], 9), r[0]))
    with open(out, 'w', encoding='utf-8') as o:
        o.write('name\tname_en\tlat\tlng\tkind\tarea\n')
        for n, e, lat, lng, k in rows:
            a = '' if k in ('city', 'town') else near(lat, lng)
            if a == n: a = ''
            o.write(f'{n}\t{e}\t{lat:.6f}\t{lng:.6f}\t{k}\t{a}\n')
    print(len(rows), 'places')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
